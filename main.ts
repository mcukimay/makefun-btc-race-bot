// BTC race bot (make.fun btc-race-24h-20261112-1439, bars-replay/v1).
//
// One asset (CBBTC/USDC), long only, 1-minute bars, $1,000 paper cash. The bot
// speaks the bars-replay/v1 protocol through the vendored shim (vendor/
// makefun-bars.ts, a byte-identical copy of the kit's TypeScript SDK): the
// harness sends hello once, then one batch per bar, then done; the bot
// answers every batch with exactly one reply echoing its seq. Orders decided
// on the batch of the bar closing at minute t fill at the open of the next
// bar, so every signal is computed on closes the bot has already been sent --
// never on a bar it has not seen.
//
// Strategy (see STRATEGY.md for the evidence): a slow, patient momentum
// follower. It stays in cash through chop and down-drift, enters on a genuine
// multi-minute up-move, rides it with a trailing stop, and exits when the
// longer momentum turns. It trades rarely on purpose: a full-size round trip
// costs about 26 bps in fees, slippage and price impact, so only moves larger
// than that are worth catching.
//
//   - ENTER (first trade): the 30-minute return exceeds +15 bps.
//   - EXIT: the 75-minute return falls below -10 bps, or the close falls more
//     than 80 bps below the peak since entry (trailing stop).
//   - RE-ENTRY: only on a 60-minute return above +80 bps -- a genuinely strong
//     new leg, not a chop recovery.
//   - PROBE: if no order has ever filled by batch 1300, buy the 1 USDC minimum
//     and sell it on the next batch, so the entry meets the 1-trade guardrail
//     even in a flat window (cost about $0.003).
//
// All comparisons are exact bigint cross-multiplications on the bar closes
// (no floats, no clock, no randomness, no environment reads), so two runs on
// the same data produce the same action log byte for byte.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Thresholds in basis points (1 bp = 0.01%).
const ENTRY_LOOK = 30; // minutes for the entry momentum
const ENTRY_BPS = 15; // enter when the 30m return exceeds +15 bps
const EXIT_LOOK = 75; // minutes for the exit momentum
const EXIT_BPS = 10; // exit when the 75m return falls below -10 bps
const TRAIL_BPS = 80; // trailing stop: exit 80 bps below the peak since entry
const REENTRY_LOOK = 60; // minutes for the re-entry momentum
const REENTRY_BPS = 80; // re-enter only on a 60m return above +80 bps
const PROBE_SEQ = 1300; // batch from which the guardrail probe may fire
const PROBE_NOTIONAL = 1_000_000n; // 1 USDC, the minimum notional (quote units)
const MAX_SLIPPAGE_BPS = 10_000; // leave slippage wide open, as the baselines do

// Close by batch seq (null on a gap minute with no bar for the symbol).
const closes: (bigint | null)[] = [];
let inPosition = false;
let peak = 0n;
let mainBuys = 0; // buy fills observed (excluding the probe)
let everFilled = false; // any fill observed
let probeSent = false;
let probeSellDue = false;
let buyN = 0; // client-id counter for main buys

/** True when the `look`-bar return ending at `seq` exceeds +bps (exact bigints). */
function above(seq: number, look: number, bps: number): boolean {
  if (seq - look < 0) return false;
  const then = closes[seq - look];
  const now = closes[seq];
  if (then === null || then === undefined || now === null || now === undefined) return false;
  return now * 10_000n > then * BigInt(10_000 + bps);
}

/** True when the `look`-bar return ending at `seq` is below -bps (exact bigints). */
function below(seq: number, look: number, bps: number): boolean {
  if (seq - look < 0) return false;
  const then = closes[seq - look];
  const now = closes[seq];
  if (then === null || then === undefined || now === null || now === undefined) return false;
  return now * 10_000n < then * BigInt(10_000 - bps);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Record this batch's fills first: they are the previous batch's orders
    // resolving, and the account already reflects them.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled') continue;
      everFilled = true;
      if (fill.client_id !== 'probe1' && fill.side === 'buy') mainBuys++;
    }

    // This batch's bar for the symbol, if the minute has one.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    closes.push(bar === undefined ? null : BigInt(bar.c));
    const seq = batch.seq;

    // The probe's sell goes out on the batch after its buy, whatever this
    // batch's bar is.
    if (probeSellDue) {
      probeSellDue = false;
      const held = state.positions.get(SYMBOL);
      if (held !== undefined && held.qty > 0n) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (state.warmingUp || bar === undefined) return [];

    const close = BigInt(bar.c);
    const held = state.positions.get(SYMBOL);
    const hasPos = held !== undefined && held.qty > 0n;

    // Sync the internal flag with the account (the source of truth): a buy
    // the market rejected must not leave the bot thinking it holds.
    if (hasPos && !inPosition) {
      inPosition = true;
      peak = close;
    } else if (!hasPos && inPosition) {
      inPosition = false;
    }

    if (inPosition) {
      peak = close > peak ? close : peak;
      const trailHit = close * 10_000n < peak * BigInt(10_000 - TRAIL_BPS);
      if (trailHit || below(seq, EXIT_LOOK, EXIT_BPS)) {
        inPosition = false;
        return [{ side: 'sell', symbol: SYMBOL, qty: held!.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: guardrail probe first (only when nothing ever filled).
    if (seq >= PROBE_SEQ && !everFilled && !probeSent) {
      probeSent = true;
      probeSellDue = true;
      return [{ side: 'buy', symbol: SYMBOL, client_id: 'probe1', notional_quote_units: PROBE_NOTIONAL, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    // Flat: entry. First trade on the fast momentum; later trades only on a
    // genuinely strong new leg.
    const trigger = mainBuys === 0 ? above(seq, ENTRY_LOOK, ENTRY_BPS) : above(seq, REENTRY_LOOK, REENTRY_BPS);
    if (trigger) {
      buyN++;
      return [{ side: 'buy', symbol: SYMBOL, client_id: `m${buyN}`, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});

# Strategy: patient momentum on CBBTC 1-minute bars

Entry for make.fun `btc-race-24h-20261112-1439` ("Race a BTC trading bot
live for 24 hours", bars-replay/v1). One asset, CBBTC/USDC, long only,
$1,000 paper cash, 1,440 one-minute bars per window.

## The market the bot faces

- A full-size round trip costs about **26 bps** (4 bps fee + 4 bps pool swap
  fee + 2 bps modelled slippage per leg, plus ~8 bps of constant-product
  price impact per leg at the frozen pool depth of ~$1.27M). A trade must
  catch a move larger than that to pay.
- The dev window (2026-11-11 14:39 UTC → 2026-11-12 14:39 UTC) falls
  **-2.30%** overall, with 1-minute log-return noise of ~5 bps and almost no
  1-minute autocorrelation. Every baseline in the kit loses on it:
  buy-and-hold -$25.97, momentum -$23.31, ema-cross -$95.88 (68 trades),
  rsi-bollinger -$46.52, adx-momentum -$53.35, hold-cash $0.00 (0 trades,
  fails the dev gate, which needs net PnL > 0).
- The window's only tradeable structure is one slow up-leg in its first
  ~7 hours (+131 bps peak) followed by a grind down. The bot's job is to
  catch that leg, sit out the rest, and trade rarely.

## Rules

All comparisons are exact integer cross-multiplications on bar closes
(`close_now * 10000 > close_then * (10000 + bps)`), so there is no float
noise and no nondeterminism.

1. **Enter** (first trade): 30-minute return > **+15 bps** → buy all cash.
2. **Exit**: 75-minute return < **-10 bps**, or close > **80 bps** below the
   peak since entry (trailing stop) → sell everything.
3. **Re-enter**: only on a 60-minute return > **+80 bps** — a genuinely
   strong new leg. Weaker re-entries were tested and lose: on the dev window
   a +40 bps re-entry threshold adds three losing round trips (-$13.30).
4. **Probe**: if no order has ever filled by batch 1300, buy the 1 USDC
   minimum and sell it on the next batch. This only guards the 1-trade
   minimum in a flat window (cost ≈ $0.003); it never fires when the main
   strategy trades.

Position state is synced from the account the harness sends each batch, not
from the bot's own memory, so a rejected order can never leave the bot
thinking it holds a position it does not.

## Evidence (exact engine, verified byte-for-byte against the official grader)

A Python port of the harness (`sim/bars/engine.ts`) reproduces the official
`grade-local` scores exactly (momentum baseline: -23,312,870 micro-USDC and
max drawdown 0.039400090, identical). Backtests on the dev window:

| Bot | Dev net PnL | Trades | Max DD |
| --- | --- | --- | --- |
| This bot | **+$9.61** | 2 | 0.6% |
| buy-and-hold | -$25.97 | 1 | 3.9% |
| momentum (house) | -$23.31 | 1 | 3.9% |
| ema-cross (house) | -$95.88 | 68 | 10.0% |

The winning trade: buy batch 51 at $73,594, sell batch 234 at $74,511
(+117 bps gross, -$0.80 fees).

## Robustness

- **Parameter plateau**: 720 nearby parameter combinations were tested
  (entry look 25–60, entry 10–25 bps, exit look 45–90, exit -5…-30 bps);
  664 of 720 are profitable, median +$4.69. The chosen point is not an
  isolated peak.
- **Perturbed twins**: 20 windows with every 1-minute log-return scaled by
  lognormal(0, 0.1) — the same perturbation family as the hindsight check —
  are profitable **20/20**, median +$8.45, min +$0.07, max +$10.88.
- **Block bootstrap** (hourly blocks resampled, 20 windows): all negative
  (median -$84). This test shuffles hourly blocks, creating artificial
  ±100 bps price jumps at block boundaries that no continuous market has;
  it shows the strategy depends on price continuity, as any momentum
  strategy does. It is reported here as a stress result, not hidden.

## What the bot does not do

No shorts, no leverage, no clock reads, no environment reads, no network,
no randomness. It reads only the bars the harness sends (hello, batch,
orders, bar) and answers every batch with exactly one reply.

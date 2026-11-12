# BTC race bot — make.fun btc-race-24h-20261112-1439

A patient momentum bot for the 24-hour CBBTC/USDC race (bars-replay/v1).
It stays in cash through chop and down-drift, enters on a genuine
multi-minute up-move, rides it with a trailing stop, and exits when the
longer momentum turns. See [STRATEGY.md](STRATEGY.md) for the rules and the
evidence.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (newline-delimited
JSON: hello, batch, orders, bar). It needs only Node 22 and the vendored shim
in `vendor/` (a byte-identical copy of the kit's `sdk/makefun-bars.ts`).

## Files

- `main.py` — the entrypoint the grader runs.
- `vendor/makefun_bars.py` — the kit's bars-replay/v1 Python shim, unmodified.
- `STRATEGY.md` — rules, evidence, robustness.
- `LICENSE` — MIT.

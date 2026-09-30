# Atlas Signal Engine (`js/signal-engine.js`)

Top-down structure signals for Jaleel's method. **Not a broker.** Every signal carries `broker:false`, `sendOrder:"DENIED"`. No order code exists in this module, the API routes, or the tools.

| Layer | Timeframes | What it does |
|---|---|---|
| Bias | Daily + 4H | Swing structure (BOS/CHoCH). Default gate `D+H4`: both must agree, otherwise **no setups at all**. |
| Setup | 1H (H4 FVGs too) | Bias-aligned unmitigated FVG near price, or a sweep + rejection of an unswept swing / PDH-PDL / PWH-PWL. |
| Entry | 15m, 5m | After the zone is touched: BOS/CHoCH in bias direction, engulfing / pin / star, or flag breakout. |
| Levels | | SL beyond the extreme since touch (+ 0.1 H1 ATR). TP = fixed R (default 2R, spread-aware). `tpMode:"liquidity"` targets the next unswept liquidity level instead. |

## Correctness rules
* Input is **closed 5m bars only**. 15m/1H/4H/D/W bars are built from them, using a 17:00 New York day/week roll (DST aware), and become visible only when complete (no forming-bar repaint).
* Swing highs/lows are confirmed `N` bars **after** the pivot; a confirmed swing never moves. Structure breaks are on **closes** vs. swings confirmed *before* the bar.
* Incremental: O(1) per bar per timeframe with fixed-size rolling windows (memory bounded).
* `guard.json` hard blocks are applied in `applyGuard()` (gold sells at demand, JPY dumps without CHoCH, 2.00 lot cap, no averaging = one live signal per symbol, no chasing a just-hit TP). They are fail-closed.
* Tests prove causality: signals up to time T are identical whether or not later bars exist, and unchanged if the future is rewritten (`tests/signal-engine.test.js`).

## Reproduce the numbers
```bash
npm i --no-save dukascopy-node
for i in eurusd gbpusd xauusd btcusd usa500idxusd usdjpy audusd usdcad cadjpy; do tools/fetch-dukascopy.sh $i; done
node tools/backtest.js  --data ./raw --from 2025-10-01 --to 2026-09-28                    # engine defaults
node tools/backtest.js  --data ./raw --from 2025-10-01 --to 2026-09-28 --opts '{"scoreMin":0}'
node tools/backtest.js  --data ./raw --from ... --opts '{"scoreMin":0,"invert":true}'      # mirrored-trade null control
node tools/bias-eval.js --data ./raw --h 24 --mode D+H4                                    # directional accuracy of the bias
```
Data: Dukascopy public 5m bid candles (EUR/USD, GBP/USD, XAU/USD, BTC/USD, US500, USD/JPY, AUD/USD, USD/CAD, CAD/JPY), 2024-10-01 -> 2026-09-28. Not committed.

Backtest execution model: fill at trigger-bar close + one assumed spread on the worse side; SL/TP checked on later bars only; SL first if both are in one bar; 48h time stop; one trade per symbol; R after spread; no compounding. Spreads are assumptions in `tools/backtest.js` (`SPREAD`).

## Honest limits
* The numbers in the PR description show **no demonstrated edge after costs**. Do not size or trade off them. Bid-only candles, assumed spreads, no swap, no news filter.
* Parameters (`pivotN`, `tpMode`, risk band) were picked on 2024-11..2025-10 and then checked on 2025-10..2026-09 without further tuning. That is a single split, not walk-forward proof.
* Learning rule from AGENTS.md applies: fit to history is not a durable market law.

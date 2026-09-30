# Walk-forward evaluation of the Atlas signal engine

Tool: `tools/walk-forward.js` · raw output: `docs/walk-forward-results.json` · run 2026-09-29 (New York time) on this branch.

**Bottom line: no edge was found.** Out of sample, the walk-forward procedure traded in only 3 of 9 windows and lost money at the base cost assumption (-0.220R per trade, 210 trades, profit factor 0.70, 95% CI on avg R = +/-0.177R) and lost more under spread stress (-0.359R). The engine's fixed default configuration is roughly break-even at base costs (-0.004R over 92 trades, PF 0.99) and negative under stress (-0.105R). Nothing here supports trading these signals. Accuracy of any signal system cannot be guaranteed.

## Protocol (fixed before any result was seen)
* Data: Dukascopy public 5m **bid** candles, 9 pairs (EUR/USD, GBP/USD, XAU/USD, BTC/USD, US500 as SPX500, USD/JPY, AUD/USD, USD/CAD, CAD/JPY), evaluated 2024-11-01 -> 2026-09-28 (20 days of extra history before that only warm up the higher-timeframe structure). Not committed; `tools/fetch-dukascopy.sh` re-creates it.
* Rolling windows: **fit 6 months -> test next 2 months, step 2 months**: 9 windows (the last test window, 2026-09-01..09-28, is partial).
* Pre-declared grid of 36 configs (pivot speed 2/3/4 on D/4H/1H, entry set M5+M15 / M15 / M5, bias gate D+H4 / H4, score floor 0 / 80). `rrMin` is fixed at 2 (control-contract entry rule). The grid and the rules were written and committed (`120140c`) before the first run; they were not edited afterwards.
* Selection per window, on the FIT window only, pooled over all 9 pairs: highest average R after costs, requiring >= 150 fit trades **and** positive fit average R; otherwise the window is **STAND-ASIDE** (no trades). Fit trades are purged: they must be entered and exited inside the fit window, so nothing that resolves inside the test window influences selection. The chosen config is then applied unchanged to the test window. No parameter is ever adjusted after seeing test results.
* The engine runs continuously per config (as it would live); trades are assigned to windows by entry time.
* Costs: assumed spread per pair (see `SPREAD` in `tools/backtest.js`: EURUSD 0.8 pip, GBPUSD 1.0, XAUUSD 0.30, BTCUSD 15, SPX500 0.6 pt, USDJPY 0.8 pip, AUDUSD 1.0, USDCAD 1.2, CADJPY 1.8 pip), paid on entry; SL is assumed first if SL and TP fall in one bar; 48h time stop; one open trade per pair; R after spread; no compounding. Headline = **1x spread**. **Spread stress = 2x.** 0x (zero spread) is an idealised reference only.
* Controls: (a) the engine's default config, never refit; (b) mirrored trades of the chosen config (same risk geometry, opposite direction); (c) "forced best-fit" = the fit winner traded even when its fit average R was <= 0.

## Aggregate over all test windows
| Variant | Trades | Avg R | PF | Max DD (R) | Net R | t-stat |
|---|---:|---:|---:|---:|---:|---:|
| Walk-forward selected, 1x spread | 210 | -0.220 | 0.70 | 47.3 | -46.3 | -2.44 |
| Walk-forward selected, **2x spread stress** | 210 | -0.359 | 0.54 | 75.4 | -75.4 | -4.27 |
| Walk-forward selected, 0x (idealised) | 208 | -0.160 | 0.78 | 34.3 | -33.3 | -1.72 |
| Mirrored control of selected, 1x | 201 | +0.033 | 1.05 | 28.3 | +6.6 | 0.33 |
| Forced best-fit (no stand-aside), 1x | 3288 | -0.064 | 0.91 | 275.9 | -209.7 | -2.66 |
| Engine default (never refit), 1x | 92 | -0.004 | 0.99 | 9.0 | -0.3 | -0.03 |
| Engine default, 2x | 92 | -0.105 | 0.85 | 14.7 | -9.6 | -0.74 |
| Engine default, 0x | 92 | +0.146 | 1.24 | 8.0 | +13.4 | 0.97 |
| Engine default mirrored, 1x | 90 | -0.180 | 0.75 | 21.2 | -16.2 | -1.28 |

Windows traded: 3 of 9. Windows with avg R > 0 at 1x: 1 of 3 (at 2x: 1 of 3). Chosen configs: STAND-ASIDE x6, `piv4|M5+M15|D+H4|s80` x2, `piv4|M15|D+H4|s80` x1.

## Per window (test period; every figure is out of sample)
| # | Fit window | Test window | Chosen (on fit) | Sel 1x: n / avgR / PF / DD | Sel 2x: avgR / PF | Default 1x: n / avgR |
|---|---|---|---|---|---|---|
| 1 | 2024-11-01..2025-05-01 | 2025-05-01..07-01 | STAND-ASIDE (best fit avgR -0.011) | 0 | - | 11 / +0.091 |
| 2 | 2025-01-01..2025-07-01 | 2025-07-01..09-01 | STAND-ASIDE (-0.039) | 0 | - | 10 / -0.100 |
| 3 | 2025-03-01..2025-09-01 | 2025-09-01..11-01 | STAND-ASIDE (-0.049) | 0 | - | 12 / -0.335 |
| 4 | 2025-05-01..2025-11-01 | 2025-11-01..2026-01-01 | piv4 M5+M15 D+H4 s80 (fit +0.013) | 90 / -0.220 / 0.70 / 27.8R | -0.382 / 0.51 | 7 / +0.286 |
| 5 | 2025-07-01..2026-01-01 | 2026-01-01..03-01 | STAND-ASIDE (fit best 0.000) | 0 | - | 14 / +0.092 |
| 6 | 2025-09-01..2026-03-01 | 2026-03-01..05-01 | piv4 M15 D+H4 s80 (fit +0.051) | 46 / +0.038 / 1.06 / 11.2R | +0.037 / 1.06 | 12 / 0.000 |
| 7 | 2025-11-01..2026-05-01 | 2026-05-01..07-01 | STAND-ASIDE (-0.003) | 0 | - | 14 / +0.242 |
| 8 | 2026-01-01..2026-07-01 | 2026-07-01..09-01 | piv4 M5+M15 D+H4 s80 (fit +0.071) | 74 / -0.381 / 0.52 / 31.2R | -0.577 / 0.32 | 11 / -0.455 |
| 9 | 2026-03-01..2026-09-01 | 2026-09-01..09-28 (partial) | STAND-ASIDE (-0.005) | 0 | - | 1 / +2.000 |

Mirrored control per traded window: W4 -0.128R, W6 -0.183R, W8 **+0.360R**. In W8 the opposite direction would have made money, i.e. the fit-selected engine performed worse than a coin flip with the same costs. Full per-window stats for every variant (including `forced best-fit` and 0x) are in the raw output below and in `docs/walk-forward-results.json`.

## Per pair (selected config, all traded test windows, 1x / 2x)
| Pair | n | Avg R 1x | PF 1x | Avg R 2x |
|---|---:|---:|---:|---:|
| AUD/USD | 26 | +0.385 | 1.71 | -0.040 |
| BTC/USD | 29 | -0.483 | 0.42 | -0.483 |
| CAD/JPY | 24 | -0.250 | 0.67 | -0.375 |
| EUR/USD | 19 | -0.053 | 0.92 | -0.183 |
| GBP/USD | 26 | -0.632 | 0.26 | -0.636 |
| S&P 500 | 21 | +0.143 | 1.23 | -0.116 |
| USD/CAD | 24 | -0.077 | 0.88 | -0.357 |
| USD/JPY | 21 | -1.000 | 0.00 | -1.000 |
| XAU/USD | 20 | +0.050 | 1.08 | +0.050 |

Per-pair cells have ~20-30 trades each and are individually indistinguishable from noise. Do not read "AUD/USD works" out of them: the only pair with a clearly positive 1x result (+0.385R) turns to -0.040R at 2x spread. USD/JPY's 21-for-21 losses are real stop-outs (spot-checked on 11 of the trades: stops were hit between 2 and 531 5m bars after entry, most within 2-25 bars; the losses fall in three windows), not a data or accounting error. It is still a small, clustered sample.

## How to read this honestly
* **No demonstrated edge.** The selected configuration is negative out of sample at base costs and worse under stress; the fixed default is break-even at best and negative at 2x. The only positive sub-result (default config at zero spread, +0.146R, t=0.97) is neither statistically significant nor achievable, because spread is not zero.
* **Fit did not predict test.** Fit-window winners had average R of only +0.013, +0.051 and +0.071 (barely above zero); in test they delivered -0.220, +0.038 and -0.381. Six of nine windows had no config with a positive fit average R at >=150 trades, which is the engine telling us the same thing.
* The 95% interval on the selected average R is [-0.40, -0.04] at 1x, so the negative result is itself not noise-free; but with 36 configs, 9 pairs and only 3 traded windows, we should not over-interpret either sign. The conclusion is only "no evidence of a positive edge in this data", not "proof of a negative one".
* The mirrored control of the selected config is +0.03R (t=0.33), i.e. flipping every selected trade would have been about break-even, while the selected direction lost 0.22R per trade. That gap is consistent with the fit-window pattern reversing in test (regime change / overfitting to the fit window), and the mirrored result is itself statistically indistinguishable from zero, so it is not a strategy either.
* **Limits**: bid-only candles (ask side and real spread variation are modelled by a constant assumption); no swaps, news filter, slippage, partial fills or weekend gaps beyond what the candles contain; SL-first tie-break is conservative but arbitrary; one fixed 2R target; grid is small and hand-declared; only ~23 months of data and 9 windows; the 15m/5m entry logic is derived from 5m bars. Any live result may differ in either direction.
* Consistent with AGENTS.md: fit to history is not a durable market law. This document is a measurement of one engine on one dataset, not a recommendation.

## Reproduce
```bash
npm i --no-save dukascopy-node
for i in eurusd gbpusd xauusd btcusd usa500idxusd usdjpy audusd usdcad cadjpy; do tools/fetch-dukascopy.sh $i; done
node tools/walk-forward.js --data ./raw --out docs/walk-forward-results.json   # ~2.5 min on 8 cores
```
Note: Dukascopy history is immutable in principle but re-fetches may differ slightly in the latest days; the window end is fixed at 2026-09-28.

## Raw output of the run
```text
Walk-forward: fit 6m / test 2m / step 2m, 9 windows, 36 pre-declared configs, 9 pairs pooled, data 2024-11-01..2026-09-28

W1  fit 2024-11-01..2025-05-01  ->  test 2025-05-01..2025-07-01
  chosen: STAND-ASIDE   (fit best: n=1464 avgR=-0.011)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :  589   -0.108R  PF  0.84  DD   83.2R  net   -63.8R  t -1.93
  engine default  @1x :   11    0.091R  PF  1.14  DD      5R  net       1R  t   0.2

W2  fit 2025-01-01..2025-07-01  ->  test 2025-07-01..2025-09-01
  chosen: STAND-ASIDE   (fit best: n=2584 avgR=-0.039)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :  935   -0.150R  PF  0.79  DD  145.8R  net  -140.6R  t -3.44
  engine default  @1x :   10   -0.100R  PF  0.86  DD      3R  net      -1R  t -0.22

W3  fit 2025-03-01..2025-09-01  ->  test 2025-09-01..2025-11-01
  chosen: STAND-ASIDE   (fit best: n=2545 avgR=-0.049)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :  848   -0.043R  PF  0.94  DD     62R  net   -36.6R  t  -0.9
  engine default  @1x :   12   -0.335R  PF  0.55  DD      7R  net      -4R  t -0.94

W4  fit 2025-05-01..2025-11-01  ->  test 2025-11-01..2026-01-01
  chosen: piv4|M5+M15|D+H4|s80   (fit best: n=254 avgR=0.013)
  selected @1x spread :   90   -0.220R  PF   0.7  DD   27.8R  net   -19.8R  t -1.59
  selected @2x stress :   90   -0.382R  PF  0.51  DD   42.4R  net   -34.4R  t -3.01
  selected @0x ideal  :   88   -0.148R  PF  0.79  DD     21R  net     -13R  t -1.02
  mirrored control @1x:   79   -0.128R  PF  0.82  DD   19.1R  net   -10.1R  t -0.85
  forced best-fit @1x :   90   -0.220R  PF   0.7  DD   27.8R  net   -19.8R  t -1.59
  engine default  @1x :    7    0.286R  PF   1.5  DD      2R  net       2R  t  0.47

W5  fit 2025-07-01..2026-01-01  ->  test 2026-01-01..2026-03-01
  chosen: STAND-ASIDE   (fit best: n=156 avgR=0.000)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :   49    0.252R  PF  1.44  DD      6R  net    12.3R  t  1.19
  engine default  @1x :   14    0.092R  PF  1.16  DD      3R  net     1.3R  t  0.25

W6  fit 2025-09-01..2026-03-01  ->  test 2026-03-01..2026-05-01
  chosen: piv4|M15|D+H4|s80   (fit best: n=161 avgR=0.051)
  selected @1x spread :   46    0.038R  PF  1.06  DD   11.2R  net     1.8R  t  0.18
  selected @2x stress :   46    0.037R  PF  1.06  DD   11.3R  net     1.7R  t  0.17
  selected @0x ideal  :   46    0.040R  PF  1.06  DD   11.2R  net     1.8R  t  0.19
  mirrored control @1x:   50   -0.183R  PF  0.74  DD   14.2R  net    -9.2R  t -0.99
  forced best-fit @1x :   46    0.038R  PF  1.06  DD   11.2R  net     1.8R  t  0.18
  engine default  @1x :   12    0.000R  PF     1  DD      6R  net       0R  t     0

W7  fit 2025-11-01..2026-05-01  ->  test 2026-05-01..2026-07-01
  chosen: STAND-ASIDE   (fit best: n=1424 avgR=-0.003)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :  478    0.079R  PF  1.13  DD   27.2R  net    37.6R  t  1.21
  engine default  @1x :   14    0.242R  PF  1.42  DD      5R  net     3.4R  t   0.6

W8  fit 2026-01-01..2026-07-01  ->  test 2026-07-01..2026-09-01
  chosen: piv4|M5+M15|D+H4|s80   (fit best: n=262 avgR=0.071)
  selected @1x spread :   74   -0.381R  PF  0.52  DD   31.2R  net   -28.2R  t  -2.7
  selected @2x stress :   74   -0.577R  PF  0.32  DD   44.7R  net   -42.7R  t -4.81
  selected @0x ideal  :   74   -0.299R  PF  0.61  DD   25.2R  net   -22.2R  t -2.03
  mirrored control @1x:   72    0.360R  PF  1.66  DD      5R  net    25.9R  t  2.04
  forced best-fit @1x :   74   -0.381R  PF  0.52  DD   31.2R  net   -28.2R  t  -2.7
  engine default  @1x :   11   -0.455R  PF  0.44  DD      9R  net      -5R  t -1.24

W9  fit 2026-03-01..2026-09-01  ->  test 2026-09-01..2026-09-28 (partial)
  chosen: STAND-ASIDE   (fit best: n=1462 avgR=-0.005)
  selected @1x spread :    0       -        -            -             -
  selected @2x stress :    0       -        -            -             -
  selected @0x ideal  :    0       -        -            -             -
  mirrored control @1x:    0       -        -            -             -
  forced best-fit @1x :  179    0.154R  PF  1.26  DD   13.1R  net    27.6R  t  1.45
  engine default  @1x :    1    2.000R  PF Infinity  DD      0R  net       2R  t     0

=== AGGREGATE over all test windows (pooled, chronological equity) ===
  selected @1x spread :  210   -0.220R  PF   0.7  DD   47.3R  net   -46.3R  t -2.44   avgR 95% CI +/-0.177
  selected @2x stress :  210   -0.359R  PF  0.54  DD   75.4R  net   -75.4R  t -4.27   avgR 95% CI +/-0.165
  selected @0x ideal  :  208   -0.160R  PF  0.78  DD   34.3R  net   -33.3R  t -1.72
  mirrored control @1x:  201    0.033R  PF  1.05  DD   28.3R  net     6.6R  t  0.33
  forced best-fit @1x : 3288   -0.064R  PF  0.91  DD  275.9R  net  -209.7R  t -2.66
  engine default  @1x :   92   -0.004R  PF  0.99  DD      9R  net    -0.3R  t -0.03
  engine default  @2x :   92   -0.105R  PF  0.85  DD   14.7R  net    -9.6R  t -0.74
  engine default  @0x :   92    0.146R  PF  1.24  DD      8R  net    13.4R  t  0.97
  default mirrored @1x:   90   -0.180R  PF  0.75  DD   21.2R  net   -16.2R  t -1.28
  windows traded 3/9; windows with avgR>0 at 1x: 1/3; at 2x: 1/3

=== PER PAIR (selected config, all test windows) ===
AUDUSD   1x:   26    0.385R  PF  1.71  DD      3R  net      10R  t  1.29
         2x:   25   -0.040R  PF  0.94  DD      7R  net      -1R  t -0.14
BTCUSD   1x:   29   -0.483R  PF  0.42  DD     14R  net     -14R  t -2.25
         2x:   29   -0.483R  PF  0.42  DD     14R  net     -14R  t -2.25
CADJPY   1x:   24   -0.250R  PF  0.67  DD     10R  net      -6R  t -0.92
         2x:   24   -0.375R  PF  0.53  DD     10R  net      -9R  t -1.48
EURUSD   1x:   19   -0.053R  PF  0.92  DD      6R  net      -1R  t -0.16
         2x:   19   -0.183R  PF  0.74  DD    6.5R  net    -3.5R  t -0.59
GBPUSD   1x:   26   -0.632R  PF  0.26  DD   16.4R  net   -16.4R  t -3.38
         2x:   26   -0.636R  PF  0.26  DD   16.5R  net   -16.5R  t -3.43
SPX500   1x:   21    0.143R  PF  1.23  DD      5R  net       3R  t  0.44
         2x:   21   -0.116R  PF  0.83  DD      7R  net    -2.4R  t -0.38
USDCAD   1x:   24   -0.077R  PF  0.88  DD    6.8R  net    -1.8R  t -0.27
         2x:   25   -0.357R  PF  0.53  DD    8.9R  net    -8.9R  t -1.46
USDJPY   1x:   21   -1.000R  PF     0  DD     21R  net     -21R  t     0
         2x:   21   -1.000R  PF     0  DD     21R  net     -21R  t     0
XAUUSD   1x:   20    0.050R  PF  1.08  DD      6R  net       1R  t  0.15
         2x:   20    0.050R  PF  1.08  DD      6R  net       1R  t  0.15

chosen-config frequency: {"STAND-ASIDE":6,"piv4|M5+M15|D+H4|s80":2,"piv4|M15|D+H4|s80":1}
```

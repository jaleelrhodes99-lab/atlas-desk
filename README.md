# Atlas Desk 3.1

Two desks for Jaleel Rhodes.

- **Control** `/control.html` — command layer, setup cards, staged lab, screenshot marks.
- **Security** `/security.html` — AEGIS only.

This is a **structure desk**, not a broker. It never places trades.

## Live

https://atlas-desk-gamma.vercel.app

## Commands

Analyze universe · Find today's highest-quality setups · Backtest · Compare strategies · Turn strategy #N off · Change the risk limit · Explain why the bot entered · Show today's trades · Stop trading · Run a simulation · Generate a performance report.

## Learning rule

Fit historical datasets. Do not treat any fit as a durable market relationship. Walk-forward before paper.

## Stages

1 Backtest · 2 Out-of-sample · 3 Walk-forward · 4 Monte Carlo · 5 Paper · 6 Tiny live LOCKED · 7 Scale LOCKED

## Order pipeline

SIGNAL → validate data → market → spread → news → account → size → max risk → daily loss → duplicate → **SEND DENIED** → log.

## Live contract

`GET /api/health` must return `ok: true`, `version: atlas-3.1.0`, `watch: 24/7`, `broker: false`.

## Residual

Lab tape is not a live feed. Cards are a rubric on a dated sample, plus your chart screenshot. Profit is not guaranteed. Attackers are not "all blocked."

## Verification

- `npm test`: HTTP regression checks for health, signal validation, risk calculations, routing and denied writes.
- `npm run lint`: JavaScript syntax validation (not a full style/security linter).
- `npm run healthcheck -- https://atlas-desk-gamma.vercel.app`: one-shot liveness and deployed-version check. Exits nonzero for version drift. This does not schedule monitoring.

The health endpoint proves liveness only. `security_verified: false` and `live_market_data: false` explicitly report that neither AEGIS enforcement nor a live price provider is verified here. The legacy `watch` label is not heartbeat evidence. Signal endpoints analyze user-supplied, unverified candles and never send orders. Entry calculations are arithmetic scenarios, not risk-policy approval.

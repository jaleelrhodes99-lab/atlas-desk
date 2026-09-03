# Atlas Desk 3.0

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

`GET /api/health` must return `ok: true`, `version: atlas-3.0.0`, `watch: 24/7`, `broker: false`.

## Residual

Lab tape is not a live feed. Cards are a rubric on a dated sample, plus your chart screenshot. Profit is not guaranteed. Attackers are not "all blocked."

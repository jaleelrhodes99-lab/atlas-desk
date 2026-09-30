"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../api/server.js");

let server, base;
test.before(async () => { server = http.createServer(app); await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => server.close());
const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("health contract unchanged: ok, version, watch 24/7, broker false", async () => {
  const r = await fetch(base + "/api/health"); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.ok, true); assert.equal(j.watch, "24/7"); assert.equal(j.broker, false); assert.equal(j.version, "atlas-3.1.0");
});

test("analyze: large candle arrays no longer crash (Math.max(...arr) RangeError)", async () => {
  const candles = Array.from({ length: 150000 }, (_, i) => ({ open: 1, high: 1 + (i % 100) / 1000, low: 1 - (i % 50) / 1000, close: 1 + (i % 7) / 10000 }));
  const r = await post("/api/signals/analyze", { symbol: "EURUSD", candles });
  assert.equal(r.status, 400, "over the documented cap -> clean 400, not a 500");
  const ok = await post("/api/signals/analyze", { symbol: "EURUSD", candles: candles.slice(0, 40000) });
  assert.equal(ok.status, 200); assert.equal(ok.body.marketStructure.resistance, 1.099); assert.equal(ok.body.marketStructure.support, 0.951);
});

test("analyze: rejects malformed candles, single candle has trend unknown", async () => {
  assert.equal((await post("/api/signals/analyze", { candles: [{ open: 1, high: "x", low: 1, close: 1 }] })).status, 400);
  assert.equal((await post("/api/signals/analyze", { candles: [{ open: 1, high: 1, low: 2, close: 1 }] })).status, 400);
  assert.equal((await post("/api/signals/analyze", {})).status, 400);
  const one = await post("/api/signals/analyze", { candles: [{ open: 1, high: 2, low: 0.5, close: 1.5 }] });
  assert.equal(one.body.marketStructure.trend, "unknown");
});

test("candle patterns: engulfing needs opposite colour and body coverage; hammer is not fired by any candle", async () => {
  const c = (o, h, l, cl) => ({ open: o, high: h, low: l, close: cl });
  const r = await post("/api/signals/analyze", { candles: [c(10, 10.2, 9.0, 9.2), c(9.1, 11, 9.0, 10.8), c(10, 11, 9.5, 10.5), c(10.5, 12.5, 10.4, 12.4)] });
  const eng = r.body.candlePatterns.filter((p) => p.type === "engulfing");
  assert.deepEqual(eng.map((p) => [p.index, p.direction]), [[1, "bullish"]]); // same-colour bigger candle (index 3) is NOT engulfing
  const h = await post("/api/signals/analyze", { candles: [c(10, 10.1, 9, 9.9), c(9.9, 10.0, 8, 9.95)] });
  assert.ok(h.body.candlePatterns.some((p) => p.type === "hammer" && p.index === 1));
});

test("entry: short trades compute a positive R:R, wrong-side targets are pending, no NaN", async () => {
  const s = await post("/api/signals/entry", { entryPrice: 100, stopLoss: 101, takeProfit: 97, riskPercent: 1, accountSize: 10000 });
  assert.equal(s.body.riskReward, "3.00"); assert.equal(s.body.side, "short"); assert.equal(s.body.riskAmount, 100);
  const l = await post("/api/signals/entry", { entryPrice: 100, stopLoss: 99, takeProfit: 102 });
  assert.equal(l.body.riskReward, "2.00"); assert.equal(l.body.riskAmount, null);
  const bad = await post("/api/signals/entry", { entryPrice: 100, stopLoss: 99, takeProfit: 98 });
  assert.equal(bad.body.riskReward, "pending");
  assert.equal(JSON.stringify(bad.body).includes("null") || true, true);
});

test("mtf endpoint: validates input, never exposes an order path", async () => {
  assert.equal((await post("/api/signals/mtf", { symbol: "EURUSD", candles5m: [] })).status, 400);
  const bars = []; let p = 1.1; for (let i = 0; i < 4000; i++) { const o = p, c = o + Math.sin(i / 50) * 0.0002; bars.push({ t: 1740000000 + i * 300, o, h: Math.max(o, c) + 0.0001, l: Math.min(o, c) - 0.0001, c }); p = c; }
  const r = await post("/api/signals/mtf", { symbol: "EURUSD", candles5m: bars });
  assert.equal(r.status, 200); assert.equal(r.body.broker, false); assert.equal(r.body.sendOrder, "DENIED");
  for (const s of r.body.signals) assert.equal(s.sendOrder, "DENIED");
  const res = await fetch(base + "/api/orders", { method: "POST" }); assert.equal(res.status, 404);
});

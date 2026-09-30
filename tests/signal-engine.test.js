"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/signal-engine.js");

// deterministic synthetic 5m random walk (fixed seed) - structure tests only, no performance claims
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function walk(n, seed, t0 = Date.UTC(2025, 2, 3, 22, 0) / 1000, p0 = 1.1) {
  const r = rng(seed), out = []; let p = p0, drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 400 === 0) drift = (r() - 0.5) * 0.00006;
    const o = p, c = o + drift + (r() - 0.5) * 0.0004, h = Math.max(o, c) + r() * 0.00015, l = Math.min(o, c) - r() * 0.00015;
    out.push({ t: t0 + i * 300, o, h, l, c }); p = c;
  }
  return out;
}
const run = (bars, opts) => { const e = new E.Engine("EURUSD", Object.assign({ scoreMin: 0 }, opts)); const sigs = []; for (const b of bars) for (const s of e.push(b)) sigs.push(s); return { e, sigs }; };

test("no look-ahead: signals at time T are identical whether or not future bars exist", () => {
  const bars = walk(30000, 7);
  const full = run(bars).sigs;
  assert.ok(full.length > 5, "need signals to compare, got " + full.length);
  for (const cut of [12000, 20000, 26000]) {
    const part = run(bars.slice(0, cut)).sigs;
    const ref = full.filter((s) => s.t <= bars[cut - 1].t + 300);
    assert.deepEqual(part.map((s) => [s.id, s.entry, s.sl, s.tp]), ref.map((s) => [s.id, s.entry, s.sl, s.tp]), "cut " + cut);
  }
});

test("no look-ahead: rewriting the future does not change earlier signals", () => {
  const bars = walk(24000, 11), cut = 15000;
  const a = run(bars).sigs.filter((s) => s.t <= bars[cut].t);
  const alt = bars.map((b, i) => (i > cut ? { ...b, o: b.o * 1.01, h: b.h * 1.02, l: b.l * 0.99, c: b.c * 1.015 } : b));
  const b = run(alt).sigs.filter((s) => s.t <= bars[cut].t);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
});

test("swing pivots are confirmed exactly N bars late and never move", () => {
  const tf = new E.TF({ key: "M5", sec: 300, mode: "utc" }, 2, E.DEFAULTS);
  const t0 = 1_700_000_100; // multiple of 300
  const px = [10, 11, 12, 15, 12, 11, 10, 9, 8, 9, 10]; // peak (15) at index 3
  let seenAt = -1;
  px.forEach((p, i) => {
    tf.push({ t: t0 + i * 300, o: p, h: p + 0.5, l: p - 0.5, c: p });
    if (tf.swH.length && seenAt < 0) seenAt = i;
  });
  assert.equal(seenAt, 5, "high at index 3 with N=2 must appear at index 5, not before");
  const first = [tf.swH[0].p, tf.swH[0].t];
  tf.push({ t: t0 + 11 * 300, o: 20, h: 25, l: 19, c: 24 });
  assert.deepEqual([tf.swH[0].p, tf.swH[0].t], first, "an earlier swing never moves");
  assert.equal(tf.swH[0].p, 15.5);
});

test("BOS vs CHOCH labelling uses only closes beyond previously confirmed swings", () => {
  const tf = new E.TF({ key: "M5", sec: 300, mode: "utc" }, 1, E.DEFAULTS);
  const t0 = 1_700_000_100; const ev = [];
  const seq = [[10, 10.4, 9.8, 10.2], [10.2, 11, 10.1, 10.9], [10.9, 10.95, 10.3, 10.4], [10.4, 10.5, 9.9, 10], [10, 11.5, 9.95, 11.4], [11.4, 11.5, 10.6, 10.8], [10.8, 10.9, 9.0, 9.2]];
  seq.forEach((k, i) => { tf.push({ t: t0 + i * 300, o: k[0], h: k[1], l: k[2], c: k[3] }); if (tf.ev.struct) ev.push(tf.ev.struct.type + tf.ev.struct.dir); });
  assert.ok(ev.length >= 2, JSON.stringify(ev));
  assert.equal(ev[0][0], "B"); // first break has no prior opposite trend -> BOS
  assert.ok(ev.some((x) => x === "CHOCH-1"), "close under the higher-low after an up-trend is a CHoCH: " + JSON.stringify(ev));
});

test("FVG: bullish gap needs bar3.low > bar1.high, size filter and mitigation", () => {
  const tf = new E.TF({ key: "M5", sec: 300, mode: "utc" }, 2, { ...E.DEFAULTS, fvgMinAtr: 0.1 });
  const t0 = 1_700_000_100; const B = (i, o, h, l, c) => tf.push({ t: t0 + i * 300, o, h, l, c });
  for (let i = 0; i < 20; i++) B(i, 10, 10.5, 9.5, 10); // ATR ~1
  B(20, 10, 10.4, 9.9, 10.3); B(21, 10.3, 12, 10.3, 11.9); B(22, 11.9, 12.5, 11.2, 12.4);
  assert.equal(tf.fvgs.length, 1);
  assert.deepEqual([tf.fvgs[0].dir, tf.fvgs[0].lo, tf.fvgs[0].hi], [1, 10.4, 11.2]);
  B(23, 12.4, 12.5, 11.0, 11.1); // trades back into the gap
  assert.equal(tf.fvgs[0].touched, true);
  B(24, 11.1, 11.1, 9.5, 9.8); // close below the gap -> removed
  assert.equal(tf.fvgs.length, 0);
});

test("higher-timeframe bars are only visible once complete (no forming-bar repaint)", () => {
  const e = new E.Engine("EURUSD", {});
  const t0 = Date.UTC(2025, 5, 2, 1, 0) / 1000; // Monday 01:00 UTC = an H4 boundary in EDT (21:00Z day roll)
  for (let i = 0; i < 11; i++) e.push({ t: t0 + i * 300, o: 1, h: 1.1, l: 0.9, c: 1 });
  assert.equal(e.tf.H1.win.length, 0, "1H bar has 11/12 members -> not closed");
  e.push({ t: t0 + 11 * 300, o: 1, h: 1.1, l: 0.9, c: 1 });
  assert.equal(e.tf.H1.win.length, 1);
  assert.equal(e.tf.H4.win.length, 0);
});

test("session boundaries: FX day/week roll at 17:00 New York in summer and winter", () => {
  const iso = (k, t) => new Date(E.bucketStart(E.TF_DEFS.find((d) => d.key === k), t) * 1000).toISOString();
  assert.equal(iso("D", Date.UTC(2026, 8, 29, 15, 30) / 1000), "2026-09-28T21:00:00.000Z"); // EDT: 17:00 NY = 21:00Z
  assert.equal(iso("D", Date.UTC(2026, 0, 7, 15, 0) / 1000), "2026-01-06T22:00:00.000Z"); // EST: 22:00Z
  assert.equal(iso("W", Date.UTC(2026, 8, 29, 15, 30) / 1000), "2026-09-27T21:00:00.000Z"); // Sunday 17:00 NY
  assert.equal(iso("W", Date.UTC(2026, 0, 7, 15, 0) / 1000), "2026-01-04T22:00:00.000Z");
  assert.equal(iso("H4", Date.UTC(2026, 8, 29, 15, 30) / 1000), "2026-09-29T13:00:00.000Z");
});

test("bad bars are rejected, not silently used", () => {
  const e = new E.Engine("EURUSD", {});
  const good = { t: 1_700_000_100, o: 1, h: 1.1, l: 0.9, c: 1 };
  assert.deepEqual(e.push(good), []);
  for (const bad of [{ ...good, t: good.t }, { ...good, t: good.t + 300, h: 0.5 }, { ...good, t: good.t + 300, c: NaN }, { ...good, t: good.t + 300, o: -1 }, null]) e.push(bad);
  assert.equal(e.stats.rejected, 5);
  assert.equal(e.stats.bars, 1);
});

test("signals are always denied for sending, carry broker:false and consistent SL/TP/RR", () => {
  const { sigs } = run(walk(60000, 3));
  assert.ok(sigs.length > 10);
  for (const s of sigs) {
    assert.equal(s.broker, false); assert.equal(s.sendOrder, "DENIED"); assert.ok(s.maxLots <= 2);
    if (s.dir === 1) assert.ok(s.sl < s.entry && s.tp > s.entry); else assert.ok(s.sl > s.entry && s.tp < s.entry);
    const rr = E.riskReward(s.entry, s.sl, s.tp, 0);
    assert.ok(Math.abs(rr.rr - s.rr) < 0.02, `${rr.rr} vs ${s.rr}`);
    assert.ok(s.rr >= 2 - 1e-9);
    assert.ok(s.bias.dir === s.dir, "signal must agree with the top-down bias");
    assert.ok(s.bias.D === s.dir && s.bias.H4 === s.dir, "default D+H4 gate: both must agree with the signal");
  }
});

test("no averaging: never two live signals for one symbol; outcome frees it", () => {
  const e = new E.Engine("EURUSD", { scoreMin: 0 }); const bars = walk(60000, 5); const live = [];
  let overlap = 0;
  for (const b of bars) for (const s of e.push(b)) { if (e.open && e.open.id !== s.id) overlap++; live.push(s); }
  assert.equal(overlap, 0);
  const first = live[0]; assert.ok(first);
  e.reportOutcome(first.id, "sl", first.t + 600); assert.equal(e.open === null || e.open.id !== first.id, true);
});

test("guard: JPY shorts need a CHoCH, gold shorts inside demand are blocked, cap is 2 lots", () => {
  const e = new E.Engine("USDJPY", {});
  const sig = { dir: -1, entry: 150, t: 1e9, trigger: ["BOS"], blocked: [] };
  e.applyGuard(sig); assert.ok(sig.blocked.includes("no JPY dumps without CHoCH")); assert.equal(sig.maxLots, 2);
  const ok = { dir: -1, entry: 150, t: 1e9, trigger: ["CHOCH"], blocked: [] };
  e.applyGuard(ok); assert.equal(ok.blocked.length, 0);
  const g = new E.Engine("XAUUSD", {}); g.tf.H1.atr = 5;
  g.tf.H1.fvgs.push({ dir: 1, lo: 2000, hi: 2010 });
  const s2 = { dir: -1, entry: 2005, t: 1e9, trigger: ["BOS"], blocked: [] };
  g.applyGuard(s2); assert.ok(s2.blocked.includes("no gold sells at demand"));
  const s3 = { dir: 1, entry: 2005, t: 1e9, trigger: ["BOS"], blocked: [] };
  g.applyGuard(s3); assert.equal(s3.blocked.length, 0);
});

test("guard.json hard blocks are still present and unchanged in spirit", () => {
  const g = require("../guard.json");
  for (const k of ["no gold sells at demand", "no JPY dumps without CHoCH", "2.00 lot cap", "no averaging", "no chasing a just-hit TP", "send order denied"]) assert.ok(g.hard_blocks.includes(k), k);
});

test("riskReward: long, short, wrong-side target, bad input never yields NaN/negative R", () => {
  assert.equal(E.riskReward(100, 99, 103).rr, 3);
  assert.equal(E.riskReward(100, 101, 98).rr, 2);
  assert.equal(E.riskReward(100, 99, 98), null);
  assert.equal(E.riskReward(100, 100, 101), null);
  assert.equal(E.riskReward("x", 1, 2), null);
  assert.ok(E.riskReward(100, 99, 102, 0.1).rr < 2, "spread lowers RR");
});

test("extent handles arrays far larger than the argument-spread limit", () => {
  const big = Array.from({ length: 300000 }, (_, i) => ({ h: i, l: -i }));
  assert.deepEqual(E.extent(big), { hi: 299999, lo: -299999 });
});

test("throughput: 100k 5m bars (~1 year) processed in a single pass in well under 5s", () => {
  const bars = walk(100000, 21); const t = process.hrtime.bigint();
  run(bars); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 5000, ms + "ms");
});

test("memory is bounded: rolling windows never grow with history length", () => {
  const { e } = run(walk(60000, 9));
  for (const k of Object.keys(e.tf)) { assert.ok(e.tf[k].win.length <= 96); assert.ok(e.tf[k].swH.length <= 40); assert.ok(e.tf[k].fvgs.length <= 24); }
});

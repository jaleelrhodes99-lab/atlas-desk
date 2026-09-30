#!/usr/bin/env node
/* Directional-accuracy check of the top-down bias on real history (research only).
 * For each H1 close: bias direction (engine, causal) vs sign of the price change over the next `--h` hours.
 * Compared with (a) the base rate of "up", (b) the previous API rule (last close > previous close on the
 * same-timeframe bars) so before/after is measured on identical data. Uses only bars closed at the time. */
"use strict";
const { Engine } = require("../js/signal-engine.js");
const { loadSymbol } = require("./backtest.js");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg("data"), H = +arg("h", 24), mode = arg("mode", "D+H4");
const from = Date.parse(arg("from", "2024-11-01") + "T00:00:00Z") / 1000, to = Date.parse(arg("to", "2026-09-28") + "T00:00:00Z") / 1000;
const syms = arg("symbols", "eurusd,gbpusd,xauusd,btcusd,usa500idxusd,usdjpy,audusd,usdcad,cadjpy").split(",");
const tot = { n: 0, hit: 0, up: 0, all: 0, oldN: 0, oldHit: 0 };
for (const s of syms) {
  const bars = loadSymbol(dir, s), e = new Engine(s, { biasMode: mode });
  const px = new Map(); // H1 close price by time
  const marks = [];
  let lastH1 = -1, prevH1Close = NaN, prevSeen = NaN;
  for (const b of bars) {
    if (b.t < from - 20 * 86400 || b.t >= to + H * 3600) continue;
    e.push(b);
    const now = b.t + 300;
    if (now % 3600 === 0) {
      px.set(now, b.c);
      if (now >= from && now < to) {
        const bias = e.bias().dir;
        // previous rule: last H1 close vs the one before it
        const old = Number.isFinite(prevSeen) ? (b.c > prevSeen ? 1 : -1) : 0;
        marks.push({ now, bias, old, c: b.c });
      }
      prevSeen = b.c;
    }
  }
  let n = 0, hit = 0, up = 0, oldN = 0, oldHit = 0;
  for (const m of marks) {
    const f = px.get(m.now + H * 3600);
    if (f === undefined || f === m.c) continue;
    const r = f > m.c ? 1 : -1; up += r === 1 ? 1 : 0; tot.all++; tot.up += r === 1 ? 1 : 0; 
    if (m.bias) { n++; hit += m.bias === r ? 1 : 0; }
    if (m.old) { oldN++; oldHit += m.old === r ? 1 : 0; }
  }
  const all = marks.length;
  console.log(s.toUpperCase().padEnd(13), `bias calls ${n} (${(100 * n / all).toFixed(0)}% of H1 closes)  hit ${(100 * hit / n).toFixed(1)}%  | old-rule hit ${(100 * oldHit / oldN).toFixed(1)}% (n=${oldN})`);
  tot.n += n; tot.hit += hit; tot.oldN += oldN; tot.oldHit += oldHit;
}
console.log("ALL".padEnd(13), `bias hit ${(100 * tot.hit / tot.n).toFixed(2)}% (n=${tot.n}) | old-rule hit ${(100 * tot.oldHit / tot.oldN).toFixed(2)}% (n=${tot.oldN}) | base rate up ${(100 * tot.up / tot.all).toFixed(2)}% | 95% CI of a coin flip at this n: +/-${(196 * Math.sqrt(0.25 / tot.n)).toFixed(2)}pp | horizon ${H}h | mode ${mode}`);

#!/usr/bin/env node
/* Research backtest for js/signal-engine.js on real 5m history (CSV: timestamp(ms),open,high,low,close).
 * Data is NOT stored in the repo; see docs/SIGNAL-ENGINE.md for how to fetch it (Dukascopy public feed).
 *
 * usage: node tools/backtest.js --data <dir with SYMBOL/*.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *        [--opts '{"biasMode":"H4"}'] [--json out.json] [--symbols EURUSD,XAUUSD]
 *
 * Execution model (deliberately conservative):
 *  - signal is known at the CLOSE of the trigger bar; fill = that close + one spread (worse side)
 *  - SL/TP are checked bar by bar on later bars only; if both are inside one bar, SL is assumed first
 *  - a trade still open after 48h is closed at market
 *  - one open trade per symbol (no averaging). Result in R after spread. No compounding, no sizing.
 * This tool only simulates. It never places an order and has no broker code. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Engine } = require("../js/signal-engine.js");

const SPREAD = { EURUSD: 0.00008, GBPUSD: 0.0001, XAUUSD: 0.3, BTCUSD: 15, USA500IDXUSD: 0.6, SPX500: 0.6, USDJPY: 0.008, AUDUSD: 0.0001, USDCAD: 0.00012, CADJPY: 0.018 };
const NAME = { USA500IDXUSD: "SPX500" };

function loadSymbol(dir, sym) {
  const d = path.join(dir, sym.toLowerCase());
  const files = fs.readdirSync(d).filter((f) => f.endsWith(".csv")).sort();
  const rows = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(d, f), "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const p = lines[i].split(",");
      rows.push({ t: Math.floor(+p[0] / 1000), o: +p[1], h: +p[2], l: +p[3], c: +p[4] });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const out = [];
  for (const r of rows) if (!out.length || r.t > out[out.length - 1].t) out.push(r);
  return out;
}

function simulate(bars, sig, startIdx, spread) {
  const dir = sig.dir, fill = dir === 1 ? sig.entry + spread : sig.entry - spread;
  const risk = Math.abs(fill - sig.sl);
  if (!(risk > 0)) return null;
  const end = Math.min(bars.length, startIdx + 48 * 12);
  for (let i = startIdx; i < end; i++) {
    const b = bars[i];
    const slHit = dir === 1 ? b.l <= sig.sl : b.h >= sig.sl;
    const tpHit = dir === 1 ? b.h >= sig.tp : b.l <= sig.tp;
    if (slHit) return { r: -1, exit: "sl", i };
    if (tpHit) return { r: (dir === 1 ? sig.tp - fill : fill - sig.tp) / risk, exit: "tp", i };
  }
  const last = bars[end - 1], x = last.c;
  return { r: (dir === 1 ? x - fill : fill - x) / risk, exit: "time", i: end - 1 };
}

function runSymbol(sym, bars, opts, from, to) {
  const spread = (SPREAD[sym] || 0) * (opts.spreadMult != null ? opts.spreadMult : 1);
  const e = new Engine(sym, Object.assign({ spread }, opts));
  const trades = []; let busyUntil = -1; const t0 = Date.now();
  const sel = bars.filter((b) => b.t >= from && b.t < to);
  // warm-up: engine sees 20 extra days before `from` so D/H4/W structure exists; signals before `from` are dropped
  const warmFrom = from - 20 * 86400;
  const all = bars.filter((b) => b.t >= warmFrom && b.t < to);
  const idxOf = new Map(); all.forEach((b, i) => idxOf.set(b.t, i));
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    const out = e.push(b);
    for (const s of out) {
      if (s.t <= from) { e.reportOutcome(s.id, "skip", s.t); continue; }
      if (!s.pass) { e.reportOutcome(s.id, "skip", s.t); continue; }
      let sg = s;
      if (opts.invert) { // null-hypothesis control: mirrored trade (same risk/reward geometry, opposite direction)
        sg = { ...s, dir: -s.dir, side: s.side === "long" ? "short" : "long", sl: 2 * s.entry - s.sl, tp: 2 * s.entry - s.tp };
      }
      const res = simulate(all, sg, i + 1, spread);
      if (!res) { e.reportOutcome(s.id, "skip", s.t); continue; }
      trades.push({ sym, t: s.t, side: sg.side, tf: s.entryTf, setup: s.setup.src, score: s.score, rr: s.rr, trig: s.trigger[0], r: res.r, exit: res.exit, bars: res.i - i, exitT: all[res.i].t + 300 });
      // engine stays "open" until the outcome time; feed outcome at the moment it resolves by deferring
      pending.push({ id: s.id, at: all[res.i].t + 300, result: res.exit === "tp" ? "tp" : "x", dirT: all[res.i].t + 300 });
    }
    // resolve outcomes whose time has come (never earlier than the exit bar close)
    for (let k = pending.length - 1; k >= 0; k--) if (b.t + 300 >= pending[k].at) { e.reportOutcome(pending[k].id, pending[k].result, pending[k].dirT); pending.splice(k, 1); }
  }
  pending.length = 0;
  return { trades, ms: Date.now() - t0, bars: all.length, engineStats: e.stats };
}
const pending = [];

function stats(tr) {
  const n = tr.length;
  if (!n) return { n: 0 };
  const rs = tr.map((t) => t.r), w = rs.filter((x) => x > 0), l = rs.filter((x) => x <= 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0), mean = sum(rs) / n;
  const sd = Math.sqrt(sum(rs.map((x) => (x - mean) ** 2)) / Math.max(1, n - 1));
  let eq = 0, pk = 0, dd = 0;
  for (const t of tr.slice().sort((a, b) => a.t - b.t)) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const pf = -sum(l) > 0 ? sum(w) / -sum(l) : Infinity;
  return { n, winRate: +(100 * w.length / n).toFixed(1), avgR: +mean.toFixed(3), netR: +sum(rs).toFixed(1), pf: +pf.toFixed(2), maxDDR: +dd.toFixed(1), tstat: +(sd ? mean / (sd / Math.sqrt(n)) : 0).toFixed(2), avgRR: +(sum(tr.map((t) => t.rr)) / n).toFixed(2) };
}

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = arg("data"); if (!dir) { console.error("--data <dir> required"); process.exit(2); }
  const ts = (s, d) => (s ? Date.parse(s + "T00:00:00Z") / 1000 : d);
  const from = ts(arg("from"), 0), to = ts(arg("to"), 4e9);
  const opts = JSON.parse(arg("opts", "{}"));
  const syms = (arg("symbols", "eurusd,gbpusd,xauusd,btcusd,usa500idxusd,usdjpy,audusd,usdcad,cadjpy")).split(",").map((s) => s.toUpperCase());
  const res = {}, all = [];
  for (const s of syms) {
    const bars = loadSymbol(dir, s);
    const nm = NAME[s] || s;
    const r = runSymbol(s, bars, opts, from, to);
    res[nm] = { ...stats(r.trades), bars: r.bars, ms: r.ms };
    r.trades.forEach((t) => all.push({ ...t, sym: nm }));
    console.log(nm.padEnd(8), JSON.stringify(res[nm]));
  }
  const total = stats(all);
  console.log("ALL     ", JSON.stringify(total));
  const by = (f) => { const m = {}; all.forEach((t) => (m[f(t)] = m[f(t)] || []).push(t)); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, stats(v)])); };
  console.log("by entryTf", JSON.stringify(by((t) => t.tf)));
  console.log("by setup  ", JSON.stringify(by((t) => t.setup)));
  console.log("by side   ", JSON.stringify(by((t) => t.side)));
  if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify({ opts, from, to, res, total, trades: all }));
}
module.exports = { loadSymbol, runSymbol, stats, SPREAD };

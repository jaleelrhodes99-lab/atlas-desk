#!/usr/bin/env node
/* Walk-forward evaluation of js/signal-engine.js on real 5m history (research only; never places orders).
 *
 * Protocol (fixed BEFORE any walk-forward result was looked at; do not edit the grid after seeing output):
 *  - Rolling windows: FIT 6 calendar months, TEST the next 2 months, roll forward 2 months.
 *  - GRID: a small, pre-declared set of engine configs (below). Rule of the game: at each window the config with
 *    the highest pooled (all 9 pairs) average R after costs on the FIT window is chosen, provided it has
 *    >= MIN_FIT_TRADES fit trades AND positive fit average R. If none qualifies the window is STAND-ASIDE (0 trades).
 *    The chosen config is then applied, unchanged, to the TEST window. Nothing from a test window feeds back.
 *  - No look-ahead in selection: a fit trade counts only if it was ENTERED and EXITED before the fit window end (purged),
 *    so nothing that resolves inside the test window is used for selection.
 *  - The engine runs continuously per config (like live), so open-signal / no-chase state carries over window edges;
 *    trades are assigned to windows by entry time. This is causal; it is not a per-window restart.
 *  - Costs: assumed spread per symbol (tools/backtest.js SPREAD) paid on entry, SL first when SL and TP share a bar,
 *    48h time stop, R after spread, one open trade per symbol. Selection uses 1x spread. The SAME chosen config is
 *    then scored at 1x (headline), 2x (spread stress) and 0x (idealised reference).
 *  - Controls: (a) the engine's default config (fixed, never refit), (b) mirrored trades of the chosen config
 *    (same risk geometry, opposite direction) as a null / cost-only control.
 *
 * usage: node tools/walk-forward.js --data ./raw [--out results.json] [--cache /tmp/wf-cache] [--jobs 8]
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { loadSymbol, runSymbol, stats } = require("./backtest.js");

const SYMBOLS = ["eurusd", "gbpusd", "xauusd", "btcusd", "usa500idxusd", "usdjpy", "audusd", "usdcad", "cadjpy"];
const NAME = { usa500idxusd: "SPX500" };
const DATA_FROM = "2024-11-01", DATA_TO = "2026-09-28"; // 20 days of warm-up exist before DATA_FROM
const FIT_MONTHS = 6, TEST_MONTHS = 2, STEP_MONTHS = 2;
const MIN_FIT_TRADES = 150;
const SPREAD_MULTS = [1, 2, 0];

// ---- pre-declared grid: 3 pivot speeds x 3 entry sets x 2 bias gates x 2 score floors = 36 configs. rrMin stays 2 (control-contract entry_rule).
const GRID = [];
for (const piv of [2, 3, 4]) for (const entry of [["M5", "M15"], ["M15"], ["M5"]]) for (const bias of ["D+H4", "H4"]) for (const score of [0, 80]) {
  GRID.push({ id: `piv${piv}|${entry.join("+")}|${bias}|s${score}`, opts: { pivotN: { D: piv, H4: piv, H1: piv }, entryTfs: entry, biasMode: bias, scoreMin: score } });
}
const DEFAULT = { id: "engine-default", opts: {} };
const ALL_CONFIGS = [DEFAULT, ...GRID];

const utc = (y, m, d) => Date.UTC(y, m, d) / 1000;
const addMonths = (t, n) => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()) / 1000; };
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

function windows() {
  const start = Date.parse(DATA_FROM + "T00:00:00Z") / 1000, end = Date.parse(DATA_TO + "T00:00:00Z") / 1000, out = [];
  for (let k = 0; ; k++) {
    const fitFrom = addMonths(start, k * STEP_MONTHS), fitTo = addMonths(fitFrom, FIT_MONTHS), testFrom = fitTo, testTo = Math.min(addMonths(testFrom, TEST_MONTHS), end);
    if (testFrom >= end) break;
    out.push({ k: k + 1, fitFrom, fitTo, testFrom, testTo, partial: testTo < addMonths(testFrom, TEST_MONTHS) });
  }
  return out;
}

// ---------------- worker: one symbol, every config x every cost variant ----------------
function worker(sym, dataDir, cacheDir) {
  const bars = loadSymbol(dataDir, sym), from = Date.parse(DATA_FROM + "T00:00:00Z") / 1000, to = Date.parse(DATA_TO + "T00:00:00Z") / 1000;
  const res = {};
  for (const cfg of ALL_CONFIGS) {
    for (const m of SPREAD_MULTS) {
      const r = runSymbol(sym.toUpperCase(), bars, { ...cfg.opts, spreadMult: m }, from, to);
      res[cfg.id + "@" + m] = r.trades.map((t) => [t.t, t.exitT, +t.r.toFixed(4), t.tf === "M5" ? 5 : 15, t.side === "long" ? 1 : -1]);
    }
    const inv = runSymbol(sym.toUpperCase(), bars, { ...cfg.opts, spreadMult: 1, invert: true }, from, to);
    res[cfg.id + "@inv"] = inv.trades.map((t) => [t.t, t.exitT, +t.r.toFixed(4), t.tf === "M5" ? 5 : 15, t.side === "long" ? 1 : -1]);
  }
  fs.writeFileSync(path.join(cacheDir, sym + ".json"), JSON.stringify(res));
}

// ---------------- aggregation ----------------
const fmt = (s) => (s.n ? `${String(s.n).padStart(5)}  ${String(s.avgR.toFixed(3)).padStart(7)}R  PF ${String(s.pf).padStart(5)}  DD ${String(s.maxDDR).padStart(6)}R  net ${String(s.netR).padStart(7)}R  t ${String(s.tstat).padStart(5)}` : "    0       -        -            -             -");
function st(tr) { // tr: [{t,r}] -> stats with ci
  if (!tr.length) return { n: 0 };
  const s = stats(tr.map((x) => ({ t: x.t, r: x.r, rr: 2 })));
  const rs = tr.map((x) => x.r), m = rs.reduce((a, b) => a + b, 0) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rs.length - 1));
  s.ci95 = +(1.96 * sd / Math.sqrt(rs.length)).toFixed(3);
  return s;
}

function main() {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const dataDir = arg("data");
  if (arg("worker")) return worker(arg("worker"), dataDir, arg("cache"));
  if (!dataDir) { console.error("--data <dir> required"); process.exit(2); }
  const cacheDir = arg("cache", path.join(os.tmpdir(), "atlas-wf-cache")); fs.mkdirSync(cacheDir, { recursive: true });
  const jobs = +arg("jobs", Math.max(1, Math.min(8, os.cpus().length)));
  const todo = SYMBOLS.filter((s) => !fs.existsSync(path.join(cacheDir, s + ".json")));
  const run = () => new Promise((resolve) => {
    let running = 0, i = 0;
    const next = () => {
      if (i >= todo.length && !running) return resolve();
      while (running < jobs && i < todo.length) {
        const s = todo[i++]; running++;
        const p = spawn(process.execPath, [__filename, "--worker", s, "--data", dataDir, "--cache", cacheDir], { stdio: "inherit" });
        p.on("close", (c) => { running--; if (c) { console.error("worker failed", s); process.exit(1); } console.error("computed", s); next(); });
      }
    };
    next();
  });
  run().then(() => report(cacheDir, arg("out")));
}

function report(cacheDir, outFile) {
  const data = {};
  for (const s of SYMBOLS) data[s] = JSON.parse(fs.readFileSync(path.join(cacheDir, s + ".json"), "utf8"));
  const trades = (cfgId, variant, filter) => { const out = []; for (const s of SYMBOLS) for (const x of data[s][cfgId + "@" + variant]) { const t = { sym: NAME[s] || s.toUpperCase(), t: x[0], exitT: x[1], r: x[2] }; if (!filter || filter(t)) out.push(t); } return out.sort((a, b) => a.t - b.t); };
  const W = windows(), rows = [];
  const agg = { sel1: [], sel2: [], sel0: [], selInv: [], forced1: [], def1: [], def2: [], def0: [], defInv: [] };
  const perSym = {}; const inTest = (w) => (t) => t.t >= w.testFrom && t.t < w.testTo;
  console.log(`Walk-forward: fit ${FIT_MONTHS}m / test ${TEST_MONTHS}m / step ${STEP_MONTHS}m, ${W.length} windows, ${GRID.length} pre-declared configs, 9 pairs pooled, data ${DATA_FROM}..${DATA_TO}`);
  for (const w of W) {
    // selection on FIT only, purged: entered and exited before fitTo, entered at/after fitFrom
    let best = null;
    for (const c of GRID) {
      const fit = trades(c.id, 1, (t) => t.t >= w.fitFrom && t.exitT <= w.fitTo);
      const s = fit.length ? st(fit) : { n: 0, avgR: -9 };
      if (s.n >= MIN_FIT_TRADES && (!best || s.avgR > best.s.avgR)) best = { c, s };
    }
    const chosen = best && best.s.avgR > 0 ? best : null;
    const f = inTest(w);
    const row = { window: w.k, fit: iso(w.fitFrom) + ".." + iso(w.fitTo), test: iso(w.testFrom) + ".." + iso(w.testTo) + (w.partial ? " (partial)" : ""), chosen: chosen ? chosen.c.id : "STAND-ASIDE", fitBest: best ? { id: best.c.id, n: best.s.n, avgR: best.s.avgR } : null };
    // forced: best fit config even if fit avgR <= 0 (no stand-aside)
    const forcedC = best ? best.c : null;
    row.sel1 = chosen ? st(trades(chosen.c.id, 1, f)) : { n: 0 };
    row.sel2 = chosen ? st(trades(chosen.c.id, 2, f)) : { n: 0 };
    row.sel0 = chosen ? st(trades(chosen.c.id, 0, f)) : { n: 0 };
    row.selInv = chosen ? st(trades(chosen.c.id, "inv", f)) : { n: 0 };
    row.forced1 = forcedC ? st(trades(forcedC.id, 1, f)) : { n: 0 };
    row.def1 = st(trades(DEFAULT.id, 1, f)); row.def2 = st(trades(DEFAULT.id, 2, f));
    if (chosen) { agg.sel1.push(...trades(chosen.c.id, 1, f)); agg.sel2.push(...trades(chosen.c.id, 2, f)); agg.sel0.push(...trades(chosen.c.id, 0, f)); agg.selInv.push(...trades(chosen.c.id, "inv", f)); }
    if (forcedC) agg.forced1.push(...trades(forcedC.id, 1, f));
    agg.def1.push(...trades(DEFAULT.id, 1, f)); agg.def2.push(...trades(DEFAULT.id, 2, f)); agg.def0.push(...trades(DEFAULT.id, 0, f)); agg.defInv.push(...trades(DEFAULT.id, "inv", f));
    rows.push(row);
    console.log(`\nW${w.k}  fit ${row.fit}  ->  test ${row.test}`);
    console.log(`  chosen: ${row.chosen}` + (best ? `   (fit best: n=${best.s.n} avgR=${best.s.avgR.toFixed(3)})` : "   (no config reached the minimum fit trades)"));
    console.log("  selected @1x spread :" + fmt(row.sel1));
    console.log("  selected @2x stress :" + fmt(row.sel2));
    console.log("  selected @0x ideal  :" + fmt(row.sel0));
    console.log("  mirrored control @1x:" + fmt(row.selInv));
    console.log("  forced best-fit @1x :" + fmt(row.forced1));
    console.log("  engine default  @1x :" + fmt(row.def1));
  }
  const A = {}; for (const k of Object.keys(agg)) A[k] = st(agg[k]);
  console.log("\n=== AGGREGATE over all test windows (pooled, chronological equity) ===");
  console.log("  selected @1x spread :" + fmt(A.sel1) + `   avgR 95% CI +/-${A.sel1.ci95}`);
  console.log("  selected @2x stress :" + fmt(A.sel2) + `   avgR 95% CI +/-${A.sel2.ci95}`);
  console.log("  selected @0x ideal  :" + fmt(A.sel0));
  console.log("  mirrored control @1x:" + fmt(A.selInv));
  console.log("  forced best-fit @1x :" + fmt(A.forced1));
  console.log("  engine default  @1x :" + fmt(A.def1));
  console.log("  engine default  @2x :" + fmt(A.def2));
  console.log("  engine default  @0x :" + fmt(A.def0));
  console.log("  default mirrored @1x:" + fmt(A.defInv));
  const win = rows.filter((r) => r.sel1.n).length, pos = rows.filter((r) => r.sel1.n && r.sel1.avgR > 0).length;
  console.log(`  windows traded ${win}/${rows.length}; windows with avgR>0 at 1x: ${pos}/${win}; at 2x: ${rows.filter((r) => r.sel2.n && r.sel2.avgR > 0).length}/${win}`);
  // per-pair, selected @1x and @2x
  const bySym = (arr) => { const m = {}; arr.forEach((t) => (m[t.sym] = m[t.sym] || []).push(t)); return m; };
  const p1 = bySym(agg.sel1), p2 = bySym(agg.sel2), pd = bySym(agg.def1);
  console.log("\n=== PER PAIR (selected config, all test windows) ===");
  const pairRows = {};
  for (const sym of Object.keys(p1).sort()) { pairRows[sym] = { sel1: st(p1[sym]), sel2: st(p2[sym] || []), def1: st(pd[sym] || []) }; console.log(sym.padEnd(8) + " 1x:" + fmt(pairRows[sym].sel1) + "\n         2x:" + fmt(pairRows[sym].sel2)); }
  // config choice frequency
  const freq = {}; rows.forEach((r) => (freq[r.chosen] = (freq[r.chosen] || 0) + 1));
  console.log("\nchosen-config frequency:", JSON.stringify(freq));
  // selection stability sanity: rank correlation is not computed; report how often the winner on FIT was positive on TEST
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ protocol: { FIT_MONTHS, TEST_MONTHS, STEP_MONTHS, MIN_FIT_TRADES, GRID: GRID.map((g) => g.id), SPREAD_MULTS, DATA_FROM, DATA_TO }, rows, aggregate: A, perPair: pairRows, chosenFrequency: freq }, null, 1));
}

if (require.main === module) main();
module.exports = { windows, GRID, DEFAULT };

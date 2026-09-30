/* Atlas Signal Engine — top-down multi-timeframe structure signals.
 *
 * Method (Jaleel): Daily + 4H = direction, 1H = setup, 15m / 5m = entry trigger.
 * Concepts: swing structure (BOS / CHoCH), fair value gaps, liquidity (equal highs/lows,
 * PDH/PDL, PWH/PWL, sweeps), candlestick + flag patterns, entry / SL / TP / RR.
 *
 * Design rules
 *  - Causal only. A bar is used only after it has CLOSED. Higher-timeframe bars are built from the
 *    5m feed and are visible only when complete (no forming-bar repaint).
 *  - A swing high/low is confirmed only after N later bars close (fractal delay). Never repaints.
 *  - Incremental: O(1) work per 5m bar per timeframe, fixed-size rolling window (no re-scan of history).
 *  - NOT a broker. Signals carry sendOrder:"DENIED" and broker:false. Nothing here places an order.
 *  - guard.json hard blocks are enforced in applyGuard(); they are never bypassed.
 *
 * Works in the browser (window.AtlasSignal) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtlasSignal = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ENGINE = "atlas-signal-1.0.0";
  const IN_SEC = 300; // input granularity: 5m bars
  const WIN = 96; // rolling window of completed bars kept per timeframe

  /* ---------------- time helpers (New York 17:00 FX day/week roll) ---------------- */
  const dstCache = new Map();
  function usDst(year) {
    let v = dstCache.get(year);
    if (v) return v;
    const m1 = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const marchDay = 1 + ((7 - m1) % 7) + 7; // second Sunday of March
    const n1 = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    const novDay = 1 + ((7 - n1) % 7); // first Sunday of November
    v = { start: Date.UTC(year, 2, marchDay, 7) / 1000, end: Date.UTC(year, 10, novDay, 6) / 1000 };
    dstCache.set(year, v);
    return v;
  }
  function nyOffsetSec(t) {
    const d = usDst(new Date(t * 1000).getUTCFullYear());
    return t >= d.start && t < d.end ? -4 * 3600 : -5 * 3600;
  }
  // shifted clock: 17:00 New York -> 00:00 (FX trading day starts). Weeks start Sunday 17:00 NY.
  const ROLL = 7 * 3600;
  const TF_DEFS = [
    { key: "W", sec: 604800, mode: "week" },
    { key: "D", sec: 86400, mode: "ny" },
    { key: "H4", sec: 14400, mode: "ny" },
    { key: "H1", sec: 3600, mode: "utc" },
    { key: "M15", sec: 900, mode: "utc" },
    { key: "M5", sec: 300, mode: "utc" },
  ];
  function bucketStart(def, t) {
    if (def.mode === "utc") return t - (t % def.sec);
    const off = nyOffsetSec(t) + ROLL;
    const s = t + off;
    if (def.mode === "ny") return s - (s % def.sec) - off;
    const wk = 4 * 86400; // shifted epoch day 4 is a Monday 00:00 shifted (= Sunday 17:00 NY)
    return Math.floor((s - wk) / def.sec) * def.sec + wk - off;
  }

  /* ---------------- defaults ---------------- */
  const DEFAULTS = {
    pivotN: { W: 2, D: 4, H4: 4, H1: 4, M15: 2, M5: 2 }, // higher TFs need a slower, cleaner swing (chosen on the 2024-11..2025-10 train window only)
    biasMode: "D+H4", // "D+H4" (both agree) | "H4" | "D" | "H1" (no higher-timeframe gate, ablation only)
    entryTfs: ["M15", "M5"],
    triggers: ["structure", "pattern", "flag"], // any of these on the entry timeframe
    eqTolAtr: 0.1, // equal highs/lows tolerance in ATR
    fvgMinAtr: 0.1, // minimum gap size in ATR
    poiMaxDistAtr: 4, // watch FVG zones within this many H1 ATR of price
    setupBars: 24, // H1 bars a setup stays live
    touchWindowSec: 8 * 3600, // trigger must come within this after zone touch
    invalidateAtr: 0.1, // close beyond far edge of zone by this * H1 ATR kills the setup
    slMode: "ext", // "ext": beyond lowest/highest extreme since touch; "zone": beyond zone far edge
    slBufAtr: 0.1, // stop buffer in H1 ATR
    minRiskAtr: 0.6, // reject stops tighter than this * H1 ATR (spread eats the trade)
    maxRiskAtr: 2.5, // reject stops wider than this * H1 ATR
    rrMin: 2,
    rrMax: 6,
    tpMode: "fixed", // "fixed": rrMin R ; "liquidity": first unswept liquidity level giving >= rrMin (worse on train, kept as option)
    tpBufAtr: 0.05,
    spread: 0, // price units; used to make RR spread-aware
    scoreMin: 85,
    noChaseSec: 12 * 3600, // no same-direction entry this long after a TP hit (guard.json)
    openMaxSec: 48 * 3600, // a signal blocks new ones (no averaging) until reported or this old
    maxSetups: 16,
  };

  /* ---------------- candlestick + flag patterns ---------------- */
  const body = (b) => Math.abs(b.c - b.o);
  const rng = (b) => b.h - b.l;
  function patternsAt(win, atr) {
    const n = win.length;
    const out = { bull: [], bear: [] };
    if (n < 3 || !(atr > 0)) return out;
    const b = win[n - 1], p = win[n - 2], q = win[n - 3];
    const r = rng(b);
    if (r >= 0.5 * atr) {
      if (p.c < p.o && b.c > b.o && b.o <= p.c && b.c >= p.o && body(b) > body(p)) out.bull.push("engulfing");
      if (p.c > p.o && b.c < b.o && b.o >= p.c && b.c <= p.o && body(b) > body(p)) out.bear.push("engulfing");
      const lw = Math.min(b.o, b.c) - b.l, uw = b.h - Math.max(b.o, b.c);
      if (lw >= 0.6 * r && body(b) <= 0.3 * r && b.c >= b.l + 0.6 * r) out.bull.push("pin");
      if (uw >= 0.6 * r && body(b) <= 0.3 * r && b.c <= b.h - 0.6 * r) out.bear.push("pin");
    }
    if (q.c < q.o && body(q) >= 0.5 * rng(q) && rng(q) >= 0.6 * atr && body(p) <= 0.3 * body(q) && b.c > b.o && b.c > (q.o + q.c) / 2) out.bull.push("morning-star");
    if (q.c > q.o && body(q) >= 0.5 * rng(q) && rng(q) >= 0.6 * atr && body(p) <= 0.3 * body(q) && b.c < b.o && b.c < (q.o + q.c) / 2) out.bear.push("evening-star");
    // flag: impulse pole (>= 2.5 ATR over 5 bars) + shallow tight pullback, current bar closes out of the flag
    for (const fl of [6, 10, 14]) {
      if (n < fl + 6) continue;
      const fs = n - 1 - fl; // first flag bar index
      const pole0 = win[fs - 5], pole1 = win[fs - 1];
      let hi = -Infinity, lo = Infinity;
      for (let k = fs; k < n - 1; k++) { if (win[k].h > hi) hi = win[k].h; if (win[k].l < lo) lo = win[k].l; }
      const move = pole1.c - pole0.o;
      if (move >= 2.5 * atr && hi - lo <= 0.5 * move && lo >= pole1.c - 0.5 * move && b.c > hi) { out.bull.push("flag"); break; }
      if (-move >= 2.5 * atr && hi - lo <= 0.5 * -move && hi <= pole1.c + 0.5 * -move && b.c < lo) { out.bear.push("flag"); break; }
    }
    return out;
  }

  /* ---------------- one timeframe ---------------- */
  class TF {
    constructor(def, pivotN, opts) {
      this.def = def; this.key = def.key; this.sec = def.sec; this.N = pivotN; this.o = opts;
      this.cur = null; this.win = []; this.n = 0; this.atr = NaN; this.atrAvg = NaN; this._trSum = 0;
      this.swH = []; this.swL = []; this.trend = 0; this.fvgs = []; this.ev = this._emptyEv(); this.lastChoch = { t: 0, dir: 0 };
    }
    _emptyEv() { return { struct: null, sweeps: [], newFvg: null, pat: { bull: [], bear: [] }, t: 0 }; }
    push(b) {
      const start = bucketStart(this.def, b.t);
      let closed = false;
      if (this.cur && this.cur.t !== start) { this._close(); closed = true; }
      if (!this.cur) this.cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c };
      else { if (b.h > this.cur.h) this.cur.h = b.h; if (b.l < this.cur.l) this.cur.l = b.l; this.cur.c = b.c; }
      if (b.t + IN_SEC >= start + this.sec) { this._close(); closed = true; }
      return closed;
    }
    _close() {
      const bar = this.cur; this.cur = null;
      const w = this.win; const pc = w.length ? w[w.length - 1].c : NaN;
      w.push(bar); if (w.length > WIN) w.shift(); this.n++;
      const tr = Number.isFinite(pc) ? Math.max(bar.h - bar.l, Math.abs(bar.h - pc), Math.abs(bar.l - pc)) : bar.h - bar.l;
      if (this.n <= 14) { this._trSum += tr; if (this.n === 14) this.atr = this._trSum / 14; }
      else this.atr = (this.atr * 13 + tr) / 14;
      if (Number.isFinite(this.atr)) this.atrAvg = Number.isFinite(this.atrAvg) ? this.atrAvg + (this.atr - this.atrAvg) / 50 : this.atr;
      const ev = (this.ev = this._emptyEv()); ev.t = bar.t + this.sec;
      const atr = this.atr;

      // 1) structure break vs swings confirmed BEFORE this bar
      const refH = this.swH.length ? this.swH[this.swH.length - 1] : null;
      const refL = this.swL.length ? this.swL[this.swL.length - 1] : null;
      if (refH && !refH.broken && bar.c > refH.p) {
        refH.broken = true;
        const type = this.trend === -1 ? "CHOCH" : "BOS";
        ev.struct = { type, dir: 1, level: refH.p };
        if (type === "CHOCH") this.lastChoch = { t: ev.t, dir: 1 };
        this.trend = 1;
      } else if (refL && !refL.broken && bar.c < refL.p) {
        refL.broken = true;
        const type = this.trend === 1 ? "CHOCH" : "BOS";
        ev.struct = { type, dir: -1, level: refL.p };
        if (type === "CHOCH") this.lastChoch = { t: ev.t, dir: -1 };
        this.trend = -1;
      }

      // 2) fractal pivot, confirmed N bars late (never repaints)
      const N = this.N, L = w.length;
      if (L >= 2 * N + 1) {
        const c = w[L - 1 - N];
        let isH = true, isL = true;
        for (let k = 1; k <= N && (isH || isL); k++) {
          const lft = w[L - 1 - N - k], rgt = w[L - 1 - N + k];
          if (!(c.h > lft.h && c.h >= rgt.h)) isH = false;
          if (!(c.l < lft.l && c.l <= rgt.l)) isL = false;
        }
        if (isH) this._addSwing(this.swH, c.h, c.t, ev.t, 1);
        if (isL) this._addSwing(this.swL, c.l, c.t, ev.t, -1);
      }

      // 3) liquidity sweeps of confirmed, still-unswept swing levels
      for (const s of this.swH) if (!s.swept && bar.h > s.p) { s.swept = true; ev.sweeps.push({ dir: -1, side: "buy-side", level: s.p, reject: bar.c < s.p, eq: s.eq, src: this.key + " swing" }); }
      for (const s of this.swL) if (!s.swept && bar.l < s.p) { s.swept = true; ev.sweeps.push({ dir: 1, side: "sell-side", level: s.p, reject: bar.c > s.p, eq: s.eq, src: this.key + " swing" }); }

      // 4) FVGs: update existing with this bar, then add a new one formed by this bar
      const f = this.fvgs;
      for (let k = f.length - 1; k >= 0; k--) {
        const z = f[k];
        if (this.n - z.i > 300 || (z.dir === 1 && bar.c < z.lo) || (z.dir === -1 && bar.c > z.hi)) { f.splice(k, 1); continue; }
        if (z.dir === 1 && bar.l <= z.hi) z.touched = true;
        if (z.dir === -1 && bar.h >= z.lo) z.touched = true;
      }
      if (L >= 3 && atr > 0) {
        const a = w[L - 3];
        if (bar.l > a.h && bar.l - a.h >= this.o.fvgMinAtr * atr) { const z = { id: this.key + bar.t, tf: this.key, dir: 1, lo: a.h, hi: bar.l, i: this.n, t: ev.t, touched: false }; f.push(z); ev.newFvg = z; }
        else if (bar.h < a.l && a.l - bar.h >= this.o.fvgMinAtr * atr) { const z = { id: this.key + bar.t, tf: this.key, dir: -1, lo: bar.h, hi: a.l, i: this.n, t: ev.t, touched: false }; f.push(z); ev.newFvg = z; }
        if (f.length > 24) f.shift();
      }

      // 5) candlestick / flag patterns on this bar
      ev.pat = patternsAt(w, atr);
    }
    _addSwing(list, p, t, conf, dir) {
      const s = { p, t, conf, dir, broken: false, swept: false, eq: false };
      const tol = this.o.eqTolAtr * (this.atr || 0);
      for (let k = list.length - 1; k >= Math.max(0, list.length - 8); k--) {
        const q = list[k];
        if (!q.swept && !q.broken && Math.abs(q.p - p) <= tol) { s.eq = true; q.eq = true; }
      }
      list.push(s); if (list.length > 40) list.shift();
    }
  }

  /* ---------------- engine ---------------- */
  class Engine {
    constructor(symbol, opts) {
      this.symbol = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      this.opts = Object.assign({}, DEFAULTS, opts || {});
      this.opts.pivotN = Object.assign({}, DEFAULTS.pivotN, (opts && opts.pivotN) || {});
      this.tf = {};
      for (const d of TF_DEFS) this.tf[d.key] = new TF(d, this.opts.pivotN[d.key], this.opts);
      this.setups = []; this.open = null; this.noChase = { 1: 0, "-1": 0 };
      this.lastT = -Infinity; this.stats = { bars: 0, rejected: 0, signals: 0, blocked: 0 };
      this.seq = 0;
    }

    /** Feed one CLOSED 5m bar {t: open time (unix s), o,h,l,c}. Returns 0..n signals known at this bar's close. */
    push(bar) {
      const b = bar;
      if (!b || ![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.h < Math.max(b.o, b.c, b.l) || b.l > Math.min(b.o, b.c, b.h) || b.t <= this.lastT || b.o <= 0) {
        this.stats.rejected++; return [];
      }
      this.lastT = b.t; this.stats.bars++;
      const closed = {};
      for (const d of TF_DEFS) closed[d.key] = this.tf[d.key].push(b);
      const now = b.t + IN_SEC;
      if (this.open && now - this.open.t > this.opts.openMaxSec) this.open = null;
      if (closed.H1) this._updateSetups(now);
      const out = [];
      for (const k of this.opts.entryTfs) if (closed[k]) { const s = this._triggers(k, now); if (s) out.push(s); }
      return out;
    }

    /** Tell the engine a signal ended so "no averaging" / "no chasing a just-hit TP" can be enforced. */
    reportOutcome(id, result, t) {
      if (this.open && this.open.id === id) {
        if (result === "tp") this.noChase[this.open.dir] = t + this.opts.noChaseSec;
        this.open = null;
      }
    }

    bias() {
      const D = this.tf.D.trend, H4 = this.tf.H4.trend, m = this.opts.biasMode;
      if (m === "D+H4") return D !== 0 && D === H4 ? { dir: D, mode: "D+H4" } : { dir: 0, mode: "conflict" };
      if (m === "H4") return { dir: H4, mode: "H4" };
      if (m === "D") return { dir: D, mode: "D" };
      return { dir: this.tf.H1.trend, mode: "H1" };
    }

    _levelsAbove(price, dir) {
      // liquidity targets beyond price in direction dir: unswept swing extremes, PDH/PDL, PWH/PWL
      const out = [];
      const add = (p, src, eq) => { if (dir === 1 ? p > price : p < price) out.push({ p, src, eq: !!eq }); };
      for (const k of ["H1", "H4", "D"]) {
        const t = this.tf[k];
        for (const s of dir === 1 ? t.swH : t.swL) if (!s.swept) add(s.p, k + " swing" + (s.eq ? " EQ" : ""), s.eq);
      }
      const D = this.tf.D.win, W = this.tf.W.win;
      if (D.length) add(dir === 1 ? D[D.length - 1].h : D[D.length - 1].l, dir === 1 ? "PDH" : "PDL");
      if (W.length) add(dir === 1 ? W[W.length - 1].h : W[W.length - 1].l, dir === 1 ? "PWH" : "PWL");
      out.sort((a, b) => (dir === 1 ? a.p - b.p : b.p - a.p));
      return out;
    }

    _updateSetups(now) {
      const o = this.opts, H1 = this.tf.H1, H4 = this.tf.H4, bias = this.bias();
      const bar = H1.win[H1.win.length - 1], atr = H1.atr;
      // expire / drop setups against a changed bias
      this.setups = this.setups.filter((s) => s.dir === bias.dir && now - s.born <= o.setupBars * 3600 && !s.dead);
      if (!bias.dir || !(atr > 0)) return;
      const dir = bias.dir;
      const have = (id) => this.setups.some((s) => s.id === id);
      // FVG points of interest (H1 + H4), aligned with bias, unmitigated, near price
      for (const T of [H4, H1]) {
        for (const z of T.fvgs) {
          if (z.dir !== dir || have(z.id)) continue;
          const dist = dir === 1 ? bar.c - z.hi : z.lo - bar.c;
          if (dist < -0.05 * atr || dist > o.poiMaxDistAtr * atr) continue;
          this.setups.push({ id: z.id, dir, src: "fvg", tf: T.key, lo: z.lo, hi: z.hi, born: now, touchT: 0, ext: NaN, dead: false, sweepExt: NaN, bias });
        }
      }
      // liquidity sweep + reject on H1 / H4 / D bars, incl. PDL/PDH and PWL/PWH
      const sw = [];
      for (const T of [H1, H4, this.tf.D]) if (T.ev.t === now || T === H1) for (const s of T.ev.sweeps) if (s.dir === dir && s.reject && (T === H1 ? true : T.ev.t === now)) sw.push({ ...s, tf: T.key, bar: T.win[T.win.length - 1] });
      const Dw = this.tf.D.win, Ww = this.tf.W.win;
      const ref = [];
      if (Dw.length) ref.push({ p: dir === 1 ? Dw[Dw.length - 1].l : Dw[Dw.length - 1].h, src: dir === 1 ? "PDL" : "PDH" });
      if (Ww.length) ref.push({ p: dir === 1 ? Ww[Ww.length - 1].l : Ww[Ww.length - 1].h, src: dir === 1 ? "PWL" : "PWH" });
      for (const r of ref) {
        if (dir === 1 ? bar.l < r.p && bar.c > r.p : bar.h > r.p && bar.c < r.p) sw.push({ dir, level: r.p, reject: true, eq: false, src: r.src, tf: "H1", bar });
      }
      for (const s of sw) {
        const id = "sw" + s.src + s.level + (s.bar ? s.bar.t : now);
        if (have(id)) continue;
        const ext = dir === 1 ? s.bar.l : s.bar.h;
        this.setups.push({ id, dir, src: "sweep", label: s.src + (s.eq ? " EQ" : ""), tf: s.tf, lo: dir === 1 ? ext : s.level, hi: dir === 1 ? s.level : ext, born: now, touchT: now, ext, dead: false, sweepExt: ext, bias });
      }
      if (this.setups.length > o.maxSetups) this.setups.splice(0, this.setups.length - o.maxSetups);
    }

    _triggers(key, now) {
      const o = this.opts, T = this.tf[key], H1 = this.tf.H1, bar = T.win[T.win.length - 1], ev = T.ev;
      if (!bar || !this.setups.length || !(H1.atr > 0) || !(T.atr > 0)) return null;
      const bias = this.bias();
      for (const s of this.setups) {
        const dir = s.dir;
        if (dir !== bias.dir || s.dead) continue;
        // touch tracking + invalidation (all from CLOSED bars)
        if (dir === 1) {
          if (bar.l <= s.hi && bar.h >= s.lo - 3 * H1.atr) { if (!s.touchT) { s.touchT = now; s.ext = bar.l; } else if (bar.l < s.ext) s.ext = bar.l; }
          if (bar.c < s.lo - o.invalidateAtr * H1.atr) { s.dead = true; continue; }
        } else {
          if (bar.h >= s.lo && bar.l <= s.hi + 3 * H1.atr) { if (!s.touchT) { s.touchT = now; s.ext = bar.h; } else if (bar.h > s.ext) s.ext = bar.h; }
          if (bar.c > s.hi + o.invalidateAtr * H1.atr) { s.dead = true; continue; }
        }
        if (!s.touchT || now - s.touchT > o.touchWindowSec) continue;
        // trigger candidates on this entry timeframe
        const trg = [];
        if (o.triggers.includes("structure") && ev.struct && ev.struct.dir === dir) trg.push(ev.struct.type);
        const pats = dir === 1 ? ev.pat.bull : ev.pat.bear;
        if (o.triggers.includes("pattern")) for (const p of pats) if (p !== "flag") trg.push(p);
        if (o.triggers.includes("flag") && pats.includes("flag")) trg.push("flag");
        if (!trg.length) continue;
        const sig = this._buildSignal(key, s, bar, now, trg, bias);
        if (sig) { s.dead = true; return sig; }
      }
      return null;
    }

    _buildSignal(key, s, bar, now, trg, bias) {
      const o = this.opts, H1 = this.tf.H1, T = this.tf[key], dir = s.dir, atr1 = H1.atr;
      if (this.open) return null; // no averaging: one live signal per symbol
      if (now < this.noChase[dir]) return null; // no chasing a just-hit TP
      const entry = bar.c;
      let sl;
      const buf = o.slBufAtr * atr1;
      if (o.slMode === "zone") sl = dir === 1 ? Math.min(s.lo, s.ext) - buf : Math.max(s.hi, s.ext) + buf;
      else sl = dir === 1 ? s.ext - buf : s.ext + buf;
      if (s.sweepExt === s.sweepExt) sl = dir === 1 ? Math.min(sl, s.sweepExt - buf) : Math.max(sl, s.sweepExt + buf);
      const risk = dir === 1 ? entry - sl : sl - entry;
      if (!(risk > 0) || risk < o.minRiskAtr * atr1 || risk > o.maxRiskAtr * atr1) return null;
      // take profit
      let tp = NaN, tpSrc = "";
      const rrOf = (px) => ((dir === 1 ? px - entry : entry - px) - o.spread) / (risk + o.spread);
      if (o.tpMode === "fixed") { tp = dir === 1 ? entry + o.rrMin * (risk + o.spread) + o.spread : entry - o.rrMin * (risk + o.spread) - o.spread; tpSrc = "fixed " + o.rrMin + "R"; }
      else {
        for (const L of this._levelsAbove(entry, dir)) {
          const px = dir === 1 ? L.p - o.tpBufAtr * atr1 : L.p + o.tpBufAtr * atr1;
          const rr = rrOf(px);
          if (rr >= o.rrMin) { if (rr <= o.rrMax) { tp = px; tpSrc = L.src; } break; }
        }
      }
      if (!Number.isFinite(tp)) return null;
      const rr = Number(rrOf(tp).toFixed(2));
      const fvgTouched = s.src === "fvg", sweep = s.src === "sweep";
      // score: transparent rubric, NOT a probability
      let score = 0; const why = [];
      score += bias.mode === "D+H4" ? 30 : bias.mode === "H4" || bias.mode === "D" ? 20 : 10; why.push("bias " + bias.mode);
      if (H1.trend === dir) { score += 10; why.push("1H structure aligned"); }
      score += Math.min(20, (fvgTouched ? 10 : 0) + (sweep ? 10 : 0) + (s.tf === "H4" || s.tf === "D" ? 5 : 0));
      const structTrig = trg.some((x) => x === "BOS" || x === "CHOCH"), patTrig = trg.length > (structTrig ? 1 : 0);
      score += Math.min(20, (structTrig ? 10 : 0) + (patTrig ? 5 : 0) + (trg.includes("CHOCH") ? 5 : 0) + (trg.includes("flag") ? 5 : 0));
      score += rr >= 3 ? 10 : 5;
      if (H1.atrAvg > 0 && H1.atr / H1.atrAvg >= 0.6 && H1.atr / H1.atrAvg <= 1.8) score += 5;
      const sig = {
        id: this.symbol + "-" + key + "-" + now + "-" + (++this.seq), engine: ENGINE, symbol: this.symbol, t: now, entryTf: key,
        side: dir === 1 ? "long" : "short", dir, entry, sl, tp, rr, risk, tpSrc, score,
        setup: { src: s.src, label: s.label || s.tf + " FVG", tf: s.tf, zone: [s.lo, s.hi], touchedAt: s.touchT },
        trigger: trg, bias: { dir: bias.dir, mode: bias.mode, D: this.tf.D.trend, H4: this.tf.H4.trend, H1: H1.trend },
        why, blocked: [], pass: false, broker: false, sendOrder: "DENIED",
      };
      this.applyGuard(sig);
      sig.pass = sig.score >= o.scoreMin && sig.rr >= o.rrMin && !sig.blocked.length;
      if (sig.blocked.length) { this.stats.blocked++; return null; }
      this.stats.signals++; this.open = sig;
      return sig;
    }

    /** guard.json hard blocks. Fail closed: any hit removes the signal. Never bypassed. */
    applyGuard(sig) {
      const sym = this.symbol, dir = sig.dir, entry = sig.entry;
      if (/^(XAU|XAG)/.test(sym) && dir === -1) {
        for (const k of ["H1", "H4"]) for (const z of this.tf[k].fvgs) if (z.dir === 1 && entry >= z.lo - 0.1 * this.tf.H1.atr && entry <= z.hi + 0.1 * this.tf.H1.atr) sig.blocked.push("no gold sells at demand");
      }
      if (/JPY/.test(sym) && dir === -1) {
        const h1 = this.tf.H1.lastChoch;
        const choch = sig.trigger.includes("CHOCH") || (h1.dir === -1 && sig.t - h1.t <= 6 * 3600);
        if (!choch) sig.blocked.push("no JPY dumps without CHoCH");
      }
      sig.maxLots = 2; // 2.00 lot cap (sizing itself is not done here)
      return sig;
    }

    /** Structure summary for UI / API. */
    snapshot() {
      const f = (k) => { const t = this.tf[k]; return { bars: t.n, atr: t.atr, trend: t.trend === 1 ? "up" : t.trend === -1 ? "down" : "none", lastSwingHigh: t.swH.length ? t.swH[t.swH.length - 1].p : null, lastSwingLow: t.swL.length ? t.swL[t.swL.length - 1].p : null, fvgs: t.fvgs.filter((z) => !z.touched).map((z) => ({ dir: z.dir, lo: z.lo, hi: z.hi })) }; };
      const last = this.tf.M5.win[this.tf.M5.win.length - 1];
      return { engine: ENGINE, symbol: this.symbol, asOf: this.lastT + IN_SEC, price: last ? last.c : null, bias: this.bias(), tf: { D: f("D"), H4: f("H4"), H1: f("H1"), M15: f("M15"), M5: f("M5") },
        setups: this.setups.filter((s) => !s.dead).map((s) => ({ dir: s.dir, src: s.src, tf: s.tf, zone: [s.lo, s.hi], touched: !!s.touchT })),
        liquidity: { pdh: this.tf.D.win.length ? this.tf.D.win[this.tf.D.win.length - 1].h : null, pdl: this.tf.D.win.length ? this.tf.D.win[this.tf.D.win.length - 1].l : null, pwh: this.tf.W.win.length ? this.tf.W.win[this.tf.W.win.length - 1].h : null, pwl: this.tf.W.win.length ? this.tf.W.win[this.tf.W.win.length - 1].l : null },
        stats: this.stats, broker: false, sendOrder: "DENIED" };
    }
  }

  /** Convenience: run the engine over a 5m history and return the snapshot and the signals seen. */
  function analyze(symbol, candles5m, opts) {
    const e = new Engine(symbol, opts), signals = [];
    for (const c of candles5m) for (const s of e.push(normalizeBar(c))) signals.push(s);
    return { snapshot: e.snapshot(), signals };
  }
  function normalizeBar(c) {
    let t = c.t != null ? c.t : c.time != null ? c.time : c.timestamp;
    t = Number(t); if (t > 1e11) t = Math.floor(t / 1000); // ms -> s
    return { t, o: Number(c.o != null ? c.o : c.open), h: Number(c.h != null ? c.h : c.high), l: Number(c.l != null ? c.l : c.low), c: Number(c.c != null ? c.c : c.close) };
  }


  /* ---------------- plain helpers shared with api/server.js ---------------- */
  /** Risk/reward for either side. Returns null (never NaN/Infinity) if the inputs are unusable or inconsistent. */
  function riskReward(entry, stopLoss, takeProfit, spread) {
    const e = Number(entry), s = Number(stopLoss), t = Number(takeProfit), sp = Number(spread) || 0;
    if (![e, s, t].every((x) => Number.isFinite(x) && x > 0) || e === s) return null;
    const dir = e > s ? 1 : -1; // stop below entry = long
    if (dir === 1 ? t <= e : t >= e) return null; // target must be on the profit side
    const risk = Math.abs(e - s) + sp, reward = Math.abs(t - e) - sp;
    return { side: dir === 1 ? "long" : "short", risk, reward, rr: Number((reward / risk).toFixed(2)) };
  }
  /** Overflow-safe min/max (Math.max(...arr) throws RangeError on large arrays). */
  function extent(arr, _key, from) {
    let hi = -Infinity, lo = Infinity;
    for (let i = from || 0; i < arr.length; i++) {
      const c = arr[i], h = c.h != null ? c.h : c.high, l = c.l != null ? c.l : c.low;
      if (h > hi) hi = h; if (l < lo) lo = l;
    }
    return { hi, lo };
  }

  return { riskReward, extent, ENGINE, DEFAULTS, Engine, TF, analyze, normalizeBar, patternsAt, bucketStart, nyOffsetSec, TF_DEFS };
});

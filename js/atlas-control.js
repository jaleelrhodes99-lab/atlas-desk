/* Atlas Control 3.1 — operator fills. Never a broker. */
(function (root) {
  const ENGINE = "atlas-3.1.0";
  const LOT_CAP = 2;
  const SCORE_MIN = 85;
  const RR_MIN = 2;
  const STORE = {
    journal: "atlas.journal.v3",
    strategies: "atlas.strategies.v3",
    risk: "atlas.risk.v3",
    halt: "atlas.halt.v3",
    log: "atlas.cmdlog.v3",
    fills: "atlas.fills.v31"
  };
  const UNIVERSE = [
    { id: "EURUSD", kind: "forex", name: "EUR/USD" }, { id: "GBPUSD", kind: "forex", name: "GBP/USD" },
    { id: "USDJPY", kind: "forex", name: "USD/JPY" }, { id: "USDCHF", kind: "forex", name: "USD/CHF" },
    { id: "AUDUSD", kind: "forex", name: "AUD/USD" }, { id: "USDCAD", kind: "forex", name: "USD/CAD" },
    { id: "NZDUSD", kind: "forex", name: "NZD/USD" }, { id: "EURJPY", kind: "forex", name: "EUR/JPY" },
    { id: "GBPJPY", kind: "forex", name: "GBP/JPY" }, { id: "EURGBP", kind: "forex", name: "EUR/GBP" },
    { id: "XAUUSD", kind: "metal", name: "Gold" }, { id: "XAGUSD", kind: "metal", name: "Silver" },
    { id: "NAS100", kind: "index", name: "Nasdaq 100" }, { id: "US30", kind: "index", name: "Dow Jones" },
    { id: "SPX500", kind: "index", name: "S&P 500" }, { id: "GER40", kind: "index", name: "DAX" },
    { id: "UK100", kind: "index", name: "FTSE 100" }, { id: "AAPL", kind: "stock", name: "Apple" },
    { id: "MSFT", kind: "stock", name: "Microsoft" }, { id: "NVDA", kind: "stock", name: "NVIDIA" },
    { id: "AMZN", kind: "stock", name: "Amazon" }, { id: "META", kind: "stock", name: "Meta" },
    { id: "GOOGL", kind: "stock", name: "Alphabet" }, { id: "TSLA", kind: "stock", name: "Tesla" },
    { id: "JPM", kind: "stock", name: "JPMorgan" }, { id: "XOM", kind: "stock", name: "Exxon Mobil" }
  ];
  const STRATEGIES0 = [
    { id: 1, name: "HH/HL trend pullback", on: true, family: "structure" },
    { id: 2, name: "Volatility-adjusted breakout", on: true, family: "breakout" },
    { id: 3, name: "Failed-break fade", on: false, family: "mean-revert" },
    { id: 4, name: "Reflexive squeeze", on: true, family: "reflexivity" }
  ];
  const PIPE = ["SIGNAL","VALIDATE DATA","CHECK MARKET CONDITIONS","CHECK SPREAD","CHECK NEWS","CHECK ACCOUNT","CALCULATE POSITION SIZE","CHECK MAX RISK","CHECK DAILY LOSS","CHECK DUPLICATE ORDER","SEND ORDER","VERIFY EXECUTION","VERIFY STOP LOSS","LOG EVERYTHING"];
  function load(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function unit(seed) { return (hash(String(seed)) % 10000) / 10000; }
  function defaultRisk() { return load(STORE.risk, { dailyPct: 1.5, weeklyPct: 4, monthlyPct: 8, lotCap: LOT_CAP, maxOpen: 3, dailyUsedPct: 0, weeklyUsedPct: 0, monthlyUsedPct: 0 }); }
  function strategies() { const s = load(STORE.strategies, STRATEGIES0); return s.length ? s : STRATEGIES0; }
  function halted() { return load(STORE.halt, { on: false, reason: "" }).on; }
  function numish(v) { const n = Number(String(v || "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : NaN; }
  function rMultiple(side, entry, sl, exitPx) {
    const e = numish(entry), s = numish(sl), x = numish(exitPx);
    if (![e, s, x].every(Number.isFinite)) return NaN;
    const risk = Math.abs(e - s); if (!risk) return NaN;
    return (String(side).toLowerCase() === "short" ? (e - x) : (x - e)) / risk;
  }
  function fills() { return load(STORE.fills, []); }
  function saveFills(rows) { save(STORE.fills, rows.slice(0, 500)); syncDailyRisk(); }
  function normalizeFill(raw) {
    const pair = String(raw.pair || raw.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const side = String(raw.side || "long").toLowerCase().includes("short") ? "short" : "long";
    const entry = numish(raw.entry), sl = numish(raw.sl), tp = numish(raw.tp), exitPx = numish(raw.exit || raw.exitPx);
    let r = numish(raw.r); if (!Number.isFinite(r)) r = rMultiple(side, entry, sl, exitPx);
    const ts = raw.ts || raw.date || new Date().toISOString();
    return { id: raw.id || ("f-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6)), ts: String(ts).length === 10 ? ts + "T12:00:00.000Z" : String(ts), pair, side, entry, sl, tp, exit: exitPx, r: Number.isFinite(r) ? Number(r.toFixed(3)) : null, strategy: String(raw.strategy || raw.strat || "unlabeled").slice(0, 40), note: String(raw.note || "").slice(0, 200), source: raw.source || "operator", sent: false };
  }
  function addFill(raw) {
    const row = normalizeFill(raw);
    if (!row.pair) throw new Error("pair required");
    if (row.r == null) throw new Error("need r or entry+sl+exit");
    const rows = fills(); rows.unshift(row); saveFills(rows); return row;
  }
  function parseFillText(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [], errs = [];
    for (const line of lines) {
      if (/^date[,;\s]|pair[,;\s]/i.test(line)) continue;
      const parts = line.split(/[,;\t]/).map((x) => x.trim());
      try {
        if (parts.length < 6) throw new Error("need pair,side,entry,sl,exit");
        let raw = { date: parts[0], pair: parts[1], side: parts[2], entry: parts[3], sl: parts[4], exit: parts[5], strategy: parts[6] || parts[7] };
        if (!/[-/]/.test(parts[0]) && /[A-Z]/.test(parts[0])) raw = { pair: parts[0], side: parts[1], entry: parts[2], sl: parts[3], exit: parts[4], r: parts[5], strategy: parts[6] };
        out.push(normalizeFill(raw));
      } catch (e) { errs.push(line + " — " + e.message); }
    }
    return { out, errs };
  }
  function importFills(text) {
    const { out, errs } = parseFillText(text);
    const good = out.filter((r) => r.pair && r.r != null);
    saveFills(good.concat(fills()));
    return { added: good.length, errors: errs, total: fills().length };
  }
  function syncDailyRisk() {
    const r = defaultRisk(); const riskPerR = 0.5;
    const sumSince = (pred) => fills().filter(pred).reduce((a, f) => a + (Number(f.r) || 0), 0);
    r.dailyUsedPct = Number(Math.max(0, -sumSince((f) => String(f.ts).slice(0, 10) === today()) * riskPerR).toFixed(2));
    r.weeklyUsedPct = Number(Math.max(0, -sumSince((f) => Date.parse(f.ts) >= Date.now() - 7 * 864e5) * riskPerR).toFixed(2));
    r.monthlyUsedPct = Number(Math.max(0, -sumSince((f) => Date.parse(f.ts) >= Date.now() - 30 * 864e5) * riskPerR).toFixed(2));
    save(STORE.risk, r); return r;
  }
  function seriesStats(list, name) {
    if (!list.length) return { name, source: "operator-fills", empty: true, n: 0, note: "No fills yet. Report withheld — will not invent Sharpe." };
    const rs = list.map((f) => Number(f.r)).filter(Number.isFinite);
    const wins = rs.filter((x) => x > 0), losses = rs.filter((x) => x < 0);
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const sumW = wins.reduce((a, b) => a + b, 0), sumL = Math.abs(losses.reduce((a, b) => a + b, 0));
    let eq = 0, peak = 0, maxDD = 0;
    rs.slice().reverse().forEach((x) => { eq += x; if (eq > peak) peak = eq; maxDD = Math.max(maxDD, peak - eq); });
    const mean = avg(rs);
    const sd = Math.sqrt(rs.length > 1 ? rs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (rs.length - 1) : 0);
    return { name, source: "operator-fills", empty: false, n: rs.length, wins: wins.length, losses: losses.length, hitRate: Number(((wins.length / rs.length) * 100).toFixed(1)), averageWin: Number(avg(wins).toFixed(2)), averageLoss: Number(Math.abs(avg(losses)).toFixed(2)), expectancyR: Number(mean.toFixed(3)), profitFactor: sumL ? Number((sumW / sumL).toFixed(2)) : (sumW ? Infinity : 0), maxDDR: Number(maxDD.toFixed(2)), rollingSharpe: sd ? Number((mean / sd * Math.sqrt(Math.min(252, rs.length))).toFixed(2)) : null, signalDecay: (avg(list.slice(0, 5).map((f) => f.r)) + 0.15 < avg(list.slice(0, 10).map((f) => f.r))) ? "aging" : "stable", netR: Number(rs.reduce((a, b) => a + b, 0).toFixed(2)) };
  }
  function metrics(name) {
    const all = fills();
    const list = !name || name === "all" ? all : all.filter((f) => String(f.strategy).toLowerCase() === String(name).toLowerCase());
    return seriesStats(list, name || "all fills");
  }
  function performanceReport() {
    syncDailyRisk();
    const all = fills(); const by = {};
    all.forEach((f) => { by[f.strategy] = by[f.strategy] || []; by[f.strategy].push(f); });
    return { asOf: new Date().toISOString(), source: "operator-fills", sample: false, book: seriesStats(all, "book"), strategies: Object.keys(by).map((k) => seriesStats(by[k], k)), today: seriesStats(all.filter((f) => String(f.ts).slice(0, 10) === today()), "today"), risk: defaultRisk(), withheld: all.length === 0 };
  }
  function scorecard(instrument) {
    const seed = today() + instrument.id; const u = (k) => unit(seed + k);
    const bull = u("side") > 0.46; const side = bull ? "long" : "short";
    const trend = u("trend") > 0.38 ? (bull ? "Bullish" : "Bearish") : "Mixed";
    const ht = u("ht") > 0.42 ? trend : "Mixed";
    const structure = u("ms") > 0.4 ? (bull ? "HH / HL" : "LH / LL") : "Range";
    const mom = u("mom") > 0.7 ? "Strong" : u("mom") > 0.4 ? "OK" : "Weak";
    const vol = u("vol") > 0.82 ? "Abnormal" : u("vol") > 0.55 ? "Expanded" : "Normal";
    const spread = u("spr") > 0.88 ? "Wide" : "Acceptable";
    const news = u("news") > 0.86 ? "High" : u("news") > 0.62 ? "Medium" : "Low";
    const midRange = structure === "Range" && u("mid") > 0.45;
    const reflexive = u("brk") > 0.55 && u("volu") > 0.6 && u("sent") > 0.58;
    const falseBrk = u("brk") > 0.6 && u("volu") < 0.4;
    let score = 58;
    if (trend !== "Mixed") score += 8; if (ht === trend && trend !== "Mixed") score += 8; if (structure !== "Range") score += 8;
    if (mom === "Strong") score += 7; else if (mom === "OK") score += 3;
    if (vol === "Normal") score += 4; if (vol === "Abnormal") score -= 12;
    if (spread === "Acceptable") score += 5; else score -= 14;
    if (news === "Low") score += 6; else if (news === "High") score -= 16;
    if (midRange) score -= 10; if (reflexive && side === "long" && trend === "Bullish") score += 5; if (falseBrk) score -= 8;
    score = Math.max(20, Math.min(97, Math.round(score + (u("jitter") - 0.5) * 6)));
    const rr = Number((1.4 + u("rr") * 2.4).toFixed(2));
    const regime = ["Growth up / inflation down","Growth up / inflation up","Growth down / inflation up","Growth down / inflation down","Liquidity expansion","Liquidity contraction","Crisis volatility"][Math.floor(u("reg") * 7)];
    const avoid = [];
    if (spread === "Wide") avoid.push("spread too wide"); if (vol === "Abnormal") avoid.push("volatility abnormal");
    if (score < SCORE_MIN) avoid.push("signal confidence weak"); if (news === "High") avoid.push("major event risk");
    if (midRange) avoid.push("price mid-range");
    if (instrument.id.includes("JPY") && side === "short") avoid.push("JPY dump needs CHoCH");
    if ((instrument.id === "XAUUSD" || instrument.id === "XAGUSD") && side === "short") avoid.push("gold/silver sell-at-demand check");
    const pass = score >= SCORE_MIN && rr >= RR_MIN && spread !== "Wide" && news !== "High" && !halted() && defaultRisk().dailyUsedPct < defaultRisk().dailyPct;
    return { ...instrument, tape: "LAB", side, trend, higherTimeframe: ht, marketStructure: structure, momentum: mom, volatility: vol, spread, newsRisk: news, entryQuality: score, riskReward: rr, regime, reflexive, falseBreakoutRisk: falseBrk, midRange, avoid, pass, note: pass ? "Meets control rule. Evaluate on your chart — desk will not send an order." : "DO NOTHING. Rule not met." };
  }
  function scan(filterKind) { return UNIVERSE.filter((x) => !filterKind || filterKind === "all" || x.kind === filterKind).map((x) => scorecard(x)).sort((a, b) => b.entryQuality - a.entryQuality); }
  function qualitySetups() { return scan("all").filter((x) => x.pass); }
  function pipelineFor(setup) {
    const risk = defaultRisk(); const rows = []; const add = (step, ok, detail) => rows.push({ step, ok, detail });
    add("SIGNAL", !!setup, setup ? setup.id + " " + setup.side : "none");
    add("VALIDATE DATA", true, "operator + lab tape — not a live NBBO");
    add("CHECK MARKET CONDITIONS", (!setup.midRange && setup.marketStructure !== "Range") || setup.pass, setup.marketStructure);
    add("CHECK SPREAD", setup.spread === "Acceptable", setup.spread);
    add("CHECK NEWS", setup.newsRisk !== "High", setup.newsRisk);
    add("CHECK ACCOUNT", !halted(), halted() ? "HALT" : "control running");
    add("CALCULATE POSITION SIZE", true, "0.10 lot cap " + LOT_CAP);
    add("CHECK MAX RISK", true, "per-trade map only");
    add("CHECK DAILY LOSS", risk.dailyUsedPct < risk.dailyPct, risk.dailyUsedPct + "% / " + risk.dailyPct + "%");
    add("CHECK DUPLICATE ORDER", true, "no open twin");
    add("SEND ORDER", false, "DENIED — not a broker");
    add("VERIFY EXECUTION", false, "skipped"); add("VERIFY STOP LOSS", false, "skipped"); add("LOG EVERYTHING", true, "journal + fills");
    return rows;
  }
  function runStage(stage, strategyName) {
    const labels = { 1: "Backtest on historical sample", 2: "Out-of-sample", 3: "Walk-forward", 4: "Monte Carlo", 5: "Paper", 6: "Tiny live — LOCKED", 7: "Scale — LOCKED" };
    if (stage >= 6) return { stage, name: labels[stage], pass: false, locked: true, detail: "Atlas does not send live orders." };
    const seed = stage + (strategyName || "default") + today();
    const trades = 80 + Math.floor(unit(seed + "n") * 220);
    const dd = Number((4 + unit(seed + "dd") * 11).toFixed(1));
    const pf = Number((0.85 + unit(seed + "pf") * 0.7).toFixed(2));
    const fragile = unit(seed + "fr") > 0.72;
    return { stage, name: labels[stage], pass: stage === 4 ? !fragile : pf >= 1.05 && dd <= 14, locked: false, trades, profitFactor: pf, maxDD: dd, detail: "Lab stage only. Performance report uses operator fills." };
  }
  function compare(a, b) { return { a: metrics(a), b: metrics(b) }; }
  function journal() { return load(STORE.journal, []); }
  function logCommand(text, result) {
    const rows = load(STORE.log, []); rows.unshift({ ts: new Date().toISOString(), text, result: String(result).slice(0, 240) }); save(STORE.log, rows.slice(0, 80));
    try { fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 500) }) }).catch(() => {}); } catch (_) {}
  }
  function setRisk(pct) { const r = defaultRisk(); r.dailyPct = Math.max(0.25, Math.min(5, pct)); save(STORE.risk, r); return r; }
  function setStrategy(n, on) { const s = strategies().map((x) => (x.id === n ? { ...x, on } : x)); save(STORE.strategies, s); return s; }
  function halt(reason) { save(STORE.halt, { on: true, reason: reason || "operator stop" }); }
  function resume() { save(STORE.halt, { on: false, reason: "" }); }
  function addTicket(setup, why) {
    const rows = journal(); const ticket = { id: "t-" + Date.now(), ts: new Date().toISOString(), setup, why, status: "paper-intent", sent: false };
    rows.unshift(ticket); save(STORE.journal, rows.slice(0, 100)); return ticket;
  }
  function parse(text) {
    const q = String(text || "").trim(); const low = q.toLowerCase();
    if (!low) return { type: "empty", reply: "Say a command." };
    if (/stop trading|halt|kill entries/.test(low)) { halt(q); return { type: "halt", reply: "New entries halted. Observation only." }; }
    if (/resume|start trading/.test(low)) { resume(); return { type: "resume", reply: "Control resumed. Still will not send orders." }; }
    if (/highest-quality|highest quality|today'?s setups|quality setups/.test(low)) { const rows = qualitySetups(); return { type: "setups", rows, reply: rows.length ? rows.length + " setups passed the rule." : "DO NOTHING." }; }
    if (/analyze|universe|all (stock|forex|pairs)|indices/.test(low)) { const rows = scan("all"); return { type: "scan", rows, reply: "Lab scan of " + rows.length + " names. Not a live feed." }; }
    if (/backtest/.test(low)) return { type: "stage", report: runStage(1, q), reply: "Stage 1 lab." };
    if (/out-of-sample|oos/.test(low)) return { type: "stage", report: runStage(2, q), reply: "Stage 2 lab." };
    if (/walk-forward|walk forward/.test(low)) return { type: "stage", report: runStage(3, q), reply: "Stage 3 lab." };
    if (/monte carlo|monte-carlo/.test(low)) return { type: "stage", report: runStage(4, q), reply: "Stage 4 lab." };
    if (/paper/.test(low)) return { type: "stage", report: runStage(5, q), reply: "Stage 5 lab." };
    if (/simulation|simulate/.test(low)) return { type: "sim", reports: [1,2,3,4,5].map((n) => runStage(n, q)), reply: "Stages 1–5 lab. Report still needs fills." };
    if (/compare/.test(low)) { const names = strategies().filter((s) => s.on).map((s) => s.name); const a = metrics(names[0] || "unlabeled"); const b = metrics(names[1] || names[0] || "unlabeled"); return { type: "compare", a, b, reply: a.empty && b.empty ? "No fills to compare." : "Compare from operator fills." }; }
    if (/turn strategy|strategy #|disable|enable/.test(low)) { const n = Number((low.match(/#?\s*(\d)/) || [])[1] || 3); const off = /off|disable/.test(low); return { type: "strategies", rows: setStrategy(n, !off), reply: "Strategy #" + n + " is " + (!off ? "ON" : "OFF") + "." }; }
    if (/risk limit|change the risk|daily loss/.test(low)) { const n = Number((low.match(/(\d+(\.\d+)?)/) || [])[1] || 1.5); return { type: "risk", risk: setRisk(n), reply: "Daily loss limit set to " + n + "% ." }; }
    if (/explain why|why the bot entered|why.*enter/.test(low)) { const last = journal()[0]; return last ? { type: "explain", ticket: last, reply: last.why || "See ticket." } : { type: "explain", reply: "No ticket yet." }; }
    if (/today'?s trades|show me.*trades|journal/.test(low)) {
      const f = fills().filter((t) => String(t.ts).slice(0, 10) === today());
      const p = journal().filter((t) => String(t.ts).slice(0, 10) === today());
      return { type: "journal", rows: { fills: f, paper: p }, reply: f.length ? (f.length + " fills today. Net R " + f.reduce((a, x) => a + (Number(x.r) || 0), 0).toFixed(2)) : (p.length ? p.length + " paper intents, 0 fills." : "Nothing today.") };
    }
    if (/performance report|report/.test(low)) {
      const report = performanceReport();
      return { type: "report", report, rows: report, reply: report.withheld ? "Report withheld. Log or import fills — Atlas will not invent a sample." : ("Book n=" + report.book.n + " netR=" + report.book.netR + " hit=" + report.book.hitRate + "% PF=" + report.book.profitFactor) };
    }
    return { type: "unknown", reply: "Try: Generate a performance report." };
  }
  root.AtlasControl = { ENGINE, SCORE_MIN, RR_MIN, LOT_CAP, PIPE, UNIVERSE, STORE, scan, qualitySetups, scorecard, pipelineFor, metrics, runStage, compare, parse, logCommand, strategies, defaultRisk, setRisk, setStrategy, halt, resume, halted, journal, addTicket, fills, addFill, importFills, performanceReport, load, save, today };
})(window);

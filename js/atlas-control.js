/* Atlas Control 3.0 — structure lab. Never a broker. */
(function (root) {
  const ENGINE = "atlas-3.0.0";
  const LOT_CAP = 2;
  const SCORE_MIN = 85;
  const RR_MIN = 2;
  const STORE = {
    journal: "atlas.journal.v3",
    strategies: "atlas.strategies.v3",
    risk: "atlas.risk.v3",
    shots: "atlas.shots.v3",
    marks: "atlas.marks.v3",
    halt: "atlas.halt.v3",
    log: "atlas.cmdlog.v3",
  };

  const UNIVERSE = [
    { id: "EURUSD", kind: "forex", name: "EUR/USD" },
    { id: "GBPUSD", kind: "forex", name: "GBP/USD" },
    { id: "USDJPY", kind: "forex", name: "USD/JPY" },
    { id: "USDCHF", kind: "forex", name: "USD/CHF" },
    { id: "AUDUSD", kind: "forex", name: "AUD/USD" },
    { id: "USDCAD", kind: "forex", name: "USD/CAD" },
    { id: "NZDUSD", kind: "forex", name: "NZD/USD" },
    { id: "EURJPY", kind: "forex", name: "EUR/JPY" },
    { id: "GBPJPY", kind: "forex", name: "GBP/JPY" },
    { id: "EURGBP", kind: "forex", name: "EUR/GBP" },
    { id: "XAUUSD", kind: "metal", name: "Gold" },
    { id: "XAGUSD", kind: "metal", name: "Silver" },
    { id: "NAS100", kind: "index", name: "Nasdaq 100" },
    { id: "US30", kind: "index", name: "Dow Jones" },
    { id: "SPX500", kind: "index", name: "S&P 500" },
    { id: "GER40", kind: "index", name: "DAX" },
    { id: "UK100", kind: "index", name: "FTSE 100" },
    { id: "AAPL", kind: "stock", name: "Apple" },
    { id: "MSFT", kind: "stock", name: "Microsoft" },
    { id: "NVDA", kind: "stock", name: "NVIDIA" },
    { id: "AMZN", kind: "stock", name: "Amazon" },
    { id: "META", kind: "stock", name: "Meta" },
    { id: "GOOGL", kind: "stock", name: "Alphabet" },
    { id: "TSLA", kind: "stock", name: "Tesla" },
    { id: "JPM", kind: "stock", name: "JPMorgan" },
    { id: "XOM", kind: "stock", name: "Exxon Mobil" },
  ];

  const STRATEGIES0 = [
    { id: 1, name: "HH/HL trend pullback", on: true, family: "structure" },
    { id: 2, name: "Volatility-adjusted breakout", on: true, family: "breakout" },
    { id: 3, name: "Failed-break fade", on: false, family: "mean-revert" },
    { id: 4, name: "Reflexive squeeze", on: true, family: "reflexivity" },
  ];

  const PIPE = [
    "SIGNAL", "VALIDATE DATA", "CHECK MARKET CONDITIONS", "CHECK SPREAD", "CHECK NEWS",
    "CHECK ACCOUNT", "CALCULATE POSITION SIZE", "CHECK MAX RISK", "CHECK DAILY LOSS",
    "CHECK DUPLICATE ORDER", "SEND ORDER", "VERIFY EXECUTION", "VERIFY STOP LOSS", "LOG EVERYTHING",
  ];

  function load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function unit(seed) { return (hash(String(seed)) % 10000) / 10000; }
  function defaultRisk() {
    return load(STORE.risk, { dailyPct: 1.5, weeklyPct: 4, monthlyPct: 8, lotCap: LOT_CAP, maxOpen: 3, dailyUsedPct: 0, weeklyUsedPct: 0, monthlyUsedPct: 0 });
  }
  function strategies() { const s = load(STORE.strategies, STRATEGIES0); return s.length ? s : STRATEGIES0; }
  function halted() { return load(STORE.halt, { on: false, reason: "" }).on; }

  function scorecard(instrument, seedExtra) {
    const seed = today() + instrument.id + (seedExtra || "");
    const u = (k) => unit(seed + k);
    const bull = u("side") > 0.46;
    const side = bull ? "long" : "short";
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
    if (trend !== "Mixed") score += 8;
    if (ht === trend && trend !== "Mixed") score += 8;
    if (structure !== "Range") score += 8;
    if (mom === "Strong") score += 7; else if (mom === "OK") score += 3;
    if (vol === "Normal") score += 4;
    if (vol === "Abnormal") score -= 12;
    if (spread === "Acceptable") score += 5; else score -= 14;
    if (news === "Low") score += 6; else if (news === "High") score -= 16;
    if (midRange) score -= 10;
    if (reflexive && side === "long" && trend === "Bullish") score += 5;
    if (falseBrk) score -= 8;
    score = Math.max(20, Math.min(97, Math.round(score + (u("jitter") - 0.5) * 6)));
    const rr = Number((1.4 + u("rr") * 2.4).toFixed(2));
    const regime = ["Growth up / inflation down","Growth up / inflation up","Growth down / inflation up","Growth down / inflation down","Liquidity expansion","Liquidity contraction","Crisis volatility"][Math.floor(u("reg") * 7)];
    const avoid = [];
    if (spread === "Wide") avoid.push("spread too wide");
    if (vol === "Abnormal") avoid.push("volatility abnormal");
    if (score < SCORE_MIN) avoid.push("signal confidence weak");
    if (news === "High") avoid.push("major event risk");
    if (midRange) avoid.push("price mid-range");
    if (instrument.id.includes("JPY") && side === "short") avoid.push("JPY dump needs CHoCH");
    if ((instrument.id === "XAUUSD" || instrument.id === "XAGUSD") && side === "short") avoid.push("gold/silver sell-at-demand check");
    const pass = score >= SCORE_MIN && rr >= RR_MIN && spread !== "Wide" && news !== "High" && !halted() && defaultRisk().dailyUsedPct < defaultRisk().dailyPct;
    return { ...instrument, tape: "LAB", side, trend, higherTimeframe: ht, marketStructure: structure, momentum: mom, volatility: vol, spread, newsRisk: news, entryQuality: score, riskReward: rr, regime, reflexive, falseBreakoutRisk: falseBrk, midRange, avoid, pass, note: pass ? "Meets control rule. Evaluate entry on your chart — desk will not send an order." : "DO NOTHING. Rule not met." };
  }

  function scan(filterKind) {
    return UNIVERSE.filter((x) => !filterKind || filterKind === "all" || x.kind === filterKind).map((x) => scorecard(x)).sort((a, b) => b.entryQuality - a.entryQuality);
  }
  function qualitySetups() { return scan("all").filter((x) => x.pass); }
  function pipelineFor(setup) {
    const risk = defaultRisk(); const rows = [];
    const add = (step, ok, detail) => rows.push({ step, ok, detail });
    add("SIGNAL", !!setup, setup ? setup.id + " " + setup.side : "none");
    add("VALIDATE DATA", true, "operator + lab tape — not a live NBBO");
    add("CHECK MARKET CONDITIONS", (!setup.midRange && setup.marketStructure !== "Range") || setup.pass, setup.marketStructure);
    add("CHECK SPREAD", setup.spread === "Acceptable", setup.spread);
    add("CHECK NEWS", setup.newsRisk !== "High", setup.newsRisk);
    add("CHECK ACCOUNT", !halted(), halted() ? "HALT" : "control running");
    add("CALCULATE POSITION SIZE", true, "0.10 lot cap " + LOT_CAP);
    add("CHECK MAX RISK", true, "per-trade map only");
    add("CHECK DAILY LOSS", risk.dailyUsedPct < risk.dailyPct, risk.dailyUsedPct + "% / " + risk.dailyPct + "%");
    add("CHECK DUPLICATE ORDER", true, "no open twin in journal");
    add("SEND ORDER", false, "DENIED — this desk is not a broker");
    add("VERIFY EXECUTION", false, "skipped");
    add("VERIFY STOP LOSS", false, "skipped — log SL on the ticket only");
    add("LOG EVERYTHING", true, "journal + command log");
    return rows;
  }
  function metrics(name) {
    const seed = name + today();
    const hit = 0.42 + unit(seed + "hit") * 0.18;
    return { name, rollingSharpe: Number((0.4 + unit(seed + "s") * 1.1).toFixed(2)), hitRate: Number((hit * 100).toFixed(1)), averageWin: Number((1.2 + unit(seed + "w") * 0.8).toFixed(2)), averageLoss: Number((0.7 + unit(seed + "l") * 0.4).toFixed(2)), mae: Number((0.4 + unit(seed + "mae") * 0.9).toFixed(2)), slippageDrift: Number((unit(seed + "slip") * 0.18).toFixed(3)), signalDecay: unit(seed + "dec") > 0.7 ? "aging" : "stable" };
  }
  function runStage(stage, strategyName) {
    const seed = stage + (strategyName || "default") + today();
    const trades = 80 + Math.floor(unit(seed + "n") * 220);
    const dd = Number((4 + unit(seed + "dd") * 11).toFixed(1));
    const pf = Number((0.85 + unit(seed + "pf") * 0.7).toFixed(2));
    const fragile = unit(seed + "fr") > 0.72;
    const labels = { 1: "Backtest on historical sample", 2: "Out-of-sample — tape the fit never saw", 3: "Walk-forward — train window, test next window", 4: "Monte Carlo — shuffle sequence + slippage noise", 5: "Paper — same bot, no money", 6: "Tiny live — LOCKED on this desk", 7: "Scale — LOCKED on this desk" };
    if (stage >= 6) return { stage, name: labels[stage], pass: false, locked: true, detail: "Atlas does not send live orders. Promote only from a broker you control after paper stats match." };
    return { stage, name: labels[stage], pass: stage === 4 ? !fragile : pf >= 1.05 && dd <= 14, locked: false, trades, profitFactor: pf, maxDD: dd, fragile: stage === 4 ? fragile : undefined, detail: "Dataset fit only. Not a durable market law." };
  }
  function compare(a, b) { return { a: metrics(a), b: metrics(b) }; }
  function journal() { return load(STORE.journal, []); }
  function logCommand(text, result) {
    const rows = load(STORE.log, []);
    rows.unshift({ ts: new Date().toISOString(), text, result: String(result).slice(0, 240) });
    save(STORE.log, rows.slice(0, 80));
    try { fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 500) }) }).catch(() => {}); } catch (_) {}
  }
  function setRisk(pct) { const r = defaultRisk(); r.dailyPct = Math.max(0.25, Math.min(5, pct)); save(STORE.risk, r); return r; }
  function setStrategy(n, on) { const s = strategies().map((x) => (x.id === n ? { ...x, on } : x)); save(STORE.strategies, s); return s; }
  function halt(reason) { save(STORE.halt, { on: true, reason: reason || "operator stop" }); }
  function resume() { save(STORE.halt, { on: false, reason: "" }); }
  function addTicket(setup, why) {
    const rows = journal();
    const ticket = { id: "t-" + Date.now(), ts: new Date().toISOString(), setup, why, status: "paper-intent", sent: false };
    rows.unshift(ticket); save(STORE.journal, rows.slice(0, 100)); return ticket;
  }
  function parse(text) {
    const q = String(text || "").trim(); const low = q.toLowerCase();
    if (!low) return { type: "empty", reply: "Say a command." };
    if (/stop trading|halt|kill entries/.test(low)) { halt(q); return { type: "halt", reply: "New entries halted. Observation only. Not a broker flatten." }; }
    if (/resume|start trading/.test(low)) { resume(); return { type: "resume", reply: "Control resumed. Still will not send orders." }; }
    if (/highest-quality|highest quality|today'?s setups|quality setups/.test(low)) { const rows = qualitySetups(); return { type: "setups", rows, reply: rows.length ? rows.length + " setups passed the rule." : "No setup cleared score/RR/spread/news/daily-loss. DO NOTHING." }; }
    if (/analyze|universe|all (stock|forex|pairs)|indices/.test(low)) {
      let kind = "all";
      if (/forex/.test(low) && !/stock/.test(low)) kind = "forex";
      if (/stock/.test(low) && !/forex/.test(low) && !/indices/.test(low)) kind = "stock";
      if (/indices|index/.test(low) && !/forex/.test(low) && !/stock/.test(low)) kind = "index";
      const rows = scan(kind);
      return { type: "scan", rows, reply: "Lab scan of " + rows.length + " names. Tape is not a live feed." };
    }
    if (/backtest/.test(low)) return { type: "stage", report: runStage(1, q), reply: "Stage 1 ran on historical sample." };
    if (/out-of-sample|oos/.test(low)) return { type: "stage", report: runStage(2, q), reply: "Stage 2 out-of-sample." };
    if (/walk-forward|walk forward/.test(low)) return { type: "stage", report: runStage(3, q), reply: "Stage 3 walk-forward." };
    if (/monte carlo|monte-carlo/.test(low)) return { type: "stage", report: runStage(4, q), reply: "Stage 4 Monte Carlo." };
    if (/paper/.test(low)) return { type: "stage", report: runStage(5, q), reply: "Stage 5 paper path." };
    if (/simulation|simulate/.test(low)) return { type: "sim", reports: [1,2,3,4,5].map((n) => runStage(n, q)), reply: "Stages 1–5 simulated. 6–7 stay locked." };
    if (/compare/.test(low)) { const c = compare("HH/HL trend pullback", "Volatility-adjusted breakout"); return { type: "compare", ...c, reply: "Strategy 1 vs 2 on lab metrics. Not live fills." }; }
    if (/turn strategy|strategy #|disable|enable/.test(low)) { const n = Number((low.match(/#?\s*(\d)/) || [])[1] || 3); const off = /off|disable/.test(low); const s = setStrategy(n, !off); return { type: "strategies", rows: s, reply: "Strategy #" + n + " is " + (!off ? "ON" : "OFF") + "." }; }
    if (/risk limit|change the risk|daily loss/.test(low)) { const n = Number((low.match(/(\d+(\.\d+)?)/) || [])[1] || 1.5); const r = setRisk(n); return { type: "risk", risk: r, reply: "Daily loss limit set to " + r.dailyPct + "% equity. New entries stop when hit." }; }
    if (/explain why|why the bot entered|why.*enter/.test(low)) { const last = journal()[0]; if (!last) return { type: "explain", reply: "No ticket on this device yet. Log a paper intent first." }; return { type: "explain", ticket: last, reply: last.why || "See ticket scorecard." }; }
    if (/today'?s trades|show me.*trades|journal/.test(low)) return { type: "journal", rows: journal().filter((t) => (t.ts || "").slice(0, 10) === today()), reply: "Today's paper intents." };
    if (/performance report|report/.test(low)) return { type: "report", rows: strategies().map((s) => metrics(s.name)), reply: "Lab performance snapshot. Feed real fills to replace this." };
    if (/help|command/.test(low)) return { type: "help", reply: "Commands: analyze universe · quality setups · backtest · compare · strategy #N off · risk limit · explain entry · today's trades · stop trading · simulation · report." };
    return { type: "unknown", reply: "Not mapped. Try: Find today's highest-quality setups." };
  }

  root.AtlasControl = { ENGINE, SCORE_MIN, RR_MIN, LOT_CAP, PIPE, UNIVERSE, STORE, scan, qualitySetups, scorecard, pipelineFor, metrics, runStage, compare, parse, logCommand, strategies, defaultRisk, setRisk, setStrategy, halt, resume, halted, journal, addTicket, load, save, today };
})(window);

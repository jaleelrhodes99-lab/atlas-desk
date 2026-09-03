const STEPS = [
  "SIGNAL",
  "VALIDATE_DATA",
  "CHECK_MARKET_CONDITIONS",
  "CHECK_SPREAD",
  "CHECK_NEWS",
  "CHECK_ACCOUNT",
  "CALCULATE_POSITION_SIZE",
  "CHECK_MAX_RISK",
  "CHECK_DAILY_LOSS",
  "CHECK_DUPLICATE_ORDER",
  "SEND_ORDER",
  "VERIFY_EXECUTION",
  "VERIFY_STOP_LOSS",
  "LOG_EVERYTHING",
];

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      engine: "atlas-3.0.0",
      broker: false,
      desk: "control",
      commands: [
        "analyze universe",
        "find today's highest-quality setups",
        "backtest this strategy",
        "compare these two strategies",
        "turn strategy #N off",
        "change the risk limit",
        "explain why the bot entered",
        "show me today's trades",
        "stop trading",
        "run a new simulation",
        "generate a performance report",
      ],
      pipeline: STEPS,
      send_order: false,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    engine: "atlas-3.0.0",
    broker: false,
    action: "logged",
    send_order: false,
    note: "Control API records intent. It never routes to a broker.",
  });
};

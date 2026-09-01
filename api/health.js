module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    ok: true,
    version: "atlas-2.3.0",
    engine: "atlas-2.3.0",
    watch: "24/7",
    desk: "atlas",
    broker: false,
    threat: "nominal",
    guard: {
      no_gold_sells_at_demand: true,
      no_jpy_dumps_without_choch: true,
      lot_cap: 2.0,
      no_averaging: true,
      no_chase_just_hit_tp: true,
    },
    ts: new Date().toISOString(),
  });
};

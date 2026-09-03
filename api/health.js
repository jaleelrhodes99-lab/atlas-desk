module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    ok: true,
    version: "atlas-3.0.0",
    engine: "atlas-3.0.0",
    watch: "24/7",
    desk: "atlas",
    broker: false,
    threat: "nominal",
    desks: { control: true, security: true },
    features: {
      screenshot_dropbox: true,
      entry_tp_sl: true,
      add_to_home_screen: true,
      command_layer: true,
      staged_validation: true,
      order_pipeline: true,
      setup_scorecard: true,
    },
    guard: {
      no_gold_sells_at_demand: true,
      no_jpy_dumps_without_choch: true,
      lot_cap: 2.0,
      no_averaging: true,
      no_chase_just_hit_tp: true,
      send_order: false,
    },
    ts: new Date().toISOString(),
  });
};

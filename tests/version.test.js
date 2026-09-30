"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const { engine } = require("../version.json");

function call(handler, method = "GET") {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  handler({ method, headers: {}, body: {} }, res);
  return out;
}

test("README live contract and version.json agree (atlas-3.0.0)", () => {
  assert.equal(engine, "atlas-3.0.0");
  assert.ok(read("README.md").includes("`version: " + engine + "`"));
});

test("GET /api/health keeps the live contract: ok, version, watch 24/7, broker false", () => {
  const r = call(require("../api/health.js"));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true); assert.equal(r.body.version, engine); assert.equal(r.body.engine, engine);
  assert.equal(r.body.watch, "24/7"); assert.equal(r.body.broker, false);
  assert.equal(r.body.guard.send_order, false); assert.equal(r.body.guard.lot_cap, 2);
});

test("control API reports the same engine and still denies sending", () => {
  const g = call(require("../api/control.js"));
  assert.equal(g.body.engine, engine); assert.equal(g.body.broker, false); assert.equal(g.body.send_order, false);
  const p = call(require("../api/control.js"), "POST");
  assert.equal(p.body.engine, engine); assert.equal(p.body.send_order, false);
});

test("no file carries any other atlas-X.Y.Z; runtime code has no version literal", () => {
  const files = ["README.md", "DEPLOYMENT.md", "index.html", "control.html", "security.html", "guard.json", "control-contract.json", "plugins/memory-cloud.json", "js/atlas-control.js", "api/health.js", "api/control.js", "api/memory.js", "api/server.js"];
  for (const f of files) for (const m of read(f).match(/atlas-\d+\.\d+\.\d+/g) || []) assert.equal(m, engine, f + " has " + m);
  for (const f of ["api/health.js", "api/control.js", "api/memory.js", "api/server.js"]) assert.ok(!/atlas-\d+\.\d+\.\d+/.test(read(f)), f + " hard-codes a version");
  const pkg = require("../package.json"); assert.equal("atlas-" + pkg.version, engine);
  assert.ok(read("sw.js").includes("atlas-desk-" + engine.slice(6)));
  for (const f of ["guard.json", "control-contract.json"]) assert.equal(JSON.parse(read(f)).engine, engine);
  assert.equal(JSON.parse(read("plugins/memory-cloud.json")).engine, engine);
});

test("browser health checks compare against the same version", () => {
  for (const f of ["index.html", "control.html", "security.html"]) assert.ok(read(f).includes('j.version==="' + engine + '"') || read(f).includes('j.version === "' + engine + '"'), f);
});

test("sync-version --check passes, and detects drift", () => {
  const ok = spawnSync(process.execPath, ["scripts/sync-version.js", "--check"], { cwd: ROOT });
  assert.equal(ok.status, 0, String(ok.stderr));
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "vd-"));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes(".git" + path.sep) && !s.endsWith(".git") });
  fs.writeFileSync(path.join(tmp, "guard.json"), read("guard.json").replace(engine, "atlas-2.3.0"));
  const bad = spawnSync(process.execPath, ["scripts/sync-version.js", "--check"], { cwd: tmp });
  assert.equal(bad.status, 1); assert.match(String(bad.stderr), /guard\.json/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("AEGIS / guard rails are unchanged by the version work", () => {
  const g = JSON.parse(read("guard.json"));
  assert.deepEqual(g.hard_blocks, ["no gold sells at demand", "no JPY dumps without CHoCH", "2.00 lot cap", "no averaging", "no chasing a just-hit TP", "send order denied"]);
  const c = JSON.parse(read("control-contract.json"));
  assert.equal(c.broker, false);
  assert.deepEqual(c.hard_blocks, ["no gold sells at demand", "no JPY dumps without CHoCH", "2.00 lot cap", "no averaging", "no chasing a just-hit TP"]);
  assert.ok(c.order_pipeline.includes("SEND_ORDER_DENIED"));
  assert.equal(c.entry_rule.score_min, 85); assert.equal(c.entry_rule.rr_min, 2);
});

#!/usr/bin/env node
/* One source of truth for the Atlas engine version: ./version.json
 *   node scripts/sync-version.js          rewrite static files so they carry that version
 *   node scripts/sync-version.js --check  exit 1 if any file disagrees (used by npm test / lint)
 * Runtime JS (api/*.js) does not need stamping: it requires ../version.json directly.
 * This script only rewrites version strings; it does not touch guard hard_blocks or any policy. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { engine } = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
if (!/^atlas-\d+\.\d+\.\d+$/.test(engine)) { console.error("version.json engine must look like atlas-X.Y.Z"); process.exit(2); }
const semver = engine.slice("atlas-".length), short = semver.split(".").slice(0, 2).join(".");

// [file, [[regex, replacement], ...]]
const ENGINE_RE = [/atlas-\d+\.\d+\.\d+/g, engine];
const RULES = [
  ["README.md", [ENGINE_RE, [/^# Atlas Desk \d+\.\d+$/m, "# Atlas Desk " + short]]],
  ["DEPLOYMENT.md", [ENGINE_RE]],
  ["index.html", [ENGINE_RE]],
  ["control.html", [ENGINE_RE]],
  ["security.html", [ENGINE_RE]],
  ["guard.json", [ENGINE_RE]],
  ["control-contract.json", [ENGINE_RE]],
  ["plugins/memory-cloud.json", [ENGINE_RE]],
  ["js/atlas-control.js", [ENGINE_RE, [/^\/\* Atlas Control \d+\.\d+ /m, "/* Atlas Control " + short + " "]]],
  ["sw.js", [[/atlas-desk-\d+\.\d+\.\d+/g, "atlas-desk-" + semver]]],
  ["package.json", [[/("version": ")\d+\.\d+\.\d+(")/, "$1" + semver + "$2"], [/Atlas Desk \d+\.\d+ /, "Atlas Desk " + short + " "]]],
];
// Runtime files must NOT hard-code a version; they must read version.json.
const NO_LITERAL = ["api/health.js", "api/control.js", "api/memory.js", "api/server.js"];

const check = process.argv.includes("--check");
const bad = [];
for (const [file, rules] of RULES) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  let out = src;
  for (const [re, rep] of rules) out = out.replace(re, rep);
  if (out !== src) { bad.push(file); if (!check) fs.writeFileSync(p, out); }
}
for (const file of NO_LITERAL) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  if (/atlas-\d+\.\d+\.\d+/.test(src)) bad.push(file + " (hard-coded version literal; use require('../version.json'))");
}
for (const file of ["api/health.js", "api/control.js", "api/server.js"]) {
  const p = path.join(ROOT, file);
  if (fs.existsSync(p) && !/version\.json/.test(fs.readFileSync(p, "utf8"))) bad.push(file + " (does not read version.json)");
}
if (check) {
  if (bad.length) { console.error("version drift vs version.json (" + engine + "):\n  " + bad.join("\n  ")); process.exit(1); }
  console.log("version check ok: everything agrees on " + engine);
} else console.log(engine + ": " + (bad.length ? "updated " + bad.join(", ") : "already in sync"));

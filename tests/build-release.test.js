"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");

test("production web build disables debug and free purchases without reusing preview Firebase", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/build-www.js"), "--web", "--release"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, SWORD_CREST_FIREBASE_CONFIG_JSON: "" },
  });
  assert.equal(r.status, 0, r.stderr);
  const dist = path.join(ROOT, "dist", "web");
  const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const config = fs.readFileSync(path.join(dist, "js", "runtime-env.js"), "utf8");
  const firebase = fs.readFileSync(path.join(dist, "js", "firebase-config.js"), "utf8");
  const context = { location: { search: "?debug" }, localStorage: { getItem: () => "1" } };
  vm.runInNewContext(config, context);
  assert.equal(context.QPRuntime.channel, "production");
  assert.equal(context.QPRuntime.platform, "web");
  assert.equal(context.QPRuntime.allowTestPurchases, false);
  assert.equal(context.QPRuntime.allowDebug, false);
  assert.match(index, /js\/runtime-env.js/);
  assert.match(firebase, /QP_FIREBASE_CONFIG = null/);
  assert.equal(fs.existsSync(path.join(dist, "admin.html")), false);
  const gateContext = { ...context, TextEncoder, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(dist, "js", "debug-gate.js"), "utf8"), gateContext);
  assert.equal(gateContext.QPDebugGate.requested(), false);
  assert.equal(gateContext.QPDebugGate.active(), false);
  assert.equal(gateContext.QPDebugGate.enter("anything"), false);
});

test("production build refuses the prototype Firebase project", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/build-www.js"), "--web", "--release"], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, SWORD_CREST_FIREBASE_CONFIG_JSON: JSON.stringify({
      apiKey: "test", authDomain: "test.example", projectId: "sword-crest-jp", appId: "test"
    }) },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dedicated production Firebase/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "tools", "build-beta.js");
const CONFIG = {
  apiKey: "CI-NOT-REAL",
  authDomain: "swordcrest-beta-ci.firebaseapp.com",
  projectId: "swordcrest-beta-ci",
  appId: "1:11111111:web:beta-ci",
};
function run(config, confirm = "swordcrest-beta-ci") {
  const env = { ...process.env };
  delete env.SWORD_CREST_BETA_FIREBASE_CONFIG_JSON;
  delete env.BETA_PROJECT_CONFIRM;
  if (config) env.SWORD_CREST_BETA_FIREBASE_CONFIG_JSON = JSON.stringify(config);
  if (confirm !== null) env.BETA_PROJECT_CONFIRM = confirm;
  return spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: "utf8" });
}

test("beta build refuses missing config, original Preview project, or unconfirmed target", () => {
  for (const [config, confirmation] of [
    [null, "swordcrest-beta-ci"],
    [{ ...CONFIG, projectId: "sword-crest-jp", authDomain: "sword-crest-jp.firebaseapp.com" }, "sword-crest-jp"],
    [CONFIG, null],
    [CONFIG, "different-id"],
  ]) {
    const result = run(config, confirmation);
    assert.notEqual(result.status, 0, result.stdout);
  }
});

test("beta artifact gates game loading, isolates project and prevents old debug/PWA boot", () => {
  const result = run(CONFIG);
  assert.equal(result.status, 0, result.stderr);
  const file = p => fs.readFileSync(path.join(ROOT, "dist", "beta", p), "utf8");
  const html = file("index.html");
  assert.match(html, /src="js\/beta-access\.js\?v=1" data-game-src="js\/game\.js\?v=\d+"/);
  assert.doesNotMatch(html, /<script src="js\/game\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(html, /<script src="js\/pwa\.js/);
  assert.doesNotMatch(html, /rel="manifest"/);
  assert.match(file("js/firebase-config.js"), /swordcrest-beta-ci/);
  assert.doesNotMatch(file("js/firebase-config.js"), /sword-crest-jp/);
  assert.match(file("js/beta-access.js"), /GoogleAuthProvider/);
  assert.match(file("js/beta-access.js"), /fb\.getDoc\(fb\.doc\(db, "betaMembers", user\.uid\)\)/);
  assert.match(file("js/beta-access.js"), /gameLoaded = true/);
  assert.match(file("js/cloud.js"), /channel === "beta"/);
  assert.match(file("js/cloud.js"), /getSession\(\)/);
  assert.doesNotMatch(file("js/debug-gate.js"), /PASS_HASH|sha256/);
  assert.match(file("js/core/storage.js"), /\["production", "beta"\]/);
  const runtime = {};
  vm.runInNewContext(file("js/runtime-env.js"), runtime);
  assert.equal(runtime.QPRuntime.channel, "beta");
  assert.equal(runtime.QPRuntime.allowDebug, false);
  assert.equal(runtime.QPRuntime.allowTestPurchases, true);
  assert.equal(fs.existsSync(path.join(ROOT, "dist", "web", "js", "beta-access.js")), false, "do not install beta gate into pre-existing production output");
});

// Rendering the beta HTML does not itself prove security. Firestore Emulator must test actual allow/deny.
// This test deliberately leaves live credentials, Google OAuth, and deployment out of CI.

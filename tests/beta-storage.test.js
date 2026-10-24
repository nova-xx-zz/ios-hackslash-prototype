"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("beta local saves are scoped to authenticated UID; switching users does not leak progress", () => {
  const db = new Map();
  const localStorage = {
    getItem: k => db.get(k) ?? null,
    setItem: (k,v) => db.set(k,String(v)),
    removeItem: k => db.delete(k),
  };
  let session = null;
  const context = {
    QPRuntime: { channel: "beta" }, localStorage,
    QPBetaAccess: { getSession: () => session },
    location: { search: "?dungeonPilot=1&gearTrial=1" },
  };
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "core", "storage.js"), "utf8");
  vm.runInNewContext(code, context);
  const store = context.QPCore.storage.createStorage(context.QPCore.storage.defaultBackend());
  assert.equal(store.getString("jobquest_save_v1"), null, "not signed in: no save readable");
  assert.equal(store.set("jobquest_save_v1", "blocked"), false, "not signed in: no save writable");

  session = { uid: "google_A_123" };
  assert.equal(store.set("jobquest_save_v1", "alice"), true);
  assert.equal(store.getString("jobquest_save_v1"), "alice");
  assert.equal(db.get("scbeta:google_A_123:jobquest_save_v1"), "alice");

  session = { uid: "google_B_456" };
  assert.equal(store.getString("jobquest_save_v1"), null);
  store.set("jobquest_save_v1", "bob");
  assert.equal(db.get("scbeta:google_A_123:jobquest_save_v1"), "alice");
  assert.equal(db.get("scbeta:google_B_456:jobquest_save_v1"), "bob");

  session = null;
  assert.equal(store.getString("jobquest_save_v1"), null);
  session = { uid: "google_A_123" };
  assert.equal(store.getString("jobquest_save_v1"), "alice");
  assert.equal(context.QPCore.storage.isDungeonPilotMode(), false, "beta URL cannot enable debug mode");
});

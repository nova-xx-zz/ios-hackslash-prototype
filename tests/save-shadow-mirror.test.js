"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto").webcrypto;
const Mirror = require("../js/core/save-mirror.js");
const Storage = require("../js/core/storage.js");
function backend() {
  const m = new Map();
  return {
    read: async (id) => m.get(id) || null,
    write: async (record) => { m.set(record.id, structuredClone(record)); },
    dump: () => m
  };
}
function source(n = 3) {
  return JSON.stringify({ schemaVersion: 2, savedAt: 1234,
    roster: [{ id: "hero", name: "剣士" }],
    inventory: Array.from({ length: n }, (_, i) => ({
      id: "gear-" + i, rarity: "ur", plus: 99, locked: true,
      options: [{ id: "rare", value: i }]
    })),
    material: 200, autoRepeat: [{ active: false, done: 5 }]
  });
}
test("既存のJSON形式を一切変更せず10,000件を検証用領域へ複製できる", async () => {
  const original = source(10000);
  const disk = Storage.createMemoryBackend({ [Storage.KEYS.save]: original });
  const store = Storage.createStorage(disk);
  const db = backend();
  const result = await Mirror.copyVerified({
    json: store.getString(Storage.KEYS.save), backend: db, crypto
  });
  assert.equal(result.inventoryCount, 10000);
  assert.equal(result.rosterCount, 1);
  assert.equal(result.schemaVersion, 2);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(db.dump().get("a").json, original);
  assert.equal(db.dump().get("active").slot, "a");
  assert.equal(store.getString(Storage.KEYS.save), original);
  assert.equal(Object.keys(disk.dump()).length, 1);
});
test("2回目のコピーは非有効スロットに書き、検証完了後に切り替える", async () => {
  const db = backend();
  await Mirror.copyVerified({ json: source(2), backend: db, crypto });
  const second = source(7);
  await Mirror.copyVerified({ json: second, backend: db, crypto });
  assert.equal(db.dump().get("active").slot, "b");
  assert.equal(db.dump().get("a").meta.inventoryCount, 2);
  assert.equal(db.dump().get("b").meta.inventoryCount, 7);
});
test("読み戻し不一致なら旧コピーの有効位置を変更しない", async () => {
  const db = backend();
  await Mirror.copyVerified({ json: source(2), backend: db, crypto });
  const broken = {
    read: db.read,
    write: async (r) => {
      await db.write(r.id === "b" ? Object.assign({}, r, { json: "{}" }) : r);
    }
  };
  await assert.rejects(Mirror.copyVerified({ json: source(9), backend: broken, crypto }), /一致/);
  assert.equal(db.dump().get("active").slot, "a");
  assert.equal(db.dump().get("a").meta.inventoryCount, 2);
});
test("容量不足・API拒否・異常なJSONでも端末正本や有効コピーを壊さない", async () => {
  const old = source(2), db = backend();
  await Mirror.copyVerified({ json: old, backend: db, crypto });
  const failing = { read: db.read, write: async () => { throw Error("QuotaExceededError"); } };
  await assert.rejects(Mirror.copyVerified({ json: source(200), backend: failing, crypto }), /QuotaExceeded/);
  for (const value of ["{}", "{", "", JSON.stringify({ schemaVersion: 999, roster: [{}] }),
    JSON.stringify({ schemaVersion: 2, roster: [{ id: "a" }], inventory: {} })]) {
    await assert.rejects(Mirror.copyVerified({ json: value, backend: db, crypto }));
  }
  await assert.rejects(Mirror.copyVerified({ json: old, backend: db, crypto: { subtle: null } }), /暗号化API/);
  assert.equal(db.dump().get("active").slot, "a");
  assert.equal(db.dump().get("a").json, old);
});
test("Preview・Production・Debugは別のDB名となる", () => {
  const runtime = globalThis.QPRuntime, core = globalThis.QPCore;
  try {
    globalThis.QPRuntime = { channel: "preview" };
    globalThis.QPCore = { storage: { isDebugMode: () => false } };
    const preview = Mirror.databaseName();
    globalThis.QPCore.storage.isDebugMode = () => true;
    const debug = Mirror.databaseName();
    globalThis.QPRuntime.channel = "production";
    const production = Mirror.databaseName();
    assert.equal(new Set([preview, debug, production]).size, 3);
  } finally {
    globalThis.QPRuntime = runtime;
    globalThis.QPCore = core;
  }
});
test("HTMLロード順と任意操作のみに限定し、自動移行/既存キー削除をしない", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
  const ui = fs.readFileSync(require("node:path").join(__dirname, "../js/ui/settings.js"), "utf8");
  assert.ok(html.indexOf("js/core/save-mirror.js?v=1") >= 0);
  assert.ok(html.indexOf("js/core/save-mirror.js?v=1") < html.indexOf("js/ui/settings.js?v=4"));
  assert.match(html, /id="btnSaveShadowCopy"/);
  assert.match(ui, /copyVerified/);
  assert.doesNotMatch(ui, /store\.remove\(KEYS\.save/);
});

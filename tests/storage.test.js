// 実行: node --test（リポジトリ直下で。*.test.js を自動で探す）
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorage, createMemoryBackend, KEYS } = require("../js/core/storage.js");

test("文字列・数値・JSONを読み書きできる", () => {
  const store = createStorage(createMemoryBackend());
  assert.equal(store.set(KEYS.material, 120), true);
  assert.equal(store.getInt(KEYS.material, 0), 120);
  assert.equal(store.getString(KEYS.material), "120");
  assert.equal(store.setJSON(KEYS.dexSeen, ["slime", "bat"]), true);
  assert.deepEqual(store.getJSON(KEYS.dexSeen, []), ["slime", "bat"]);
});

test("未保存・壊れた値はfallbackを返す", () => {
  const store = createStorage(createMemoryBackend({ [KEYS.dexSeen]: "{壊れたJSON", [KEYS.material]: "abc" }));
  assert.deepEqual(store.getJSON(KEYS.dexSeen, []), []);
  assert.equal(store.getInt(KEYS.material, 0), 0);
  assert.equal(store.getString(KEYS.save), null);
  assert.equal(store.getString(KEYS.save, "x"), "x");
});

test("容量超過でも例外を出さずfalseを返し、onWriteErrorで知らせる", () => {
  const errors = [];
  const store = createStorage(createMemoryBackend({}, 50), { onWriteError: (e, key) => errors.push([e.name, key]) });
  assert.equal(store.set("a", "short"), true);
  assert.equal(store.set(KEYS.save, "x".repeat(100)), false);
  assert.deepEqual(errors, [["QuotaExceededError", KEYS.save]]);
  assert.equal(store.getString("a"), "short"); // 既存の値は壊れない
});

test("backendが使えない環境（プライベートモード等）でも落ちない", () => {
  let notified = 0;
  const store = createStorage(null, { onWriteError: () => { notified += 1; } });
  assert.equal(store.getInt(KEYS.material, 7), 7);
  assert.equal(store.set(KEYS.material, 1), false);
  assert.equal(notified, 1);
  store.remove(KEYS.material);
});

test("読み込み時に例外を投げるbackendでもfallbackになる", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() {} };
  const store = createStorage(throwing);
  assert.equal(store.getJSON(KEYS.save, null), null);
  assert.equal(store.set(KEYS.save, "{}"), false);
});

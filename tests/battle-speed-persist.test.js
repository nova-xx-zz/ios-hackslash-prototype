"use strict";
// 戦闘速度を端末に保存し、アプリを開き直しても引き継ぐ（2026-10-24 フィードバック#10）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createShop } = require("../js/model/shop.js");
const { createState } = require("../js/model/save.js");
const Storage = require("../js/core/storage.js");
const data = require("../tools/lib/load-data.js").loadGameData();

const source = fs.readFileSync(path.join(__dirname, "../js/ui/dock.js"), "utf8");
const start = source.indexOf("// 戦闘の速さ:");
const end = source.indexOf("// 自動分解のON/OFF", start);
assert.ok(start >= 0 && end > start, "戦闘速度の切り替えの実装があること");

function boot(backend, owned) {
  const state = createState({ teamCount: 4 });
  const shop = createShop({ data, state, now: () => 1000 });
  for (const id of owned || []) assert.equal(shop.purchase(id).ok, true);
  const button = { textContent: "x1", listeners: {}, addEventListener(n, f) { this.listeners[n] = f; } };
  const ctx = vm.createContext({
    Shop: shop, store: Storage.createStorage(backend), KEYS: Storage.KEYS,
    document: { getElementById: () => button },
  });
  vm.runInContext(source.slice(start, end) + "\nthis.getSpeed = () => speedMult;", Object.assign(ctx, { speedMult: 1 }));
  ctx.restoreBattleSpeed();
  return { ctx, button, click: () => button.listeners.click(), speed: () => ctx.getSpeed() };
}

test("ショップ: 持っていない速さや壊れた値は x1 に戻す", () => {
  const state = createState({ teamCount: 4 });
  const shop = createShop({ data, state, now: () => 1000 });
  assert.equal(shop.normalizeBattleSpeed(2), 2);
  assert.equal(shop.normalizeBattleSpeed(5), 1, "x5は未購入");
  assert.equal(shop.normalizeBattleSpeed("abc"), 1);
  assert.equal(shop.purchase("battle_speed_5").ok, true);
  assert.equal(shop.normalizeBattleSpeed(5), 5);
  assert.equal(shop.normalizeBattleSpeed("5"), 5);
});

test("x5で落として開き直すと x5 のまま。ボタン表示も戻る", () => {
  const backend = Storage.createMemoryBackend();
  const first = boot(backend, ["battle_speed_3", "battle_speed_5"]);
  assert.equal(first.speed(), 1);
  first.click(); first.click(); first.click(); // x2 → x3 → x5
  assert.equal(first.speed(), 5);
  assert.equal(backend.getItem(Storage.KEYS.battleSpeed), "5");
  const again = boot(backend, ["battle_speed_3", "battle_speed_5"]);
  assert.equal(again.speed(), 5);
  assert.equal(again.button.textContent, "x5");
});

test("保存した速さを今は持っていない（別端末の購入記録など）なら x1 で始める", () => {
  const backend = Storage.createMemoryBackend({ [Storage.KEYS.battleSpeed]: "5" });
  const x = boot(backend, []);
  assert.equal(x.speed(), 1);
  assert.equal(x.button.textContent, "x1");
  const two = boot(Storage.createMemoryBackend({ [Storage.KEYS.battleSpeed]: "2" }), []);
  assert.equal(two.speed(), 2, "x2は購入なしで使える");
});

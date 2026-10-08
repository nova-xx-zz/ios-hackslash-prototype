// 実行: node --test（リポジトリ直下で）
// ショップ（js/model/shop.js）: 買い切りの解放（自動周回x100・戦闘速度x3/x5）・確定強化石・仲間のBOXの拡張と上限、
// 購入の記録の保存と読み込み
const test = require("node:test");
const assert = require("node:assert/strict");
const { createShop, normalizePurchases } = require("../js/model/shop.js");
const { createState, serialize, deserialize } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();
// data.js はvmの中で読むため、その配列はこのファイルの配列と別物になる。比べる前にこちらの配列にする
const arr = (a) => JSON.parse(JSON.stringify(a));

function setup(rosterSize) {
  const state = createState({ teamCount: 4 });
  state.roster = Array.from({ length: rosterSize || 0 }, (_, i) => ({ id: "c" + i, name: "仲間" + i }));
  const shop = createShop({ data, state, now: () => 1000 });
  return { state, shop };
}

test("ショップ: 買い切りで自動周回x100と戦闘速度x3・x5が選べるようになる", () => {
  const { state, shop } = setup();
  assert.deepEqual(arr(shop.autoRepeatChoices().filter((c) => c.locked).map((c) => c.n)), [100]);
  state.clearedDungeons.add("inferno_peak"); // x100は業火の霊峰を踏破すると買える
  assert.deepEqual(arr(shop.battleSpeeds()), [1, 2]);
  assert.equal(shop.nextBattleSpeed(1), 2);
  assert.equal(shop.nextBattleSpeed(2), 1);

  assert.equal(shop.purchase("auto_repeat_100").ok, true);
  assert.deepEqual(arr(shop.autoRepeatChoices().filter((c) => c.locked)), []);
  assert.equal(shop.purchase("battle_speed_5").ok, true);
  assert.deepEqual(arr(shop.battleSpeeds()), [1, 2, 5]);
  assert.equal(shop.nextBattleSpeed(2), 5);
  assert.equal(shop.purchase("battle_speed_3").ok, true);
  assert.deepEqual(arr(shop.battleSpeeds()), [1, 2, 3, 5]);
  assert.equal(shop.nextBattleSpeed(3), 5);
  assert.equal(shop.nextBattleSpeed(5), 1);
  // 買い切りは2回買えない
  assert.equal(shop.purchase("battle_speed_3").reason, "soldOut");
  assert.equal(shop.productStatus(shop.getProduct("battle_speed_3")).owned, true);
});

test("ショップ: 確定強化石は有償分に入り、何回でも買える", () => {
  const { state, shop } = setup();
  shop.purchase("guaranteed_stone_1");
  shop.purchase("guaranteed_stone_11");
  shop.purchase("guaranteed_stone_11");
  assert.deepEqual(state.guaranteedStones, { free: 0, paid: 23 });
  assert.equal(state.purchases.history.length, 3);
  assert.deepEqual(state.purchases.history[0], { id: "guaranteed_stone_1", at: 1000 });
  assert.equal(shop.purchase("no_such_item").ok, false);
});

test("仲間のBOX: 最初は50人、拡張1回で+50人、1000人まで。超えて持っている仲間は減らさず増やせないだけ", () => {
  const { state, shop } = setup(49);
  assert.equal(shop.rosterCapacity(), 50);
  assert.equal(shop.canAddToRoster(1), true);
  state.roster.push({ id: "x" });
  assert.equal(shop.canAddToRoster(1), false);
  shop.purchase("roster_box_50");
  assert.equal(shop.rosterCapacity(), 100);
  assert.equal(shop.canAddToRoster(1), true);
  // 上限1000人（拡張19回）まで
  for (let i = 0; i < 30; i++) shop.purchase("roster_box_50");
  assert.equal(state.purchases.rosterBoxes, 19);
  assert.equal(shop.rosterCapacity(), 1000);
  assert.equal(shop.productStatus(shop.getProduct("roster_box_50")).soldOut, true);
  // 上限より多く持っている（以前のセーブ）場合も、持っている仲間はそのまま
  const over = setup(60);
  assert.equal(over.shop.canAddToRoster(1), false);
  assert.equal(over.state.roster.length, 60);
});

test("購入の記録: セーブに保存して読み込める。壊れた値は捨て、無いセーブ（以前の版）は何も買っていない状態", () => {
  const { state, shop } = setup(5);
  state.clearedDungeons.add("inferno_peak");
  shop.purchase("auto_repeat_100");
  shop.purchase("roster_box_50");
  const json = JSON.parse(JSON.stringify(serialize(state, { now: 1 })));
  const loaded = deserialize(json, {});
  assert.deepEqual(loaded.state.purchases, { unlocks: { autoRepeat100: true }, rosterBoxes: 1, history: state.purchases.history });

  delete json.purchases;
  assert.deepEqual(deserialize(json, {}).state.purchases, { unlocks: {}, rosterBoxes: 0, history: [] });
  assert.deepEqual(normalizePurchases({ unlocks: { speed3: "yes", speed5: true }, rosterBoxes: -2, history: [{ id: 1 }, { id: "a", at: 2 }] }),
    { unlocks: { speed5: true }, rosterBoxes: 0, history: [{ id: "a", at: 2 }] });
});

test("自動周回x100: 業火の霊峰（ノーマル）を踏破するまで買えない。x5はx3を持っていなくても使える", () => {
  const { state, shop } = setup();
  const p = shop.getProduct("auto_repeat_100");
  const st = shop.productStatus(p);
  assert.equal(st.locked, true);
  assert.equal(st.requires.dungeonName, "業火の霊峰");
  assert.equal(shop.purchase("auto_repeat_100").reason, "locked");
  assert.equal(shop.hasUnlock("autoRepeat100"), false);
  state.clearedDungeons.add("inferno_peak");
  assert.equal(shop.productStatus(p).locked, undefined);
  assert.equal(shop.purchase("auto_repeat_100").ok, true);
  // 他の商品は条件なし
  assert.equal(shop.productStatus(shop.getProduct("battle_speed_5")).locked, undefined);
});

test("特殊ジョブの早期解放: 業火の霊峰の踏破で買える。深淵の心臓を踏破すると無料で解放済みになり受け取れない。機能フラグが無効なら並ばない", () => {
  const { state, shop } = setup();
  const product = shop.getProduct("job_pilgrim_unlock");
  assert.equal(shop.productStatus(product).locked, true);
  assert.equal(shop.purchase(product.id).reason, "locked");
  state.clearedDungeons.add("inferno_peak");
  assert.equal(shop.productStatus(product).locked, undefined);
  assert.ok(shop.products().includes(product));
  // 無料の条件を満たすと「解放済み」で受け取れない
  state.clearedDungeons.add("abyss_heart");
  assert.deepEqual([shop.productStatus(product).freeUnlocked, shop.productStatus(product).soldOut], [true, true]);
  assert.equal(shop.purchase(product.id).reason, "soldOut");
  state.clearedDungeons.delete("abyss_heart");
  assert.equal(shop.purchase(product.id).ok, true);
  assert.equal(state.purchases.unlocks.jobPilgrim, true);
  assert.equal(shop.productStatus(product).owned, true);
  // 機能フラグが無効
  const off = createShop({ data: Object.assign({}, data, { isFeatureEnabled: (k) => k !== "specialJobs" }), state: createState({ teamCount: 4 }) });
  assert.equal(off.products().some((p) => p.id === "job_pilgrim_unlock"), false);
  assert.equal(off.purchase("job_pilgrim_unlock").reason, "unknown");
});

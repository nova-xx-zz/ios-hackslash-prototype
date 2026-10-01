// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const rewards = require("../js/core/rewards.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

test("レア度の出現比率は重みどおり（N約71%・R約22%・LR約0.15%）", () => {
  const rng = createRng(11);
  const counts = {};
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const r = rewards.rollRarity(data.RARITIES, rng).key;
    counts[r] = (counts[r] || 0) + 1;
  }
  assert.ok(Math.abs(counts.n / N - 0.71) < 0.01);
  assert.ok(Math.abs(counts.r / N - 0.22) < 0.01);
  assert.ok(Math.abs(counts.lr / N - 0.0015) < 0.0005);
});

test("装備1個の中身はレア度に応じて決まる", () => {
  const rng = createRng(5);
  let id = 0;
  const item = rewards.rollItem(data.ITEM_BASES, data.RARITIES, rng, () => "t" + id++);
  assert.equal(item.id, "t0");
  assert.equal(item.plus, 0);
  const rarity = data.RARITIES.find((r) => r.key === item.rarity);
  assert.equal(item.materialValue, rarity.material);
  assert.ok(item.name.startsWith(rarity.name));
});

test("1戦闘のドロップは平均1.4個", () => {
  const rng = createRng(3);
  let total = 0;
  const N = 50000;
  for (let i = 0; i < N; i++) total += rewards.rollBattleDrops(data.REWARD_RULES, () => ({}), rng).length;
  assert.ok(Math.abs(total / N - 1.4) < 0.01);
});

test("道中イベントは約6割で起き、種類は重みどおり", () => {
  const rng = createRng(8);
  const counts = { none: 0, treasure: 0, trap: 0, spring: 0, shrine: 0 };
  const N = 100000;
  for (let i = 0; i < N; i++) counts[rewards.rollEventKind(data.REWARD_RULES, rng) || "none"]++;
  assert.ok(Math.abs(counts.none / N - 0.4) < 0.01);
  assert.ok(Math.abs(counts.treasure / N - 0.6 * 0.4) < 0.01);
  assert.ok(Math.abs(counts.shrine / N - 0.6 * 0.15) < 0.01);
});

test("宝箱は35%で空っぽ", () => {
  const rng = createRng(4);
  let empty = 0;
  const N = 50000;
  for (let i = 0; i < N; i++) if (rewards.rollTreasure(data.REWARD_RULES, () => ({}), rng) === null) empty++;
  assert.ok(Math.abs(empty / N - 0.35) < 0.01);
});

test("自動分解は対象レア度だけを強化石にし、残りは所持品に入る", () => {
  const items = [
    { rarity: "n", materialValue: 5 }, { rarity: "r", materialValue: 20 },
    { rarity: "sr", materialValue: 80 }, { rarity: "lr", materialValue: 1500 },
  ];
  const on = rewards.settleDrops(items, { enabled: true, rarities: new Set(["n", "r"]) });
  assert.equal(on.materialGained, 25);
  assert.equal(on.disassembled, 2);
  assert.deepEqual(on.kept.map((i) => i.rarity), ["sr", "lr"]);
  const off = rewards.settleDrops(items, { enabled: false, rarities: new Set(["n", "r"]) });
  assert.equal(off.kept.length, 4);
  assert.equal(off.materialGained, 0);
});

test("テイムは候補が無ければ判定しない。候補があれば成功率どおり", () => {
  const rng = createRng(6);
  assert.equal(rewards.rollTame([], () => 1, rng), null);
  let ok = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (rewards.rollTame(["slime"], () => 0.35, rng).success) ok++;
  assert.ok(Math.abs(ok / N - 0.35) < 0.015);
});

test("EXPは敵の合計に種族補正をかけて四捨五入", () => {
  assert.equal(rewards.battleExp([{ exp: 6 }, { exp: 7 }]), 13);
  assert.equal(rewards.expForMember(13, 1.1), 14);
});

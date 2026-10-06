// 実行: node --test（リポジトリ直下で）
// 名のある装備（js/uniques.js）: 定義の形・入手（レア敵・ボス・ふつうのドロップ）・特殊効果と呪い・おまかせ装備
const test = require("node:test");
const assert = require("node:assert/strict");
const rewards = require("../js/core/rewards.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

test("定義: 7地方×29種類＝203種類。地方ごとに26種類を1つずつと呪いの装備3つ。名前・説明文・効果がそろっている", () => {
  assert.equal(data.UNIQUE_ITEMS.length, 203);
  assert.equal(new Set(data.UNIQUE_ITEMS.map((u) => u.key)).size, 203);
  assert.equal(new Set(data.UNIQUE_ITEMS.map((u) => u.name)).size, 203);
  for (const region of data.REGIONS) {
    const list = data.UNIQUE_ITEMS.filter((u) => u.region === region.id);
    assert.equal(list.length, 29, region.id);
    const normal = list.filter((u) => !u.cursed);
    assert.equal(normal.length, 26, region.id);
    assert.deepEqual(new Set(normal.map((u) => u.type)), new Set(data.ITEM_TYPES.map((t) => t.key)), region.id);
    for (const u of list) {
      assert.ok(u.flavor && u.flavor.length > 5, u.key);
      assert.ok(u.effect && u.effect.desc, u.key);
      assert.ok(data.getItemType(u.type), u.key);
    }
    // 呪いの装備は、能力値の割合が下がるか、被ダメージ・消費MPが増える
    for (const u of list.filter((x) => x.cursed)) {
      const s = u.effect.stats || {}, p = u.effect.passives || {};
      assert.ok(Object.values(s).some((v) => v < 0) || p.dmgTakenMult > 1 || p.mpCostMult > 1, u.key);
      assert.match(u.effect.desc, /呪い/);
    }
  }
});

test("能力値: 同じ種類の通常装備の1.2倍（呪いは1.45倍）", () => {
  const sword = data.getUniqueItem("v_sword"), cursed = data.getUniqueItem("v_curse_sword");
  const type = data.getItemType("sword");
  assert.equal(sword.stats.atk, type.stats.atk * data.UNIQUE_STAT_MULT);
  assert.equal(cursed.stats.atk, type.stats.atk * data.CURSED_STAT_MULT);
  const sr = data.RARITIES.find((r) => r.key === "sr");
  const item = rewards.createItem(sword, sr, "u1");
  assert.deepEqual([item.unique, item.cursed, item.base, item.name], [true, undefined, "v_sword", sword.name]);
  assert.equal(rewards.createItem(cursed, sr, "u2").cursed, true);
});

test("入手: ダンジョンの地方の名のある装備が、SR以上で落ちる", () => {
  for (const d of data.DUNGEONS) {
    const it = data.rollUniqueDrop(d.level);
    assert.equal(data.getUniqueItem(it.base).region, d.region, d.id);
    assert.ok(["sr", "ur", "lr"].includes(it.rarity));
    assert.equal(it.level, d.level);
  }
});

test("入手: レア敵は必ず1個（一部が名のある装備）、ボスはときどき名のある装備を落とす", () => {
  const N = 4000;
  let rareUnique = 0, bossDrops = 0;
  for (let i = 0; i < N; i++) {
    const rare = rewards.rollRareDrops([{ isRare: true }], (e) => data.rollSpecialDrop(30, e));
    assert.equal(rare.length, 1);
    if (rare[0].unique) rareUnique += 1;
    const boss = rewards.rollRareDrops([{ isBoss: true }, {}], (e) => data.rollSpecialDrop(30, e));
    for (const it of boss) assert.equal(it.unique, true);
    bossDrops += boss.length;
  }
  assert.ok(Math.abs(rareUnique / N - data.RARE_UNIQUE_CHANCE) < 0.03, rareUnique / N);
  assert.ok(Math.abs(bossDrops / N - data.BOSS_UNIQUE_CHANCE) < 0.015, bossDrops / N);
});

function setup() {
  const state = createState({ teamCount: 4 });
  const roster = createRoster({ data, state });
  const inv = createInventory({ data, state, roster });
  return { state, roster, inv };
}

test("特殊効果と呪い: 付けると能力値の割合・パッシブに反映される", () => {
  const { roster } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human", { level: 20 });
  const sr = data.RARITIES.find((r) => r.key === "sr");
  const base = roster.computeStats(c);
  c.equip.main = rewards.createItem(data.getUniqueItem("v_curse_sword"), sr, "u1"); // ATK+15%／呪い: 被ダメージ+10%
  const b = roster.setBonuses(c);
  assert.equal(b.uniques.length, 1);
  assert.equal(b.stats.atk, 0.15);
  assert.ok(Math.abs(roster.gearPassive(c, "dmgTakenMult") - 1.1) < 1e-9);
  assert.ok(roster.computeStats(c).atk > base.atk);
  c.equip.acc1 = rewards.createItem(data.getUniqueItem("v_brooch"), sr, "u2"); // 被ダメージ-3%
  assert.ok(Math.abs(roster.gearPassive(c, "dmgTakenMult") - 1.1 * 0.97) < 1e-9);
});

test("おまかせ装備: 呪いの装備は選ばない", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const sr = data.RARITIES.find((r) => r.key === "sr");
  const cursed = rewards.createItem(data.getUniqueItem("v_curse_sword"), sr, "u1");
  const normal = rewards.createItem(data.getItemBase("bronze_sword"), data.RARITIES[0], "n1");
  state.inventory.push(cursed, normal);
  inv.autoEquip(c);
  assert.equal(c.equip.main, normal);
  assert.ok(state.inventory.includes(cursed));
  // 自分で付けることはできる
  assert.equal(inv.equipItem(c, cursed, "main"), true);
});

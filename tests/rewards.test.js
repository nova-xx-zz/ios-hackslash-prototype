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
  const base = data.ITEM_BASES.find((b) => b.key === item.base);
  assert.equal(item.name, base.name);
  assert.deepEqual(Object.keys(item.stats), Object.keys(base.stats));
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

test("装備のレベル: 拾ったダンジョンの推奨Lvで能力値が伸びる（1Lvごとに+12%）", () => {
  const base = data.ITEM_BASES.find((b) => b.key === "bronze_sword");
  const sr = data.RARITIES.find((r) => r.key === "sr");
  const lv1 = rewards.createItem(base, sr, "a");
  const lv11 = rewards.createItem(base, sr, "b", { level: 11, levelGrowth: data.ITEM_LEVEL_GROWTH });
  assert.equal(lv1.level, 1);
  assert.equal(lv1.stats.atk, Math.round(base.stats.atk * sr.mult));
  assert.equal(lv11.level, 11);
  assert.equal(lv11.stats.atk, Math.round(base.stats.atk * sr.mult * (1 + 10 * data.ITEM_LEVEL_GROWTH)));
  assert.ok(lv11.stats.atk > lv1.stats.atk);
});

test("レア敵: 倒したレア敵1体につき1個、SR以上の装備を落とす", () => {
  const drops = rewards.rollRareDrops([{ isRare: true }, {}, { isRare: true }], () => data.rollItemDrop(5, data.RARE_DROP_MIN_RARITY));
  assert.equal(drops.length, 2);
  for (const it of drops) {
    assert.ok(["sr", "ur", "lr"].includes(it.rarity), it.rarity);
    assert.equal(it.level, 5);
  }
  assert.deepEqual(rewards.rollRareDrops([{}, {}], () => ({})), []);
});

test("レア敵の出現: ボス戦以外で、たまに1体だけそのダンジョンのレア敵に入れ替わる", () => {
  const rngLib = require("../js/core/rng.js");
  rngLib.setSharedSeed(99);
  const d = data.getDungeon("plains");
  let battles = 0, withRare = 0;
  for (let n = 0; n < 4000; n++) {
    const enemies = data.buildEncounter(d, 0);
    const rares = enemies.filter((e) => e.isRare);
    assert.ok(rares.length <= 1);
    for (const e of rares) {
      assert.ok(d.rares.includes(e.key));
      assert.ok(e.name.startsWith("★"));
    }
    battles += 1;
    if (rares.length) withRare += 1;
    assert.ok(data.buildEncounter(d, d.battles - 1).every((e) => !e.isRare), "ボス戦には出ない");
  }
  rngLib.setSharedSeed(undefined);
  const rate = withRare / battles;
  assert.ok(rate > 0.025 && rate < 0.06, `出現率 ${rate}`);
});

test("地方: すべてのダンジョンは定義された地方に属し、地方の順に並ぶ", () => {
  const order = data.REGIONS.map((r) => r.id);
  let last = 0;
  for (const d of data.DUNGEONS) {
    const i = order.indexOf(d.region);
    assert.ok(i >= 0, `${d.id} の地方 ${d.region} が REGIONS に無い`);
    assert.ok(i >= last, `${d.id} が地方の順に並んでいない`);
    last = i;
    for (const k of [...d.pool, d.boss, ...(d.rares || [])]) assert.ok(data.getEnemyTemplate(k), `${d.id} の ${k} が未定義`);
    for (const k of d.rares || []) assert.equal(data.getEnemyTemplate(k).rare, true, `${k} に rare: true が無い`);
  }
});

test("シリーズ: ダンジョンの推奨Lvの地方のシリーズが落ちる（地方ごとに8シリーズ×26種類＝208種類）", () => {
  assert.equal(data.ITEM_BASES.length, data.ITEM_SERIES.length * data.ITEM_TYPES.length);
  assert.equal(new Set(data.ITEM_BASES.map((b) => b.key)).size, data.ITEM_BASES.length);
  for (const d of data.DUNGEONS) {
    const expected = data.seriesForLevel(d.level).key;
    for (let i = 0; i < 5; i++) {
      const it = data.rollItemDrop(d.level);
      if (it.unique) continue; // まれに名のある装備（シリーズなし。tests/uniques.test.js）
      assert.equal(it.series, expected, d.id);
    }
  }
  assert.equal(data.seriesForLevel(1).key, "bronze");
  assert.equal(data.seriesForLevel(100).key, "abyss");
});

test("強化値込みの能力値: 主能力を基準に、ほかの能力値も元の値の比率で伸びる", () => {
  const it = { stats: { def: 10, hp: 20 }, rarity: "sr", plus: 0 };
  assert.deepEqual(data.itemStats(it), { def: 10, hp: 20 });
  it.plus = 10;
  const sr = data.RARITIES.find((r) => r.key === "sr").mult;
  assert.deepEqual(data.itemStats(it), { def: 10 + Math.ceil(10 * sr * 0.08), hp: 20 + Math.ceil(10 * sr * 0.08 * 2) });
  // 旧形式（stat・value）も読める
  assert.deepEqual(data.itemStats({ stat: "atk", value: 3, rarity: "n", plus: 0 }), { atk: 3 });
});

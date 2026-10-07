// 実行: node --test（リポジトリ直下で）
// テイムしたモンスターの個体値（js/core/stats.js）: 決め方・能力値への反映・評価・同族合成での引き継ぎ
const test = require("node:test");
const assert = require("node:assert/strict");
const statsCore = require("../js/core/stats.js");
const { createRng } = require("../js/core/rng.js");
const { createRoster } = require("../js/model/roster.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRunner } = require("../js/model/run.js");
const { createState, serialize, deserialize } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup() {
  const state = createState({ teamCount: 4 });
  const rng = createRng(3);
  let Runner = null;
  const roster = createRoster({ data, state, runBuffs: (t) => Runner.runBuffs(t), isTeamLocked: () => false });
  const inv = createInventory({ data, state, roster, rng });
  Runner = createRunner({ data, state, roster, inventory: inv, rng, teamCount: 4, battleEnv: () => ({}), autoDisassemble: () => ({ enabled: false, rarities: new Set() }), markDexSeen: () => {}, setBestStage: () => {}, now: () => 0 });
  return { state, roster, inv, Runner, rng };
}

test("個体値: テイムすると能力値ごとに0.9〜1.1倍で決まり、平均はおよそ1.0倍", () => {
  const { Runner } = setup();
  const all = [];
  for (let i = 0; i < 300; i++) {
    const mon = Runner.addTamedMonster("slime");
    assert.deepEqual(Object.keys(mon.ivs).sort(), [...statsCore.IV_KEYS].sort());
    for (const v of Object.values(mon.ivs)) { assert.ok(v >= 0.9 && v <= 1.1, v); all.push(v); }
  }
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  assert.ok(Math.abs(avg - 1) < 0.01, avg);
});

test("個体値: 基礎ステータスに掛かる。個体値の無いキャラ（人間・以前のモンスター）は今までどおり", () => {
  const { roster } = setup();
  const plain = roster.newCharacter("A", null, "wolf", { isMonster: true, level: 30 });
  const good = roster.newCharacter("B", null, "wolf", { isMonster: true, level: 30 });
  good.ivs = { hp: 1.1, mp: 1, atk: 1.1, mag: 1, def: 0.9, spd: 1.05 };
  const a = roster.computeStats(plain), b = roster.computeStats(good);
  assert.equal(b.maxHp, Math.round(a.maxHp * 1.1));
  assert.equal(b.atk, Math.round(a.atk * 1.1));
  assert.equal(b.def, Math.round(a.def * 0.9));
  assert.equal(b.maxMp, a.maxMp);
  assert.equal(b.spd, Math.round(a.spd * 1.05 * 100) / 100);
  const human = roster.newCharacter("C", "warrior", "human", { level: 10 });
  assert.equal(human.ivs, undefined);
});

test("個体値の評価: 平均でS/A/B/C/D。無ければ評価なし", () => {
  const all = (v) => Object.fromEntries(statsCore.IV_KEYS.map((k) => [k, v]));
  assert.equal(statsCore.ivRank(all(1.1)), "S");
  assert.equal(statsCore.ivRank(all(1.02)), "A");
  assert.equal(statsCore.ivRank(all(1)), "B");
  assert.equal(statsCore.ivRank(all(0.97)), "C");
  assert.equal(statsCore.ivRank(all(0.9)), "D");
  assert.equal(statsCore.ivRank(undefined), null);
});

test("同族合成: 素材の方が高い個体値だけ少しずつ上がり（上限1.1）、他の種族の素材からは引き継がない", () => {
  const { state, roster, inv } = setup();
  const target = roster.newCharacter("T", null, "slime", { isMonster: true });
  target.ivs = { hp: 0.9, mp: 1, atk: 1.08, mag: 1, def: 1, spd: 1 };
  const same = roster.newCharacter("S", null, "slime", { isMonster: true });
  same.ivs = { hp: 1.1, mp: 0.95, atk: 1.1, mag: 1, def: 1, spd: 1 };
  const other = roster.newCharacter("O", null, "bat", { isMonster: true });
  other.ivs = { hp: 1.1, mp: 1.1, atk: 1.1, mag: 1.1, def: 1.1, spd: 1.1 };
  state.roster = [target, same, other];
  const r = inv.fuse(target, [same, other]);
  assert.deepEqual([...r.ivRaised].sort(), ["atk", "hp"]);
  assert.equal(target.ivs.hp, 0.96); // 0.9 + (1.1-0.9)*0.3
  assert.equal(target.ivs.atk, 1.09); // 差0.02の3割は0.006 → 最低0.01
  assert.equal(target.ivs.mp, 1); // 素材の方が低い
  assert.equal(target.ivs.def, 1); // 他の種族からは引き継がない
  // 何度重ねても上限は1.1
  for (let i = 0; i < 20; i++) statsCore.inheritIvs(target, same, data.MONSTER_IV_INHERIT, data.MONSTER_IV_RANGE);
  assert.equal(target.ivs.hp, 1.1);
  // 個体値の無い（以前の）モンスターは1.0倍から引き継ぐ
  const old = roster.newCharacter("X", null, "slime", { isMonster: true });
  statsCore.inheritIvs(old, same, data.MONSTER_IV_INHERIT, data.MONSTER_IV_RANGE);
  assert.equal(old.ivs.hp, 1.03);
  assert.equal(old.ivs.mp, 1);
});

test("個体値はセーブに残る", () => {
  const { state, Runner } = setup();
  const mon = Runner.addTamedMonster("bat");
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(state, { now: 1 }))), {});
  assert.deepEqual(loaded.state.roster.find((c) => c.id === mon.id).ivs, mon.ivs);
});

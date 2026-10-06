// 実行: node --test（リポジトリ直下で）
// ダンジョンのモード（ハード・エクストラ）とオプション効果（js/options.js）
const test = require("node:test");
const assert = require("node:assert/strict");
const rngLib = require("../js/core/rng.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createRunner } = require("../js/model/run.js");
const { createState } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

test("モード: ハードは推奨Lv+10・EXP1.5倍、エクストラは+25・EXP2倍。敵の強さの倍率はそのレベルのダンジョン相当", () => {
  const d = data.getDungeon("ruins");
  assert.equal(data.getModeDungeon("ruins", "normal"), d);
  assert.equal(data.getModeDungeon("ruins"), d);
  const hard = data.getModeDungeon("ruins", "hard");
  const extra = data.getModeDungeon("ruins", "extra");
  assert.deepEqual([hard.mode, hard.level, hard.baseLevel, hard.expMult], ["hard", d.level + 10, d.level, 1.5]);
  assert.deepEqual([extra.mode, extra.level, extra.expMult], ["extra", d.level + 25, 2]);
  // 補間: ちょうどその推奨Lvのダンジョンがあれば、その倍率
  const at = data.DUNGEONS.find((x) => x.level === hard.level);
  if (at) assert.equal(hard.power, at.power);
  assert.equal(data.powerForLevel(200), data.DUNGEONS[data.DUNGEONS.length - 1].power);
  assert.equal(d.mode, undefined); // 元のダンジョンは変えない
});

test("モード: EXPは同じ強さの敵のexpMult倍", () => {
  const hard = data.getModeDungeon("ruins", "hard");
  const plain = Object.assign({}, hard, { expMult: 1 });
  rngLib.setSharedSeed(11);
  const a = data.buildEncounter(plain, 0);
  rngLib.setSharedSeed(11);
  const b = data.buildEncounter(hard, 0);
  rngLib.setSharedSeed(undefined);
  assert.deepEqual(b.map((e) => e.key), a.map((e) => e.key));
  b.forEach((e, i) => assert.equal(e.exp, Math.round(a[i].exp * 1.5)));
});

test("オプション効果: ハードは1〜2個、エクストラは2〜3個、ノーマルは無し。重ならず、範囲内の値", () => {
  for (const [mode, [lo, hi]] of Object.entries(data.OPTION_COUNTS)) {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const it = data.rollItemDrop(40, undefined, { regionLevel: 30, mode });
      assert.equal(it.optionMode, mode);
      assert.ok(it.options.length >= lo && it.options.length <= hi, `${mode}: ${it.options.length}`);
      seen.add(it.options.length);
      assert.equal(new Set(it.options.map((o) => o.key)).size, it.options.length);
      for (const o of it.options) {
        const def = data.ITEM_OPTIONS.find((x) => x.key === o.key);
        if (def.kind !== "flat") assert.ok(o.value >= def.range[mode][0] - 1e-9 && o.value <= def.range[mode][1] + 1e-9, o.key);
        else assert.ok(o.value >= 1);
        assert.ok(data.itemOptionText(o).length > 0);
      }
      // シリーズは元の推奨Lv（regionLevel）の地方、装備のレベルは上がったレベル
      if (!it.unique) assert.equal(it.series, data.seriesForLevel(30).key);
      assert.equal(it.level, 40);
    }
    assert.deepEqual([...seen].sort(), [lo, hi]);
  }
  assert.equal(data.rollItemDrop(40).options, undefined);
});

test("オプション効果: エクストラの方が強い", () => {
  for (const def of data.ITEM_OPTIONS) {
    assert.ok(def.range.extra[0] >= def.range.hard[1] || def.range.extra[0] > def.range.hard[0], def.key);
    assert.ok(def.range.extra[1] > def.range.hard[1], def.key);
  }
  const avg = (mode) => {
    let total = 0;
    for (let i = 0; i < 400; i++) total += data.rollItemDrop(50, undefined, { mode }).options.length;
    return total / 400;
  };
  assert.ok(avg("extra") > avg("hard"));
});

function setup() {
  const state = createState({ teamCount: 4 });
  let Runner = null;
  const rng = rngLib.createRng(3);
  const roster = createRoster({ data, state, runBuffs: (t) => Runner.runBuffs(t), isTeamLocked: (t) => Runner.isTeamLocked(t) });
  const inventory = createInventory({ data, state, roster, rng });
  Runner = createRunner({
    data, state, roster, inventory, rng, teamCount: 4,
    battleEnv: () => ({}), autoDisassemble: () => ({ enabled: true, rarities: new Set(["n", "r", "sr", "ur", "lr"]) }),
    now: () => 1,
  });
  state.roster = [roster.newCharacter("アレン", "warrior", "human", { team: 0, level: 20 })];
  return { state, roster, inventory, Runner };
}

test("オプション効果の反映: 固定値・割合・パッシブ・パーティの獲得EXP/強化石", () => {
  const { state, roster, inventory } = setup();
  const c = state.roster[0];
  const before = roster.computeStats(c);
  const it = data.rollItemDrop(20);
  it.slot = "accessory"; it.type = "amulet"; it.stats = { hp: 1 }; delete it.options;
  it.options = [{ key: "atk_flat", value: 10 }, { key: "def_pct", value: 0.1 }, { key: "crit", value: 0.05 }, { key: "exp", value: 0.2 }, { key: "material", value: 0.1 }, { key: "guard", value: 0.05 }];
  c.equip.acc1 = it;
  const after = roster.computeStats(c);
  assert.equal(after.atk, before.atk + 10);
  assert.ok(after.def > before.def);
  assert.ok(Math.abs(roster.gearPassive(c, "critBonus") - 0.05) < 1e-9);
  assert.ok(Math.abs(roster.gearPassive(c, "dmgTakenMult") - 0.95) < 1e-9);
  assert.ok(Math.abs(roster.partyBonus(0, "expBonus") - 0.2) < 1e-9);
  // 強化石: 自動分解の量に倍率が掛かる
  const settled = inventory.receiveDrops([{ rarity: "n", materialValue: 100 }], { enabled: true, rarities: new Set(["n"]) }, 1.1);
  assert.equal(settled.materialGained, 110);
  assert.equal(state.material, 110);
});

test("周回: ハードの踏破はハードの記録に残り、次のダンジョンは開かない。履歴にモードを残す", () => {
  const { state, Runner } = setup();
  const run = Runner.startRun(0, "forest", "hard");
  assert.equal(run.dungeon.mode, "hard");
  run.battleIndex = run.dungeon.battles - 1;
  const { battle } = Runner.startBattle(run);
  for (const e of battle.enemies) e.alive = false;
  const res = Runner.winBattle(run, battle);
  assert.equal(res.isLast, true);
  assert.equal(res.firstClear, true);
  assert.deepEqual(res.unlocked, []);
  assert.ok(state.clearedHard.has("forest"));
  assert.equal(state.clearedDungeons.has("forest"), false);
  Runner.finishRun(run, true);
  assert.equal(state.records.runHistory[0].mode, "hard");
  for (const it of run.drops) assert.equal(it.optionMode, "hard");
});

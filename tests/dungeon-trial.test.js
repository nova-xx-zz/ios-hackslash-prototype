// node --test tests/dungeon-trial.test.js
// 既存ゲーム本体のループを変えずに「全階層の抽選」「上限5体」「全滅全ロスト」を検証。
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRng } = require("../js/core/rng.js");
const dungeon = require("../js/core/dungeon-trial.js");
const data = require("../tools/lib/load-data.js").loadGameData();

const { FLOOR_COUNTS, createFloorPlan, createEncounterPlan, weightedEnemyCount, advancePilotBossPhase, resolveTrialDrops } = dungeon;

test("35ダンジョンがちょうど一度ずつ3/5/10/15階層の試作に割り当てられている", () => {
  assert.equal(data.DUNGEONS.length, 35);
  assert.equal(Object.keys(FLOOR_COUNTS).length, 35);
  for (const d of data.DUNGEONS) assert.ok([3, 5, 10, 15].includes(FLOOR_COUNTS[d.id]), d.id);
  assert.deepEqual([FLOOR_COUNTS.plains, FLOOR_COUNTS.forest, FLOOR_COUNTS.cave, FLOOR_COUNTS.abyss_heart], [3, 3, 5, 15]);
});

test("突入時に全階層の通常戦闘回数とボスを一括抽選し、同じseedでは完全一致", () => {
  for (const d of data.DUNGEONS) {
    const p1 = createFloorPlan(d, createRng(20261016));
    const p2 = createFloorPlan(d, createRng(20261016));
    assert.deepEqual(p1, p2, d.id);
    assert.equal(p1.length, FLOOR_COUNTS[d.id], d.id);
    for (const plan of p1) {
      const [min, max] = dungeon.floorRange(plan.floor);
      assert.ok(plan.regularBattles >= min && plan.regularBattles <= max, d.id + " " + plan.floor);
      assert.equal(plan.completedBattles, 0);
      if (plan.floor >= 6) assert.ok(plan.regularBattles >= 3);
      const expectedBoss = plan.floor === p1.length ? "final" :
        [5, 10].includes(plan.floor) ? "mid" : null;
      assert.equal(plan.boss?.kind || null, expectedBoss, d.id + " " + plan.floor);
      if (plan.boss) assert.ok(data.getEnemyTemplate(plan.boss.key), d.id + ": " + plan.boss.key);
    }
  }
});

test("通常戦闘の敵数は常に1～5体、深層ほど集団が増加", () => {
  const r = createRng(123);
  let firstGroup = 0, deepGroup = 0;
  for (let i = 0; i < 12000; i++) {
    const a = weightedEnemyCount(1, r);
    const b = weightedEnemyCount(15, r);
    assert.ok(a >= 1 && a <= 5);
    assert.ok(b >= 1 && b <= 5);
    if (a >= 4) firstGroup++;
    if (b >= 4) deepGroup++;
  }
  assert.equal(firstGroup, 0);
  assert.ok(deepGroup > 5000);
});

test("ボス戦はボス・取り巻き込みで最大5体、3Fは単体、5Fは1～2体", () => {
  const r = createRng(987);
  for (const d of data.DUNGEONS) {
    const plans = createFloorPlan(d, r);
    for (const plan of plans) {
      const normal = createEncounterPlan(d, plan.floor, r);
      assert.ok(normal.enemies.length >= 1 && normal.enemies.length <= 5);
      assert.equal(normal.kind, "normal");
      if (!plan.boss) continue;
      const fight = createEncounterPlan(d, plan.floor, r, plan.boss);
      assert.equal(fight.bossKey, plan.boss.key);
      assert.equal(fight.enemies[0], plan.boss.key);
      assert.ok(fight.enemies.length >= 1 && fight.enemies.length <= 5, d.id + " " + plan.floor);
      if (plan.floor === 3) assert.equal(fight.enemies.length, 1);
      if (plan.floor === 5) assert.ok(fight.enemies.length <= 2);
    }
  }
});

test("3Fボスは単純1フェーズ、5Fロックゴーレムは60%で1度だけ鎧強化", () => {
  assert.deepEqual(advancePilotBossPhase("horned_rabbit", 1, 20), { phase: 1, effects: [] });
  const before = advancePilotBossPhase("rock_golem", 1, 61);
  assert.equal(before.phase, 1);
  assert.equal(before.effects.length, 0);
  const after = advancePilotBossPhase("rock_golem", 1, 60);
  assert.equal(after.phase, 2);
  assert.equal(after.effects[0].type, "defense");
  assert.equal(after.effects[0].mult, 1.25);
  const noRepeat = advancePilotBossPhase("rock_golem", after.phase, 20);
  assert.deepEqual(noRepeat, { phase: 2, effects: [] });
  assert.deepEqual(advancePilotBossPhase("rock_golem", 1, 0), { phase: 1, effects: [] }); // 撃破後の特殊行動なし
});

test("UR/LR・宝箱・中ボス報酬を含め、最終踏破以外は1件も確定しない", () => {
  const items = [{ id: "ur", rarity: "ur" }, { id: "lr", rarity: "lr" }, { id: "chest" }, { id: "mid-boss" }];
  for (const reason of ["defeat", "retreat", "timeout", "failed-boss"]) {
    const result = resolveTrialDrops(false, items);
    assert.equal(result.kept.length, 0, reason);
    assert.equal(result.lostCount, items.length, reason);
  }
  const cleared = resolveTrialDrops(true, items);
  assert.equal(cleared.kept.length, items.length);
  assert.equal(cleared.lostCount, 0);
  assert.notEqual(cleared.kept, items);
});

test("未知ダンジョン・不正階層・破損RNG入力を拒否する", () => {
  const d = data.getDungeon("plains");
  assert.throws(() => createFloorPlan({ id: "unknown", pool: ["slime"], boss: "slime" }, createRng(1)), RangeError);
  assert.throws(() => createFloorPlan(d, { int: () => 100 }), RangeError);
  assert.throws(() => createEncounterPlan(d, 4, createRng(1)), RangeError);
  assert.throws(() => createEncounterPlan(d, 3, createRng(1), { kind: "mid", key: "__unknown" }), TypeError);
  assert.throws(() => advancePilotBossPhase("rock_golem", 4, 20), RangeError);
});

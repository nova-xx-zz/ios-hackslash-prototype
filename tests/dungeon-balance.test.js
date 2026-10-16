"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScenario, measureScenario, runBalance, IDS, PROFILES } = require("../tools/dungeon-balance.js");

test("新階層バランスの測定対象が3F/5Fの実データに限定される", () => {
  assert.deepEqual(IDS, ["plains", "forest", "cave"]);
  assert.deepEqual(PROFILES.map(p => p.id), ["no-gear", "basic", "recommended", "refined", "thief"]);
  const a = buildScenario("cave", PROFILES.find(p => p.id === "no-gear"), 12);
  const b = buildScenario("cave", PROFILES.find(p => p.id === "refined"), 12);
  const weak = a.roster.computeStats(a.state.roster[0]);
  const strong = b.roster.computeStats(b.state.roster[0]);
  assert.ok(strong.atk > weak.atk && strong.def > weak.def);
  assert.ok(b.state.roster[0].equip.main.options.length === 1, "must have valid hard-mode OP");
  assert.equal(b.state.roster[0].equip.main.optionMode, "hard");
  assert.equal(a.state.inventory.length, 0, "benchmark must never modify player inventory");
});

test("盗賊入りの強さと解錠は実際のパーティ・Lvから取得される", () => {
  const profile = PROFILES.find(p => p.id === "thief");
  const prepared = buildScenario("cave", profile, 3001);
  assert.equal(prepared.state.roster[1].job, "thief");
  assert.equal(prepared.roster.explorationSkillChance(prepared.state.roster[1], "thief_lockpick"), 0.45);
  const grass = buildScenario("plains", profile, 3001);
  assert.equal(grass.roster.explorationSkillChance(grass.state.roster[1], "thief_lockpick"), 0);
});

test("測定の再現性: 同じseed・同じ装備の実戦闘で全メトリクス一致", () => {
  const a = measureScenario("plains", "recommended", 4, 88);
  const b = measureScenario("plains", "recommended", 4, 88);
  assert.deepEqual(a, b);
  assert.equal(a.clear + a.failure, 4);
  assert.equal(a.failedItemsCarried, 0);
  assert.ok(a.avgSec > 0);
});

test("3F/5F実戦闘の1周ごとで敗北後に1品も持ち帰らない", () => {
  const run = runBalance(2);
  assert.equal(run.results.length, 14);
  for (const r of run.results) {
    assert.equal(r.trials, 2);
    assert.equal(r.failure + r.clear, 2);
    assert.equal(r.failedItemsCarried, 0);
    assert.ok(r.carriedItems >= 0);
    assert.ok(Number.isFinite(r.avgSec));
    assert.ok(r.avgClearSec === null || r.avgClearSec >= 0);
    assert.ok(r.lockSuccess <= r.lockAttempts && r.lockAttempts <= r.lockedFound);
  }
});

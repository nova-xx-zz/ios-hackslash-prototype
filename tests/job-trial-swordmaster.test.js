// node --test tests/job-trial-swordmaster.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const pilot = require("../js/core/job-trial-swordmaster.js");
const { createState, serialize, deserialize } = require("../js/model/save.js");
const { createRoster } = require("../js/model/roster.js");
const { createRunner } = require("../js/model/run.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup(enabled = true) {
  const state = createState({ teamCount: 4 });
  const rng = createRng(131);
  const flags = (key) => key === "jobTrialSwordmaster" ? enabled : data.isFeatureEnabled(key);
  let runner;
  const roster = createRoster({
    data: { ...data, isFeatureEnabled: flags }, state,
    runBuffs: (team) => runner && runner.runBuffs(team),
    isTeamLocked: (team) => runner && runner.isTeamLocked(team),
  });
  const inv = createInventory({ data, state, roster, rng, isFeatureEnabled: flags });
  runner = createRunner({
    data: { ...data, isFeatureEnabled: flags },
    state, roster, inventory: inv, rng, teamCount: 4,
    battleEnv: () => ({
      rng, atbRate: 7, stats: roster.computeStats,
      abilities: (c) => roster.availableAbilities(c).filter((a) => roster.isSkillActive(c, a.id)),
      mpCost: (c, a) => a.mpCost, tier: () => 2,
      passives: (c) => ({
        lifesteal: roster.racePassive(c, "lifesteal") + roster.treePassive(c, "lifesteal"),
        healBonus: roster.racePassive(c, "healBonus") + roster.treePassive(c, "healBonus"),
        critBonus: roster.racePassive(c, "critBonus") + roster.treePassive(c, "critBonus"),
        dmgTakenMult: (roster.racePassive(c, "dmgTakenMult") || 1) * (roster.treePassive(c, "dmgTakenMult") || 1),
      }),
    }),
    autoDisassemble: () => ({ enabled: false, rarities: new Set() }),
    markDexSeen: () => {}, setBestStage: () => {},
  });
  const warrior = roster.newCharacter("アレン", "warrior", "human", { level: 50, team: 0 });
  const mage = roster.newCharacter("ミナ", "mage", "human", { level: 50, team: 0 });
  state.roster.push(warrior, mage);
  return { state, rng, roster, runner, warrior, mage };
}

test("default: pilot flag OFF keeps the existing Lv50 job change", () => {
  const { roster, warrior } = setup(false);
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), true);
  roster.switchJob(warrior, "swordmaster");
  assert.equal(warrior.job, "swordmaster");
});
test("Lv50 and 100 valid warrior hits (or 15 full clears) open trial; no premature job change", () => {
  const { state, roster, warrior } = setup();
  assert.equal(pilot.status(state, warrior, true).trialAvailable, false);
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), false);
  assert.equal(roster.switchJob(warrior, "swordmaster"), false);
  assert.equal(warrior.job, "warrior");
  pilot.recordClear(state, [warrior], 99);
  assert.equal(state.jobTrialSwordmaster.warriorHits, 99);
  assert.equal(pilot.status(state, warrior, true).trialAvailable, false);
  pilot.recordClear(state, [warrior], 1);
  assert.equal(pilot.status(state, warrior, true).trialAvailable, true);
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), false);
  assert.equal(pilot.recordTrialClear(state), true);
  assert.equal(pilot.recordTrialClear(state), false);
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), true);
  roster.switchJob(warrior, "swordmaster");
  assert.equal(warrior.job, "swordmaster");
  assert.equal(warrior.level, 1);
});
test("low-level character cannot change even when another character cleared trial", () => {
  const { state, roster, warrior } = setup();
  state.jobTrialSwordmaster.trialCleared = true;
  warrior.jobLevels.warrior.level = 49;
  warrior.level = 49;
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), false);
});
test("account achievements accumulate only for surviving human warriors", () => {
  const { state, warrior, mage } = setup();
  assert.equal(pilot.recordClear(state, [mage], 80), false);
  assert.equal(state.jobTrialSwordmaster.warriorHits, 0);
  warrior.alive = false;
  assert.equal(pilot.recordClear(state, [warrior, mage], 80), false);
  warrior.alive = true;
  for (let i = 0; i < 15; i++) pilot.recordClear(state, [warrior, mage], 0);
  assert.equal(pilot.status(state, warrior, true).achievementReady, true);
  assert.equal(state.jobTrialSwordmaster.warriorClears, 15);
});
test("run finish awards only once and only on clear; offline grants no fictional hits", () => {
  const { state, runner } = setup();
  const run = runner.startRun(0, "plains");
  run.jobTrialWarriorHits = 13;
  runner.finishRun(run, false);
  assert.equal(state.jobTrialSwordmaster.warriorHits, 0);
  assert.equal(state.jobTrialSwordmaster.warriorClears, 0);
  const next = runner.startRun(0, "plains");
  next.jobTrialWarriorHits = 21;
  runner.finishRun(next, true);
  runner.finishRun(next, true);
  assert.equal(state.jobTrialSwordmaster.warriorHits, 21);
  assert.equal(state.jobTrialSwordmaster.warriorClears, 1);
  runner.applyOfflineRun({
    cleared: true, encountered: [], drops: [], expByBattle: [], eligibleIdsByBattle: [["c1"]],
    tame: null,
  }, data.getDungeon("plains"), 0);
  assert.equal(state.jobTrialSwordmaster.warriorClears, 2);
  assert.equal(state.jobTrialSwordmaster.warriorHits, 21);
});
test("optional save field roundtrips and previous save defaults to zero", () => {
  const { state, warrior } = setup();
  pilot.recordClear(state, [warrior], 25);
  const saved = serialize(state, { now: 123 });
  const read = deserialize(saved, { teamCount: 4, syncExpToNext: data.syncExpToNext });
  assert.equal(read.state.jobTrialSwordmaster.warriorHits, 25);
  assert.equal(read.state.jobTrialSwordmaster.warriorClears, 1);
  delete saved.jobTrialSwordmaster;
  assert.deepEqual(deserialize(saved, { teamCount: 4 }).state.jobTrialSwordmaster, pilot.normalize(null));
  assert.deepEqual(pilot.normalize({ warriorHits: -3, warriorClears: Infinity, trialCleared: "true" }), pilot.normalize(null));
});
test("trial uses existing real combat and does not credit XP, loot, or full dungeon clear", () => {
  const { state, runner } = setup();
  const before = serialize(state, { now: 456 });
  const trial = pilot.trialDungeon(data.getDungeon("lava_river"));
  assert.equal(trial.id, pilot.TRIAL_DUNGEON_ID);
  assert.equal(trial.battles, 3);
  const outcome = runner.computeOfflineRun(trial, 0, { maxEnemies: 5 });
  assert.equal(typeof outcome.cleared, "boolean");
  assert.deepEqual(serialize(state, { now: 456 }), before);
});
test("legacy swordmaster training remains accessible in trial", () => {
  const { state, roster, warrior } = setup();
  warrior.jobLevels.swordmaster = { level: 4, exp: 0, expToNext: data.expForLevel(4) };
  assert.equal(pilot.status(state, warrior, true).legacy, true);
  assert.equal(roster.jobUnlocked(warrior, "swordmaster"), true);
});

test("real battle damage events increment run warriorHits and ignore unrelated team", () => {
  const { state, runner } = setup();
  state.roster = state.roster.filter((c) => c.job === "warrior"); // 実データのLv50戦士のみ
  const run = runner.startRun(0, "plains");
  runner.startBattle(run);
  for (let i = 0; i < 50000 && run.jobTrialWarriorHits === 0; i++) {
    const out = runner.stepBattle(0, 0.05);
    if (out.result) break;
  }
  assert.ok(run.jobTrialWarriorHits >= 1, "有効打は実際のdamageイベントから計測する");
  assert.equal(state.jobTrialSwordmaster.warriorHits, 0, "踏破前はセーブ対象に加算しない");
});

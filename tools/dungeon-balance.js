#!/usr/bin/env node
"use strict";
/*
 * Dungeon floor-pilot balance harness (normal difficulty, live model + offline real battle).
 * node tools/dungeon-balance.js --trials=32
 * NOTE: this does NOT modify game balance, save files, or production settings.
 *
 * Normal/strengthened/OP builds share the same fixed seed per dungeon and use
 * the real makeEnemy, battle.simulate, skill trees, item stats/options,
 * dungeon-trial floor/event rolls, and drop generation via Runner.computeOfflineRun.
 */
const { createState } = require("../js/model/save.js");
const { createRoster } = require("../js/model/roster.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRunner } = require("../js/model/run.js");
const { createRng } = require("../js/core/rng.js");
const { settleDrops } = require("../js/core/rewards.js");
const dungeonTrial = require("../js/core/dungeon-trial.js");
const { data, STARTER_PARTY, standardEquip, standardTreeRanks } = require("./lib/sim.js");
const { benchmarkGearLevel } = require("./lib/difficulty.js");

const IDS = Object.freeze(["plains", "forest", "cave"]);
const PROFILES = Object.freeze([
  { id: "no-gear", label: "無装備（ツリーなし）", tree: false, gear: "none" },
  { id: "basic", label: "N+0装備（ツリーなし）", tree: false, gear: "basic" },
  { id: "recommended", label: "適正装備＋ツリー", tree: true, gear: "recommended" },
  { id: "reinforced", label: "強化+4＋ツリー（OPなし）", tree: true, gear: "reinforced" },
  { id: "refined", label: "適正装備強化＋厳選OP＋ツリー", tree: true, gear: "refined" },
  { id: "thief", label: "適正装備＋ツリー（盗賊入り）", tree: true, gear: "recommended", thief: true },
  { id: "thief-unskilled", label: "同じ盗賊編成（解錠なし）", tree: true, gear: "recommended", thief: true, disableSkill: true },
]);
const SEEDS = { plains: 10531, forest: 20813, cave: 30721 };
const FIXED_OPS = Object.freeze({
  warrior: "atk_pct", thief: "atk_pct", mage: "mag_pct", priest: "heal",
});
const DISASSEMBLE = { enabled: true, rarities: new Set(["n"]) };

function equipScenario(c, roster, d, profile) {
  if (profile.tree) {
    const state = roster.getTreeState(c);
    const chosen = standardTreeRanks(c.job, c.level);
    if (chosen.length !== 1 + data.GENERAL_SLOTS.length) throw Error("unexpected tree layout");
    state.exclusiveRanks = Object.assign({}, chosen[0].ranks);
    for (let i = 0; i < data.GENERAL_SLOTS.length; i++) {
      const slot = data.GENERAL_SLOTS[i].key;
      state.general[slot].ranks = Object.assign({}, chosen[i + 1].ranks);
    }
  }
  if (profile.gear === "none") return;
  const gearLevel = benchmarkGearLevel(d);
  const benchmark = d.benchmarkGear || { rarity: "n", plus: 0 };
  const plus = ["refined", "reinforced"].includes(profile.gear) ? benchmark.plus + 4
    : profile.gear === "basic" ? 0 : benchmark.plus;
  const gear = { rarity: profile.gear === "basic" ? "n" : benchmark.rarity, plus, level: gearLevel };
  c.equip = standardEquip(c.job, gear, roster.accessorySlots(c));
  if (profile.gear === "refined") {
    // Real supported OPTION keys, one max-range hard-mode OP on each piece.
    // These are an OPTIMISTIC curated loadout, not an estimate of how often such gear drops.
    for (const item of Object.values(c.equip)) {
      if (!item) continue;
      const opt = item.slot === "weapon"
        ? { key: FIXED_OPS[c.job] || "atk_pct", value: c.job === "priest" ? 0.10 : 0.06 }
        : item.slot === "body" ? { key: "def_pct", value: 0.06 }
        : item.slot === "head" ? { key: "hp_pct", value: 0.06 }
        : item.slot === "accessory" ? { key: "guard", value: 0.04 }
        : { key: "def_pct", value: 0.06 };
      item.options = [opt];
      item.optionMode = "hard";
    }
  }
}
function buildScenario(dungeonId, profile, seed) {
  if (!IDS.includes(dungeonId) || !PROFILES.some(p => p.id === profile.id)) throw Error("invalid scenario");
  const d = data.getDungeon(dungeonId);
  const state = createState({ teamCount: 4 });
  const rng = createRng(seed);
  let runner = null;
  const roster = createRoster({
    data, state, runBuffs: (team) => runner ? runner.runBuffs(team) : null,
    isTeamLocked: (team) => runner ? runner.isTeamLocked(team) : false,
  });
  const inventory = createInventory({ data, state, roster, rng, isFeatureEnabled: data.isFeatureEnabled });
  const specs = STARTER_PARTY.map(x => Object.assign({}, x));
  if (profile.thief) specs[1] = { job: "thief", race: "beastkin" };
  state.roster = specs.map((spec, i) => {
    const c = roster.newCharacter("測定員" + i, spec.job, spec.race, { team: 0, level: d.level });
    equipScenario(c, roster, d, profile);
    const s = roster.computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp;
    return c;
  });
  if (profile.disableSkill) {
    const original = roster.explorationSkillChance;
    roster.explorationSkillChance = (c, id) => id === "thief_lockpick" ? 0 : original(c, id);
  }
  const env = () => ({
    rng, atbRate: 7,
    stats: roster.computeStats,
    abilities: (c) => roster.availableAbilities(c).filter(a => roster.isSkillActive(c, a.id)),
    mpCost: (c, a) => Math.max(0, Math.round(a.mpCost * (roster.racePassive(c, "mpCostMult") || 1) * (roster.treePassive(c, "mpCostMult") || 1))),
    tier: () => 2,
    passives: (c) => ({
      lifesteal: roster.racePassive(c, "lifesteal") + roster.treePassive(c, "lifesteal"),
      healBonus: roster.racePassive(c, "healBonus") + roster.treePassive(c, "healBonus"),
      critBonus: roster.racePassive(c, "critBonus") + roster.treePassive(c, "critBonus"),
      dmgTakenMult: (roster.racePassive(c, "dmgTakenMult") || 1) * (roster.treePassive(c, "dmgTakenMult") || 1),
      pierce: roster.treePassive(c, "pierce") || 0,
    }),
  });
  runner = createRunner({
    data, state, roster, inventory, rng, teamCount: 4, battleEnv: env,
    enableFloorPilot: true,
    autoDisassemble: () => DISASSEMBLE,
    markDexSeen: () => {}, setBestStage: () => {},
  });
  return { d, state, roster, runner };
}

function measureScenario(dungeonId, profileId, trials, seed) {
  const profile = PROFILES.find(p => p.id === profileId);
  if (!profile || !Number.isInteger(trials) || trials < 1 || trials > 2000) throw new RangeError("bad trials/profile");
  const setup = buildScenario(dungeonId, profile, seed === undefined ? SEEDS[dungeonId] : seed);
  const stats = { dungeonId, profileId, level: setup.d.level, trials, clear: 0, failure: 0,
    allSeconds: 0, clearedSeconds: 0, combatWins: 0, confirmedDrops: 0, carriedItems: 0,
    dismantledItems: 0, carriesUrLr: 0, dismantleStones: 0, lockedFound: 0, lockAttempts: 0,
    lockSuccess: 0, normalTreasure: 0, springAura: 0, maxEnemies: 0,
    maxFloors: dungeonTrial.FLOOR_COUNTS[dungeonId], failedItemsCarried: 0 };
  const origEvent = dungeonTrial.rollPilotEvent;
  dungeonTrial.rollPilotEvent = function instrumentedRoll(rng, chance, rollOne) {
    const evt = origEvent(rng, chance, rollOne);
    if (evt && evt.kind === "lockedTreasure") {
      stats.lockedFound++;
      if (evt.attempted) stats.lockAttempts++;
      if (evt.success) stats.lockSuccess++;
    }
    if (evt && evt.kind === "treasure") stats.normalTreasure++;
    if (evt && evt.kind === "springAura") stats.springAura++;
    return evt;
  };
  try {
    for (let i = 0; i < trials; i++) {
      const outcome = setup.runner.computeOfflineRun(setup.d, 0);
      stats.allSeconds += outcome.seconds;
      stats.combatWins += outcome.expByBattle.length;
      if (outcome.cleared) {
        stats.clear++;
        stats.clearedSeconds += outcome.seconds;
        const settled = settleDrops(outcome.drops, DISASSEMBLE);
        stats.confirmedDrops += outcome.drops.length;
        stats.carriedItems += settled.kept.length;
        stats.dismantledItems += settled.disassembled;
        stats.carriesUrLr += settled.kept.filter(x => x.rarity === "ur" || x.rarity === "lr").length;
        stats.dismantleStones += settled.materialGained;
      } else {
        stats.failure++;
        // Offline engine returns zero drops on failed runs: full-loss rule.
        if (outcome.drops.length !== 0) throw Error("failed dungeon leaked drops");
        stats.failedItemsCarried += outcome.drops.length;
      }
    }
  } finally { dungeonTrial.rollPilotEvent = origEvent; }
  const round = n => Math.round(n * 100) / 100;
  return Object.assign(stats, {
    clearPct: round(100 * stats.clear / trials),
    avgSec: round(stats.allSeconds / trials),
    avgClearSec: stats.clear ? round(stats.clearedSeconds / stats.clear) : null,
    avgConfirmedDropsPerAttempt: round(stats.confirmedDrops / trials),
    avgItemsPerAttempt: round(stats.carriedItems / trials),
    avgItemsPerClear: stats.clear ? round(stats.carriedItems / stats.clear) : null,
    stonesPerAttempt: round(stats.dismantleStones / trials),
    avgUrLrPerAttempt: round(stats.carriesUrLr / trials),
    observedUnlockPct: stats.lockAttempts ? round(100 * stats.lockSuccess / stats.lockAttempts) : null,
  });
}

function runBalance(trials = 32) {
  const results = [];
  for (const id of IDS) for (const profile of PROFILES) {
    if (id === "plains" && profile.thief) continue; // Lv1 cannot learn lockpick
    if (profile.disableSkill && id !== "cave") continue; // only cave is Lv5+ within this pilot
    results.push(measureScenario(id, profile.id, trials, SEEDS[id]));
  }
  return { schema: 1, trials, seedByDungeon: SEEDS, results };
}
function printReport(result) {
  console.log("DUNGEON_BALANCE_V1 trials=" + result.trials + " (normal; x1 game seconds)");
  console.log("dungeon profile clear% avgSec avgClearSec confirmedDrops/try keptItems/try stonesPerTry urLrPerTry lockOpened/found");
  for (const r of result.results) {
    console.log([r.dungeonId, r.profileId, r.clearPct.toFixed(1), r.avgSec,
      r.avgClearSec === null ? "n/a" : r.avgClearSec,
      r.avgConfirmedDropsPerAttempt, r.avgItemsPerAttempt, r.stonesPerAttempt, r.avgUrLrPerAttempt,
      r.lockSuccess + "/" + r.lockedFound].join(" "));
  }
  console.log("BALANCE_JSON=" + JSON.stringify(result));
}
if (require.main === module) {
  const input = process.argv.find(a => a.startsWith("--trials="));
  const trials = input ? Number(input.split("=")[1]) : 32;
  printReport(runBalance(trials));
}
module.exports = { buildScenario, measureScenario, runBalance, printReport, PROFILES, IDS, SEEDS };

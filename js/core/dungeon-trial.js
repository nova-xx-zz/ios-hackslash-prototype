// ダンジョン階層・ボスの隔離試作（本体runには未接続）。
// 既存の35ダンジョンを3/5/10/15階層に仮割当し、戦闘計画・敵編成・
// 序盤ボスのフェーズ・全滅時ロストをデータのみで検証する。
// RNGは js/core/rng.js のシード付きインターフェイスを注入する。
(function (root) {
  "use strict";

  // これらは設計上の仮配置。35ダンジョンへの本採用前にプレイ時間・難易度を再測定。
  const FLOOR_COUNTS = Object.freeze({
    plains: 3, forest: 3, cave: 5, ruins: 5, peak: 5,
    dunes: 5, canyon: 5, oasis: 5, tomb: 10, sun_temple: 10,
    frost_forest: 10, frozen_lake: 10, crystal_cave: 10, snow_fort: 10, ice_throne: 10,
    ash_plains: 10, lava_river: 10, forge_ruins: 10, crater: 10, inferno_peak: 10,
    coral_reef: 10, ghost_ship: 10, sea_cave: 10, sunken_city: 15, leviathan_trench: 15,
    cloud_road: 15, floating_isle: 15, sky_garden: 15, thunder_spire: 15, celestial_palace: 15,
    abyss_gate: 15, shadow_labyrinth: 15, abyss_sea: 15, fallen_citadel: 15, abyss_heart: 15,
  });

  // 重みの合計は常に100。出現数は1～5体。深い階層ほど4～5体に偏る。
  const ENCOUNTER_WEIGHTS = Object.freeze([
    Object.freeze([55, 30, 15, 0, 0]),
    Object.freeze([35, 35, 20, 8, 2]),
    Object.freeze([20, 25, 25, 20, 10]),
    Object.freeze([10, 15, 25, 25, 25]),
  ]);

  // 特殊技はまだ実戦のbattle.jsには接続しない。ログ・ステータス倍率の試作データ。
  const PILOT_BOSSES = Object.freeze({
    horned_rabbit: Object.freeze({ name: "ツノウサギ", thresholds: [], effects: [] }),
    elder_treant: Object.freeze({ name: "エルダートレント", thresholds: [], effects: [] }),
    rock_golem: Object.freeze({
      name: "ロックゴーレム",
      thresholds: [60],
      effects: [Object.freeze({ id: "stone_guard", type: "defense", mult: 1.25,
        hint: "岩の鎧が閉じていく。硬い殻に亀裂が見える……。" })],
    }),
  });

  function validateRng(rng) {
    if (!rng || typeof rng.int !== "function") throw new TypeError("rng.int is required");
  }

  function requireDungeon(dungeon) {
    if (!dungeon || !Object.prototype.hasOwnProperty.call(FLOOR_COUNTS, dungeon.id)) {
      throw new RangeError("Unknown dungeon in floor trial");
    }
    if (!Array.isArray(dungeon.pool) || !dungeon.pool.length || !dungeon.boss) {
      throw new TypeError("Dungeon must contain pool and boss");
    }
    return FLOOR_COUNTS[dungeon.id];
  }

  function floorRange(floor) {
    if (!Number.isInteger(floor) || floor < 1 || floor > 15) throw new RangeError("floor must be 1..15");
    return floor <= 2 ? [1, 3] : floor <= 5 ? [2, 4] : floor <= 10 ? [3, 5] : [3, 6];
  }

  function tierIndex(floor) {
    floorRange(floor);
    return floor <= 2 ? 0 : floor <= 5 ? 1 : floor <= 10 ? 2 : 3;
  }

  function bossAtFloor(dungeon, floor, totalFloors) {
    if (floor === totalFloors) return { kind: "final", key: dungeon.boss };
    if (floor !== 5 && floor !== 10) return null;
    // 中ボスの正式割当は別途。試作では既存poolから決定的に候補を選ぶ。
    // 名前/戦闘バランスを確定したものではない。
    const idx = floor === 5 ? dungeon.pool.length - 1 : dungeon.pool.length - 2;
    return { kind: "mid", key: dungeon.pool[Math.max(0, idx)] };
  }

  function createFloorPlan(dungeon, rng) {
    validateRng(rng);
    const totalFloors = requireDungeon(dungeon);
    const floorPlans = [];
    for (let floor = 1; floor <= totalFloors; floor += 1) {
      const [min, max] = floorRange(floor);
      const count = min + rng.int(max - min + 1);
      if (!Number.isInteger(count) || count < min || count > max) throw new RangeError("invalid RNG result");
      floorPlans.push({
        floor, regularBattles: count, completedBattles: 0,
        boss: bossAtFloor(dungeon, floor, totalFloors),
      });
    }
    return floorPlans;
  }

  function weightedEnemyCount(floor, rng) {
    validateRng(rng);
    const weights = ENCOUNTER_WEIGHTS[tierIndex(floor)];
    const value = rng.int(100);
    if (!Number.isInteger(value) || value < 0 || value >= 100) throw new RangeError("invalid RNG result");
    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i];
      if (value < cumulative) return i + 1;
    }
    throw new Error("Encounter probabilities must total 100");
  }

  function createEncounterPlan(dungeon, floor, rng, boss) {
    validateRng(rng);
    const totalFloors = requireDungeon(dungeon);
    if (!Number.isInteger(floor) || floor < 1 || floor > totalFloors) throw new RangeError("floor out of bounds");
    const chosenBoss = boss || null;
    const expectedBoss = bossAtFloor(dungeon, floor, totalFloors);
    if (chosenBoss && (!expectedBoss || chosenBoss.kind !== expectedBoss.kind || chosenBoss.key !== expectedBoss.key)) {
      throw new TypeError("boss does not match official floor plan");
    }
    if (chosenBoss && (chosenBoss.kind !== "mid" && chosenBoss.kind !== "final")) {
      throw new TypeError("invalid boss kind");
    }
    if (chosenBoss && ![dungeon.boss, ...dungeon.pool].includes(chosenBoss.key)) {
      throw new TypeError("boss key must exist in this dungeon");
    }
    // 序盤の3Fはボス単独、5Fはボス+最大1体。深層は取り巻き込みで最大5体。
    const size = chosenBoss
      ? (floor <= 3 ? 1 : floor <= 5 ? 1 + rng.int(2) : 1 + rng.int(5))
      : weightedEnemyCount(floor, rng);
    if (!Number.isInteger(size) || size < 1 || size > 5) throw new RangeError("enemy count outside 1..5");
    const enemies = chosenBoss ? [chosenBoss.key] : [];
    while (enemies.length < size) {
      const key = dungeon.pool[rng.int(dungeon.pool.length)];
      if (!key) throw new RangeError("invalid monster choice");
      enemies.push(key);
    }
    return {
      floor, kind: chosenBoss ? chosenBoss.kind : "normal", bossKey: chosenBoss?.key || null, enemies,
      // 中ボスにtamableな通常敵を昇格させても、本体接続時に誤テイムさせないための区別。
      enemyRoles: enemies.map((key, i) => ({ key, isBoss: !!chosenBoss && i === 0, tameEligible: !(chosenBoss && i === 0) })),
    };
  }

  // フェーズは一方向のみ。フェーズ更新の実戦接続と保存は未実装。
  function advancePilotBossPhase(bossKey, currentPhase, hpPercent) {
    const definition = PILOT_BOSSES[bossKey];
    if (!definition) throw new RangeError("No pilot boss pattern");
    if (!Number.isInteger(currentPhase) || currentPhase < 1 || currentPhase > definition.thresholds.length + 1) {
      throw new RangeError("invalid phase");
    }
    if (!Number.isFinite(hpPercent) || hpPercent < 0 || hpPercent > 100) {
      throw new RangeError("invalid HP percent");
    }
    // HP0は既に撃破済み。死亡後の特殊行動を発生させない。
    if (hpPercent === 0) return { phase: currentPhase, effects: [] };
    let phase = currentPhase;
    const effects = [];
    for (let i = currentPhase - 1; i < definition.thresholds.length; i += 1) {
      if (hpPercent <= definition.thresholds[i]) {
        phase = i + 2;
        effects.push(definition.effects[i]);
      } else break;
    }
    return { phase, effects };
  }

  // 戦闘間イベントは手動操作不要。解錠は「習得した」技能がある場合だけ可能。
  // 泉の水を自動で飲ませず、霧の加護/呪いが自動的に付与される。
  function rollPilotEvent(rng, lockpick, rollOne) {
    validateRng(rng);
    if (typeof rollOne !== "function") throw new TypeError("rollOne required");
    if (rng.int(100) >= 40) return null;
    const roll = rng.int(100);
    if (roll < 50) {
      return { kind: "treasure", item: rng.int(100) < 65 ? rollOne() : null };
    }
    if (roll < 78) {
      // 従来のboolean呼び出しも扱える（trueは基準の45%）。通常は確率0～1。
      const chance = typeof lockpick === "number" ? lockpick : (lockpick === true ? 0.45 : 0);
      if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new RangeError("invalid lockpick chance");
      const success = chance > 0 && rng.chance(chance);
      return { kind: "lockedTreasure", attempted: chance > 0, success, item: success ? rollOne() : null };
    }
    return { kind: "springAura", defensePercent: rng.int(2) === 0 ? 0.10 : -0.08 };
  }

  // 中ボスの途中精算は提供しない。全敗北理由はpendingDropsを0にする。
  function resolveTrialDrops(cleared, pendingDrops) {
    if (typeof cleared !== "boolean" || !Array.isArray(pendingDrops)) throw new TypeError("Invalid settlement");
    return {
      kept: cleared ? pendingDrops.slice() : [],
      lostCount: cleared ? 0 : pendingDrops.length,
    };
  }

  const exported = {
    FLOOR_COUNTS, ENCOUNTER_WEIGHTS, PILOT_BOSSES, floorRange,
    bossAtFloor, createFloorPlan, weightedEnemyCount, createEncounterPlan,
    advancePilotBossPhase, rollPilotEvent, resolveTrialDrops,
  };
  root.QPCore = root.QPCore || {};
  root.QPCore.dungeonTrial = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

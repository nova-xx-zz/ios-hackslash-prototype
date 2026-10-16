// ダンジョン試験モードの「同一周回」チェックポイント。
// 既存のセーブ形式を変更せず、追加の任意フィールドだけで保存する。
(function (root) {
  "use strict";
  const MAX_PENDING = 3000;
  const MAX_ENEMIES = 5;
  const VALID_PHASES = new Set(["ready", "battle", "between", "clearPending", "failPending"]);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const validUint32 = (x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff;

  function capture(run, battle, party) {
    if (!run || run.finished || !Array.isArray(run.pilotSchedule)) return null;
    if (!run.rngSource || typeof run.rngSource.getState !== "function") return null;
    if (!VALID_PHASES.has(run.pilotCheckpointPhase)) return null;
    if (!Array.isArray(party) || !Array.isArray(run.pendingDrops) || run.pendingDrops.length > MAX_PENDING) return null;
    const stage = run.pilotCheckpointPhase;
    if (stage === "battle" && (!battle || !battle.active)) return null;
    const fx = battle && battle.fx instanceof Map ? [...battle.fx].map(([who, effects]) => ({
      kind: party.includes(who) ? "member" : "enemy", id: who.id, effects: clone(effects),
    })) : [];
    const rawBattle = stage === "battle" ? {
      enemies: clone(battle.enemies),
      time: battle.time || 0, active: true,
      fx, resolved: !!battle._pilotResolved,
    } : null;
    return {
      version: 1, team: run.team, dungeonId: run.dungeon.id, mode: run.dungeon.mode || "normal",
      battleIndex: run.battleIndex, rngState: run.rngSource.getState(),
      phase: stage, pilotCleared: !!run.pilotCleared,
      pilotClearOutcome: run.pilotClearOutcome || null,
      floorPlans: clone(run.pilotFloorPlans),
      pendingDrops: clone(run.pendingDrops),
      expTotal: run.expTotal, buffs: clone(run.buffs),
      levelUps: clone(run.levelUps), abilityUnlocks: clone(run.abilityUnlocks),
      defeatedTamable: clone(run.defeatedTamable),
      disassembleCount: run.disassembleCount, materialGained: run.materialGained,
      autoDisassemble: run.autoDisassemble,
      autoDisassembleRarities: [...run.autoDisassembleRarities],
      members: party.map((p) => ({
        id: p.id, hp: p.hp, mp: p.mp, alive: p.alive, atb: p.atb || 0,
        defending: !!p.defending, actedFlash: p.actedFlash || 0,
      })),
      battle: rawBattle,
    };
  }

  function validate(data, dungeon, team, expectedFloors) {
    if (!data || data.version !== 1 || data.team !== team || !dungeon ||
      data.dungeonId !== dungeon.id || (data.mode || "normal") !== (dungeon.mode || "normal") ||
      !VALID_PHASES.has(data.phase) || !validUint32(data.rngState)) return false;
    if (!Array.isArray(data.floorPlans) || data.floorPlans.length !== expectedFloors ||
      !Array.isArray(data.pendingDrops) || data.pendingDrops.length > MAX_PENDING ||
      !Array.isArray(data.members) || data.members.length > 5) return false;
    if (typeof data.expTotal !== "number" || !Number.isFinite(data.expTotal) || data.expTotal < 0) return false;
    if (!data.buffs || !["atk", "mag", "def", "spd"].every((k) => Number.isFinite(data.buffs[k]))) return false;
    if (!Array.isArray(data.levelUps) || !Array.isArray(data.abilityUnlocks) ||
      !Array.isArray(data.defeatedTamable) || !Array.isArray(data.autoDisassembleRarities)) return false;
    let count = 0;
    for (const [i,p] of data.floorPlans.entries()) {
      const floor=i+1;
      const range = floor<=2 ? [1,3] : floor<=5 ? [2,4] : floor<=10 ? [3,5] : [3,6];
      if (!p || p.floor !== floor || !Number.isInteger(p.regularBattles) ||
        p.regularBattles < range[0] || p.regularBattles > range[1]) return false;
      count += p.regularBattles + (p.boss ? 1 : 0);
      // 序盤パイロットは最終階層でだけボスが発生。
      if (!!p.boss !== (floor === expectedFloors) ||
          (p.boss && (p.boss.kind !== "final" || p.boss.key !== dungeon.boss))) return false;
    }
    if (!Number.isInteger(data.battleIndex) || data.battleIndex < 0 || data.battleIndex >= count) return false;
    if (data.phase === "battle" && (!data.battle || !data.battle.active ||
      !Array.isArray(data.battle.enemies) || data.battle.enemies.length < 1 ||
      data.battle.enemies.length > MAX_ENEMIES ||
      !data.battle.enemies.every((e) => e && typeof e.key === "string" &&
        Number.isFinite(e.hp) && Number.isFinite(e.maxHp) && e.hp >= 0 && e.maxHp > 0))) return false;
    if (data.phase === "clearPending" && !data.pilotCleared) return false;
    if (data.phase === "failPending" && data.pilotCleared) return false;
    const ids = new Set();
    for (const member of data.members) {
      if (!member || typeof member.id !== "string" || ids.has(member.id) ||
        !Number.isFinite(member.hp) || !Number.isFinite(member.mp) ||
        !Number.isFinite(member.atb) || typeof member.alive !== "boolean") return false;
      ids.add(member.id);
    }
    return true;
  }

  function restoreBattle(data, party) {
    if (!data) return null;
    const battle = { enemies: clone(data.enemies), time: data.time || 0, active: true,
      _pilotResolved: !!data.resolved };
    const effects = new Map();
    for (const e of data.fx || []) {
      if (!e || !["member", "enemy"].includes(e.kind) || typeof e.id !== "string") continue;
      const target = e.kind === "member" ? party.find((m) => m.id === e.id) :
        battle.enemies.find((enemy) => enemy.id === e.id);
      if (target && e.effects && typeof e.effects === "object") effects.set(target, clone(e.effects));
    }
    battle.fx = effects;
    return battle;
  }

  const exported = { capture, validate, restoreBattle };
  root.QPCore = root.QPCore || {};
  root.QPCore.dungeonCheckpoint = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

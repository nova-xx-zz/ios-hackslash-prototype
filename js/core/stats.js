// ---------- 能力値の計算（stats） ----------
// レベル・ジョブ・種族から決まる基礎ステータス。装備・スキルツリー・石碑の加護はgame.jsのcomputeStatsで上乗せする。
// 戦闘シミュレーション（tools/simulate.js）やテストからも同じ式を使うためにここへ置く。
(function (root) {
  "use strict";

  // job: { base: {hp, mp, atk, mag, def, spd} }, race: { mult: {hp, mp, atk, mag, def, spd} }
  function baseStats(job, race, level) {
    const growth = 1 + 0.12 * (level - 1); // Lv.1から1Lvごとに+12%
    return {
      maxHp: Math.round(job.base.hp * growth * race.mult.hp),
      maxMp: Math.round(job.base.mp * growth * race.mult.mp),
      atk: Math.round(job.base.atk * growth * race.mult.atk),
      mag: Math.round(job.base.mag * growth * race.mult.mag),
      def: Math.round(job.base.def * growth * race.mult.def),
      spd: job.base.spd * race.mult.spd, // SPDはレベルで伸びない
    };
  }

  // 石碑の加護（ダンジョン中だけATK/MAG/DEF/SPDに乗る倍率）を反映する
  function applyBuffs(stats, buffs) {
    if (!buffs) return stats;
    for (const stat of ["atk", "mag", "def", "spd"]) {
      const buff = buffs[stat];
      if (buff) stats[stat] = Math.round(stats[stat] * (1 + buff) * 10) / 10;
    }
    return stats;
  }

  const exported = { baseStats, applyBuffs };
  root.QPCore = root.QPCore || {};
  root.QPCore.stats = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

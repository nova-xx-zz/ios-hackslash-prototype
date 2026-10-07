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

  // ---------- 個体値（テイムしたモンスターの能力値の個体差） ----------
  // ivs: { hp, mp, atk, mag, def, spd } それぞれ 1−range〜1+range の倍率（0.01刻み）。テイムした時に1回だけ決まる。
  // 個体値の無いキャラ（人間・個体値を入れる前にテイムしたモンスター）は全部1.0倍と同じ
  const IV_KEYS = ["hp", "mp", "atk", "mag", "def", "spd"];
  const round2 = (x) => Math.round(x * 100) / 100;
  function rollIvs(rng, range) {
    const out = {};
    for (const k of IV_KEYS) out[k] = round2(1 + rng.float(-range, range));
    return out;
  }
  // 基礎ステータス（baseStats の戻り値）に個体値を掛ける（装備・スキルツリーより前）
  function applyIvs(stats, ivs) {
    if (!ivs) return stats;
    const key = { hp: "maxHp", mp: "maxMp" };
    for (const k of IV_KEYS) {
      const iv = ivs[k] || 1;
      const s = key[k] || k;
      stats[s] = k === "spd" ? Math.round(stats[s] * iv * 100) / 100 : Math.round(stats[s] * iv);
    }
    return stats;
  }
  // 全体の評価: 6つの倍率の平均で S/A/B/C/D（±10%なら、Sは上位5%前後・Dは下位5%前後）
  function ivRank(ivs) {
    if (!ivs) return null;
    const avg = IV_KEYS.reduce((s, k) => s + (ivs[k] || 1), 0) / IV_KEYS.length;
    if (avg >= 1.04) return "S";
    if (avg >= 1.015) return "A";
    if (avg > 0.985) return "B";
    if (avg > 0.96) return "C";
    return "D";
  }
  // 同じ種族の素材の個体値を少しずつ引き継ぐ: 素材の方が高い能力値だけ、差の rate 倍だけ近づける（上限 1+range）。
  // 戻り値: 上がった能力値のキー
  function inheritIvs(target, material, rate, range) {
    if (!target.ivs) target.ivs = Object.fromEntries(IV_KEYS.map((k) => [k, 1]));
    const src = material.ivs || {};
    const raised = [];
    for (const k of IV_KEYS) {
      const from = src[k] || 1;
      const cur = target.ivs[k] || 1;
      if (from <= cur) continue;
      const next = Math.min(1 + range, round2(cur + Math.max(0.01, (from - cur) * rate)));
      if (next > cur) { target.ivs[k] = next; raised.push(k); }
    }
    return raised;
  }

  const exported = { baseStats, applyBuffs, IV_KEYS, rollIvs, applyIvs, ivRank, inheritIvs };
  root.QPCore = root.QPCore || {};
  root.QPCore.stats = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

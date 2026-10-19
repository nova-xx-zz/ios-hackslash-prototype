// 剣豪解放の隔離パイロット。ゲーム内の通常実績であり、公式/有料ジョブ権利ではない。
(function (root) {
  "use strict";
  const HIT_TARGET = 100;
  const CLEAR_TARGET = 15;
  const LEVEL_TARGET = 50;
  const TRIAL_DUNGEON_ID = "job_trial_swordmaster";

  const count = (v) => Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 100000000) : 0;
  function normalize(raw) {
    const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      warriorHits: count(d.warriorHits),
      warriorClears: count(d.warriorClears),
      trialCleared: d.trialCleared === true,
    };
  }

  function isLegacyUnlocked(c) {
    // 旧版ですでに剣豪へ転職していたキャラの権利は剥奪しない。
    return !!(c && (c.job === "swordmaster" || (c.jobLevels && c.jobLevels.swordmaster)));
  }
  function warriorLevel(c) {
    if (!c || c.isMonster) return 0;
    const rec = c.jobLevels && c.jobLevels.warrior;
    return c.job === "warrior" ? Math.max(c.level || 0, (rec && rec.level) || 0) : (rec && rec.level) || 0;
  }
  function hasAchievement(p) {
    return p.warriorHits >= HIT_TARGET || p.warriorClears >= CLEAR_TARGET;
  }
  function status(state, c, enabled) {
    const level = warriorLevel(c);
    const progress = normalize(state && state.jobTrialSwordmaster);
    const legacy = isLegacyUnlocked(c);
    const oldRule = level >= LEVEL_TARGET;
    return {
      enabled: !!enabled, level, progress, legacy,
      levelReady: oldRule,
      achievementReady: hasAchievement(progress),
      trialAvailable: !!enabled && oldRule && hasAchievement(progress) && !progress.trialCleared && !legacy,
      unlocked: !enabled ? oldRule : legacy || (oldRule && progress.trialCleared),
    };
  }
  function recordClear(state, members, hits) {
    const p = normalize(state.jobTrialSwordmaster);
    const participated = Array.isArray(members) && members.some((c) => c && !c.isMonster && c.job === "warrior" && c.alive !== false);
    if (participated) {
      p.warriorClears = Math.min(100000000, p.warriorClears + 1);
      p.warriorHits = Math.min(100000000, p.warriorHits + count(hits));
    }
    state.jobTrialSwordmaster = p;
    return participated;
  }
  function recordTrialClear(state) {
    const p = normalize(state.jobTrialSwordmaster);
    if (p.trialCleared) return false;
    p.trialCleared = true;
    state.jobTrialSwordmaster = p;
    return true;
  }

  // 既存データの敵・ボスを使う3戦。経験値、ドロップ、踏破は反映しない。
  function trialDungeon(base) {
    if (!base) return null;
    return Object.assign({}, base, {
      id: TRIAL_DUNGEON_ID,
      name: "剣豪の試練",
      battles: 3,
      level: 50,
      pool: ["salamander_knight", "fire_serpent", "obsidian_golem"],
      boss: "ash_behemoth",
      rares: [],
      mode: undefined,
      power: 0.48,
    });
  }

  const exported = { HIT_TARGET, CLEAR_TARGET, LEVEL_TARGET, TRIAL_DUNGEON_ID,
    normalize, status, recordClear, recordTrialClear, trialDungeon };
  root.QPCore = root.QPCore || {};
  root.QPCore.jobTrialSwordmaster = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

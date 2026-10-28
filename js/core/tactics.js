// ガンビット型スキル設定: ブラウザ・Node共通のルール/旧設定移行
(function (root) {
  "use strict";
  const MAX_RULES = 8; // プロトタイプ検証値（正式版の最終バランスではない）
  const CONDITIONS = Object.freeze([
    { id: "auto", label: "状況に応じて（従来のAI条件）" },
    { id: "always", label: "常に" },
    { id: "allyHpLte", label: "味方の誰かのHPが指定%以下" },
    { id: "selfHpLte", label: "自分のHPが指定%以下" },
    { id: "enemyHpLte", label: "狙う敵のHPが指定%以下" },
    { id: "selfMpGte", label: "自分のMPが指定%以上" },
    { id: "enemyCountGte", label: "生存する敵が指定数以上" },
  ]);
  const NEEDS_PERCENT = new Set(["allyHpLte", "selfHpLte", "enemyHpLte", "selfMpGte"]);
  const NEEDS_NUMBER = new Set(["enemyCountGte"]);
  const TARGET_MODES = ["weakest", "strongest", "random"];

  function normalizeRules(input) {
    if (!Array.isArray(input)) return null; // 未移行は旧AIを使用
    const seen = new Set();
    const out = [];
    for (const rule of input.slice(0, 128)) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
      if (typeof rule.abilityId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(rule.abilityId)) continue;
      const id = typeof rule.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(rule.id) ? rule.id : "rule-" + (out.length + 1);
      if (seen.has(id)) continue;
      seen.add(id);
      const condition = CONDITIONS.some((c) => c.id === rule.condition) ? rule.condition : "auto";
      const raw = Number(rule.value);
      const value = NEEDS_PERCENT.has(condition)
        ? (Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 20)
        : (NEEDS_NUMBER.has(condition) ? (Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : 3) : 0);
      out.push({
        id, abilityId: rule.abilityId, enabled: rule.enabled !== false,
        condition, value, targetMode: TARGET_MODES.includes(rule.targetMode) ? rule.targetMode : "weakest",
      });
      if (out.length === MAX_RULES) break;
    }
    return out;
  }

  function migrateLegacy(c, knownAbilities, tier) {
    if (Array.isArray(c.tacticsRules)) {
      c.tacticsRules = normalizeRules(c.tacticsRules);
      return c.tacticsRules;
    }
    const unique = new Set();
    const choices = (knownAbilities || []).filter((a) => a && !unique.has(a.id) && unique.add(a.id) && (!c.skillActive || c.skillActive[a.id] !== false));
    choices.sort((a, b) => ((tier ? tier(c, b.id) : 2) - (tier ? tier(c, a.id) : 2)));
    c.tacticsRules = choices.slice(0, MAX_RULES).map((a, i) => ({
      id: "rule-" + (i + 1), abilityId: a.id, enabled: true, condition: "auto", value: 0,
      targetMode: TARGET_MODES.includes(c.targetPriority) ? c.targetPriority : "weakest",
    }));
    return c.tacticsRules;
  }

  function conditionMet(rule, actor, party, enemies, getStats) {
    const type = rule.condition;
    const pct = (p) => {
      const max = getStats(p).maxHp;
      return max > 0 ? 100 * p.hp / max : 100;
    };
    const aliveAllies = (party || []).filter((p) => p.alive && p.hp > 0);
    const aliveEnemies = (enemies || []).filter((e) => e.alive && e.hp > 0);
    if (type === "auto" || type === "always") return true;
    if (type === "allyHpLte") return aliveAllies.some((p) => pct(p) <= rule.value);
    if (type === "selfHpLte") return actor.alive && actor.hp > 0 && pct(actor) <= rule.value;
    if (type === "selfMpGte") {
      const mpMax = getStats(actor).maxMp;
      return mpMax > 0 && 100 * actor.mp / mpMax >= rule.value;
    }
    if (type === "enemyCountGte") return aliveEnemies.length >= rule.value;
    if (type === "enemyHpLte") {
      // ランダム狙いは、実際の標的と条件がずれないよう全生存敵が条件を満たす時だけ許可。
      if (!aliveEnemies.length) return false;
      if (rule.targetMode === "random") return aliveEnemies.every((e) => e.maxHp > 0 && 100 * e.hp / e.maxHp <= rule.value);
      const target = rule.targetMode === "strongest"
        ? aliveEnemies.reduce((best, e) => e.hp > best.hp ? e : best, aliveEnemies[0])
        : aliveEnemies.reduce((best, e) => e.hp < best.hp ? e : best, aliveEnemies[0]);
      return target.maxHp > 0 && 100 * target.hp / target.maxHp <= rule.value;
    }
    return false;
  }

  const exported = { MAX_RULES, CONDITIONS, normalizeRules, migrateLegacy, conditionMet };
  root.QPCore = root.QPCore || {};
  root.QPCore.tactics = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

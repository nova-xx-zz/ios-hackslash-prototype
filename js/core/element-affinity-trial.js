// 属性10種の独立検証用計算（本体戦闘・ドロップ未接続）。
// プロトタイプで相性・属性反転・虚無の環境差・完全無効を単体テストする。
(function (root) {
  "use strict";

  const ELEMENTS = Object.freeze({
    earth: "土", fire: "炎", ice: "氷", thunder: "雷", wood: "木",
    dragon: "龍", bloodstained: "血塗られた", chaos: "混沌", gold: "金", void: "虚無"
  });
  const BASIC = Object.freeze(["earth", "fire", "ice", "thunder", "wood"]);
  const SPECIAL_PAIRS = Object.freeze([
    Object.freeze(["dragon", "bloodstained"]),
    Object.freeze(["chaos", "gold"])
  ]);
  const VALUES = Object.freeze({
    advantage: 1.30, disadvantage: 0.80, specialAdvantage: 1.25,
    voidAdvantage: 1.15, neutral: 1
  });
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function checkElement(value) {
    if (value !== null && value !== undefined && !own(ELEMENTS, value)) {
      throw new RangeError("Unknown element: " + String(value));
    }
  }

  // 10×10組み合わせに対して値が確定的な基本相性。
  // voidを防御する側への攻撃は、まだ「中立」扱いとする（既存の合意外で不利を加えない）。
  function baseAffinity(attack, defense) {
    checkElement(attack);
    checkElement(defense);
    if (!attack || !defense || attack === defense) {
      return { kind: "neutral", multiplier: VALUES.neutral };
    }
    const a = BASIC.indexOf(attack);
    const d = BASIC.indexOf(defense);
    if (a >= 0 && d >= 0) {
      if ((a + 1) % BASIC.length === d) return { kind: "advantage", multiplier: VALUES.advantage };
      if ((d + 1) % BASIC.length === a) return { kind: "disadvantage", multiplier: VALUES.disadvantage };
    }
    if (SPECIAL_PAIRS.some(pair => pair.includes(attack) && pair.includes(defense))) {
      return { kind: "special", multiplier: VALUES.specialAdvantage };
    }
    if (attack === "void") return { kind: "void", multiplier: VALUES.voidAdvantage };
    return { kind: "neutral", multiplier: VALUES.neutral };
  }

  function validateMultiplier(value, label) {
    if (value === undefined || value === null) return 1;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 4) {
      throw new RangeError(label + " must be a finite multiplier from 0 to 4");
    }
    return value;
  }
  function blockedBy(list, element, label) {
    if (list === undefined || list === null) return false;
    if (!Array.isArray(list)) throw new TypeError(label + " must be an array");
    list.forEach(checkElement);
    return element != null && list.includes(element);
  }

  // options: {attackElement, defenseElement,
  //   reversalTarget?, dungeon?:{voidMultiplier?, blockedElements?:[]},
  //   enemy?:{immuneElements?:[], elementMultipliers?:{[element]:multiplier}}}
  // 免疫は相性・反転・環境より優先（「0」を「指定なし」に変換しない）。
  function resolve(options) {
    if (!options || typeof options !== "object") throw new TypeError("options required");
    const attack = options.attackElement == null ? null : options.attackElement;
    const defense = options.defenseElement == null ? null : options.defenseElement;
    checkElement(attack);
    checkElement(defense);
    const dungeon = options.dungeon || {};
    const enemy = options.enemy || {};
    if (options.reversalTarget != null) checkElement(options.reversalTarget);
    const base = baseAffinity(attack, defense);
    const dungeonFactor = attack === "void"
      ? validateMultiplier(dungeon.voidMultiplier, "dungeon.voidMultiplier") : 1;
    const enemyFactors = enemy.elementMultipliers || {};
    if (enemyFactors && typeof enemyFactors !== "object") throw new TypeError("elementMultipliers must be an object");
    const enemyFactor = attack !== null && own(enemyFactors, attack)
      ? validateMultiplier(enemyFactors[attack], "enemy multiplier") : 1;
    const immune = blockedBy(dungeon.blockedElements, attack, "blockedElements") ||
      blockedBy(enemy.immuneElements, attack, "immuneElements") ||
      (attack !== null && (dungeonFactor === 0 || enemyFactor === 0));

    // 本来不利な相性のみ、指定された防御属性に対して有利に反転。
    const reversed = !immune && base.kind === "disadvantage" && options.reversalTarget === defense;
    const affinityFactor = reversed ? VALUES.advantage : base.multiplier;
    const multiplier = immune ? 0 : affinityFactor * dungeonFactor * enemyFactor;
    return {
      attackElement: attack, defenseElement: defense,
      baseKind: base.kind, baseMultiplier: base.multiplier,
      affinityMultiplier: affinityFactor, dungeonMultiplier: dungeonFactor,
      enemyMultiplier: enemyFactor, reversed, immune, multiplier,
      reason: immune ? "immune" : reversed ? "reversed" : base.kind
    };
  }

  const api = { ELEMENTS, BASIC, SPECIAL_PAIRS, VALUES, baseAffinity, resolve };
  root.QPCore = root.QPCore || {};
  root.QPCore.elementAffinityTrial = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

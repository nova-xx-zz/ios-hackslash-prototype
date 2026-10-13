// 鍛冶屋試作：レアOP付き低レア装備を自動分解から守る判定。
// ゲーム本体の settleDrops / drop generator / player inventory は変更しない。
(function (root) {
  "use strict";
  const RANKS = Object.freeze(["n", "r", "sr", "ur", "lr"]);
  const RANK_NAMES = Object.freeze({ n: "N", r: "R", sr: "SR", ur: "UR", lr: "LR" });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 現行の { key, value } だけではOPレアリティを判断できない。
  // レアリティを勝手に推定して保護するのではなく、未知のrankや特殊効果は安全側に倒す。
  function protectionReason(item, threshold) {
    if (!item || typeof item !== "object") return null;
    const options = Array.isArray(item.options) ? item.options : [];
    const minRank = threshold == null ? "sr" : threshold;
    if (!RANKS.includes(minRank)) throw new RangeError("Invalid option protection rank");
    for (const op of options) {
      if (!op || typeof op !== "object") return "unknown_option";
      if (op.origin === "inherited") return "inherited_option";
      if (op.special === true || op.group === "special") return "special_option";
      if (op.rank !== undefined && op.rank !== null) {
        if (!own(RANK_NAMES, op.rank)) return "unknown_option_rank";
        if (RANKS.indexOf(op.rank) >= RANKS.indexOf(minRank)) return "rare_option";
      }
    }
    return null;
  }

  function decide(item, settings) {
    const opts = settings || {};
    if (!item || typeof item !== "object") throw new TypeError("Item is required");
    if (!Array.isArray(opts.rarities) && !(opts.rarities instanceof Set)) {
      throw new TypeError("Auto disassemble rarities must be Set or array");
    }
    const selected = opts.rarities instanceof Set
      ? opts.rarities.has(item.rarity) : opts.rarities.includes(item.rarity);
    if (!opts.enabled) return { keep: true, reason: "disabled" };
    if (!selected) return { keep: true, reason: "rarity_excluded" };
    if (item.unique) return { keep: true, reason: "unique" };
    if (item.locked) return { keep: true, reason: "locked" };
    if (opts.protectRareOptions === true) {
      const reason = protectionReason(item, opts.minRank);
      if (reason) return { keep: true, reason };
    }
    return { keep: false, reason: "disassemble" };
  }

  function simulate(items, settings) {
    if (!Array.isArray(items)) throw new TypeError("Loot must be an array");
    const rows = items.map(item => ({ item, ...decide(item, settings) }));
    return {
      rows,
      kept: rows.filter(r => r.keep).map(r => r.item),
      disassembled: rows.filter(r => !r.keep).map(r => r.item),
      materials: rows.filter(r => !r.keep).reduce((n, r) => n + (r.item.materialValue || 0), 0),
      savedByOptions: rows.filter(r => r.keep && [
        "inherited_option", "special_option", "rare_option", "unknown_option_rank", "unknown_option"
      ].includes(r.reason)).length
    };
  }

  function sampleLoot() {
    return [
      { id: "demo_n1", name: "N アイアンダガー", rarity: "n", materialValue: 5, options: [] },
      { id: "demo_n2", name: "N ブロンズソード", rarity: "n", materialValue: 5,
        options: [{ key: "atk_pct", value: .03, rank: "r", origin: "natural" }] },
      { id: "demo_n3", name: "N アイアンアクス", rarity: "n", materialValue: 5,
        options: [{ key: "crit", value: .08, rank: "sr", origin: "natural" }] },
      { id: "demo_n4", name: "N 錆びた剣", rarity: "n", materialValue: 5,
        options: [{ key: "reverse", value: 1, rank: "lr", special: true, origin: "natural" }] },
      { id: "demo_r1", name: "R スチールソード", rarity: "r", materialValue: 20,
        options: [{ key: "atk_pct", value: .11, rank: "ur", origin: "natural" }] },
      { id: "demo_r2", name: "R ブロンズブレイド", rarity: "r", materialValue: 20,
        options: [{ key: "atk_pct", value: .02, rank: "n", origin: "natural" }] },
      { id: "demo_sr1", name: "SR ゴールドソード", rarity: "sr", materialValue: 80, options: [] },
      { id: "demo_n5", name: "N 継承済みダガー", rarity: "n", materialValue: 5,
        options: [{ key: "atk_pct", value: .05, rank: "r", origin: "inherited" }] }
    ];
  }

  const api = { RANKS, RANK_NAMES, protectionReason, decide, simulate, sampleLoot };
  root.QPCore = root.QPCore || {};
  root.QPCore.lootProtectionTrial = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

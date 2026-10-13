// 天然OP・継承OP・穴あけの「総数上限」を独立検証する純粋関数。
// 現行インベントリ・保存・試作工房には接続せず、移行と経済調整の前にテストする。
(function (root) {
  "use strict";
  const RARITY_ORDER = Object.freeze(["n", "r", "sr", "ur", "lr"]);
  const MAX_OPTIONS = Object.freeze({ n: 1, r: 1, sr: 2, ur: 3, lr: 4 });
  const SOCKET_THRESHOLDS = Object.freeze({
    n: Object.freeze([]),
    r: Object.freeze([50]),
    sr: Object.freeze([50, 99]),
    ur: Object.freeze([25, 50, 99]),
    lr: Object.freeze([25, 50, 75, 99])
  });
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function isNatural(option) {
    return option.origin === undefined || option.origin === null || option.origin === "natural";
  }
  function isInherited(option) { return option.origin === "inherited"; }
  function isSpecial(option) { return option.special === true || option.group === "special"; }

  function assertItem(item) {
    if (!item || !own(MAX_OPTIONS, item.rarity)) throw new RangeError("Invalid item rarity");
    if (!Number.isInteger(item.plus) || item.plus < 0 || item.plus > 99) throw new RangeError("Invalid enhancement level");
    if (item.options !== undefined && !Array.isArray(item.options)) throw new TypeError("options must be an array");
    const options = item.options || [];
    for (const op of options) {
      if (!op || typeof op.key !== "string" || !op.key || (!isNatural(op) && !isInherited(op))) {
        throw new TypeError("Invalid option entry");
      }
    }
    const opened = item.sockets && item.sockets.opened !== undefined
      ? item.sockets.opened : item.openedSockets === undefined ? 0 : item.openedSockets;
    if (!Number.isInteger(opened) || opened < 0 || opened > SOCKET_THRESHOLDS[item.rarity].length) {
      throw new RangeError("Invalid socket count");
    }
    if (opened > 0 && item.plus < SOCKET_THRESHOLDS[item.rarity][opened - 1]) {
      throw new RangeError("Sockets cannot exceed enhancement milestones");
    }
    return { options, opened };
  }

  // 旧セーブの {key,value} は「天然OP」として扱う。値を落とさず、入力を変更しない。
  // 旧装備が現在の上限を超えていても削除しない（overCapacityを返し、新規継承だけ停止）。
  function inspect(item) {
    const { options, opened } = assertItem(item);
    const natural = options.filter(isNatural).length;
    const inherited = options.filter(isInherited).length;
    const maxTotal = MAX_OPTIONS[item.rarity];
    const nextThreshold = SOCKET_THRESHOLDS[item.rarity][opened];
    const total = options.length;
    const freeTotal = Math.max(0, maxTotal - total);
    return {
      rarity: item.rarity, plus: item.plus, maxTotal, total,
      naturalCount: natural, inheritedCount: inherited,
      openedSockets: opened, freeTotal,
      freeInheritedSockets: Math.max(0, opened - inherited),
      overCapacity: Math.max(0, total - maxTotal),
      nextThreshold: nextThreshold === undefined ? null : nextThreshold,
      canOpenNext: nextThreshold !== undefined && item.plus >= nextThreshold && freeTotal > 0,
      canInherit: freeTotal > 0 && opened > inherited
    };
  }

  function openNextSocket(item) {
    const status = inspect(item);
    if (status.nextThreshold === null) return { ok: false, reason: "max_sockets" };
    if (item.plus < status.nextThreshold) return { ok: false, reason: "enhance_first", requiredPlus: status.nextThreshold };
    if (status.freeTotal <= 0) return { ok: false, reason: "full" };
    const next = { ...item, sockets: { ...(item.sockets || {}), opened: status.openedSockets + 1 } };
    return { ok: true, item: next };
  }

  // 天然OPを1つだけ除去。特殊効果を含めて他のOPや武器ID・+値は残す。
  function extractNatural(item, index) {
    const { options } = assertItem(item);
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      return { ok: false, reason: "missing_option" };
    }
    if (!isNatural(options[index])) return { ok: false, reason: "inherited_cannot_extract" };
    return {
      ok: true, option: { ...options[index], origin: "natural" },
      item: { ...item, options: options.filter((_, i) => i !== index) }
    };
  }

  // candidate: {key, value, rank, sourceItemRarity, special?, group?}
  // 継承成功率・素材消費・サーバー権利処理は範囲外。
  function validateInheritance(item, candidate) {
    const info = inspect(item);
    if (!candidate || typeof candidate.key !== "string" || !candidate.key ||
        !own(MAX_OPTIONS, candidate.sourceItemRarity) ||
        (candidate.value !== undefined && (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)))) {
      return { ok: false, reason: "invalid_material" };
    }
    if (RARITY_ORDER.indexOf(candidate.sourceItemRarity) >= RARITY_ORDER.indexOf(item.rarity)) {
      return { ok: false, reason: "lower_to_higher_only" };
    }
    if (info.overCapacity > 0 || info.freeTotal === 0) return { ok: false, reason: "full" };
    if (info.freeInheritedSockets === 0) return { ok: false, reason: "needs_socket" };
    const options = item.options || [];
    if (options.some(o => o.key === candidate.key)) return { ok: false, reason: "duplicate" };
    if (isSpecial(candidate) && options.some(isSpecial)) return { ok: false, reason: "special_limit" };
    return { ok: true, remainingAfter: info.freeTotal - 1 };
  }

  function appendInherited(item, candidate) {
    const check = validateInheritance(item, candidate);
    if (!check.ok) return check;
    const { sourceItemRarity, ...details } = candidate;
    const op = { ...details, origin: "inherited", sourceItemRarity };
    return { ok: true, item: { ...item, options: [...(item.options || []), op] } };
  }

  const api = { RARITY_ORDER, MAX_OPTIONS, SOCKET_THRESHOLDS, inspect, openNextSocket,
    extractNatural, validateInheritance, appendInherited, isNatural, isInherited };
  root.QPCore = root.QPCore || {};
  root.QPCore.optionSlotsTrial = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

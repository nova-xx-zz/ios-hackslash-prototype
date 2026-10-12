// 試作工房専用の純粋な装備OP抽出・継承ルール。メインセーブ・課金には接続しない。
(function (root) {
  "use strict";
  const ORDER = ["n", "r", "sr", "ur", "lr"];
  const SLOT_LEVELS = { n: [], r: [50], sr: [50, 99], ur: [25, 50, 99], lr: [25, 50, 75, 99] };
  const EXTRACT_COUNT = { n: 1, r: 2, sr: 3, ur: 5, lr: 8 };
  const RATES = { r: 1, sr: 1, ur: 0.65, lr: 0.45 };
  const PITY_LIMIT = { ur: 2, lr: 3 };
  const OP_DEFS = {
    atk: { label: "ATK +5%", rarity: "r", special: false },
    crit: { label: "会心率 +10%", rarity: "sr", special: false },
    reverse: { label: "属性反転・土", rarity: "ur", special: true },
    void: { label: "虚無共鳴", rarity: "lr", special: true },
    guard: { label: "被ダメージ -3%", rarity: "n", special: false }
  };
  const SAMPLES = [
    { rarity: "r", name: "R ブロンズソード", optionKey: "atk" },
    { rarity: "n", name: "N アイアンダガー", optionKey: "crit" },
    { rarity: "sr", name: "SR ミスリルブレイド", optionKey: "reverse" },
    { rarity: "ur", name: "UR ドラゴンソード", optionKey: "void" },
    { rarity: "n", name: "N ブロンズダガー", optionKey: "guard" }
  ];
  function newTargets() {
    return ["r", "sr", "ur", "lr"].map(function (rarity) {
      return { id: rarity, rarity: rarity, name: rarity.toUpperCase() + " ゴールドソード",
        plus: 0, opened: 0, options: [], failures: 0 };
    });
  }
  function createDemo() {
    const s = { version: 1, seq: 0, sources: [], targets: newTargets(), essences: [], trialLiquid: 2 };
    addSamples(s);
    return s;
  }
  function addSamples(state) {
    if (state.sources.length + SAMPLES.length > 55) return { ok: false, message: "試作武器の保有上限です。試作データをリセットして再挑戦してください" };
    SAMPLES.forEach(function (s) {
      state.sources.push({ id: "src_" + (++state.seq), name: s.name, rarity: s.rarity,
        optionKey: s.optionKey, natural: true });
    });
    return { ok: true };
  }
  function fail(reason) { return { ok: false, message: reason }; }
  function targetById(s, id) { return s.targets.find(function (x) { return x.id === id; }); }
  function increasePlus(s, id, nextPlus) {
    const t = targetById(s, id);
    const cap = SLOT_LEVELS[id] && SLOT_LEVELS[id].slice(-1)[0];
    if (!t || !Number.isInteger(nextPlus) || nextPlus <= t.plus || nextPlus > cap) return fail("強化値が不正です");
    t.plus = nextPlus;
    return { ok: true, message: t.name + " を試験的に+" + nextPlus + "へ強化しました" };
  }
  function openSocket(s, id) {
    const t = targetById(s, id);
    if (!t) return fail("対象武器がありません");
    const required = SLOT_LEVELS[t.rarity][t.opened];
    if (required === undefined) return fail("すべての穴が解放済みです");
    if (t.plus < required) return fail("穴あけには+" + required + "が必要です");
    t.opened += 1;
    return { ok: true, message: t.name + " のOP枠を" + t.opened + "枠にしました" };
  }
  function extract(s, sourceId) {
    const weapon = s.sources.find(function (x) { return x.id === sourceId; });
    if (!weapon || !weapon.natural || !OP_DEFS[weapon.optionKey]) return fail("抽出できる天然OPがありません");
    const def = OP_DEFS[weapon.optionKey];
    // 液体は1回の継承を表す「束」として管理。レア度により表示数量は違うが複製不可。
    const essence = { id: "ess_" + (++s.seq), key: weapon.optionKey, optionRarity: def.rarity,
      count: EXTRACT_COUNT[def.rarity], sourceRarity: weapon.rarity };
    weapon.optionKey = null;
    weapon.natural = false;
    s.essences.push(essence);
    return { ok: true, message: weapon.name + " は残り、" + def.label + "の抽出液×" + essence.count + "を獲得しました" };
  }
  function validate(s, targetId, essenceId, useLiquid) {
    const t = targetById(s, targetId);
    const e = s.essences.find(function (x) { return x.id === essenceId; });
    if (!t || !e || !OP_DEFS[e.key]) return fail("継承先または抽出液がありません");
    if (ORDER.indexOf(e.sourceRarity) < 0 || ORDER.indexOf(e.sourceRarity) >= ORDER.indexOf(t.rarity)) {
      return fail("継承は下位レアリティの武器から上位武器へのみ可能です");
    }
    if (t.options.length >= t.opened) return fail("空きスロットを解放してください");
    if (t.options.some(function (o) { return o.key === e.key; })) return fail("同一OPの重複継承はできません");
    if (OP_DEFS[e.key].special && t.options.some(function (o) { return OP_DEFS[o.key].special; })) {
      return fail("特殊OPは武器1本につき1つまでです");
    }
    if (e.count !== EXTRACT_COUNT[e.optionRarity] || OP_DEFS[e.key].rarity !== e.optionRarity) return fail("抽出液のデータが不正です");
    if (useLiquid && t.rarity !== "ur" && t.rarity !== "lr") return fail("確定液はUR・LRにのみ使用できます");
    if (useLiquid && s.trialLiquid < 1) return fail("テスト用の確定継承液がありません");
    return { ok: true, target: t, essence: e };
  }
  function inherit(s, targetId, essenceId, useLiquid, random) {
    const check = validate(s, targetId, essenceId, useLiquid);
    if (!check.ok) return check;
    const t = check.target;
    const e = check.essence;
    const pityHit = (PITY_LIMIT[t.rarity] !== undefined && t.failures >= PITY_LIMIT[t.rarity]);
    const guaranteed = useLiquid || pityHit || RATES[t.rarity] === 1;
    const success = guaranteed || (typeof random === "function" ? random() : Math.random()) < RATES[t.rarity];
    if (useLiquid) s.trialLiquid -= 1;
    s.essences.splice(s.essences.indexOf(e), 1);
    if (success) {
      t.options.push({ key: e.key, inherited: true, sourceRarity: e.sourceRarity });
      // 課金アイテムでの成功は天井進捗を変更しない。
      if (!useLiquid) t.failures = 0;
    } else {
      t.failures += 1;
    }
    return { ok: true, success: success, pityHit: pityHit && !useLiquid,
      message: success
        ? OP_DEFS[e.key].label + "の継承に成功しました" + (pityHit && !useLiquid ? "（天井）" : "")
        : "継承失敗。抽出液は消費され、継承先武器と解放済み枠は残りました" };
  }

  // 試作進捗専用の復元バリデーション。不正・旧形式データで画面をクラッシュさせない。
  // 本番の不正対策ではない（商用の継承・消費は必ずサーバーで検証する）。
  function isValidDemoState(s) {
    if (!s || typeof s !== "object" || Array.isArray(s) || s.version !== 1 ||
        !Number.isSafeInteger(s.seq) || s.seq < 0 || s.seq > 100000 ||
        !Number.isInteger(s.trialLiquid) || s.trialLiquid < 0 || s.trialLiquid > 20 ||
        !Array.isArray(s.sources) || !Array.isArray(s.essences) || !Array.isArray(s.targets) ||
        s.sources.length > 55 || s.essences.length > 55 || s.targets.length !== 4) return false;
    const ids = new Set();
    let maxSeq = 0;
    function validId(id, prefix) {
      if (typeof id !== "string" || !new RegExp("^" + prefix + "_[1-9][0-9]*$").test(id) || ids.has(id)) return false;
      const n = Number(id.slice(prefix.length + 1));
      if (!Number.isSafeInteger(n) || n > s.seq) return false;
      ids.add(id);
      maxSeq = Math.max(maxSeq, n);
      return true;
    }
    for (const w of s.sources) {
      if (!w || !validId(w.id, "src") || typeof w.name !== "string" || w.name.length > 80 ||
          w.name.length < 1 || !ORDER.includes(w.rarity) ||
          !(w.optionKey === null || Object.prototype.hasOwnProperty.call(OP_DEFS, w.optionKey)) ||
          w.natural !== (w.optionKey !== null)) return false;
    }
    for (const e of s.essences) {
      if (!e || !validId(e.id, "ess") || !Object.prototype.hasOwnProperty.call(OP_DEFS, e.key) ||
          !ORDER.includes(e.sourceRarity) || e.optionRarity !== OP_DEFS[e.key].rarity ||
          e.count !== EXTRACT_COUNT[e.optionRarity]) return false;
    }
    const seenTargets = new Set();
    for (const t of s.targets) {
      if (!t || !Object.prototype.hasOwnProperty.call(SLOT_LEVELS, t.id) || t.id === "n" || seenTargets.has(t.id) ||
          t.rarity !== t.id || typeof t.name !== "string" || !t.name ||
          !Number.isInteger(t.plus) || t.plus < 0 || t.plus > 99 ||
          !Number.isInteger(t.opened) || t.opened < 0 || t.opened > SLOT_LEVELS[t.id].length ||
          !Array.isArray(t.options) || t.options.length > t.opened ||
          !Number.isInteger(t.failures) || t.failures < 0 || t.failures > (PITY_LIMIT[t.id] || 0)) return false;
      seenTargets.add(t.id);
      if (t.opened > 0 && t.plus < SLOT_LEVELS[t.id][t.opened - 1]) return false;
      const seenOptions = new Set();
      let specialCount = 0;
      for (const o of t.options) {
        if (!o || !Object.prototype.hasOwnProperty.call(OP_DEFS, o.key) || seenOptions.has(o.key) ||
            o.inherited !== true || !ORDER.includes(o.sourceRarity) ||
            ORDER.indexOf(o.sourceRarity) >= ORDER.indexOf(t.rarity)) return false;
        seenOptions.add(o.key);
        if (OP_DEFS[o.key].special) specialCount++;
      }
      if (specialCount > 1) return false;
    }
    return seenTargets.size === 4 && maxSeq <= s.seq;
  }
  const api = { ORDER, SLOT_LEVELS, EXTRACT_COUNT, RATES, PITY_LIMIT, OP_DEFS, isValidDemoState,
    createDemo, addSamples, increasePlus, openSocket, extract, validate, inherit };
  root.QPCore = root.QPCore || {};
  root.QPCore.optionInheritanceTrial = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

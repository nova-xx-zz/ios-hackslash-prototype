// ---------- ショップ（課金要素。model/shop） ----------
// 買い切りの解放（自動周回x100・戦闘速度x3/x5）・確定強化石・仲間のBOXの拡張と、それに伴う上限の判定をまとめる。
// プロトタイプでは決済が無いため、purchase がそのまま付与する（本番化では決済の確認後に同じ処理で付与し、
// 購入の記録と確定強化石の残高はサーバーを正本にする。docs/production-plan.md §5.7）。画面には依存しない。
//   createShop({ data: { SHOP_PRODUCTS, ROSTER_CAPACITY, AUTO_REPEAT_CHOICES, BATTLE_SPEEDS, getDungeon }, state, now })
//     state.purchases: { unlocks: { autoRepeat100: true, ... }, rosterBoxes: 拡張した回数, history: [{ id, at }] }（js/model/save.js）
(function (root) {
  "use strict";

  const HISTORY_MAX = 200;

  function createShop(deps) {
    const S = deps.state;
    const { SHOP_PRODUCTS, ROSTER_CAPACITY, AUTO_REPEAT_CHOICES, BATTLE_SPEEDS } = deps.data;
    const now = deps.now || (() => Date.now());
    const isFeatureEnabled = deps.data.isFeatureEnabled || (() => true);
    const cleared = (id) => !!(S.clearedDungeons && S.clearedDungeons.has(id));

    function purchases() {
      if (!S.purchases) S.purchases = { unlocks: {}, rosterBoxes: 0, history: [] };
      return S.purchases;
    }
    function hasUnlock(key) { return !key || !!purchases().unlocks[key]; }
    function getProduct(id) { return SHOP_PRODUCTS.find((p) => p.id === id) || null; }
    // 並べる商品（product.feature の機能フラグが無効な商品は並べず、買えない）
    function available(product) { return !product.feature || isFeatureEnabled(product.feature); }
    function products() { return SHOP_PRODUCTS.filter(available); }

    // ---------- 仲間のBOX ----------
    function maxRosterBoxes() { return Math.floor((ROSTER_CAPACITY.max - ROSTER_CAPACITY.base) / ROSTER_CAPACITY.step); }
    function rosterCapacity() {
      return Math.min(ROSTER_CAPACITY.max, ROSTER_CAPACITY.base + purchases().rosterBoxes * ROSTER_CAPACITY.step);
    }
    // あと n 人増やせるか（上限を超えて持っている場合は増やせない）
    function canAddToRoster(n) { return S.roster.length + (n || 1) <= rosterCapacity(); }

    // ---------- 選べる回数・速さ ----------
    function autoRepeatChoices() { return AUTO_REPEAT_CHOICES.map((c) => ({ n: c.n, locked: !hasUnlock(c.unlock), unlock: c.unlock || null })); }
    function battleSpeeds() { return BATTLE_SPEEDS.filter((s) => hasUnlock(s.unlock)).map((s) => s.mult); }
    // 今の速さの次の速さ（持っている速さだけを x1→x2→x3→x5→x1 の順に回る）
    function nextBattleSpeed(current) {
      const list = battleSpeeds();
      const i = list.indexOf(current);
      return list[(i + 1) % list.length];
    }

    // ---------- 商品 ----------
    // 状態: { owned（買い切りで持っている）, soldOut（これ以上買えない）, freeUnlocked（無料の条件で解放済み）, count（拡張した回数）,
    //        locked（まだ買えない）, requires（買えるようになる条件。{ dungeonId, dungeonName }）}
    function productStatus(product) {
      const st = baseStatus(product);
      const need = product.requiresCleared;
      if (need && !st.owned && !st.freeUnlocked && !cleared(need)) {
        const d = deps.data.getDungeon ? deps.data.getDungeon(need) : null;
        st.locked = true;
        st.requires = { dungeonId: need, dungeonName: d ? d.name : need };
      }
      return st;
    }
    function baseStatus(product) {
      if (product.kind === "unlock") {
        const owned = hasUnlock(product.unlock);
        // freeIfCleared: そのダンジョンの踏破で無料で解放される商品は、解放後は受け取れない（特殊ジョブ。docs/special-job-design.md §6）
        const freeUnlocked = !owned && !!product.freeIfCleared && cleared(product.freeIfCleared);
        return { owned, soldOut: owned || freeUnlocked, freeUnlocked };
      }
      if (product.kind === "rosterBox") {
        const count = purchases().rosterBoxes;
        return { owned: false, soldOut: count >= maxRosterBoxes(), count };
      }
      return { owned: false, soldOut: false };
    }
    // 購入する（プロトタイプでは無料で付与）。結果: { ok, product, reason（"unknown"・"soldOut"）}
    function purchase(id) {
      const product = getProduct(id);
      if (!product || !available(product)) return { ok: false, reason: "unknown" };
      const st = productStatus(product);
      if (st.soldOut) return { ok: false, product, reason: "soldOut" };
      if (st.locked) return { ok: false, product, reason: "locked" };
      const p = purchases();
      if (product.kind === "unlock") p.unlocks[product.unlock] = true;
      else if (product.kind === "rosterBox") p.rosterBoxes += 1;
      else if (product.kind === "guaranteedStone") S.guaranteedStones.paid += product.amount;
      else return { ok: false, product, reason: "unknown" };
      p.history.push({ id: product.id, at: now() });
      if (p.history.length > HISTORY_MAX) p.history.splice(0, p.history.length - HISTORY_MAX);
      return { ok: true, product };
    }

    return {
      hasUnlock, getProduct, products, rosterCapacity, canAddToRoster, maxRosterBoxes,
      autoRepeatChoices, battleSpeeds, nextBattleSpeed, productStatus, purchase,
    };
  }

  // セーブから読んだ購入の記録を使える形にそろえる（壊れた値は捨てる）
  function normalizePurchases(data) {
    const out = { unlocks: {}, rosterBoxes: 0, history: [] };
    if (!data || typeof data !== "object") return out;
    if (data.unlocks && typeof data.unlocks === "object") {
      for (const [k, v] of Object.entries(data.unlocks)) if (v === true) out.unlocks[k] = true;
    }
    const n = Number(data.rosterBoxes);
    out.rosterBoxes = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    if (Array.isArray(data.history)) {
      out.history = data.history.filter((h) => h && typeof h.id === "string" && typeof h.at === "number").slice(-HISTORY_MAX);
    }
    return out;
  }

  const exported = { createShop, normalizePurchases };
  root.QPModel = root.QPModel || {};
  root.QPModel.shop = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

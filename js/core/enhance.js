// ---------- 装備強化の計算（enhance） ----------
// 成功率・消費・天井・確定強化石の必要個数と、1回の強化の判定を行う。
// ゲームの状態は変更せず、結果だけを返す（反映はgame.js側）。本番化では同じ関数をサーバーで動かし、
// 強化の判定と確定強化石の消費をサーバーを正本にする（docs/production-plan.md §3.2）。
// rules（数値の設定）は js/data.js の ENHANCE_RULES を渡す。
(function (root) {
  "use strict";

  function successRate(rules, rarity, plus) {
    const cfg = rules.config[rarity];
    const rate = cfg.baseRate * Math.pow(cfg.decay, plus || 0);
    return Math.max(cfg.rateFloor !== undefined ? cfg.rateFloor : rules.rateFloor, rate);
  }

  function cost(rules, rarity, plus) {
    const cfg = rules.config[rarity];
    return Math.round(cfg.cost + (plus || 0) * (cfg.costPerPlus || 0));
  }

  // 今の+値から1段上げるのに必要な強化石の期待値（1回の消費 ÷ 成功率）
  function expectedCost(rules, rarity, plus) {
    return cost(rules, rarity, plus) / successRate(rules, rarity, plus);
  }

  // 天井: 今の+値で失敗に使った強化石がこの値に達したら、次の強化は必ず成功する
  function pityThreshold(rules, rarity, plus) {
    return Math.ceil(expectedCost(rules, rarity, plus) * rules.pityMult);
  }

  // 確定強化石: 1個を強化石rules.guaranteedStoneValue個ぶんとみなし、その段の期待消費に応じて必要個数が増える
  function guaranteedRequired(rules, rarity, plus) {
    return Math.max(1, Math.ceil(expectedCost(rules, rarity, plus) / rules.guaranteedStoneValue));
  }

  // 強化石で1回強化する。opts: { rng, pityEnabled }
  // 戻り値: { success, pityHit, cost, plus（判定後の+値）, pity（判定後の天井ゲージ） }
  function attempt(rules, item, opts) {
    const plus = item.plus || 0;
    const pity = item.pity || 0;
    const c = cost(rules, item.rarity, plus);
    const pityHit = !!opts.pityEnabled && pity >= pityThreshold(rules, item.rarity, plus);
    const success = pityHit || opts.rng.chance(successRate(rules, item.rarity, plus));
    if (success) return { success, pityHit, cost: c, plus: plus + 1, pity: 0 }; // +値が変わったらゲージは0から
    return { success, pityHit, cost: c, plus, pity: opts.pityEnabled ? pity + c : pity };
  }

  // 確定強化石で1回強化する（必ず成功）。stones: { free, paid }。消費は無償分から行う
  // 戻り値: 足りなければ { ok: false, required }、足りれば { ok: true, required, stones（消費後）, plus, pity: 0 }
  function useGuaranteed(rules, item, stones) {
    const required = guaranteedRequired(rules, item.rarity, item.plus || 0);
    if (stones.free + stones.paid < required) return { ok: false, required };
    const fromFree = Math.min(required, stones.free);
    return {
      ok: true,
      required,
      stones: { free: stones.free - fromFree, paid: stones.paid - (required - fromFree) },
      plus: (item.plus || 0) + 1,
      pity: 0,
    };
  }

  const exported = { successRate, cost, expectedCost, pityThreshold, guaranteedRequired, attempt, useGuaranteed };
  root.QPCore = root.QPCore || {};
  root.QPCore.enhance = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

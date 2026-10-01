// ---------- オフライン進行の計算（offline） ----------
// 離れていた間の自動周回を「何周できたはずか」「各周がどうなったか」まで計算する。
// 実際のATB戦闘は再現せず、パーティ平均Lvとダンジョン推奨Lvの差から踏破確率を概算する。
// 報酬の抽選は通常プレイと同じ rewards.js を使う。ゲームの状態は変更せず、結果だけを返す
// （反映はgame.js側）。本番化では経過時間をサーバー時刻で測り、同じ関数をサーバーで動かす。
(function (root) {
  "use strict";
  const rewards = (root.QPCore && root.QPCore.rewards) || (typeof require === "function" ? require("./rewards.js") : null);

  // 1周あたりの目安秒数（x1速度想定）。timing: { perBattle, perGap, overhead }
  function estimateRunSeconds(battles, timing) {
    return battles * timing.perBattle + Math.max(0, battles - 1) * timing.perGap + timing.overhead;
  }

  // 踏破確率（推奨Lvちょうどで85%、1Lv差ごとに3%、5%〜98%に収める）
  function clearChance(avgLevel, dungeonLevel) {
    return Math.max(0.05, Math.min(0.98, 0.85 + (avgLevel - dungeonLevel) * 0.03));
  }

  // 経過時間と自動周回の残り回数から、挑戦する周回数を決める（端末の時計が戻っていても負にしない）
  function planRuns(p) {
    const elapsedMs = Math.max(0, Math.min(p.elapsedMs, p.maxMs));
    const maxRunsByTime = Math.floor((elapsedMs / 1000) / p.secPerRun);
    const remainingTarget = Math.max(0, p.target - p.done);
    return Math.min(maxRunsByTime, remainingTarget);
  }

  // 1周ぶんを計算する。ctx:
  //   battles, clearChance, rng, rules（REWARD_RULES）,
  //   buildEncounter(i) → 敵の配列, isTamable(key), tameChanceOf(key), rollOne() → 装備1個
  // 戻り値:
  //   cleared, encountered（図鑑に登録する敵キー）, expByBattle（勝利した戦闘ごとのEXP）,
  //   drops（踏破時に持ち帰るドロップ。全滅時は空）, tame（{key, success} または null。全滅時はnull）
  // 通常プレイと同じく、EXPは勝利した戦闘ごとに得て全滅しても残る。ドロップとテイムは踏破した周だけ
  function simulateRun(ctx) {
    const rng = ctx.rng;
    const cleared = rng.chance(ctx.clearChance);
    // 全滅する場合は、何戦目で力尽きたかを抽選する（その戦闘自体は敗北）
    const battlesFought = cleared ? ctx.battles : 1 + rng.int(ctx.battles);
    const battlesWon = cleared ? battlesFought : battlesFought - 1;
    const encountered = [];
    const expByBattle = [];
    const drops = [];
    const defeatedTamable = [];
    for (let i = 0; i < battlesFought; i++) {
      const enemies = ctx.buildEncounter(i);
      for (const e of enemies) encountered.push(e.key);
      if (i >= battlesWon) break; // 敗北した戦闘ではEXP・ドロップを得ない
      expByBattle.push(rewards.battleExp(enemies));
      for (const e of enemies) if (ctx.isTamable(e.key)) defeatedTamable.push(e.key);
      drops.push(...rewards.rollBattleDrops(ctx.rules, ctx.rollOne, rng));
      // 戦闘間の道中イベントのうち、オフラインでは報酬に関わる宝箱だけを反映する
      const isLast = i === ctx.battles - 1;
      if (!isLast && rewards.rollEventKind(ctx.rules, rng) === "treasure") {
        const item = rewards.rollTreasure(ctx.rules, ctx.rollOne, rng);
        if (item) drops.push(item);
      }
    }
    if (!cleared) return { cleared, encountered, expByBattle, drops: [], tame: null };
    const tame = rewards.rollTame(defeatedTamable, ctx.tameChanceOf, rng);
    return { cleared, encountered, expByBattle, drops, tame };
  }

  const exported = { estimateRunSeconds, clearChance, planRuns, simulateRun };
  root.QPCore = root.QPCore || {};
  root.QPCore.offline = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ---------- オフライン進行の計算（offline） ----------
// 離れていた間の自動周回を「何周できたはずか」「各周がどうなったか」まで計算する。
// 戦闘は通常プレイと同じ戦闘エンジン（battle.js）で実際に戦わせ、装備・スキルツリーを含めたキャラの強さを反映する
// （以前はパーティ平均Lvとダンジョン推奨Lvの差から踏破確率を概算していたが、実際の戦闘より大幅に楽観的だった）。
// 報酬の抽選は通常プレイと同じ rewards.js を使う。ゲームの状態は変更せず、結果だけを返す
// （反映はgame.js側）。本番化では経過時間をサーバー時刻で測り、同じ関数をサーバーで動かす。
(function (root) {
  "use strict";
  const rewards = (root.QPCore && root.QPCore.rewards) || (typeof require === "function" ? require("./rewards.js") : null);

  // 1周あたりの目安秒数（x1速度想定）。timing: { perBattle, perGap, overhead }
  // （実際の精算は戦闘ごとの所要時間で行う。これはバックグラウンド復帰時に「1周ぶん経ったか」を判断する目安）
  function estimateRunSeconds(battles, timing) {
    return battles * timing.perBattle + Math.max(0, battles - 1) * timing.perGap + timing.overhead;
  }

  // 1周ぶんを計算する。戦闘は確率で決めず、fight（js/core/battle.js の戦闘エンジンで実際に戦わせる）に任せる。
  // ctx:
  //   battles, rng, rules（REWARD_RULES）, timing（{ perBattle, perGap, overhead }）,
  //   buildEncounter(i) → 敵の配列,
  //   fight(enemies, i) → { won, seconds }（HP/MPはfight側のパーティで戦闘間に持ち越す）,
  //   onEvent(kind)（任意。泉・罠など、戦闘に影響する道中イベントをfight側のパーティに反映する）,
  //   isTamable(key), tameChanceOf(key), rollOne() → 装備1個, rollRareOne() → レア敵が落とす装備1個（省略可）
  // 戻り値:
  //   cleared, seconds（この周にかかったゲーム内時間。x1速度）, encountered（図鑑に登録する敵キー）,
  //   expByBattle（勝利した戦闘ごとのEXP）, drops（踏破時に持ち帰るドロップ。全滅時は空）,
  //   tame（{key, success} または null。全滅時はnull）
  // 通常プレイと同じく、EXPは勝利した戦闘ごとに得て全滅しても残る。ドロップとテイムは踏破した周だけ
  function simulateRun(ctx) {
    const rng = ctx.rng;
    const encountered = [];
    const expByBattle = [];
    const drops = [];
    const defeatedTamable = [];
    let seconds = ctx.timing.overhead;
    for (let i = 0; i < ctx.battles; i++) {
      const enemies = ctx.buildEncounter(i);
      for (const e of enemies) encountered.push(e.key);
      const result = ctx.fight(enemies, i);
      seconds += result.seconds;
      if (!result.won) return { cleared: false, seconds, encountered, expByBattle, drops: [], tame: null };
      expByBattle.push(rewards.battleExp(enemies));
      for (const e of enemies) if (ctx.isTamable(e.key)) defeatedTamable.push(e.key);
      drops.push(...rewards.rollBattleDrops(ctx.rules, ctx.rollOne, rng));
      if (ctx.rollRareOne) drops.push(...rewards.rollRareDrops(enemies, ctx.rollRareOne));
      const isLast = i === ctx.battles - 1;
      if (!isLast) {
        seconds += ctx.timing.perGap;
        const kind = rewards.rollEventKind(ctx.rules, rng);
        if (kind === "treasure") {
          const item = rewards.rollTreasure(ctx.rules, ctx.rollOne, rng);
          if (item) drops.push(item);
        } else if (kind && ctx.onEvent) {
          ctx.onEvent(kind);
        }
      }
    }
    const tame = rewards.rollTame(defeatedTamable, ctx.tameChanceOf, rng);
    return { cleared: true, seconds, encountered, expByBattle, drops, tame };
  }

  const exported = { estimateRunSeconds, simulateRun };
  root.QPCore = root.QPCore || {};
  root.QPCore.offline = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ---------- 画面: 探索画面: 出発・戦闘の開始 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- Battle ----------
const ATB_RATE = 7;
const BASIC_ATTACK = QPCore.battle.BASIC_ATTACK;

let partyEls = {};
let nextBattleTimer = new Array(TEAM_COUNT).fill(null);

function startDungeon(teamIndex, id, opts) {
  opts = opts || {};
  clearTimeout(nextBattleTimer[teamIndex]);
  const run = Runner.startRun(teamIndex, id);
  const d = run.dungeon;
  logEvent(teamIndex, "start", `${d.name} に出発した`, `全${d.battles}戦　推奨レベル ${d.level}`);
  trimTeamLog(teamIndex);
  if (teamIndex === S.activeTeam) {
    buildPartyDock();
    renderDock();
  }
  if (opts.navigate) showScreen("screen-battle");
  startBattle(run);
}

function startBattle(run) {
  const { battle, isBoss } = Runner.startBattle(run);
  logEvent(run.team, "encounter", isBoss ? "ボスが立ちはだかる！" : "敵が現れた！", enemyRoster(battle));
  const rare = battle.enemies.find((e) => e.isRare);
  if (rare) logLine(run.team, `レアモンスター ${rare.name} が現れた！（倒すと良い装備を落とす）`, "system");
  if (run.team === S.activeTeam) renderDock();
}

// 敵の残り状況をテキストで表示（敵パネルの代わり）
function enemyRoster(battle) {
  const counts = {};
  for (const e of battle.enemies) {
    const k = e.name;
    if (!counts[k]) counts[k] = { total: 0, alive: 0 };
    counts[k].total += 1;
    if (e.alive) counts[k].alive += 1;
  }
  return Object.keys(counts)
    .map((k) => {
      const c = counts[k];
      return c.alive === 0 ? `${k} ×${c.total}（全滅）` : `${k} ×${c.alive}`;
    })
    .join("　");
}

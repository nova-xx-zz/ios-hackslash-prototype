// ---------- 画面: 探索画面: ログ（チームごとの履歴） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- Log ----------
// 4チームが並行して進行するため、ログ履歴はチームごとにデータとして保持し、
// 実際にDOMへ描画するのは「現在表示中のチーム」の分だけにする。
// 背後で進行しているチームのログはteamLogsに積み上がるだけで、タブ切替時にrenderLogFeedで一括描画する。
// 周回のたびに消してしまうと直前の結果を見返せないため消さず、直近LOG_HISTORY_RUNS周分だけを残して
// それより古い周回のログはtrimTeamLogでまとめて間引く（大量に自動周回してもDOMが際限なく増えないように）
const LOG_HISTORY_RUNS = 20;
let teamLogs = Array.from({ length: TEAM_COUNT }, () => []); // [{type,title,subtitle,lines:[{text,cls}|{drop:item}]}]

// 待機案内はログDOMとは分ける。最初の戦闘ログの追記や別パーティへの切替でも
// 案内が残ったり、ログ行の追記先（lastElementChild）に混ざったりしないようにする。
function renderExploreScene(teamIndex) {
  const run = teamRuns[teamIndex];
  const idle = !run && teamLogs[teamIndex].length === 0;
  const emptyParty = teamMembers(teamIndex).length === 0;
  document.getElementById("exploreWelcome").classList.toggle("hidden", !idle);
  document.getElementById("logFeed").classList.toggle("hidden", idle);
  document.getElementById("screen-battle").classList.toggle("explore-idle", idle);
  document.getElementById("exploreState").textContent = run
    ? (isTeamRunActive(teamIndex) ? "探索中" : "帰還") : "ギルド待機";
  document.getElementById("exploreWelcomeTitle").textContent = emptyParty ? "仲間を編成しよう" : "冒険の準備";
  document.getElementById("exploreWelcomeCopy").textContent = emptyParty
    ? "このパーティには仲間がいません。編成してから出発しましょう。"
    : "行き先を選んで、探索に出発しましょう。";
  document.getElementById("exploreEmbarkLabel").textContent = emptyParty ? "仲間を編成する" : "マップを開く";
}

document.getElementById("btnExploreEmbark").addEventListener("click", () => {
  if (isTeamLocked(S.activeTeam)) return;
  // 既存の導線を利用し、未編成のまま出撃したり、案内から即座に戦闘を始めたりしない。
  if (activeParty().length) document.getElementById("btnDockMap").click();
  else openPartyScreen("screen-battle"); // まだ誰も編成していなければ、パーティ編成の画面へ直接
});

function trimTeamLog(teamIndex) {
  const entries = teamLogs[teamIndex];
  let startCount = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "start") {
      startCount += 1;
      if (startCount > LOG_HISTORY_RUNS) {
        entries.splice(0, i + 1);
        if (teamIndex === S.activeTeam) renderLogFeed(teamIndex);
        return;
      }
    }
  }
}

function logEvent(teamIndex, type, title, subtitle) {
  const entry = { type, title, subtitle: subtitle || "", lines: [] };
  teamLogs[teamIndex].push(entry);
  if (teamIndex === S.activeTeam) appendLogCardDOM(entry);
  return entry;
}

function logLine(teamIndex, text, cls) {
  const entries = teamLogs[teamIndex];
  if (entries.length === 0) entries.push({ type: "encounter", title: "戦闘", subtitle: "", lines: [] });
  const entry = entries[entries.length - 1];
  entry.lines.push({ text, cls: cls || "" });
  if (teamIndex === S.activeTeam) appendLogLineDOM(text, cls);
}

function logDropLine(teamIndex, item) {
  const entries = teamLogs[teamIndex];
  if (entries.length === 0) return;
  entries[entries.length - 1].lines.push({ drop: item });
  if (teamIndex === S.activeTeam) {
    const feed = document.getElementById("logFeed");
    const card = feed.lastElementChild;
    if (card) card.querySelector(".lc-lines").appendChild(buildDropRow(item));
  }
}

function updateCardSubtitle(teamIndex, text) {
  const entries = teamLogs[teamIndex];
  if (entries.length === 0) return;
  entries[entries.length - 1].subtitle = text || "";
  if (teamIndex !== S.activeTeam) return;
  const feed = document.getElementById("logFeed");
  const card = feed.lastElementChild;
  if (!card) return;
  const sub = card.querySelector(".lc-sub");
  sub.textContent = text || "";
  sub.style.display = text ? "" : "none";
}

function appendLogCardDOM(entry) {
  const feed = document.getElementById("logFeed");
  if (feed.classList.contains("hidden")) renderExploreScene(S.activeTeam);
  const card = document.createElement("div");
  card.className = "log-card " + entry.type;
  const t = document.createElement("div");
  t.className = "lc-title";
  t.textContent = entry.title;
  card.appendChild(t);
  const sub = document.createElement("div");
  sub.className = "lc-sub";
  sub.textContent = entry.subtitle || "";
  if (!entry.subtitle) sub.style.display = "none";
  card.appendChild(sub);
  const lines = document.createElement("div");
  lines.className = "lc-lines";
  for (const l of entry.lines) {
    if (l.drop) { lines.appendChild(buildDropRow(l.drop)); continue; }
    const div = document.createElement("div");
    div.className = "lc-line " + (l.cls || "");
    div.textContent = l.text;
    lines.appendChild(div);
  }
  card.appendChild(lines);
  feed.appendChild(card);
  scrollLog();
}

function appendLogLineDOM(text, cls) {
  const feed = document.getElementById("logFeed");
  const card = feed.lastElementChild;
  if (!card) return;
  const lines = card.querySelector(".lc-lines");
  const div = document.createElement("div");
  div.className = "lc-line " + (cls || "");
  div.textContent = text;
  lines.appendChild(div);
  scrollLog();
}

// 表示するチームを切り替えた時、そのチームのログ履歴からDOMを丸ごと再構築する
function renderLogFeed(teamIndex) {
  const feed = document.getElementById("logFeed");
  feed.innerHTML = "";
  for (const entry of teamLogs[teamIndex]) appendLogCardDOM(entry);
  renderExploreScene(teamIndex);
}

function scrollLog() {
  const feed = document.getElementById("logFeed");
  feed.scrollTop = feed.scrollHeight;
}

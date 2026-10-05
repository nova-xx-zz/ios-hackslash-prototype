// ---------- 画面: 画面の切り替え・タイトル画面・マップ画面 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- Screen management ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---------- Title screen ----------
// タイトル画面は「はじめる」ボタンのみのシンプルな入口とし、常設ナビ（編成／探索／図鑑／設定）は
// 実質的なホーム画面である探索画面（screen-battle）側に置く（hub-nav-row、btnHub*のリスナーを参照）
function renderTitle() {
  const best = getBestStage();
  const bits = [];
  if (best > 0) bits.push(`クリア済みダンジョン: ${best}`);
  bits.push(`所持なかま: ${S.roster.length}人`);
  bits.push(`強化石: ${S.material}`);
  document.getElementById("bestClearText").textContent = bits.join("　/　");
  document.getElementById("btnTitleAnnounce").classList.toggle("hidden", !isFeatureEnabled("announcements"));
  updateAnnounceBadge();
}

document.getElementById("btnGoBattle").addEventListener("click", () => {
  openExploreHub();
});
document.getElementById("btnHubJobs").addEventListener("click", () => {
  jobsReturnScreen = "screen-battle";
  renderJobsScreen();
  showScreen("screen-jobs");
});
document.getElementById("btnHubExplore").addEventListener("click", () => {
  openExploreHub();
});
document.getElementById("btnHubDex").addEventListener("click", () => {
  renderDexScreen();
  showScreen("screen-dex");
});
document.getElementById("btnHubSettings").addEventListener("click", () => {
  showScreen("screen-settings");
});
document.getElementById("btnSettingsBack").addEventListener("click", () => {
  openExploreHub();
});
document.getElementById("btnDexBack").addEventListener("click", () => {
  openExploreHub();
});

function renderDexScreen() {
  document.getElementById("dexCount").textContent =
    `発見済み ${dexSeen.size} / ${ENEMY_TEMPLATES.length} 体`;
  const body = document.getElementById("dexBody");
  body.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "dex-card-grid";
  for (const t of ENEMY_TEMPLATES) {
    const seen = dexSeen.has(t.key);
    const card = document.createElement("button");
    card.className = "dex-card" + (seen ? "" : " locked");
    card.innerHTML = seen
      ? `<div class="dex-card-icon">${t.icon || "❓"}</div>
         <div class="dex-card-name">${t.name}</div>
         <div class="dex-card-element">${t.element}</div>`
      : `<div class="dex-card-icon">❓</div>
         <div class="dex-card-name">？？？</div>
         <div class="dex-card-element">&nbsp;</div>`;
    if (seen) card.addEventListener("click", () => openDexDetail(t.key));
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function openDexDetail(key) {
  const t = getEnemyTemplate(key);
  document.getElementById("dexIcon").textContent = t.icon || "❓";
  document.getElementById("dexName").textContent = t.name;
  document.getElementById("dexElement").textContent =
    `属性: ${t.element}　${t.tamable ? "テイム可能" : "テイム不可"}`;
  document.getElementById("dexDesc").textContent = t.desc || "";
  const statsBox = document.getElementById("dexStats");
  const rows = [
    ["HP", t.hp], ["ATK", t.atk], ["DEF", t.def], ["SPD", t.spd], ["EXP", t.exp],
  ];
  statsBox.innerHTML = rows.map(([label, value]) => `
    <div class="pm-stat-row">
      <span class="pm-stat-label">${label}</span>
      <span class="dex-stat-value">${value}</span>
    </div>`).join("");
  document.getElementById("dexModal").classList.remove("hidden");
}
function closeDexModal() {
  document.getElementById("dexModal").classList.add("hidden");
}
document.getElementById("btnDexModalClose").addEventListener("click", closeDexModal);
document.getElementById("dexModal").addEventListener("click", (e) => {
  if (e.target.id === "dexModal") closeDexModal();
});

function openExploreHub() {
  buildPartyDock();
  renderDock();
  showScreen("screen-battle");
}

// ---------- Map screen ----------
function openMap() {
  renderMap();
  showScreen("screen-map");
}

function renderMap() {
  const nodes = document.getElementById("mapNodes");
  const svg = document.getElementById("mapLines");
  nodes.innerHTML = "";
  svg.innerHTML = "";

  for (const d of DUNGEONS) {
    for (const nextId of d.unlocks) {
      const next = getDungeon(nextId);
      if (!next) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", d.x);
      line.setAttribute("y1", d.y);
      line.setAttribute("x2", next.x);
      line.setAttribute("y2", next.y);
      if (S.clearedDungeons.has(d.id)) line.classList.add("open");
      svg.appendChild(line);
    }
  }

  for (const d of DUNGEONS) {
    const cleared = S.clearedDungeons.has(d.id);
    const open = isDungeonOpen(d);
    const btn = document.createElement("button");
    btn.className = "map-node " + (cleared ? "cleared" : open ? "open" : "locked") +
      (selectedDungeonId === d.id ? " selected" : "");
    btn.style.left = d.x + "%";
    btn.style.top = d.y + "%";
    btn.innerHTML = `<div class="dot">${cleared ? "✓" : open ? "▶" : "—"}</div>
      <div class="label">${d.name}</div>`;
    if (open) btn.addEventListener("click", () => selectDungeon(d));
    nodes.appendChild(btn);
  }
}

function selectDungeon(d) {
  selectedDungeonId = d.id;
  renderMap();
  renderDungeonInfo(d);
}

function renderDungeonInfo(d) {
  const el = document.getElementById("dungeonInfo");
  const party = activeParty();
  el.innerHTML = `
    <div class="dname">${d.name}${S.clearedDungeons.has(d.id) ? "　クリア済み" : ""}</div>
    <div class="dmeta">
      ${d.desc}<br>
      戦闘数: ${d.battles}回（最後はボス戦）
    </div>`;
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.id = "btnEnterDungeon";
  if (party.length === 0) {
    btn.textContent = `${TEAM_NAMES[S.activeTeam]}が空です（編成してください）`;
    btn.disabled = true;
  } else {
    btn.textContent = `${TEAM_NAMES[S.activeTeam]}で出発する`;
    btn.addEventListener("click", () => startDungeon(S.activeTeam, d.id, { navigate: true }));
  }
  el.appendChild(btn);
}

document.getElementById("btnMapBack").addEventListener("click", () => {
  openExploreHub();
});

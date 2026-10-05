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
// タイトル画面は入口のみとし、常設ナビ（編成／探索／図鑑／設定）は実質的なホーム画面である
// 探索画面（screen-battle）側に置く（hub-nav-row、btnHub*のリスナーを参照）。
// 画面のどこをタップしても始まり、下のメニュー（設定/お知らせ・データ保存・データ復元）と右上のお知らせだけは別の動きをする
const APP_VERSION = "0.1.0"; // package.json の version と合わせる
let settingsReturnScreen = "screen-battle"; // 設定画面の「もどる」の戻り先

function renderTitle() {
  document.getElementById("titleVersion").textContent = APP_VERSION;
  document.getElementById("btnTitleAnnounce").classList.toggle("hidden", !isFeatureEnabled("announcements"));
  updateAnnounceBadge();
  showTitleMessage("");
}

let titleMessageTimer = null;
function showTitleMessage(text, isError) {
  const el = document.getElementById("titleMessage");
  clearTimeout(titleMessageTimer);
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("error", !!isError);
  if (text) titleMessageTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function openSettings(returnScreen) {
  settingsReturnScreen = returnScreen;
  showScreen("screen-settings");
}

document.getElementById("screen-title").addEventListener("click", (e) => {
  if (e.target.closest("button:not(#btnGoBattle)")) return; // メニューのボタンは各自の処理に任せる
  openExploreHub();
});
document.getElementById("btnTitleSettings").addEventListener("click", () => openSettings("screen-title"));
document.getElementById("btnTitleBackup").addEventListener("click", async () => {
  if (!window.QPCloud) { showTitleMessage("クラウドセーブを使えません", true); return; }
  showTitleMessage("バックアップしています…");
  const ok = await QPCloud.backupNow();
  const st = QPCloud.getState();
  if (ok) showTitleMessage(`クラウドに保存しました（${formatDateTime(st.lastUploadAt)}）`);
  else showTitleMessage(st.error || "保存できませんでした", true);
});
// 復元は取り消せないため、設定画面で内容を確かめてから2回押しで行う（1回目をここで押した状態にする）
document.getElementById("btnTitleRestore").addEventListener("click", () => {
  if (!window.QPCloud) { showTitleMessage("クラウドセーブを使えません", true); return; }
  openSettings("screen-title");
  document.getElementById("btnCloudRestore").click();
});
document.getElementById("btnHubJobs").addEventListener("click", () => {
  jobsReturnScreen = "screen-battle";
  renderJobsScreen();
  showScreen("screen-jobs");
});
document.getElementById("btnHubExplore").addEventListener("click", () => {
  openExploreHub();
});
document.getElementById("btnHubDex").addEventListener("click", () => openBook()); // 書物（js/ui/book.js）
document.getElementById("btnHubSettings").addEventListener("click", () => openSettings("screen-battle"));
document.getElementById("btnSettingsBack").addEventListener("click", () => {
  if (settingsReturnScreen === "screen-title") { renderTitle(); showScreen("screen-title"); }
  else openExploreHub();
});

// モンスターの詳細（書物のモンスター辞典から開く）
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
// 地方: マップは地方ごとに表示する。開いた時は、行ける中で一番奥のダンジョンがある地方を表示する
let mapRegionId = null;
function regionReached(region) {
  return DUNGEONS.some((d) => d.region === region.id && isDungeonOpen(d));
}
function openMap() {
  const selected = selectedDungeonId && getDungeon(selectedDungeonId);
  const furthest = DUNGEONS.filter((d) => isDungeonOpen(d)).pop();
  mapRegionId = (selected || furthest || DUNGEONS[0]).region;
  renderMap();
  showScreen("screen-map");
}
function renderRegionTabs() {
  const tabs = document.getElementById("mapRegionTabs");
  tabs.innerHTML = "";
  const regions = REGIONS.filter((r) => DUNGEONS.some((d) => d.region === r.id));
  tabs.classList.toggle("hidden", regions.length < 2); // 地方が1つだけの間は切り替えを出さない
  for (const region of regions) {
    const reached = regionReached(region);
    const btn = document.createElement("button");
    btn.className = "map-region-tab" + (region.id === mapRegionId ? " active" : "");
    btn.textContent = reached ? region.name : "？？？";
    btn.disabled = !reached;
    btn.addEventListener("click", () => { mapRegionId = region.id; renderMap(); });
    tabs.appendChild(btn);
  }
  const current = REGIONS.find((r) => r.id === mapRegionId);
  document.getElementById("mapRegionDesc").textContent = current ? `${current.name}　${current.desc}` : "";
}

function renderMap() {
  const nodes = document.getElementById("mapNodes");
  const svg = document.getElementById("mapLines");
  nodes.innerHTML = "";
  svg.innerHTML = "";
  if (!mapRegionId) mapRegionId = DUNGEONS[0].region;
  renderRegionTabs();
  const inRegion = DUNGEONS.filter((d) => d.region === mapRegionId);

  for (const d of inRegion) {
    for (const nextId of d.unlocks) {
      const next = getDungeon(nextId);
      if (!next || next.region !== mapRegionId) continue; // 次の地方へのつながりは線を引かない
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", d.x);
      line.setAttribute("y1", d.y);
      line.setAttribute("x2", next.x);
      line.setAttribute("y2", next.y);
      if (S.clearedDungeons.has(d.id)) line.classList.add("open");
      svg.appendChild(line);
    }
  }

  for (const d of inRegion) {
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

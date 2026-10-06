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
  // 地方が増えて横にはみ出す時も、表示中の地方のボタンが見えるようにする
  // （マップを開く時は画面を表示する前に描くため、表示されてから位置を測る）
  requestAnimationFrame(() => {
    const active = tabs.querySelector(".map-region-tab.active");
    if (!active) return;
    const offset = active.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
    tabs.scrollLeft = Math.max(0, offset - (tabs.clientWidth - active.offsetWidth) / 2);
  });
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
    // ハード・エクストラを踏破したダンジョンには小さな印（H・EX）を付ける
    const modeMark = S.clearedExtra.has(d.id) ? '<span class="mode-mark extra">EX</span>'
      : S.clearedHard.has(d.id) ? '<span class="mode-mark hard">H</span>' : "";
    const btn = document.createElement("button");
    btn.className = "map-node " + (cleared ? "cleared" : open ? "open" : "locked") +
      (selectedDungeonId === d.id ? " selected" : "");
    btn.style.left = d.x + "%";
    btn.style.top = d.y + "%";
    btn.innerHTML = `<div class="dot">${cleared ? "✓" : open ? "▶" : "—"}${modeMark}</div>
      <div class="label">${d.name}</div>`;
    if (open) btn.addEventListener("click", () => selectDungeon(d));
    nodes.appendChild(btn);
  }
}

function selectDungeon(d) {
  if (selectedDungeonId !== d.id) selectedDungeonMode = "normal";
  selectedDungeonId = d.id;
  renderMap();
  renderDungeonInfo(d);
}

// モードを選べるか: ハードはノーマルの踏破、エクストラはハードの踏破で開く
let selectedDungeonMode = "normal";
function isDungeonModeOpen(d, mode) {
  if (mode === "hard") return S.clearedDungeons.has(d.id);
  if (mode === "extra") return S.clearedHard.has(d.id);
  return isDungeonOpen(d);
}
function isDungeonModeCleared(d, mode) {
  return (mode === "hard" ? S.clearedHard : mode === "extra" ? S.clearedExtra : S.clearedDungeons).has(d.id);
}

function renderDungeonInfo(d) {
  const el = document.getElementById("dungeonInfo");
  const party = activeParty();
  if (!isDungeonModeOpen(d, selectedDungeonMode)) selectedDungeonMode = "normal";
  const md = getModeDungeon(d.id, selectedDungeonMode);
  const modeNote = { hard: "敵が強く、EXPが1.5倍。落ちる装備にオプション効果が1〜2個付く",
    extra: "敵がとても強く、EXPが2倍。落ちる装備に強いオプション効果が2〜3個付く" }[selectedDungeonMode];
  el.innerHTML = `
    <div class="dname"></div>
    <div class="mode-row"></div>
    <div class="dmeta">
      ${d.desc}<br>
      推奨レベル: ${md.level}　戦闘数: ${d.battles}回（最後はボス戦）${modeNote ? `<br><span class="mode-note">${modeNote}</span>` : ""}
    </div>`;
  el.querySelector(".dname").textContent = `${d.name}${isDungeonModeCleared(d, selectedDungeonMode) ? "　クリア済み" : ""}`;
  // モードの切り替え（まだ開いていないモードは、開く条件を出して押せなくする）
  const row = el.querySelector(".mode-row");
  for (const m of DUNGEON_MODES) {
    const open = isDungeonModeOpen(d, m.key);
    const chip = document.createElement("button");
    chip.className = `mode-chip ${m.key}` + (selectedDungeonMode === m.key ? " active" : "");
    chip.textContent = open ? m.name : `${m.name}（${m.key === "hard" ? "ノーマル" : "ハード"}を踏破で解放）`;
    chip.disabled = !open;
    chip.addEventListener("click", () => { selectedDungeonMode = m.key; renderDungeonInfo(d); });
    row.appendChild(chip);
  }
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.id = "btnEnterDungeon";
  if (party.length === 0) {
    btn.textContent = `${TEAM_NAMES[S.activeTeam]}が空です（編成してください）`;
    btn.disabled = true;
  } else {
    btn.textContent = `${TEAM_NAMES[S.activeTeam]}で出発する${selectedDungeonMode !== "normal" ? `（${getDungeonMode(selectedDungeonMode).name}）` : ""}`;
    const mode = selectedDungeonMode;
    btn.addEventListener("click", () => startDungeon(S.activeTeam, d.id, { navigate: true, mode }));
  }
  el.appendChild(btn);
}

document.getElementById("btnMapBack").addEventListener("click", () => {
  openExploreHub();
});

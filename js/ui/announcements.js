// ---------- 画面: 冒険者ギルドからのお知らせ・今後の予定（モーダルの順番待ちを含む） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- 冒険者ギルドからのお知らせ ----------
// 既読は { [告知id]: 既読済みrevision } で保存し、announcement.revision以上なら既読とみなす
// （本文を重要な改訂をした場合はrevisionを上げれば自動的に未読へ戻る）
let readAnnouncements = {};
{
  const savedRead = store.getJSON(KEYS.readAnnouncements, null); // 壊れていたら空のまま
  if (savedRead && typeof savedRead === "object") readAnnouncements = savedRead;
}
function saveReadAnnouncements() {
  store.setJSON(KEYS.readAnnouncements, readAnnouncements);
}
function isAnnouncementRead(a) { return (readAnnouncements[a.id] || 0) >= a.revision; }
function markAnnouncementRead(a) {
  readAnnouncements[a.id] = a.revision;
  saveReadAnnouncements();
}

const ANNOUNCE_CATEGORY_LABELS = { notice: "📢お知らせ", update: "✨アップデート", balance: "🔧調整", preview: "🔮予告" };
const ROADMAP_STATUS_LABELS = { released: "公開済み", development: "開発中", planned: "公開予定" };

function formatAnnounceDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
  } catch (e) { return ""; }
}

// 公開期間内(visible/publishedAt/expiresAt)の告知だけを対象にする
function visibleAnnouncements() {
  const now = Date.now();
  return ANNOUNCEMENTS.filter((a) => {
    if (!a.visible) return false;
    if (a.publishedAt && new Date(a.publishedAt).getTime() > now) return false;
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return false;
    return true;
  });
}

// 起動時に自動表示する告知を1件だけ選ぶ。強制再表示(important+forceDisplay)があればそれを優先し、
// なければ未読のうち公開日時が新しいものを選ぶ（同日時はidで安定ソート）
function pickStartupAnnouncement() {
  const candidates = visibleAnnouncements().filter((a) => a.showOnStartup);
  const forced = candidates.filter((a) => a.priority === "important" && a.forceDisplay);
  const pool = forced.length > 0 ? forced : candidates.filter((a) => !isAnnouncementRead(a));
  if (pool.length === 0) return null;
  return pool.slice().sort((a, b) => {
    const diff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    return diff !== 0 ? diff : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  })[0];
}

function updateAnnounceBadge() {
  const hasUnread = isFeatureEnabled("announcements") && visibleAnnouncements().some((a) => !isAnnouncementRead(a));
  document.getElementById("titleAnnounceBadge").classList.toggle("hidden", !hasUnread);
}

// 起動時のモーダル表示キュー（お知らせ→オフライン結果の順で、重ねずに1つずつ開く）
let modalQueue = [];
function enqueueModal(renderFn) { modalQueue.push(renderFn); }
function processModalQueue() {
  if (modalQueue.length === 0) return;
  if (document.querySelector(".modal-overlay:not(.hidden)")) return;
  const next = modalQueue.shift();
  next();
}

function openAnnouncementModal(a) {
  document.getElementById("announceModalTitle").textContent = a.title;
  document.getElementById("announceModalMeta").textContent =
    `${formatAnnounceDate(a.publishedAt)}　${ANNOUNCE_CATEGORY_LABELS[a.category] || a.category}`;
  const bodyEl = document.getElementById("announceModalBody");
  bodyEl.innerHTML = "";
  for (const line of a.body) {
    const p = document.createElement("p");
    p.textContent = line; // 告知本文は必ずtextContentで描画する（innerHTMLへ直接挿入しない）
    bodyEl.appendChild(p);
  }
  // 詳細を実際に描画した時だけ既読にする（一覧を開いただけでは既読にしない）
  markAnnouncementRead(a);
  updateAnnounceBadge();
  document.getElementById("announcementModal").classList.remove("hidden");
}
document.getElementById("btnAnnounceModalClose").addEventListener("click", () => {
  document.getElementById("announcementModal").classList.add("hidden");
  processModalQueue();
});

let announceTab = "notice"; // "notice" | "roadmap"
let announceReturnScreen = "screen-title";

function openAnnouncementsScreen(returnScreen) {
  announceReturnScreen = returnScreen;
  announceTab = "notice";
  renderAnnouncementsScreen();
  showScreen("screen-announcements");
}

function renderAnnouncementsScreen() {
  const tabs = document.getElementById("announceTabs");
  tabs.innerHTML = "";
  const tabDefs = [{ key: "notice", label: "お知らせ" }, { key: "roadmap", label: "今後の予定" }];
  for (const t of tabDefs) {
    const btn = document.createElement("button");
    btn.className = "detail-tab" + (announceTab === t.key ? " active" : "");
    btn.textContent = t.label;
    btn.addEventListener("click", () => { announceTab = t.key; renderAnnouncementsScreen(); });
    tabs.appendChild(btn);
  }

  const body = document.getElementById("announceBody");
  body.innerHTML = "";
  if (announceTab === "notice") {
    const list = visibleAnnouncements().slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    if (list.length === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = "お知らせはまだありません";
      body.appendChild(none);
    }
    for (const a of list) {
      const row = document.createElement("button");
      row.className = "announce-row" + (isAnnouncementRead(a) ? "" : " unread");
      const meta = document.createElement("div");
      meta.className = "announce-row-meta";
      meta.textContent = `${formatAnnounceDate(a.publishedAt)}　${ANNOUNCE_CATEGORY_LABELS[a.category] || a.category}`;
      row.appendChild(meta);
      const title = document.createElement("div");
      title.className = "announce-row-title";
      title.textContent = a.title;
      row.appendChild(title);
      row.addEventListener("click", () => openAnnouncementModal(a));
      body.appendChild(row);
    }
  } else {
    for (const r of ROADMAP) {
      const row = document.createElement("div");
      row.className = "roadmap-row";
      const status = document.createElement("span");
      status.className = "roadmap-status " + r.status;
      status.textContent = ROADMAP_STATUS_LABELS[r.status] || r.status;
      row.appendChild(status);
      const title = document.createElement("div");
      title.className = "roadmap-title";
      title.textContent = r.title;
      row.appendChild(title);
      const summary = document.createElement("div");
      summary.className = "roadmap-summary";
      summary.textContent = r.summary;
      row.appendChild(summary);
      const timing = document.createElement("div");
      timing.className = "roadmap-timing";
      timing.textContent = r.timingLabel;
      row.appendChild(timing);
      body.appendChild(row);
    }
  }
}

document.getElementById("btnTitleAnnounce").addEventListener("click", () => openAnnouncementsScreen("screen-title"));
document.getElementById("btnSettingsAnnounce").addEventListener("click", () => openAnnouncementsScreen("screen-settings"));
document.getElementById("btnAnnounceBack").addEventListener("click", () => {
  if (announceReturnScreen === "screen-settings") showScreen("screen-settings");
  else { renderTitle(); showScreen("screen-title"); }
});

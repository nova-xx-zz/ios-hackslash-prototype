// ---------- 画面: 自動周回の完了通知（アプリ版のみ） ----------
// iOSアプリ（Capacitor）でだけ、アプリを離れる時に自動周回が終わる頃の通知を予約し、戻ってきたら取り消す
// （@capacitor/local-notifications。サーバーは使わず、端末の中で予約する）。ブラウザ版では何もしない。
// 予定の計算は js/core/notices.js。通知の許可は、自動周回を始めた時（初回だけ）に求める。
// js/ui/ の各ファイルと js/game.js は、同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する。
"use strict";

const OFFLINE_NOTICE_MAX_MS = 8 * 60 * 60 * 1000; // 離れていた間に精算できる時間の上限（js/model/run.js と同じ）

function localNotifications() {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.LocalNotifications) || null;
}
function isNotifySupported() { return !!localNotifications(); }
function isNotifyEnabled() { return store.getString(KEYS.notifyAutoRepeat) !== "0"; } // 既定はON
function setNotifyEnabled(on) { store.set(KEYS.notifyAutoRepeat, on ? "1" : "0"); }

// 通知の許可を求める（まだ聞いていない時だけ。断られていたら何もしない）
async function ensureNotifyPermission() {
  const ln = localNotifications();
  if (!ln || !isNotifyEnabled()) return false;
  try {
    const st = await ln.checkPermissions();
    if (st.display === "granted") return true;
    if (st.display === "denied") return false;
    const req = await ln.requestPermissions();
    return req.display === "granted";
  } catch (e) { return false; }
}

async function cancelAutoRepeatNotices() {
  const ln = localNotifications();
  if (!ln) return;
  try {
    await ln.cancel({ notifications: QPCore.notices.noticeIds(TEAM_COUNT).map((id) => ({ id })) });
  } catch (e) { /* 予約が無い時などは無視する */ }
}

// アプリを離れる時に呼ぶ: 自動周回中のチームごとに、終わる頃の通知を予約する
async function scheduleAutoRepeatNotices() {
  const ln = localNotifications();
  if (!ln) return;
  await cancelAutoRepeatNotices();
  if (!isNotifyEnabled()) return;
  const teams = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    const ar = S.autoRepeat[i];
    const run = teamRuns[i];
    if (!ar.active || !run || !run.dungeon) continue;
    const d = run.dungeon;
    teams.push({
      team: i, teamName: TEAM_NAMES[i],
      dungeonName: d.mode ? `${d.name}（${getDungeonMode(d.mode).name}）` : d.name,
      target: ar.target, done: ar.done, runSeconds: Runner.estimateOfflineRunSeconds(d),
    });
  }
  const plan = QPCore.notices.planAutoRepeatNotices(teams, Date.now(), OFFLINE_NOTICE_MAX_MS);
  if (plan.length === 0) return;
  try {
    const st = await ln.checkPermissions();
    if (st.display !== "granted") return;
    await ln.schedule({
      notifications: plan.map((n) => ({ id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at), allowWhileIdle: true } })),
    });
  } catch (e) { /* 予約できなくてもゲームは続ける */ }
}

// 設定画面: アプリ版だけ「自動周回の完了通知」のON/OFFを出す
function renderNotifySetting() {
  const row = document.getElementById("settingsNotify");
  if (!row) return;
  row.classList.toggle("hidden", !isNotifySupported());
  const btn = document.getElementById("btnNotifyToggle");
  btn.textContent = isNotifyEnabled() ? "ON" : "OFF";
  btn.classList.toggle("toggle-on", isNotifyEnabled());
}
document.getElementById("btnNotifyToggle").addEventListener("click", async () => {
  const on = !isNotifyEnabled();
  setNotifyEnabled(on);
  renderNotifySetting();
  if (on) {
    const ok = await ensureNotifyPermission();
    const msg = document.getElementById("notifyMessage");
    msg.textContent = ok ? "" : "通知が許可されていません。iPhoneの「設定」→「通知」→「ソードクレスト」から許可してください";
    msg.classList.toggle("hidden", ok);
  } else {
    cancelAutoRepeatNotices();
  }
});
renderNotifySetting();
// 起動した時（アプリを終了してから開き直した時）も、まだ届いていない通知は取り消す
cancelAutoRepeatNotices();

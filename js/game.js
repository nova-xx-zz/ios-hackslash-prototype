// ---------- 起動処理 ----------
// ゲームのルールと状態は js/model/、各画面の処理は js/ui/。ここではアプリを離れる・戻る時の保存と精算、起動時の読み込みを行う。
"use strict";

// タブを閉じる・バックグラウンドに回す・アプリを切り替えるなど、
// ページが見えなくなるタイミングで必ず保存しておく（iOS Safariでは
// beforeunload/pagehideが確実に発火しないことがあるため、visibilitychangeも併用）
// バックグラウンド中はrequestAnimationFrameが止まり戦闘が進まないため、ページを破棄されずに復帰した場合も
// 起動時と同じオフライン精算を行う。隠れる直前に保存したセーブのsavedAtを起点にするので、
// 復帰せずにページが破棄された場合（次回起動時に精算）と二重に精算されることはない
let hiddenSaveAt = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenSaveAt = saveGame() ? lastSavedAt : null;
    scheduleAutoRepeatNotices(); // アプリ版: 自動周回が終わる頃の通知を予約する（js/ui/notify.js）
    return;
  }
  cancelAutoRepeatNotices(); // 戻ってきたら、まだ届いていない通知は取り消す
  const since = hiddenSaveAt;
  hiddenSaveAt = null;
  if (since) settleAfterBackground(since);
});

function settleAfterBackground(savedAt) {
  const elapsedMs = Date.now() - savedAt;
  // 1周ぶんの時間も経っていないチームは、中断せずそのまま続きから再開する
  const targets = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    const run = teamRuns[i];
    if (!S.autoRepeat[i].active || !run || !run.dungeon) continue;
    if (elapsedMs / 1000 < Runner.estimateOfflineRunSeconds(run.dungeon)) continue;
    targets.push(i);
  }
  if (targets.length === 0) return;

  const infos = new Array(TEAM_COUNT).fill(null);
  for (const i of targets) {
    const run = teamRuns[i];
    infos[i] = { active: true, target: S.autoRepeat[i].target, done: S.autoRepeat[i].done, dungeonId: run.dungeon.id, mode: run.dungeon.mode || "normal" };
    // 離れる直前の周回は途中で止まっているため打ち切り、離れていた時間ぶんはまとめて精算する
    // （起動時の精算で途中の周回を破棄するのと同じ扱い。この周の未確定ドロップは持ち帰れない）
    clearTimeout(nextBattleTimer[i]);
    if (Runner.interruptRun(i)) {
      logEvent(i, "wipe", "アプリを離れていたため、この周回を中断した", "離れていた間の自動周回はまとめて精算しました");
    }
  }
  const summaries = runOfflineProgress(infos, savedAt);
  // 精算した報酬と自動周回の停止を1回の保存で確定する（失敗しても端末には精算前のセーブが残る。js/ui/models.js）
  const saved = saveAfterOfflineSettlement();
  buildPartyDock();
  renderDock();
  if (summaries) enqueueModal(() => showOfflineModal(summaries));
  if (!saved) enqueueModal(showOfflineSettleFailedModal);
  processModalQueue();
}
window.addEventListener("pagehide", saveGame);
// バックグラウンド中は定期保存しない（保存済みのsavedAtを「離れた時刻」として固定し、復帰時の精算と
// 次回起動時の精算が同じ期間を二重に数えないようにするため。隠れる直前には必ず保存している）
setInterval(() => { if (!document.hidden) saveGame(); }, 20000);

loadGame();
renderTitle();
showScreen("screen-title");
document.getElementById("btnSettingsAnnounce").classList.toggle("hidden", !isFeatureEnabled("announcements"));

// 起動時は「お知らせ→オフライン結果」の順でキューへ積み、他のモーダルが無い時だけ1つずつ開く
if (isFeatureEnabled("announcements")) {
  const startupAnnouncement = pickStartupAnnouncement();
  if (startupAnnouncement) enqueueModal(() => openAnnouncementModal(startupAnnouncement));
}
if (pendingOfflineSummaries) enqueueModal(() => showOfflineModal(pendingOfflineSummaries));
if (offlineSettleFailed) enqueueModal(showOfflineSettleFailedModal);
processModalQueue();

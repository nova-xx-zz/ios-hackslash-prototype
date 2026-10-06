// ---------- 自動周回の完了通知の予定（notices） ----------
// アプリを離れる時に、自動周回中のチームごとに「いつ終わるか」を計算して、端末の通知の予定を作る。
// 離れている間は実際には戦わず、次に開いた時に離れていた時間からまとめて精算する（js/core/offline.js）ため、
// 通知は「計算上、終わっている頃」の目安（全滅して途中で止まったかは、開くまで分からない）。
// 精算できる時間には上限（8時間）があるので、それより長くかかる時は上限の時刻に知らせる。
// 画面・端末の機能には依存しない（通知の予約は js/ui/notify.js）。
(function (root) {
  "use strict";

  const NOTICE_ID_BASE = 7100; // 通知のid（チームの番号を足す）

  // teams: [{ team, teamName, dungeonName, target, done, runSeconds（1周の目安の秒数） }]（自動周回中のチームだけ）
  // now: 今の時刻(ms)、maxMs: 離れていた間に精算できる時間の上限(ms)
  // 戻り値: [{ id, at（通知する時刻ms）, title, body }]
  function planAutoRepeatNotices(teams, now, maxMs) {
    const out = [];
    for (const t of teams || []) {
      const remaining = Math.max(0, (t.target || 0) - (t.done || 0));
      if (remaining <= 0 || !(t.runSeconds > 0)) continue;
      const etaMs = Math.ceil(remaining * t.runSeconds * 1000);
      const capped = etaMs > maxMs;
      out.push({
        id: NOTICE_ID_BASE + t.team,
        at: now + (capped ? maxMs : etaMs),
        title: "ソードクレスト",
        body: capped
          ? `${t.teamName}が「${t.dungeonName}」を周回できる時間の上限（${Math.round(maxMs / 3600000)}時間）に達しました。アプリを開いて結果を確認しましょう`
          : `${t.teamName}の自動周回（${t.dungeonName}・残り${remaining}周）が終わる頃です。アプリを開いて結果を確認しましょう`,
      });
    }
    return out;
  }

  function noticeIds(teamCount) {
    return Array.from({ length: teamCount }, (_, i) => NOTICE_ID_BASE + i);
  }

  const exported = { NOTICE_ID_BASE, planAutoRepeatNotices, noticeIds };
  root.QPCore = root.QPCore || {};
  root.QPCore.notices = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

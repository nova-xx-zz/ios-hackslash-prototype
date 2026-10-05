// ---------- PWA（ホーム画面に追加して使う時のオフライン対応） ----------
// Service Worker（sw.js）を登録する。使えない環境（http、古いブラウザ、Capacitor のアプリ内など）では何もしない。
// ゲームの動作には影響させない（登録に失敗しても、ふだんどおり遊べる）。
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();

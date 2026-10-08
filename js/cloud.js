// ---------- クラウドセーブ（Firebase） ----------
// 端末のセーブ（localStorage）を、Firebase の匿名ログインと Firestore（saves/{ユーザーID}）にバックアップする。
// - ゲームの起動を遅らせないよう、起動してしばらくしてから Firebase（js/vendor/firebase.js）を読み込む
// - オフラインや Firebase の不調でも、ゲームはふだんどおり遊べる（クラウドへの保存だけが止まる）
// - 送信は端末に保存するたび（qp:saved イベント）ではなく、最短でも UPLOAD_INTERVAL_MS おきにまとめて送る。
//   アプリを離れる時（画面が隠れた時）は、まだ送っていないセーブをすぐに送る
// - 匿名ログインのユーザーは、その端末（そのブラウザ／ホーム画面のアプリ）ごとに別になる。
//   別の端末への引き継ぎは、Google・Apple のアカウント連携で行う（今後追加）
(function (root) {
  "use strict";
  // 確認用モード（?debug）では、確認用のデータを本番のバックアップに上書きしないよう、クラウドセーブを使わない
  // （QPCloud を用意しないので、設定画面のクラウドセーブの欄も出ない）
  if (root.QPRuntime && root.QPRuntime.channel === "production") return; // 正式版はAPI経由のcloud-production.jsのみ
  if (root.QPCore && root.QPCore.storage && root.QPCore.storage.isDebugMode()) return;
  const UPLOAD_INTERVAL_MS = 60 * 1000;
  const START_DELAY_MS = 1500;
  const MAX_SAVE_CHARS = 900 * 1024; // Firestore の1件あたりの上限（1MiB）に余裕を持たせる
  const SDK_URL = "js/vendor/firebase.js?v=1";

  const state = { status: "off", uid: null, lastUploadAt: null, lastUploadSavedAt: null, error: null };
  const listeners = new Set();
  let fb = null, auth = null, db = null;
  let pending = null; // まだ送っていない最新のセーブ { json, savedAt }
  let timer = null, lastSentAt = 0, uploading = null;

  function set(patch) {
    Object.assign(state, patch);
    for (const fn of listeners) { try { fn(Object.assign({}, state)); } catch (e) { /* 表示の不具合でクラウドセーブを止めない */ } }
  }

  function errorText(e) {
    const code = (e && e.code) || "";
    if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") return "Firebase の匿名ログインが有効になっていません";
    if (code === "auth/network-request-failed" || code === "unavailable" || (!navigator.onLine)) return "ネットワークにつながっていません";
    if (code === "permission-denied") return "クラウドに保存する権限がありません（セキュリティルールを確認してください）";
    if (code === "sdk-load-failed") return "クラウドセーブの読み込みに失敗しました";
    return "クラウドセーブでエラーが発生しました" + (code ? `（${code}）` : "");
  }

  function loadSdk() {
    if (root.QPFirebase) return Promise.resolve(root.QPFirebase);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.onload = () => (root.QPFirebase ? resolve(root.QPFirebase) : reject({ code: "sdk-load-failed" }));
      s.onerror = () => reject({ code: "sdk-load-failed" });
      document.head.appendChild(s);
    });
  }

  let starting = null;
  function start() {
    const config = root.QP_FIREBASE_CONFIG;
    if (!config || state.status === "ready") return Promise.resolve();
    if (starting) return starting;
    set({ status: "connecting", error: null });
    starting = (async () => {
      try {
        if (!fb) {
          fb = await loadSdk();
          const app = fb.initializeApp(config);
          // ログイン状態は端末に残す（IndexedDB が使えない環境では localStorage、それも無理ならメモリ）
          auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence, fb.inMemoryPersistence] });
          db = fb.getFirestore(app);
        }
        const existing = await new Promise((resolve) => { const stop = fb.onAuthStateChanged(auth, (u) => { stop(); resolve(u); }); });
        const user = existing || (await fb.signInAnonymously(auth)).user;
        set({ status: "ready", uid: user.uid, error: null });
        if (pending) scheduleUpload(0);
      } catch (e) {
        set({ status: "error", error: errorText(e) });
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  function scheduleUpload(delay) {
    if (timer) return;
    const wait = delay !== undefined ? delay : Math.max(0, lastSentAt + UPLOAD_INTERVAL_MS - Date.now());
    timer = setTimeout(() => { timer = null; upload(); }, wait);
  }

  // 未送信のセーブを送る。結果: true（送れた・送るものが無い）/ false（送れなかった。次の機会に送り直す）
  async function upload() {
    if (uploading) return uploading;
    if (!pending) return true;
    if (state.status !== "ready") return false;
    const { json, savedAt } = pending;
    if (json.length > MAX_SAVE_CHARS) {
      pending = null;
      set({ error: "セーブが大きすぎてクラウドに保存できません（所持品を減らしてください）" });
      return false;
    }
    pending = null;
    uploading = (async () => {
      try {
        await fb.setDoc(fb.doc(db, "saves", state.uid), {
          data: json,
          savedAt,
          schemaVersion: root.QPModel && root.QPModel.save ? root.QPModel.save.SCHEMA_VERSION : null,
          chars: json.length,
          updatedAt: fb.serverTimestamp(),
        });
        lastSentAt = Date.now();
        set({ lastUploadAt: lastSentAt, lastUploadSavedAt: savedAt, error: null });
        return true;
      } catch (e) {
        if (!pending) pending = { json, savedAt }; // 送れなかった分は、より新しいセーブが来ていなければ送り直す
        set({ error: errorText(e) });
        return false;
      } finally {
        uploading = null;
      }
    })();
    return uploading;
  }

  // 今の進行をすぐに送る（設定画面の「今すぐバックアップ」）。saveGame が qp:saved で最新のセーブを渡す
  async function backupNow() {
    if (state.status !== "ready") await start();
    if (typeof root.saveGame === "function") root.saveGame();
    clearTimeout(timer); timer = null;
    return upload();
  }

  // クラウドのセーブを取り出す。結果: null（無い）または { json, savedAt, updatedAt }。失敗は例外（message に理由）
  async function fetchCloudSave() {
    if (state.status !== "ready") await start();
    if (state.status !== "ready") throw new Error(state.error || errorText({}));
    try {
      const snap = await fb.getDoc(fb.doc(db, "saves", state.uid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { json: d.data, savedAt: d.savedAt || null, updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null };
    } catch (e) {
      throw new Error(errorText(e));
    }
  }

  root.addEventListener("qp:saved", (ev) => {
    pending = { json: ev.detail.json, savedAt: ev.detail.savedAt };
    if (state.status === "ready") scheduleUpload();
  });
  // アプリを離れる時は、待たずに送る（送り切れなかった分は次に開いた時に送る）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && pending && state.status === "ready") { clearTimeout(timer); timer = null; upload(); }
  });
  // オフラインから戻ったら、つなぎ直す
  root.addEventListener("online", () => { if (state.status === "error") start(); });
  root.addEventListener("load", () => setTimeout(start, START_DELAY_MS));

  root.QPCloud = {
    start, backupNow, fetchCloudSave,
    getState: () => Object.assign({}, state),
    subscribe(fn) { listeners.add(fn); fn(Object.assign({}, state)); return () => listeners.delete(fn); },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

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
  if (root.QPCore && root.QPCore.storage && (root.QPCore.storage.isDebugMode() || root.QPCore.storage.isDungeonPilotMode())) return;
  const UPLOAD_INTERVAL_MS = 5 * 60 * 1000;
  const RETRY_INTERVAL_MS = 60 * 1000;
  const START_DELAY_MS = 1500;
  // 設定画面の容量診断と同じ上限を使い、表示と実際の送信判定を一致させる。
  const saveDiagnostics = root.QPCore.saveDiagnostics;
  const SDK_URL = "js/vendor/firebase.js?v=1";

  const state = { status: "off", uid: null, lastUploadAt: null, lastUploadSavedAt: null, error: null };
  const listeners = new Set();
  let fb = null, auth = null, db = null;
  let pending = null; // まだ送っていない最新のセーブ { json, savedAt, key }
  let timer = null, lastSentAt = 0, retryAfter = 0, uploading = null;
  let lastUploadedKey = null; // 実際に送信が成功した内容。保存時刻だけの変更は同期しない

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
    // Beta uses a separate Google Auth session approved by the invite gate.
    // Never fall back to anonymous auth on a beta build.
    if (root.QPRuntime && root.QPRuntime.channel === "beta") {
      const session = root.QPBetaAccess && root.QPBetaAccess.getSession();
      if (!session) return Promise.resolve();
      fb = session.fb;
      auth = session.auth;
      db = session.db;
      set({ status: "ready", uid: session.uid, error: null });
      if (pending) scheduleUpload(0);
      return Promise.resolve();
    }
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

  // ローカルセーブは20秒ごとにsavedAtを更新するため、単純なJSON比較だと
  // アイドル時も永遠にdirtyになる。進行が変わらなければ同じデータとして扱う。
  // ただし自動周回中は保存時刻がオフライン精算の起点になるため、savedAtも同期対象。
  function contentKey(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.autoRepeat) || !data.autoRepeat.some((ar) => ar && ar.active)) {
        delete data.savedAt;
      }
      return JSON.stringify(data);
    } catch (e) {
      return json; // 不正なJSONも送信時の通常のサイズ判定へ。ここでゲームを止めない
    }
  }

  function clearScheduledUpload() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function scheduleUpload(delay) {
    if (timer !== null || !pending || state.status !== "ready") return;
    const wait = delay !== undefined ? delay :
      Math.max(0, lastSentAt + UPLOAD_INTERVAL_MS - Date.now(), retryAfter - Date.now());
    timer = setTimeout(() => { timer = null; upload(); }, wait);
  }

  // 未送信のセーブを送る。結果: true（送れた・送るものが無い）/ false（送れなかった。次の機会に送り直す）
  async function upload() {
    if (uploading) return uploading;
    if (!pending) return true;
    if (state.status !== "ready") return false;

    const item = pending;
    if (item.key === lastUploadedKey) {
      pending = null;
      return true;
    }
    if (!saveDiagnostics.cloudAccepts(item.json)) {
      // 容量超過時も端末データは保持する。クラウド制限に収まる次のセーブは再度送信できる。
      pending = null;
      set({ error: "セーブが大きすぎてクラウドに保存できません（設定→保存状況を確認してください）" });
      return false;
    }

    pending = null;
    uploading = (async () => {
      try {
        await fb.setDoc(fb.doc(db, "saves", state.uid), {
          data: item.json,
          savedAt: item.savedAt,
          schemaVersion: root.QPModel && root.QPModel.save ? root.QPModel.save.SCHEMA_VERSION : null,
          chars: item.json.length,
          updatedAt: fb.serverTimestamp(),
        });
        lastSentAt = Date.now();
        retryAfter = 0;
        lastUploadedKey = item.key;
        set({ lastUploadAt: lastSentAt, lastUploadSavedAt: item.savedAt, error: null });
        return true;
      } catch (e) {
        // 通信失敗なら一番新しいセーブを残し、1分以上空けて再送する。
        if (!pending) pending = item;
        retryAfter = Date.now() + RETRY_INTERVAL_MS;
        set({ error: errorText(e) });
        return false;
      } finally {
        uploading = null;
        if (pending && pending.key === lastUploadedKey) pending = null;
        // 送信中に更新されたセーブの取りこぼしと、失敗時の無限即時再試行を防ぐ。
        clearScheduledUpload();
        if (pending) scheduleUpload();
      }
    })();
    return uploading;
  }

  // 設定画面の手動実行は5分制限の対象外。進行を端末保存してから最新スナップショットを送る。
  async function backupNow() {
    if (state.status !== "ready") await start();
    if (state.status !== "ready") return false;
    if (typeof root.saveGame === "function" && !root.saveGame()) return false;
    clearScheduledUpload();
    if (uploading) await uploading;
    clearScheduledUpload();
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
    if (!ev.detail || typeof ev.detail.json !== "string") return;
    const item = { json: ev.detail.json, savedAt: ev.detail.savedAt, key: contentKey(ev.detail.json) };
    // アイドル中のsavedAt更新だけなら、Firebaseへの不要な書き込みを省く。
    // 送信中は先に書き込まれる内容が異なる可能性があるため、最新を保留する。
    if (!uploading && item.key === lastUploadedKey) {
      pending = null;
      clearScheduledUpload();
      return;
    }
    pending = item;
    if (state.status === "ready") scheduleUpload();
  });
  // iOS Safariではバックグラウンド送信が保証されない。可能なら即時送信し、失敗分は定期再試行。
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && pending && state.status === "ready") {
      clearScheduledUpload();
      upload();
    }
  });
  root.addEventListener("online", () => {
    if (state.status === "error") start();
    else if (pending && state.status === "ready") {
      clearScheduledUpload();
      scheduleUpload(0);
    }
  });
  root.addEventListener("load", () => setTimeout(start, START_DELAY_MS));

  root.QPCloud = {
    start, backupNow, fetchCloudSave,
    getState: () => Object.assign({}, state),
    subscribe(fn) { listeners.add(fn); fn(Object.assign({}, state)); return () => listeners.delete(fn); },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

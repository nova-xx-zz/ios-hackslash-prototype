// Beta-only UI entrypoint. Included only by "build:beta:web".
// Security: this page gate is UX only. Firestore Rules authorize every cloud operation.
(function (root) {
  "use strict";
  if (!root.QPRuntime || root.QPRuntime.channel !== "beta") return;

  // Only the isolated beta build provides this ordered list. All UI scripts must
  // load *after* admission because ui/state.js reads the user's local save immediately.
  const gameScripts = root.QPBetaGameScripts;
  if (!Array.isArray(gameScripts) || gameScripts.length < 20
      || gameScripts[0].indexOf("js/ui/state.js?v=") !== 0
      || !/^js\/game\.js\?v=\d+$/.test(gameScripts[gameScripts.length - 1])
      || !gameScripts.every(src => /^js\/[a-zA-Z0-9_./-]+\.js\?v=\d+$/.test(src))) {
    throw Error("Invalid beta game script list");
  }
  const app = document.getElementById("app");
  if (!app || !root.QP_FIREBASE_CONFIG) throw Error("Missing beta app or Firebase config");
  app.style.display = "none";

  const style = document.createElement("style");
  style.textContent = `
    #betaAccess{position:fixed;z-index:100000;inset:0;display:flex;align-items:center;justify-content:center;
      overflow:auto;padding:20px;background:linear-gradient(145deg,#111721,#0b2631);color:#f7e9c8;font-family:system-ui,sans-serif;}
    #betaAccess .beta-card{box-sizing:border-box;width:min(100%,460px);padding:28px 20px;border:1px solid #a58b5a;
      border-radius:14px;background:rgba(14,25,38,.96);text-align:center;box-shadow:0 12px 48px #02060c88;}
    #betaAccess h1{font-size:25px;letter-spacing:.14em;margin:0 0 8px;}
    #betaAccess p{font-size:14px;line-height:1.8;white-space:pre-wrap;}
    #betaAccess button{margin:10px 6px 4px;padding:12px 17px;border:1px solid #c5aa74;
      background:#183b45;color:#fff5dd;border-radius:8px;font-size:15px;cursor:pointer;}
    #betaAccess button:disabled{opacity:.55;cursor:wait;}
    #betaAccess .beta-uid{overflow-wrap:anywhere;color:#c4d8db;font-size:13px;}
  `;
  document.head.appendChild(style);
  const screen = document.createElement("section");
  screen.id = "betaAccess";
  screen.setAttribute("role", "region");
  screen.setAttribute("aria-label", "ソードクレストβ版のログイン");
  screen.innerHTML = '<div class="beta-card"><h1>SWORD CREST</h1><div>招待制クローズドβ</div>' +
    '<p id="betaAccessMessage" aria-live="polite">接続を確認しています…</p>' +
    '<div class="beta-uid" id="betaAccessUid"></div>' +
    '<button id="betaAccessLogin" type="button" hidden>Googleでログイン</button>' +
    '<button id="betaAccessRetry" type="button" hidden>もう一度確認</button>' +
    '<button id="betaAccessLogout" type="button" hidden>ログアウト</button></div>';
  document.body.insertBefore(screen, app);
  const msg = document.getElementById("betaAccessMessage");
  const uidText = document.getElementById("betaAccessUid");
  const login = document.getElementById("betaAccessLogin");
  const retry = document.getElementById("betaAccessRetry");
  const logout = document.getElementById("betaAccessLogout");
  let fb, auth, db, session = null, gameLoaded = false, checking = false;
  const visible = (el, show) => { el.hidden = !show; };
  function show(message, opts) {
    opts = opts || {};
    msg.textContent = message;
    uidText.textContent = opts.uid ? "Firebase UID（運営者へ伝える識別子）: " + opts.uid : "";
    visible(login, !!opts.login);
    visible(retry, !!opts.retry);
    visible(logout, !!opts.logout);
  }
  function loadSdk() {
    if (root.QPFirebase) return Promise.resolve(root.QPFirebase);
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "js/vendor/firebase.js?v=2";
      el.onload = () => root.QPFirebase ? resolve(root.QPFirebase) : reject(Error("Firebase SDK not available"));
      el.onerror = () => reject(Error("Firebase SDK could not load"));
      document.head.appendChild(el);
    });
  }
  async function launch() {
    if (gameLoaded) return;
    gameLoaded = true;
    if (root.QPCloud) root.QPCloud.start();
    show("ログインを確認しました。ゲームを読み込んでいます…");
    try {
      // Strict sequential order is required: these classic scripts share global bindings.
      for (const src of gameScripts) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.async = false;
          script.onload = resolve;
          script.onerror = () => reject(Error("Failed to load game module: " + src));
          document.body.appendChild(script);
        });
      }
      const settings = document.querySelector("#screen-settings .roster-body");
      if (settings) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn small ghost";
        button.textContent = "βアカウントからログアウト";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (typeof root.saveGame === "function") root.saveGame();
            if (root.QPCloud) await root.QPCloud.backupNow();
            session = null;
            await fb.signOut(auth);
            root.location.reload();
          } catch (e) {
            button.disabled = false;
            button.textContent = "ログアウト失敗・もう一度試す";
          }
        });
        settings.appendChild(button);
      }
      app.style.display = "";
      screen.remove();
    } catch (err) {
      app.style.display = "none";
      show("ゲームを読み込めませんでした。ページを再読み込みしてください。", { logout: true });
    }
  }
  async function checkMember(user) {
    if (checking) return;
    checking = true;
    show("招待を確認しています…");
    try {
      // Firebase Rules independently require Google sign-in, owner UID, active + unexpired member.
      if (!user.providerData || !user.providerData.some(p => p.providerId === "google.com")) {
        show("β版ではGoogleアカウントでのログインが必要です。", { login: true, logout: true });
        return;
      }
      const doc = await fb.getDoc(fb.doc(db, "betaMembers", user.uid));
      const member = doc.exists() ? doc.data() : null;
      if (!member || member.enabled !== true || !member.expiresAt
          || typeof member.expiresAt.toMillis !== "function"
          || member.expiresAt.toMillis() <= Date.now()) {
        show("このGoogleアカウントには有効な招待がありません。\n当選した方は下記UIDを運営者へ伝えてください。", {
          uid: user.uid, logout: true, retry: true
        });
        return;
      }
      session = { fb, auth, db, uid: user.uid };
      show("ログインを確認しました。ゲームを開始します…");
      launch();
    } catch (err) {
      // A signed-in tester still needs their own UID for operator enrollment,
      // even while the Firestore rules have not yet been published.
      show("認証または通信で確認できませんでした。接続状況を確認し、再試行してください。", {
        uid: user && user.uid ? user.uid : null, retry: true, logout: true
      });
    } finally {
      checking = false;
    }
  }
  login.addEventListener("click", async () => {
    login.disabled = true;
    show("Googleログインを開いています…");
    try {
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
      if (auth.currentUser) await checkMember(auth.currentUser);
    } catch (e) {
      show("ログインに失敗しました。ポップアップのブロック設定をご確認ください。", { login: true });
    } finally { login.disabled = false; }
  });
  retry.addEventListener("click", () => {
    if (auth && auth.currentUser) checkMember(auth.currentUser);
    else show("Googleアカウントでログインしてください。", { login: true });
  });
  logout.addEventListener("click", async () => {
    session = null;
    if (auth) await fb.signOut(auth);
    root.location.reload();
  });
  root.QPBetaAccess = Object.freeze({ getSession: () => session });
  (async () => {
    try {
      fb = await loadSdk();
      const firebaseApp = fb.initializeApp(root.QP_FIREBASE_CONFIG);
      auth = fb.initializeAuth(firebaseApp, {
        persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence, fb.inMemoryPersistence],
      });
      db = fb.getFirestore(firebaseApp);
      fb.onAuthStateChanged(auth, user => {
        if (user) checkMember(user);
        else show("当選者向けのGoogleアカウントでログインしてください。\nβ版の進行は正式版へ引き継がれません。", { login: true });
      }, () => show("ログイン状態を確認できませんでした。再読み込みしてください。", { retry: true }));
    } catch (err) {
      show("認証を初期化できませんでした。β版のFirebase設定と接続を確認してください。", { retry: true });
    }
  })();
})(typeof globalThis !== "undefined" ? globalThis : this);

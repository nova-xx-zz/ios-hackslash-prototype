"use strict";
(function () {
  const message = document.getElementById("message");
  const uidBox = document.getElementById("uid");
  const login = document.getElementById("login");
  const csrf = document.querySelector('meta[name="sc-csrf"]')?.content;
  const fb = window.QPFirebase;
  const config = window.QP_FIREBASE_CONFIG;
  let auth, busy = false, needsNewLogin = false;
  function show(text, uid) {
    message.textContent = text;
    uidBox.textContent = uid ? "Firebase UID: " + uid : "";
    login.hidden = false;
    login.disabled = busy;
  }
  async function exchange(user) {
    if (busy || needsNewLogin) return;
    busy = true;
    login.disabled = true;
    message.textContent = "招待情報を確認しています…";
    try {
      const idToken = await user.getIdToken();
      const r = await fetch("/api/session", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csrf, idToken })
      });
      const result = await r.json().catch(() => ({}));
      if (r.ok && result.ok === true) {
        window.location.replace("/");
        return;
      }
      if (result.error === "not_invited") {
        show("このGoogleアカウントには有効な招待がありません。\n当選者は運営者へUIDをお知らせください。", result.uid);
      } else if (result.error === "recent_login_required" || result.error === "invalid_auth") {
        needsNewLogin = true;
        show("Googleで再ログインしてください。");
      } else if (result.error === "google_required") {
        show("Googleアカウントでのログインが必要です。");
      } else {
        show("認証を確認できませんでした。しばらくして再試行してください。");
      }
    } catch {
      show("通信に失敗しました。接続を確認して再試行してください。");
    } finally {
      busy = false;
      login.disabled = false;
    }
  }
  login.addEventListener("click", async () => {
    if (!auth || busy) return;
    login.disabled = true;
    try {
      // Always require an explicit user gesture to avoid popup blockers.
      const response = await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
      needsNewLogin = false;
      await exchange(response.user);
    } catch (error) {
      const code = error && error.code ? String(error.code) : "unknown";
      show("Googleログインできませんでした（" + code + "）。ポップアップやFirebase承認済みドメインを確認してください。");
    } finally {
      login.disabled = false;
    }
  });
  try {
    if (!fb || !config || config.projectId !== "sword-crest-beta" || !csrf) {
      throw Error("Invalid beta login configuration");
    }
    auth = fb.initializeAuth(fb.initializeApp(config), {
      persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence, fb.inMemoryPersistence],
      popupRedirectResolver: fb.browserPopupRedirectResolver
    });
    // This reuses the existing Firebase login when it is still fresh.
    fb.onAuthStateChanged(auth, user => {
      if (user && !needsNewLogin) exchange(user);
      else show("当選したGoogleアカウントでログインしてください。");
    }, () => show("ログイン情報を読み取れませんでした。"));
  } catch {
    show("β版の認証を開始できませんでした。管理者にお問い合わせください。");
    login.disabled = true;
  }
})();

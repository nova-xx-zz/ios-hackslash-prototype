"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "js", "beta-access.js"), "utf8");
const GAME_SCRIPTS = Array.from({ length: 20 }, (_, i) => i === 0 ? "js/ui/state.js?v=3" : i === 19 ? "js/game.js?v=33" : "js/ui/mock" + i + ".js?v=1");

function fakePage({ member, user, fails = false }) {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: true, textContent: "", disabled: false,
      addEventListener(event, fn) { this[event] = fn; },
    });
    return elements.get(id);
  };
  const app = { style: {} };
  const scripts = [];
  let cloudStarts = 0;
  const auth = { currentUser: user };
  const sdk = {
    initializeApp: () => ({}),
    initializeAuth: () => auth,
    indexedDBLocalPersistence: {}, browserLocalPersistence: {}, inMemoryPersistence: {},
    getFirestore: () => ({}),
    onAuthStateChanged(_auth, cb) { cb(user); },
    doc(_db, collection, uid) { assert.equal(collection, "betaMembers"); return uid; },
    getDoc: async () => {
      if (fails) throw Error("permission-denied");
      return { exists: () => !!member, data: () => member };
    },
    signInWithPopup: async () => ({ user }),
    GoogleAuthProvider: class {},
    signOut: async () => { auth.currentUser = null; },
  };
  const doc = {
    currentScript: { getAttribute: key => key === "data-game-src" ? "js/game.js?v=33" : null },
    getElementById: id => id === "app" ? app : el(id),
    querySelector: () => null,
    createElement(tag) { return { tag, style: {}, setAttribute(){}, remove(){}, innerHTML: "", textContent: "" }; },
    head: { appendChild(){} },
    body: {
      insertBefore(){},
      appendChild(elem) { if (elem.tag === "script") { scripts.push(elem.src); queueMicrotask(() => elem.onload && elem.onload()); } },
    },
  };
  const context = {
    document: doc,
    QPRuntime: { channel: "beta" },
    QP_FIREBASE_CONFIG: { projectId: "swordcrest-beta-ci" },
    QPBetaGameScripts: GAME_SCRIPTS,
    QPFirebase: sdk,
    QPCloud: { start(){ cloudStarts++; } },
    location: { reload(){} },
  };
  vm.runInNewContext(code, context);
  return { elements, scripts, app, cloudStarts: () => cloudStarts, context };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test("beta fails closed when no authenticated Google account", async () => {
  const page = fakePage({ user: null });
  await flush();
  assert.equal(page.app.style.display, "none");
  assert.deepEqual(page.scripts, []);
  assert.equal(page.cloudStarts(), 0);
  assert.equal(page.elements.get("betaAccessLogin").hidden, false);
});

test("beta fails closed for uninvited and expired Google users", async () => {
  const user = { uid: "google-test-user", providerData: [{ providerId: "google.com" }] };
  for (const member of [null, { enabled: false }, {
    enabled: true, expiresAt: { toMillis: () => 1000 },
  }]) {
    const page = fakePage({ user, member });
    await flush();
    assert.equal(page.app.style.display, "none");
    assert.deepEqual(page.scripts, []);
    assert.equal(page.cloudStarts(), 0);
    assert.match(page.elements.get("betaAccessUid").textContent, /google-test-user/);
  }
});

test("beta fails closed for non-Google auth and Firebase permission errors", async () => {
  const user = { uid: "anonymous-test", providerData: [{ providerId: "anonymous" }] };
  const page = fakePage({ user, member: { enabled: true, expiresAt: { toMillis: () => Date.now() + 3600000 } } });
  await flush();
  assert.deepEqual(page.scripts, []);
  const denied = fakePage({ user: { uid: "google-test", providerData: [{ providerId: "google.com" }] }, fails: true });
  await flush();
  assert.deepEqual(denied.scripts, []);
});

test("beta only loads game and starts cloud after a valid Google invitation", async () => {
  const user = { uid: "google-test-user", providerData: [{ providerId: "google.com" }] };
  const member = { enabled: true, expiresAt: { toMillis: () => Date.now() + 3600000 } };
  const page = fakePage({ user, member });
  await flush();
  assert.deepEqual(page.scripts, GAME_SCRIPTS);
  assert.equal(page.cloudStarts(), 1);
  assert.equal(page.app.style.display, "");
  assert.equal(page.context.QPBetaAccess.getSession().uid, user.uid);
});

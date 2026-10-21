// node --test tests/cloud-save-interval.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/cloud.js"), "utf8");

function harness() {
  let now = 1000000, seq = 0, failNext = false, releaseFirst = null, deferFirst = false;
  const timers = new Map(), handlers = new Map(), documentHandlers = new Map(), sent = [];
  const root = {
    QP_FIREBASE_CONFIG: { projectId: "test" },
    QPCore: {
      storage: { isDebugMode: () => false, isDungeonPilotMode: () => false },
      saveDiagnostics: { cloudAccepts: () => true },
    },
    QPModel: { save: { SCHEMA_VERSION: 2 } },
    navigator: { onLine: true },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { handlers.set(name, fn); },
    document: {
      hidden: false,
      addEventListener(name, fn) { documentHandlers.set(name, fn); },
    },
    QPFirebase: {
      initializeApp: () => ({}),
      initializeAuth: () => ({}),
      indexedDBLocalPersistence: {},
      browserLocalPersistence: {},
      inMemoryPersistence: {},
      getFirestore: () => ({}),
      onAuthStateChanged(_auth, callback) {
        queueMicrotask(() => callback({ uid: "test-uid" }));
        return () => {};
      },
      signInAnonymously: async () => ({ user: { uid: "test-uid" } }),
      doc: () => ({}),
      serverTimestamp: () => "server-time",
      async setDoc(_ref, payload) {
        sent.push(payload);
        if (deferFirst && sent.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
        if (failNext) { failNext = false; throw new Error("network down"); }
      },
      getDoc: async () => ({ exists: () => false }),
    },
  };
  root.globalThis = root;
  vm.runInNewContext(source, root, { filename: "js/cloud.js" });
  async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
  async function advance(ms) {
    const to = now + ms;
    for (let i = 0; i < 100; i++) {
      const next = [...timers].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = to;
    await flush();
  }
  return {
    root, sent, advance, flush,
    save(progress, active = false) {
      const json = JSON.stringify({
        schemaVersion: 2, roster: [], inventory: [], progress, savedAt: now,
        autoRepeat: [{ active }],
      });
      handlers.get("qp:saved")({ detail: { json, savedAt: now } });
    },
    hide() {
      root.document.hidden = true;
      documentHandlers.get("visibilitychange")();
    },
    failOnce() { failNext = true; },
    deferFirst() { deferFirst = true; },
    releaseFirst() { if (!releaseFirst) throw Error("first upload not started"); releaseFirst(); },
  };
}

test("初回のみ即時、更新後は5分経過までクラウド書き込みしない", async () => {
  const h = harness();
  await h.root.QPCloud.start();
  h.save(1);
  await h.advance(0);
  assert.equal(h.sent.length, 1);
  h.save(2);
  await h.advance(299999);
  assert.equal(h.sent.length, 1);
  await h.advance(1);
  assert.equal(h.sent.length, 2);
  assert.equal(JSON.parse(h.sent[1].data).progress, 2);
});

test("アイドルの保存時刻だけの更新はスキップし、自動周回中は5分ごとに更新", async () => {
  const h = harness();
  await h.root.QPCloud.start();
  h.save(1);
  await h.advance(0);
  await h.advance(1000);
  h.save(1);
  await h.advance(600000);
  assert.equal(h.sent.length, 1, "savedAt only should not write");
  h.save(1, true);
  await h.advance(0);
  assert.equal(h.sent.length, 2);
  await h.advance(20000);
  h.save(1, true);
  await h.advance(279999);
  assert.equal(h.sent.length, 2);
  await h.advance(1);
  assert.equal(h.sent.length, 3, "running auto repeat must refresh offline settlement anchor");
});

test("失敗した送信は最新データを維持し、60秒後に再試行", async () => {
  const h = harness();
  await h.root.QPCloud.start();
  h.failOnce();
  h.save(1);
  await h.advance(0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.root.QPCloud.getState().lastUploadAt, null);
  await h.advance(59999);
  h.save(2);
  assert.equal(h.sent.length, 1);
  await h.advance(1);
  assert.equal(h.sent.length, 2);
  assert.equal(JSON.parse(h.sent[1].data).progress, 2);
  assert.notEqual(h.root.QPCloud.getState().lastUploadAt, null);
});

test("アプリを隠したときは5分を待たず最新セーブを送る", async () => {
  const h = harness();
  await h.root.QPCloud.start();
  h.save(1);
  await h.advance(0);
  await h.advance(20000);
  h.save(2);
  h.hide();
  await h.flush();
  assert.equal(h.sent.length, 2);
});

test("クラウド送信中の更新を失わず、次の5分枠で送る", async () => {
  const h = harness();
  await h.root.QPCloud.start();
  h.deferFirst();
  h.save(1);
  await h.advance(0);
  assert.equal(h.sent.length, 1);
  h.save(2);
  h.releaseFirst();
  await h.flush();
  await h.advance(299999);
  assert.equal(h.sent.length, 1);
  await h.advance(1);
  assert.equal(h.sent.length, 2);
  assert.equal(JSON.parse(h.sent[1].data).progress, 2);
});

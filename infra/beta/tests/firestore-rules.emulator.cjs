"use strict";
// Real Firebase Rules evaluation, never a production connection.
// Run: npm run test:firestore --prefix infra/beta
const assert = require("node:assert/strict");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fb = require("firebase/compat/app");
require("firebase/compat/firestore");

const DEMO = "demo-swordcrest-beta";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST || !/^(?:localhost|127\.0\.0\.1):8098$/.test(HOST)) {
  throw Error("Refuse to test without the local Firestore emulator on 127.0.0.1:8098");
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== DEMO) {
  throw Error("Refuse to test under a non-demo project");
}
const nowMs = Date.now();
const plusDays = days => new Date(nowMs + days * 86400000);
const baseSave = () => ({
  data: '{"schemaVersion":1}',
  savedAt: nowMs,
  schemaVersion: 1,
  chars: 19,
  updatedAt: fb.firestore.FieldValue.serverTimestamp(),
});
const USER_A = "user-alpha-123";
const USER_B = "user-bravo-456";
const USER_C = "user-charlie-789";

async function run() {
  const env = await initializeTestEnvironment({
    projectId: DEMO,
    firestore: { host: "127.0.0.1", port: 8098 },
  });
  let passed = 0;
  async function scenario(name, fn) {
    await env.clearFirestore();
    try {
      await fn();
      passed++;
      process.stdout.write("PASS " + name + "\n");
    } catch (err) {
      process.stderr.write("FAIL " + name + ": " + (err.stack || err.message) + "\n");
      throw err;
    }
  }
  async function setup(people = []) {
    await env.withSecurityRulesDisabled(async admin => {
      const db = admin.firestore();
      for (const p of people) {
        await db.doc("betaMembers/" + p.uid).set({
          enabled: p.enabled !== false,
          expiresAt: p.expiresAt || plusDays(7),
        });
      }
      await db.doc("betaControl/state").set({ activeCount: people.length, limit: 30 });
    });
  }
  const google = uid => env.authenticatedContext(uid, {
    firebase: { sign_in_provider: "google.com" },
  }).firestore();
  const anonymous = uid => env.authenticatedContext(uid, {
    firebase: { sign_in_provider: "anonymous" },
  }).firestore();
  const unauth = () => env.unauthenticatedContext().firestore();
  const doc = (db, path) => db.doc(path);

  try {
    await scenario("未ログインはメンバーと保存にアクセス不可", async () => {
      await setup([{ uid: USER_A }]);
      await assertFails(doc(unauth(), "betaMembers/" + USER_A).get());
      await assertFails(doc(unauth(), "saves/" + USER_A).set(baseSave()));
    });
    await scenario("匿名認証でも招待権限なし", async () => {
      await setup([{ uid: USER_A }]);
      await assertFails(doc(anonymous(USER_A), "betaMembers/" + USER_A).get());
      await assertFails(doc(anonymous(USER_A), "saves/" + USER_A).set(baseSave()));
    });
    await scenario("Google認証でも未招待なら保存不可", async () => {
      await setup();
      await assertSucceeds(doc(google(USER_B), "betaMembers/" + USER_B).get());
      await assertFails(doc(google(USER_B), "saves/" + USER_B).set(baseSave()));
      await assertFails(doc(google(USER_B), "saves/" + USER_B).get());
    });
    await scenario("招待Google認証は自分のセーブ保存と読取が可能", async () => {
      await setup([{ uid: USER_A }]);
      await assertSucceeds(doc(google(USER_A), "betaMembers/" + USER_A).get());
      await assertSucceeds(doc(google(USER_A), "saves/" + USER_A).set(baseSave()));
      await assertSucceeds(doc(google(USER_A), "saves/" + USER_A).get());
      await assertSucceeds(doc(google(USER_A), "saves/" + USER_A).set(baseSave()));
    });
    await scenario("他人のメンバーとセーブの読み書きは禁止", async () => {
      await setup([{ uid: USER_A }, { uid: USER_B }]);
      await assertFails(doc(google(USER_A), "betaMembers/" + USER_B).get());
      await assertFails(doc(google(USER_A), "saves/" + USER_B).get());
      await assertFails(doc(google(USER_A), "saves/" + USER_B).set(baseSave()));
    });
    await scenario("無効化・期限切れ招待は書込と読取が不可", async () => {
      await setup([{ uid: USER_A, enabled: false }, { uid: USER_B, expiresAt: plusDays(-1) }]);
      for (const uid of [USER_A, USER_B]) {
        await assertFails(doc(google(uid), "saves/" + uid).get());
        await assertFails(doc(google(uid), "saves/" + uid).set(baseSave()));
      }
    });
    await scenario("招待失効後は既存セーブも読取・更新不可", async () => {
      await setup([{ uid: USER_A }]);
      await assertSucceeds(doc(google(USER_A), "saves/" + USER_A).set(baseSave()));
      await env.withSecurityRulesDisabled(async admin => {
        await admin.firestore().doc("betaMembers/" + USER_A).update({ enabled: false });
      });
      await assertFails(doc(google(USER_A), "saves/" + USER_A).get());
      await assertFails(doc(google(USER_A), "saves/" + USER_A).set(baseSave()));
    });
    await scenario("プレイヤーによる招待改竄・一覧・台帳閲覧は禁止", async () => {
      await setup([{ uid: USER_A }]);
      const db = google(USER_A);
      await assertFails(doc(db, "betaMembers/" + USER_A).update({ enabled: false }));
      await assertFails(db.collection("betaMembers").get());
      await assertFails(doc(db, "betaMembers/" + USER_C).set({ enabled: true, expiresAt: plusDays(7) }));
      await assertFails(doc(db, "betaControl/state").get());
      await assertFails(doc(db, "betaControl/state").set({ activeCount: 0, limit: 30 }));
      await assertFails(doc(db, "purchases/" + USER_A).set({ balance: 999 }));
    });
    await scenario("不正フィールド・古い時刻・schema値を拒否", async () => {
      await setup([{ uid: USER_A }]);
      const ref = doc(google(USER_A), "saves/" + USER_A);
      await assertFails(ref.set({ ...baseSave(), paid: true }));
      await assertFails(ref.set({ ...baseSave(), schemaVersion: null }));
      await assertFails(ref.set({ ...baseSave(), schemaVersion: 0 }));
      await assertFails(ref.set({ ...baseSave(), updatedAt: new Date(2000, 0, 1) }));
      await assertFails(ref.set({ ...baseSave(), chars: 921601 }));
      await assertFails(ref.set({ ...baseSave(), data: "x".repeat(921601) }));
    });
    await scenario("削除とリスト操作は招待者でも拒否", async () => {
      await setup([{ uid: USER_A }]);
      const db = google(USER_A);
      await assertSucceeds(doc(db, "saves/" + USER_A).set(baseSave()));
      await assertFails(doc(db, "saves/" + USER_A).delete());
      await assertFails(db.collection("saves").get());
    });
    process.stdout.write("Firestore Emulator: " + passed + " / 10 permission scenarios passed\n");
  } finally {
    await env.cleanup();
  }
}
run().catch(err => {
  process.stderr.write("Firestore Rules emulator tests failed: " + err.message + "\n");
  process.exitCode = 1;
});

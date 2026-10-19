#!/usr/bin/env node
"use strict";
// Run locally by the operator only. Never bundle into Web/PWA or commit credentials.
// Requires ADC credentials with Firestore permissions for the *isolated beta project*.
const { LIMIT, transition, validUid, parseExpiry } = require("./invite-model.js");

function projectIdFromEnv(env) {
  const projectId = env.BETA_FIREBASE_PROJECT_ID;
  if (!projectId || !/^[a-z][a-z0-9-]{3,63}$/.test(projectId)
      || ["sword-crest-jp", "sword-crest-production"].includes(projectId)) {
    throw new Error("Set BETA_FIREBASE_PROJECT_ID to the isolated beta project; never use the old preview or Production");
  }
  if (env.BETA_PROJECT_CONFIRM !== projectId) {
    throw new Error("Explicitly confirm the target project with BETA_PROJECT_CONFIRM=<same projectId>");
  }
  return projectId;
}
async function main(args = process.argv.slice(2), env = process.env) {
  const [op, uid, expiresIso] = args;
  if (!["init", "add", "revoke", "status"].includes(op)) {
    throw new Error("Usage: node invites.js init|status|add <googleUid> <ISO-expiry>|revoke <googleUid>");
  }
  if ((op === "add" || op === "revoke") && !validUid(uid)) throw new Error("Invalid Firebase UID");
  if (op === "add" && !expiresIso) throw new Error("Expiry date required");
  if ((op === "init" || op === "status") && (uid || expiresIso)) throw new Error("Unexpected arguments");
  if (op === "revoke" && expiresIso) throw new Error("Unexpected expiry for revoke");
  const expiryMs = op === "add" ? parseExpiry(expiresIso) : null;
  const projectId = projectIdFromEnv(env);
  // Lazy import keeps pure unit tests offline, without an Admin SDK installation.
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  const db = admin.firestore();
  const control = db.doc("betaControl/state");
  if (op === "init") {
    // Fail closed if somebody already provisioned members without the counter.
    if (!(await db.collection("betaMembers").limit(1).get()).empty) {
      throw new Error("betaMembers is not empty; reconcile manually before initialization");
    }
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(control);
      if (snapshot.exists) throw new Error("betaControl/state already initialized");
      tx.create(control, { limit: LIMIT, activeCount: 0, initializedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    process.stdout.write("Beta admission initialized (limit 30).\n");
    return;
  }
  if (op === "status") {
    const snapshot = await control.get();
    if (!snapshot.exists) throw new Error("Run init first");
    const { activeCount, limit } = snapshot.data();
    process.stdout.write(`Active invitations: ${activeCount}/${limit}\n`);
    return;
  }
  const memberRef = db.doc("betaMembers/" + uid);
  // Firestore retries conflicting transactions. No client-side count or email list is trusted.
  const result = await db.runTransaction(async tx => {
    const [controlSnap, memberSnap] = await Promise.all([tx.get(control), tx.get(memberRef)]);
    if (!controlSnap.exists) throw new Error("Run init first; never provision without a counter");
    const change = transition(controlSnap.data(), memberSnap.exists ? memberSnap.data() : null,
      op === "add" ? "activate" : "revoke");
    if (op === "add") {
      const newData = {
        enabled: true,
        expiresAt: admin.firestore.Timestamp.fromMillis(expiryMs),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!memberSnap.exists) newData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(memberRef, newData, { merge: true });
    } else if (memberSnap.exists && memberSnap.data().enabled === true) {
      tx.update(memberRef, { enabled: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    if (change.changed) tx.update(control, { activeCount: change.activeCount });
    return change;
  });
  process.stdout.write(`${op === "add" ? "Activated" : "Revoked"}: ${uid}. Active: ${result.activeCount}/${LIMIT}\n`);
}

if (require.main === module) main().catch(err => {
  process.stderr.write("Invite operation failed: " + err.message + "\n");
  process.exitCode = 1;
});

module.exports = { projectIdFromEnv, main };

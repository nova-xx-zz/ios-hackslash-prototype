"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Diagnostics = require("../js/core/save-diagnostics.js");
const ROOT = path.join(__dirname, "..", "infra", "firebase");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("production Firestore policy denies all direct client access", () => {
  const r = read("firestore.production.rules");
  assert.match(r, /rules_version\s*=\s*'2'/);
  assert.match(r, /match\s+\/\{document=\*\*}/);
  assert.match(r, /allow read, write:\s*if false;/);
  assert.doesNotMatch(r, /if true;/);
});

test("preview policy restricts owner, backup envelope, and all other documents", () => {
  const r = read("firestore.preview.rules");
  assert.match(r, /request\.auth\.uid\s*==\s*uid/);
  assert.match(r, /request\.resource\.data/);
  assert.match(r, /data\.savedAt is int/);
  assert.match(r, /data\.schemaVersion is int/);
  assert.match(r, /data\.chars is int/);
  assert.match(r, /data\.updatedAt == request\.time/);
  assert.match(r, /allow list, delete: if false;/);
  assert.match(r, /allow read, write: if false;/);
  assert.match(r, /allow create, update: if isOwner\(uid\) && validPreviewBackup\(\)/);
  const max = r.match(/data\.data\.size\(\) <= (\d+)/);
  assert.ok(max, "Preview Rules must enforce a backup size limit");
  assert.equal(Number(max[1]), Diagnostics.CLOUD_MAX_SAVE_BYTES);
});

test("Firestore Preview allowed fields match the actual cloud.js upload payload", () => {
  const rules = read("firestore.preview.rules");
  const cloud = fs.readFileSync(path.join(__dirname, "..", "js", "cloud.js"), "utf8");
  const match = cloud.match(/fb\.setDoc\(fb\.doc\(db,\s*"saves",\s*state\.uid\),\s*\{([\s\S]*?)\n\s*\}\)/);
  assert.ok(match, "Cannot locate Firestore save payload: review this test when upload changes");
  const sent = [...match[1].matchAll(/^\s*([a-zA-Z]\w*)(?:\s*:|,)/gm)].map(x => x[1]).sort();
  const allowed = rules.match(/data\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/);
  assert.ok(allowed, "Preview Rules must explicitly allowlist save fields");
  const permitted = [...allowed[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  const required = rules.match(/data\.keys\(\)\.hasAll\(\[([^\]]+)\]\)/);
  assert.ok(required, "Preview Rules must require the expected save fields");
  const mandatory = [...required[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(sent, permitted, "upload fields and Firestore allowlist drifted");
  assert.deepEqual(sent, mandatory, "upload fields and required schema drifted");
});

// These are static contract tests, not Firebase Emulator tests.
// An actual deployment still requires allow/deny Emulator tests and console verification.

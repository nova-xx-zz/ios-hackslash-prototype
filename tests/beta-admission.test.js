"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LIMIT, transition, validUid, parseExpiry } = require("../infra/beta/invite-model.js");
const { projectIdFromEnv } = require("../infra/beta/invites.js");
const read = name => fs.readFileSync(path.join(__dirname, "..", "infra", "firebase", name), "utf8");

test("max 30 unique active invites; 31st is rejected, renewals do not increment", () => {
  let count = 0;
  for (let i = 0; i < 30; i++) count = transition({ limit: 30, activeCount: count }, null, "activate").activeCount;
  assert.equal(count, LIMIT);
  assert.throws(() => transition({ limit: 30, activeCount: count }, null, "activate"), /full/);
  assert.deepEqual(transition({ limit: 30, activeCount: count }, { enabled: true }, "activate"),
    { activeCount: 30, changed: false });
  assert.deepEqual(transition({ limit: 30, activeCount: count }, { enabled: true }, "revoke"),
    { activeCount: 29, changed: true });
  assert.equal(transition({ limit: 30, activeCount: 29 }, { enabled: false }, "activate").activeCount, 30);
});

test("inactive revoke is idempotent; malformed counter fails closed", () => {
  assert.deepEqual(transition({ limit: 30, activeCount: 0 }, null, "revoke"), { activeCount: 0, changed: false });
  for (const state of [null, {}, { limit: 31, activeCount: 0 }, { limit: 30, activeCount: -1 },
    { limit: 30, activeCount: 31 }, { limit: 30, activeCount: "3" }]) {
    assert.throws(() => transition(state, null, "activate"), /Invalid betaControl/);
  }
  assert.throws(() => transition({ limit: 30, activeCount: 0 }, { enabled: true }, "revoke"), /mismatch/);
});

test("UID and expiry must be explicit and bounded; project is double confirmed", () => {
  assert.ok(validUid("Abcd_1234-x"));
  for (const uid of ["", "../secrets", "A", "x".repeat(129), "あいう"]) assert.equal(validUid(uid), false);
  assert.equal(parseExpiry("2026-11-01T23:59:00+09:00", Date.parse("2026-10-20T00:00:00Z")),
    Date.parse("2026-11-01T14:59:00Z"));
  for (const date of ["2026-11-01", "broken", "2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"]) {
    assert.throws(() => parseExpiry(date, Date.parse("2026-10-20T00:00:00Z")));
  }
  assert.equal(projectIdFromEnv({ BETA_FIREBASE_PROJECT_ID: "swordcrest-beta-test", BETA_PROJECT_CONFIRM: "swordcrest-beta-test" }), "swordcrest-beta-test");
  for (const [id, confirm] of [["sword-crest-jp", "sword-crest-jp"],
    ["swordcrest-beta-test", ""], ["swordcrest-beta-test", "swordcrest-other"]]) {
    assert.throws(() => projectIdFromEnv({ BETA_FIREBASE_PROJECT_ID: id, BETA_PROJECT_CONFIRM: confirm }));
  }
});

test("beta Rules only permit Google-identity owners with active unexpired server grants", () => {
  const r = read("firestore.beta.rules");
  assert.match(r, /sign_in_provider == "google.com"/);
  assert.match(r, /request\.auth\.uid == uid/);
  assert.match(r, /exists\(\/databases\/\$\(database\)\/documents\/betaMembers\/\$\(request\.auth\.uid\)\)/);
  assert.match(r, /\.data\.enabled == true/);
  assert.match(r, /\.data\.expiresAt > request\.time/);
  assert.match(r, /allow get: if owns\(uid\) && admitted\(\)/);
  assert.match(r, /allow create, update: if owns\(uid\) && admitted\(\) && validSave\(\)/);
  assert.match(r, /allow list, create, update, delete: if false;/);
  assert.match(r, /allow read, write: if false;/);
  assert.doesNotMatch(r, /if true;/);
});

test("beta Rules share the cloud.js 5-field payload and size policy", () => {
  const r = read("firestore.beta.rules");
  const save = fs.readFileSync(path.join(__dirname, "..", "js", "cloud.js"), "utf8");
  const payload = save.match(/fb\.setDoc\(fb\.doc\(db,\s*"saves",\s*state\.uid\),\s*\{([\s\S]*?)\n\s*\}\)/);
  assert.ok(payload, "Cloud backup envelope changed; re-evaluate beta rules");
  const transmitted = [...payload[1].matchAll(/^\s*(\w+)(?:,|\s*:)/gm)].map(x => x[1]).sort();
  const permitted = r.match(/data\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/);
  assert.ok(permitted);
  assert.deepEqual([...permitted[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort(), transmitted);
  assert.match(r, /data\.data\.size\(\) <= 921600/);
});

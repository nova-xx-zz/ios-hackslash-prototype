"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const ROOT=path.join(__dirname,"..","infra","firebase");
const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");

test("production Firestore policy denies all direct client access",()=>{
  const r=read("firestore.production.rules");
  assert.match(r,/rules_version\s*=\s*'2'/);
  assert.match(r,/match\s+\/\{document=\*\*\}/);
  assert.match(r,/allow read, write:\s*if false;/);
  assert.doesNotMatch(r,/if true;/);
});
test("preview policy restricts owner, save schema, and all other documents",()=>{
  const r=read("firestore.preview.rules");
  assert.match(r,/request\.auth\.uid\s*==\s*uid/);
  assert.match(r,/request\.resource\.data/);
  assert.match(r,/\.keys\(\)\.hasOnly/);
  assert.match(r,/data\.data\.size\(\) <= 500000/);
  assert.match(r,/data\.updatedAt == request\.time/);
  assert.match(r,/allow list, delete: if false;/);
  assert.match(r,/allow read, write: if false;/);
});
// 静的契約テストに過ぎず、実際の許可/拒否はFirebase Emulatorで別途検証する。

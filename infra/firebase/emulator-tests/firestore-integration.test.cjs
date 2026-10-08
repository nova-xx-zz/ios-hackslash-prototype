// Firebase Local Emulator Suite integration tests: never connect to a real project.
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {getDoc,setDoc,deleteDoc,collection,getDocs,serverTimestamp,doc}=require("firebase/firestore");
const {initializeApp:adminInit}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {createFirestoreRepository}=require("../../../functions/firestore-repository.js");
const {createBackupService}=require("../../../functions/backup-core.js");
const ROOT=path.resolve(__dirname,"../../..");
const rules=name=>fs.readFileSync(path.join(ROOT,"infra/firebase",name),"utf8");
const PORT=Number((process.env.FIRESTORE_EMULATOR_HOST||"127.0.0.1:8080").split(":").pop());
const HOST="127.0.0.1";
async function checkProductionRules(){
 const t=await initializeTestEnvironment({projectId:"demo-swordcrest-prod-qa",firestore:{host:HOST,port:PORT,rules:rules("firestore.production.rules")}});
 try{
  const alice=t.authenticatedContext("alice"),anon=t.unauthenticatedContext();
  await assertFails(getDoc(doc(alice.firestore(),"progressBackups/alice")));
  await assertFails(setDoc(doc(alice.firestore(),"progressBackups/alice"),{json:"stolen"}));
  await assertFails(setDoc(doc(alice.firestore(),"entitlements/alice"),{paid:999}));
  await assertFails(getDoc(doc(anon.firestore(),"progressBackups/alice")));
  await assertFails(setDoc(doc(anon.firestore(),"saves/alice"),{test:true}));
 }finally{await t.cleanup();}
}
async function checkPreviewRules(){
 const t=await initializeTestEnvironment({projectId:"demo-swordcrest-preview-qa",firestore:{host:HOST,port:PORT,rules:rules("firestore.preview.rules")}});
 try{
  const alice=t.authenticatedContext("alice"),bob=t.authenticatedContext("bob"),anon=t.unauthenticatedContext();
  const json=JSON.stringify({schemaVersion:2,roster:[{name:"test"}],savedAt:100});
  const valid={data:json,savedAt:100,schemaVersion:2,chars:json.length,updatedAt:serverTimestamp()};
  const owned=doc(alice.firestore(),"saves/alice");
  await assertSucceeds(setDoc(owned,valid));
  await assertSucceeds(getDoc(owned));
  await assertFails(getDoc(doc(bob.firestore(),"saves/alice")));
  await assertFails(getDoc(doc(anon.firestore(),"saves/alice")));
  await assertFails(setDoc(doc(bob.firestore(),"saves/alice"),valid));
  await assertFails(setDoc(doc(anon.firestore(),"saves/alice"),valid));
  await assertFails(getDocs(collection(alice.firestore(),"saves")));
  await assertFails(deleteDoc(owned));
  await assertFails(setDoc(owned,{...valid,extra:"unexpected"}));
  await assertFails(setDoc(owned,{...valid,updatedAt:new Date()}));
  await assertFails(setDoc(owned,{...valid,data:"A".repeat(850001),chars:850001}));
  await assertFails(setDoc(doc(alice.firestore(),"entitlements/alice"),{unlocks:{speed5:true}}));
 }finally{await t.cleanup();}
}
async function checkRevisionRecovery(){
 // Admin SDK bypasses Firestore Rules by design. Real transaction semantics MUST be tested separately.
 const projectId="demo-swordcrest-transaction-qa";
 const app=adminInit({projectId},"test-transaction-app");
 const db=getFirestore(app),repo=createFirestoreRepository(db,()=>FieldValue.serverTimestamp());
 const service=createBackupService({
  verifyToken:async token=>({uid:token,firebase:{sign_in_provider:"google.com"}}),
  repository:repo,
 });
 const alice=await service.getAccount("alice"),again=await service.getAccount("alice"),bob=await service.getAccount("bob");
 assert.equal(alice.accountId,again.accountId);
 assert.notEqual(alice.accountId,bob.accountId);
 const json=JSON.stringify({schemaVersion:2,roster:[],material:5});
 const operationId="0b4d6f53-4e89-4851-8e34-5367046bbd0d";
 const input={json,expectedRevision:0,savedAt:100,operationId};
 const first=await service.putBackup("alice",input);
 assert.deepEqual(first,{revision:1,status:"accept"});
 // Network timeout after a committed write: retrying same request does not grant a second revision.
 assert.deepEqual(await service.putBackup("alice",input),{revision:1,status:"replay"});
 const second={json:JSON.stringify({schemaVersion:2,roster:[],material:10}),expectedRevision:1,savedAt:101,operationId:"a94518b5-37bc-4ae1-96a7-e0a3ee4d86da"};
 const third={json:JSON.stringify({schemaVersion:2,roster:[],material:20}),expectedRevision:1,savedAt:102,operationId:"96c234b1-61f6-43cb-9226-14e58a489b9c"};
 const both=await Promise.allSettled([service.putBackup("alice",second),service.putBackup("alice",third)]);
 assert.equal(both.filter(x=>x.status==="fulfilled").length,1,"exactly one concurrent writer must commit");
 assert.equal(both.filter(x=>x.status==="rejected"&&x.reason?.status===409).length,1,"stale writer must receive 409");
 const recovered=await service.getBackup("alice");
 assert.equal(recovered.revision,2);
 assert.equal([10,20].includes(JSON.parse(recovered.json).material),true);
 const alien=await service.getBackup("bob");
 assert.equal(alien.revision,0);
 assert.equal(alien.json,null);
 console.log("Backup recovery: committed request replay, concurrent conflict, and account isolation verified");
}
(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error("Set FIRESTORE_EMULATOR_HOST; real Firebase access is forbidden");
 await checkProductionRules();console.log("Production Rules: direct client read/write denied");
 await checkPreviewRules();console.log("Preview Rules: owner-only valid save, all other writes denied");
 await checkRevisionRecovery();console.log("Emulator suite passed");
})().catch(e=>{console.error(e);process.exitCode=1;});

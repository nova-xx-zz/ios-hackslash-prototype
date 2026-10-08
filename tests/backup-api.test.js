"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createBackupService,parseSave,validateWrite,LIMIT_BYTES}=require("../functions/backup-core");
const {createHttpHandler}=require("../functions/http-handler");
const {createFirestoreRepository}=require("../functions/firestore-repository");
const token="good",op="123e4567-e89b-42d3-a456-426614174000";
const json=JSON.stringify({schemaVersion:2,roster:[{name:"a"}],material:12,savedAt:123});
function repo(){
 const users=new Map(),backups=new Map(),ops=new Map();
 return {async getOrCreateAccount(uid,ids){if(!users.has(uid))users.set(uid,ids);return users.get(uid);},
  async readBackup(id){return backups.get(id)||null;},
  async commitBackup(id,input){
   const k=id+"/"+input.operationId,old=ops.get(k);
   if(old)return old.hash===input.hash?{status:"replay",revision:old.revision}:{status:"mismatch",revision:old.revision};
   const rev=backups.get(id)?.revision||0;
   if(rev!==input.expectedRevision)return {status:"conflict",revision:rev};
   backups.set(id,{revision:rev+1,json:input.json,savedAt:input.savedAt,updatedAt:123});
   ops.set(k,{hash:input.hash,revision:rev+1});
   return {status:"accept",revision:rev+1};
  },
  users,backups};
}
function service(claims={uid:"player-1",firebase:{sign_in_provider:"google.com"}},repository=repo()){
 let n=0;return createBackupService({verifyToken:async t=>{if(t!==token)throw Error("bad");return claims;},repository,newId:()=>String(++n)});
}
const body=(o={})=>({expectedRevision:0,operationId:op,savedAt:123,json,...o});
test("verified identity owns stable account and anonymous is not eligible",async()=>{
 const r=repo(),s=service(undefined,r);
 const a=await s.getAccount(token),b=await s.getAccount(token);
 assert.deepEqual(a,b);assert.equal(r.users.size,1);
 await assert.rejects(s.getAccount("bad"),e=>e.status===401);
 await assert.rejects(service({uid:"anon",firebase:{sign_in_provider:"anonymous"}}).getAccount(token),e=>e.code==="account_link_required");
});
test("backup is atomic and retries are idempotent; conflicting changes are rejected",async()=>{
 const s=service();
 assert.equal((await s.getBackup(token)).revision,0);
 assert.deepEqual(await s.putBackup(token,body()),{revision:1,status:"accept"});
 assert.deepEqual(await s.putBackup(token,body()),{revision:1,status:"replay"});
 await assert.rejects(s.putBackup(token,body({json:JSON.stringify({schemaVersion:2,roster:[],material:50})})),e=>e.code==="operation_reused");
 await assert.rejects(s.putBackup(token,body({operationId:"d65b46e7-5367-4b65-97ae-b64ef18dca21"})),e=>e.code==="revision_conflict");
 const saved=await s.getBackup(token);assert.equal(saved.revision,1);assert.equal(JSON.parse(saved.json).material,12);
});
test("paid claims, future schema, oversized saves and malformed operations are rejected",()=>{
 assert.throws(()=>parseSave(JSON.stringify({schemaVersion:2,roster:[],purchases:{unlocks:{all:true}}})),e=>e.code==="financial_fields_forbidden");
 assert.throws(()=>parseSave(JSON.stringify({schemaVersion:2,roster:[],guaranteedStones:{paid:100}})),e=>e.code==="financial_fields_forbidden");
 assert.throws(()=>parseSave(JSON.stringify({schemaVersion:3,roster:[]})),e=>e.code==="unsupported_schema");
 assert.throws(()=>parseSave("x".repeat(LIMIT_BYTES+1)),e=>e.status===413);
 assert.throws(()=>validateWrite(body({operationId:"x"})),e=>e.status===400);
 assert.throws(()=>validateWrite(body({expectedRevision:-1})),e=>e.status===400);
});
function response(){return {headers:{},statusCode:200,payload:null,
 setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},
 json(body){this.payload=body;return this;},end(){return this;}};}
test("HTTP enforces exact origin, AppCheck appId and bearer token",async()=>{
 const h=createHttpHandler({service:service(),allowedOrigins:["https://game.example.jp"],allowedAppIds:["trusted"],verifyAppCheck:async t=>t==="verified"?{appId:"trusted"}:null});
 const base={path:"/v1/account",method:"GET",headers:{origin:"https://game.example.jp",authorization:"Bearer good","x-firebase-appcheck":"verified"}};
 let res=response();await h(base,res);assert.equal(res.statusCode,200);
 res=response();await h({...base,headers:{...base.headers,origin:"https://evil.example"}},res);assert.equal(res.statusCode,403);
 res=response();await h({...base,headers:{...base.headers,"x-firebase-appcheck":"wrong"}},res);assert.equal(res.statusCode,403);
 res=response();await h({...base,headers:{origin:"https://game.example.jp","x-firebase-appcheck":"verified"}},res);assert.equal(res.statusCode,401);
 res=response();await h({...base,method:"OPTIONS",headers:{origin:"https://game.example.jp"}},res);assert.equal(res.statusCode,204);
 res=response();await h({...base,path:"/v1/unknown"},res);assert.equal(res.statusCode,404);
});
test("Firestore transaction adapter associates UID once and rejects stale revisions",async()=>{
 const docs=new Map(),snap=p=>({exists:docs.has(p),data:()=>docs.get(p)});
 const db={doc:p=>({path:p,async get(){return snap(p);}}),async runTransaction(fn){
  const tx={get:async ref=>snap(ref.path),create:(ref,val)=>{if(docs.has(ref.path))throw Error("exists");docs.set(ref.path,val);},set:(ref,val)=>docs.set(ref.path,val)};
  return fn(tx);
 }};
 const r=createFirestoreRepository(db,()=>({serverTime:true}));
 assert.equal((await r.getOrCreateAccount("uid",{accountId:"a",billingId:"b"})).accountId,"a");
 assert.equal((await r.getOrCreateAccount("uid",{accountId:"different",billingId:"different"})).accountId,"a");
 const request=validateWrite(body());
 assert.deepEqual(await r.commitBackup("a",request),{status:"accept",revision:1});
 assert.deepEqual(await r.commitBackup("a",request),{status:"replay",revision:1});
 assert.deepEqual(await r.commitBackup("a",{...request,expectedRevision:0,operationId:"next"}),{status:"conflict",revision:1});
 assert.equal((await r.readBackup("a")).revision,1);
});

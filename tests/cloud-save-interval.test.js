"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const crypto=require("node:crypto").webcrypto;
const history=require("../js/core/backup-history.js");
const source=fs.readFileSync(path.join(__dirname,"../js/cloud.js"),"utf8");
const DAY=24*60*60*1000;
function harness(){
  let now=1_800_000_000_000,serial=0,failUpload=false,failIndex=false;
  const timers=new Map(),events=new Map(),documentEvents=new Map(),blobs=new Map();
  let index=null,legacy=null,raw=null;
  const metrics={uploads:0,deletes:0,reads:0};
  const root={
    QP_FIREBASE_CONFIG:{projectId:"test",storageBucket:"test.firebasestorage.app"},
    QPCore:{backupHistory:history,storage:{
      isDebugMode:()=>false,isDungeonPilotMode:()=>false,KEYS:{save:"jobquest_save_v1"}}},
    QPModel:{save:{prepareRestore:s=>{try{return JSON.parse(s).roster?.length?{json:s}:null}catch(_){return null}}}},
    crypto,TextEncoder,TextDecoder,Response,Blob,navigator:{onLine:true},localStorage:{
      getItem:()=>raw
    },Date:class extends Date{static now(){return now;}},
    setTimeout(fn,ms){const id=++serial;timers.set(id,{at:now+ms,fn});return id;},
    clearTimeout(id){timers.delete(id);},
    addEventListener(name,fn){events.set(name,fn);},
    document:{hidden:false,addEventListener(name,fn){documentEvents.set(name,fn);}},
    QPFirebase:{
      initializeApp:()=>({}),initializeAuth:()=>({currentUser:{getIdToken:async()=>"jwt"}}),
      indexedDBLocalPersistence:{},browserLocalPersistence:{},inMemoryPersistence:{},
      getFirestore:()=>({}),onAuthStateChanged(_auth,cb){queueMicrotask(()=>cb({uid:"uid-test"}));return()=>{};},
      signInAnonymously:async()=>({user:{uid:"uid-test"}}),
      doc(_db,collection){return{collection}},serverTimestamp:()=>("serverTimestamp"),
      getDoc:async(ref)=>{
        const value=ref.collection==="backupIndexes"?index:legacy;
        return{exists:()=>value!==null,data:()=>structuredClone(value)};
      },
      setDoc:async(ref,data)=>{
        if(ref.collection!=="backupIndexes")throw Error("legacy writes forbidden");
        if(failIndex){failIndex=false;throw Error("index failed");}
        index=structuredClone(data);
      }
    },
    async fetch(url,request){
      assert.match(request.headers.Authorization,/^Firebase jwt$/);
      const u=new URL(url);
      const name=request.method==="POST"?u.searchParams.get("name"):
        decodeURIComponent(u.pathname.split("/o/")[1]);
      if(request.method==="POST"){
        if(failUpload){failUpload=false;return{ok:false,status:503};}
        metrics.uploads++;blobs.set(name,new Uint8Array(request.body));return{ok:true,status:200};
      }
      if(request.method==="DELETE"){
        metrics.deletes++;blobs.delete(name);return{ok:true,status:200};
      }
      metrics.reads++;
      return blobs.has(name)?{ok:true,status:200,arrayBuffer:async()=>blobs.get(name).buffer}:
        {ok:false,status:404};
    },
    saveGame(){
      if(!raw)return false;
      events.get("qp:saved")({detail:{json:raw,savedAt:now}});
      return true;
    }
  };
  root.globalThis=root;
  vm.runInNewContext(source,root,{filename:"js/cloud.js"});
  async function flush(){for(let i=0;i<35;i++)await Promise.resolve();}
  async function advance(ms){
    const target=now+ms;
    for(let i=0;i<100;i++){
      const next=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;
      now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();
    }
    now=target;await flush();
  }
  function save(progress,count=1){
    raw=JSON.stringify({schemaVersion:2,savedAt:now,progress,roster:[{id:"one",name:"冒険者"}],
      inventory:Array.from({length:count},(_,i)=>({id:i,name:"大剣⚔️"})),autoRepeat:[]});
    root.saveGame();
  }
  return{root,advance,flush,save,metrics,blobs,
    getEntries:()=>index?structuredClone(index.entries):[],
    setLegacy:data=>{legacy={data,savedAt:now};},
    failUpload:()=>{failUpload=true;},
    failIndex:()=>{failIndex=true;},
    offline:()=>{root.navigator.onLine=false;},
    online:()=>{root.navigator.onLine=true;events.get("online")();}
  };
}
test("端末セーブはそのまま、初回自動保存後24時間未満は書かず24時間後に保存",async()=>{
  const h=harness();
  await h.root.QPCloud.start();h.save(1,4143);await h.advance(0);
  assert.equal(h.metrics.uploads,1);
  assert.equal(h.getEntries()[0].kind,"auto");
  await h.advance(DAY-1);h.save(2);await h.advance(0);
  assert.equal(h.metrics.uploads,1);
  await h.advance(1);
  assert.equal(h.metrics.uploads,2);
  assert.equal(h.getEntries().length,2);
});
test("手動5件・自動5件と履歴削除・選択復元が可能",async()=>{
  const h=harness();await h.root.QPCloud.start();h.save(1);await h.advance(0);
  const first=h.getEntries()[0];
  for(let n=0;n<5;n++){h.save(n+2);assert.equal(await h.root.QPCloud.backupNow(),true);}
  assert.equal(h.getEntries().filter(e=>e.kind==="manual").length,5);
  assert.equal(await h.root.QPCloud.backupNow(),false);
  assert.match(h.root.QPCloud.getState().error,/5件/);
  assert.equal((await h.root.QPCloud.fetchCloudSave(first.id)).json.includes('"progress":1'),true);
  await h.root.QPCloud.deleteBackup(h.getEntries().find(e=>e.kind==="manual").id);
  assert.equal(await h.root.QPCloud.backupNow(),true);
  for(let i=0;i<5;i++){await h.advance(DAY);h.save(i+10);await h.advance(0);}
  assert.equal(h.getEntries().filter(e=>e.kind==="auto").length,5);
  assert.equal(h.getEntries().length,10);
});
test("アップロード失敗・インデックス確定失敗は既存履歴を保持",async()=>{
  const h=harness();await h.root.QPCloud.start();h.save(1);await h.advance(0);
  const previous=h.getEntries();
  h.failUpload();h.save(2);
  assert.equal(await h.root.QPCloud.backupNow(),false);
  assert.deepEqual(h.getEntries(),previous);
  h.failIndex();assert.equal(await h.root.QPCloud.backupNow(),false);
  assert.deepEqual(h.getEntries(),previous);
});
test("旧Firestoreは復元専用で利用でき、ローカルを消さない",async()=>{
  const h=harness();h.save(1);h.setLegacy(JSON.stringify({
    schemaVersion:2,savedAt:1,roster:[{id:"old"}],inventory:[]
  }));
  await h.root.QPCloud.start();
  const old=await h.root.QPCloud.fetchCloudSave();
  assert.equal(JSON.parse(old.json).roster[0].id,"old");
  assert.equal(h.metrics.uploads,0);
});

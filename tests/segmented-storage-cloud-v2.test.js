"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const crypto=require("node:crypto").webcrypto;
const Segments=require("../js/core/save-segments.js");
const Cloud=require("../js/core/cloud-large-backup.js");
const Storage=require("../js/core/storage.js");
function json(count){
  return JSON.stringify({
    schemaVersion:2,savedAt:1792000000000,
    roster:[{id:"hero",name:"剣士⚔️",level:99}],
    inventory:Array.from({length:count},(_,i)=>({
      id:"装備-"+i,name:"🗡️剣の名-"+i,rarity:"ur",plus:99,locked:i%3===0,
      options:[{id:"critical",value:24,rarity:"ur"},{id:"exp",value:20,rarity:"sr"}],
      sockets:[{id:2,rarity:"sr"}]
    })),
    material:2105,autoRepeat:[{active:true,done:70,target:100}],
    purchases:{unlocks:{speed5:true},history:[]}
  });
}
function memoryBackend(){
  const data=new Map();
  return {
    read:async id=>data.has(id)?structuredClone(data.get(id)):null,
    write:async r=>{data.set(r.id,structuredClone(r));},
    data
  };
}
function cloudBackend(){
  const objects=new Map();
  let pointer=null,failAt=-1;
  return {
    objects,
    async getPointer(){return pointer?structuredClone(pointer):null;},
    async putPart(gen,i,content){
      if(i===failAt)throw Error("network-down");
      objects.set(gen+":"+i,content);
    },
    async getPart(gen,i){return objects.get(gen+":"+i)??null;},
    async commitPointer(expected,next){
      if((pointer?pointer.revision:0)!==expected)return false;
      pointer=structuredClone(next);return true;
    },
    forceRevision(rev){pointer.revision=rev;},
    breakAt(n){failAt=n;},
    current(){return structuredClone(pointer);}
  };
}
test("10,000/30,000件をUTF-8境界で分割し、完全一致・装備OP/ロック/周回/購入情報を維持",async()=>{
  for(const n of [10000,30000]){
    const source=json(n);
    const {manifest,chunks}=await Segments.pack(source,{crypto});
    assert.equal(manifest.inventoryCount,n);
    assert.ok(chunks.length>2);
    assert.ok(chunks.every(c=>new TextEncoder().encode(c).length<=192*1024));
    assert.equal(chunks.join(""),source);
    assert.match(manifest.sha256,/^[0-9a-f]{64}$/);
    assert.equal(await Segments.unpack(manifest,chunks,{crypto}),source);
    const decoded=JSON.parse(chunks.join(""));
    assert.equal(decoded.inventory[0].locked,true);
    assert.equal(decoded.inventory.at(-1).options[1].rarity,"sr");
    assert.equal(decoded.autoRepeat[0].active,true);
    assert.equal(decoded.purchases.unlocks.speed5,true);
  }
});
test("文字数とUTF-8を区別、欠損・入替・改変を検出",async()=>{
  const raw=json(300);
  const {manifest,chunks}=await Segments.pack(raw,{crypto,chunkBytes:4096});
  assert.ok(chunks.length>2);
  assert.ok(manifest.totalBytes>manifest.totalCharacters);
  await assert.rejects(Segments.unpack(manifest,chunks.slice(1),{crypto}),/不正/);
  const changed=chunks.slice();changed[1]=changed[1].replace("装備","装殿");
  await assert.rejects(Segments.unpack(manifest,changed,{crypto}),/破損/);
  const swapped=chunks.slice();[swapped[0],swapped[1]]=[swapped[1],swapped[0]];
  await assert.rejects(Segments.unpack(manifest,swapped,{crypto}),/破損/);
  await assert.rejects(Segments.pack(raw,{crypto,chunkBytes:1024}),/無効/);
  await assert.rejects(Segments.unpack({...manifest,formatVersion:2},chunks,{crypto}),/不正/);
});
test("IndexedDBシャドーは旧セーブを一切変更せず、不変の世代を切替・再読込",async()=>{
  const initial=json(10000);
  const storage=Storage.createStorage(Storage.createMemoryBackend({[Storage.KEYS.save]:initial}));
  const db=memoryBackend();
  const first=await Segments.copyToIndexedDB(db,storage.getString(Storage.KEYS.save),{crypto});
  assert.equal((await Segments.readIndexedDBCopy(db,{crypto})),initial);
  const second=json(50);
  const newGen=await Segments.copyToIndexedDB(db,second,{crypto});
  assert.notEqual(first.generation,newGen.generation);
  assert.equal(await Segments.readIndexedDBCopy(db,{crypto}),second);
  assert.equal(storage.getString(Storage.KEYS.save),initial);
  assert.ok(db.data.has("scseg:"+first.generation+":manifest"));
});
test("IndexedDB容量不足/改ざん時は以前の参照を残し、端末正本を保持",async()=>{
  const db=memoryBackend(),source=json(100),first=await Segments.copyToIndexedDB(db,source,{crypto});
  const refusing={read:db.read,write:async r=>{
    if(r.id!=="scseg:active")throw Object.assign(Error("Quota"),{name:"QuotaExceededError"});
    return db.write(r);
  }};
  await assert.rejects(Segments.copyToIndexedDB(refusing,json(200),{crypto}),/Quota/);
  assert.equal(await Segments.readIndexedDBCopy(db,{crypto}),source);
  db.data.get("scseg:"+first.generation+":0").value="corrupt";
  await assert.rejects(Segments.readIndexedDBCopy(db,{crypto}),/破損/);
});
test("クラウドV2: 先に不変チャンクを照合し、revision CAS成功後のみ候補復元",async()=>{
  const remote=cloudBackend(),source=json(10000);
  const out=await Cloud.upload(remote,source,{crypto});
  assert.ok(out.partCount>1);
  assert.equal(out.revision,1);
  const loaded=await Cloud.download(remote,{crypto});
  assert.equal(loaded.json,source);
  assert.equal(loaded.savedAt,1792000000000);
  assert.equal(remote.current().manifest.inventoryCount,10000);
  assert.ok(!("data" in remote.current()),"manifestに平文セーブを格納しない");
  const newer=await Cloud.upload(remote,json(2),{crypto});
  assert.equal(newer.revision,2);
});
test("クラウドV2: 通信失敗・改ざん・CAS競合・revision不正のとき旧manifestを保持",async()=>{
  const remote=cloudBackend(),first=json(50);
  await Cloud.upload(remote,first,{crypto});
  remote.breakAt(1);
  await assert.rejects(Cloud.upload(remote,json(10000),{crypto}),/network-down/);
  assert.equal((await Cloud.download(remote,{crypto})).json,first);
  remote.breakAt(-1);
  const originalCommit=remote.commitPointer;
  remote.commitPointer=async()=>false;
  await assert.rejects(Cloud.upload(remote,json(100),{crypto}),/別の端末/);
  assert.equal((await Cloud.download(remote,{crypto})).json,first);
  remote.commitPointer=originalCommit;
  remote.objects.set(remote.current().generation+":0","broken");
  await assert.rejects(Cloud.download(remote,{crypto}),/破損/);
});
test("本番のFirestore直接書込みは引き続き禁止・クラウドV2は未接続",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const root=path.join(__dirname,"..");
  const production=fs.readFileSync(path.join(root,"infra/firebase/firestore.production.rules"),"utf8");
  const existingCloud=fs.readFileSync(path.join(root,"js/cloud.js"),"utf8");
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  assert.match(production,/allow read, write:\s*if false;/);
  assert.doesNotMatch(existingCloud,/cloudLargeBackup|saveSegments/);
  assert.ok(html.indexOf("js/core/save-mirror.js?v=1")<html.indexOf("js/core/save-segments.js?v=1"));
  assert.ok(html.indexOf("js/core/cloud-large-backup.js?v=1")<html.indexOf("js/cloud.js?v=5"));
  assert.match(html,/id="btnSegmentedSaveCopy"/);
});
test("設定操作以外で分割コピーは始まらず、既存の端末セーブは上書きしない",async()=>{
  const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
  const elements=new Map(),writes=[],calls=[],raw=json(5);
  function el(id){
    if(!elements.has(id))elements.set(id,{
      textContent:"",disabled:false,listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn},
      classList:{add(){},toggle(){}}
    });
    return elements.get(id);
  }
  const ctx={
    document:{getElementById:el,querySelector:()=>({classList:{add(){}}})},
    window:{indexedDB:{},navigator:{}},S:{inventory:[]},
    QPCore:{
      saveMirror:{createIndexedDBBackend:()=>({})},
      saveSegments:{copyToIndexedDB:async(_,s)=>{calls.push(s);return{
        manifest:{inventoryCount:5,parts:[{},{}],totalBytes:300}
      };}},
      saveDiagnostics:{formatBytes:()=> "0.00 MiB"}
    },
    QPModel:{save:{SCHEMA_VERSION:2}},KEYS:Storage.KEYS,
    store:{getString:()=>raw,set:()=>{writes.push(1)}}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/ui/settings.js"),"utf8"),ctx);
  assert.equal(calls.length,0);
  await el("btnSegmentedSaveCopy").listeners.click();
  assert.deepEqual(calls,[raw]);
  assert.equal(writes.length,0);
  assert.match(el("segmentedSaveCopyResult").textContent,/分割コピーの照合が完了/);
  assert.equal(el("btnSegmentedSaveCopy").disabled,false);
});

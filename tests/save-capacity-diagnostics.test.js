"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const Diagnostics=require("../js/core/save-diagnostics.js");
const Storage=require("../js/core/storage.js");
const LIMIT=900*1024;
test("端末用サイズとクラウド送信文字数の境界・日本語UTF-8を区別する",()=>{
 assert.equal(Diagnostics.CLOUD_MAX_SAVE_CHARS,LIMIT);
 assert.equal(Diagnostics.cloudAccepts("x".repeat(LIMIT)),true);
 assert.equal(Diagnostics.cloudAccepts("x".repeat(LIMIT+1)),false);
 assert.equal(Diagnostics.byteLength("冒険者"),9);
 assert.equal(Diagnostics.analyze("冒険者").utf8Bytes,9);
 assert.equal(Diagnostics.analyze("冒険者").characters,3);
 assert.equal(Diagnostics.analyze("x".repeat(LIMIT+1)).cloudEligible,false);
 assert.equal(Diagnostics.analyze("x".repeat(LIMIT)).cloudEligible,true);
 assert.equal(Diagnostics.analyze(null).cloudEligible,null);
});
test("保存領域の概算と永続化状態は取得できる時だけ表示し、切替は決して行わない",()=>{
 const r=Diagnostics.analyze('{"inventory":[]}',{
  inventoryCount:9000,estimate:{usage:234,quota:1000},persisted:false,indexedDBAvailable:true
 });
 assert.equal(r.originQuotaRatio,.234);
 assert.equal(r.originUsageBytes,234);
 assert.equal(r.saved,true);
 assert.equal(r.indexedDBAvailable,true);
 assert.equal(r.saveStorageBackend,"localStorage");
 assert.equal(r.quotaIsApproximate,true);
 const plan=Diagnostics.migrationReadiness(r);
 assert.equal(plan.readyForImmediateCutover,false);
 assert.equal(plan.sourcePresent,true);
 assert.ok(plan.mandatorySteps.some(s=>s.includes("読み返して")));
 const unknown=Diagnostics.analyze("abc",{estimate:{quota:0,usage:-1}});
 assert.equal(unknown.originQuotaRatio,null);
 assert.equal(unknown.persisted,null);
 assert.equal(unknown.indexedDBAvailable,false);
});
test("診断は保存先やユーザー固有JSONを一切変更しない",()=>{
 const original='{"roster":[{"name":"内緒"}],"inventory":[]}';
 const backend=Storage.createMemoryBackend({[Storage.KEYS.save]:original});
 const storage=Storage.createStorage(backend);
 const diagnostic=Diagnostics.analyze(storage.getString(Storage.KEYS.save),{});
 assert.equal(storage.getString(Storage.KEYS.save),original);
 assert.equal(diagnostic.saved,true);
 assert.equal(JSON.stringify(diagnostic).includes("内緒"),false);
 assert.equal(Object.keys(backend.dump()).length,1);
});
test("画面の診断ボタンで容量の概算とクラウド制限を表示し、書込は行わない",async()=>{
 const saved="x".repeat(LIMIT+12),writes=[];
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   id,disabled:false,textContent:"",listeners:{},
   addEventListener(name,fn){this.listeners[name]=fn},
   classList:{add(){},remove(){},toggle(){}}
  });
  return elements.get(id);
 };
 const ctx={
  window:{navigator:{storage:{estimate:async()=>({usage:2200000,quota:5000000}),persisted:async()=>false}},
   indexedDB:{}},
  document:{getElementById:element,querySelector:()=>({classList:{add(){}}})},
  QPCore:{saveDiagnostics:Diagnostics},S:{inventory:Array.from({length:2500},()=>({}))},
  KEYS:Storage.KEYS,store:{getString(key){assert.equal(key,Storage.KEYS.save);return saved},
   set(){writes.push(1);throw Error("diagnostics must not write")}}
 };
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/ui/settings.js"),"utf8"),ctx);
 await vm.runInContext("inspectCurrentSaveStorage()",ctx);
 const out=element("saveStorageDiagnosticsResult").textContent;
 assert.match(out,/2,500件/);
 assert.match(out,/バックアップ不可/);
 assert.match(out,/2.10 MiB/);
 assert.match(out,/利用候補あり/);
 assert.equal(writes.length,0);
 assert.equal(element("btnSaveStorageDiagnostics").disabled,false);
});
test("容量APIが拒否・未対応でもボタンが動作し、既存セーブの内容は表示されない",async()=>{
 const json='{"name":"公開してはいけない名前"}';
 const e=new Map(),getElementById=id=>{
  if(!e.has(id))e.set(id,{textContent:"",disabled:false,addEventListener(){},
   classList:{add(){},toggle(){}}});
  return e.get(id);
 };
 const ctx={window:{navigator:{storage:{estimate:async()=>{throw Error("denied")}}}},
  document:{getElementById,querySelector:()=>({classList:{add(){}}})},
  QPCore:{saveDiagnostics:Diagnostics},S:{inventory:[]},KEYS:Storage.KEYS,
  store:{getString:()=>json}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/ui/settings.js"),"utf8"),ctx);
 await vm.runInContext("inspectCurrentSaveStorage()",ctx);
 const out=getElementById("saveStorageDiagnosticsResult").textContent;
 assert.match(out,/取得不可/);
 assert.doesNotMatch(out,/公開してはいけない名前/);
});
test("クラウド送信判定と設定画面が共通の定数を使い、スクリプト順序と正式版への同梱を検証",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const cloud=fs.readFileSync(path.join(__dirname,"../js/cloud.js"),"utf8");
 const idx=html.indexOf('js/core/save-diagnostics.js?v=1');
 assert.ok(idx>=0);
 assert.ok(idx<html.indexOf('js/cloud.js?v=3'));
 assert.ok(idx<html.indexOf('js/ui/settings.js?v=3'));
 assert.match(cloud,/root\.QPCore\.saveDiagnostics\.CLOUD_MAX_SAVE_CHARS/);
 assert.match(cloud,/json\.length > MAX_SAVE_CHARS/);
 assert.match(html,/id="btnSaveStorageDiagnostics"/);
 assert.match(html,/id="saveStorageDiagnosticsResult"/);
});

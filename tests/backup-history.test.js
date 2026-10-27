"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const Policy=require("../js/core/backup-history.js");
const entry=(kind,i)=>({id:String(i).padStart(32,"0"),kind,createdAt:1_000_000+i*Policy.AUTO_INTERVAL_MS,
  savedAt:1000+i,sha256:"a".repeat(64),encoding:"gzip",bytes:200});
test("24時間経過時のみ自動バックアップ",()=>{
  const a=entry("auto",0);
  assert.equal(Policy.autoDue([],a.createdAt),true);
  assert.equal(Policy.autoDue([a],a.createdAt+Policy.AUTO_INTERVAL_MS-1),false);
  assert.equal(Policy.autoDue([a],a.createdAt+Policy.AUTO_INTERVAL_MS),true);
});
test("自動は5件循環、手動は5件で上書き禁止",()=>{
  let entries=[],removed=[];
  for(let i=0;i<6;i++){const p=Policy.plan(entries,entry("auto",i));entries=p.entries;removed=p.removed;}
  assert.equal(entries.length,5);assert.equal(removed.length,1);
  assert.equal(entries.some(e=>e.id===entry("auto",0).id),false);
  for(let i=7;i<12;i++)entries=Policy.plan(entries,entry("manual",i)).entries;
  assert.equal(entries.length,10);
  assert.throws(()=>Policy.plan(entries,entry("manual",12)),/5件/);
  assert.equal(entries.filter(e=>e.kind==="manual").length,5);
});
test("履歴破損・不正なID・重複を拒否",()=>{
  assert.throws(()=>Policy.validate([entry("manual",1),entry("manual",1)]),/不正/);
  assert.throws(()=>Policy.plan([], {...entry("auto",0),id:"../../evil"}),/不正/);
  assert.throws(()=>Policy.validate([{...entry("auto",0),bytes:50*1024*1024}]),/不正/);
});

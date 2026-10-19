"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { measureCave, runDiagnostics }=require("../tools/cave-diagnostics.js");
const { data }=require("../tools/lib/sim.js");

test("洞窟診断: ゲームデータを変更せず、階層別全滅を追跡",()=>{
 const original=data.getDungeon("cave").power;
 const r=measureCave("recommended", .9, 8);
 assert.equal(data.getDungeon("cave").power,original);
 assert.equal(r.clear+r.fail,8);
 assert.equal(r.fail,Object.values(r.floorFailures).reduce((s,n)=>s+n,0));
 assert.equal(r.failedDropsLeaked,false);
 assert.ok(r.maxObservedEnemies>=1&&r.maxObservedEnemies<=5);
 assert.ok(r.boss.reached>=r.boss.defeated);
 assert.equal(r.boss.defeated,r.clear);
 assert.ok(r.floorVisits.every(v=>v>=0&&v<=8));
});

test("洞窟診断: 同じ固定seedなら完全再現",()=>{
 assert.deepEqual(measureCave("recommended",1,6),measureCave("recommended",1,6));
});

test("洞窟診断: 現行倍率を4案で評価し、全難易度を変えない",()=>{
 const out=runDiagnostics(2);
 assert.equal(out.rows.length,12);
 assert.equal(new Set(out.rows.map(x=>x.configuredPower)).size,4);
 assert.ok(out.rows.every(x=>x.failedDropsLeaked===false));
});
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {runAudit}=require("../tools/trait-depth-audit.js");

test("3F/5F/10F/15F抽選で特性最大3・レア保護・固定seed再現",()=>{
 const a=runAudit(8,10108),b=runAudit(8,10108);
 assert.deepEqual(a,b);
 assert.deepEqual(a.stages.map(s=>s.floors),[3,5,10,15]);
 for(const stage of a.stages){
  assert.ok(stage.totalBattles>0);
  assert.equal(stage.maxTraitsAfter,3);
  assert.equal(stage.perFloor.length,stage.floors);
  assert.equal(stage.totalBattles,stage.perFloor.reduce((n,f)=>n+f.battles,0));
  for(const f of stage.perFloor){
   assert.ok(f.battles>0);
   assert.equal(Object.values(f.counts).reduce((x,y)=>x+y,0),f.battles);
   assert.ok(f.averageEnemies>=1&&f.averageEnemies<=5);
   assert.ok(f.averageTraits<=3);
   assert.ok(f.rare>=0&&f.rare<=f.enemyTotal);
  }
 }
});

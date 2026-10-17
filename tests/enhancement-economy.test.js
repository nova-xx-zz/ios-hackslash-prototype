"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { data }=require("../tools/lib/sim.js");
const enh=require("../js/core/enhance.js");
const { expectedStageCost,enhancementCosts,gatherEconomy,compareMilestones,CONFIGS }=require("../tools/enhancement-economy.js");

test("強化石の期待消費は本体コスト・成功確率・失敗天井から一致して導ける",()=>{
 for(const rarity of data.RARITIES)for(const plus of [0,1,3,4,8,11,12,49,98]){
   const x=expectedStageCost(rarity.key,plus);
   assert.equal(x.costPerTry,enh.cost(data.ENHANCE_RULES,rarity.key,plus));
   assert.equal(x.pityThreshold,enh.pityThreshold(data.ENHANCE_RULES,rarity.key,plus));
   assert.ok(x.expectedStones>=x.costPerTry);
   assert.ok(x.expectedAttempts<=x.failuresToPity+1);
   assert.ok(x.expectedAttempts>0);
 }
 const n04=enhancementCosts("n",0,4);
 const firstFour=[0,1,2,3].reduce((s,p)=>s+expectedStageCost("n",p).expectedStones,0);
 assert.ok(Math.abs(n04.expectedStones-firstFour)<.005);
 assert.throws(()=>enhancementCosts("n",99,100),RangeError);
 assert.throws(()=>enhancementCosts("bogus",0,4),RangeError);
});

test("シミュレーターは通常の自動分解N/RとNのみを正確に区別して全ロストを維持",()=>{
 const config=CONFIGS.find(x=>x.id==="cave-designed");
 const x=gatherEconomy(config,6);
 const y=gatherEconomy(config,6);
 assert.deepEqual(x,y);
 assert.equal(x.cleared+x.failed,6);
 assert.equal(x.filters.length,2);
 const n=x.filters.find(x=>x.filter==="n");
 const both=x.filters.find(x=>x.filter==="default-n-r");
 assert.ok(both.stones>=n.stones);
 assert.ok(both.kept<=n.kept);
 assert.ok(both.disassembled>=n.disassembled);
 assert.ok(both.stones>=0);
 for(const f of x.filters){
   assert.ok(Number.isFinite(f.stonesPer600GameSeconds));
   assert.ok(f.percentiles.p10<=f.percentiles.p50&&f.percentiles.p50<=f.percentiles.p90);
 }
});

test("装備5人分の強化に必要な周回目安は実際の強化消費と素材収支に一致",()=>{
 const report=compareMilestones(2);
 assert.equal(report.configs.length,5);
 assert.equal(report.examples.length,5);
 assert.equal(report.costs.length,5*2*5);
 assert.ok(report.configs.every(x=>x.trials===2));
 assert.ok(report.costs.every(x=>x.expectedStones>=x.bestCaseStones));
 const c4=enhancementCosts("n",0,4);
 const c8=enhancementCosts("n",0,8);
 const c12=enhancementCosts("n",0,12);
 assert.ok(c4.expectedStones<c8.expectedStones);
 assert.ok(c8.expectedStones<c12.expectedStones);
});

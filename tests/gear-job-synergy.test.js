"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluate,runStudy}=require("../tools/gear-job-synergy.js");
const {itemStatsEarlyMilestones,buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {specsFor}=require("../tools/cave-party-comparison.js");
const {data}=require("../tools/lib/sim.js");

test("early milestone formula changes only hypothetical tool projection, never game itemStats",()=>{
  const item={rarity:"n",stats:{atk:10,spd:2},plus:1};
  const oldAtOne=data.itemStats(item);
  const projectedOne=itemStatsEarlyMilestones(item);
  assert.deepEqual(projectedOne,oldAtOne);
  item.plus=5;
  const oldAtFive=data.itemStats(item);
  const projectedFive=itemStatsEarlyMilestones(item);
  assert.equal(oldAtFive.atk,oldAtOne.atk,"real formula currently plateaus from +1 to +5 for N main");
  assert.equal(projectedFive.atk,oldAtFive.atk+1);
  item.plus=99;
  assert.equal(itemStatsEarlyMilestones(item).atk-data.itemStats(item).atk,3,"bounded +99 extra bonus");
  assert.equal(data.itemStats(item).atk,18,"real data remains unchanged");
});

test("party and equipment intervention exposes actual roster stat deltas without modifying original data",()=>{
 const p=PROFILES.find(x=>x.id==="reinforced");
 const base=buildScenario("cave",p,2,{partySpecs:specsFor("userProposal")});
 const candidate=buildScenario("cave",p,2,{partySpecs:specsFor("userProposal"),enhancePreview:"earlyMilestones"});
 const a=base.roster.computeStats(base.state.roster[0]);
 const b=candidate.roster.computeStats(candidate.state.roster[0]);
 assert.ok(b.atk>a.atk||b.def>a.def||b.maxHp>a.maxHp,"at least one primary stat must improve");
 assert.equal(base.enhancementPreview,"current");
 assert.equal(candidate.enhancementPreview,"earlyMilestones");
 assert.equal(data.getDungeon("cave").pilotLateNormalFactor,.8);
});

test("joint gear-job trial is deterministic; fails never award drops",()=>{
 const a=evaluate("userProposal","reinforced","current",4,1);
 const b=evaluate("userProposal","reinforced","current",4,1);
 assert.deepEqual(a,b);
 assert.equal(a.clear+a.failures,4);
 assert.equal(a.zeroFailedDrops,true);
 assert.equal(a.bossWon,a.clear);
 assert.equal(a.stats.filter(s=>s.job==="priest").length,2);
 const study=runStudy(1);
 assert.equal(study.rows.length,24);
 assert.ok(study.rows.every(x=>x.zeroFailedDrops));
});

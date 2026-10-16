"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {BUILDS,specsFor,measureParty,runComparison}=require("../tools/cave-party-comparison.js");
const {buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {data}=require("../tools/lib/sim.js");

test("提案編成は戦士1僧侶2盗賊1魔法使い1、人数と種族比較は同じ",()=>{
  const specs=specsFor("userProposal");
  assert.deepEqual(specs.map(x=>x.job),["warrior","thief","mage","priest","priest"]);
  assert.deepEqual(specs.map(x=>x.race),specsFor("baseline").map(x=>x.race));
  assert.equal(specs.length,5);
  assert.deepEqual(BUILDS.baseline.jobs,["warrior","warrior","mage","mage","priest"]);
  assert.throws(()=>specsFor("unknown"),RangeError);
});

test("職を変えてもLvと装備・スキルツリーの設定は同じ比較条件",()=>{
  const profile=PROFILES.find(x=>x.id==="recommended");
  const scenario=buildScenario("cave",profile,100,{partySpecs:specsFor("userProposal")});
  assert.deepEqual(scenario.state.roster.map(x=>x.job),BUILDS.userProposal.jobs);
  assert.ok(scenario.state.roster.every(x=>x.level===scenario.d.level));
  assert.equal(scenario.roster.explorationSkillChance(scenario.state.roster[1],"thief_lockpick"),.45);
  assert.equal(scenario.state.roster.filter(x=>x.job==="priest").length,2);
  assert.equal(scenario.state.inventory.length,0);
});

test("初期敵倍率と4F/5Fだけの調整は不変の実データを使った別計測",()=>{
 const original=data.getDungeon("cave").pilotLateNormalFactor;
 const a=measureParty("userProposal","recommended",1,4);
 const b=measureParty("userProposal","recommended",.8,4);
 assert.equal(data.getDungeon("cave").pilotLateNormalFactor,original);
 for(const r of [a,b]){
  assert.equal(r.cleared+Object.values(r.failedAt).reduce((sum,n)=>sum+n,0),4);
  assert.equal(r.failedDropsKept,0);
  assert.ok(r.bossWon<=r.bossReached);
  assert.equal(r.bossWon,r.cleared);
  assert.ok(r.lockedSuccess<=r.lockedAttempt&&r.lockedAttempt<=r.lockedFound);
 }
});

test("同じseedでのジョブ編成測定は完全再現し、古い計測を壊さない",()=>{
 const a=measureParty("baseline","recommended",.8,6);
 const b=measureParty("baseline","recommended",.8,6);
 assert.deepEqual(a,b);
 const all=runComparison(1);
 assert.equal(all.results.length,24);
 assert.ok(all.results.every(x=>x.failedDropsKept===0));
});

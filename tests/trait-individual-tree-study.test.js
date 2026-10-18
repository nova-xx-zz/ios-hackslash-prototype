"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {characterSpecs,PARTY_BUILDS}=require("../tools/basic-job-build-study.js");
const {data}=require("../tools/lib/sim.js");
const {PARTIES,TRAITS,BUILDS,measureBuild,runStudy,applyIndividualBuild}=require("../tools/trait-individual-tree-study.js");

test("実際の敵特性と耐性を使い、本体の敵データには影響を与えない",()=>{
 const gear=PROFILES.find(x=>x.id==="recommended");
 const template=data.getEnemyTemplate("rock_golem");
 const native=data.getDungeon("cave").pilotLateNormalFactor;
 for(const [trait,mode,field,value] of [
  ["spirit","normal","physical",.6],
  ["spirit","extra","physical",0],
  ["ward","extra","magic",0],
  ["undead","extra","nonHoly",0],
 ]){
  const s=buildScenario("cave",gear,11,{
    partySpecs:characterSpecs(PARTY_BUILDS.darkThief),enemyTrait:trait,enemyTraitMode:mode,
  });
  const e=s.runner.startBattle(s.runner.startRun(0,"cave")).battle.enemies[0];
  assert.equal(e.res[field],value,trait+"/"+mode);
  assert.equal(e.traits.length,1);
  assert.equal(e.traits[0],trait);
 }
 const armored=buildScenario("cave",gear,11,{
  partySpecs:characterSpecs(PARTY_BUILDS.monkThief),enemyTrait:"armored",enemyTraitMode:"extra",
 });
 const e=armored.runner.startBattle(armored.runner.startRun(0,"cave")).battle.enemies[0];
 assert.ok(e.def>0);
 assert.deepEqual(e.traits,["armored"]);
 assert.equal(data.getDungeon("cave").pilotLateNormalFactor,native);
 assert.equal(data.getEnemyTemplate("rock_golem").element,template.element);
});

test("一人だけの分岐変更はSP・装備・他メンバーを変えない",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 const plan=PARTIES.find(x=>x.id==="darkThief");
 const specs=characterSpecs(PARTY_BUILDS[plan.id]);
 const a=buildScenario("cave",p,11,{partySpecs:specs});
 const b=buildScenario("cave",p,11,{partySpecs:specs});
 const changed=applyIndividualBuild(b,plan,"individual-right");
 assert.equal(changed.initialSpentSP,changed.spentSP);
 for(let i=0;i<5;i++){
  assert.deepEqual(a.state.roster[i].equip,b.state.roster[i].equip);
  if(i!==plan.at){
   assert.deepEqual(a.roster.getTreeState(a.state.roster[i]),
     b.roster.getTreeState(b.state.roster[i]));
  }
 }
 assert.notDeepEqual(changed.exclusiveRanks,a.roster.getTreeState(a.state.roster[plan.at]).exclusiveRanks);
});

test("汎用ツリー変更は枠の実候補から選択し、SPを超えず、合法な習得を保つ",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 for(const plan of PARTIES){
  const s=buildScenario("cave",p,15,{partySpecs:characterSpecs(PARTY_BUILDS[plan.id])});
  const info=applyIndividualBuild(s,plan,"general-focus");
  assert.ok(info.spentSP<=info.totalSP);
  assert.ok(info.spentSP>0);
  assert.equal(info.generalSlots[plan.slot].treeId,plan.tree);
  const c=s.state.roster[plan.at],tree=data.getGeneralTree(plan.tree);
  const ranks=s.roster.getTreeState(c).general[plan.slot].ranks;
  assert.ok(Object.values(ranks).some(x=>x>0));
  for(const node of tree.nodes){
   if(!ranks[node.id])continue;
   assert.ok(node.prerequisites.every(q=>(ranks[q.nodeId]||0)>=q.minRank));
   if(node.exclusiveGroup)assert.equal(tree.nodes.filter(n=>n.exclusiveGroup===node.exclusiveGroup&&(ranks[n.id]||0)>0).length,1);
  }
 }
});

test("測定は固定seedで再現可能・失敗時の確定報酬なし",()=>{
 const a=measureBuild("monkNoPriest","spirit-extra","general-focus",3);
 const b=measureBuild("monkNoPriest","spirit-extra","general-focus",3);
 assert.deepEqual(a,b);
 assert.equal(a.clear+a.fail,3);
 assert.equal(a.lootLeak,0);
 assert.equal(a.fail,Object.values(a.failures).reduce((x,y)=>x+y,0));
 assert.ok(a.immuneHits>0,"physical hits should be immune under extra spirit");
 assert.equal(PARTIES.length,4);
 assert.equal(TRAITS.length,6);
 assert.equal(BUILDS.length,3);
 const r=runStudy(1);
 assert.equal(r.rows.length,72);
 assert.ok(r.rows.every(x=>x.lootLeak===0));
 assert.throws(()=>measureBuild("bogus","native","standard",1),RangeError);
});

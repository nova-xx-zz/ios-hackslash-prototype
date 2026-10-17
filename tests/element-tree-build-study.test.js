"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {PARTY_BUILDS,characterSpecs}=require("../tools/basic-job-build-study.js");
const {PARTY,ELEMENT,BRANCH,GEAR,measureBuild,runStudy}=require("../tools/element-tree-build-study.js");
const {data}=require("../tools/lib/sim.js");

test("属性の対照実験は既存敵の原本を変更しない: 火は氷弱点、闇は聖弱点",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 const party=characterSpecs(PARTY_BUILDS.darkThief);
 const factory=element=>buildScenario("cave",p,11,{partySpecs:party,enemyElement:element});
 const original=factory("native");
 const fire=factory("火");
 const dark=factory("闇");
 const nativeEnemy=data.getEnemyTemplate("rock_golem");
 assert.ok(nativeEnemy);
 const e=fire.runner.startBattle(fire.runner.startRun(0,"cave")).battle.enemies[0];
 assert.equal(e.element,"火");
 assert.equal(e.res.el.ice,1.5);
 assert.equal(e.res.el.fire,.5);
 const d=dark.runner.startBattle(dark.runner.startRun(0,"cave")).battle.enemies[0];
 assert.equal(d.element,"闇");
 assert.equal(d.res.el.holy,1.5);
 assert.equal(d.res.el.dark,.5);
 assert.equal(data.getEnemyTemplate("rock_golem").element,nativeEnemy.element);
 assert.equal(data.getDungeon("cave").pilotLateNormalFactor,.8);
 assert.equal(original.enemyElement,"native");
});

test("専用測定で異なる攻撃/防御ツリー分岐が、同SP・同装備で比較できる",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 for(const id of ["baseline","monkThief","darkThief"]){
  const args={partySpecs:characterSpecs(PARTY_BUILDS[id]),levelOverride:7};
  const left=buildScenario("cave",p,71,{...args,treeBranch:"left"});
  const right=buildScenario("cave",p,71,{...args,treeBranch:"right"});
  assert.deepEqual(left.state.roster.map(c=>c.equip),right.state.roster.map(c=>c.equip));
  let changed=0;
  for(let i=0;i<5;i++){
   const l=left.state.roster[i],r=right.state.roster[i];
   assert.equal(left.roster.totalSpentSp(l),right.roster.totalSpentSp(r));
   assert.ok(left.roster.availableSp(l)>=0&&right.roster.availableSp(r)>=0);
   const ls=left.roster.getTreeState(l).exclusiveRanks;
   const rs=right.roster.getTreeState(r).exclusiveRanks;
   if(JSON.stringify(ls)!==JSON.stringify(rs))changed++;
   const tree=right.roster.getExclusiveTree(r);
   for(const n of tree.nodes){
    if(!rs[n.id])continue;
    assert.ok(!n.reqLevel||n.reqLevel<=r.level);
    assert.ok(n.prerequisites.every(q=>(rs[q.nodeId]||0)>=q.minRank));
    if(n.exclusiveGroup)assert.equal(tree.nodes.filter(other=>other.exclusiveGroup===n.exclusiveGroup&&(rs[other.id]||0)>0).length,1);
   }
  }
  assert.ok(changed>0,"should actually compare skill tree branches for "+id);
 }
});

test("96個等の任意サンプルで再現・負け時報酬ゼロ・敵設定不変",()=>{
 const a=measureBuild("darkThief","光","right","standard",3);
 const b=measureBuild("darkThief","光","right","standard",3);
 assert.deepEqual(a,b);
 assert.equal(a.clear+a.fail,3);
 assert.equal(a.failedDropLeak,0);
 assert.equal(a.fail,Object.values(a.wipes).reduce((x,y)=>x+y,0));
 assert.ok(a.damageByElement&&a.damageByJob);
 assert.throws(()=>measureBuild("baseline","unsupported","left","standard",1),RangeError);
 assert.throws(()=>measureBuild("baseline","火","invalid","standard",1),RangeError);
 assert.deepEqual(PARTY.length,5);
 assert.deepEqual(ELEMENT.length,5);
 assert.deepEqual(BRANCH.length,2);
 assert.deepEqual(GEAR.length,2);
 const result=runStudy(1);
 assert.equal(result.rows.length,5*5*2*2);
 assert.ok(result.rows.every(x=>x.failedDropLeak===0));
});

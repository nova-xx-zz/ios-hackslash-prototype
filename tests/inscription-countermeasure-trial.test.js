"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const battle=require("../js/core/battle.js");
const {trialInscriptionAbilities}=require("../js/core/inscription-trial.js");
const {simulateCase,runStudy,BASIC_JOBS}=require("../tools/inscription-countermeasure-study.js");

const inscribed=(key)=>({slot:"accessory",trialInscription:key});
const from=(key,stats={atk:40,mag:10})=>
 trialInscriptionAbilities({acc1:inscribed(key)},stats)[0];

test("汎用3刻印は全職共通の装飾品枠から低威力の別種別/聖属性を付与できる",()=>{
 const neutral={};
 const targets={
  spirit:{res:{physical:0,magic:1}},
  ward:{res:{physical:1,magic:0}},
  undead:{res:{nonHoly:0,el:{holy:1.5}}},
 };
 const arcane=from("arcane"),force=from("force"),holy=from("holy");
 assert.equal(arcane.kind,"magic");
 assert.equal(force.kind,"physical");
 assert.equal(holy.kind,"physical");
 assert.equal(holy.element,"holy");
 assert.equal(battle.damageMult(arcane,null,targets.spirit),1);
 assert.equal(battle.damageMult(force,null,targets.ward),1);
 assert.equal(battle.damageMult(holy,"holy",targets.undead),1.5);
 assert.equal(battle.damageMult(holy,"holy",targets.spirit),0,
  "聖属性物理は物理無効を貫通してはいけない");
 assert.equal(battle.damageMult(arcane,null,targets.undead),0);
 assert.equal(battle.damageMult(force,null,targets.undead),0);
 assert.equal(arcane.mpCost,0);
 assert.equal(force.mpCost,0);
 assert.equal(holy.mpCost,0);
 assert.ok(arcane.power<3);
 assert.ok(Object.keys(neutral).length===0);
});

test("装飾品以外は不可、重複は増殖しない・通常装備は一切変更しない",()=>{
 const stats={atk:20,mag:10};
 const gear={main:{slot:"weapon",trialInscription:"arcane"},
   acc1:inscribed("arcane"),acc2:inscribed("arcane"),acc3:inscribed("holy")};
 const unchanged=JSON.stringify(gear);
 assert.deepEqual(trialInscriptionAbilities(null,stats),[]);
 assert.deepEqual(trialInscriptionAbilities({acc1:{slot:"accessory"}},stats),[]);
 assert.equal(trialInscriptionAbilities({acc1:gear.acc1,acc2:gear.acc2,acc3:gear.acc3},stats).length,2);
 assert.equal(JSON.stringify(gear),unchanged);
 assert.throws(()=>trialInscriptionAbilities({acc1:{slot:"weapon",trialInscription:"arcane"}},stats),/accessory/);
 for(const key of ["__proto__","constructor","paid_unlock"])
  assert.throws(()=>trialInscriptionAbilities({acc1:inscribed(key)},stats),/unknown/);
});

test("刻印技は同じステータスでも職業専用技より弱く設定する",()=>{
 const stats={atk:40,mag:10};
 const arcane=from("arcane",stats);
 const force=from("force",stats);
 const holy=from("holy",stats);
 const specialty={id:"job",kind:"physical",power:1.5,hits:1,mpCost:0,target:"single"};
 const enemy={hp:500,maxHp:500,atk:0,def:0,spd:0,alive:true,res:{}};
 const c={stats:{maxHp:100,maxMp:20,atk:40,mag:10,def:0,spd:10},hp:100,mp:20,alive:true};
 const env={stats:x=>x.stats,abilities:()=>[],mpCost:(_,a)=>a.mpCost,
  tier:()=>2,passives:()=>({critBonus:0,pierce:0,lifesteal:0,healBonus:0,dmgTakenMult:1}),
  atbRate:7,rng:{pick:xs=>xs[0],float:(a,b)=>(a+b)/2,chance:()=>false}};
 const party=[c],enemies=[enemy],battleState={enemies};
 assert.ok(battle.expectedValue(c,force,party,enemies,env,battleState)<
    battle.expectedValue(c,specialty,party,enemies,env,battleState));
 assert.ok(holy.power<force.power&&force.power<specialty.power);
 assert.ok(arcane.power>0);
});

test("実データと実戦闘AI: 一次職全6種で独立した物理・魔法・聖対策を試行",()=>{
 const output=runStudy(20261019);
 assert.equal(output.results.length,BASIC_JOBS.length*4);
 for(const row of output.results){
  const x=row.engraved;
  assert.equal(x.engravings.length,5);
  assert.ok(["victory","defeat","timeout"].includes(x.result));
  assert.ok(x.seconds>=0&&x.seconds<=300.1);
  assert.ok(x.enemyHpRemaining>=0);
  if(row.case!=="mixed"){
   assert.equal(row.baseline?.jobId,row.job);
   assert.ok(x.firstActions.every(a=>typeof a==="string"&&a.length>0));
  }
 }
 const soloWarrior=output.results.find(x=>x.job==="warrior"&&x.case==="spirit");
 assert.notEqual(soloWarrior.baseline.result,"victory",
  "戦士の物理だけではExtra霊体を倒せない");
 assert.ok(soloWarrior.engraved.enemyHpRemaining<=soloWarrior.baseline.enemyHpRemaining,
  "魔導の刻印で霊体への攻撃手段を失わない");
 assert.deepEqual(runStudy(20261019),output,"同seedの対策技は再現できる");
});

#!/usr/bin/env node
"use strict";
// Actual battle-core simulation of the isolated inscription proposal.
// Enemy resistances come from js/data.js, not stubbed paper-only tables.
const {createRng}=require("../js/core/rng.js");
const battle=require("../js/core/battle.js");
const sim=require("./lib/sim.js");
const equipment=require("../js/core/equipment.js");
const {trialInscriptionAbilities}=require("../js/core/inscription-trial.js");

const BASIC_JOBS=Object.freeze(["warrior","mage","priest","thief","monk","darkknight"]);
const CASES=Object.freeze([
 {id:"spirit",enemy:"mirage_spirit",engraving:"arcane",rationale:"physical zero -> magic"},
 {id:"ward",enemy:"ice_golem",engraving:"force",rationale:"magic zero -> physical"},
 {id:"undead",enemy:"skeleton",engraving:"holy",rationale:"nonHoly zero -> holy physical"},
 {id:"spirit_undead",enemy:"wight",engraving:"sanctify",rationale:"physical and nonHoly zero -> holy magic"},
]);

function simulateCase(jobId,enemyKeys,engravings,seed=20261019){
 if(!BASIC_JOBS.includes(jobId)||!Array.isArray(enemyKeys)||!enemyKeys.length||enemyKeys.length>5||
    !Array.isArray(engravings)||engravings.length!==5)throw new TypeError("invalid trial case");
 const rng=createRng(seed);
 const members=Array.from({length:5},(_,i)=>sim.makeMember(
  {job:jobId,race:"human"},20,i,{tree:true,gear:{rarity:"n",plus:2,level:7}}));
 for(let i=0;i<members.length;i++){
  const c=members[i];
  // The N engraving accessory REPLACES the current accessory (rather than
  // granting a free ability on top of its stats/series bonuses). Its minimal
  // HP+1 is a mock crafting output, NOT a live item/drop or final price.
  if(engravings[i]){
    c.equip.acc1={slot:"accessory",type:"amulet",stats:{hp:1},plus:0,
      rarity:"n",trialInscription:engravings[i]};
    c.set=equipment.setBonusTotals(c.equip,sim.data.ITEM_SERIES,
      sim.data.getUniqueItem,sim.data.itemOptionEffect);
  }
 }
 const env=sim.makeEnv(rng);
 const baseAbilities=env.abilities,abilityCache=new WeakMap();
 env.abilities=c=>{
  if(!abilityCache.has(c))
    abilityCache.set(c,baseAbilities(c).concat(trialInscriptionAbilities(c.equip,env.stats(c))));
  return abilityCache.get(c);
 };
 for(const c of members){const stats=env.stats(c);c.hp=stats.maxHp;c.mp=stats.maxMp;}
 const enemies=enemyKeys.map((key,i)=>{
  const t=sim.data.getEnemyTemplate(key);
  if(!t)throw new RangeError("unknown real enemy "+key);
  const e=sim.data.makeEnemy(t,2,false,1,false,"extra");
  return {...e,id:"e"+i,atb:0,alive:true};
 });
 const encounter={enemies};
 const firstActions=members.map(c=>battle.chooseAction(c,members,env,enemies,encounter).id);
 const result=battle.simulate(encounter,members,env,{maxSeconds:300});
 return {jobId,enemyKeys,engravings,seed,result:result.result,seconds:Math.round(result.seconds*100)/100,
  firstActions,enemyHpRemaining:enemies.reduce((n,e)=>n+Math.max(0,e.hp),0),
  survivors:members.filter(c=>c.alive).length};
}
function runStudy(seed=20261019){
 const results=[];
 for(const job of BASIC_JOBS)for(const scenario of CASES){
   const blank=Array(5).fill(null);
   const equipped=Array(5).fill(scenario.engraving);
   results.push({job,case:scenario.id,baseline:simulateCase(job,[scenario.enemy],blank,seed),
      engraved:simulateCase(job,[scenario.enemy],equipped,seed)});
 }
 // A mixed encounter verifies that players can distribute their accessory
 // routes among 5 same-job characters rather than changing job compositions.
 const mix=["mirage_spirit","ice_golem","skeleton","wight"];
 for(const job of BASIC_JOBS)
  results.push({job,case:"mixed",engraved:simulateCase(job,mix,["arcane","force","holy","sanctify","sanctify"],seed)});
 return {version:1,seed,level:20,mode:"extra",kind:"single-battle-isolated",results};
}
if(require.main===module){
 const result=runStudy();
 for(const r of result.results)console.log(
  [r.job,r.case,r.baseline?.result||"n/a",r.engraved.result,
   r.engraved.seconds,r.engraved.survivors].join(" "));
 console.log("INSCRIPTION_STUDY_JSON="+JSON.stringify(result));
}
module.exports={simulateCase,runStudy,BASIC_JOBS,CASES};

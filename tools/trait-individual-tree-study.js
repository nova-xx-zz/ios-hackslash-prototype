#!/usr/bin/env node
"use strict";
/*
 * Swordcrest: actual game trait multipliers + real legal tree nodes/slots.
 * Native cave untouched; trait overlays are hypothetical scenarios applied
 * only to temporary enemy instances created by existing makeEnemy().
 * No production combat, economy, or save changes.
 */
const {buildScenario,PROFILES}=require("./dungeon-balance.js");
const {PARTY_BUILDS,characterSpecs}=require("./basic-job-build-study.js");
const {settleDrops}=require("../js/core/rewards.js");
const {data}=require("./lib/sim.js");

const PARTIES=Object.freeze([
  {id:"baseline",at:2,slot:"slot3",tree:"arcane"},
  {id:"monkThief",at:1,slot:"slot1",tree:"speed"},
  {id:"darkThief",at:1,slot:"slot2",tree:"vampiric"},
  {id:"monkNoPriest",at:1,slot:"slot1",tree:"speed"},
]);
const TRAITS=Object.freeze([
  {id:"native",trait:"native",mode:"normal"},
  {id:"spirit-normal",trait:"spirit",mode:"normal"},
  {id:"spirit-extra",trait:"spirit",mode:"extra"},
  {id:"ward-extra",trait:"ward",mode:"extra"},
  {id:"armored-extra",trait:"armored",mode:"extra"},
  {id:"undead-extra",trait:"undead",mode:"extra"},
]);
const BUILDS=Object.freeze(["standard","individual-right","general-focus"]);
const SEED=202610181;
const round=n=>Math.round(n*100)/100;

function applyIndividualBuild(s,plan,build){
  const c=s.state.roster[plan.at],roster=s.roster;
  const startSpent=roster.totalSpentSp(c);
  if(build==="individual-right"){
    const st=roster.getTreeState(c),tree=roster.getExclusiveTree(c);
    const active=tree.nodes.find(n=>n.exclusiveGroup&&(st.exclusiveRanks[n.id]||0)>0);
    if(!active)throw Error("no eligible exclusive branch for "+c.job);
    const choice=tree.nodes.filter(n=>n.exclusiveGroup===active.exclusiveGroup&&n.id!==active.id).at(-1);
    if(!choice||choice.costByRank[0]!==active.costByRank[0]||
      (choice.reqLevel&&c.level<choice.reqLevel)||
      !choice.prerequisites.every(p=>(st.exclusiveRanks[p.nodeId]||0)>=p.minRank))
      throw Error("individual branch switch not legal");
    delete st.exclusiveRanks[active.id];st.exclusiveRanks[choice.id]=1;
    if(startSpent!==roster.totalSpentSp(c))throw Error("SP changed by one-member branch");
  }else if(build==="general-focus"){
    const st=roster.getTreeState(c);
    st.exclusiveRanks={};
    for(const slot of data.GENERAL_SLOTS)st.general[slot.key].ranks={};
    const desired=st.general[plan.slot];
    if(desired.treeId!==plan.tree){
      if(!roster.swapGeneralSlot(c,plan.slot))throw Error("slot cannot switch");
    }
    if(st.general[plan.slot].treeId!==plan.tree)throw Error("unexpected slot tree");
    const primary=data.getGeneralTree(plan.tree);
    const target=st.general[plan.slot].ranks;
    // Fund two legitimate early nodes from the same Lv7 SP pool.
    for(const node of primary.nodes.slice(0,3)){
      if(roster.canAcquireNode(c,primary,target,node))roster.acquireNode(c,primary,target,node);
    }
    // Spend remaining SP in the exclusive tree where legal; then remaining
    // general defaults, without duplicating nodes or overriding prereqs.
    const ex=roster.getExclusiveTree(c);
    for(const node of ex.nodes){
      if(roster.canAcquireNode(c,ex,st.exclusiveRanks,node))
        roster.acquireNode(c,ex,st.exclusiveRanks,node);
    }
    for(const slot of data.GENERAL_SLOTS){
      if(slot.key===plan.slot)continue;
      const tree=data.getGeneralTree(st.general[slot.key].treeId);
      for(const node of tree.nodes){
        if(roster.canAcquireNode(c,tree,st.general[slot.key].ranks,node))
          roster.acquireNode(c,tree,st.general[slot.key].ranks,node);
      }
    }
    if(roster.totalSpentSp(c)>roster.totalSp(c))throw Error("SP budget exceeded");
    if(!Object.values(st.general[plan.slot].ranks).some(Boolean))throw Error("general tree acquired nothing");
  }else if(build!=="standard")throw RangeError("invalid build");
  // Recompute MaxHP/MP after the in-memory tree change, mirroring start-run.
  const stats=roster.computeStats(c);
  c.hp=stats.maxHp;c.mp=stats.maxMp;
  return {
    targetJob:c.job,slot:build==="general-focus"?plan.slot:null,
    totalSP:roster.totalSp(c),spentSP:roster.totalSpentSp(c),
    initialSpentSP:startSpent,
    exclusiveRanks:{...roster.getTreeState(c).exclusiveRanks},
    generalSlots:Object.fromEntries(data.GENERAL_SLOTS.map(sl=>[
      sl.key,{treeId:roster.getTreeState(c).general[sl.key].treeId,
        ranks:{...roster.getTreeState(c).general[sl.key].ranks}}
    ])),
    stats:{atk:stats.atk,def:stats.def,mag:stats.mag,spd:stats.spd,hp:stats.maxHp,mp:stats.maxMp},
  };
}
function measureBuild(partyId,traitId,build,trials=60){
 const plan=PARTIES.find(x=>x.id===partyId);
 const tc=TRAITS.find(x=>x.id===traitId);
 if(!plan||!tc||!BUILDS.includes(build)||!Number.isInteger(trials)||trials<1||trials>500)throw RangeError("invalid case");
 const profile=PROFILES.find(x=>x.id==="recommended");
 const s=buildScenario("cave",profile,SEED,{
   partySpecs:characterSpecs(PARTY_BUILDS[partyId]),
   enemyTrait:tc.trait,enemyTraitMode:tc.mode,
 });
 const info=applyIndividualBuild(s,plan,build);
 const dungeon={...s.d,pilotLateNormalFactor:1};
 let clear=0,fail=0,sec=0,returned=0,stone=0,bossReached=0,lootLeak=0;
 const failures={1:0,2:0,3:0,4:0,5:0,boss:0};
 const jobDamage={};const skillDamage={};let immuneHits=0,totalHits=0;
 for(let i=0;i<trials;i++){
   const battles=[];
   const out=s.runner.computeOfflineRun(dungeon,0,{
     seed:SEED+i,onBattleFinish:b=>battles.push(b),
     onBattleStep(step){
       for(const ev of step.events){
         if(ev.type!=="damage"||!ev.actor)continue;
         const job=ev.actor.job;jobDamage[job]=(jobDamage[job]||0)+ev.dmg;
         const skill=ev.ability && ev.ability.id||"attack";
         skillDamage[skill]=(skillDamage[skill]||0)+ev.dmg;
         totalHits++;
         if(ev.immune)immuneHits++;
       }
     },
   });
   sec+=out.seconds;
   if(battles.some(b=>b.boss))bossReached++;
   if(out.cleared){
     clear++;
     const rewards=settleDrops(out.drops,{enabled:true,rarities:new Set(["n"])});
     returned+=rewards.kept.length;stone+=rewards.materialGained;
   }else{
     fail++;lootLeak+=out.drops.length;
     const last=battles.at(-1);if(!last||last.won)throw Error("no final wipe");
     failures[last.boss?"boss":String(last.floor)]++;
   }
 }
 return {partyId,traitId,build,trials,clear,fail,clearPct:round(clear*100/trials),
   avgSec:round(sec/trials),avgKept:round(returned/trials),avgStones:round(stone/trials),
   bossReached,lootLeak,failures,immuneHits,totalHits,jobDamage,skillDamage,info};
}
function runStudy(trials=60){
 const rows=[];
 for(const p of PARTIES)for(const trait of TRAITS)for(const b of BUILDS)
   rows.push(measureBuild(p.id,trait.id,b,trials));
 return {version:1,trials,seed:SEED,rows,
   scope:"Native cave or hypothetical all-enemy existing trait overlay; extra trait strength is not an actual Extra dungeon."};
}
if(require.main===module){
 const arg=process.argv.find(x=>x.startsWith("--trials="));
 const r=runStudy(arg?Number(arg.split("=")[1]):60);
 console.log("Trait matchup vs individual skill-tree branch and general tree priorities");
 console.log("party trait build win% sec immHits");
 for(const x of r.rows)console.log([x.partyId,x.traitId,x.build,x.clearPct,x.avgSec,x.immuneHits].join(" "));
 console.log("TRAIT_TREE_STUDY_JSON="+JSON.stringify(r));
}
module.exports={PARTIES,TRAITS,BUILDS,SEED,applyIndividualBuild,measureBuild,runStudy};

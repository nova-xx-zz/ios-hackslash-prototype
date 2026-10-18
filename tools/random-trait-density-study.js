#!/usr/bin/env node
"use strict";
// Compare 1–3 randomized Normal traits against the unchanged real cave.
// The decorator is passed only to an in-memory runner, not live game deps.
const {buildScenario,PROFILES}=require("./dungeon-balance.js");
const {PARTY_BUILDS,characterSpecs}=require("./basic-job-build-study.js");
const {settleDrops}=require("../js/core/rewards.js");
const PARTIES=["baseline","twoPriestThief","monkThief","darkThief","monkNoPriest"];
const SEED=2026101805;
const round=n=>Math.round(n*100)/100;
function measure(partyId,randomTraits,trials=100,dungeonId="cave"){
 if(!PARTIES.includes(partyId)||!["plains","forest","cave"].includes(dungeonId)||typeof randomTraits!=="boolean"||!Number.isInteger(trials)||trials<1||trials>1000)
   throw RangeError("invalid comparison");
 const s=buildScenario(dungeonId,PROFILES.find(x=>x.id==="recommended"),SEED,{
   partySpecs:characterSpecs(PARTY_BUILDS[partyId]),randomTraitEnemies:randomTraits});
 const dungeon={...s.d,pilotLateNormalFactor:1};
 const counts={zero:0,one:0,two:0,three:0,boss:0,rare:0,
   totalTraits:{zero:0,one:0,two:0,three:0,four:0,five:0},
   nativeOverThree:0,
   types:{spirit:0,ward:0,armored:0,undead:0}};
 let clear=0,seconds=0,failedLoot=0,kept=0,stones=0,nonBossBattles=0;
 for(let i=0;i<trials;i++){
   const result=s.runner.computeOfflineRun(dungeon,0,{
     seed:SEED+i,onBattleFinish:b=>{
       if(b.boss){counts.boss++;if(b.enemies.some(e=>e.pilotAddedTrait))throw Error("boss decorated");return;}
       nonBossBattles++;
       const traitEnemies=b.enemies.filter(e=>e.pilotAddedTrait);
       const nativeTraits=b.enemies.filter(e=>Array.isArray(e.traits)&&e.traits.length>0 && !e.pilotAddedTrait && !e.isBoss).length;
       const total=nativeTraits+traitEnemies.length;
       if(total>3){counts.nativeOverThree++;if(randomTraits)throw Error("pilot exceeded trait cap");}
       counts.totalTraits[["zero","one","two","three","four","five"][total]]++;
       const n=traitEnemies.length;
       if(n>3||n>b.enemies.length)throw Error("invalid trait count");
       counts[["zero","one","two","three"][n]]++;
       for(const e of traitEnemies)counts.types[e.pilotAddedTrait]++;
       counts.rare+=b.enemies.filter(e=>e.isRare).length;
     }
   });
   seconds+=result.seconds;
   if(result.cleared){
     clear++;
     const banked=settleDrops(result.drops,{enabled:true,rarities:new Set(["n"])});
     kept+=banked.kept.length;stones+=banked.materialGained;
   }else failedLoot+=result.drops.length;
 }
 if(failedLoot)throw Error("lost drops leaked");
 return {dungeonId,partyId,randomTraits,trials,clear,clearPct:round(100*clear/trials),
   avgSeconds:round(seconds/trials),avgKept:round(kept/trials),
   avgStones:round(stones/trials),nonBossBattles,counts,failedLoot};
}
function runStudy(trials=100){
 const results=[];
 for(const p of PARTIES)for(const opt of [false,true])results.push(measure(p,opt,trials));
 return {version:1,trials,seed:SEED,results};
}
function runFloorStudy(trials=100){
 const results=[];
 for(const dungeonId of ["plains","forest","cave"])
  for(const enabled of [false,true])results.push(measure("baseline",enabled,trials,dungeonId));
 return {version:1,comparison:"floor3-and-5",trials,seed:SEED,results};
}
if(require.main===module){
 const t=process.argv.find(s=>s.startsWith("--trials="));
 const x=process.argv.includes("--floor-compare")
   ?runFloorStudy(t?Number(t.split("=")[1]):100)
   :runStudy(t?Number(t.split("=")[1]):100);
 for(const r of x.results)console.log([r.dungeonId,r.partyId,r.randomTraits?"random-1-3":"native",r.clearPct,r.avgSeconds,
   r.nonBossBattles,r.counts.one,r.counts.two,r.counts.three].join(" "));
 console.log("RANDOM_TRAIT_STUDY_JSON="+JSON.stringify(x));
}
module.exports={measure,runStudy,runFloorStudy,PARTIES,SEED};

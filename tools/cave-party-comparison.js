#!/usr/bin/env node
"use strict";
// Compare Lv7 party compositions using the real floor-pilot run/battle/drop core.
// No production/game configuration changes. Seeds are shared, but RNG consumption
// can diverge between different job actions and lockpick results.
const {buildScenario,PROFILES}=require("./dungeon-balance.js");
const {settleDrops}=require("../js/core/rewards.js");
const {STARTER_PARTY}=require("./lib/sim.js");
const NORMAL_SEED=91027000;
const PROFILES_TO_COMPARE=Object.freeze(["recommended","reinforced","refined"]);
const CAVE_FACTORS=Object.freeze([1,0.8]);
const BUILDS=Object.freeze({
  baseline: {label:"戦士2・魔法使い2・僧侶1", jobs:["warrior","warrior","mage","mage","priest"]},
  thiefOnePriest: {label:"戦士1・魔法使い2・盗賊1・僧侶1",jobs:["warrior","thief","mage","mage","priest"]},
  userProposal: {label:"戦士1・魔法使い1・盗賊1・僧侶2",jobs:["warrior","thief","mage","priest","priest"]},
  twoPriestsNoThief: {label:"戦士2・魔法使い1・僧侶2",jobs:["warrior","warrior","mage","priest","priest"]},
});
const DISASSEMBLE={enabled:true,rarities:new Set(["n"])};

function specsFor(id) {
  const build=BUILDS[id];
  if(!build)throw new RangeError("unknown party");
  const sameRaces=STARTER_PARTY.map(m=>m.race);
  return build.jobs.map((job,i)=>({job,race:sameRaces[i]}));
}
function measureParty(id,profileId,factor,trials=240) {
  if(!BUILDS[id]||!PROFILES_TO_COMPARE.includes(profileId)||!CAVE_FACTORS.includes(factor)||
    !Number.isInteger(trials)||trials<1||trials>1500)throw new RangeError("invalid measurement");
  const profile=PROFILES.find(p=>p.id===profileId);
  const setup=buildScenario("cave",profile,NORMAL_SEED,{partySpecs:specsFor(id)});
  const dungeon={...setup.d,pilotLateNormalFactor:factor};
  const failedAt={"1":0,"2":0,"3":0,"4":0,"5":0,boss:0};
  const boss={reached:0,won:0};
  const total={attempts:trials,clear:0,seconds:0,confirmedDrops:0,kept:0,stones:0,
    lockedFound:0,lockedAttempt:0,lockedSuccess:0,failLeak:0,
    bossEndHp:0,bossEndMp:0,priestEndMp:0};
  const dungeonTrial=require("../js/core/dungeon-trial.js");
  const orig=dungeonTrial.rollPilotEvent;
  // Observation only. We never alter chance, item rolls or random stream.
  dungeonTrial.rollPilotEvent=(rng,chance,rollOne)=>{
    const ev=orig(rng,chance,rollOne);
    if(ev && ev.kind==="lockedTreasure"){
      total.lockedFound++;
      if(ev.attempted)total.lockedAttempt++;
      if(ev.success)total.lockedSuccess++;
    }
    return ev;
  };
  try{
    for(let i=0;i<trials;i++){
      const trace=[];
      const result=setup.runner.computeOfflineRun(dungeon,0,{
        seed:NORMAL_SEED+i,
        onBattleFinish:(battle)=>trace.push(battle),
      });
      total.seconds+=result.seconds;
      const bossEntry=trace.find(x=>x.boss);
      if(bossEntry){
        boss.reached++;
        if(bossEntry.won)boss.won++;
        total.bossEndHp+=bossEntry.hp;
        total.bossEndMp+=bossEntry.mp;
      }
      if(result.cleared){
        total.clear++;
        const settled=settleDrops(result.drops,DISASSEMBLE);
        total.confirmedDrops+=result.drops.length;
        total.kept+=settled.kept.length;
        total.stones+=settled.materialGained;
      }else{
        total.failLeak+=result.drops.length;
        const last=trace.at(-1);
        if(!last||last.won)throw Error("failed run has no terminal battle");
        if(last.boss)failedAt.boss++;else failedAt[last.floor]++;
      }
    }
  }finally{dungeonTrial.rollPilotEvent=orig;}
  const round=(x)=>Math.round(x*100)/100;
  return {id,party:BUILDS[id].jobs,profileId,factor,trials,cleared:total.clear,
    clearPct:round(total.clear*100/trials),
    bossReached:boss.reached,bossWon:boss.won,
    failedAt,lockedFound:total.lockedFound,lockedAttempt:total.lockedAttempt,
    lockedSuccess:total.lockedSuccess,
    avgSec:round(total.seconds/trials),
    confirmedDropsPerTry:round(total.confirmedDrops/trials),
    keptPerTry:round(total.kept/trials),
    stonesPerTry:round(total.stones/trials),
    avgTotalMpAfterBoss:boss.reached?round(total.bossEndMp/boss.reached):null,
    failedDropsKept:total.failLeak};
}
function runComparison(trials=240){
  const results=[];
  for(const factor of CAVE_FACTORS)for(const profileId of PROFILES_TO_COMPARE)
    for(const id of Object.keys(BUILDS))results.push(measureParty(id,profileId,factor,trials));
  return {version:1,trials,seedStart:NORMAL_SEED,results};
}
if(require.main===module){
  const input=process.argv.find(x=>x.startsWith("--trials="));
  const result=runComparison(input?Number(input.split("=")[1]):240);
  console.log("Cave 5F party composition comparison; job/races preserved across slots; normal difficulty");
  console.log("Build includes 5 Lv7 initial jobs, identical equipment profile and seed ranges");
  for(const r of result.results)
    console.log([r.factor,r.profileId,r.id,r.clearPct,r.bossReached,r.failedAt["4"],r.failedAt["5"],r.failedAt.boss,
      r.lockedSuccess+"/"+r.lockedFound,r.avgSec,r.keptPerTry].join(" "));
  console.log("PARTY_COMPARISON_JSON="+JSON.stringify(result));
}
module.exports={BUILDS,PROFILES_TO_COMPARE,CAVE_FACTORS,specsFor,measureParty,runComparison,NORMAL_SEED};

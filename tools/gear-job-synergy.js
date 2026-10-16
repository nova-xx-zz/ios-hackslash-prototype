#!/usr/bin/env node
"use strict";
// Diagnostics-only: live battles + five-job configurations + real equipment bonus.
// Early milestone is an explicitly hypothetical stat overlay (never applied in-game).
const { buildScenario, PROFILES, itemStatsEarlyMilestones } = require("./dungeon-balance.js");
const { BUILDS, specsFor } = require("./cave-party-comparison.js");
const { data } = require("./lib/sim.js");
const SEED_BASE = 92710000;
const PARTY_IDS = Object.freeze(["baseline", "thiefOnePriest", "userProposal", "twoPriestsNoThief"]);
const GEAR = Object.freeze(["recommended", "reinforced", "refined"]);
const FORMULAS = Object.freeze(["current", "earlyMilestones"]);
const round = x => Math.round(x*100)/100;
function summarize(stats) {
  return stats.map(x=>({job:x.job,atk:x.atk,def:x.def,maxHp:x.maxHp,maxMp:x.maxMp,mag:x.mag,spd:x.spd}));
}
function evaluate(partyId, gearId, formula, trials=120, factor=1) {
  if(!PARTY_IDS.includes(partyId)||!GEAR.includes(gearId)||!FORMULAS.includes(formula)||
     ![1,.8].includes(factor)||!Number.isInteger(trials)||trials<1||trials>1500)throw new RangeError("bad inputs");
  const profile=PROFILES.find(p=>p.id===gearId);
  const s=buildScenario("cave",profile,SEED_BASE,{partySpecs:specsFor(partyId),enhancePreview:formula});
  const d={...s.d,pilotLateNormalFactor:factor};
  const statsBefore=s.state.roster.map(c=>Object.assign({job:c.job},s.roster.computeStats(c)));
  const counters={clear:0,failed:0,bossReached:0,bossWon:0,
    priestHealEvents:0,priestHealCasts:0,priestRawHeal:0,priestMpConsumed:0,
    allMpConsumed:0,priestEndMpAtBoss:0,partyEndMpAtBoss:0,
    damageFromEnemy:0,damagingEnemyHits:0,
    failAt:{1:0,2:0,3:0,4:0,5:0,boss:0},zeroFailedDrops:true};
  for(let i=0;i<trials;i++){
    const trace=[];
    // Trace only the comparable no-extra-refinement baseline. Step observer is optional
    // and does not alter battle RNG, actions, HP, MP or loot.
    const capture=(formula==="current"&&gearId==="recommended");
    const out=s.runner.computeOfflineRun(d,0,{
      seed:SEED_BASE+i,
      onBattleFinish:x=>trace.push(x),
      onBattleStep:capture?step=>{
        const healed=new Set();
        for(const e of step.events){
          if(e.type==="heal"&&e.actor.job==="priest"){
            counters.priestHealEvents++;
            counters.priestRawHeal+=e.amount; // raw value: may include overhealing
            healed.add(e.actor.id);
          }
          if(e.type==="enemyAttack"){
            counters.damageFromEnemy+=e.dmg;
            counters.damagingEnemyHits++;
          }
        }
        counters.priestHealCasts+=healed.size;
        for(let k=0;k<step.party.length;k++){
          const cost=Math.max(0,step.beforeMp[k]-step.party[k].mp);
          counters.allMpConsumed+=cost;
          if(step.party[k].job==="priest")counters.priestMpConsumed+=cost;
        }
      }:undefined,
    });
    if(out.cleared)counters.clear++;
    else {
      counters.failed++;
      if(out.drops.length)counters.zeroFailedDrops=false;
      const last=trace.at(-1);
      if(!last||last.won)throw Error("missing wipe location");
      if(last.boss)counters.failAt.boss++;else counters.failAt[last.floor]++;
    }
    const b=trace.find(x=>x.boss);
    if(b){
      counters.bossReached++;
      if(b.won)counters.bossWon++;
      counters.partyEndMpAtBoss+=b.mp;
      // Note: party after boss, not on arrival. Per-healer MP cannot be
      // reconstructed from onBattleFinish's aggregate fields.
    }
  }
  return {partyId,gearId,formula,factor,trials,clear:counters.clear,
    clearPct:round(100*counters.clear/trials),
    failures:counters.failed,failAt:counters.failAt,
    bossReached:counters.bossReached, bossWon:counters.bossWon,
    stats:summarize(statsBefore),
    avgMpAfterBoss:counters.bossReached?round(counters.partyEndMpAtBoss/counters.bossReached):null,
    priestHealEvents:counters.priestHealEvents,
    priestHealCasts:counters.priestHealCasts,
    priestRawHeal:counters.priestRawHeal,
    priestMpConsumed:counters.priestMpConsumed,
    allMpConsumed:counters.allMpConsumed,
    enemyHits:counters.damagingEnemyHits,
    enemyDamage:counters.damageFromEnemy,
    zeroFailedDrops:counters.zeroFailedDrops};
}
function runStudy(trials=120){
 const rows=[];
 for(const id of PARTY_IDS)for(const gear of GEAR)for(const formula of FORMULAS)
   rows.push(evaluate(id,gear,formula,trials,1));
 return {version:1,trials,rows};
}
if(require.main===module){
 const input=process.argv.find(x=>x.startsWith("--trials="));
 const out=runStudy(input?Number(input.split("=")[1]):120);
 console.log("CAVE_GEAR_JOB_V1; 5F original difficulty; actual battle simulator");
 console.log("party gear formula clear% priestHealCasts rawHeal priestMPSpends");
 for(const x of out.rows)console.log([x.partyId,x.gearId,x.formula,x.clearPct,
   x.priestHealCasts,x.priestRawHeal,x.priestMpConsumed].join(" "));
 console.log("CAVE_GEAR_JOB_JSON="+JSON.stringify(out));
}
module.exports={evaluate,runStudy,PARTY_IDS,GEAR,FORMULAS,SEED_BASE};

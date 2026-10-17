#!/usr/bin/env node
"use strict";
/*
 * Stone economy / enhancement requirements using the REAL rewards, inventory
 * settlement, rarity table, enhancement success, spend and pity from the game.
 * Run: node tools/enhancement-economy.js --trials=120
 * No changes to production success rates, drops, power or save files.
 */
const { data } = require("./lib/sim.js");
const { buildScenario, PROFILES } = require("./dungeon-balance.js");
const { specsFor } = require("./cave-party-comparison.js");
const enhance = require("../js/core/enhance.js");
const { settleDrops } = require("../js/core/rewards.js");

const CONFIGS = Object.freeze([
  {id:"plains-start", dungeonId:"plains", partyId:"baseline", profileId:"recommended", lateFactor:1},
  {id:"forest-start", dungeonId:"forest", partyId:"baseline", profileId:"recommended", lateFactor:1},
  {id:"cave-start", dungeonId:"cave", partyId:"baseline", profileId:"recommended", lateFactor:1},
  {id:"cave-designed", dungeonId:"cave", partyId:"userProposal", profileId:"recommended", lateFactor:1},
  {id:"cave-designed-plus4", dungeonId:"cave", partyId:"userProposal", profileId:"reinforced", lateFactor:1},
]);
const FILTERS = Object.freeze([
  {id:"n", rarities:["n"]},
  {id:"default-n-r", rarities:["n","r"]},
]);
const TARGETS = Object.freeze([4,8,12,50,99]);
const BASES = Object.freeze([0,1]);
const SEED_BASE=10170000;
const round=(x)=>Math.round(x*100)/100;

function expectedStageCost(rarity,plus) {
  const rules=data.ENHANCE_RULES;
  const p=enhance.successRate(rules,rarity,plus);
  const c=enhance.cost(rules,rarity,plus);
  if(!(p>0&&p<=1)||!(c>0))throw new RangeError("invalid enhancement parameters");
  const threshold=enhance.pityThreshold(rules,rarity,plus);
  // Every failure adds c to item.pity. Before each attempt pity >= threshold
  // means guaranteed success. Thus k=floor? exactly ceil(threshold/c) failures,
  // followed by one forced attempt, unless success occurs earlier.
  const failuresToPity=Math.ceil(threshold/c);
  const q=1-p;
  const attempts=(1-Math.pow(q,failuresToPity+1))/p;
  return {rarity,plus,successRate:p,costPerTry:c,pityThreshold:threshold,
    failuresToPity,expectedAttempts:attempts,expectedStones:c*attempts};
}

function enhancementCosts(rarity,from,to){
  if(!data.RARITIES.some(x=>x.key===rarity)||!Number.isInteger(from)||!Number.isInteger(to)||
     from<0||from>=to||to>data.ENHANCE_MAX_PLUS)throw new RangeError("invalid enhancement path");
  let cost=0,tries=0,minCost=0;
  for(let n=from;n<to;n++){
    const e=expectedStageCost(rarity,n);
    cost+=e.expectedStones;
    tries+=e.expectedAttempts;
    minCost+=e.costPerTry;
  }
  return {rarity,from,to,expectedStones:round(cost),expectedAttempts:round(tries),bestCaseStones:minCost};
}

function gatherEconomy(config, trials=120) {
  if(!CONFIGS.some(x=>x.id===config.id)||!Number.isInteger(trials)||trials<1||trials>1500)throw new RangeError("invalid case");
  const profile=PROFILES.find(x=>x.id===config.profileId);
  const opts=config.dungeonId==="cave"?{partySpecs:specsFor(config.partyId)}:{};
  const scenario=buildScenario(config.dungeonId,profile,SEED_BASE,opts);
  const dungeon={...scenario.d};
  if(config.dungeonId==="cave")dungeon.pilotLateNormalFactor=config.lateFactor;
  // Equipment slot count comes from real job/race equipment restrictions.
  const worn = scenario.state.roster.flatMap(ch => Object.values(ch.equip || {}).filter(Boolean));
  const equipmentPlan = {
    equippedPieces: worn.length,
    rarityCounts: worn.reduce((acc,item)=>(acc[item.rarity]=(acc[item.rarity]||0)+1,acc),{}),
    expectedStonesToUpgradeAll: Object.fromEntries([4,8,12].map(to=>[
      String(to), round(worn.reduce((sum,item)=>
        sum+(item.plus>=to?0:enhancementCosts(item.rarity,item.plus,to).expectedStones),0))
    ]))
  };
  const counts=Object.fromEntries(FILTERS.map(f=>[f.id,{stones:0,kept:0,disassembled:0,clears:0,zeroClears:0,perAttempt:[]}]));
  let seconds=0, cleared=0, fail=0, failedLeaks=0,totalDrops=0;
  for(let i=0;i<trials;i++){
    const outcome=scenario.runner.computeOfflineRun(dungeon,0,{seed:SEED_BASE+i});
    seconds+=outcome.seconds;
    if(!outcome.cleared){
      fail++;
      if(outcome.drops.length)failedLeaks+=outcome.drops.length;
    } else {cleared++;totalDrops+=outcome.drops.length;}
    for(const filter of FILTERS){
      const result=settleDrops(outcome.drops,{enabled:true,rarities:new Set(filter.rarities)});
      const c=counts[filter.id];
      c.stones+=result.materialGained;
      c.kept+=result.kept.length;
      c.disassembled+=result.disassembled;
      c.perAttempt.push(result.materialGained);
      if(outcome.cleared){
        c.clears++;
        if(result.materialGained===0)c.zeroClears++;
      }else if(result.materialGained!==0||result.kept.length!==0)throw Error("failed run leaked material or items");
    }
  }
  if(failedLeaks)throw Error("unexpected lost-drop reward");
  const filters=FILTERS.map(filter=>{
    const c=counts[filter.id];
    const avgPerAttempt=c.stones/trials;
    const avgSec=seconds/trials;
    return {filter:filter.id,disassembleRarities:filter.rarities,stones:c.stones,
      kept:c.kept,disassembled:c.disassembled,
      stonesPerAttempt:round(avgPerAttempt),
      stonesPerClear:cleared?round(c.stones/cleared):null,
      keptPerAttempt:round(c.kept/trials),
      stonesPer600GameSeconds:round(c.stones/seconds*600),
      zeroStoneClears:c.zeroClears,
      percentiles:{p10:c.perAttempt.slice().sort((a,b)=>a-b)[Math.floor((trials-1)*.1)],
        p50:c.perAttempt.slice().sort((a,b)=>a-b)[Math.floor((trials-1)*.5)],
        p90:c.perAttempt.slice().sort((a,b)=>a-b)[Math.floor((trials-1)*.9)]},
    };
  });
  return {id:config.id,dungeonId:config.dungeonId,partyId:config.partyId,
    gearProfile:config.profileId,lateNormalFactor:config.lateFactor,
    trials,cleared,failed:fail,clearPct:round(100*cleared/trials),avgGameSeconds:round(seconds/trials),
    equipmentPlan,
    confirmedDropsPerAttempt:round(totalDrops/trials),filters};
}

function compareMilestones(trials=120) {
  const rows=CONFIGS.map(c=>gatherEconomy(c,trials));
  const costs=[];
  for(const r of data.RARITIES)for(const start of BASES)for(const target of TARGETS)
    if(target>start) costs.push(enhancementCosts(r.key,start,target));
  const examples=rows.map(x=>{
    const f=x.filters.find(f=>f.filter==="default-n-r");
    const n4=costs.find(x=>x.rarity==="n"&&x.from===0&&x.to===4);
    const n8=costs.find(x=>x.rarity==="n"&&x.from===0&&x.to===8);
    const n12=costs.find(x=>x.rarity==="n"&&x.from===0&&x.to===12);
    const r4=costs.find(x=>x.rarity==="r"&&x.from===0&&x.to===4);
    return {id:x.id,stonesPerAttempt:f.stonesPerAttempt,clearPct:x.clearPct,
      runsForOneN4:f.stonesPerAttempt?round(n4.expectedStones/f.stonesPerAttempt):null,
      runsForFiveN4:f.stonesPerAttempt?round(5*n4.expectedStones/f.stonesPerAttempt):null,
      runsForFiveN8:f.stonesPerAttempt?round(5*n8.expectedStones/f.stonesPerAttempt):null,
      runsForFiveN12:f.stonesPerAttempt?round(5*n12.expectedStones/f.stonesPerAttempt):null,
      runsForOneR4:f.stonesPerAttempt?round(r4.expectedStones/f.stonesPerAttempt):null,
    };
  });
  return {version:1,trials,seed:SEED_BASE,configs:rows,costs,examples,
    assumptions:[
      "Expected attempts include actual pity guarantee; one enhancement at a time; starting pity=0 at each new +level",
      "Runs required = expected stone cost / mean gain; ignores variance and equipment farming time",
      "Same starting equipment is reset at every simulation attempt; this does NOT simulate a player's progression after upgrading",
      "Use actual default auto-disassemble N+R, plus N-only for comparison; protected drops never disassembled",
      "No paid guaranteed stones are used; risk of losing all unbanked loot on failed dungeon preserved",
    ]};
}
if(require.main===module){
  const arg=process.argv.find(s=>s.startsWith("--trials="));
  const report=compareMilestones(arg?Number(arg.split("=")[1]):120);
  console.log("DUNGEON_STONE_ECONOMY_V1 trials="+report.trials);
  console.log("case win% sec/try N-only stone/try default N+R stone/try kept/try wornPieces all+4 stones runs five N +4 /+8 /+12");
  for(const c of report.configs){
    const n=c.filters.find(f=>f.filter==="n"),d=c.filters.find(f=>f.filter==="default-n-r");
    const ex=report.examples.find(x=>x.id===c.id);
    console.log([c.id,c.clearPct,c.avgGameSeconds,n.stonesPerAttempt,d.stonesPerAttempt,
      d.keptPerAttempt,c.equipmentPlan.equippedPieces,c.equipmentPlan.expectedStonesToUpgradeAll["4"],
      ex.runsForFiveN4,ex.runsForFiveN8,ex.runsForFiveN12].join(" "));
  }
  console.log("STONE_ECONOMY_JSON="+JSON.stringify(report));
}
module.exports={expectedStageCost,enhancementCosts,gatherEconomy,compareMilestones,CONFIGS,FILTERS,TARGETS,SEED_BASE};

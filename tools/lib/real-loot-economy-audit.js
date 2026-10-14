"use strict";
// Actual game-config loot/economy audit. Fixed wins isolate rewards; no battle-speed claims.
// Uses existing encounter/drop, rarity, unique, settlement, rounding and enhancement APIs.
const {loadGameData}=require("./load-data.js");
const RNG=require("../../js/core/rng.js");
const Rewards=require("../../js/core/rewards.js");
const Offline=require("../../js/core/offline.js");
const Enhance=require("../../js/core/enhance.js");

const BONUS_MEMBERS=Object.freeze([0,1,3,5]);
const FILTERS=Object.freeze({
  default: null,  // Resolve from game's DEFAULT_AUTO_DISASSEMBLE_RARITIES.
  nOnly:["n"],
  throughSR:["n","r","sr"],
  disabled:[]
});
function validate(data,dungeonId,mode,rounds,seed){
 if(!data||typeof data.getModeDungeon!=="function"||!data.REWARD_RULES||
    !Array.isArray(data.RARITIES))throw TypeError("Game definitions required");
 if(!["normal","hard","extra"].includes(mode))throw RangeError("Invalid dungeon mode");
 if(!Number.isInteger(rounds)||rounds<1||rounds>10000)throw RangeError("Invalid rounds");
 if(!Number.isSafeInteger(seed)||seed<0||seed>4294967295)throw RangeError("Invalid seed");
 const dungeon=data.getModeDungeon(dungeonId,mode);
 if(!dungeon||!Number.isInteger(dungeon.battles)||dungeon.battles<1)
   throw RangeError("Unknown dungeon");
 return dungeon;
}
function optionMax(data,key){
 const opt=data.ITEM_OPTIONS.find(x=>x.key===key);
 if(!opt||!opt.range||!opt.range.extra)throw Error("Missing real Extra OP: "+key);
 const value=opt.range.extra[1];
 const effect=data.itemOptionEffect({key,value}).passives;
 const target=key==="exp"?"expBonus":"materialBonus";
 if(!effect||effect[target]!==value)throw Error("OP effect mapping changed: "+key);
 return value;
}
function generateRuns(data,opts={}){
 const dungeonId=opts.dungeonId||"plains",mode=opts.mode||"normal";
 const rounds=opts.rounds===undefined?1000:opts.rounds,seed=opts.seed===undefined?20261014:opts.seed;
 const dungeon=validate(data,dungeonId,mode,rounds,seed);
 const dropOpts=dungeon.mode?{regionLevel:dungeon.baseLevel,mode:dungeon.mode}:undefined;
 const samples=[];
 // All reward types and real rare/special drops use the same seeded game RNG.
 RNG.withSharedSource(RNG.seededSource(seed),()=>{
  for(let i=0;i<rounds;i++){
   const result=Offline.simulateRun({
    battles:dungeon.battles,rng:RNG.shared,rules:data.REWARD_RULES,
    timing:{perBattle:1,perGap:0,overhead:0},
    buildEncounter:n=>data.buildEncounter(dungeon,n),
    fight:()=>({won:true,seconds:1,eligibleIds:["m0","m1","m2","m3","m4"]}),
    onEvent:()=>{}, // traps/springs/shrines ignored: unconditional-win reward stress test
    isTamable:key=>!!data.getEnemyTemplate(key)?.tamable,
    tameChanceOf:key=>data.getEnemyTemplate(key).tameChance,
    rollOne:()=>data.rollItemDrop(dungeon.level,undefined,dropOpts),
    rollRareOne:enemy=>data.rollSpecialDrop
      ? data.rollSpecialDrop(dungeon.level,enemy,dropOpts)
      : enemy&&enemy.isRare ? data.rollItemDrop(dungeon.level,"sr",dropOpts):null
   });
   if(!result.cleared)throw Error("Unconditional win should clear");
   samples.push({drops:result.drops,expByBattle:result.expByBattle});
  }
 });
 return {dungeonId,mode,rounds,seed,battles:dungeon.battles,samples};
}
function receiveLikeGame(items,filter,mult){
 // inventory.receiveDrops calls settleDrops, then rounds total material PER RUN.
 const settled=Rewards.settleDrops(items,{enabled:filter.length>0,rarities:new Set(filter)});
 return {
  ...settled,
  materialGained:mult!==1?Math.round(settled.materialGained*mult):settled.materialGained
 };
}
function calculate(data,runData){
 const perMemberExp=optionMax(data,"exp"),perMemberMaterial=optionMax(data,"material");
 const rows=[];
 for(const [filterName,rawFilter] of Object.entries(FILTERS)){
  const filter=rawFilter===null?Array.from(data.DEFAULT_AUTO_DISASSEMBLE_RARITIES):rawFilter;
  for(const holders of BONUS_MEMBERS){
   const expMult=1+holders*perMemberExp;
   const materialMult=1+holders*perMemberMaterial;
   let materials=0,disassembled=0,kept=0,uniqueKept=0,memberEXP=0,items=0;
   for(const sample of runData.samples){
    const result=receiveLikeGame(sample.drops,filter,materialMult);
    materials+=result.materialGained;
    disassembled+=result.disassembled;
    kept+=result.kept.length;
    uniqueKept+=result.kept.filter(it=>it.unique||it.cursed).length;
    items+=sample.drops.length;
    // EXP rounds per battle per member, same as Runner (five living humans, expMult=1).
    memberEXP+=sample.expByBattle.reduce((sum,x)=>
      sum+Math.round(Rewards.expForMember(x,1)*expMult),0);
   }
   rows.push({filter:filterName,filterRarities:filter.slice(),holders,
    expBonus:holders*perMemberExp,materialBonus:holders*perMemberMaterial,
    materials,materialsPerRun:materials/runData.rounds,
    expPerMember:memberEXP,expPerMemberPerRun:memberEXP/runData.rounds,
    partyTotalEXP:memberEXP*5,disassembled,kept,uniqueKept,items});
  }
 }
 return {
  dataset:{dungeonId:runData.dungeonId,mode:runData.mode,rounds:runData.rounds,
    seed:runData.seed,battles:runData.battles},
  realOptionMax:{exp:perMemberExp,material:perMemberMaterial},
  filters:rows,
  rarities:data.RARITIES.map(r=>({key:r.key,material:r.material,weight:r.weight}))
 };
}
// Exact expected per step with current pity logic (no paid stones, pity resets after a success).
// When pity disabled this reduces to cost/p, and is not a Monte Carlo estimate.
function enhanceBudget(data,rarity,target){
 if(!data.RARITIES.some(r=>r.key===rarity)||!Number.isInteger(target)||
    target<1||target>data.ENHANCE_MAX_PLUS)throw RangeError("Invalid enhancement target");
 let expected=0,withoutPity=0;
 const pityOn=!!data.FEATURE_FLAGS.enhancePity;
 for(let plus=0;plus<target;plus++){
  const cost=Enhance.cost(data.ENHANCE_RULES,rarity,plus);
  const chance=Enhance.successRate(data.ENHANCE_RULES,rarity,plus);
  const n=pityOn?Math.ceil(Enhance.pityThreshold(data.ENHANCE_RULES,rarity,plus)/cost)+1:Infinity;
  // E[attempts] for geometrical distribution truncated at the guaranteed attempt.
  const attempts=Number.isFinite(n)?-Math.expm1(n*Math.log1p(-chance))/chance:1/chance;
  expected+=cost*attempts;
  withoutPity+=cost/chance;
 }
 return {rarity,target,expected,withoutPity,pityEnabled:pityOn};
}
function audit(data=loadGameData(),opts={}){
 const generated=generateRuns(data,opts);
 const report=calculate(data,generated);
 const targets=[["sr",50],["ur",50],["ur",99],["lr",50],["lr",99]];
 report.upgradeCosts=targets.map(([rarity,target])=>enhanceBudget(data,rarity,target));
 report.upgradeCoverage=report.upgradeCosts.map(cost=>({
  rarity:cost.rarity,target:cost.target,expected:cost.expected,
  scenarios:report.filters.filter(x=>x.filter==="default").map(r=>({
   holders:r.holders,roundsNeeded:r.materialsPerRun>0?Math.ceil(cost.expected/r.materialsPerRun):null,
   percentOfBudgetAfterRuns:r.materials>0?100*r.materials/cost.expected:0
  }))
 }));
 return report;
}
module.exports={BONUS_MEMBERS,FILTERS,validate,optionMax,generateRuns,receiveLikeGame,calculate,enhanceBudget,audit};

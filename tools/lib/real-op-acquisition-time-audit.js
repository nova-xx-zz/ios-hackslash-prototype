"use strict";
// Actual loot and battle benchmark (read-only). Trial inheritance scenarios kept separate.
const {loadGameData}=require("./load-data.js");
const Economy=require("./real-loot-economy-audit.js");
const Rewards=require("../../js/core/rewards.js");
const BattleSim=require("./sim.js");
const LegacyTrial=require("../../js/core/option-inheritance-trial.js");
const Runner=require("../../js/model/run.js");
const Offline=require("../../js/core/offline.js");

const COUNT_TARGETS=Object.freeze({weapon:5,head:5,body:5,accessory:15});
function validateMode(mode){if(!["normal","hard","extra"].includes(mode))throw RangeError("Invalid loot mode");}
function acquisition(data=loadGameData(),opts={}){
 const mode=opts.mode||"extra";validateMode(mode);
 const runs=opts.runs===undefined?2000:opts.runs;
 const threshold=opts.threshold===undefined?.20:opts.threshold;
 const seed=opts.seed===undefined?20261014:opts.seed;
 if(!Number.isInteger(runs)||runs<1||runs>10000)throw RangeError("Invalid run count");
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw RangeError("Invalid quality threshold");
 const generated=Economy.generateRuns(data,{mode,rounds:runs,seed,dungeonId:opts.dungeonId||"plains"});
 const opMax={};
 for(const key of ["exp","material"])opMax[key]=Economy.optionMax(data,key);
 const eligible=(item,key)=>Array.isArray(item.options)&&item.options.some(o=>o.key===key&&o.value>=threshold);
 const result={mode,runs,seed,threshold,dungeonId:generated.dungeonId,items:0,
  byKey:{},perRun:[],quality:opMax};
 const buckets={exp:[],material:[]};
 for(const key of Object.keys(buckets))result.byKey[key]={
  total:0,keptWithDefaultAutoDismantle:0,lostToDefaultAutoDismantle:0,
  previouslyLostBeforeProtection:0,savedByNewProtection:0,
  nOrR:0,slots:{weapon:0,head:0,body:0,accessory:0,shield:0},
  firstThirty:null,firstSlots30:null,firstSlots30Protected:null
 };
 // Real default filter (currently N/R), not the trial rare-OP protection.
 const filter=new Set(data.DEFAULT_AUTO_DISASSEMBLE_RARITIES);
 const seen={exp:{},material:{}}, protectedSeen={exp:{},material:{}};
 for(let i=0;i<runs;i++){
  const items=generated.samples[i].drops;result.items+=items.length;
  for(const key of Object.keys(buckets)){
   const row=result.byKey[key];
   for(const item of items){
    if(!eligible(item,key))continue;
    row.total++;
    if(row.slots[item.slot]===undefined)row.slots[item.slot]=0;
    row.slots[item.slot]++;
    const previouslyLost=filter.has(item.rarity)&&!item.unique&&!item.locked;
    const protectedNow=Rewards.hasProtectedOption(item)||!!item.cursed;
    const lost=previouslyLost&&!protectedNow;
    if(previouslyLost)row.previouslyLostBeforeProtection++;
    if(previouslyLost&&protectedNow)row.savedByNewProtection++;
    if(lost)row.lostToDefaultAutoDismantle++;
    else row.keptWithDefaultAutoDismantle++;
    if(item.rarity==="n"||item.rarity==="r")row.nOrR++;
    seen[key][item.slot]=(seen[key][item.slot]||0)+1;
    if(!lost)protectedSeen[key][item.slot]=(protectedSeen[key][item.slot]||0)+1;
    if(row.total>=30&&row.firstThirty===null)row.firstThirty=i+1;
   }
   const full=(counts)=>Object.entries(COUNT_TARGETS).every(([slot,n])=>(counts[slot]||0)>=n);
   if(row.firstSlots30===null&&full(seen[key]))row.firstSlots30=i+1;
   if(row.firstSlots30Protected===null&&full(protectedSeen[key]))row.firstSlots30Protected=i+1;
  }
 }
 for(const key of Object.keys(buckets)){
  const row=result.byKey[key];
  row.perItem=row.total/result.items;
  row.perRun=row.total/runs;
  row.optimisticRunsForThirty=row.perRun>0?30/row.perRun:null;
  row.optimisticRunsForSlots=row.firstSlots30;
  row.optimisticRunsForSlotsWithDefaultFilter=row.firstSlots30Protected;
 }
 result.caveats=[
  "Same type OP may appear once per dropped item; different pieces are required for each equipment slot",
  "Matching class, gear series and all accessory slot constraints are NOT checked by simple slot counts",
  "The real drop table does NOT produce N-weapon UR/LR-ranked trial essences",
  "Existing N/R auto-dismantle NOW protects high-value percentage and SR+ ranked options; previous unprotected losses are reported separately",
  "Strict 5x6 setup requires 30 distinct compatible equips PER option kind, may be unattainable in displayed runs"
 ];
 return result;
}
function timing(opts={}){
 const mode=opts.mode||"normal";validateMode(mode);
 const dungeonId=opts.dungeonId||"plains",trials=opts.trials===undefined?16:opts.trials;
 const seed=opts.seed===undefined?20261014:opts.seed;
 if(!Number.isInteger(trials)||trials<1||trials>100)throw RangeError("Invalid trial count");
 if(!Number.isSafeInteger(seed))throw RangeError("Invalid seed");
 const data=BattleSim.data,dungeon=data.getModeDungeon(dungeonId,mode);
 if(!dungeon)throw RangeError("Unknown dungeon");
 const gear=opts.gear||dungeon.benchmarkGear||{rarity:"r",plus:10};
 const reference={rarity:gear.rarity||"r",plus:gear.plus||0,level:dungeon.level};
 const characterLevel=opts.level===undefined?dungeon.level:opts.level;
 if(!data.RARITIES.some(x=>x.key===reference.rarity)||!Number.isInteger(reference.plus)||
    reference.plus<0||reference.plus>data.ENHANCE_MAX_PLUS||!Number.isInteger(characterLevel)||
    characterLevel<1||characterLevel>data.CHAR_MAX_LEVEL)throw RangeError("Invalid battle gear or level");
 const stats=BattleSim.clearRate(dungeonId,characterLevel,trials,seed,{mode,gear:reference,tree:true});
 const estimate=Offline.estimateRunSeconds(dungeon.battles,Runner.OFFLINE_TIMING);
 const gameOverhead=Runner.OFFLINE_TIMING.overhead+Math.max(0,dungeon.battles-1)*Runner.OFFLINE_TIMING.perGap;
 const fullSuccessfulSeconds=stats.avgSeconds===null?null:stats.avgSeconds+gameOverhead;
 const possibleOfflineRuns=Math.floor(Math.min(Runner.OFFLINE_MAX_MS/1000,8*3600)/estimate);
 return {dungeonId,mode,trials,seed,dungeonLevel:dungeon.level,characterLevel,battles:dungeon.battles,
  gear:reference,clearRate:stats.rate,clears:Math.round(trials*stats.rate),
  avgBattleSecondsOnClear:stats.avgSeconds,
  avgGameSecondsOnClear:fullSuccessfulSeconds,
  estimateRunSeconds:estimate,offlineMaxSeconds:Runner.OFFLINE_MAX_MS/1000,
  offlineEstimateMaxRuns:possibleOfflineRuns,
  speedNote:"x1 battle-engine seconds; offline completion uses a pre-check estimate and simulated battle cost, not simply wall-time divided by an advertised speed multiplier"};
}
function inheritanceScenarios(){
 // Trial only: expected attempts with a capped failure streak on a target.
 const results={rates:{...LegacyTrial.RATES},pityLimits:{...LegacyTrial.PITY_LIMIT},
  guaranteeExtraction:LegacyTrial.EXTRACT_COUNT,source:"prototype-only"};
 for(const rank of ["ur","lr"]){
  const p=LegacyTrial.RATES[rank],n=LegacyTrial.PITY_LIMIT[rank]+1;
  const attempts=(1-Math.pow(1-p,n))/p;
  results[rank]={baseChance:p,guaranteedAttempt:n,meanEssencesPerSuccess:attempts,
   essenceLoss:attempts-1,
   probabilityOfPityAttempt:Math.pow(1-p,n-1),
   probabilitySuccessWithinTwoWithoutPity:1-Math.pow(1-p,2)};
 }
 // Identifies risk in legacy pity being target-wide, rather than essence OP key/rank.
 results.securityRisk="Target-wide failure counter can be primed by low-value essences; must not be copied to server economy.";
 return results;
}
function report(opts={}){
 const data=loadGameData();
 return {
  production:acquisition(data,{runs:opts.runs===undefined?2000:opts.runs,
   seed:opts.seed===undefined?20261014:opts.seed,threshold:opts.threshold===undefined?.20:opts.threshold,mode:"extra"}),
  productionLessStrict:acquisition(data,{runs:opts.runs===undefined?2000:opts.runs,
   seed:opts.seed===undefined?20261014:opts.seed,threshold:.18,mode:"extra"}),
  battle:timing({mode:opts.mode||"normal",trials:opts.trials===undefined?16:opts.trials,
   seed:opts.seed===undefined?20261014:opts.seed}),
  trialOnlyInheritance:inheritanceScenarios()
 };
}
module.exports={COUNT_TARGETS,acquisition,timing,inheritanceScenarios,report};

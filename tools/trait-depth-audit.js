#!/usr/bin/env node
"use strict";
// Spawn-only future-floor audit (10F/15F are NOT connected to real battle).
// Uses the same dungeon floor plan, spawn pool, rarity lottery and trait cap
// as the 3F/5F diagnostic; reports spawn distribution, not clear rates.
const {createRng}=require("../js/core/rng.js");
const trial=require("../js/core/dungeon-trial.js");
const {capNativeTraitRoles,rollTraitAssignments}=require("../js/core/trait-encounter.js");
const {data}=require("./lib/sim.js");

const STAGES=Object.freeze(["plains","cave","tomb","sunken_city"]);
function measure(dungeonId,trials=500,seed=20261018){
 if(!STAGES.includes(dungeonId)||!Number.isInteger(trials)||trials<1||trials>2000)
  throw new RangeError("invalid depth audit");
 const dungeon=data.getDungeon(dungeonId), rng=createRng(seed);
 const totalFloors=trial.FLOOR_COUNTS[dungeonId];
 const floorCounts=Array.from({length:totalFloors},(_,i)=>({
  floor:i+1,battles:0,traitTotal:0,enemyTotal:0,rare:0,
  counts:{zero:0,one:0,two:0,three:0},
  nativeOvercapBefore:0
 }));
 for(let run=0;run<trials;run++){
  for(const schedule of trial.createFloorPlan(dungeon,rng)){
   const stats=floorCounts[schedule.floor-1];
   for(let b=0;b<schedule.regularBattles;b++){
    const planned=trial.createEncounterPlan(dungeon,schedule.floor,rng,null);
    const roles=planned.enemyRoles.map(x=>({...x,isRare:false}));
    if(Array.isArray(dungeon.rares)&&dungeon.rares.length&&rng.chance(0.04)){
      const index=rng.int(roles.length);
      roles[index].key=rng.pick(dungeon.rares);
      roles[index].isRare=true;
    }
    const initialNative=roles.filter(x=>data.enemyTraits(x.key).length>0).length;
    if(initialNative>3)stats.nativeOvercapBefore++;
    const capped=capNativeTraitRoles(roles,dungeon.pool,data.enemyTraits,rng);
    if(capped.some((r,i)=>roles[i].isRare&&(r.key!==roles[i].key||!r.isRare)))
      throw Error("rare species changed in trait cap");
    const enemyEntries=capped.map(x=>({...x,traits:data.enemyTraits(x.key)}));
    const additions=rollTraitAssignments(enemyEntries,rng);
    const total=capped.filter(x=>data.enemyTraits(x.key).length>0).length+additions.length;
    if(total>3||total>capped.length||capped.length>5||total<0)
      throw Error("trait cap exceeded");
    stats.battles++;
    stats.traitTotal+=total;
    stats.enemyTotal+=capped.length;
    stats.rare+=capped.filter(x=>x.isRare).length;
    stats.counts[["zero","one","two","three"][total]]++;
   }
  }
 }
 return {dungeonId,floors:totalFloors,trials,seed,
  totalBattles:floorCounts.reduce((n,s)=>n+s.battles,0),
  nativeOvercapBefore:floorCounts.reduce((n,s)=>n+s.nativeOvercapBefore,0),
  maxTraitsAfter:3,
  perFloor:floorCounts.map(s=>({...s,averageTraits:Math.round(s.traitTotal/s.battles*100)/100,
   averageEnemies:Math.round(s.enemyTotal/s.battles*100)/100}))};
}
function runAudit(trials=500,seed=20261018){return {version:1,kind:"spawn-only",stages:STAGES.map(id=>measure(id,trials,seed))};}
if(require.main===module){
 const arg=process.argv.find(x=>x.startsWith("--trials="));
 const out=runAudit(arg?Number(arg.split("=")[1]):500);
 for(const s of out.stages){
  console.log(s.dungeonId+" "+s.floors+"F battles="+s.totalBattles+" native_overcap_before="+s.nativeOvercapBefore);
  for(const f of s.perFloor)console.log(["F"+f.floor,f.battles,"enemies",f.averageEnemies,"traits",f.averageTraits,
   "zero/one/two/three",Object.values(f.counts).join("/")].join(" "));
 }
 console.log("TRAIT_DEPTH_AUDIT_JSON="+JSON.stringify(out));
}
module.exports={measure,runAudit,STAGES};

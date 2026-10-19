"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createRng}=require("../js/core/rng.js");
const {TRAIT_TYPES,rollTraitAssignments}=require("../js/core/trait-encounter.js");
const {buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {PARTY_BUILDS,characterSpecs}=require("../tools/basic-job-build-study.js");
const {data}=require("../tools/lib/sim.js");

test("1～3体ランダム特性は敵数上限で丸め、重複・ボス・レアの変更はしない",()=>{
 const rng=createRng(20261018),seen=new Set();
 for(const size of [1,2,3,4,5]){
   for(let i=0;i<300;i++){
     const enemies=Array.from({length:size},(_,j)=>({key:String(j),isBoss:false,isRare:false,traits:[]}));
     const frozen=JSON.stringify(enemies);
     const assigned=rollTraitAssignments(enemies,rng);
     assert.ok(assigned.length>=1&&assigned.length<=Math.min(size,3));
     assert.equal(new Set(assigned.map(x=>x.index)).size,assigned.length);
     assert.ok(assigned.every(x=>TRAIT_TYPES.includes(x.trait)));
     if(size===5)seen.add(assigned.length);
     assert.equal(JSON.stringify(enemies),frozen);
   }
 }
 assert.deepEqual([...seen].sort(),[1,2,3]);
 const withProtected=[
   {key:"boss",isBoss:true,traits:[]},{key:"rare",isRare:true,traits:[]},
   {key:"native",traits:["spirit"]},{key:"free",traits:[]},
 ];
 // 1 innate trait must count toward the 1–3 target, so new additions may
 // be zero if the random target is one, or one if random target is three.
 const zero=rollTraitAssignments(withProtected,{int:()=>0});
 assert.deepEqual(zero,[]);
 const one=rollTraitAssignments(withProtected,{int:n=>n-1});
 assert.deepEqual(one.map(x=>x.index),[3]);
 assert.deepEqual(rollTraitAssignments(withProtected.slice(0,3),createRng(3)),[]);
 const allNative=Array.from({length:4},(_,i)=>({key:String(i),traits:["spirit"]}));
 assert.deepEqual(rollTraitAssignments(allNative,createRng(1)),[],
  "never erase pre-existing innate traits even if encounter has >3");
});

test("試験用実戦闘の一般戦闘のみ最大3特性、ボスと既存敵データは変わらない",()=>{
 const profile=PROFILES.find(x=>x.id==="recommended");
 const specs=characterSpecs(PARTY_BUILDS.monkThief);
 const setup=()=>buildScenario("cave",profile,12171,{partySpecs:specs,randomTraitEnemies:true});
 const a=setup(), b=setup();
 let traced=0,found=0,added=0,bosses=0;
 const observer={seed:12172,onBattleFinish:x=>{
   const present=x.enemies.filter(e=>e.pilotAddedTrait);
   if(x.boss){
     bosses++;
     assert.equal(present.length,0,"never decorate boss encounters");
   }else{
     traced++;added+=present.length;
     assert.ok(present.length<=3);
     assert.ok(present.length<=x.enemies.length);
     assert.ok(x.enemies.length<=5);
     assert.ok(present.every(e=>!e.isBoss&&!e.isRare));
     if(present.length)found++;
     assert.ok(present.every(e=>["spirit","ward","armored","undead"].includes(e.pilotAddedTrait)));
     assert.ok(present.every(e=>e.res.physical!==0&&e.res.magic!==0&&e.res.nonHoly!==0),
        "Normal never gives complete immunity");
   }
 }};
 const run=a.runner.computeOfflineRun({...a.d,pilotLateNormalFactor:1},0,observer);
 const replay=b.runner.computeOfflineRun({...b.d,pilotLateNormalFactor:1},0,{seed:12172});
 assert.equal(run.cleared,replay.cleared);
 // Item IDs use a global monotonic itemSeq unrelated to per-run RNG.
 // Compare drop substance, not global item sequence numbers.
 const stable=x=>x.map(({id,...item})=>item);
 assert.deepEqual(stable(run.drops),stable(replay.drops));
 assert.ok(traced>0&&found>0);
 assert.ok(added>0&&bosses>=0);
 assert.equal(data.getDungeon("cave").pilotLateNormalFactor,.8);
 assert.equal(data.getEnemyTemplate("rock_golem").element,"土");
 if(!run.cleared)assert.equal(run.drops.length,0);
});

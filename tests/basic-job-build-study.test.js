"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {data}=require("../tools/lib/sim.js");
const {buildScenario,PROFILES}=require("../tools/dungeon-balance.js");
const {PARTY_BUILDS,SKILLS,GEAR,characterSpecs,measureBuild,runStudy}=require("../tools/basic-job-build-study.js");

test("一次職6種類を、9種類の合法な5人編成に配置",()=>{
 const all=new Set(Object.values(PARTY_BUILDS).flat());
 assert.deepEqual([...all].sort(),Object.values(data.JOBS).filter(j=>j.tier==="basic").map(j=>j.id).sort());
 for(const jobs of Object.values(PARTY_BUILDS)){
   assert.equal(jobs.length,5);
   assert.equal(characterSpecs(jobs).length,5);
 }
 assert.throws(()=>characterSpecs(["archmage","warrior","mage","priest","thief"]),RangeError);
 assert.throws(()=>characterSpecs(["warrior"]),TypeError);
});

test("Lv7とLv10で武闘家の回復技習得の有無が正しく異なる",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 const opts={partySpecs:characterSpecs(PARTY_BUILDS.doubleMonk)};
 const low=buildScenario("cave",p,2,{...opts,levelOverride:7});
 const high=buildScenario("cave",p,2,{...opts,levelOverride:10});
 assert.ok(!low.roster.availableAbilities(low.state.roster[0]).some(x=>x.id==="chi_heal"));
 assert.ok(high.roster.availableAbilities(high.state.roster[0]).some(x=>x.id==="chi_heal"));
 assert.equal(low.state.roster[0].level,7);
 assert.equal(high.state.roster[0].level,10);
});

test("スキル設定は本人のON/OFFと優先度を反映し実戦闘へ渡る",()=>{
 const p=PROFILES.find(x=>x.id==="recommended");
 const specs=characterSpecs(PARTY_BUILDS.darkThief);
 const neutral=buildScenario("cave",p,1,{partySpecs:specs,skillStrategy:"normal"});
 const conserve=buildScenario("cave",p,1,{partySpecs:specs,skillStrategy:"mpSave"});
 const prio=buildScenario("cave",p,1,{partySpecs:specs,skillStrategy:"burstHeal"});
 const dark=conserve.state.roster.find(x=>x.job==="darkknight");
 assert.equal(conserve.roster.isSkillActive(dark,"drain"),false);
 assert.equal(neutral.roster.isSkillActive(neutral.state.roster.find(x=>x.job==="darkknight"),"drain"),true);
 assert.equal(prio.state.roster.find(x=>x.job==="darkknight").abilityPriority.drain,3);
 assert.equal(prio.state.roster.find(x=>x.job==="priest").abilityPriority.heal,3);
 assert.equal(neutral.skillStrategy,"normal");
});

test("実戦闘・同seedで再現でき、全滅後の未確定品は持ち帰らない",()=>{
 const a=measureBuild("monkNoPriest",7,"recommended","normal",3);
 const b=measureBuild("monkNoPriest",7,"recommended","normal",3);
 assert.deepEqual(a,b);
 assert.equal(a.clear+a.fail,3);
 assert.equal(a.lostDropsLeaked,0);
 assert.equal(Object.values(a.failAt).reduce((s,n)=>s+n,0),a.fail);
 assert.ok(a.clearPct>=0&&a.clearPct<=100);
 const study=runStudy(1);
 assert.equal(study.rows.length,Object.keys(PARTY_BUILDS).length*2*GEAR.length*SKILLS.length);
 assert.ok(study.rows.every(r=>r.lostDropsLeaked===0));
});

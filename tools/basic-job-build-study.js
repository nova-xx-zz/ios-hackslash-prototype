#!/usr/bin/env node
"use strict";
// Phase 1 basic-job buildcraft diagnostic: real Lv7/Lv10 cave fights, actual skill
// ON/OFF, AI priority and tree/equipment; production data unchanged.
const {buildScenario,PROFILES}=require("./dungeon-balance.js");
const {STARTER_PARTY}=require("./lib/sim.js");
const {data}=require("./lib/sim.js");
const {settleDrops}=require("../js/core/rewards.js");
const PARTY_BUILDS=Object.freeze({
  baseline: ["warrior","warrior","mage","mage","priest"],
  twoPriestThief: ["warrior","thief","mage","priest","priest"],
  monkThief: ["warrior","monk","mage","thief","priest"],
  darkThief: ["warrior","darkknight","mage","thief","priest"],
  monkDark: ["warrior","monk","mage","darkknight","priest"],
  physicalMixed: ["warrior","monk","thief","darkknight","priest"],
  doubleMonk: ["monk","monk","mage","thief","priest"],
  monkNoPriest: ["warrior","monk","mage","thief","monk"],
  doubleDark: ["darkknight","darkknight","mage","thief","priest"],
});
const LEVELS=Object.freeze([7,10]);
const SKILLS=Object.freeze(["normal","mpSave","burstHeal"]);
const GEAR=Object.freeze([
 {id:"recommended",profile:"recommended",preview:"current"},
 {id:"enhancedTrial",profile:"reinforced",preview:"earlyMilestones"}
]);
const SEED=2026101700;
const ROUND=n=>Math.round(n*100)/100;
function characterSpecs(jobs) {
  if(!Array.isArray(jobs)||jobs.length!==5)throw new TypeError("need five members");
  if(jobs.some(j=>!data.JOBS[j] || data.JOBS[j].tier!=="basic"))throw new RangeError("basic jobs only");
  return jobs.map((job,i)=>({job,race:STARTER_PARTY[i].race}));
}
function measureBuild(partyId,level,gearId,skillStrategy,trials=40){
  const jobs=PARTY_BUILDS[partyId], gear=GEAR.find(x=>x.id===gearId);
  if(!jobs||!LEVELS.includes(level)||!gear||!SKILLS.includes(skillStrategy)||
     !Number.isInteger(trials)||trials<1||trials>500)throw new RangeError("invalid case");
  const profile=PROFILES.find(x=>x.id===gear.profile);
  const s=buildScenario("cave",profile,SEED,{
    partySpecs:characterSpecs(jobs),levelOverride:level,
    skillStrategy,enhancePreview:gear.preview,
  });
  // Always test at the original difficulty; never rely on the proposed nerf.
  const dungeon={...s.d,pilotLateNormalFactor:1};
  const tally={
    clear:0,fail:0,seconds:0,drops:0,material:0,kept:0,
    lostDrops:0,bossReached:0,bossWins:0,
    wipes:{1:0,2:0,3:0,4:0,5:0,boss:0},
    damageByJob:{},healByJob:{},drainByJob:{},
    actionBySkill:{},mpSpentByJob:{},
  };
  for(let i=0;i<trials;i++){
    const battles=[];
    const res=s.runner.computeOfflineRun(dungeon,0,{
      seed:SEED+i,onBattleFinish:b=>battles.push(b),
      onBattleStep(step) {
        for(const ev of step.events){
          const c=ev.actor;
          if(ev.type==="damage" && c) {
            tally.damageByJob[c.job]=(tally.damageByJob[c.job]||0)+ev.dmg;
            if(ev.drained)tally.drainByJob[c.job]=(tally.drainByJob[c.job]||0)+ev.drained;
          }
          if(ev.type==="heal" && c)
            tally.healByJob[c.job]=(tally.healByJob[c.job]||0)+ev.amount;
          if(["damage","heal"].includes(ev.type) && c && ev.ability){
            // Multiple targets and multi-hit attacks generate multiple events;
            // actionBySkill therefore counts EFFECT EVENTS, not single casts.
            tally.actionBySkill[ev.ability.id]=(tally.actionBySkill[ev.ability.id]||0)+1;
          }
        }
        for(let k=0;k<step.party.length;k++){
          const delta=Math.max(0,step.beforeMp[k]-step.party[k].mp);
          const job=step.party[k].job;
          tally.mpSpentByJob[job]=(tally.mpSpentByJob[job]||0)+delta;
        }
      },
    });
    tally.seconds+=res.seconds;
    const last=battles.at(-1);
    if(!last)throw Error("empty cave battles");
    const final=battles.find(b=>b.boss);
    if(final){tally.bossReached++;if(final.won)tally.bossWins++;}
    if(res.cleared){
      tally.clear++;
      const items=settleDrops(res.drops,{enabled:true,rarities:new Set(["n"])});
      tally.drops+=res.drops.length;tally.material+=items.materialGained;tally.kept+=items.kept.length;
    }else{
      tally.fail++;
      if(!last||last.won)throw Error("no terminal wipe");
      tally.lostDrops+=res.drops.length;
      if(last.boss)tally.wipes.boss++;
      else tally.wipes[last.floor]++;
    }
  }
  return {
    partyId,jobs,level,gearId,skillStrategy,trials,
    clear:tally.clear,clearPct:ROUND(tally.clear/trials*100),
    fail:tally.fail,failAt:tally.wipes,bossReachPct:ROUND(tally.bossReached/trials*100),
    avgGameSec:ROUND(tally.seconds/trials),avgKept:ROUND(tally.kept/trials),
    avgStones:ROUND(tally.material/trials),
    lostDropsLeaked:tally.lostDrops,
    damageByJob:tally.damageByJob,healByJob:tally.healByJob,
    drainByJob:tally.drainByJob,actionBySkill:tally.actionBySkill,
    mpSpentByJob:tally.mpSpentByJob,
    learned:s.state.roster.map(ch=>({job:ch.job,
      skillIds:s.roster.availableAbilities(ch).map(a=>a.id),
      onIds:s.roster.availableAbilities(ch).filter(a=>s.roster.isSkillActive(ch,a.id)).map(a=>a.id),
      priorities:ch.abilityPriority
    })),
  };
}
function runStudy(trials=40){
  const rows=[];
  for(const level of LEVELS)for(const [id] of Object.entries(PARTY_BUILDS))
    for(const gear of GEAR)for(const mode of SKILLS)
      rows.push(measureBuild(id,level,gear.id,mode,trials));
  return {schema:1,trials,seedBase:SEED,rows};
}
if(require.main===module){
  const arg=process.argv.find(s=>s.startsWith("--trials="));
  const report=runStudy(arg?Number(arg.split("=")[1]):40);
  console.log("BASIC_JOB_BUILD_STUDY v1 -- 6 starting jobs, 9 parties, 2 gear profiles, 3 skill choices, Lv7/Lv10");
  console.log("level party gear mode clear% avgSeconds stone/try");
  for(const x of report.rows)console.log([x.level,x.partyId,x.gearId,x.skillStrategy,x.clearPct,x.avgGameSec,x.avgStones].join(" "));
  console.log("BASIC_JOB_STUDY_JSON="+JSON.stringify(report));
}
module.exports={PARTY_BUILDS,LEVELS,SKILLS,GEAR,SEED,characterSpecs,measureBuild,runStudy};

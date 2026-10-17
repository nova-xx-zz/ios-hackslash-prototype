#!/usr/bin/env node
"use strict";
/*
 * Cave 5F buildcraft experiment with ACTUAL character/equipment/skill-tree data
 * and ACTUAL fire/ice/dark/light enemy element-affinity rules.
 * Native encounters are measured unchanged. Alternative elemental encounters
 * are explicitly hypothetical IN-MEMORY recolorings, not live cave monsters.
 */
const {buildScenario,PROFILES}=require("./dungeon-balance.js");
const {PARTY_BUILDS,characterSpecs}=require("./basic-job-build-study.js");
const {settleDrops}=require("../js/core/rewards.js");
const PARTY=Object.freeze(["baseline","twoPriestThief","monkThief","darkThief","monkNoPriest"]);
const ELEMENT=Object.freeze(["native","火","氷","闇","光"]);
const BRANCH=Object.freeze(["left","right"]);
const GEAR=Object.freeze([
 {id:"standard",profile:"recommended",preview:"current"},
 {id:"reinforcedTrial",profile:"reinforced",preview:"earlyMilestones"},
]);
const SEED=202610180;
const round=x=>Math.round(x*100)/100;

function measureBuild(partyId,element,branch,gearId,trials=60){
  if(!PARTY.includes(partyId)||!ELEMENT.includes(element)||!BRANCH.includes(branch)||
     !GEAR.some(x=>x.id===gearId)||!Number.isInteger(trials)||trials<1||trials>500)
    throw new RangeError("invalid buildcraft configuration");
  const gear=GEAR.find(x=>x.id===gearId);
  const profile=PROFILES.find(x=>x.id===gear.profile);
  const s=buildScenario("cave",profile,SEED,{
    partySpecs:characterSpecs(PARTY_BUILDS[partyId]),
    treeBranch:branch,enemyElement:element,enhancePreview:gear.preview,
  });
  const dungeon={...s.d,pilotLateNormalFactor:1};
  const choices=s.state.roster.map(c=>{
    const st=s.roster.getTreeState(c);
    const tree=s.roster.getExclusiveTree(c);
    const active=tree.nodes.filter(n=>n.exclusiveGroup&&(st.exclusiveRanks[n.id]||0)>0);
    return {job:c.job,branchNodes:active.map(n=>({id:n.id,name:n.name,group:n.exclusiveGroup})),
      spUsed:s.roster.totalSpentSp(c),spAvailable:s.roster.availableSp(c),
      stats:s.roster.computeStats(c)};
  });
  const result={partyId,element,branch,gearId,trials,clear:0,fail:0,totalSeconds:0,
    itemCount:0,stones:0,failedDropLeak:0,wipes:{1:0,2:0,3:0,4:0,5:0,boss:0},
    attackByElement:{},damageByElement:{},damageByJob:{},bossReached:0};
  for(let i=0;i<trials;i++){
    const battles=[];
    const outcome=s.runner.computeOfflineRun(dungeon,0,{
      seed:SEED+i,onBattleFinish:x=>battles.push(x),
      onBattleStep(x){
        for(const ev of x.events){
          if(ev.type!=="damage" || !ev.actor)continue;
          const elementName=ev.element||"neutral";
          result.attackByElement[elementName]=(result.attackByElement[elementName]||0)+1;
          result.damageByElement[elementName]=(result.damageByElement[elementName]||0)+ev.dmg;
          const job=ev.actor.job;
          result.damageByJob[job]=(result.damageByJob[job]||0)+ev.dmg;
        }
      }
    });
    result.totalSeconds+=outcome.seconds;
    if(battles.some(x=>x.boss))result.bossReached++;
    if(outcome.cleared){
      result.clear++;
      const drops=settleDrops(outcome.drops,{enabled:true,rarities:new Set(["n"])});
      result.itemCount+=drops.kept.length;result.stones+=drops.materialGained;
    }else{
      result.fail++;
      result.failedDropLeak+=outcome.drops.length;
      const last=battles.at(-1);
      if(!last||last.won)throw Error("unrecorded failed battle");
      result.wipes[last.boss?"boss":String(last.floor)]++;
    }
  }
  return {...result,clearPct:round(100*result.clear/trials),
    avgSeconds:round(result.totalSeconds/trials),
    avgItems:round(result.itemCount/trials),
    avgStones:round(result.stones/trials),choices};
}
function runStudy(trials=60){
 const rows=[];
 for(const p of PARTY)for(const e of ELEMENT)for(const b of BRANCH)for(const g of GEAR)
   rows.push(measureBuild(p,e,b,g.id,trials));
 return {schema:1,trials,seed:SEED,rows,
   explicitScope:"Native original cave plus hypothetical enemy element recolorings; not live element-dungeon distribution"};
}
if(require.main===module){
 const arg=process.argv.find(x=>x.startsWith("--trials="));
 const r=runStudy(arg?Number(arg.split("=")[1]):60);
 console.log("Elemental matchups and mutually exclusive skill-tree branches; original cave enemy power");
 console.log("party element branch gear cleared% sec/try");
 for(const x of r.rows)console.log([x.partyId,x.element,x.branch,x.gearId,x.clearPct,x.avgSeconds].join(" "));
 console.log("ELEMENT_TREE_STUDY_JSON="+JSON.stringify(r));
}
module.exports={PARTY,ELEMENT,BRANCH,GEAR,SEED,measureBuild,runStudy};

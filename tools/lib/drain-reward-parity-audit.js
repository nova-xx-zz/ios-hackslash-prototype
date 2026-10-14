"use strict";
// 実定義のスキル・装備OP、実戦 battle.js、通常/オフラインのRunnerを用いた監査。
// プレビューゲームのバランス/データは変更せず、読み取った状態を別インスタンスで実行。
const {loadGameData}=require("./load-data.js");
const {createRunner}=require("../../js/model/run.js");
const {createRoster}=require("../../js/model/roster.js");
const {createInventory}=require("../../js/model/inventory.js");
const {createState}=require("../../js/model/save.js");
const {createRng}=require("../../js/core/rng.js");
const Battle=require("../../js/core/battle.js");
const Rewards=require("../../js/core/rewards.js");
const Audit=require("./real-option-cap-audit.js");
const Soft=require("./soft-cap-real-data.js");

const fixedRng={
 float:(min,max)=>(min+max)/2,
 chance:()=>false,
 pick:a=>a[0],
 int:()=>0,
 next:()=>.5
};
function game(data=loadGameData(),opts={}){
 const state=createState({teamCount:4});
 const rng=createRng(opts.seed||2048);
 let runner;
 const roster=createRoster({data,state,
  runBuffs:team=>runner?runner.runBuffs(team):null,
  isTeamLocked:team=>runner?runner.isTeamLocked(team):false});
 const inventory=createInventory({data,state,roster,rng,isFeatureEnabled:data.isFeatureEnabled});
 let filter={enabled:true,rarities:new Set(["n"])};
 runner=createRunner({data,state,roster,inventory,rng,teamCount:4,
  battleEnv:()=>({
   rng,atbRate:7,stats:roster.computeStats,
   abilities:c=>roster.availableAbilities(c).filter(a=>roster.isSkillActive(c,a.id)),
   mpCost:(c,a)=>a.mpCost,
   tier:()=>2,
   passives:c=>({
    lifesteal:roster.racePassive(c,"lifesteal")+roster.treePassive(c,"lifesteal"),
    healBonus:roster.racePassive(c,"healBonus")+roster.treePassive(c,"healBonus"),
    critBonus:roster.racePassive(c,"critBonus")+roster.treePassive(c,"critBonus"),
    dmgTakenMult:(roster.racePassive(c,"dmgTakenMult")||1)*(roster.treePassive(c,"dmgTakenMult")||1)
   })
  }),
  autoDisassemble:()=>filter,
  now:()=>1_000_000_000_000
 });
 const members=[];
 for(let i=0;i<5;i++){
  const member=roster.newCharacter("監査メンバー"+i,"warrior","human",{team:0,level:1});
  members.push(member);
 }
 state.roster=members;
 function equipPartyOptions(key,value){
  const base=data.ITEM_BASES.find(b=>b.key==="bronze_sword");
  if(!base)throw Error("Missing real bronze_sword");
  for(let i=0;i<members.length;i++){
   members[i].equip.main={
    ...base,id:"audit-equip-"+i,rarity:"r",
    options:[{key,value}],stats:{...(base.stats||{})},plus:0
   };
  }
 }
 const setFilter=v=>{filter=v;};
 return {data,state,roster,inventory,runner,members,equipPartyOptions,setFilter,getFilter:()=>filter};
}
function realAbilityDrain(data=loadGameData(),count=0){
 const row=Audit.snapshot(data,"drain",count);
 const ability=data.JOBS[row.job].abilities.find(a=>a.id===row.abilityId);
 if(!ability||typeof ability.lifesteal!=="number")throw Error("Missing real drain ability");
 const actualPassive=row.raw-ability.lifesteal;
 const character={id:"hero",name:"吸収ビルド",job:row.job,hp:100,mp:1000,
  alive:true,atb:100};
 const stats={maxHp:1000,maxMp:1000,atk:150,mag:80,def:40,spd:30};
 const enemy={id:"enemy",name:"監査ダミー",key:"dummy",hp:999999,maxHp:999999,
  alive:true,def:0,atk:1,spd:1,atb:0};
 const env={rng:fixedRng,stats:()=>stats,abilities:()=>[ability],
  mpCost:(_,a)=>a.mpCost,tier:()=>3,atbRate:7,
  passives:()=>({lifesteal:actualPassive,healBonus:0,critBonus:0,dmgTakenMult:1})};
 const events=[];
 Battle.performCharacterAction(character,[character],{enemies:[enemy]},env,events);
 const hits=events.filter(e=>e.type==="damage");
 if(!hits.length||hits.some(e=>e.ability.id!==ability.id))throw Error("Real drain ability was not used");
 const damage=hits.reduce((n,e)=>n+e.dmg,0);
 const reported=hits.reduce((n,e)=>n+e.drained,0);
 const healed=character.hp-100;
 const baseline=Soft.compare(data).find(x=>x.build==="drain");
 return {abilityId:ability.id,abilityLifesteal:ability.lifesteal,
  options:count,passive:actualPassive,total:row.raw,damage,
  reportedDrained:reported,actualHealed:healed,maxHp:stats.maxHp,
  theoreticalRate:reported/damage,
  baselineNoOption:baseline.options[0].raw,
  hard:baseline.options.find(x=>x.optionCount===count).hard,
  softA:baseline.options.find(x=>x.optionCount===count).conservative,
  softB:baseline.options.find(x=>x.optionCount===count).generous};
}
function rewardScenario(data=loadGameData(),options={}){
 const normal=game(data,{seed:11}),offline=game(data,{seed:11});
 const expOP=options.expOP===undefined?.2:options.expOP;
 const materialOP=options.materialOP===undefined?.2:options.materialOP;
 // 各メンバーに実在するexp/material OPを1本の武器へ設定（現行Extra 2～3OPの範囲内）
 const addRealGear=g=>{
  const base=data.ITEM_BASES.find(b=>b.key==="bronze_sword");
  for(let i=0;i<g.members.length;i++)g.members[i].equip.main={
   ...base,id:"reward-equip-"+i,rarity:"r",plus:0,
   options:[{key:"exp",value:expOP},{key:"material",value:materialOP}]
  };
 };
 addRealGear(normal);addRealGear(offline);
 const bonus=normal.roster.partyBonus(0,"expBonus");
 const materialBonus=normal.roster.partyBonus(0,"materialBonus");
 const enemy=data.getEnemyTemplate("slime");
 if(!enemy)throw Error("Missing real slime enemy data");
 const exp=Number.isFinite(enemy.exp)?enemy.exp:9;
 // 通常では実Runner.winBattle、オフラインでは実Runner.applyOfflineRunで
 // 同一戦闘EXPを適用（端末用報酬パイプラインの違いのみ）。
 const run=normal.runner.startRun(0,"plains");
 const aliveIndex=options.koIndex;
 if(Number.isInteger(aliveIndex)){
  normal.members[aliveIndex].alive=false;
  offline.members[aliveIndex].alive=false;
 }
 const beforeN=normal.members.map(c=>normal.roster.totalExpInvested(c));
 normal.runner.winBattle(run,{enemies:[{...enemy,key:enemy.key||"slime",exp}]});
 const nExp=normal.members.map((c,i)=>normal.roster.totalExpInvested(c)-beforeN[i]);
 const oBefore=offline.members.map(c=>offline.roster.totalExpInvested(c));
 offline.runner.applyOfflineRun({cleared:false,expByBattle:[exp],
  eligibleIdsByBattle:[offline.members.filter(c=>c.alive).map(c=>c.id)],drops:[],encountered:[],tame:null},
   data.getDungeon("plains"),0);
 const oExp=offline.members.map((c,i)=>offline.roster.totalExpInvested(c)-oBefore[i]);
 // 同じ本物の自動分解 + partyMaterial補正（両方とも出撃時の設定を用いる）。
 const base=data.ITEM_BASES.find(b=>b.key==="bronze_sword");
 const rarity=data.RARITIES.find(r=>r.key==="n");
 const makeDrop=()=>Rewards.createItem(base,rarity,"audit-loot",{level:1});

 const nItem=makeDrop();
 const oItem=makeDrop();
 const normalSettled=normal.inventory.receiveDrops([nItem],normal.getFilter(),1+materialBonus);
 const offlineSettled=offline.inventory.receiveDrops([oItem],offline.getFilter(),1+materialBonus);
 return {
  exp,expOP,materialOP,partyExpBonus:bonus,partyMaterialBonus:materialBonus,
  expectedPerMember:Math.round(Rewards.expForMember(exp,1)*(1+bonus)),
  onlineMemberExp:nExp,offlineMemberExp:oExp,
  normalMaterial:normalSettled.materialGained,
  offlineMaterial:offlineSettled.materialGained,
  baseMaterial:rarity.material,
  normalLootKept:normalSettled.kept.length,
  offlineLootKept:offlineSettled.kept.length
 };
}
function changedFilterScenario(data=loadGameData()){
 const normal=game(data,{seed:31}),offline=game(data,{seed:31});
 const base=data.ITEM_BASES.find(b=>b.key==="bronze_sword");
 const rarity=data.RARITIES.find(r=>r.key==="n");
 const create=id=>Rewards.createItem(base,rarity,id,{level:1});
 const run=normal.runner.startRun(0,"plains");
 // 出撃後に設定を変更しても、通常・オフラインとも出撃時の設定を使う。
 normal.setFilter({enabled:true,rarities:new Set()});
 offline.setFilter({enabled:true,rarities:new Set()});
 run.pendingDrops=[create("online-drop")];
 normal.runner.finishRun(run,true);
 offline.runner.applyOfflineRun({
  cleared:true,expByBattle:[],encountered:[],drops:[create("offline-drop")],tame:null
 },data.getDungeon("plains"),0,{
  enabled:run.autoDisassemble,rarities:new Set(run.autoDisassembleRarities)
 });
 return {
  normalMaterial:normal.state.material,
  offlineMaterial:offline.state.material,
  normalKept:normal.state.inventory.length,
  offlineKept:offline.state.inventory.length,
  originalFilter:[...run.autoDisassembleRarities],
  currentFilter:[...normal.getFilter().rarities]
 };
}
module.exports={game,realAbilityDrain,rewardScenario,changedFilterScenario};

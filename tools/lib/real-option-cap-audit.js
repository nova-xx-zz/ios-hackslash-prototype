"use strict";
// 現行 js/data.js / js/options.js の実値を読み、SP・前提・分岐・装備適性を満たす
// Lv99ビルドを試作上限と比較するNode用監査。戦闘処理・本体セーブへは接続しない。
const { loadGameData } = require("./load-data.js");
const Stack = require("../../js/core/option-stack-trial.js");

const DEFINITIONS = Object.freeze({
  crit: { name:"会心特化", job:"ninja", race:"beastkin", series:"abyss", op:"crit",
    exclusive:["r2","r4b","r7a","r10b"], general:{slot1:{tree:"offense",nodes:["go1","go2a","go4"]}},
    ability:null, focus:"critChance" },
  drain: { name:"HP吸収特化", job:"darkknight", race:"nocturne", series:"dragon", op:"lifesteal",
    exclusive:["d2","d4b","d7b"], general:{slot2:{tree:"vampiric",nodes:["gv1","gv2a","gv3","gv5"]}},
    ability:"drain", focus:"totalLifesteal" },
  defense: { name:"被ダメ軽減特化", job:"warrior", race:"giant", series:"holy", op:"guard",
    exclusive:["w4a","w7a"],general:{slot2:{tree:"defense",nodes:["gd2a","gd5"]}},
    ability:null, focus:"damageReduction" },
  heal: { name:"回復特化", job:"archpriest", race:"spiritkin", series:"silver", op:"heal",
    exclusive:["h2","h4a","h7a"],general:{slot3:{tree:"support",nodes:["gu1","gu2a","gu3"]}},
    ability:null, focus:"healBonus" },
  material: { name:"強化石特化", job:"thief", race:"human", series:"steel", op:"material",
    exclusive:[],general:{},ability:null,focus:"materialBonus" },
  exp: { name:"経験値特化", job:"priest", race:"sylvan", series:"silver", op:"exp",
    exclusive:[],general:{},ability:null,focus:"expBonus" },
  mp: { name:"消費MP軽減特化", job:"mage", race:"artisan", series:"mithril", op:"thrift",
    exclusive:["m2","m10a"],general:{slot3:{tree:"arcane",nodes:["ga2b","ga4"]}},
    ability:null,focus:"mpReduction" }
});
const MAX_LEVEL=99, MAX_SP=MAX_LEVEL-1;
const PASSIVE_KEYS=new Set(Stack.KEYS);
function selectNodes(tree, requested, level) {
  if(!tree||!Array.isArray(tree.nodes))throw Error("Unknown skill tree");
  const nodes=new Map(tree.nodes.map(n=>[n.id,n]));
  const selected=new Map(), pending=new Set();
  function add(id) {
    if(selected.has(id))return;
    if(pending.has(id))throw Error("Circular skill dependency: "+id);
    const n=nodes.get(id);
    if(!n)throw Error("Unknown skill node "+id+" in "+tree.id);
    if((n.reqLevel||1)>level)throw Error("Skill requires a higher level: "+id);
    if(n.maxRank!==1)throw Error("Audit requires a single-rank skill node: "+id);
    pending.add(id);
    for(const pre of n.prerequisites||[]){
      if(pre.minRank!==1)throw Error("Unsupported skill prerequisite rank");
      add(pre.nodeId);
    }
    pending.delete(id);
    if(n.exclusiveGroup){
      const conflict=[...selected.values()].find(x=>x.exclusiveGroup===n.exclusiveGroup&&x.id!==n.id);
      if(conflict)throw Error("Exclusive skill nodes conflict: "+id+" and "+conflict.id);
    }
    selected.set(id,n);
  }
  requested.forEach(add);
  const skills=[...selected.values()];
  const cost=skills.reduce((sum,node)=>sum+node.costByRank[0],0);
  const accessories=skills.flatMap(n=>n.effects||[]).filter(e=>e.type==="equipSlot"&&e.slot==="accessory")
    .reduce((sum,e)=>sum+e.value,0);
  return {skills,cost,accessories};
}
function mappedPassives(effects){
  const passives={};
  for(const [k,v] of Object.entries(effects||{})){
    if(PASSIVE_KEYS.has(k) && v!==undefined)passives[k]=v;
  }
  return passives;
}
function fromNode(tree,node){
  const effects={};
  for(const e of node.effects||[]) {
    if(!PASSIVE_KEYS.has(e.key))continue;
    if(e.type==="passiveAdd")effects[e.key]=(effects[e.key]||0)+e.value;
    if(e.type==="passiveMult")effects[e.key]=(effects[e.key]===undefined?1:effects[e.key])*e.value;
  }
  return {id:tree.id+":"+node.id,label:tree.name+" / "+node.name,effects};
}
function source(id,label,effects){return {id,label,effects:{...effects}};}
function chooseGear(data,job,series) {
  const profile=data.JOB_EQUIP[job];
  if(!profile)throw Error("Unknown job equipment profile: "+job);
  const fromSlot=(slot,allowed)=>data.ITEM_BASES.find(b=>b.series===series && b.slot===slot&&allowed.includes(b.type));
  const weapon=fromSlot("weapon",profile.weapons);
  const head=fromSlot("head",profile.head);
  const body=fromSlot("body",profile.body);
  const accessory=data.ITEM_BASES.filter(b=>b.series===series&&b.slot==="accessory").slice(0,3);
  if(!weapon||!head||!body||accessory.length!==3)throw Error("Invalid six-piece set for "+job+"/"+series);
  return [weapon,head,body,...accessory];
}
function snapshot(data,name,optionCount=6,level=MAX_LEVEL) {
  const build=DEFINITIONS[name];
  if(!build)throw Error("Unknown audit build: "+name);
  if(![0,2,6].includes(optionCount))throw RangeError("Options must be 0, 2 or 6");
  if(!Number.isInteger(level)||level<1||level>99)throw RangeError("Invalid character level");
  const tag=data.jobTag(build.job);
  const tree=data.EXCLUSIVE_TREES[tag];
  // 6部位のセットには装飾品3枠が必要。解除条件も含めSPを消費する。
  const unlocks=tree.nodes.filter(n=>(n.effects||[]).some(e=>e.type==="equipSlot"&&e.slot==="accessory"));
  if(unlocks.length<2)throw Error("Missing accessory slot unlocks");
  const selections=[{tree,...selectNodes(tree,build.exclusive.concat(unlocks.map(n=>n.id)),level)}];
  for(const slot of data.GENERAL_SLOTS){
    const choice=build.general[slot.key]||{tree:slot.defaultTreeId,nodes:[]};
    if(!slot.candidates.includes(choice.tree))throw Error("General tree cannot be equipped to "+slot.key);
    const target=data.GENERAL_TREES[choice.tree];
    selections.push({tree:target,...selectNodes(target,choice.nodes,level)});
  }
  const usedSP=selections.reduce((sum,sel)=>sum+sel.cost,0);
  if(usedSP>level-1)throw Error("Build exceeds available SP: "+usedSP+" > "+(level-1));
  const availableAccessories=1+selections.reduce((n,s)=>n+s.accessories,0);
  if(availableAccessories<3)throw Error("Build has insufficient accessory slots");
  const gear=chooseGear(data,build.job,build.series);
  const opDef=data.ITEM_OPTIONS.find(op=>op.key===build.op);
  if(!opDef||!opDef.range||!opDef.range.extra)throw Error("Option is missing an extra-mode range: "+build.op);
  const opMax=opDef.range.extra[1];
  const sources=[];
  const race=data.RACES[build.race];
  if(!race)throw Error("Unknown character race");
  sources.push(source("race",race.name+"（種族）",mappedPassives(race.passive)));
  const series=data.ITEM_SERIES.find(s=>s.key===build.series);
  if(!series)throw Error("Unknown set series");
  for(const bonus of series.setBonus||[]){
    if(gear.length>=bonus.count)sources.push(source("set:"+bonus.count,series.name+bonus.count+"点セット",mappedPassives(bonus.passives)));
  }
  for(const sel of selections){
    for(const node of sel.skills){
      const eff=fromNode(sel.tree,node);
      if(Object.keys(eff.effects).length)sources.push(eff);
    }
  }
  for(let i=0;i<optionCount;i++){
    const item=gear[i],opEffect=data.itemOptionEffect({key:build.op,value:opMax});
    sources.push(source("op:"+i,item.name+" / "+build.op+"（Extra最高値）",mappedPassives(opEffect.passives)));
  }
  const ability=build.ability?data.JOBS[build.job].abilities.find(a=>a.id===build.ability):null;
  if(build.ability&&!ability)throw Error("Job ability is missing: "+build.ability);
  const result=Stack.compute({sources,abilityLifesteal:ability?.lifesteal||0});
  return {build:name,name:build.name,job:build.job,jobName:data.JOBS[build.job].name,race:build.race,raceName:race.name,
    series:build.series,seriesName:series.name,gearBases:gear.map(g=>g.key),
    opKey:build.op,opMax,optionCount,level,usedSP,maxSP:level-1,accessorySlots:availableAccessories,
    skillIds:selections.map(sel=>({tree:sel.tree.id,ids:sel.skills.map(n=>n.id),cost:sel.cost})),
    abilityId:ability?.id||null,abilityLifesteal:ability?.lifesteal||0,
    focus:build.focus,raw:result.raw[build.focus],effective:result.effective[build.focus],
    cap:result.details.find(d=>d.key===build.focus).cap,capped:result.capped.includes(build.focus),
    sources:result.sources,details:result.details};
}
function audit(data=loadGameData()){
 return Object.keys(DEFINITIONS).map(name=>({
  build:name,
  cases:[0,2,6].map(count=>snapshot(data,name,count))
 }));
}
module.exports={DEFINITIONS,MAX_LEVEL,MAX_SP,selectNodes,chooseGear,snapshot,audit};

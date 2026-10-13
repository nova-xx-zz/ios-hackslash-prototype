// 複数装備・職業・スキル・シリーズの同種OPが重なる場合の上限案。
// 純粋な試作比較。現行戦闘・本体セーブ・課金には接続しない。
(function(root){
"use strict";
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const CAPS=Object.freeze({
 critChance:.75, passiveLifesteal:.30, totalLifesteal:.80,
 damageReduction:.60, healBonus:1.00, materialBonus:.50, expBonus:.50,
 mpReduction:.60
});
const KEYS=Object.freeze(["critBonus","lifesteal","dmgTakenMult","healBonus","materialBonus","expBonus","mpCostMult"]);
const LABELS=Object.freeze({
 critChance:"会心率",passiveLifesteal:"通常のHP吸収",totalLifesteal:"技込みHP吸収",
 damageReduction:"被ダメージ軽減",healBonus:"回復量",materialBonus:"強化石獲得",
 expBonus:"経験値獲得",mpReduction:"消費MP軽減"
});
function source(id,label,effects){
 return {id,label,effects:{...effects}};
}
function validateSources(sources,ability){
 if(!Array.isArray(sources)||sources.length>30)throw new TypeError("sources must be a list of <=30");
 const ids=new Set();
 for(const s of sources){
  if(!s||typeof s.id!=="string"||!s.id||ids.has(s.id)||typeof s.label!=="string"||
   !s.label||!s.effects||typeof s.effects!=="object"||Array.isArray(s.effects))throw new TypeError("Invalid effect source");
  ids.add(s.id);
  for(const [key,val] of Object.entries(s.effects)){
   if(!KEYS.includes(key)||typeof val!=="number"||!Number.isFinite(val))throw new RangeError("Invalid effect: "+key);
   if(key==="dmgTakenMult"||key==="mpCostMult"){
    if(val<0||val>2)throw new RangeError("Invalid multiplier: "+key);
   }else if(val<0||val>2)throw new RangeError("Invalid passive bonus: "+key);
  }
 }
 if(typeof ability!=="number"||!Number.isFinite(ability)||ability<0||ability>1)
   throw new RangeError("Invalid ability lifesteal");
}
const clamp=(x,max)=>Math.max(0,Math.min(x,max));
function compute(options){
 const cfg=options||{};
 const sources=cfg.sources||[];
 const ability=cfg.abilityLifesteal===undefined?0:cfg.abilityLifesteal;
 validateSources(sources,ability);
 const sums={critBonus:0,lifesteal:0,healBonus:0,materialBonus:0,expBonus:0};
 let damageMult=1,mpMult=1;
 for(const s of sources){
  for(const key of Object.keys(sums)) sums[key]+=s.effects[key]||0;
  damageMult*=s.effects.dmgTakenMult===undefined?1:s.effects.dmgTakenMult;
  mpMult*=s.effects.mpCostMult===undefined?1:s.effects.mpCostMult;
 }
 const raw={
  critChance:.10+sums.critBonus,
  passiveLifesteal:sums.lifesteal,
  totalLifesteal:sums.lifesteal+ability,
  damageReduction:1-damageMult,
  healBonus:sums.healBonus,
  materialBonus:sums.materialBonus,
  expBonus:sums.expBonus,
  mpReduction:1-mpMult
 };
 // 丸めは表示のみ。上限を適用するのは積算後、技固有吸収は別途合算後の上限も課す。
 const effective={
  critChance:clamp(raw.critChance,CAPS.critChance),
  passiveLifesteal:clamp(raw.passiveLifesteal,CAPS.passiveLifesteal),
  totalLifesteal:clamp(clamp(raw.passiveLifesteal,CAPS.passiveLifesteal)+ability,CAPS.totalLifesteal),
  damageReduction:Math.min(raw.damageReduction,CAPS.damageReduction),
  healBonus:clamp(raw.healBonus,CAPS.healBonus),
  materialBonus:clamp(raw.materialBonus,CAPS.materialBonus),
  expBonus:clamp(raw.expBonus,CAPS.expBonus),
  mpReduction:Math.min(raw.mpReduction,CAPS.mpReduction)
 };
 const details=Object.keys(effective).map(key=>({
  key,label:LABELS[key],raw:raw[key],effective:effective[key],
  cap:key==="passiveLifesteal"?CAPS.passiveLifesteal:key==="totalLifesteal"?CAPS.totalLifesteal:CAPS[key],
  limited:raw[key]>effective[key]+1e-10
 }));
 return {sources:sources.map(s=>({id:s.id,label:s.label,effects:{...s.effects}})),
  abilityLifesteal:ability,raw,effective,details,
  damageTakenMultiplier:1-effective.damageReduction,
  mpCostMultiplier:1-effective.mpReduction,
  capped:details.filter(d=>d.limited).map(d=>d.key)};
}
const PRESETS=Object.freeze({
 offense:Object.freeze({name:"会心特化",gearEffect:{critBonus:.05},
  other:[
   source("job","職業パッシブ",{critBonus:.12}),
   source("race","種族パッシブ",{critBonus:.08}),
   source("tree","スキルツリー",{critBonus:.30})
  ],abilityLifesteal:0}),
 drain:Object.freeze({name:"吸収特化",gearEffect:{lifesteal:.04},
  other:[
   source("job","職業パッシブ",{lifesteal:.10}),
   source("race","種族パッシブ",{lifesteal:.05}),
   source("tree","スキルツリー",{lifesteal:.12})
  ],abilityLifesteal:.60}),
 tank:Object.freeze({name:"防御特化",gearEffect:{dmgTakenMult:.94},
  other:[
   source("job","職業パッシブ",{dmgTakenMult:.70}),
   source("race","種族パッシブ",{dmgTakenMult:.90}),
   source("tree","スキルツリー",{dmgTakenMult:.60})
  ],abilityLifesteal:0}),
 support:Object.freeze({name:"周回・回復特化",gearEffect:{healBonus:.20,materialBonus:.18,expBonus:.10},
  other:[
   source("job","職業パッシブ",{healBonus:.20,materialBonus:.10}),
   source("race","種族パッシブ",{expBonus:.15}),
   source("tree","スキルツリー",{healBonus:.30,materialBonus:.15,expBonus:.20})
  ],abilityLifesteal:0})
});
const GEAR_LABELS=Object.freeze(["武器","胴装備","頭装備","装飾品1","装飾品2"]);
function scenario(preset,gearCount,talents){
 if(!own(PRESETS,preset))throw RangeError("Unknown preset");
 if(![1,3,5].includes(gearCount))throw RangeError("Invalid equipment count");
 if(typeof talents!=="boolean")throw TypeError("Invalid talent toggle");
 const p=PRESETS[preset];
 const gear=GEAR_LABELS.slice(0,gearCount).map((label,i)=>source("equip"+i,label+"（LR相当の試験OP）",p.gearEffect));
 return compute({sources:talents?gear.concat(p.other):gear,abilityLifesteal:talents?p.abilityLifesteal:0});
}
const api={CAPS,KEYS,LABELS,PRESETS,GEAR_LABELS,compute,scenario};
root.QPCore=root.QPCore||{};root.QPCore.optionStackTrial=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);

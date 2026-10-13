// 試作工房v2: 旧抽出・継承ルールを属性10種/OP総枠の純粋関数に接続。
// メインセーブ・課金・本体戦闘には未接続。
(function(root){
"use strict";
const core=root.QPCore||{};
const Legacy=core.optionInheritanceTrial||(typeof require==="function"?require("./option-inheritance-trial.js"):null);
const Slots=core.optionSlotsTrial||(typeof require==="function"?require("./option-slots-trial.js"):null);
const Elements=core.elementAffinityTrial||(typeof require==="function"?require("./element-affinity-trial.js"):null);
if(!Legacy||!Slots||!Elements)throw Error("forge trial dependencies required");
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const VALUES={atk:.05,crit:.10,reverse:1,void:1,guard:.03};
const ELEMENT_BY_RARITY={n:"wood",r:"fire",sr:"fire",ur:"wood",lr:"void"};
const fail=(message)=>({ok:false,message});
const option=(key,sourceRarity)=>({key,value:VALUES[key],rank:Legacy.OP_DEFS[key].rarity,
 special:!!Legacy.OP_DEFS[key].special,origin:sourceRarity?"inherited":"natural",
 ...(sourceRarity?{sourceItemRarity:sourceRarity}:{}),
 ...(key==="reverse"?{reversalTarget:"earth"}:{})});
function extend(s,initial){
 s.version=2;
 for(const t of s.targets){
  t.attackElement=ELEMENT_BY_RARITY[t.rarity];
  t.naturalOptions=initial&&t.id==="sr"?[option("guard")]:[];
  t.options=t.options.map(o=>({...o,...option(o.key,o.sourceRarity),inherited:true,sourceRarity:o.sourceRarity}));
 }
 for(const w of s.sources){
  w.attackElement=ELEMENT_BY_RARITY[w.rarity];
  w.optionValue=w.optionKey?VALUES[w.optionKey]:null;
 }
 for(const e of s.essences){
  e.value=VALUES[e.key];e.rank=e.optionRarity;
 }
 return s;
}
function createDemo(){return extend(Legacy.createDemo(),true);}
function upgradeFromV1(data){
 if(!Legacy.isValidDemoState(data))return null;
 const copy=JSON.parse(JSON.stringify(data));
 const upgraded=extend(copy,false);
 return isValid(upgraded)?upgraded:null;
}
function targetOf(s,id){return s.targets.find(t=>t.id===id);}
function makeItem(t){
 return {id:t.id,rarity:t.rarity,plus:t.plus,sockets:{opened:t.opened},
  options:[...t.naturalOptions,...t.options.map(o=>({...o,origin:"inherited",sourceItemRarity:o.sourceRarity}))]};
}
function inspect(t){return Slots.inspect(makeItem(t));}
function addSamples(s){
 const start=s.sources.length,r=Legacy.addSamples(s);
 if(!r.ok)return r;
 for(const w of s.sources.slice(start)){
  w.attackElement=ELEMENT_BY_RARITY[w.rarity];w.optionValue=VALUES[w.optionKey];
 }
 return {ok:true,message:"天然OP付きの武器を試遊用に5本補充しました"};
}
function enhance(s,id,plus){return Legacy.increasePlus(s,id,plus);}
function openSocket(s,id){
 const t=targetOf(s,id);if(!t)return fail("武器がありません");
 const next=Slots.openNextSocket(makeItem(t));
 if(!next.ok){
  return fail(next.reason==="full"?"天然OPと継承OPが満枠です。天然OPを抽出してください":
   next.reason==="enhance_first"?"先に+"+next.requiredPlus+"まで強化してください":"穴あけ上限です");
 }
 t.opened=next.item.sockets.opened;
 return {ok:true,message:t.name+"の穴を"+t.opened+"枠にしました"};
}
function extractSource(s,id){
 const w=s.sources.find(x=>x.id===id);if(!w)return fail("抽出する武器がありません");
 const key=w.optionKey,value=w.optionValue;
 // 元武器の天然OPだけ取り外す判定を共通化する。
 if(!key)return fail("天然OPがありません");
 const candidate={rarity:w.rarity,plus:0,sockets:{opened:0},options:[option(key)]};
 const removed=Slots.extractNatural(candidate,0);
 if(!removed.ok)return fail("天然OPを抽出できません");
 const r=Legacy.extract(s,id);if(!r.ok)return r;
 const e=s.essences[s.essences.length-1];
 e.rank=e.optionRarity;e.value=value;
 w.optionValue=null;
 return r;
}
function extractTarget(s,id,index){
 const t=targetOf(s,id);if(!t)return fail("武器がありません");
 if(!Number.isInteger(index)||index<0||index>=t.naturalOptions.length)return fail("天然OPを選択してください");
 const result=Slots.extractNatural(makeItem(t),index);
 if(!result.ok)return fail("継承済みOPは再抽出できません");
 if(s.essences.length>=55)return fail("抽出液の保管数が上限です");
 const o=t.naturalOptions.splice(index,1)[0];
 s.essences.push({id:"ess_"+(++s.seq),key:o.key,value:o.value,rank:o.rank,optionRarity:o.rank,
  sourceRarity:t.rarity,count:Legacy.EXTRACT_COUNT[o.rank]});
 return {ok:true,message:t.name+"の天然OPを抽出しました。武器本体・強化値・穴は維持されます"};
}
function validate(s,id,essenceId,paid){
 const t=targetOf(s,id),e=s.essences.find(x=>x.id===essenceId);
 if(!t||!e||!own(VALUES,e.key))return fail("武器または抽出液がありません");
 if(e.rank!==Legacy.OP_DEFS[e.key].rarity||e.optionRarity!==e.rank||
   !Number.isFinite(e.value)||e.value<0||e.value>10||e.count!==Legacy.EXTRACT_COUNT[e.rank])
   return fail("抽出液の品質または個数が不正です");
 const checked=Slots.validateInheritance(makeItem(t),
  {key:e.key,value:e.value,rank:e.rank,sourceItemRarity:e.sourceRarity,
   special:!!Legacy.OP_DEFS[e.key].special});
 if(!checked.ok){
  const msg={full:"天然OPと継承OPの合計上限です",needs_socket:"空き穴を解放してください",
   duplicate:"天然OP・継承OPと重複しています",special_limit:"特殊OPは最大1つです",
   lower_to_higher_only:"下位レアの武器から上位の武器にのみ継承できます"};
  return fail(msg[checked.reason]||"継承できません");
 }
 const previous=Legacy.validate(s,id,essenceId,paid);
 if(!previous.ok)return previous;
 if(paid&&Legacy.PITY_LIMIT[id]!==undefined&&t.failures>=Legacy.PITY_LIMIT[id])
   return fail("天井到達済みなので確定継承液は不要です");
 return previous;
}
function inherit(s,id,essenceId,paid,random){
 const checked=validate(s,id,essenceId,paid);if(!checked.ok)return checked;
 const e=checked.essence;const value=e.value,rank=e.rank;
 const r=Legacy.inherit(s,id,essenceId,paid,random);
 if(r.ok&&r.success){
  const t=targetOf(s,id),last=t.options[t.options.length-1];
  Object.assign(last,{...option(last.key,last.sourceRarity),value,rank,sourceRarity:last.sourceRarity,inherited:true});
 }
 return r;
}
function setElement(s,id,element){
 const t=targetOf(s,id);if(!t||!own(Elements.ELEMENTS,element))return fail("属性が不正です");
 t.attackElement=element;return {ok:true,message:t.name+"の試作属性を"+Elements.ELEMENTS[element]+"に変更しました"};
}
function compare(s,id,enemyElement){
 const t=targetOf(s,id);if(!t||!own(Elements.ELEMENTS,enemyElement))throw Error("Unknown target/element");
 const hasReverse=makeItem(t).options.some(o=>o.key==="reverse");
 const props={attackElement:t.attackElement,defenseElement:enemyElement,
  ...(hasReverse?{reversalTarget:"earth"}:{})};
 return [
  {label:"通常",...Elements.resolve(props)},
  {label:"虚無抑制",...Elements.resolve({...props,dungeon:{voidMultiplier:.7}})},
  {label:"虚無無効",...Elements.resolve({...props,enemy:{immuneElements:["void"]}})}
 ];
}
// v1の既存チェック＋v2追加フィールドを検証。商用の不正防止には使わない。
function isValid(s){
 try{
  if(!s||s.version!==2)return false;
  if(!Legacy.isValidDemoState({...s,version:1}))return false;
  for(const t of s.targets){
   if(!own(Elements.ELEMENTS,t.attackElement)||!Array.isArray(t.naturalOptions)||t.naturalOptions.length>4)return false;
   for(const o of t.naturalOptions){
    if(!o||!own(VALUES,o.key)||o.origin!=="natural"||o.rank!==Legacy.OP_DEFS[o.key].rarity||
      !Number.isFinite(o.value)||o.value<0||o.value>10)return false;
   }
   for(const o of t.options){
    if(o.origin!=="inherited"||o.rank!==Legacy.OP_DEFS[o.key].rarity||
     !Number.isFinite(o.value)||o.value<0||o.value>10)return false;
   }
   const keys=new Set(),all=makeItem(t).options;let special=0;
   for(const o of all){if(keys.has(o.key))return false;keys.add(o.key);if(Legacy.OP_DEFS[o.key].special)special++;}
   if(special>1)return false;
   const summary=inspect(t);
   if(summary.overCapacity>0)return false;
  }
  for(const w of s.sources){
   if(!own(Elements.ELEMENTS,w.attackElement)||!(w.optionValue===null||
       Number.isFinite(w.optionValue)&&w.optionValue>=0&&w.optionValue<=10))return false;
   if((w.optionKey===null)!==(w.optionValue===null))return false;
  }
  for(const e of s.essences){
   if(e.rank!==e.optionRarity||!Number.isFinite(e.value)||e.value<0||e.value>10)return false;
  }
  return true;
 }catch(_){return false;}
}
const api={createDemo,upgradeFromV1,isValid,addSamples,enhance,openSocket,extractSource,
 extractTarget,validate,inherit,inspect,setElement,compare,
 OP_DEFS:Legacy.OP_DEFS,SLOT_LEVELS:Legacy.SLOT_LEVELS,EXTRACT_COUNT:Legacy.EXTRACT_COUNT,
 RATES:Legacy.RATES,PITY_LIMIT:Legacy.PITY_LIMIT,ELEMENTS:Elements.ELEMENTS,MAX_OPTIONS:Slots.MAX_OPTIONS};
root.QPCore=root.QPCore||{};root.QPCore.forgeGearTrial=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);

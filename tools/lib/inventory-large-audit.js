"use strict";
// 所持品の大量データ監査。実データと既存の保存/分解APIを用いる。
// 実ブラウザのlocalStorage使用可能量やiPhoneの実フレーム速度を保証しない。
const { performance }=require("node:perf_hooks");
const Save=require("../../js/model/save.js");
const {createInventory}=require("../../js/model/inventory.js");
const {createRoster}=require("../../js/model/roster.js");
const {createRng}=require("../../js/core/rng.js");
const Storage=require("../../js/core/storage.js");
const Organize=require("../../js/core/inventory-organize.js");
const {loadGameData}=require("./load-data.js");

const SIZES=Object.freeze([2500,5000,10000]);
function createFixture(count,data=loadGameData()) {
 if(!Number.isInteger(count)||count<1||count>20000)throw RangeError("Invalid fixture size");
 const state=Save.createState({teamCount:4});
 state.roster=[{id:"audit-hero",name:"監査",job:"warrior",race:"human",level:10,
   exp:0,team:0,jobLevels:{},equip:{}}];
 const base=data.ITEM_BASES.find(x=>x.key==="bronze_sword");
 if(!base)throw Error("Missing real base");
 const itemOptions=data.ITEM_OPTIONS.filter(x=>x.key==="exp"||x.key==="material");
 if(itemOptions.length!==2)throw Error("Missing current OP definitions");
 state.inventory=Array.from({length:count},(_,i)=>{
   const op=itemOptions[i%2],high=i%4===0;
   const min=op.range.extra[0],max=op.range.extra[1];
   return {id:"load-"+i,base:base.key,name:base.name,slot:base.slot,
     rarity:i%13===0?"sr":i%3===0?"r":"n",series:base.series,
     stats:{atk:(base.stats&&base.stats.atk)||10},
     plus:i%51===0?5:0,locked:i%73===0,
     materialValue:i%13===0?80:i%3===0?20:5,
     options:[{key:op.key,value:high?max:min}],
   };
 });
 return state;
}
function measure(name,fn){
 const started=performance.now();
 const value=fn();
 return {ms:performance.now()-started,value};
}
function scenario(count,data=loadGameData()){
 const state=createFixture(count,data);
 const serialized=measure("serialize",()=>JSON.stringify(Save.serialize(state,{now:1700000000000})));
 const json=serialized.value;
 const load=measure("deserialize",()=>Save.deserialize(JSON.parse(json),{
   teamCount:4,maxPlus:99,legacyItemBases:data.LEGACY_ITEM_BASES}));
 if(!load.value||load.value.state.inventory.length!==count)throw Error("Save lost inventory");
 const filter=measure("filter",()=>Organize.filter(state.inventory,"all","valuable"));
 const sorted=measure("sort",()=>Organize.sort(state.inventory,data.RARITIES,"power",
   item=>(item.stats&&item.stats.atk)||0));
 const selected=state.inventory.filter(Organize.isSafeBulkCandidate);
 const roster=createRoster({data,state,rng:createRng(99)});
 const inv=createInventory({data,state,roster,rng:createRng(99)});
 const ref=state.inventory;
 const disassembled=measure("dismantle",()=>inv.disassembleItems(selected));
 if(state.inventory!==ref)throw Error("Inventory array identity changed");
 if(disassembled.value.count!==selected.length)throw Error("Wrong dismantle count");
 const removed=new Set(selected);
 if(!state.inventory.every(it=>!removed.has(it)))throw Error("Dismantled gear remained");
 const encodedBytes=Buffer.byteLength(json,"utf8");
 const storageBudget=5*1024*1024;
 const stored=Storage.createStorage(Storage.createMemoryBackend({},storageBudget));
 const store=measure("store",()=>stored.set(Storage.KEYS.save,json));
 return {
   count,serializedChars:json.length,utf8Bytes:encodedBytes,
   // 5MiBは監査用の仮定。ブラウザのlocalStorage容量は端末/実装で変わる。
   underAssumedFiveMiB:store.value,
   ms:{serialize:+serialized.ms.toFixed(2),deserialize:+load.ms.toFixed(2),
     filter:+filter.ms.toFixed(2),sort:+sorted.ms.toFixed(2),
     dismantle:+disassembled.ms.toFixed(2),store:+store.ms.toFixed(2)},
   valuable:filter.value.length,sortedCount:sorted.value.length,
   safeDisassembled:disassembled.value.count,remaining:state.inventory.length,
   protectedCountAfterBulk:state.inventory.filter(Organize.isValuable).length
 };
}
function run(sizes=SIZES){return sizes.map(n=>scenario(n));}
module.exports={SIZES,createFixture,scenario,run};

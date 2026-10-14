"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Organize=require("../js/core/inventory-organize.js");
const Rewards=require("../js/core/rewards.js");
const rarities=[{key:"n",material:5},{key:"r",material:20},{key:"sr",material:80},{key:"ur",material:350},{key:"lr",material:1500}];
const item=(id,changes={})=>({id,slot:"weapon",rarity:"n",materialValue:5,plus:0,options:[],...changes});
test("一括分解候補は低〜中レアの未強化・未保護だけ。古いセーブ形式でも動く",()=>{
 const items=[
  item("plain"), item("old",{options:undefined}), item("common",{rarity:"r"}),
  item("sr",{rarity:"sr"}), item("high",{options:[{key:"material",value:.18}]}),
  item("rank",{naturalOptions:[{key:"future",rank:"lr",value:1}]}),
  item("locked",{locked:true}),item("unique",{unique:true}),item("cursed",{cursed:true}),
  item("enhanced",{plus:1}),item("ur",{rarity:"ur"}),item("lr",{rarity:"lr"}),
  item("inherited",{options:[{key:"crit",rank:"n",origin:"inherited",value:.01}]})
 ];
 const snapshot=JSON.stringify(items);
 assert.deepEqual(items.filter(Organize.isSafeBulkCandidate).map(i=>i.id),["plain","old","common","sr"]);
 assert.deepEqual(items.filter(Organize.isValuable).map(i=>i.id),[
  "high","rank","locked","unique","cursed","enhanced","ur","lr","inherited"
 ]);
 for(const i of items.filter(Organize.isSafeBulkCandidate))assert.equal(Rewards.hasProtectedOption(i),false);
 assert.equal(JSON.stringify(items),snapshot);
});

test("絞り込みはスロット×安全/貴重/ロックを正確に交差し元配列を変更しない",()=>{
 const a=[item("x"),item("y",{slot:"body",rarity:"ur"}),item("z",{slot:"body",locked:true}),item("p",{slot:"body"})];
 const original=a.slice();
 assert.deepEqual(Organize.filter(a,"body","valuable").map(i=>i.id),["y","z"]);
 assert.deepEqual(Organize.filter(a,"all","safe").map(i=>i.id),["x","p"]);
 assert.deepEqual(Organize.filter(a,"body","locked").map(i=>i.id),["z"]);
 assert.deepEqual(Organize.filter(a,"weapon","all").map(i=>i.id),["x"]);
 assert.deepEqual(a,original);
 assert.throws(()=>Organize.filter(a,"all","obsolete"),/Unknown inventory view/);
});

test("レア度・装備能力・分解素材の並び替えを比較、元配列はそのまま",()=>{
 const a=[item("n",{power:80}),item("sr",{rarity:"sr",materialValue:80,power:50}),item("r",{rarity:"r",materialValue:20,power:110})];
 const original=a.slice();
 const score=x=>x.power;
 assert.deepEqual(Organize.sort(a,rarities,"rarity",score).map(x=>x.id),["sr","r","n"]);
 assert.deepEqual(Organize.sort(a,rarities,"power",score).map(x=>x.id),["r","n","sr"]);
 assert.deepEqual(Organize.sort(a,rarities,"materials",score).map(x=>x.id),["sr","r","n"]);
 assert.deepEqual(a,original);
 assert.throws(()=>Organize.sort(a,rarities,"deprecated",score),/Unknown inventory sort/);
});

test("多数アイテムの並び替えは能力値を1件につき1度しか評価せず、元の安定順序を維持",()=>{
 const all=Array.from({length:1000},(_,i)=>item("item-"+i,{rarity:"r",power:12,materialValue:20}));
 let calls=0;
 const sorted=Organize.sort(all,rarities,"power",x=>{calls++;return x.power;});
 assert.equal(calls,all.length);
 assert.deepEqual(sorted,all);
 assert.notEqual(sorted,all);
 assert.equal(all[0].id,"item-0");
});

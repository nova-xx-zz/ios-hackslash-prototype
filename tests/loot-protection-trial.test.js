"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Loot=require("../js/core/loot-protection-trial.js");

test("N装備にSR天然OPが付いていればSR保護設定で残る",()=>{
 const items=Loot.sampleLoot();
 const result=Loot.simulate(items,{enabled:true,rarities:new Set(["n","r"]),protectRareOptions:true,minRank:"sr"});
 assert.deepEqual(result.kept.map(i=>i.id),["demo_n3","demo_n4","demo_r1","demo_sr1","demo_r3"]);
 assert.deepEqual(result.disassembled.map(i=>i.id),["demo_n1","demo_n2","demo_r2"]);
 assert.equal(result.materials,30);
 assert.equal(result.savedByOptions,4);
 assert.equal(items[2].options[0].rank,"sr","試作の元ドロップ情報は変更しない");
});

test("UR以上に変更するとSR天然OPは分解対象に戻る、特殊OPと継承済みは保護",()=>{
 const result=Loot.simulate(Loot.sampleLoot(),{enabled:true,rarities:["n","r"],protectRareOptions:true,minRank:"ur"});
 assert.equal(result.rows.find(x=>x.item.id==="demo_n3").keep,false);
 assert.equal(result.rows.find(x=>x.item.id==="demo_n4").reason,"special_option");
 assert.equal(result.rows.find(x=>x.item.id==="demo_r3").reason,"inherited_option");
 assert.equal(result.savedByOptions,3);
});

test("保護OFFなら従来の分解動作と同じで、既存フィルター・ロックを優先",()=>{
 const items=Loot.sampleLoot();
 const r=Loot.simulate(items,{enabled:true,rarities:["n","r"],protectRareOptions:false});
 assert.equal(r.kept.length,1);
 assert.equal(r.disassembled.length,7);
 assert.equal(r.materials,5+5+5+5+20+20+20);
 const protectedItems=[
  {rarity:"n",unique:true,options:[{key:"x",rank:"lr"}]},
  {rarity:"n",locked:true,options:[{key:"x",rank:"lr"}]}
 ];
 assert.deepEqual(Loot.simulate(protectedItems,{enabled:true,rarities:["n"]}).rows.map(x=>x.reason),["unique","locked"]);
 assert.equal(Loot.simulate(items,{enabled:false,rarities:["n","r"]}).kept.length,8);
});

test("従来の{key,value}だけではランクを推測せず、未知のランクは保護する",()=>{
 const item={rarity:"n",options:[{key:"atk_pct",value:0.10}]};
 assert.equal(Loot.protectionReason(item,"sr"),null);
 assert.equal(Loot.decide(item,{enabled:true,rarities:["n"],protectRareOptions:true}).keep,false);
 const other={rarity:"n",options:[{key:"future_op",rank:"mythic"}]};
 assert.equal(Loot.protectionReason(other,"sr"),"unknown_option_rank");
 assert.equal(Loot.decide(other,{enabled:true,rarities:["n"],protectRareOptions:true}).keep,true);
 assert.throws(()=>Loot.protectionReason(item,"invalid"),/rank/);
});

test("特殊OP・継承済みOPはランクが低くても保護、判定は入力を不変にする",()=>{
 const items=[
  {rarity:"r",options:[{key:"reverse",rank:"r",special:true,origin:"natural"}],materialValue:20},
  {rarity:"r",options:[{key:"atk",rank:"n",origin:"inherited"}],materialValue:20}
 ];
 const before=JSON.stringify(items);
 const r=Loot.simulate(items,{enabled:true,rarities:new Set(["r"]),protectRareOptions:true,minRank:"ur"});
 assert.equal(r.savedByOptions,2);
 assert.equal(r.disassembled.length,0);
 assert.equal(JSON.stringify(items),before);
});


test("保護OFF時の挙動は既存の報酬・自動分解ロジックと完全一致する",()=>{
 const rewards=require("../js/core/rewards.js");
 const drops=Loot.sampleLoot();
 const filter={enabled:true,rarities:new Set(["n","r"])};
 const legacy=rewards.settleDrops(drops,filter);
 const proposed=Loot.simulate(drops,{...filter,protectRareOptions:false});
 assert.deepEqual(proposed.kept.map(i=>i.id),legacy.kept.map(i=>i.id));
 assert.equal(proposed.disassembled.length,legacy.disassembled);
 assert.equal(proposed.materials,legacy.materialGained);
});

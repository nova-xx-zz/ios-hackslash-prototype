"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadGameData}=require("../tools/lib/load-data.js");
const Audit=require("../tools/lib/drain-reward-parity-audit.js");
const Soft=require("../tools/lib/soft-cap-real-data.js");
const data=loadGameData();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,"expected "+b+" got "+a);

test("実定義の暗黒騎士の吸命を本体battle.jsで実行し、装備OPなしの吸収を検証",()=>{
 const basic=Audit.realAbilityDrain(data,0);
 assert.equal(basic.abilityId,"drain");
 near(basic.abilityLifesteal,.6);
 near(basic.passive,.39);
 near(basic.total,.99);
 assert.ok(basic.damage>0);
 assert.ok(basic.reportedDrained>0);
 assert.ok(Math.abs(basic.theoreticalRate-basic.total)<.02,
   "Battle damage-driven absorption should match current raw rate");
 assert.ok(basic.actualHealed>=0 && basic.actualHealed<=900);
 assert.ok(basic.actualHealed<=basic.reportedDrained,
   "actual HP heal is capped at maxHp");
 assert.equal(basic.hard,.8);
 assert.ok(basic.softA>.8);
 assert.ok(basic.softB>basic.softA);
 assert.ok(basic.softB<basic.total,"soft B does not fully protect the existing drain ability");
});

test("実定義の同一HP吸収OPを0/2/6件に増やすと、本体吸収量と提案上限の差を追跡できる",()=>{
 const rows=[0,2,6].map(n=>Audit.realAbilityDrain(data,n));
 assert.deepEqual(rows.map(x=>x.options),[0,2,6]);
 near(rows[0].total,.99);
 near(rows[1].total,1.11);
 near(rows[2].total,1.35);
 assert.ok(rows[2].reportedDrained>rows[1].reportedDrained);
 assert.ok(rows[1].reportedDrained>rows[0].reportedDrained);
 assert.ok(rows[2].softB>rows[1].softB);
 near(rows[0].abilityLifesteal,rows[2].abilityLifesteal);
 assert.equal(data.JOBS.darkknight.abilities.find(a=>a.id==="drain").lifesteal,.6);
});

test("実在のEXP・強化石OPを5人全員で合算しても、通常/オフラインは同倍率を適用",()=>{
 for(const bonus of [0,.2]){
  const row=Audit.rewardScenario(data,{expOP:bonus,materialOP:bonus});
  near(row.partyExpBonus,5*bonus);
  near(row.partyMaterialBonus,5*bonus);
  assert.deepEqual(row.onlineMemberExp,row.offlineMemberExp);
  for(const exp of row.onlineMemberExp) assert.equal(exp,row.expectedPerMember);
  assert.equal(row.normalMaterial,row.offlineMaterial);
  assert.equal(row.normalMaterial,Math.round(row.baseMaterial*(1+row.partyMaterialBonus)));
  assert.equal(row.normalLootKept,0);
  assert.equal(row.offlineLootKept,0);
 }
});

test("戦闘不能者へのEXP付与は通常とオフラインで異なることを実Runnerで検出",()=>{
 const row=Audit.rewardScenario(data,{expOP:.2,materialOP:.2,koIndex:2});
 assert.equal(row.onlineMemberExp[2],0);
 assert.ok(row.offlineMemberExp[2]>0);
 for(const i of [0,1,3,4])assert.equal(row.onlineMemberExp[i],row.offlineMemberExp[i]);
 // この違いは現行仕様として文書化。生存者以外のEXPを黙って統一しない。
});

test("分解設定を出撃後に変えると通常は開始時設定、オフラインは現設定を参照する",()=>{
 const result=Audit.changedFilterScenario(data);
 assert.deepEqual(result.originalFilter,["n"]);
 assert.deepEqual(result.currentFilter,[]);
 assert.equal(result.normalKept,0);
 assert.equal(result.offlineKept,1);
 assert.ok(result.normalMaterial>0);
 assert.equal(result.offlineMaterial,0);
});

test("元のゲームデータを破壊せず、繰り返しても結果が同じ",()=>{
 const original=JSON.stringify(data.ITEM_OPTIONS);
 const a=Audit.rewardScenario(data,{expOP:.2,materialOP:.2});
 const b=Audit.rewardScenario(data,{expOP:.2,materialOP:.2});
 assert.deepEqual(a,b);
 assert.deepEqual(Audit.changedFilterScenario(data),Audit.changedFilterScenario(data));
 assert.equal(JSON.stringify(data.ITEM_OPTIONS),original);
 assert.equal(Soft.compare(data).length,7);
});

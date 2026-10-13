"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Stack=require("../js/core/option-stack-trial.js");
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,
 "expected "+expected+" got "+actual);

test("会心率は基礎10%と装備・職業・スキル加算後に最大75%で制限",()=>{
 const s=Stack.scenario("offense",5,true);
 approx(s.raw.critChance,.85);
 approx(s.effective.critChance,.75);
 assert.ok(s.capped.includes("critChance"));
 const less=Stack.scenario("offense",1,false);
 approx(less.raw.critChance,.15);
 approx(less.effective.critChance,.15);
 assert.equal(less.capped.length,0);
});

test("装備・パッシブ吸収を30%で制限し、技固有60%を合算した後も80%以下",()=>{
 const s=Stack.scenario("drain",5,true);
 approx(s.raw.passiveLifesteal,.47);
 approx(s.effective.passiveLifesteal,.30);
 approx(s.raw.totalLifesteal,1.07);
 approx(s.effective.totalLifesteal,.80);
 assert.ok(s.capped.includes("totalLifesteal"));
 const another=Stack.compute({sources:[{id:"s",label:"職業",effects:{lifesteal:.03}}],abilityLifesteal:.60});
 approx(another.effective.totalLifesteal,.63);
 assert.equal(another.capped.length,0);
});

test("被ダメージ軽減は従来の乗算を維持し、最終軽減率を60%で止める",()=>{
 const stacked=Stack.scenario("tank",5,true);
 const raw=1-Math.pow(.94,5)*.70*.90*.60;
 approx(stacked.raw.damageReduction,raw);
 approx(stacked.effective.damageReduction,.60);
 approx(stacked.damageTakenMultiplier,.40);
 const two=Stack.compute({sources:[
  {id:"w",label:"武器",effects:{dmgTakenMult:.94}},
  {id:"r",label:"指輪",effects:{dmgTakenMult:.94}}]});
 approx(two.effective.damageReduction,1-.94*.94);
 assert.equal(two.capped.length,0);
});

test("回復と周回効率は職業・装備を合算後それぞれ上限内、装備1件でも効果を失わない",()=>{
 const five=Stack.scenario("support",5,true);
 approx(five.raw.healBonus,1.5);
 approx(five.effective.healBonus,1.0);
 approx(five.effective.materialBonus,.50);
 approx(five.effective.expBonus,.50);
 for(const key of ["healBonus","materialBonus","expBonus"])assert.ok(five.capped.includes(key));
 const one=Stack.scenario("support",1,false);
 approx(one.effective.healBonus,.20);
 approx(one.effective.materialBonus,.18);
 approx(one.effective.expBonus,.10);
});

test("MP消費軽減は倍率乗算、最大60%制限。オプションなしでは基準値",()=>{
 const empty=Stack.compute({sources:[]});
 approx(empty.effective.critChance,.10);
 approx(empty.effective.damageReduction,0);
 approx(empty.damageTakenMultiplier,1);
 approx(empty.mpCostMultiplier,1);
 const discount=Stack.compute({sources:[
  {id:"a",label:"石",effects:{mpCostMult:.3}},
  {id:"b",label:"スキル",effects:{mpCostMult:.5}}
 ]});
 approx(discount.raw.mpReduction,.85);
 approx(discount.effective.mpReduction,.60);
 approx(discount.mpCostMultiplier,.4);
});

test("データは不変で、悪意ある値・重複ID・未知効果は拒否",()=>{
 const src=[{id:"x",label:"武器",effects:{critBonus:.05}}];
 const snapshot=JSON.stringify(src);
 const o=Stack.compute({sources:src});
 o.sources[0].effects.critBonus=100;
 assert.equal(JSON.stringify(src),snapshot);
 for(const effects of [{critBonus:NaN},{lifesteal:-.1},{dmgTakenMult:-1},{bogus:.5}]){
  assert.throws(()=>Stack.compute({sources:[{id:"x",label:"不正",effects}]}));
 }
 assert.throws(()=>Stack.compute({sources:[src[0],src[0]]}),/Invalid effect source/);
 assert.throws(()=>Stack.compute({sources:src,abilityLifesteal:Infinity}),/Invalid ability/);
 assert.throws(()=>Stack.scenario("unknown",3,true),/Unknown preset/);
 assert.throws(()=>Stack.scenario("tank",2,true),/equipment count/);
 assert.throws(()=>Stack.scenario("tank",3,"true"),/talent toggle/);
});

test("上限まで到達した値と比較対象の詳細が一致する",()=>{
 const s=Stack.scenario("offense",5,true);
 assert.equal(s.details.length,8);
 for(const row of s.details){
  assert.ok(Number.isFinite(row.raw));
  assert.ok(Number.isFinite(row.effective));
  assert.ok(row.effective<=row.cap+1e-10);
  assert.equal(row.limited,s.capped.includes(row.key));
 }
});

test("セルフRV: 被ダメ増加やMPコスト増加の負効果を上限処理で消さない",()=>{
 const s=Stack.compute({sources:[{id:"curse",label:"呪い",effects:{
  dmgTakenMult:1.2,mpCostMult:1.5
 }}]});
 approx(s.raw.damageReduction,-.2);
 approx(s.effective.damageReduction,-.2);
 approx(s.damageTakenMultiplier,1.2);
 approx(s.effective.mpReduction,-.5);
 approx(s.mpCostMultiplier,1.5);
 assert.equal(s.details.find(x=>x.key==="passiveLifesteal").label,"通常のHP吸収");
});

"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Audit=require("../tools/lib/real-op-acquisition-time-audit.js");
const {loadGameData}=require("../tools/lib/load-data.js");
const Loot=require("../tools/lib/real-loot-economy-audit.js");
const Runner=require("../js/model/run.js");
const Offline=require("../js/core/offline.js");
const Trial=require("../js/core/option-inheritance-trial.js");
const game=loadGameData();
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,"expected "+b+" got "+a);

test("取得計算は現行ExtraドロップのOP個数と効果値からのみ実測し、固定シードで再現する",()=>{
 const opts={runs:400,seed:20261014,mode:"extra",threshold:.20};
 const a=Audit.acquisition(game,opts),b=Audit.acquisition(game,opts);
 assert.deepEqual(a,b);
 assert.equal(a.runs,400);
 assert.equal(a.threshold,.20);
 assert.equal(a.quality.exp,game.ITEM_OPTIONS.find(o=>o.key==="exp").range.extra[1]);
 assert.equal(a.quality.material,game.ITEM_OPTIONS.find(o=>o.key==="material").range.extra[1]);
 const generated=Loot.generateRuns(game,{mode:"extra",rounds:400,seed:20261014});
 assert.equal(a.items,generated.samples.reduce((n,r)=>n+r.drops.length,0));
 for(const key of ["exp","material"]){
  const x=a.byKey[key];
  const manual=generated.samples.flatMap(r=>r.drops).filter(it=>
    Array.isArray(it.options)&&it.options.some(o=>o.key===key&&o.value>=.20));
  assert.equal(x.total,manual.length);
  assert.equal(x.keptWithDefaultAutoDismantle+x.lostToDefaultAutoDismantle,x.total);
  assert.equal(Object.values(x.slots).reduce((u,v)=>u+v,0),x.total);
  assert.ok(x.firstThirty===null||x.firstThirty<=400);
 }
});

test("18%狙いは20%ピンポイントより候補が増え、N/R自動分解はOPを見ずに壊す",()=>{
 const a=Audit.acquisition(game,{runs:900,mode:"extra",threshold:.20});
 const b=Audit.acquisition(game,{runs:900,mode:"extra",threshold:.18});
 for(const key of ["exp","material"]){
  const hi=a.byKey[key],lo=b.byKey[key];
  assert.ok(lo.total>=hi.total);
  assert.ok(lo.keptWithDefaultAutoDismantle>=hi.keptWithDefaultAutoDismantle);
  assert.ok(hi.lostToDefaultAutoDismantle>0,"high roll should be at risk from live filter: "+key);
  assert.ok(hi.perItem>0);
  assert.ok(hi.optimisticRunsForThirty>0);
  if(hi.firstSlots30Protected!==null){
   assert.ok(hi.firstSlots30!==null);
   assert.ok(hi.firstSlots30Protected>=hi.firstSlots30);
  }
 }
});

test("最短収集の30件は必要装備カテゴリをすべて満たす前に達成しうるため区別する",()=>{
 const out=Audit.acquisition(game,{runs:1400,mode:"extra",threshold:.18});
 const target=Object.values(Audit.COUNT_TARGETS).reduce((n,k)=>n+k,0);
 assert.equal(target,30);
 for(const key of ["exp","material"]){
  const x=out.byKey[key];
  assert.ok(x.total>=x.keptWithDefaultAutoDismantle);
  if(x.firstSlots30!==null){
   assert.ok(x.firstThirty!==null);
   assert.ok(x.firstSlots30>=x.firstThirty);
  }
  assert.ok(out.caveats.some(c=>c.includes("class")));
 }
});

test("実際のbattle.jsを使って戦闘勝率とx1経過秒を算出し、オフライン見積もりを区別",()=>{
 for(const mode of ["normal","extra"]){
  const result=Audit.timing({mode,trials:3,seed:20261014});
  assert.equal(result.trials,3);
  assert.ok(result.clearRate>=0&&result.clearRate<=1);
  assert.ok(result.clears>=0&&result.clears<=3);
  assert.ok(result.battles>=1);
  assert.ok(result.estimateRunSeconds>0);
  assert.ok(result.offlineEstimateMaxRuns>=1);
  assert.equal(result.offlineMaxSeconds,Runner.OFFLINE_MAX_MS/1000);
  close(result.estimateRunSeconds,Offline.estimateRunSeconds(
    result.battles,Runner.OFFLINE_TIMING));
  if(result.clears){
   assert.ok(result.avgBattleSecondsOnClear>0);
   assert.ok(result.avgGameSecondsOnClear>=result.avgBattleSecondsOnClear);
  }else assert.equal(result.avgBattleSecondsOnClear,null);
 }
});

test("UR/LR継承の確率と天井は試作専用の現行定義と一致（商用継承率には混ぜない）",()=>{
 const x=Audit.inheritanceScenarios();
 assert.equal(x.source,"prototype-only");
 assert.deepEqual(x.rates,Trial.RATES);
 assert.equal(x.ur.guaranteedAttempt,3);
 assert.equal(x.lr.guaranteedAttempt,4);
 close(x.ur.meanEssencesPerSuccess,(1-Math.pow(.35,3))/.65);
 close(x.lr.meanEssencesPerSuccess,(1-Math.pow(.55,4))/.45);
 assert.ok(x.securityRisk.includes("Target-wide"));
});

test("不正な入力と未存在モードを拒否し、本体定義を変化させない",()=>{
 const snapshot=JSON.stringify(game.ITEM_OPTIONS);
 assert.throws(()=>Audit.acquisition(game,{runs:0}),/Invalid run count/);
 assert.throws(()=>Audit.acquisition(game,{runs:10001}),/Invalid run count/);
 assert.throws(()=>Audit.acquisition(game,{threshold:NaN}),/Invalid quality/);
 assert.throws(()=>Audit.acquisition(game,{mode:"unknown"}),/Invalid loot mode/);
 assert.throws(()=>Audit.timing({trials:0}),/Invalid trial count/);
 assert.throws(()=>Audit.timing({mode:"unknown"}),/Invalid loot mode/);
 assert.equal(JSON.stringify(game.ITEM_OPTIONS),snapshot);
});

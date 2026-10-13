"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadGameData}=require("../tools/lib/load-data.js");
const Audit=require("../tools/lib/real-option-cap-audit.js");
const Stack=require("../js/core/option-stack-trial.js");
const Soft=require("../tools/lib/soft-cap-real-data.js");

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,
  "Expected "+expected+", got "+actual);
const data=loadGameData();

test("実際の職業・種族・ツリー・装備を7ビルド×0/2/6OPで読み込む",()=>{
 const actual=Soft.compare(data);
 const reference=Audit.audit(data);
 assert.equal(actual.length,7);
 for(let i=0;i<7;i++){
  const row=actual[i],original=reference[i];
  assert.equal(row.build,original.build);
  assert.deepEqual(row.options.map(c=>c.optionCount),[0,2,6]);
  assert.ok(row.sp<=98);
  assert.equal(row.sp,original.cases[0].usedSP);
  for(let j=0;j<3;j++){
   const op=row.options[j],ref=original.cases[j];
   close(op.raw,ref.raw);
   close(op.hard,ref.effective);
  }
 }
});

test("ソフトキャップ関数は閾値以下で原値を保ち、以降も単調増加して天井未満",()=>{
 for(const policy of Object.keys(Soft.CURVES)){
  const cfg=Soft.CURVES[policy];
  for(const key of Object.keys(cfg)){
   if(key==="label")continue;
   const {threshold,ceiling}=cfg[key];
   close(Soft.soften(threshold,threshold,ceiling),threshold);
   close(Soft.soften(threshold*.8,threshold,ceiling),threshold*.8);
   let prev=threshold;
   for(let step=1;step<=80;step++){
    const raw=threshold+(ceiling-threshold)*step/20;
    const val=Soft.soften(raw,threshold,ceiling);
    assert.ok(val>prev,"No additional OP value for "+policy+"/"+key);
    assert.ok(val<ceiling,"Exceeds ceiling "+policy+"/"+key);
    prev=val;
   }
  }
 }
 close(Soft.soften(-.2,.6,.8),-.2); // 被ダメ増加/MP増加の呪いは有利に変えない
 assert.throws(()=>Soft.soften(Infinity,.6,.8),/Non-finite/);
 assert.throws(()=>Soft.soften(.7,.8,.6),/Invalid/);
});

test("会心は既存のOP2個で75%上限に当たるが、ソフト案は追加OP効果を維持",()=>{
 const crit=Soft.compare(data).find(x=>x.build==="crit");
 close(crit.options[0].raw,.68);
 close(crit.options[1].raw,.84);
 close(crit.options[2].raw,1.16);
 close(crit.options[1].hard,.75);
 close(crit.options[2].hard,.75);
 assert.ok(crit.options[2].conservative>crit.options[1].conservative);
 assert.ok(crit.options[2].generous>crit.options[1].generous);
 assert.ok(crit.options[2].generous<.97);
 assert.ok(crit.options[2].generous>.93);
 assert.ok(crit.gain.hard.from2To6===0);
});

test("暗黒騎士の技吸収60%を変更せず、OP0での弱体化リスクも見える",()=>{
 const drain=Soft.compare(data).find(x=>x.build==="drain");
 assert.equal(drain.ability,"drain");
 close(drain.options[0].skillAbsorption,.6);
 close(drain.options[0].raw,.99);
 close(drain.options[0].hard,.8);
 assert.ok(drain.options[0].conservative>.8);
 assert.ok(drain.options[0].generous>drain.options[0].conservative);
 assert.ok(drain.options[0].generous<.99);
 assert.ok(drain.baselineLoss.generous>0,"Soft cap does not automatically prevent ability nerf");
 assert.ok(drain.options[2].generous>drain.options[1].generous);
 assert.ok(drain.options[2].generous<.99);
 // 技をパッシブ30%として一括処理しないことを確認。
 const raw=Stack.compute({sources:Audit.snapshot(data,"drain",0).sources,abilityLifesteal:.60});
 const calculated=Soft.applyPolicy(raw,"generous");
 assert.ok(calculated.totalLifesteal>.9);
 assert.ok(calculated.passiveLifesteal<.60);
});

test("回復・MP軽減・報酬ボーナスの追加OPの価値がハード上限より残る",()=>{
 const rows=Soft.compare(data);
 for(const row of rows){
  const six=row.options[2],two=row.options[1];
  assert.ok(six.generous>two.generous,"OP6 has no reward: "+row.build);
  assert.ok(six.conservative>two.conservative,"OP6 has no reward in conservative plan: "+row.build);
  assert.ok(row.gain.generous.from2To6>row.gain.hard.from2To6,
    "soft generous did not increase OP value: "+row.build);
  assert.ok(row.gain.conservative.from2To6>row.gain.hard.from2To6);
  assert.ok(row.gain.generous.retention>0&&row.gain.generous.retention<=1);
 }
 const heal=rows.find(x=>x.build==="heal");
 assert.ok(heal.options[2].generous<1.8);
 const mp=rows.find(x=>x.build==="mp");
 assert.ok(mp.options[2].generous<.85);
 const stone=rows.find(x=>x.build==="material");
 assert.ok(stone.options[2].generous<1.2);
 const exp=rows.find(x=>x.build==="exp");
 assert.ok(exp.options[2].generous<1.2);
});

test("旧ハード上限計算は変えず、不正な方式は拒否。現行OPデータは変更しない",()=>{
 const original=data.ITEM_OPTIONS.map(x=>JSON.stringify(x));
 const baseline=Soft.compare(data);
 assert.deepEqual(Soft.compare(data),baseline);
 for(const row of baseline){
  for(const op of [0,2,6]){
   const ref=Audit.snapshot(data,row.build,op);
   const stack=Stack.compute({sources:ref.sources,abilityLifesteal:ref.abilityLifesteal});
   assert.deepEqual(Soft.applyPolicy(stack,"hard"),stack.effective);
  }
 }
 assert.throws(()=>Soft.applyPolicy(Stack.compute({sources:[]}),"unknown"),/Unknown/);
 assert.throws(()=>Soft.applyPolicy({}, "generous"),/Expected/);
 assert.deepEqual(data.ITEM_OPTIONS.map(x=>JSON.stringify(x)),original);
});

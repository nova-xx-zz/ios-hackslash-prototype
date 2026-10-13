"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Trial=require("../js/core/option-rarity-trial.js");
const RNG=require("../js/core/rng.js");
const Loot=require("../js/core/loot-protection-trial.js");

const approx=(value,expected,tolerance)=>assert.ok(Math.abs(value-expected)<=tolerance,
 "expected "+expected+" +/- "+tolerance+", got "+value);

test("武器とOPのランクは独立した分布。全モードの条件付き重みが10000",()=>{
 assert.deepEqual(Object.values(Trial.WEAPON_WEIGHTS),[7100,2200,650,35,15]);
 assert.equal(Object.values(Trial.WEAPON_WEIGHTS).reduce((a,b)=>a+b,0),10000);
 for(const mode of Object.values(Trial.MODES)){
  assert.equal(Object.values(mode.weights).reduce((a,b)=>a+b,0),10000);
  assert.ok(mode.optionChance>0 && mode.optionChance<=1);
 }
 assert.deepEqual(Object.keys(Trial.MODES),["normal","hard","extra"]);
});

test("N武器でもSR・UR・LRランクOPが現れる可能性がゼロではない",()=>{
 for(const mode of ["normal","hard","extra"]){
  for(const rank of ["sr","ur","lr"]){
   const p=Trial.probability(mode,"n",rank);
   assert.ok(p.perDrop>0);
   assert.ok(p.perRun>0);
   assert.ok(Number.isFinite(p.expectedRuns));
  }
 }
 approx(Trial.probability("hard","n","lr").perDrop,.71*5/10000,1e-12);
 approx(Trial.probability("extra","n","lr").perDrop,.71*20/10000,1e-12);
 approx(Trial.probability("normal","n","sr").perDrop,.71*.10*(180+19+1)/10000,1e-12);
});

test("各ランクの通常OPはrank/valueを持ち、LR/URは特殊OPも抽選可能",()=>{
 const low={pick:()=> "crit",float:(a,b)=>(a+b)/2,chance:()=>false};
 for(const rank of Trial.RANKS){
  const option=Trial.optionForRank(rank,low);
  assert.equal(option.key,"crit");
  assert.equal(option.rank,rank);
  assert.ok(option.value>=Trial.PERCENT_RANGE[rank][0]);
  assert.ok(option.value<=Trial.PERCENT_RANGE[rank][1]);
  assert.equal(option.origin,"natural");
 }
 const high={pick:()=> "crit",float:(a,b)=>(a+b)/2,chance:()=>true};
 for(const rank of ["ur","lr"]){
  const option=Trial.optionForRank(rank,high);
  assert.equal(option.rank,rank);
  assert.equal(option.special,true);
  assert.equal(option.value,1);
 }
 assert.throws(()=>Trial.optionForRank("mythic",low),/Invalid/);
});

test("レア度の近似分布はシード付きで再現可能。通常は10%、ハード/エクストラはOP付与100%案",()=>{
 const normal=Trial.simulate({mode:"normal",count:10000,seed:12345});
 const hard=Trial.simulate({mode:"hard",count:10000,seed:12345});
 const extra=Trial.simulate({mode:"extra",count:10000,seed:12345});
 approx(normal.withoutOption/10000,.90,.015);
 assert.equal(hard.withoutOption,0);
 assert.equal(extra.withoutOption,0);
 // エクストラのほうがUR以上の品質OPが出やすい。
 assert.ok(extra.rankCounts.ur+extra.rankCounts.lr>hard.rankCounts.ur+hard.rankCounts.lr);
 assert.ok(extra.nWithRare>hard.nWithRare);
 assert.deepEqual(Trial.simulate({mode:"hard",count:1000,seed:999}),
  Trial.simulate({mode:"hard",count:1000,seed:999}));
});

test("保護判定は本体データを変更せず、N低レア武器でSR以上OPの保護が増加する",()=>{
 const run=Trial.simulate({mode:"extra",count:10000,seed:20261014,minRank:"sr"});
 assert.ok(run.nWithRare>0);
 assert.ok(run.protectedByOption>0);
 assert.ok(run.materials<run.materialsWithoutProtection);
 assert.equal(run.kept+run.disassembled,run.count);
 assert.equal(Object.values(run.rankCounts).reduce((a,b)=>a+b,0)+run.withoutOption,run.count);
 assert.ok(run.rareExamples.length<=8);
 for(const example of run.rareExamples){
  assert.ok(Trial.RANKS.indexOf(example.optionRank)>=2);
 }
 // 既存の自動分解判定と同じコアを通して評価していることも確認。
 const decision=Loot.decide({rarity:"n",options:[{key:"crit",rank:"sr",value:.07,origin:"natural"}]},
  {enabled:true,rarities:["n","r"],protectRareOptions:true,minRank:"sr"});
 assert.equal(decision.reason,"rare_option");
});

test("カウントや確率設定が不正なら拒否して暴走しない",()=>{
 assert.throws(()=>Trial.simulate({mode:"expert"}),/Invalid/);
 assert.throws(()=>Trial.simulate({mode:"hard",count:10001}),/count/);
 assert.throws(()=>Trial.simulate({mode:"hard",count:0}),/count/);
 assert.throws(()=>Trial.simulate({mode:"extra",seed:Infinity}),/Seed/);
 assert.throws(()=>Trial.probability("invalid","n","sr"),/Invalid/);
 assert.throws(()=>Trial.probability("extra","n","mythic"),/Invalid/);
});

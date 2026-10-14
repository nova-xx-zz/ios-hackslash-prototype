"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadGameData}=require("../tools/lib/load-data.js");
const A=require("../tools/lib/real-loot-economy-audit.js");
const R=require("../js/core/rewards.js");
const Enhance=require("../js/core/enhance.js");
const data=loadGameData();

test("OPとレア度、N/R分解フィルタ、強化ルールをゲーム本体から直接読み取る",()=>{
 assert.deepEqual(Array.from(data.DEFAULT_AUTO_DISASSEMBLE_RARITIES),["n","r"]);
 assert.equal(A.optionMax(data,"exp"),data.ITEM_OPTIONS.find(x=>x.key==="exp").range.extra[1]);
 assert.equal(A.optionMax(data,"material"),data.ITEM_OPTIONS.find(x=>x.key==="material").range.extra[1]);
 assert.equal(A.optionMax(data,"material"),.20);
 assert.deepEqual(Array.from(data.RARITIES.map(x=>x.material)),[5,20,80,350,1500]);
 assert.deepEqual(A.BONUS_MEMBERS,[0,1,3,5]);
 assert.throws(()=>A.optionMax(data,"absent"),/Missing real/);
});

test("実際の敵編成と通常/ハード/エクストラのドロップ結果が固定シードで再現する",()=>{
 for(const mode of ["normal","hard","extra"]){
  const runs=A.generateRuns(data,{mode,rounds:100,seed:101});
  const again=A.generateRuns(data,{mode,rounds:100,seed:101});
  const compact=x=>x.samples.map(s=>({
   drops:s.drops.map(i=>[i.base,i.rarity,i.materialValue,i.unique||false]),
   exp:s.expByBattle
  }));
  assert.deepEqual(compact(runs),compact(again));
  assert.ok(runs.samples.every(s=>s.drops.length>=runs.battles));
  assert.ok(runs.samples.every(s=>s.expByBattle.length===runs.battles));
  assert.ok(runs.samples.flatMap(s=>s.drops).every(i=>data.RARITIES.some(r=>r.key===i.rarity)));
  const output=A.calculate(data,runs);
  assert.equal(output.filters.length,16);
  for(const x of output.filters)assert.equal(x.items,x.kept+x.disassembled);
 }
});

test("同じ1,000周の実ドロップでOP人数だけ変えるとEXP/強化石だけ伸び、アイテム数は不変",()=>{
 const raw=A.generateRuns(data,{mode:"normal",rounds:1000,seed:20261014});
 const report=A.calculate(data,raw);
 const records=report.filters.filter(x=>x.filter==="default");
 assert.deepEqual(records.map(x=>x.holders),[0,1,3,5]);
 assert.deepEqual(records.map(x=>x.expBonus),[0,.2,.6000000000000001,1]);
 assert.deepEqual(records.map(x=>x.materialBonus),[0,.2,.6000000000000001,1]);
 assert.ok(records[0].materials>0);
 assert.equal(records[3].materials,records[0].materials*2,"Five 20% bonuses exactly double rounded full-run material");
 assert.equal(records[3].expPerMember,records[0].expPerMember*2);
 for(const row of records){
  assert.equal(row.kept,records[0].kept);
  assert.equal(row.disassembled,records[0].disassembled);
  assert.equal(row.uniqueKept,records[0].uniqueKept);
  assert.equal(row.partyTotalEXP,row.expPerMember*5);
 }
 console.log("ECONOMY_SUMMARY "+JSON.stringify({
  mode:"normal",rounds:1000,
  default:records.map(x=>({members:x.holders,stones:x.materials,stonesPerRun:+x.materialsPerRun.toFixed(2),expPerMember:x.expPerMember,kept:x.kept,disassembled:x.disassembled})),
  otherFilters:report.filters.filter(x=>x.holders===5).map(x=>({filter:x.filter,stones:x.materials,kept:x.kept}))
 }));
});

test("通常とExtra同ドロップ条件を指定し、素材源はN/R分解・独自装備は保護される",()=>{
 const raw=A.generateRuns(data,{mode:"extra",rounds:1000,seed:20261014});
 const report=A.calculate(data,raw);
 const by=name=>report.filters.find(r=>r.filter===name&&r.holders===5);
 assert.equal(by("disabled").materials,0);
 assert.equal(by("disabled").kept,by("disabled").items);
 assert.equal(by("default").materials,2*report.filters.find(r=>r.filter==="default"&&r.holders===0).materials);
 assert.ok(by("throughSR").materials>=by("default").materials);
 assert.ok(by("default").materials>=by("nOnly").materials);
 assert.ok(by("throughSR").kept<=by("default").kept);
 assert.equal(by("default").uniqueKept,by("throughSR").uniqueKept);
 assert.ok(report.filters.every(r=>r.materials>=0 && Number.isInteger(r.materials)));
 console.log("ECONOMY_SUMMARY "+JSON.stringify({
  mode:"extra",rounds:1000,
  default:report.filters.filter(r=>r.filter==="default").map(x=>({members:x.holders,stones:x.materials,stonesPerRun:+x.materialsPerRun.toFixed(2),expPerMember:x.expPerMember,kept:x.kept,disassembled:x.disassembled})),
  otherFilters:report.filters.filter(x=>x.holders===5).map(x=>({filter:x.filter,stones:x.materials,kept:x.kept}))
 }));
});

test("1周ごとに分解した素材を合算してからボーナスを丸める（受取実装と一致）",()=>{
 const item=(id,rarity,value)=>({id,rarity,materialValue:value});
 const drops=[item("a","n",5),item("b","r",20),item("c","sr",80),{...item("d","n",5),unique:true}];
 const raw=R.settleDrops(drops,{enabled:true,rarities:new Set(["n","r"])});
 assert.equal(raw.materialGained,25);
 const paid=A.receiveLikeGame(drops,["n","r"],1.2);
 assert.equal(paid.materialGained,30);
 assert.equal(paid.disassembled,2);
 assert.equal(paid.kept.length,2);
 // 2周で丸めるのと2周合計に一度掛けるのは必ずしも一致しない
 const one=[item("x","n",5)];
 assert.equal(A.receiveLikeGame(one,["n"],1.1).materialGained,6);
 assert.equal(A.receiveLikeGame(one,["n"],1.1).materialGained*2,12);
 assert.equal(Math.round((5+5)*1.1),11);
 assert.equal(A.receiveLikeGame(drops,[],2).materialGained,0);
});

test("実強化コスト・成功確率・天井を使った期待消費は無天井以下、UR/LR高強化は重い",()=>{
 const all=[["sr",50],["ur",50],["ur",99],["lr",50],["lr",99]]
  .map(([rarity,target])=>A.enhanceBudget(data,rarity,target));
 for(const row of all){
  assert.ok(row.expected>0&&row.expected<=row.withoutPity);
  assert.equal(row.pityEnabled,!!data.FEATURE_FLAGS.enhancePity);
 }
 assert.ok(all[4].expected>all[3].expected);
 assert.ok(all[4].expected>all[2].expected);
 // When the pity threshold is not reached, a success resets the failed-cost gauge.
 const n=A.enhanceBudget(data,"n",1);
 const cfg=data.ENHANCE_RULES,p=Enhance.successRate(cfg,"n",0),c=Enhance.cost(cfg,"n",0);
 const attempts=Math.ceil(Enhance.pityThreshold(cfg,"n",0)/c)+1;
 const expected=c*(-Math.expm1(attempts*Math.log1p(-p))/p);
 assert.ok(Math.abs(expected-n.expected)<1e-9);
 const result=A.audit(data,{mode:"normal",rounds:100,seed:8});
 assert.equal(result.upgradeCoverage.length,5);
 assert.ok(result.upgradeCoverage.every(x=>x.scenarios.length===4));
 assert.ok(result.upgradeCoverage.every(x=>x.scenarios[3].roundsNeeded<=x.scenarios[0].roundsNeeded));
 console.log("UPGRADE_SUMMARY "+JSON.stringify(result.upgradeCoverage.map(x=>({
  rarity:x.rarity,target:x.target,cost:Math.round(x.expected),
  roundsZero:x.scenarios[0].roundsNeeded,roundsFive:x.scenarios[3].roundsNeeded
 }))));
});

test("不正入力の拒否とデータ非改変、100周は1000周サンプルの前半と一致",()=>{
 const source=JSON.stringify(data.RARITIES);
 const large=A.generateRuns(data,{mode:"normal",rounds:1000,seed:42});
 const small=A.generateRuns(data,{mode:"normal",rounds:100,seed:42});
 assert.deepEqual(small.samples.map(s=>s.drops.map(x=>x.rarity)),
  large.samples.slice(0,100).map(s=>s.drops.map(x=>x.rarity)));
 assert.throws(()=>A.generateRuns(data,{mode:"void",rounds:100}),/Invalid dungeon mode/);
 assert.throws(()=>A.generateRuns(data,{mode:"normal",rounds:10001}),/Invalid rounds/);
 assert.throws(()=>A.generateRuns(data,{mode:"normal",rounds:0}),/Invalid rounds/);
 assert.throws(()=>A.generateRuns(data,{mode:"normal",rounds:2,seed:NaN}),/Invalid seed/);
 assert.throws(()=>A.enhanceBudget(data,"sr",100),/Invalid enhancement/);
 assert.equal(JSON.stringify(data.RARITIES),source);
});

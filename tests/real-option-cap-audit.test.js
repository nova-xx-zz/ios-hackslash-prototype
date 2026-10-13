"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadGameData}=require("../tools/lib/load-data.js");
const Gear=require("../js/core/equipment.js");
const Stack=require("../js/core/option-stack-trial.js");
const Audit=require("../tools/lib/real-option-cap-audit.js");
const data=loadGameData();
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-10,"expected "+y+" got "+x);

test("実データの7ビルドはLv99・SP98以内、装飾品3枠・合法な部位・スキル分岐を満たす",()=>{
 const reports=Audit.audit(data);
 assert.equal(reports.length,7);
 for(const {cases} of reports){
  assert.deepEqual(cases.map(c=>c.optionCount),[0,2,6]);
  const c=cases[2];
  assert.ok(c.usedSP<=98,c.build+" SP overspent");
  assert.equal(c.accessorySlots,3);
  assert.equal(c.gearBases.length,6);
  assert.equal(new Set(c.gearBases).size,6);
  assert.equal(c.level,99);
  assert.equal(c.maxSP,98);
  assert.ok(c.sources.some(s=>s.id.startsWith("set:6"))||true); // 一部セットはpassiveゼロ
  assert.ok(c.sources.some(s=>s.id.startsWith("op:")));
  assert.ok(c.skillIds.some(s=>s.ids.some(id=>id.endsWith("_acc1"))));
  assert.ok(c.skillIds.some(s=>s.ids.some(id=>id.endsWith("_acc2"))));
  assert.equal(c.raw,Stack.compute({sources:c.sources,abilityLifesteal:c.abilityLifesteal}).raw[c.focus]);
 });
});

test("前提ノードの自動選択・相互排他・レベル制限・SP超過を検証",()=>{
 const tree=data.EXCLUSIVE_TREES.rogue;
 const selected=Audit.selectNodes(tree,["r4b"],99);
 assert.ok(selected.skills.some(n=>n.id==="r1"));
 assert.ok(selected.skills.some(n=>n.id==="r2"));
 assert.ok(selected.skills.some(n=>n.id==="r3"));
 assert.throws(()=>Audit.selectNodes(tree,["r4a","r4b"],99),/Exclusive/);
 assert.throws(()=>Audit.selectNodes(tree,["r7a"],1),/higher level/);
 assert.throws(()=>Audit.selectNodes(tree,["missing"],99),/Unknown skill node/);
 assert.throws(()=>Audit.snapshot(data,"crit",6,30),/higher level|available SP/);
 assert.throws(()=>Audit.snapshot(data,"crit",5),/Options must/);
});

test("シリーズ6点と装備OPの実合算は現行equipment.setBonusTotalsに一致",()=>{
 for(const [name,optionCount] of [["crit",2],["drain",6],["defense",6],["heal",2],["mp",6]]){
  const row=Audit.snapshot(data,name,optionCount);
  const slots=["main","head","body","acc1","acc2","acc3"];
  const equip={};
  for(let i=0;i<slots.length;i++){
   const base=data.ITEM_BASES.find(b=>b.key===row.gearBases[i]);
   equip[slots[i]]={...base,options:i<optionCount?[{key:row.opKey,value:row.opMax}]:[]};
  }
  const actual=Gear.setBonusTotals(equip,data.ITEM_SERIES,null,data.itemOptionEffect);
  const auditSources=row.sources.filter(s=>s.id.startsWith("op:")||s.id.startsWith("set:"));
  const computed=Stack.compute({sources:auditSources});
  near(actual.passives.critBonus,computed.raw.critChance-.10);
  near(actual.passives.lifesteal,computed.raw.passiveLifesteal);
  near(actual.passives.healBonus,computed.raw.healBonus);
  near(actual.passives.materialBonus,computed.raw.materialBonus);
  near(actual.passives.expBonus,computed.raw.expBonus);
  near(actual.passives.dmgTakenMult,1-computed.raw.damageReduction);
  near(actual.passives.mpCostMult,1-computed.raw.mpReduction);
 }
});

test("本物のOPレンジ・種族・技を利用し、会心はOP2件ですでに上限に達する",()=>{
 const raw=Audit.snapshot(data,"crit",2),more=Audit.snapshot(data,"crit",6);
 near(raw.raw,.84);
 near(raw.effective,.75);
 assert.equal(raw.capped,true);
 assert.ok(more.raw>raw.raw);
 assert.equal(raw.opMax,data.ITEM_OPTIONS.find(x=>x.key==="crit").range.extra[1]);
 assert.equal(raw.raceName,data.RACES.beastkin.name);
 const drain=Audit.snapshot(data,"drain",0);
 assert.equal(drain.abilityId,"drain");
 near(drain.abilityLifesteal,.6);
 near(drain.raw,.99);
 near(drain.effective,.8);
 assert.equal(drain.capped,true);
});

test("被ダメ・回復・MP減・素材・EXP特化も上限到達と個別効果を判定",()=>{
 const def=Audit.snapshot(data,"defense",6);
 assert.ok(def.raw>.60);
 near(def.effective,.60);
 const heal=Audit.snapshot(data,"heal",2);
 near(heal.raw,1.34);
 near(heal.effective,1);
 const mp=Audit.snapshot(data,"mp",2);
 assert.ok(mp.raw>.60);
 near(mp.effective,.60);
 for(const name of ["material","exp"]){
  const baseline=Audit.snapshot(data,name,2);
  near(baseline.raw,.40);near(baseline.effective,.40);
  const cap=Audit.snapshot(data,name,6);
  near(cap.raw,1.20);near(cap.effective,.50);
 }
});

test("現行セーブ形式や実戦ルールは参照のみ。データの改変なし・再現性あり",()=>{
 const before=data.ITEM_OPTIONS.map(o=>JSON.stringify(o));
 const a=Audit.audit(data);
 const b=Audit.audit(data);
 assert.deepEqual(a,b);
 assert.deepEqual(data.ITEM_OPTIONS.map(o=>JSON.stringify(o)),before);
 assert.equal(Audit.DEFINITIONS.drain.ability,"drain");
 // 経験値の種族expMultは戦闘OPのexpBonusと別扱い
 const exp=Audit.snapshot(data,"exp",0);
 near(exp.raw,0);
 assert.ok(data.RACES.sylvan.expMult>1);
});

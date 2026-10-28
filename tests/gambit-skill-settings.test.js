"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tactics = require("../js/core/tactics.js");
const battle = require("../js/core/battle.js");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const save = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

const base = { maxHp: 100, maxMp: 40, atk: 20, mag: 30, def: 10, spd: 10 };
const fire = { id: "fire", name: "炎紋弾", kind: "magic", target: "single", power: 1.5, hits: 1, mpCost: 4 };
const heal = { id: "heal", name: "癒しの灯", kind: "heal", target: "single-ally", power: 1.4, hits: 1, mpCost: 5 };
const ally = (abilities, more) => Object.assign({ name:"A", stats:base, alive:true, hp:100, mp:40, abilities }, more || {});
const enemy = (hp, maxHp) => ({ alive:true, hp, maxHp, name:"敵", atk:20, def:0, spd:10 });
function env() {
  return {
    rng: { float:(a,b)=>(a+b)/2, pick:(a)=>a[0], chance:()=>false },
    stats:(c)=>c.stats,
    abilities:(c)=>c.abilities,
    mpCost:(c,a)=>a.mpCost,
    tier:()=>2,
    passives:()=>({lifesteal:0, healBonus:0, critBonus:0, dmgTakenMult:1}),
  };
}
function rule(id, condition, value, targetMode) {
  return { id:"rule-"+id, abilityId:id, enabled:true, condition, value,
    targetMode:targetMode||"weakest" };
}
test("旧2枠・旧優先度から初回移行し、技の取得権利を新たに増やさない",()=>{
  const c={skillActive:{off:false},abilityPriority:{heal:3,fire:2},targetPriority:"weakest"};
  const rs=tactics.migrateLegacy(c,[fire,heal,{id:"off"}],(actor,id)=>actor.abilityPriority[id]||2);
  assert.deepEqual(rs.map(x=>x.abilityId),["heal","fire"]);
  assert.equal(tactics.migrateLegacy(c,[],()=>1).length,2,"移行は一度きり");
  assert.equal(tactics.MAX_RULES,8);
});
test("壊れた/古い条件・NaN・巨大配列は安全に正規化する",()=>{
  assert.equal(tactics.normalizeRules(null),null);
  assert.deepEqual(tactics.normalizeRules([]),[]);
  const input=Array.from({length:100},(_,i)=>({id:"r"+i,abilityId:"fire",condition:"allyHpLte",value:Infinity}));
  const result=tactics.normalizeRules(input);
  assert.equal(result.length,8);
  assert.equal(result[0].value,20);
  assert.equal(tactics.normalizeRules([{id:"bad",abilityId:"<script>",condition:"always"}]).length,0);
});
test("HP境界値・死人除外・MP割合・敵体数・標的モードを条件判定",()=>{
  const c=ally([],{hp:100,mp:10}), wounded=ally([],{hp:20}), dead=ally([],{hp:0,alive:false});
  assert.equal(tactics.conditionMet(rule("heal","allyHpLte",20),c,[c,wounded,dead],[enemy(100,100)],x=>x.stats),true);
  wounded.hp=21;
  assert.equal(tactics.conditionMet(rule("heal","allyHpLte",20),c,[c,wounded,dead],[],x=>x.stats),false);
  assert.equal(tactics.conditionMet(rule("fire","selfMpGte",25),c,[c],[],x=>x.stats),true);
  c.mp=9;
  assert.equal(tactics.conditionMet(rule("fire","selfMpGte",25),c,[c],[],x=>x.stats),false);
  assert.equal(tactics.conditionMet(rule("fire","enemyCountGte",2),c,[c],[enemy(1,1),enemy(0,1)],x=>x.stats),false);
  assert.equal(tactics.conditionMet(rule("fire","enemyHpLte",20,"weakest"),c,[c],[enemy(15,100),enemy(100,100)],x=>x.stats),true);
  assert.equal(tactics.conditionMet(rule("fire","enemyHpLte",20,"random"),c,[c],[enemy(15,100),enemy(100,100)],x=>x.stats),false);
});
test("僧侶: 味方20%以下を最優先回復、満たさなければ攻撃、MP不足なら次行",()=>{
  const c=ally([heal,fire],{tacticsRules:[rule("heal","allyHpLte",20),rule("fire","always",0)]});
  const friend=ally([],{hp:20});
  const foe=enemy(100,100);
  assert.equal(battle.chooseAction(c,[c,friend],env(),[foe]).id,"heal");
  friend.hp=21;
  assert.equal(battle.chooseAction(c,[c,friend],env(),[foe]).id,"fire");
  friend.hp=20; c.mp=4;
  assert.equal(battle.chooseAction(c,[c,friend],env(),[foe]).id,"fire");
  c.mp=0;
  assert.equal(battle.chooseAction(c,[c,friend],env(),[foe]).id,"attack");
});
test("ON/OFF・未装備/未習得は飛ばし、空ルールは通常攻撃",()=>{
  const c=ally([fire],{tacticsRules:[rule("unknown","always",0),{...rule("fire","always",0),enabled:false}]});
  assert.equal(battle.chooseAction(c,[c],env(),[enemy(100,100)]).id,"attack");
  c.tacticsRules=[];assert.equal(battle.chooseAction(c,[c],env(),[enemy(100,100)]).id,"attack");
});
test("ツリーのパッシブは現在の取得ノードのみ表示され、解除で効果も消える",()=>{
  const state=createState({teamCount:4});
  const roster=createRoster({data,state});
  const c=roster.newCharacter("僧侶","priest","human");
  const tree=roster.getExclusiveTree(c);
  const passive=tree.nodes.find(x=>x.kind==="passive" && x.effects.some(e=>e.type==="statAdd"||e.type==="statPct"));
  assert.ok(passive);
  const st=roster.getTreeState(c);
  const before=roster.computeStats(c);
  assert.equal(roster.learnedTreePassives(c).length,0);
  st.exclusiveRanks[passive.id]=1;
  assert.ok(roster.learnedTreePassives(c).some(x=>x.name===passive.name));
  const after=roster.computeStats(c);
  assert.ok(Object.keys(before).some(k=>after[k]!==before[k]));
  st.exclusiveRanks={};
  assert.equal(roster.learnedTreePassives(c).length,0);
  assert.deepEqual(roster.computeStats(c),before);
});
test("保存時の正規化はルールだけを検証し、追加項目で旧セーブ形式を壊さない",()=>{
  const state=createState({teamCount:4});
  const roster=createRoster({data,state});
  const c=roster.newCharacter("テスト","warrior","human");
  c.tacticsRules=[rule("fire","allyHpLte",200)];
  const restored=save.deserialize({schemaVersion:save.SCHEMA_VERSION,roster:[c]}, {
    legacyMaterial:0,syncExpToNext:data.syncExpToNext||(()=>{}),itemBases:data.ITEM_BASES||[],legacyItemBases:{},teamCount:4,maxPlus:99,ivRange:0.1,
  });
  assert.ok(restored && restored.state && restored.state.roster.length===1);
  assert.equal(restored.state.roster[0].tacticsRules[0].value,100);
});

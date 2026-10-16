"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { buildScenario, PROFILES }=require("../tools/dungeon-balance.js");
const { data }=require("../tools/lib/sim.js");

test("洞窟5Fは4-5Fの通常敵だけ80%、ボス倍率は完全維持",()=>{
 const d=data.getDungeon("cave");
 assert.equal(d.pilotLateNormalFactor,.8);
 const scenario=buildScenario("cave",PROFILES.find(x=>x.id==="recommended"),91015);
 const run=scenario.runner.startRun(0,"cave");
 const index=run.pilotSchedule.findIndex(s=>s.floor===4&&!s.boss);
 assert.ok(index>=0);
 run.battleIndex=index;
 let e=scenario.runner.startBattle(run).battle.enemies[0];
 assert.equal(e.isBoss,false);
 const floor=4;
 const mult=(1+(d.level-1)*.12)*(1+(floor-1)*.045)*.8;
 const expected=data.makeEnemy(data.getEnemyTemplate(e.key),mult,false,d.power,e.isRare,d.mode);
 assert.equal(e.hp,expected.hp);
 assert.equal(e.atk,expected.atk);
 const finalIndex=run.pilotSchedule.findIndex(s=>s.boss&&s.boss.kind==="final");
 assert.ok(finalIndex>index);
 run.battleIndex=finalIndex;
 const b=scenario.runner.startBattle(run).battle.enemies.find(x=>x.isBoss);
 assert.equal(b.key,d.boss);
 const bossMult=(1+(d.level-1)*.12)*(1+(5-1)*.045)*1.55;
 const expectedBoss=data.makeEnemy(data.getEnemyTemplate(d.boss),bossMult,true,d.power,false,d.mode);
 assert.equal(b.hp,expectedBoss.hp);
 assert.equal(b.atk,expectedBoss.atk);
 assert.equal(b.def,expectedBoss.def);
});

test("既存3Fと3Fまでの洞窟通常敵は緩和されない",()=>{
 const plains=data.getDungeon("plains");
 const forest=data.getDungeon("forest");
 assert.equal(plains.pilotLateNormalFactor,undefined);
 assert.equal(forest.pilotLateNormalFactor,undefined);
 const ctx=buildScenario("cave",PROFILES.find(x=>x.id==="recommended"),444);
 const run=ctx.runner.startRun(0,"cave");
 run.battleIndex=0;
 const e=ctx.runner.startBattle(run).battle.enemies[0];
 const d=ctx.d;
 const expected=data.makeEnemy(data.getEnemyTemplate(e.key),(1+(d.level-1)*.12),false,d.power,e.isRare,d.mode);
 assert.equal(e.hp,expected.hp);
});

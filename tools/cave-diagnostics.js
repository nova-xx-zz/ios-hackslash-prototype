#!/usr/bin/env node
"use strict";
// Live-core experiment only. Does NOT change js/data.js or deployed values.
const { buildScenario, PROFILES } = require("./dungeon-balance.js");
const POWER = Object.freeze([
  { id: "current", factor: 1 },
  { id: "power-95pct", factor: .95 },
  { id: "power-90pct", factor: .90 },
  { id: "power-85pct", factor: .85 },
]);
const BUILDS = Object.freeze(["recommended", "reinforced", "refined"]);
const SEED_BASE = 87001000;
function measureCave(profileId, factor, trials = 240, lateFactor = 1) {
  const profile = PROFILES.find(p => p.id === profileId);
  if (!profile || !BUILDS.includes(profileId) || !Number.isInteger(trials) || trials < 1 || trials > 2500 ||
      !POWER.some(p => p.factor === factor) || ![1, .95, .9, .85, .8, .75, .7, .65].includes(lateFactor)) throw Error("invalid diagnostic case");
  const scenario = buildScenario("cave", profile, SEED_BASE);
  // Isolated in-memory dungeon value; never modify global DUNGEONS or game defaults.
  const simulated = Object.assign({}, scenario.d, { power: Number((scenario.d.power * factor).toFixed(5)),
    pilotLateNormalFactor: lateFactor });
  const floorFailures = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, boss: 0, timeout: 0 };
  const boss = { reached: 0, defeated: 0 };
  const floorVisits = [0,0,0,0,0];
  let clear = 0, fail = 0, atBossHp = 0, atBossMp = 0, atBossAlive = 0;
  let wins = 0, summedSeconds = 0, zeroLeak = true, maxObservedEnemies = 0, sumDrops = 0;
  for(let i=0;i<trials;i++) {
    const trace = [];
    // Fixed independent seed per run, shared across build and power variants.
    const result = scenario.runner.computeOfflineRun(simulated, 0, {
      seed: SEED_BASE + i,
      onBattleFinish(b) {
        trace.push(b);
        if (b.enemies.length > maxObservedEnemies) maxObservedEnemies = b.enemies.length;
        if (b.won) wins++;
      }
    });
    summedSeconds += result.seconds;
    if (!result.cleared && result.drops.length) zeroLeak = false;
    if (result.cleared) { clear++; sumDrops += result.drops.length; }
    else fail++;
    for(const b of trace) {
      if (!floorVisits[b.floor - 1]) {} // kept for explicit floor visit counting below
    }
    const seen = new Set(trace.map(x=>x.floor));
    for(const floor of seen) floorVisits[floor-1]++;
    const bossBattle = trace.find(x=>x.boss);
    if(bossBattle) {
      boss.reached++;
      atBossHp+=bossBattle.hp; atBossMp+=bossBattle.mp; atBossAlive+=bossBattle.alive;
      if(bossBattle.won)boss.defeated++;
    }
    if (!result.cleared) {
      const last=trace.at(-1);
      if (!last || last.won) throw Error("failure stage not recorded");
      if (last.boss) floorFailures.boss++;
      else floorFailures[last.floor]++;
    }
  }
  const pct=x=>Math.round(x * 10000 / trials)/100;
  const num=x=>Math.round(x*100)/100;
  return { profileId, factor, lateFactor, configuredPower: simulated.power, trials,
    clear, fail, clearPct:pct(clear), failPct:pct(fail),
    floorFailures, floorVisits, boss, bossReachPct:pct(boss.reached),
    bossWinPctOfReached:boss.reached?num(boss.defeated*100/boss.reached):null,
    avgHpAfterBoss:boss.reached?num(atBossHp/boss.reached):null,
    avgMpAfterBoss:boss.reached?num(atBossMp/boss.reached):null,
    avgAliveAfterBoss:boss.reached?num(atBossAlive/boss.reached):null,
    avgSeconds:num(summedSeconds/trials), dropsPerTry:num(sumDrops/trials),
    maxObservedEnemies, failedDropsLeaked:!zeroLeak, wins };
}
function runDiagnostics(trials=240, mode="power"){
  const rows=[];
  if (mode === "late") {
    for (const factor of [1, .9, .8, .7]) for (const id of BUILDS) rows.push(measureCave(id,1,trials,factor));
  } else if (mode === "power") {
    for(const p of POWER) for(const id of BUILDS) rows.push(measureCave(id,p.factor,trials));
  } else throw Error("unknown mode");
  return { version:1,trials,mode,seedBase:SEED_BASE,rows };
}
if(require.main===module) {
  const a=process.argv.find(s=>s.startsWith("--trials="));
  const result=runDiagnostics(a?Number(a.split("=")[1]):240,process.argv.includes("--late")?"late":"power");
  console.log("cave 5F boss-stage failure diagnostic, normal difficulty");
  console.log("profile power lateNormalMult clear% reachedBoss% defeatedAtBoss failedF1/F2/F3/F4/F5 boss avgSec");
  for(const r of result.rows) console.log([r.profileId,r.configuredPower,r.lateFactor,r.clearPct,r.bossReachPct,r.floorFailures.boss,
    ...[1,2,3,4,5].map(x=>r.floorFailures[x]),r.avgSeconds].join(" "));
  console.log("CAVE_DIAGNOSTIC_JSON="+JSON.stringify(result));
}
module.exports={measureCave,runDiagnostics,BUILDS,POWER,SEED_BASE};

"use strict";
// Usage: node tools/audit-op-acquisition-time.js [number-of-runs] [battle-trials]
const A=require("./lib/real-op-acquisition-time-audit.js");
const runs=process.argv[2]===undefined?2000:Number(process.argv[2]);
const trials=process.argv[3]===undefined?16:Number(process.argv[3]);
const seed=20261014;
const fmt=x=>x===null?"not reached":Math.round(x).toLocaleString("ja-JP");
console.log("ソードクレスト：実OP厳選と実戦時間を別々に監査");
console.log("現行Extra OP（独立OPランクなし、2〜3種/装備、同一OP不可）で抽選");
for(const threshold of [.20,.18]){
 const out=A.acquisition(undefined,{runs,trials,seed,threshold,mode:"extra"});
 console.log("threshold >= "+Math.round(threshold*100)+"%, simulated "+runs+" real drop runs / items="+out.items);
 for(const key of ["exp","material"]){
  const x=out.byKey[key];
  console.log(JSON.stringify({key,qualifying:x.total,perItem:x.perItem,
   lostBeforeProtection:x.previouslyLostBeforeProtection,
   savedByCurrentProtection:x.savedByNewProtection,
   lostNow:x.lostToDefaultAutoDismantle,
   retained:x.keptWithDefaultAutoDismantle,slots:x.slots,
   first30:x.firstThirty,firstSlotAllocation30:x.firstSlots30,
   firstSlotAllocation30WithDefaultFilter:x.firstSlots30Protected,
   optimisticExpectedRunsFor30:x.optimisticRunsForThirty}));
 }
}
console.log("Battle engine: actual clear rate and x1 simulated battle seconds");
for(const mode of ["normal","hard","extra"]){
 const x=A.timing({mode,trials,seed});
 console.log(JSON.stringify(x));
}
console.log("Trial-only inheritance (NOT implemented in live drops)");
console.log(JSON.stringify(A.inheritanceScenarios()));
console.log("Note: no mobile frame rendering/network latency, real world AFK elapsed time or real gear build completion guarantee");

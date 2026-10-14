"use strict";
// node tools/audit-drain-rewards.js
const {loadGameData}=require("./lib/load-data.js");
const A=require("./lib/drain-reward-parity-audit.js");
const data=loadGameData();
for(const count of [0,2,6]){
 const x=A.realAbilityDrain(data,count);
 console.log("Drain",count,JSON.stringify(x));
}
for(const bonus of [0,.2]){
 const x=A.rewardScenario(data,{expOP:bonus,materialOP:bonus});
 console.log("Reward",bonus,JSON.stringify(x));
}
console.log("KO",JSON.stringify(A.rewardScenario(data,{expOP:.2,materialOP:.2,koIndex:2})));
console.log("Filter",JSON.stringify(A.changedFilterScenario(data)));

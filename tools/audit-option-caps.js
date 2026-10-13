"use strict";
// 起動: node tools/audit-option-caps.js
// 実際のゲームデータを読み、装備OPなし／2個／6個の上限適用前後を確認する。
const {loadGameData}=require("./lib/load-data.js");
const {audit}=require("./lib/real-option-cap-audit.js");
const data=loadGameData();
const cases=audit(data);
const pct=n=>(n*100).toFixed(1)+"%";
console.log("ソードクレスト：実定義に基づくLv99/最大98SPのOP上限監査");
console.log("シリーズ6点・装飾品3枠を前提（枠解放SPを計上）。OP値は現行Extraの最高値。ドロップ確率や強化コストは含まない。");
for(const entry of cases){
 const base=entry.cases[0],n2=entry.cases[1],n6=entry.cases[2];
 const fmt=c=>pct(c.raw)+" → "+pct(c.effective)+(c.capped?"［上限］":"");
 console.log(entry.build.padEnd(9)+" "+base.name+" / "+base.jobName+"・"+base.raceName+" / "+base.seriesName+
  "6点 / SP "+base.usedSP+"/"+base.maxSP+
  " / OP0: "+fmt(base)+" / OP2: "+fmt(n2)+" / OP6: "+fmt(n6));
}
console.log("注：キャラ単位の上限案の評価。全職網羅・6点全ての最適OP厳選確率・パーティ全体の報酬倍率は含めない。");

"use strict";
const {compare,CURVES,POLICIES}=require("./lib/soft-cap-real-data.js");
const {loadGameData}=require("./lib/load-data.js");
const fmt=value=>(value*100).toFixed(1)+"%";
const result=compare(loadGameData());
console.log("ソードクレスト：実データOPソフトキャップ比較（Lv99/最大98SP）");
console.log("ゲーム本体を変更せず、実際の職業・種族・スキル・セット・Extra最高OP値を利用。");
console.log("案A:慎重 / 案B:装備収集重視 / 基準:PR #88のハード上限案。");
console.log("ビルド | OP数 | 元の累積値 | ハード上限 | ソフトA | ソフトB");
for(const row of result) {
  for(const op of row.options) {
    console.log([row.name,op.optionCount,fmt(op.raw),fmt(op.hard),
      fmt(op.conservative),fmt(op.generous)].join(" | "));
  }
}
console.log("\nOP2→OP6の増分（ハード / ソフトA / ソフトB）");
for(const row of result){
  console.log(row.name+": "+POLICIES.map(p=>fmt(row.gain[p].from2To6)).join(" / ")+
    "（職業："+row.job+" / SP"+row.sp+"/98）");
}
console.log("\n元のOP0値が弱体化する幅（＋値は弱体化）");
for(const row of result){
  const affected=POLICIES.filter(p=>row.baselineLoss[p]>1e-9);
  if(affected.length)console.log(row.name+": "+affected.map(p=>p+" "+fmt(row.baselineLoss[p])).join(" / "));
}
console.log("※ 会心・吸収・防御などの天井値と式は暫定。本体の戦闘、報酬、セーブ、課金に未適用。");

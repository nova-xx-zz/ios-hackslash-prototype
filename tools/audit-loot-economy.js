"use strict";
// Usage: node tools/audit-loot-economy.js [normal|hard|extra|all] [seed]
// Battle victories are fixed, not a prediction of actual game clears or run durations.
const {loadGameData}=require("./lib/load-data.js");
const A=require("./lib/real-loot-economy-audit.js");
const data=loadGameData();
const mode=process.argv[2]||"all";
const seed=process.argv[3]===undefined?20261014:Number(process.argv[3]);
if(!["normal","hard","extra","all"].includes(mode)||!Number.isSafeInteger(seed)||
 seed<0||seed>4294967295)throw Error("Usage: node tools/audit-loot-economy.js [normal|hard|extra|all] [seed]");
const fmt=x=>Math.round(x).toLocaleString("ja-JP");
const modes=mode==="all"?["normal","hard","extra"]:[mode];
console.log("ソードクレスト：実ドロップ・自動分解・強化石経済の監査");
console.log("実戦勝率を100%に固定した「踏破できた場合」の比較。罠・泉の戦闘影響、周回速度と課金石は計算外。");
console.log("EXP/素材OPを持つ人数=0/1/3/5、各1人に現行Extra最高値1件。全条件で同じ抽選ドロップを使う。");
for(const m of modes){
 const full=A.generateRuns(data,{dungeonId:"plains",mode:m,rounds:1000,seed});
 for(const n of [100,1000]){
  const sample={...full,rounds:n,samples:full.samples.slice(0,n)};
  const summary=A.calculate(data,sample);
  console.log("\n"+m+" "+n+"周 / バトル"+sample.battles+"戦 / seed="+seed);
  console.log("フィルタ / OP保有人数 / 材料合計 / 強化石/周 / 個人EXP/周 / 分解数 / 保管数");
  for(const filter of ["default","nOnly","throughSR","disabled"]){
   for(const c of summary.filters.filter(x=>x.filter===filter)){
    console.log([filter,c.holders,fmt(c.materials),c.materialsPerRun.toFixed(1),
      c.expPerMemberPerRun.toFixed(1),c.disassembled,c.kept].join(" / "));
   }
  }
  if(n===1000){
   const audit=A.audit(data,{dungeonId:"plains",mode:m,rounds:n,seed});
   console.log("5人全員が複数装備にOPを付けた場合（各3/6部位、通常のOP数値を累積。試作ソフト上限は未適用）");
   for(const slots of [3,6]) {
     const stacked=A.calculate(data,sample,{slotsPerHolder:slots});
     const withOP=stacked.filters.find(x=>x.filter==="default"&&x.holders===5);
     const c=A.enhanceBudget(data,"lr",99);
     console.log("1人"+slots+"部位 ×5人 / パーティ素材倍率"+(1+withOP.materialBonus).toFixed(1)+
       "倍 / 強化石 "+fmt(withOP.materials)+" / 個人EXP "+fmt(withOP.expPerMember)+
       " / LR+99 素材だけの周回目安 "+fmt(Math.ceil(c.expected/withOP.materialsPerRun)));
   }
   console.log("強化の必要強化石（天井ON、購入の確定石なしでの平均必要量）");
   for(const cost of audit.upgradeCoverage){
    console.log(cost.rarity.toUpperCase()+" +"+cost.target+
      " / 期待消費 "+fmt(cost.expected)+
      " / N・R自動分解で必要な周回（OP保有人数 0/1/3/5） "+
      cost.scenarios.map(x=>x.roundsNeeded===null?"不可":fmt(x.roundsNeeded)).join("/"));
   }
  }
 }
}
console.log("\n注：期待消費量は当該レア度の装備1つを+0から目標値まで強化する計算。ドロップ入手確率・実際のプレイ時間・継承・その他の消費は含まない。");

// 戦闘シミュレーション: 初期パーティ構成で、ダンジョンごと・レベルごとの踏破率と1周の所要時間を計算する。
// オフライン進行も同じ戦闘エンジンで戦わせて精算するため、ここでの結果がそのままオフラインでの目安になる
// （ただしここでは装備・スキルツリー・道中イベントなしなので、実際のプレイより厳しめに出る）。
// 実行: node tools/simulate.js [試行回数=200]
const { data, clearRate } = require("./lib/sim.js");

const trials = parseInt(process.argv[2] || "200", 10);
const LEVELS = [1, 3, 5, 8, 10, 12, 15, 20, 25, 30];

console.log(`試行回数: ${trials}回／条件（初期パーティ構成・装備なし・スキルツリーなし・道中イベントなし）`);
console.log("表の見方: 踏破率（踏破した周の戦闘時間の平均・x1速度）");
console.log("");
console.log(["ダンジョン(推奨Lv)", ...LEVELS.map((l) => `Lv${l}`)].join("\t"));
for (const d of data.DUNGEONS) {
  const cells = [`${d.name}(${d.level})`];
  for (const lv of LEVELS) {
    const sim = clearRate(d.id, lv, trials, 1000 + lv);
    cells.push(`${Math.round(sim.rate * 100)}%` + (sim.avgSeconds ? `(${Math.round(sim.avgSeconds)}s)` : ""));
  }
  console.log(cells.join("\t"));
}

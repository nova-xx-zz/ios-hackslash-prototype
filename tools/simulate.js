// 戦闘シミュレーション: 初期パーティ構成で、ダンジョンごと・レベルごとの踏破率を計算し、
// オフライン進行の踏破確率（js/core/offline.js の clearChance）と比較する。
// 実行: node tools/simulate.js [試行回数=200]
const { data, clearRate } = require("./lib/sim.js");
const offline = require("../js/core/offline.js");

const trials = parseInt(process.argv[2] || "200", 10);
const LEVELS = [1, 3, 5, 8, 10, 12, 15, 20, 25];

console.log(`試行回数: ${trials}回／条件（初期パーティ構成・装備なし・道中イベントなし）`);
console.log("表の見方: 戦闘シミュレーションの踏破率 / オフライン進行で使っている踏破確率");
console.log("");
const header = ["ダンジョン(推奨Lv)", ...LEVELS.map((l) => `Lv${l}`)];
console.log(header.join("\t"));
for (const d of data.DUNGEONS) {
  const cells = [`${d.name}(${d.level})`];
  for (const lv of LEVELS) {
    const sim = clearRate(d.id, lv, trials, 1000 + lv);
    const formula = offline.clearChance(lv, d.level);
    cells.push(`${Math.round(sim.rate * 100)}/${Math.round(formula * 100)}`);
  }
  console.log(cells.join("\t"));
}

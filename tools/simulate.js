// 戦闘シミュレーション: 初期パーティ構成で、ダンジョンごと・レベルごとの踏破率と1周の所要時間を計算する。
// オフライン進行も同じ戦闘エンジンで戦わせて精算するため、ここでの結果がそのままオフラインでの目安になる
// （ただしここでは装備・スキルツリー・道中イベントなしなので、実際のプレイより厳しめに出る）。
// 実行: node tools/simulate.js [試行回数=200]
//       node tools/simulate.js --check   … 難易度の基準（tools/lib/difficulty.js）を満たすか確認する
const { data, clearRate } = require("./lib/sim.js");

if (process.argv.includes("--check")) {
  const { STANDARD, check } = require("./lib/difficulty.js");
  console.log(`難易度の基準: 装備なしの初期パーティで、推奨Lv+${STANDARD.maxLevelsAboveRecommended}までに踏破率${Math.round(STANDARD.targetRate * 100)}%以上`);
  console.log("（レベルを上げても踏破率が下がらないこと、ダンジョンの順に難しくなることも確認。やり込み枠は踏破率の基準の対象外）");
  console.log("");
  let ng = 0;
  for (const r of check()) {
    const tag = r.dungeon.challenge ? "（やり込み枠）" : "";
    const curve = r.rows.map((x) => `Lv${x.level}:${Math.round(x.rate * 100)}%`).join(" ");
    console.log(`${r.problems.length ? "NG" : "OK"} ${r.dungeon.name}${tag} 推奨Lv${r.dungeon.level} → 踏破できるLv: ${r.firstLevelAtTarget || "-"}`);
    console.log(`   ${curve}`);
    for (const p of r.problems) console.log(`   ・${p}`);
    if (r.problems.length) ng += 1;
  }
  process.exit(ng ? 1 : 0);
}

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

// 戦闘シミュレーション: 初期パーティ構成で、ダンジョンごと・レベルごとの踏破率と1周の所要時間を計算する。
// オフライン進行も同じ戦闘エンジンで戦わせて精算するため、ここでの結果がそのままオフラインでの目安になる
// （ただしここでは装備・スキルツリー・道中イベントなしなので、実際のプレイより厳しめに出る）。
// 実行: node tools/simulate.js [試行回数=200]
//       node tools/simulate.js --check     … 難易度の基準（tools/lib/difficulty.js）を満たすか確認する
//       node tools/simulate.js --calibrate … 基準に合う「敵の強さの倍率」（DUNGEONS[].power）を提案する
//       node tools/simulate.js --build   … 想定プレイヤー（適正装備・スキル）で、装備とスキルの効き具合を比べる
const { data, clearRate } = require("./lib/sim.js");

if (process.argv.includes("--check")) {
  const { STANDARD, check, pct } = require("./lib/difficulty.js");
  const [lo, hi] = STANDARD.recommendedRange;
  console.log("難易度の基準（想定プレイヤー = 適正装備 + 素直なスキル振り）:");
  console.log(`  推奨Lvで${pct(lo)}〜${pct(hi)}／推奨Lv−${STANDARD.underLevel}で${pct(STANDARD.underLevelMin)}以上／装備なしだと推奨Lvで${pct(STANDARD.noGearMax)}未満／レベルを上げても下がらない`);
  console.log("  （最初のダンジョンはLv1・装備なしで踏破できること。やり込み枠は「下がらない」だけ確認）");
  console.log("");
  let ng = 0;
  for (const r of check()) {
    const d = r.dungeon;
    const g = d.benchmarkGear ? `${d.benchmarkGear.rarity.toUpperCase()}+${d.benchmarkGear.plus}` : "なし";
    const tag = d.challenge ? "（やり込み枠）" : "";
    console.log(`${r.problems.length ? "NG" : "OK"} ${d.name}${tag} 推奨Lv${d.level}・適正装備${g}・強さ倍率${d.power || 1}` + (r.noGear !== null ? `・装備なし推奨Lv:${pct(r.noGear)}` : ""));
    console.log("   " + r.rows.map((x) => `Lv${x.level}:${pct(x.rate)}`).join(" "));
    for (const p of r.problems) console.log(`   ・${p}`);
    if (r.problems.length) ng += 1;
  }
  process.exit(ng ? 1 : 0);
}

if (process.argv.includes("--calibrate")) {
  // ダンジョンを追加・調整した時に使う: 推奨Lvで想定プレイヤーの踏破率が目標になる強さ倍率を提案する
  const { STANDARD, calibrate, pct } = require("./lib/difficulty.js");
  console.log(`推奨Lvで想定プレイヤーの踏破率が${pct(STANDARD.calibrateTarget)}になる「敵の強さの倍率」（js/data.js の DUNGEONS[].power）`);
  data.DUNGEONS.forEach((d, index) => {
    if (index === 0) { console.log(`  ${d.name}: 最初のダンジョン（Lv1・装備なしで踏破できることが基準）のため対象外（現在 ${d.power || 1}）`); return; }
    if (d.challenge) { console.log(`  ${d.name}: やり込み枠のため対象外（現在 ${d.power || 1}）`); return; }
    console.log(`  ${d.name}: 提案 ${calibrate(d)}（現在 ${d.power || 1}）`);
  });
  process.exit(0);
}

if (process.argv.includes("--build")) {
  // 想定プレイヤー（適正装備・素直なスキル振り）で、装備とスキルがそれぞれどれだけ効いているかを比べる
  const n = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || "200", 10);
  console.log(`試行回数: ${n}回／適正装備はダンジョンごとの benchmarkGear、スキルは素直な振り方（tools/lib/sim.js）`);
  for (const d of data.DUNGEONS) {
    const g = d.benchmarkGear;
    const confs = [["なし", {}], ["装備のみ", { gear: g }], ["スキルのみ", { tree: true }], ["装備+スキル", { gear: g, tree: true }]];
    const levels = [d.level - 4, d.level - 3, d.level - 2, d.level - 1, d.level].filter((l) => l >= 1);
    console.log(`\n${d.name}（推奨Lv${d.level}・適正装備 ${g ? g.rarity.toUpperCase() + "+" + g.plus : "なし"}${d.power ? "・強さ倍率" + d.power : ""}）`);
    for (const [name, o] of confs) {
      console.log("  " + name.padEnd(7), levels.map((l) => `Lv${l}:${String(Math.round(clearRate(d.id, l, n, 100 + l, o).rate * 100)).padStart(3)}%`).join(" "));
    }
  }
  process.exit(0);
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

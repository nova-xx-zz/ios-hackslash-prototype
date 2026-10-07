// ダンジョンの難易度の基準（tests/difficulty.test.js と tools/simulate.js --check / --calibrate で共用）。
//
// 基準は「想定プレイヤー」で測る: 初期パーティ構成に、ダンジョンごとの適正装備（DUNGEONS[].benchmarkGear）と
// 素直なスキル振り（tools/lib/sim.js）を持たせた状態。一般的なRPGの「推奨戦力」と同じ考え方。
// モードごとの考え方（2026-10-07）:
//   ノーマル  … 適正装備だけ（スキルツリーなし）でも推奨Lvで何とか踏破できる強さに合わせる。ツリーを振れば安定する
//   ハード    … 適正装備＋素直なスキル振りで、推奨Lvで安定して踏破できる強さに合わせる
//   エクストラ … 敵の特性（アンデッド・霊体・魔法耐性・堅牢）が最大になる。いくつかのパーティ構成（COMPOSITIONS）の
//                うち一番合ったもので目標の踏破率になる強さに合わせる。構成が合わないと踏破できない
// 終盤ほどレベル差より装備の比重が大きい作り（docs/production-plan.md §8.6 の方針C）なので、
// 推奨Lvより低いレベルについては「ギリギリ挑める」下限だけを見て、上限は設けない。
const { data, clearRate } = require("./sim.js");

const STANDARD = {
  recommendedMin: 0.85, // 1) 推奨Lvで、適正装備＋スキルでこの踏破率以上（安定して周回できる）
  gearOnlyRange: [0.5, 0.9], // 1b) 推奨Lvで、適正装備だけ（スキルなし）でこの範囲（何とか踏破できるが、スキルを振る意味がある）
  underLevel: 2, // 2) 推奨Lv−この値でも…
  underLevelMin: 0.3, //    この踏破率以上（適正装備ならギリギリ挑める）
  noGearMax: 0.8, // 3) 推奨Lvで装備なし（スキルのみ）だと、この踏破率未満（装備を集める意味がある）
  monotonicTolerance: 0.05, // 4) レベルを上げた時に踏破率が下がってよい幅（乱数のぶれ）
  firstDungeonMin: 0.9, // 5) 最初のダンジョンは、Lv1・装備なし・スキルなしでこの踏破率以上
  calibrateTarget: 0.88, // ハード・エクストラ: 推奨Lvの踏破率をこの値に合わせる
  calibrateGearOnlyTarget: 0.7, // ノーマル（--calibrate）: 推奨Lvで、適正装備だけの踏破率をこの値に合わせる
  trials: 200,
  seed: 4242,
};

// 適正装備の装備のレベル: 指定が無ければ、ひとつ前のダンジョン（そこを周回して集めた装備で挑む想定）の推奨Lv
function benchmarkGearLevel(d) {
  if (d.benchmarkGear && d.benchmarkGear.level) return d.benchmarkGear.level;
  const i = data.DUNGEONS.indexOf(d);
  return i > 0 ? data.DUNGEONS[i - 1].level : 1;
}
function benchmark(d) {
  return { gear: d.benchmarkGear ? Object.assign({}, d.benchmarkGear, { level: benchmarkGearLevel(d) }) : null, tree: true };
}
// 適正装備だけ（スキルツリーなし）
function gearOnly(d) { return Object.assign(benchmark(d), { tree: false }); }
function rateAt(d, level, opts) { return clearRate(d.id, level, STANDARD.trials, STANDARD.seed + level, opts).rate; }
function pct(x) { return `${Math.round(x * 100)}%`; }

// 基準を満たすか確認する。戻り値: [{ dungeon, problems: [文章], rows: [{level, rate}], noGear }]
function check() {
  const results = [];
  data.DUNGEONS.forEach((d, index) => {
    const problems = [];
    const rows = [];
    for (let lv = Math.max(1, d.level - 4); lv <= d.level + 2; lv++) rows.push({ level: lv, rate: rateAt(d, lv, benchmark(d)) });
    const at = (lv) => (rows.find((r) => r.level === lv) || {}).rate;
    // 4) レベルを上げても踏破率が下がらない（やり込み枠も対象）
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].rate < rows[i - 1].rate - STANDARD.monotonicTolerance) {
        problems.push(`Lv${rows[i - 1].level}→Lv${rows[i].level}で踏破率が下がる（${pct(rows[i - 1].rate)}→${pct(rows[i].rate)}）`);
      }
    }
    let noGear = null;
    if (index === 0) {
      // 5) 最初のダンジョンは何も持たない初期パーティで踏破できる
      const r = rateAt(d, 1, {});
      if (r < STANDARD.firstDungeonMin) problems.push(`Lv1・装備なし・スキルなしで踏破率${pct(r)}（${pct(STANDARD.firstDungeonMin)}以上が必要）`);
    } else if (!d.challenge) {
      // 1) 推奨Lvで、スキルを振れば安定して周回できる
      const rec = at(d.level);
      if (rec < STANDARD.recommendedMin) problems.push(`推奨Lv${d.level}で踏破率${pct(rec)}（${pct(STANDARD.recommendedMin)}以上が目標）`);
      // 1b) 適正装備だけでも何とか踏破できる（スキルを振る意味もある）
      const [glo, ghi] = STANDARD.gearOnlyRange;
      const g = rateAt(d, d.level, gearOnly(d));
      if (g < glo || g > ghi) problems.push(`推奨Lvで適正装備だけ（スキルなし）の踏破率${pct(g)}（${pct(glo)}〜${pct(ghi)}が目標）`);
      // 2) 適正装備なら推奨Lv−2でもギリギリ挑める
      const underLv = d.level - STANDARD.underLevel;
      if (underLv >= 1 && at(underLv) < STANDARD.underLevelMin) problems.push(`推奨Lv−${STANDARD.underLevel}（Lv${underLv}）で踏破率${pct(at(underLv))}（${pct(STANDARD.underLevelMin)}以上が目標）`);
      // 3) 装備なしでは推奨Lvでも安定しない
      noGear = rateAt(d, d.level, { tree: true });
      if (noGear >= STANDARD.noGearMax) problems.push(`推奨Lvで装備なしでも踏破率${pct(noGear)}（${pct(STANDARD.noGearMax)}未満が目標。装備の意味が薄い）`);
    }
    results.push({ dungeon: d, problems, rows, noGear });
  });
  return results;
}

// 推奨Lvで、適正装備だけの踏破率が calibrateGearOnlyTarget になる「敵の強さの倍率」（DUNGEONS[].power）を探す
function calibrate(d) {
  const saved = d.power;
  let lo = 0.05, hi = 4.0; // 奥の地方ほど小さな倍率になるため、下限は0.05まで探す
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    d.power = mid;
    if (rateAt(d, d.level, gearOnly(d)) > STANDARD.calibrateGearOnlyTarget) lo = mid; else hi = mid;
  }
  d.power = saved;
  // 奥の地方では倍率が0.1台と小さく、0.01の差でも踏破率が大きく動くため、0.005刻みで提案する
  return Math.round(((lo + hi) / 2) * 200) / 200;
}

// ---------- ハード・エクストラ ----------
// 想定プレイヤー: そのモードの推奨Lv（上限100）で、そのレベルに着いた頃の適正装備（推奨Lvがそれ以下で一番奥の
// ダンジョンの benchmarkGear と、そのダンジョンの推奨Lvを装備のレベルにしたもの）と素直なスキル振り。
// 推奨Lvで calibrateTarget の踏破率にする。推奨Lvが100を超える分は、1Lvごとに目標を2%ずつ下げる
// （レベル上限の先は、装備の強化を積み上げて挑む）
function modeBenchmark(level) {
  let src = data.DUNGEONS[0];
  for (const x of data.DUNGEONS) if (x.level <= level) src = x;
  return { gear: Object.assign({}, src.benchmarkGear, { level: src.level }), tree: true };
}
function modeTarget(level) {
  return Math.max(0.3, STANDARD.calibrateTarget - 0.02 * Math.max(0, level - 100));
}
// エクストラで比べるパーティ構成（基本職のみ。どれか1つが合えば踏破できる強さに合わせる）
const COMPOSITIONS = {
  balanced: { name: "バランス（初期と同じ）", party: null },
  holy: { name: "聖属性重視", party: [{ job: "warrior", race: "human" }, { job: "monk", race: "beastkin" }, { job: "monk", race: "human" }, { job: "priest", race: "stonekin" }, { job: "priest", race: "sylvan" }] },
  magic: { name: "魔法重視", party: [{ job: "mage", race: "sylvan" }, { job: "mage", race: "nocturne" }, { job: "darkknight", race: "nocturne" }, { job: "priest", race: "stonekin" }, { job: "priest", race: "sylvan" }] },
  physical: { name: "物理重視", party: [{ job: "warrior", race: "human" }, { job: "warrior", race: "beastkin" }, { job: "thief", race: "human" }, { job: "monk", race: "beastkin" }, { job: "priest", race: "stonekin" }] },
};
function compRate(d, mode, compKey, trials) {
  const md = data.getModeDungeon(d.id, mode);
  const comp = COMPOSITIONS[compKey];
  return clearRate(d.id, Math.min(100, md.level), trials || STANDARD.trials, STANDARD.seed + md.level,
    Object.assign({ mode, party: comp.party || undefined }, modeBenchmark(md.level))).rate;
}
// ハードは初期パーティ、エクストラは構成のうち一番高い踏破率
function modeRate(d, mode) {
  if (mode !== "extra") return compRate(d, mode, "balanced");
  let best = 0;
  for (const k of Object.keys(COMPOSITIONS)) best = Math.max(best, compRate(d, mode, k));
  return best;
}
// そのモードの推奨Lvで想定プレイヤーの踏破率が目標になる「敵の強さの倍率」（DUNGEONS[].modePower[mode]）を探す
function calibrateMode(d, mode) {
  const saved = d.modePower;
  const target = modeTarget(data.getModeDungeon(d.id, mode).level);
  let lo = 0.05, hi = 6;
  for (let i = 0; i < 15; i++) {
    const mid = (lo + hi) / 2;
    d.modePower = Object.assign({}, saved, { [mode]: mid });
    // エクストラは、どれか1つの構成が目標を超えれば「踏破できる」（全部は測らない）
    const keys = mode === "extra" ? Object.keys(COMPOSITIONS) : ["balanced"];
    if (keys.some((k) => compRate(d, mode, k) > target)) lo = mid; else hi = mid;
  }
  d.modePower = saved;
  return Math.round(((lo + hi) / 2) * 200) / 200;
}

module.exports = { STANDARD, COMPOSITIONS, check, calibrate, pct, benchmark, gearOnly, benchmarkGearLevel, modeBenchmark, modeTarget, modeRate, compRate, calibrateMode };

// ダンジョンの難易度の基準（tests/difficulty.test.js と tools/simulate.js --check / --calibrate で共用）。
//
// 基準は「想定プレイヤー」で測る: 初期パーティ構成に、ダンジョンごとの適正装備（DUNGEONS[].benchmarkGear）と
// 素直なスキル振り（tools/lib/sim.js）を持たせた状態。一般的なRPGの「推奨戦力」と同じ考え方。
// 終盤ほどレベル差より装備の比重が大きい作り（docs/production-plan.md §8.6 の方針C）なので、
// 推奨Lvより低いレベルについては「ギリギリ挑める」下限だけを見て、上限は設けない。
const { data, clearRate } = require("./sim.js");

const STANDARD = {
  recommendedRange: [0.8, 0.95], // 1) 推奨Lvで、この範囲の踏破率（安定して周回できるが、楽すぎない）
  underLevel: 2, // 2) 推奨Lv−この値でも…
  underLevelMin: 0.3, //    この踏破率以上（適正装備ならギリギリ挑める）
  noGearMax: 0.8, // 3) 推奨Lvで装備なし（スキルのみ）だと、この踏破率未満（装備を集める意味がある）
  monotonicTolerance: 0.05, // 4) レベルを上げた時に踏破率が下がってよい幅（乱数のぶれ）
  firstDungeonMin: 0.9, // 5) 最初のダンジョンは、Lv1・装備なし・スキルなしでこの踏破率以上
  calibrateTarget: 0.88, // --calibrate で、推奨Lvの踏破率をこの値に合わせる
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
      // 1) 推奨Lvで安定して周回できる
      const [lo, hi] = STANDARD.recommendedRange;
      const rec = at(d.level);
      if (rec < lo || rec > hi) problems.push(`推奨Lv${d.level}で踏破率${pct(rec)}（${pct(lo)}〜${pct(hi)}が目標）`);
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

// 推奨Lvで想定プレイヤーの踏破率が calibrateTarget になる「敵の強さの倍率」（DUNGEONS[].power）を探す
function calibrate(d) {
  const saved = d.power;
  let lo = 0.1, hi = 4.0; // 奥の地方ほど小さな倍率になるため、下限は0.1まで探す
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    d.power = mid;
    if (rateAt(d, d.level, benchmark(d)) > STANDARD.calibrateTarget) lo = mid; else hi = mid;
  }
  d.power = saved;
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

module.exports = { STANDARD, check, calibrate, pct, benchmarkGearLevel };

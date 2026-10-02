// ダンジョンの難易度の基準（tests/difficulty.test.js と tools/simulate.js --check で共用）。
// 戦闘シミュレーションは装備・スキルツリー・道中イベントなしの初期パーティ構成で行うため、
// 実際のプレイより厳しめに出る。そのため「推奨Lvちょうどで何%」ではなく、装備やツリーの有無に
// 左右されにくい性質を基準にしている。
const { data, clearRate } = require("./sim.js");

const STANDARD = {
  targetRate: 0.8, // 「踏破できる」とみなす踏破率
  maxLevelsAboveRecommended: 6, // 装備なしでも推奨Lv+この値までに targetRate に届くこと
  monotonicTolerance: 0.05, // レベルを上げた時に踏破率が下がってよい幅（乱数のぶれ）
  trials: 200,
  seed: 4242,
};

// 推奨Lv−2〜推奨Lv+maxLevelsAboveRecommended までの踏破率
function profile(dungeon) {
  const rows = [];
  for (let lv = Math.max(1, dungeon.level - 2); lv <= dungeon.level + STANDARD.maxLevelsAboveRecommended; lv++) {
    rows.push({ level: lv, rate: clearRate(dungeon.id, lv, STANDARD.trials, STANDARD.seed + lv).rate });
  }
  return rows;
}

// 基準を満たすか確認する。戻り値: [{ dungeon, problems: [文章], firstLevelAtTarget, rows }]
function check() {
  const results = [];
  let prevFirst = 0;
  for (const d of data.DUNGEONS) {
    const rows = profile(d);
    const problems = [];
    // 1) レベルを上げても踏破率が下がらない（AIの技選びの逆転などを検出する）
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].rate < rows[i - 1].rate - STANDARD.monotonicTolerance) {
        problems.push(`Lv${rows[i - 1].level}→Lv${rows[i].level}で踏破率が下がる（${pct(rows[i - 1].rate)}→${pct(rows[i].rate)}）`);
      }
    }
    const hit = rows.find((r) => r.rate >= STANDARD.targetRate);
    const firstLevelAtTarget = hit ? hit.level : null;
    if (!d.challenge) {
      // 2) 推奨Lv+maxLevelsAboveRecommended までに踏破できる
      if (!hit) problems.push(`推奨Lv+${STANDARD.maxLevelsAboveRecommended}（Lv${d.level + STANDARD.maxLevelsAboveRecommended}）でも踏破率${pct(rows[rows.length - 1].rate)}で、${pct(STANDARD.targetRate)}に届かない`);
      // 3) ダンジョンの並び順どおりに難しくなる（踏破できるようになるLvが前のダンジョン以上）
      if (hit && hit.level < prevFirst) problems.push(`前のダンジョンより易しい（踏破率${pct(STANDARD.targetRate)}に届くLvが${hit.level}で、前のダンジョンの${prevFirst}より低い）`);
      if (hit) prevFirst = hit.level;
    }
    results.push({ dungeon: d, problems, firstLevelAtTarget, rows });
  }
  return results;
}

function pct(x) { return `${Math.round(x * 100)}%`; }

module.exports = { STANDARD, profile, check };

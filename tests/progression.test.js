// 実行: node --test（リポジトリ直下で）
// レベル曲線と進行ペース。ふつうに遊んだ時（tools/progression.js）に各ダンジョンへ着く累計周回が目標の範囲に入り、
// その頃の装備が適正装備（DUNGEONS[].benchmarkGear）とずれていないことを確認する。
// ドロップ率・強化・EXP・レベル曲線を変えた時にペースが崩れたことを検出する（docs/production-plan.md §8.6）
const test = require("node:test");
const assert = require("node:assert/strict");
const { data } = require("../tools/lib/sim.js");
const { simulate, typical } = require("../tools/progression.js");

// 到着時の累計周回の目標（中央値）。±30%まで許容する
const TARGET_RUNS = {
  forest: 10, cave: 20, ruins: 45, peak: 95, // ヴェルデ地方
  dunes: 108, canyon: 136, oasis: 168, tomb: 206, sun_temple: 266, // サブル地方（1ダンジョンごとに+20〜60周）
  frost_forest: 299, frozen_lake: 352, crystal_cave: 407, snow_fort: 468, ice_throne: 554, // グラシア地方（+30〜90周）
};
const RUNS_TOLERANCE = 0.3;
const PLUS_TOLERANCE = 2; // 適正装備の+値とのずれの許容
const TRIALS = 50;

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("expForLevel: 整数で、レベルが上がるほど必要EXPが増える", () => {
  for (let lv = 1; lv < 99; lv++) {
    const e = data.expForLevel(lv);
    assert.ok(Number.isInteger(e) && e > 0, `Lv${lv}: ${e}`);
    assert.ok(data.expForLevel(lv + 1) > e, `Lv${lv}→${lv + 1}で減っている`);
  }
});

test("syncExpToNext: 必要EXPを曲線から計算し直し、レベルは据え置く", () => {
  const rec = { level: 3, exp: 70, expToNext: 75 }; // 旧曲線のセーブ
  data.syncExpToNext(rec);
  assert.deepEqual({ ...rec }, { level: 3, exp: 70, expToNext: data.expForLevel(3) });
  const over = { level: 2, exp: 99999, expToNext: 60 }; // exp は新しい必要量未満に丸める
  data.syncExpToNext(over);
  assert.equal(over.exp, data.expForLevel(2) - 1);
  const bad = { level: 4, exp: "x" };
  data.syncExpToNext(bad);
  assert.equal(bad.exp, 0);
  const noLevel = { skillTree: {} }; // レベルを持たない記録には触れない
  data.syncExpToNext(noLevel);
  assert.deepEqual({ ...noLevel }, { skillTree: {} });
});

const results = Array.from({ length: TRIALS }, (_, t) => simulate(500 + t));
results[0].forEach((arrival, i) => {
  const d = arrival.dungeon;
  test(`進行ペース: ${d.name}（推奨Lv${d.level}）への到着`, () => {
    const runs = median(results.map((r) => r[i].totalRuns));
    const target = TARGET_RUNS[d.id];
    assert.ok(target, `${d.id} の目標周回が未設定（TARGET_RUNS に追加する）`);
    assert.ok(Math.abs(runs - target) <= target * RUNS_TOLERANCE, `累計周回の中央値 ${runs}（目標 ${target}±${RUNS_TOLERANCE * 100}%）`);

    // 到着時の装備の代表値: 一番多いレア度が適正装備と同じで、そのレア度の+値の中央値が近いこと
    const typ = results.map((r) => typical(r[i].items));
    const count = {};
    for (const t of typ) count[t.rarity] = (count[t.rarity] || 0) + 1;
    const rarity = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const plus = median(typ.filter((t) => t.rarity === rarity).map((t) => t.plus));
    const g = d.benchmarkGear;
    assert.equal(rarity, g.rarity, `到着時の代表的なレア度 ${rarity.toUpperCase()}（適正装備 ${g.rarity.toUpperCase()}+${g.plus}）`);
    assert.ok(Math.abs(plus - g.plus) <= PLUS_TOLERANCE, `到着時の+値の中央値 +${plus}（適正装備 +${g.plus}±${PLUS_TOLERANCE}）`);
  });
});

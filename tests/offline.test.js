// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const offline = require("../js/core/offline.js");
const { createRng } = require("../js/core/rng.js");
const data = require("./helpers/load-data.js").loadGameData();

const TIMING = { perBattle: 5, perGap: 2, overhead: 2 };
const HOUR = 3600 * 1000;

function ctxFor(dungeonId, clearChance, rng) {
  const dungeon = data.getDungeon(dungeonId);
  return {
    battles: dungeon.battles,
    clearChance,
    rng,
    rules: data.REWARD_RULES,
    buildEncounter: (i) => data.buildEncounter(dungeon, i),
    isTamable: (key) => !!data.getEnemyTemplate(key).tamable,
    tameChanceOf: (key) => data.getEnemyTemplate(key).tameChance,
    rollOne: data.rollItemDrop,
  };
}

test("1周の目安時間と踏破確率", () => {
  assert.equal(offline.estimateRunSeconds(3, TIMING), 21);
  assert.equal(offline.estimateRunSeconds(1, TIMING), 7);
  assert.equal(offline.clearChance(4, 4), 0.85);
  assert.equal(offline.clearChance(100, 1), 0.98);
  assert.equal(offline.clearChance(1, 100), 0.05);
});

test("挑戦する周回数は経過時間（最大8時間）と自動周回の残り回数の小さい方", () => {
  const base = { maxMs: 8 * HOUR, secPerRun: 21 };
  assert.equal(offline.planRuns({ ...base, elapsedMs: HOUR, target: 50, done: 0 }), 50);
  assert.equal(offline.planRuns({ ...base, elapsedMs: 10 * 60 * 1000, target: 50, done: 0 }), 28);
  assert.equal(offline.planRuns({ ...base, elapsedMs: HOUR, target: 50, done: 45 }), 5);
  assert.equal(offline.planRuns({ ...base, elapsedMs: 10 * 1000, target: 50, done: 0 }), 0);
  assert.equal(offline.planRuns({ ...base, elapsedMs: -HOUR, target: 50, done: 0 }), 0); // 時計が戻っても負にしない
  assert.equal(offline.planRuns({ ...base, secPerRun: 1, elapsedMs: 100 * HOUR, target: 1e9, done: 0 }), 8 * 3600);
});

test("踏破した周はドロップとテイム判定があり、全戦闘ぶんのEXPを得る", () => {
  const rng = createRng(1);
  const out = offline.simulateRun(ctxFor("plains", 1, rng));
  assert.equal(out.cleared, true);
  assert.equal(out.expByBattle.length, data.getDungeon("plains").battles);
  assert.ok(out.drops.length >= out.expByBattle.length);
  assert.ok(out.encountered.length > 0);
});

test("全滅した周はドロップとテイムを持ち帰れないが、勝った戦闘のEXPは残る", () => {
  const rng = createRng(2);
  let sawPartialExp = false;
  for (let i = 0; i < 200; i++) {
    const out = offline.simulateRun(ctxFor("forest", 0, rng));
    assert.equal(out.cleared, false);
    assert.deepEqual(out.drops, []);
    assert.equal(out.tame, null);
    assert.ok(out.expByBattle.length < data.getDungeon("forest").battles);
    if (out.expByBattle.length > 0) sawPartialExp = true;
  }
  assert.ok(sawPartialExp);
});

test("同じシードなら同じ結果になる（サーバーでの再計算・検証に使える）", () => {
  // 敵の編成・装備の抽選はdata.jsの共有乱数を使うため、共有乱数にシードを設定して丸ごと再現する
  const { shared, setSharedSeed } = require("../js/core/rng.js");
  setSharedSeed(99);
  const a = offline.simulateRun(ctxFor("forest", 0.8, shared));
  setSharedSeed(99);
  const b = offline.simulateRun(ctxFor("forest", 0.8, shared));
  setSharedSeed(undefined);
  assert.deepEqual(
    { ...a, drops: a.drops.map((d) => d.name) },
    { ...b, drops: b.drops.map((d) => d.name) },
  );
});

test("踏破した周の平均ドロップ数は通常プレイと同じ計算（3戦で約4.5個）", () => {
  const rng = createRng(7);
  let total = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) total += offline.simulateRun(ctxFor("plains", 1, rng)).drops.length;
  // 戦闘3回×1.4個 ＋ 戦闘間2回×(イベント0.6×宝箱0.4×中身あり0.65)
  const expected = 3 * 1.4 + 2 * 0.6 * 0.4 * 0.65;
  assert.ok(Math.abs(total / N - expected) < 0.08, `平均 ${(total / N).toFixed(2)} / 期待 ${expected.toFixed(2)}`);
});

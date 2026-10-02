// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const offline = require("../js/core/offline.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

const TIMING = { perBattle: 5, perGap: 2, overhead: 2 };

// fight: 何戦目まで勝つか（winUntil戦目で負ける。Infinityなら全勝）と、1戦あたりの秒数を指定する
function ctxFor(dungeonId, rng, opts) {
  opts = opts || {};
  const dungeon = data.getDungeon(dungeonId);
  const events = [];
  return {
    events,
    battles: dungeon.battles,
    rng,
    rules: data.REWARD_RULES,
    timing: TIMING,
    buildEncounter: (i) => data.buildEncounter(dungeon, i),
    fight: (enemies, i) => ({ won: i < (opts.winUntil === undefined ? Infinity : opts.winUntil), seconds: opts.secondsPerBattle || 4 }),
    onEvent: (kind) => events.push(kind),
    isTamable: (key) => !!data.getEnemyTemplate(key).tamable,
    tameChanceOf: (key) => data.getEnemyTemplate(key).tameChance,
    rollOne: data.rollItemDrop,
  };
}

test("1周の目安時間（バックグラウンド復帰時に1周ぶん経ったかの判断に使う）", () => {
  assert.equal(offline.estimateRunSeconds(3, TIMING), 21);
  assert.equal(offline.estimateRunSeconds(1, TIMING), 7);
});

test("全勝した周は踏破扱いで、全戦闘ぶんのEXP・ドロップ・テイム判定がある", () => {
  const out = offline.simulateRun(ctxFor("plains", createRng(1)));
  assert.equal(out.cleared, true);
  assert.equal(out.expByBattle.length, data.getDungeon("plains").battles);
  assert.ok(out.drops.length >= out.expByBattle.length);
  assert.ok(out.encountered.length > 0);
});

test("所要時間 = 戦闘の秒数の合計 + 戦闘間 + 出発〜踏破", () => {
  const out = offline.simulateRun(ctxFor("plains", createRng(1), { secondsPerBattle: 10 }));
  assert.equal(out.seconds, 3 * 10 + 2 * TIMING.perGap + TIMING.overhead);
});

test("負けた戦闘で周回は終わり、ドロップとテイムは持ち帰れないが、それまでに勝った戦闘のEXPは残る", () => {
  const ctx = ctxFor("forest", createRng(2), { winUntil: 2 });
  const out = offline.simulateRun(ctx);
  assert.equal(out.cleared, false);
  assert.equal(out.expByBattle.length, 2);
  assert.deepEqual(out.drops, []);
  assert.equal(out.tame, null);
  // 負けた3戦目の敵も図鑑には登録される
  assert.ok(out.encountered.length > 0);
});

test("泉・罠などの道中イベントはonEventで戦闘側に伝わる（宝箱はドロップとして扱う）", () => {
  const ctx = ctxFor("ruins", createRng(3));
  for (let i = 0; i < 50; i++) offline.simulateRun(ctx);
  assert.ok(ctx.events.length > 0);
  assert.ok(ctx.events.every((k) => k === "trap" || k === "spring" || k === "shrine"));
});

test("同じシードなら同じ結果になる（サーバーでの再計算・検証に使える）", () => {
  // 敵の編成・装備の抽選はdata.jsの共有乱数を使うため、共有乱数にシードを設定して丸ごと再現する
  const { shared, setSharedSeed } = require("../js/core/rng.js");
  setSharedSeed(99);
  const a = offline.simulateRun(ctxFor("forest", shared, { winUntil: 2 }));
  setSharedSeed(99);
  const b = offline.simulateRun(ctxFor("forest", shared, { winUntil: 2 }));
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
  for (let i = 0; i < N; i++) total += offline.simulateRun(ctxFor("plains", rng)).drops.length;
  // 戦闘3回×1.4個 ＋ 戦闘間2回×(イベント0.6×宝箱0.4×中身あり0.65)
  const expected = 3 * 1.4 + 2 * 0.6 * 0.4 * 0.65;
  assert.ok(Math.abs(total / N - expected) < 0.08, `平均 ${(total / N).toFixed(2)} / 期待 ${expected.toFixed(2)}`);
});

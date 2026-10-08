// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRng, shared, setSharedSeed } = require("../js/core/rng.js");

test("同じシードなら同じ並びになる", () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  const seqC = Array.from({ length: 10 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test("next/float/intは範囲内に収まる", () => {
  const r = createRng(1);
  for (let i = 0; i < 10000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    const f = r.float(0.9, 1.15);
    assert.ok(f >= 0.9 && f < 1.15);
    const n = r.int(5);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
  }
});

test("chanceはおおよそ指定した確率でtrueになる", () => {
  const r = createRng(7);
  let hits = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) if (r.chance(0.3)) hits++;
  assert.ok(Math.abs(hits / N - 0.3) < 0.01, `hits=${hits / N}`);
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(1), true);
});

test("pickは配列の全要素を偏りなく選ぶ", () => {
  const r = createRng(9);
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 30000; i++) counts[r.pick(["a", "b", "c"])]++;
  for (const k of Object.keys(counts)) assert.ok(Math.abs(counts[k] - 10000) < 500, JSON.stringify(counts));
});

test("共有乱数はシードを差し替えると再現でき、解除すると通常の乱数に戻る", () => {
  setSharedSeed(123);
  const first = [shared.next(), shared.next()];
  setSharedSeed(123);
  assert.deepEqual([shared.next(), shared.next()], first);
  setSharedSeed(undefined);
  const x = shared.next();
  assert.ok(x >= 0 && x < 1);
});

test("withSharedSource: 実行中だけ共有乱数を別の並びに切り替え、終われば（例外でも）元に戻す。入れ子にできる", () => {
  const { withSharedSource, seededSource } = require("../js/core/rng.js");
  setSharedSeed(5);
  const outer = seededSource(5);
  assert.equal(shared.next(), outer());
  const a = seededSource(1), a2 = seededSource(1), b2 = seededSource(2);
  const inA = withSharedSource(a, () => {
    const x = shared.next();
    const y = withSharedSource(seededSource(2), () => shared.next());
    return [x, y, shared.next()];
  });
  assert.deepEqual(inA, [a2(), b2(), a2()]); // 入れ子の後は外側の並びの続き
  assert.throws(() => withSharedSource(seededSource(3), () => { throw new Error("x"); }));
  assert.equal(shared.next(), outer()); // 元の並び（シード5）の続きに戻っている
  setSharedSeed(undefined);
});

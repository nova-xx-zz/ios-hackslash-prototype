// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const enhance = require("../js/core/enhance.js");
const { createRng } = require("../js/core/rng.js");
const { ENHANCE_RULES: R } = require("../tools/lib/load-data.js").loadGameData();

const item = (rarity, plus, pity) => ({ rarity, plus, pity });
const alwaysFail = { chance: () => false };
const alwaysWin = { chance: () => true };

test("LRの+98は成功率0.5%・1回500個で、期待消費は約10万個", () => {
  assert.equal(enhance.successRate(R, "lr", 98), 0.005);
  assert.equal(enhance.cost(R, "lr", 98), 500);
  assert.equal(Math.round(enhance.expectedCost(R, "lr", 98)), 100000);
  assert.equal(enhance.cost(R, "lr", 0), 150);
});

test("N〜URの成功率の下限は3%、消費は+値によらず一定", () => {
  assert.equal(enhance.successRate(R, "ur", 99), Math.max(0.03, 0.35 * 0.978 ** 99));
  assert.ok(enhance.successRate(R, "n", 98) > 0.5);
  assert.equal(enhance.cost(R, "sr", 0), enhance.cost(R, "sr", 98));
});

test("確定強化石の必要個数は期待消費÷1万（最低1個）", () => {
  assert.equal(enhance.guaranteedRequired(R, "n", 0), 1);
  assert.equal(enhance.guaranteedRequired(R, "ur", 98), 1);
  assert.equal(enhance.guaranteedRequired(R, "lr", 50), 2);
  assert.equal(enhance.guaranteedRequired(R, "lr", 70), 4);
  assert.equal(enhance.guaranteedRequired(R, "lr", 90), 8);
  assert.equal(enhance.guaranteedRequired(R, "lr", 98), 10);
  let total = 0;
  for (let p = 0; p < 99; p++) total += enhance.guaranteedRequired(R, "lr", p);
  assert.ok(total > 280 && total < 320, `LR合計 ${total}個`);
});

test("失敗すると天井ゲージに消費が貯まり、成功すると0に戻る", () => {
  const fail = enhance.attempt(R, item("lr", 98, 1000), { rng: alwaysFail, pityEnabled: true });
  assert.deepEqual(fail, { success: false, pityHit: false, cost: 500, plus: 98, pity: 1500 });
  const win = enhance.attempt(R, item("lr", 98, 1000), { rng: alwaysWin, pityEnabled: true });
  assert.deepEqual(win, { success: true, pityHit: false, cost: 500, plus: 99, pity: 0 });
});

test("天井に達していれば乱数に関係なく成功する。天井が無効なら貯まらない", () => {
  const threshold = enhance.pityThreshold(R, "lr", 98);
  assert.equal(threshold, 150000);
  const hit = enhance.attempt(R, item("lr", 98, threshold), { rng: alwaysFail, pityEnabled: true });
  assert.equal(hit.success, true);
  assert.equal(hit.pityHit, true);
  const off = enhance.attempt(R, item("lr", 98, threshold), { rng: alwaysFail, pityEnabled: false });
  assert.equal(off.success, false);
  assert.equal(off.pity, threshold);
});

test("天井があれば、どれだけ運が悪くても期待消費の1.5倍＋1回ぶんで必ず上がる", () => {
  let it = item("lr", 98, 0);
  let spent = 0;
  for (let i = 0; i < 10000 && it.plus === 98; i++) {
    const r = enhance.attempt(R, it, { rng: alwaysFail, pityEnabled: true });
    spent += r.cost;
    it = { ...it, plus: r.plus, pity: r.pity };
  }
  assert.equal(it.plus, 99);
  assert.ok(spent <= enhance.pityThreshold(R, "lr", 98) + enhance.cost(R, "lr", 98));
});

test("実際の乱数でも、LR+98の平均消費はおおよそ期待値になる（天井なし）", () => {
  const rng = createRng(2024);
  const trials = 400;
  let spent = 0;
  for (let t = 0; t < trials; t++) {
    let it = item("lr", 98, 0);
    while (it.plus === 98) {
      const r = enhance.attempt(R, it, { rng, pityEnabled: false });
      spent += r.cost;
      it = { ...it, plus: r.plus, pity: r.pity };
    }
  }
  const avg = spent / trials;
  assert.ok(avg > 80000 && avg < 120000, `平均 ${Math.round(avg)}`);
});

test("確定強化石は無償分から消費し、足りなければ使えない", () => {
  const ok = enhance.useGuaranteed(R, item("lr", 98, 777), { free: 3, paid: 10 });
  assert.deepEqual(ok, { ok: true, required: 10, stones: { free: 0, paid: 3 }, plus: 99, pity: 0 });
  const ng = enhance.useGuaranteed(R, item("lr", 98, 0), { free: 0, paid: 9 });
  assert.deepEqual(ng, { ok: false, required: 10 });
});

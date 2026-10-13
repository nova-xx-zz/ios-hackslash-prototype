const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/core/element-affinity-trial.js");

const ALL = Object.keys(E.ELEMENTS);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
  "expected " + expected + ", got " + actual);

test("10種類が定義され、10×10=100通りすべて計算可能", () => {
  assert.equal(ALL.length, 10);
  let count = 0;
  for (const attack of ALL) for (const defense of ALL) {
    const v = E.resolve({attackElement: attack, defenseElement: defense});
    assert.ok(Number.isFinite(v.multiplier));
    assert.ok(v.multiplier >= 0);
    if (attack === defense) near(v.multiplier, 1);
    count++;
  }
  assert.equal(count, 100);
});

test("基本5属性は土→炎→氷→雷→木→土の循環。有利1.3、不利0.8", () => {
  const order = E.BASIC;
  for (let i = 0; i < order.length; i++) {
    const left = order[i], right = order[(i + 1) % order.length];
    assert.equal(E.baseAffinity(left, right).kind, "advantage");
    near(E.baseAffinity(left, right).multiplier, 1.3);
    assert.equal(E.baseAffinity(right, left).kind, "disadvantage");
    near(E.baseAffinity(right, left).multiplier, 0.8);
  }
  near(E.baseAffinity("fire", "wood").multiplier, 1);
});

test("特殊ペアは双方とも1.25倍、それ以外の組み合わせは中立", () => {
  for (const pair of E.SPECIAL_PAIRS) {
    for (const [att, def] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
      near(E.baseAffinity(att, def).multiplier, 1.25);
    }
  }
  near(E.baseAffinity("dragon", "gold").multiplier, 1);
  near(E.baseAffinity("bloodstained", "chaos").multiplier, 1);
});

test("虚無は他9属性に1.15倍・虚無同士は1倍・他属性から虚無は未定義有利を付けない", () => {
  for (const def of ALL.filter(e => e !== "void")) {
    near(E.baseAffinity("void", def).multiplier, 1.15);
  }
  near(E.baseAffinity("void", "void").multiplier, 1);
  near(E.baseAffinity("fire", "void").multiplier, 1);
});

test("ダンジョンの虚無抑制・活性と敵固有耐性を組み合わせる", () => {
  near(E.resolve({ attackElement:"void", defenseElement:"earth",
    dungeon:{voidMultiplier:0.7} }).multiplier, 0.805);
  near(E.resolve({ attackElement:"void", defenseElement:"earth",
    dungeon:{voidMultiplier:1.4} }).multiplier, 1.61);
  near(E.resolve({ attackElement:"void", defenseElement:"earth",
    dungeon:{voidMultiplier:1.4},
    enemy:{elementMultipliers:{void:0.5}} }).multiplier, 0.805);
  // 環境の虚無倍率が他属性に漏れない。
  near(E.resolve({ attackElement:"wood", defenseElement:"earth",
    dungeon:{voidMultiplier:0.7} }).multiplier, 1.3);
});

test("完全無効は0、敵固有0倍率・ダンジョン封印・虚無抑制0いずれも適用", () => {
  const base = {attackElement:"void", defenseElement:"earth"};
  const cases = [
    { enemy: { immuneElements:["void"] } },
    { enemy: { elementMultipliers:{void:0} } },
    { dungeon: { blockedElements:["void"] } },
    { dungeon: { voidMultiplier:0 } }
  ];
  for (const extra of cases) {
    const v = E.resolve({...base, ...extra});
    assert.equal(v.multiplier, 0);
    assert.equal(v.immune, true);
    assert.equal(v.reason, "immune");
  }
});

test("属性反転は対策する不利属性だけ1.3倍、無効相手を突破しない", () => {
  let v = E.resolve({attackElement:"fire",defenseElement:"earth",reversalTarget:"earth"});
  near(v.baseMultiplier, 0.8);
  near(v.multiplier, 1.3);
  assert.equal(v.reversed, true);
  near(E.resolve({attackElement:"fire",defenseElement:"ice",reversalTarget:"earth"}).multiplier, 1.3);
  near(E.resolve({attackElement:"fire",defenseElement:"wood",reversalTarget:"earth"}).multiplier, 1);
  near(E.resolve({attackElement:"fire",defenseElement:"earth",reversalTarget:"wood"}).multiplier, 0.8);
  v = E.resolve({attackElement:"fire",defenseElement:"earth",reversalTarget:"earth",
    enemy:{immuneElements:["fire"]}});
  assert.equal(v.multiplier, 0);
  assert.equal(v.reversed, false);
});

test("無属性は中立、未定義の属性名・無効な倍率を拒否", () => {
  near(E.resolve({attackElement:null,defenseElement:"earth"}).multiplier, 1);
  near(E.resolve({attackElement:"fire",defenseElement:null}).multiplier, 1);
  assert.throws(() => E.baseAffinity("holy", "fire"), /Unknown element/);
  assert.throws(() => E.resolve({attackElement:"水",defenseElement:"earth"}), /Unknown element/);
  assert.throws(() => E.resolve({attackElement:"void",defenseElement:"earth",
    dungeon:{voidMultiplier:-0.5}}), /multiplier/);
  assert.throws(() => E.resolve({attackElement:"fire",defenseElement:"earth",
    enemy:{elementMultipliers:{fire:NaN}}}), /multiplier/);
  assert.throws(() => E.resolve({attackElement:"void",defenseElement:"earth",
    enemy:{immuneElements:"void"}}), /array/);
});

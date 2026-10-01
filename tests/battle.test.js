// 実行: node --test（リポジトリ直下で）
const test = require("node:test");
const assert = require("node:assert/strict");
const battle = require("../js/core/battle.js");
const { createRng } = require("../js/core/rng.js");
const sim = require("../tools/lib/sim.js");

// 乱数を固定値にする（float(a,b)は常に中間の値、chanceは常にfalse=会心なし）
const fixedRng = { float: (a, b) => (a + b) / 2, chance: () => false, pick: (arr) => arr[0], int: () => 0, next: () => 0.5 };

function envWith(overrides) {
  return Object.assign({
    rng: fixedRng,
    atbRate: 7,
    stats: (c) => c.stats,
    abilities: (c) => c.abilities || [],
    mpCost: (c, a) => a.mpCost,
    tier: (c, id) => (c.tiers && c.tiers[id]) || 2,
    passives: (c) => Object.assign({ lifesteal: 0, healBonus: 0, critBonus: 0, dmgTakenMult: 1 }, c.passives || {}),
  }, overrides || {});
}
const member = (name, stats, extra) => Object.assign({ name, stats, hp: stats.maxHp, mp: stats.maxMp, atb: 0, alive: true }, extra || {});
const enemy = (name, hp, extra) => Object.assign({ name, hp, maxHp: hp, atk: 10, def: 0, spd: 5, atb: 0, alive: true }, extra || {});
const S = { maxHp: 100, maxMp: 20, atk: 20, mag: 20, def: 10, spd: 10 };

const fire = { id: "fire", name: "ファイア", reqLevel: 1, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1 };
const bigFire = { id: "big", name: "だいばくれつ", reqLevel: 15, mpCost: 16, kind: "magic", target: "all-enemy", power: 1.6, hits: 1 };
const heal = { id: "heal", name: "ヒール", reqLevel: 1, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1 };

test("技は優先度→要求レベルの順で選び、MPが足りなければ使わない", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [fire, bigFire] });
  assert.equal(battle.chooseAction(c, [c], env).id, "big"); // 同じ優先度なら要求レベルが高い方
  c.tiers = { fire: 3 };
  assert.equal(battle.chooseAction(c, [c], env).id, "fire"); // 「優先」が勝つ
  c.tiers = {};
  c.mp = 10;
  assert.equal(battle.chooseAction(c, [c], env).id, "fire"); // MP不足の技は候補外
  c.mp = 0;
  assert.equal(battle.chooseAction(c, [c], env).id, "attack"); // 何も使えなければ通常攻撃
});

test("回復技は誰かのHPが8割未満の時だけ使う", () => {
  const env = envWith();
  const healer = member("H", S, { abilities: [heal] });
  const ally = member("B", S);
  assert.equal(battle.chooseAction(healer, [healer, ally], env).id, "attack");
  ally.hp = 79;
  assert.equal(battle.chooseAction(healer, [healer, ally], env).id, "heal");
});

test("攻撃対象は設定に従う（弱い敵から／強い敵から）", () => {
  const es = [enemy("a", 30), enemy("b", 10), enemy("c", 50)];
  assert.equal(battle.pickEnemyTarget({ targetPriority: "weakest" }, es, fixedRng).name, "b");
  assert.equal(battle.pickEnemyTarget({ targetPriority: "strongest" }, es, fixedRng).name, "c");
  es[1].alive = false;
  assert.equal(battle.pickEnemyTarget({ targetPriority: "weakest" }, es, fixedRng).name, "a");
});

test("物理ダメージ = (ATK×威力 − 敵DEF×0.3) × 乱数幅、吸収・撃破がイベントで返る", () => {
  const env = envWith();
  const c = member("A", S, { passives: { lifesteal: 0.5 } });
  c.hp = 50;
  const e = enemy("slime", 15, { def: 10 });
  const events = [];
  battle.performCharacterAction(c, [c], { enemies: [e] }, env, events);
  // 通常攻撃: round(20×1.0 − 10×0.3)=17、乱数幅の中間1.025倍 → round(17.425)=17
  const dmg = events.find((ev) => ev.type === "damage");
  assert.equal(dmg.dmg, 17);
  assert.equal(dmg.drained, 9); // round(17×0.5)
  assert.equal(c.hp, 59);
  assert.ok(events.some((ev) => ev.type === "enemyDown" && ev.enemy === e));
  assert.equal(e.alive, false);
  assert.equal(c.atb, 0);
});

test("敵の攻撃は被ダメ軽減を反映し、HPが0になった味方は戦闘不能になる", () => {
  const env = envWith();
  const tank = member("T", S, { passives: { dmgTakenMult: 0.5 } });
  tank.hp = 3;
  const e = enemy("ogre", 100, { atk: 30 });
  const events = [];
  battle.performEnemyAction(e, [tank], env, events);
  // round((30 − 10×0.4)×1.025)=27 → ×0.5 = round(13.5)=14
  assert.equal(events[0].dmg, 14);
  assert.equal(tank.alive, false);
  assert.ok(events.some((ev) => ev.type === "memberDown"));
});

test("stepはSPDに応じてATBを伸ばし、決着がつくと結果を返す", () => {
  const env = envWith();
  const c = member("A", { ...S, spd: 10 });
  const e = enemy("slime", 1, { spd: 0 });
  const b = { enemies: [e] };
  let r = battle.step(b, [c], 1, env); // 10×7×1 = 70
  assert.equal(r.result, null);
  assert.equal(Math.round(c.atb), 70);
  r = battle.step(b, [c], 1, env);
  assert.equal(r.result, "victory");
});

test("全員倒れると敗北", () => {
  const env = envWith();
  const c = member("A", { ...S, spd: 0 }, { hp: 1 });
  const e = enemy("ogre", 999, { atk: 50, spd: 100 });
  const r = battle.simulate({ enemies: [e] }, [c], env, { maxSeconds: 5 });
  assert.equal(r.result, "defeat");
});

test("実データ: 初期パーティLv1は「はじまりの草原」をほぼ確実に踏破し、Lv1で「竜骨の山頂」は踏破できない", () => {
  assert.ok(sim.clearRate("plains", 1, 100, 1).rate >= 0.9);
  assert.equal(sim.clearRate("peak", 1, 30, 2).rate, 0);
});

test("実データ: 同じシードなら同じ結果（戦闘の再現性）", () => {
  const a = sim.clearRate("forest", 3, 50, 77);
  const b = sim.clearRate("forest", 3, 50, 77);
  assert.deepEqual(a, b);
});

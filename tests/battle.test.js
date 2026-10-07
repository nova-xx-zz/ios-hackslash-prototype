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

const fire = { id: "fire", name: "炎紋弾", reqLevel: 1, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1 };
const bigFire = { id: "big", name: "爆紋陣", reqLevel: 15, mpCost: 16, kind: "magic", target: "all-enemy", power: 1.6, hits: 1 };
const heal = { id: "heal", name: "癒しの灯", reqLevel: 1, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1 };

test("技は優先度で絞り込み、その中で今の敵に対する期待効果が大きい技を選ぶ。MPが足りなければ使わない", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [fire, bigFire] });
  const three = () => [enemy("a", 100), enemy("b", 100), enemy("c", 100)];
  assert.equal(battle.chooseAction(c, [c], env, three()).id, "big"); // 敵が多いので全体技
  c.tiers = { fire: 3 };
  assert.equal(battle.chooseAction(c, [c], env, three()).id, "fire"); // 「優先」が勝つ
  c.tiers = {};
  c.mp = 10;
  assert.equal(battle.chooseAction(c, [c], env, three()).id, "fire"); // MP不足の技は候補外
  c.mp = 0;
  assert.equal(battle.chooseAction(c, [c], env, three()).id, "attack"); // 何も使えなければ通常攻撃
});

test("後から覚える技でも、今の敵に効きにくければ使わない（多段技は1回ごとに防御で減る）", () => {
  const env = envWith();
  const strong = { id: "crit", name: "剛断撃", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 2.1, hits: 1 };
  const multi = { id: "multi", name: "三連閃", reqLevel: 10, mpCost: 0, kind: "physical", target: "single", power: 0.55, hits: 3 };
  const c = member("A", { ...S, atk: 40 }, { abilities: [strong, multi] });
  assert.equal(battle.chooseAction(c, [c], env, [enemy("golem", 500, { def: 60 })]).id, "crit");
});

test("敵の残りHPを超える分は数えない（残り少ない敵1体なら全体技を使わず、MPの少ない技にする）", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [fire, bigFire] });
  assert.equal(battle.chooseAction(c, [c], env, [enemy("a", 5)]).id, "attack");
});

test("「温存」の技は、他に使える技が無い時だけ使う", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [fire], tiers: { fire: 1 } });
  assert.equal(battle.chooseAction(c, [c], env, [enemy("a", 100)]).id, "fire");
});

test("回復技は誰かのHPが8割未満の時だけ使う", () => {
  const env = envWith();
  const healer = member("H", S, { abilities: [heal] });
  const ally = member("B", S);
  const es = [enemy("a", 100)];
  assert.equal(battle.chooseAction(healer, [healer, ally], env, es).id, "attack");
  ally.hp = 70;
  assert.equal(battle.chooseAction(healer, [healer, ally], env, es).id, "heal");
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

// ---------- 敵の特性・属性・強化と弱体 ----------
const holyBolt = { id: "holy", name: "光の矢", reqLevel: 1, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1, element: "holy" };
const armorBreak = { id: "break", name: "鎧砕き", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.8, hits: 1, debuff: { stat: "def", mult: 0.5, duration: 12 } };
const warCry = { id: "cry", name: "鬨の声", reqLevel: 1, mpCost: 5, kind: "buff", target: "all-ally", power: 0, hits: 1, buff: { stat: "atk", mult: 1.3, duration: 15 } };
const sacred = { id: "sacred", name: "聖なる加護", reqLevel: 1, mpCost: 5, kind: "buff", target: "all-ally", power: 0, hits: 1, imbue: { element: "holy", duration: 15 } };

test("特性: 効かない攻撃は0ダメージ（immune）、弱点は1.5倍（weak）。聖属性はアンデッドに効く", () => {
  const env = envWith();
  const undead = () => enemy("骸骨", 500, { res: { nonHoly: 0, el: { holy: 1.5 } } });
  const c = member("A", S, { abilities: [] });
  const events = [];
  const b1 = { enemies: [undead()] };
  battle.performCharacterAction(c, [c], b1, env, events);
  const hit = events.find((e) => e.type === "damage");
  assert.equal(hit.dmg, 0);
  assert.equal(hit.immune, true);
  const p = member("B", S, { abilities: [holyBolt] });
  const ev2 = [];
  const b2 = { enemies: [undead()] };
  battle.performCharacterAction(p, [p], b2, env, ev2);
  const h2 = ev2.find((e) => e.type === "damage");
  assert.equal(h2.weak, true);
  assert.equal(h2.dmg, 47); // round(MAG20×1.5 × 乱数1.025)=31 × 弱点1.5 = 46.5 → 47
});

test("AI: 物理が効かない敵には魔法を、アンデッドには聖属性を選ぶ", () => {
  const env = envWith();
  const swordAndFire = member("A", S, { abilities: [fire] });
  const spirit = enemy("霊", 500, { res: { physical: 0 } });
  assert.equal(battle.chooseAction(swordAndFire, [swordAndFire], env, [spirit]).id, "fire");
  const undead = enemy("骸骨", 500, { res: { nonHoly: 0, el: { holy: 1.5 } } });
  const priest = member("P", S, { abilities: [fire, holyBolt] });
  assert.equal(battle.chooseAction(priest, [priest], env, [undead]).id, "holy");
});

test("弱体: 防御ダウンは当たった敵の防御を一定時間下げ、硬い敵には先に使う", () => {
  const env = envWith();
  const hard = () => enemy("甲羅", 2000, { def: 60 });
  const party = [member("A", S, { abilities: [armorBreak] }), member("B", S), member("C", S)];
  assert.equal(battle.chooseAction(party[0], party, env, [hard()]).id, "break");
  const b = { enemies: [hard()], time: 0 };
  const events = [];
  battle.performCharacterAction(party[0], party, b, env, events);
  assert.ok(events.some((e) => e.type === "status" && e.kind === "debuff" && e.stat === "def"));
  assert.equal(battle.fxMult(b, b.enemies[0], "def"), 0.5);
  // 掛かっている間は掛け直さない
  assert.equal(battle.chooseAction(party[0], party, env, b.enemies, b).id, "attack");
  b.time = 13; // 切れた
  assert.equal(battle.fxMult(b, b.enemies[0], "def"), 1);
});

test("強化: 攻撃力アップは味方全員のATKを上げ、聖属性付与は物理攻撃を聖属性にする", () => {
  const env = envWith();
  const party = [member("A", S, { abilities: [warCry] }), member("B", S), member("C", S)];
  const b = { enemies: [enemy("x", 3000)], time: 0 };
  const events = [];
  battle.performCharacterAction(party[0], party, b, env, events);
  assert.equal(events.filter((e) => e.type === "status" && e.kind === "buff").length, 3);
  assert.equal(battle.memberStats(party[1], env, b).atk, 26);
  // 聖属性付与: アンデッドに物理が通る
  const priest = member("P", S, { abilities: [sacred] });
  const fighter = member("F", S);
  const undead = enemy("骸骨", 3000, { res: { nonHoly: 0, el: { holy: 1.5 } } });
  const b2 = { enemies: [undead], time: 0 };
  assert.equal(battle.chooseAction(priest, [priest, fighter], env, b2.enemies, b2).id, "sacred");
  battle.performCharacterAction(priest, [priest, fighter], b2, env, []);
  const ev = [];
  battle.performCharacterAction(fighter, [priest, fighter], b2, env, ev);
  const hit = ev.find((e) => e.type === "damage");
  assert.equal(hit.element, "holy");
  assert.ok(hit.dmg > 0);
});

test("防御無視（pierce）は敵の防御の一部を無視する", () => {
  const env = envWith();
  const c = member("A", S, { passives: { pierce: 0.5 } });
  const b = { enemies: [enemy("甲羅", 500, { def: 40 })] };
  const events = [];
  battle.performCharacterAction(c, [c], b, env, events);
  // (20 − 40×0.5×0.3) × 1.025 = 14.35 → 14
  assert.equal(events.find((e) => e.type === "damage").dmg, 14);
});

test("実データ: 敵の特性はモードで強くなる（アンデッドへの聖属性以外: ノーマル0.6・ハード0.3・エクストラ0）", () => {
  const d = sim.data;
  const t = d.getEnemyTemplate("skeleton");
  assert.deepEqual(["normal", "hard", "extra"].map((m) => d.makeEnemy(t, 1, false, 1, false, m === "normal" ? undefined : m).res.nonHoly), [0.6, 0.3, 0]);
  const crab = d.getEnemyTemplate("mud_crab");
  assert.equal(d.makeEnemy(crab, 1, false, 1, false, "extra").def, crab.def * 4);
});

test("強化を「優先」にしていても、全員に掛かっている間は掛け直さない（他の技・通常攻撃を使う）", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [warCry], tiers: { cry: 3 } });
  const party = [c, member("B", S)];
  const b = { enemies: [enemy("x", 3000)], time: 0 };
  assert.equal(battle.chooseAction(c, party, env, b.enemies, b).id, "cry");
  battle.performCharacterAction(c, party, b, env, []);
  assert.equal(battle.chooseAction(c, party, env, b.enemies, b).id, "attack");
  b.time = 14; // 切れる直前は掛け直す
  assert.equal(battle.chooseAction(c, party, env, b.enemies, b).id, "cry");
});

test("1つの戦闘の中では、能力値とパッシブを1人1回だけ env から取り出す", () => {
  let calls = 0;
  const env = envWith({ stats: (c) => { calls += 1; return c.stats; } });
  const party = [member("A", S, { abilities: [armorBreak, warCry] }), member("B", S), member("C", S)];
  const b = { enemies: [enemy("x", 3000, { def: 30 }), enemy("y", 3000)], time: 0 };
  for (let i = 0; i < 50; i++) battle.step(b, party, 0.1, env);
  assert.ok(calls <= party.length, `env.stats が${calls}回呼ばれた`);
});

test("攻撃対象が「ランダム」の味方がいても、強化・弱体の見積もりができる", () => {
  const env = envWith();
  const c = member("A", S, { abilities: [warCry, armorBreak] });
  const party = [c, member("B", S, { targetPriority: "random" })];
  const b = { enemies: [enemy("x", 3000, { def: 40 }), enemy("y", 3000)], time: 0 };
  assert.doesNotThrow(() => battle.chooseAction(c, party, env, b.enemies, b));
});

// 実行: node --test（リポジトリ直下で）
// 所持品まわり（js/model/inventory.js）。装備の付け外し・おまかせ装備・装備強化（通常／確定強化石／天井）・
// ドロップの受け取り（自動分解）・モンスター合成を確認する
const test = require("node:test");
const assert = require("node:assert/strict");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup(opts) {
  opts = opts || {};
  const flags = Object.assign({ enhancePity: true, guaranteedStone: true }, opts.flags);
  const isFeatureEnabled = (k) => (k in flags ? flags[k] : data.isFeatureEnabled(k));
  const state = createState({ teamCount: 4 });
  const roster = createRoster({ data: Object.assign({}, data, { isFeatureEnabled }), state });
  const mirror = [];
  const inv = createInventory({
    data, state, roster, isFeatureEnabled,
    rng: opts.rng || createRng(1),
    onMaterialChange: (m) => mirror.push(m),
  });
  return { state, roster, inv, mirror };
}
const item = (slot, stat, value, rarity, plus, extra) => Object.assign({ id: `${slot}-${rarity}-${value}`, name: "x", slot, stat, value, rarity, plus: plus || 0, materialValue: 10 }, extra);
const alwaysFail = { chance: () => false, float: () => 0.99 };

test("装備: 付けると所持品から外れ、元の装備は所持品に戻る。外すと所持品に戻る", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const a = item("weapon", "atk", 3, "n"), b = item("weapon", "atk", 5, "r");
  state.inventory.push(a, b);
  inv.equipItem(c, a);
  assert.equal(c.equip.weapon, a);
  assert.deepEqual(state.inventory, [b]);
  inv.equipItem(c, b);
  assert.equal(c.equip.weapon, b);
  assert.deepEqual(state.inventory, [a]);
  inv.unequipSlot(c, "weapon");
  assert.equal(c.equip.weapon, null);
  assert.deepEqual(state.inventory, [a, b]);
});

test("装備: 外してHPの上限が下がったら、今のHPも上限まで下げる", () => {
  const { roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  inv.equipItem(c, item("armor", "hp", 30, "sr", 5));
  c.hp = roster.computeStats(c).maxHp;
  inv.unequipSlot(c, "armor");
  assert.equal(c.hp, roster.computeStats(c).maxHp);
});

test("おまかせ装備: 部位ごとにそのキャラにとって価値が高いものを付ける", () => {
  const { state, roster, inv } = setup();
  const warrior = roster.newCharacter("アレン", "warrior", "human");
  const atk = item("weapon", "atk", 5, "n"), mag = item("weapon", "mag", 5, "n"), acc = item("accessory", "spd", 2, "n");
  state.inventory.push(mag, atk, acc);
  inv.autoEquip(warrior);
  assert.equal(warrior.equip.weapon, atk); // せんしはATKを重視
  assert.equal(warrior.equip.accessory, acc);
  assert.equal(warrior.equip.armor, null); // 候補が無い部位はそのまま
  assert.deepEqual(state.inventory, [mag]);
});

test("強化: 成功で+1・強化石を消費・旧キーへミラー。石が足りない／上限なら何もしない", () => {
  const { state, inv, mirror } = setup({ rng: { chance: () => true } });
  const it = item("weapon", "atk", 5, "n");
  state.material = inv.enhanceCost(it) - 1;
  assert.equal(inv.canEnhance(it), false);
  assert.equal(inv.enhanceItem(it), null);
  state.material = 1000;
  const cost = inv.enhanceCost(it);
  const r = inv.enhanceItem(it);
  assert.deepEqual(r, { success: true, plus: 1, pityHit: false, cost });
  assert.equal(it.plus, 1);
  assert.equal(state.material, 1000 - cost);
  assert.deepEqual(mirror, [1000 - cost]);
  const maxed = item("weapon", "atk", 5, "n", data.ENHANCE_MAX_PLUS);
  assert.equal(inv.enhanceItem(maxed), null);
});

test("強化の天井: 失敗で消費した強化石が貯まり、しきい値に達すると次は必ず成功", () => {
  const { state, inv } = setup({ rng: alwaysFail });
  const it = item("weapon", "atk", 12, "lr", 98);
  state.material = 1e9;
  const r = inv.enhanceItem(it);
  assert.equal(r.success, false);
  assert.equal(it.plus, 98);
  assert.equal(it.pity, r.cost);
  assert.equal(inv.isPityReady(it), false);
  it.pity = 1e9;
  assert.equal(inv.isPityReady(it), true);
  const hit = inv.enhanceItem(it);
  assert.deepEqual([hit.success, hit.pityHit, it.plus, it.pity], [true, true, 99, 0]);
});

test("強化の天井: 機能フラグがOFFならゲージは貯まらない", () => {
  const { state, inv } = setup({ rng: alwaysFail, flags: { enhancePity: false } });
  const it = item("weapon", "atk", 12, "lr", 98);
  state.material = 1e9;
  inv.enhanceItem(it);
  assert.equal(it.pity || 0, 0);
});

test("確定強化石: 無償分から消費して必ず+1。足りない／機能OFFなら何もしない", () => {
  const { state, inv } = setup();
  const it = item("weapon", "atk", 12, "lr", 98, { pity: 500 });
  const required = data.guaranteedStonesRequired(it);
  state.guaranteedStones = { free: 3, paid: required };
  state.material = 777;
  const r = inv.enhanceWithGuaranteed(it);
  assert.deepEqual(r, { plus: 99, required });
  assert.equal(it.pity, 0);
  assert.deepEqual(state.guaranteedStones, { free: 0, paid: 3 });
  assert.equal(state.material, 777); // 通常の強化石は使わない
  assert.equal(inv.guaranteedStoneTotal(), 3);

  const short = item("weapon", "atk", 12, "lr", 50);
  state.guaranteedStones = { free: 0, paid: 0 };
  assert.equal(inv.enhanceWithGuaranteed(short), null);

  const off = setup({ flags: { guaranteedStone: false } });
  off.state.guaranteedStones = { free: 999, paid: 0 };
  assert.equal(off.inv.enhanceWithGuaranteed(item("weapon", "atk", 5, "n")), null);
});

test("ドロップの受け取り: 自動分解の対象は強化石に、それ以外は所持品に入る", () => {
  const { state, inv } = setup();
  const n = item("weapon", "atk", 3, "n", 0, { materialValue: 5 }), r = item("armor", "def", 4, "r", 0, { materialValue: 20 });
  const settled = inv.receiveDrops([n, r], { enabled: true, rarities: new Set(["n"]) });
  assert.deepEqual(state.inventory, [r]);
  assert.equal(state.material, 5);
  assert.deepEqual([settled.disassembled, settled.materialGained, settled.kept.length], [1, 5, 1]);
  inv.receiveDrops([n], { enabled: false, rarities: new Set(["n"]) });
  assert.equal(state.inventory.length, 2);
});

test("モンスター合成: 控えのモンスターだけが素材。積み上げたEXPの半分を還元し、装備は所持品に戻る", () => {
  const { state, roster, inv } = setup();
  const target = roster.newCharacter("ターゲット", null, "slime", { isMonster: true });
  const mat1 = roster.newCharacter("ソザイ1", null, "slime", { isMonster: true, level: 3 });
  const mat2 = roster.newCharacter("ソザイ2", null, "bat", { isMonster: true, level: 2 });
  const inTeam = roster.newCharacter("編成中", null, "slime", { isMonster: true, team: 0 });
  const human = roster.newCharacter("アレン", "warrior", "human");
  state.roster = [target, mat1, mat2, inTeam, human];
  assert.deepEqual(inv.fusionCandidates(target).map((m) => m.name), ["ソザイ1", "ソザイ2"]);

  const gear = item("weapon", "atk", 3, "n");
  mat1.equip.weapon = gear;
  const expected = Math.round(roster.totalExpInvested(mat1) * 0.5) + Math.round(roster.totalExpInvested(mat2) * 0.5);
  assert.equal(inv.fusionExpGain([mat1, mat2]), expected);
  const r = inv.fuse(target, [mat1, mat2]);
  assert.equal(r.expGain, expected);
  assert.deepEqual(r.consumedNames, ["ソザイ1", "ソザイ2"]);
  assert.equal(r.returnedItems, 1);
  assert.deepEqual(state.roster.map((c) => c.name), ["ターゲット", "編成中", "アレン"]);
  assert.deepEqual(state.inventory, [gear]);
  assert.equal(roster.totalExpInvested(target), expected);
  assert.ok(r.levelUps.length > 0);
});

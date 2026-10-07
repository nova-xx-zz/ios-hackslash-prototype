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
// テスト用の装備。baseKey は data.js の ITEM_BASES の key（例: "bronze_sword"）、stats は実際の能力値
let itemSeq = 0;
const gear = (baseKey, stats, rarity, plus, extra) => {
  const b = data.getItemBase(baseKey);
  return Object.assign({ id: `${baseKey}-${itemSeq++}`, name: b.name, base: b.key, slot: b.slot, type: b.type, series: b.series, hands: b.hands,
    stats, rarity: rarity || "n", plus: plus || 0, materialValue: 10 }, extra);
};
// 能力値1つだけの簡単な装備（強化・分解のテスト用）
const item = (slot, stat, value, rarity, plus, extra) => {
  const baseKey = { weapon: "bronze_sword", shield: "bronze_buckler", head: "bronze_helm", body: "bronze_plate", accessory: "bronze_amulet" }[slot];
  return gear(baseKey, { [stat]: value }, rarity, plus, extra);
};
const alwaysFail = { chance: () => false, float: () => 0.99 };

test("装備: 付けると所持品から外れ、元の装備は所持品に戻る。外すと所持品に戻る", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const a = item("weapon", "atk", 3, "n"), b = item("weapon", "atk", 5, "r");
  state.inventory.push(a, b);
  assert.equal(inv.equipItem(c, a), true);
  assert.equal(c.equip.main, a);
  assert.deepEqual(state.inventory, [b]);
  inv.equipItem(c, b, "main");
  assert.equal(c.equip.main, b);
  assert.deepEqual(state.inventory, [a]);
  inv.unequipSlot(c, "main");
  assert.equal(c.equip.main, null);
  assert.deepEqual(state.inventory, [a, b]);
});

test("装備: 外してHPの上限が下がったら、今のHPも上限まで下げる", () => {
  const { roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  inv.equipItem(c, item("body", "hp", 30, "sr", 5));
  c.hp = roster.computeStats(c).maxHp;
  inv.unequipSlot(c, "body");
  assert.equal(c.hp, roster.computeStats(c).maxHp);
});

test("装備の制限: ジョブが持てない種類は付けられない。装飾品はだれでも付けられる", () => {
  const { state, roster, inv } = setup();
  const mage = roster.newCharacter("ミナ", "mage", "human");
  const sword = gear("bronze_sword", { atk: 3 }), plate = gear("bronze_plate", { def: 3, hp: 4 });
  const ring = gear("bronze_ring", { mag: 2 }), staff = gear("bronze_staff", { mag: 3 });
  state.inventory.push(sword, plate, ring, staff);
  assert.equal(inv.equipItem(mage, sword), false); // まほうつかいは剣を持てない
  assert.equal(inv.equipItem(mage, plate), false); // よろいも着られない
  assert.equal(inv.equipItem(mage, staff), true);
  assert.equal(inv.equipItem(mage, ring), true);
  assert.equal(mage.equip.main, staff);
  assert.equal(mage.equip.acc1, ring);
  assert.equal(inv.equipItem(mage, sword, "off"), false);
});

test("両手武器: 右手に持つと左手の装備を外す。持っている間は左手に何も付けられない", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const sword = gear("bronze_sword", { atk: 3 }), buckler = gear("bronze_buckler", { def: 2 }), great = gear("bronze_greatsword", { atk: 6 });
  state.inventory.push(sword, buckler, great);
  inv.equipItem(c, sword);
  inv.equipItem(c, buckler);
  assert.equal(c.equip.off, buckler);
  inv.equipItem(c, great, "main");
  assert.equal(c.equip.main, great);
  assert.equal(c.equip.off, null);
  assert.deepEqual(state.inventory.slice().sort((a, b) => a.id.localeCompare(b.id)), [buckler, sword].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(inv.equipItem(c, buckler, "off"), false);
});

test("二刀流: 二刀流のジョブだけ左手に片手武器を持てる", () => {
  const { state, roster, inv } = setup();
  const thief = roster.newCharacter("ノア", "thief", "human");
  const warrior = roster.newCharacter("アレン", "warrior", "human");
  const d1 = gear("bronze_dagger", { atk: 2, spd: 2 }), d2 = gear("bronze_dagger", { atk: 2, spd: 2 });
  const s1 = gear("bronze_sword", { atk: 3 }), s2 = gear("bronze_sword", { atk: 3 });
  state.inventory.push(d1, d2, s1, s2);
  inv.equipItem(thief, d1);
  assert.equal(inv.equipItem(thief, d2), true);
  assert.equal(thief.equip.off, d2);
  inv.equipItem(warrior, s1);
  assert.equal(inv.equipItem(warrior, s2, "off"), false); // せんしは二刀流できない
});

test("装飾品の枠: 最初は1枠。固有ツリーの「装備の心得」「装備の極意」で3枠まで増える", () => {
  const { roster } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human", { level: 30 });
  assert.equal(roster.accessorySlots(c), 1);
  const tree = roster.getExclusiveTree(c);
  const ranks = roster.getTreeState(c).exclusiveRanks;
  const node = (id) => tree.nodes.find((n) => n.id === id);
  for (const id of ["w1", "w2", "w_acc1"]) assert.ok(roster.acquireNode(c, tree, ranks, node(id)), id);
  assert.equal(roster.accessorySlots(c), 2);
  for (const id of ["w3", "w_acc2"]) assert.ok(roster.acquireNode(c, tree, ranks, node(id)), id);
  assert.equal(roster.accessorySlots(c), 3);
});

test("装飾品の枠: モンスターはLvで増える", () => {
  const { roster } = setup();
  const m = roster.newCharacter("スラ", null, "slime", { isMonster: true, level: 1 });
  assert.equal(roster.accessorySlots(m), 1);
  m.level = data.MONSTER_ACCESSORY_SLOT_LEVELS[0];
  assert.equal(roster.accessorySlots(m), 2);
  m.level = data.MONSTER_ACCESSORY_SLOT_LEVELS[1];
  assert.equal(roster.accessorySlots(m), 3);
});

test("転職: 新しいジョブで持てない装備・使えない装飾品の枠の装備は所持品に戻す", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human", { level: 30 });
  const tree = roster.getExclusiveTree(c);
  const ranks = roster.getTreeState(c).exclusiveRanks;
  for (const id of ["w1", "w2", "w_acc1"]) roster.acquireNode(c, tree, ranks, tree.nodes.find((n) => n.id === id));
  const sword = gear("bronze_sword", { atk: 3 }), a1 = gear("bronze_ring", { mag: 2 }), a2 = gear("bronze_amulet", { hp: 6 });
  state.inventory.push(sword, a1, a2);
  inv.equipItem(c, sword);
  inv.equipItem(c, a1);
  inv.equipItem(c, a2);
  assert.equal(c.equip.acc2, a2);
  roster.switchJob(c, "mage"); // まほうつかいは Lv1・ツリーなし → 剣は持てず、装飾品は1枠
  assert.equal(inv.normalizeCharEquip(c), 2);
  assert.equal(c.equip.main, null);
  assert.equal(c.equip.acc1, a1);
  assert.equal(c.equip.acc2, null);
  assert.ok(state.inventory.includes(sword) && state.inventory.includes(a2));
});

test("セット効果: 同じシリーズを2・4・6個付けると能力値の割合ボーナス・パッシブが付く", () => {
  const { roster } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const before = roster.computeStats(c);
  c.equip.head = gear("iron_helm", { def: 1, hp: 1 });
  c.equip.body = gear("iron_plate", { def: 1, hp: 1 });
  const two = roster.setBonuses(c);
  assert.equal(two.stats.def, 0.05);
  assert.equal(roster.computeStats(c).def, Math.round((before.def + 2) * 1.05));
  c.equip.main = gear("iron_sword", { atk: 1 });
  c.equip.off = gear("iron_shield", { def: 1 });
  c.equip.acc1 = gear("iron_brooch", { def: 1 });
  c.equip.acc2 = gear("iron_amulet", { hp: 1 });
  const six = roster.setBonuses(c);
  assert.equal(six.stats.hp, 0.06);
  assert.equal(six.passives.dmgTakenMult, 0.95);
  assert.equal(roster.gearPassive(c, "dmgTakenMult"), 0.95);
  assert.deepEqual(six.active[0].bonuses.map((b) => b.active), [true, true, true]);
});

test("おまかせ装備: 今の装備と所持品から、そのキャラにとって価値が高い組み合わせを付ける", () => {
  const { state, roster, inv } = setup();
  const warrior = roster.newCharacter("アレン", "warrior", "human");
  const atk = item("weapon", "atk", 5, "n"), staff = gear("bronze_staff", { mag: 9 }), acc = item("accessory", "spd", 2, "n");
  state.inventory.push(staff, atk, acc);
  inv.autoEquip(warrior);
  assert.equal(warrior.equip.main, atk); // せんしは杖を持てない
  assert.equal(warrior.equip.acc1, acc);
  assert.equal(warrior.equip.body, null); // 候補が無い枠はそのまま
  assert.deepEqual(state.inventory, [staff]);
});

test("おまかせ装備: 両手武器と「片手武器＋盾」は合計で比べる", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const sword = gear("bronze_sword", { atk: 3 }), shield = gear("bronze_shield", { def: 3, hp: 4 }), great = gear("bronze_greatsword", { atk: 4 });
  state.inventory.push(sword, shield, great);
  inv.autoEquip(c);
  assert.equal(c.equip.main, sword);
  assert.equal(c.equip.off, shield);
  const huge = gear("bronze_greatsword", { atk: 30 });
  state.inventory.push(huge);
  inv.autoEquip(c);
  assert.equal(c.equip.main, huge);
  assert.equal(c.equip.off, null);
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
  const n = item("weapon", "atk", 3, "n", 0, { materialValue: 5 }), r = item("body", "def", 4, "r", 0, { materialValue: 20 });
  const settled = inv.receiveDrops([n, r], { enabled: true, rarities: new Set(["n"]) });
  assert.deepEqual(state.inventory, [r]);
  assert.equal(state.material, 5);
  assert.deepEqual([settled.disassembled, settled.materialGained, settled.kept.length], [1, 5, 1]);
  inv.receiveDrops([n], { enabled: false, rarities: new Set(["n"]) });
  assert.equal(state.inventory.length, 2);
});

test("手動の分解: 選んだ所持品だけを強化石に変える。値が無い古いアイテムはレア度の既定値、所持品に無いものは無視", () => {
  const { state, inv, mirror } = setup();
  const a = item("weapon", "atk", 3, "n", 0, { materialValue: 5 });
  const b = item("body", "def", 4, "sr", 7, { materialValue: 80 });
  const c = item("accessory", "spd", 2, "r", 0, { materialValue: undefined });
  const keep = item("weapon", "atk", 9, "ur", 0, { materialValue: 350 });
  const notOwned = item("weapon", "atk", 1, "lr", 0, { materialValue: 1500 });
  state.inventory.push(a, b, c, keep);
  state.material = 100;
  const r = inv.disassembleItems([a, b, c, notOwned]);
  assert.deepEqual(r, { count: 3, materialGained: 5 + 80 + 20 });
  assert.deepEqual(state.inventory, [keep]);
  assert.equal(state.material, 205);
  assert.equal(mirror.at(-1), 205);
  assert.deepEqual(inv.disassembleItems([]), { count: 0, materialGained: 0 });
  assert.equal(state.material, 205);
});

test("ロック: ロックした装備は分解しない。外せばまた分解できる", () => {
  const { state, inv } = setup();
  const a = item("weapon", "atk", 1, "ur", 0, { materialValue: 350 });
  state.inventory.push(a);
  state.material = 0;
  inv.setLocked(a, true);
  assert.equal(a.locked, true);
  assert.deepEqual(inv.disassembleItems([a]), { count: 0, materialGained: 0 });
  assert.deepEqual(state.inventory, [a]);
  inv.setLocked(a, false);
  assert.equal("locked" in a, false); // 外したらセーブに残さない
  assert.deepEqual(inv.disassembleItems([a]), { count: 1, materialGained: 350 });
});

test("モンスター合成: 控えのモンスターだけが素材。基本EXP＋積み上げたEXPの半分（同族1.5倍）を還元し、装備は所持品に戻る", () => {
  const { state, roster, inv } = setup();
  const target = roster.newCharacter("ターゲット", null, "slime", { isMonster: true });
  const mat1 = roster.newCharacter("ソザイ1", null, "slime", { isMonster: true, level: 3 });
  const mat2 = roster.newCharacter("ソザイ2", null, "bat", { isMonster: true, level: 2 });
  const inTeam = roster.newCharacter("編成中", null, "slime", { isMonster: true, team: 0 });
  const human = roster.newCharacter("アレン", "warrior", "human");
  state.roster = [target, mat1, mat2, inTeam, human];
  assert.deepEqual(inv.fusionCandidates(target).map((m) => m.name), ["ソザイ1", "ソザイ2"]);

  const gearItem = item("weapon", "atk", 3, "n");
  mat1.equip.main = gearItem;
  // 種族の基本EXP＋積み上げたEXPの半分。合成先と同じ種族（slime）は1.5倍
  const expected = Math.round((data.fusionBaseExp("slime") + roster.totalExpInvested(mat1) * 0.5) * 1.5) +
    Math.round(data.fusionBaseExp("bat") + roster.totalExpInvested(mat2) * 0.5);
  assert.equal(inv.fusionExpGain(target, [mat1, mat2]), expected);
  const r = inv.fuse(target, [mat1, mat2]);
  assert.equal(r.expGain, expected);
  assert.deepEqual(r.consumedNames, ["ソザイ1", "ソザイ2"]);
  assert.equal(r.returnedItems, 1);
  assert.deepEqual(state.roster.map((c) => c.name), ["ターゲット", "編成中", "アレン"]);
  assert.deepEqual(state.inventory, [gearItem]);
  assert.equal(roster.totalExpInvested(target), expected);
  assert.ok(r.levelUps.length > 0);
});

test("モンスター合成: テイム直後のLv1の素材でもEXPが入り、先の地方の種族ほど多い", () => {
  const { roster, inv } = setup();
  const target = roster.newCharacter("ターゲット", null, "wolf", { isMonster: true });
  const slime = roster.newCharacter("スライム", null, "slime", { isMonster: true });
  const yeti = roster.newCharacter("イエティ", null, "yeti", { isMonster: true });
  assert.equal(roster.totalExpInvested(slime), 0);
  assert.equal(inv.materialExp(target, slime), data.expForLevel(1));
  assert.equal(data.tameHomeLevel("yeti") > data.tameHomeLevel("slime"), true);
  assert.equal(inv.materialExp(target, yeti) > inv.materialExp(target, slime), true);
  const sameRace = roster.newCharacter("ウルフ", null, "wolf", { isMonster: true });
  assert.equal(inv.materialExp(target, sameRace), Math.round(data.fusionBaseExp("wolf") * 1.5));
});

test("モンスター合成の基本EXP: テイムできる種族はすべてどこかのダンジョンに出てくる", () => {
  for (const key of Object.keys(data.MONSTER_JOBS)) {
    assert.ok(data.DUNGEONS.some((d) => d.pool.includes(key) || d.boss === key || (d.rares || []).includes(key)), key);
    assert.ok(data.fusionBaseExp(key) >= data.expForLevel(1), key);
  }
});

test("仲間と別れる: 控えでお気に入りでない仲間だけ。装備は所持品に戻り、最低1人は残す", () => {
  const { state, roster, inv } = setup();
  const leader = roster.newCharacter("アレン", "warrior", "human", { team: 0 });
  const bench = roster.newCharacter("ミナ", "mage", "human");
  const fav = roster.newCharacter("スライム", null, "slime", { isMonster: true });
  fav.favorite = true;
  const mon = roster.newCharacter("ゴブリン", null, "goblin", { isMonster: true });
  state.roster = [leader, bench, fav, mon];
  assert.deepEqual(inv.releaseCandidates().map((c) => c.name), ["ミナ", "ゴブリン"]);

  const it = item("accessory", "hp", 6, "r");
  bench.equip.acc1 = it;
  // パーティにいる仲間・お気に入りは選んでも外れない
  const r = inv.releaseMembers([bench, leader, fav]);
  assert.deepEqual({ ok: r.ok, names: r.names, returnedItems: r.returnedItems }, { ok: true, names: ["ミナ"], returnedItems: 1 });
  assert.deepEqual(state.roster.map((c) => c.name), ["アレン", "スライム", "ゴブリン"]);
  assert.deepEqual(state.inventory, [it]);
  assert.equal(inv.releaseMembers([leader]).reason, "none");

  // 全員と別れることはできない
  state.roster = [mon];
  assert.equal(inv.releaseMembers([mon]).reason, "lastMember");
  assert.equal(state.roster.length, 1);
});

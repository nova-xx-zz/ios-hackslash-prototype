"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const save = require("../js/model/save.js");
const InventoryOrganize = require("../js/core/inventory-organize.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup() {
  const state = save.createState({ teamCount: 4 });
  const roster = createRoster({ data, state });
  const inv = createInventory({ data, state, roster, rng: createRng(1), isTeamLocked: () => false });
  return { state, roster, inv };
}
function item(baseKey, id, extra = {}) {
  const b = data.getItemBase(baseKey);
  return Object.assign({ id, name: b.name, base: b.key, slot: b.slot, type: b.type,
    hands: b.hands, series: b.series, rarity: "n", plus: 0, stats: { atk: 5 } }, extra);
}

test("自動周回: 前回のダンジョンはチーム別に保持し、通常/ハードの難易度も復元", () => {
  const state = save.createState({ teamCount: 4 });
  state.roster = [{ id: "c1", name: "アレン", level: 1, exp: 0, team: 0, equip: {} }];
  state.lastDungeons[0] = { id: "forest", mode: "hard" };
  state.lastDungeons[3] = { id: "plains", mode: "normal" };
  const loaded = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, { now: 1000 }))), {});
  assert.deepEqual(loaded.state.lastDungeons, [
    { id: "forest", mode: "hard" }, null, null, { id: "plains", mode: "normal" },
  ]);
  assert.equal(loaded.state.equipmentSets && Object.keys(loaded.state.equipmentSets).length, 0);
});

test("旧セーブ: 自動周回の最後の行き先を任意復元、未登録でも初期化", () => {
  const roster = [{ id: "c1", name: "アレン", level: 1, exp: 0, equip: {} }];
  const old = { schemaVersion: save.SCHEMA_VERSION, roster,
    autoRepeat: [{ active: false, target: 5, done: 0, dungeonId: "cave", mode: "extra" }] };
  const state = save.deserialize(old, { teamCount: 4 }).state;
  assert.deepEqual(state.lastDungeons[0], { id: "cave", mode: "extra" });
  assert.equal(state.lastDungeons[1], null);
  assert.deepEqual(state.equipmentSets, {});
});

test("分解: 拡張対象には貴重・呪い・URを含めるがロック品は絶対に含めない", () => {
  const items = [
    { id: "plain", rarity: "n", plus: 0 },
    { id: "rare", rarity: "ur" },
    { id: "curse", rarity: "r", cursed: true },
    { id: "unique", rarity: "lr", unique: true },
    { id: "enhanced", rarity: "sr", plus: 3 },
    { id: "locked", rarity: "r", locked: true },
  ];
  assert.deepEqual(items.filter((i) => InventoryOrganize.isBulkSelectable(i, false)).map((i) => i.id), ["plain"]);
  assert.deepEqual(items.filter((i) => InventoryOrganize.isBulkSelectable(i, true)).map((i) => i.id),
    ["plain", "rare", "curse", "unique", "enhanced"]);
  assert.deepEqual(items.filter((i) => InventoryOrganize.isBulkSelectable(i, true, false)).map((i) => i.id),
    ["plain", "rare", "unique", "enhanced"]);
  assert.deepEqual(items.filter((i) => InventoryOrganize.isBulkSelectable(i, false, true)).map((i) => i.id),
    ["plain", "curse"]);
});

test("装備マイセット: 3枠保存、実物IDで一括復元、既存装備は所持品へ戻る", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  state.roster.push(c);
  const sword = item("bronze_sword", "set-sword");
  const shield = item("bronze_buckler", "set-shield");
  const head = item("bronze_helm", "set-head");
  const another = item("bronze_sword", "other-sword");
  state.inventory.push(sword, shield, head, another);
  assert.equal(inv.equipItem(c, sword, "main"), true);
  assert.equal(inv.equipItem(c, shield, "off"), true);
  assert.equal(inv.equipItem(c, head, "head"), true);
  assert.equal(inv.saveEquipmentSet(c, 0).ok, true);
  assert.equal(inv.savedSet(c, 0).slots.main, sword.id);
  assert.equal(inv.savedSet(c, 0).slots.off, shield.id);
  assert.equal(inv.savedSet(c, 2), null);
  assert.equal(inv.equipItem(c, another, "main"), true);
  const oldInventory = state.inventory.slice();
  assert.equal(inv.applyEquipmentSet(c, 0).ok, true);
  assert.equal(c.equip.main, sword);
  assert.equal(c.equip.off, shield);
  assert.equal(c.equip.head, head);
  assert.ok(state.inventory.includes(another));
  assert.equal(state.inventory.length, oldInventory.length);
  assert.equal(new Set(state.inventory).size, state.inventory.length);
  const restored = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, { now: 2000 }))), {}).state;
  assert.equal(restored.equipmentSets[c.id][0].slots.main, sword.id);
});

test("マイセット: 装備が別キャラの手元なら失敗し、所持品・装備を変えない", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  const other = roster.newCharacter("ノア", "warrior", "human");
  state.roster.push(c, other);
  const sword = item("bronze_sword", "owned-sword");
  state.inventory.push(sword);
  inv.equipItem(c, sword, "main");
  inv.saveEquipmentSet(c, 0);
  inv.unequipSlot(c, "main");
  inv.equipItem(other, sword, "main");
  const before = state.inventory.slice();
  const result = inv.applyEquipmentSet(c, 0);
  assert.deepEqual(result, { ok: false, reason: "taken" });
  assert.deepEqual(state.inventory, before);
  assert.equal(c.equip.main, null);
  assert.equal(other.equip.main, sword);
});

test("マイセット: 旧ジョブの装備制約・盗難ID/重複IDを弾いて原子的に不変更", () => {
  const { state, roster, inv } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  state.roster.push(c);
  const sword = item("bronze_sword", "dup-sword");
  state.inventory.push(sword);
  inv.equipItem(c, sword, "main");
  inv.saveEquipmentSet(c, 0);
  inv.unequipSlot(c, "main");
  roster.switchJob(c, "mage");
  const before = state.inventory.slice();
  assert.deepEqual(inv.applyEquipmentSet(c, 0), { ok: false, reason: "job" });
  assert.deepEqual(state.inventory, before);
  const duplicate = item("bronze_sword", "dup-sword");
  state.inventory.push(duplicate);
  assert.deepEqual(inv.applyEquipmentSet(c, 0), { ok: false, reason: "duplicate" });
  assert.equal(c.equip.main, null);
});

test("保存データ: マイセットから未知枠・余分なセット・不正なIDを除外", () => {
  const src = { schemaVersion: save.SCHEMA_VERSION,
    roster: [{ id: "c1", name: "アレン", level: 1, exp: 0, equip: {} }],
    equipmentSets: { c1: [{ slots: { main: "sword1", injected: "x" } },
      { slots: { head: 3 } }, { slots: { body: "body1" } }, { slots: { main: "overflow" } }],
      unknown: [{ slots: { main: "x" } }] } };
  const loaded = save.deserialize(src, {}).state.equipmentSets;
  assert.equal(loaded.c1.length, 3);
  assert.equal(loaded.c1[0].slots.main, "sword1");
  assert.equal(loaded.c1[0].slots.injected, undefined);
  assert.equal(loaded.c1[1].slots.head, null);
  assert.equal(loaded.c1[2].slots.body, "body1");
  assert.equal(loaded.unknown, undefined);
});


test("旧連番ID衝突: 別々の仲間が同じIDの装備を着けても両マイセットを復旧", () => {
  const { state, roster } = setup();
  const a = roster.newCharacter("アレン", "warrior", "human");
  const b = roster.newCharacter("ノア", "warrior", "human");
  state.roster.push(a, b);
  a.equip.main = item("bronze_sword", "item_1", { plus: 10 });
  b.equip.main = item("bronze_sword", "item_1", { plus: 25 });
  state.equipmentSets[a.id] = [{ slots: { main: "item_1" } }];
  state.equipmentSets[b.id] = [{ slots: { main: "item_1" } }];
  const migrated = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, {}))), {}).state;
  const ma = migrated.roster.find((c) => c.id === a.id);
  const mb = migrated.roster.find((c) => c.id === b.id);
  assert.notEqual(ma.equip.main.id, mb.equip.main.id);
  assert.equal(migrated.equipmentSets[a.id][0].slots.main, ma.equip.main.id);
  assert.equal(migrated.equipmentSets[b.id][0].slots.main, mb.equip.main.id);
  const inventory = createInventory({ data, state: migrated, roster: createRoster({ data, state: migrated }),
    rng: createRng(1), isTeamLocked: () => false });
  assert.deepEqual(inventory.applyEquipmentSet(ma, 0), { ok: true });
  assert.deepEqual(inventory.applyEquipmentSet(mb, 0), { ok: true });
  assert.equal(ma.equip.main.plus, 10);
  assert.equal(mb.equip.main.plus, 25);
  const again = save.deserialize(JSON.parse(JSON.stringify(save.serialize({ ...migrated, autoRepeat: [] }, {}))), {}).state;
  assert.equal(again.equipmentSets[b.id][0].slots.main, again.roster.find((c) => c.id === b.id).equip.main.id);
});

test("旧連番ID衝突: 装備中と所持品のIDが重複しても保存時の実物を復元", () => {
  const { state, roster } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  state.roster.push(c);
  c.equip.main = item("bronze_sword", "item_1", { plus: 9 });
  state.inventory.push(item("bronze_sword", "item_1", { plus: 20 }));
  state.equipmentSets[c.id] = [{ slots: { main: "item_1" } }];
  const loaded = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, {}))), {}).state;
  const owner = loaded.roster[0];
  const presetId = loaded.equipmentSets[c.id][0].slots.main;
  assert.equal(presetId, owner.equip.main.id);
  assert.notEqual(presetId, loaded.inventory[0].id);
  const inv = createInventory({ data, state: loaded, roster: createRoster({ data, state: loaded }),
    rng: createRng(1), isTeamLocked: () => false });
  inv.unequipSlot(owner, "main");
  assert.deepEqual(inv.applyEquipmentSet(owner, 0), { ok: true });
  assert.equal(owner.equip.main.plus, 9);
  assert.equal(loaded.inventory[0].plus, 20);
});

test("旧連番ID衝突: 保存時の装備を特定できなければ誤装備せず再登録を案内", () => {
  const { state, roster } = setup();
  const c = roster.newCharacter("アレン", "warrior", "human");
  state.roster.push(c);
  state.inventory.push(item("bronze_sword", "item_1", { plus: 9 }),
    item("bronze_sword", "item_1", { plus: 20 }));
  state.equipmentSets[c.id] = [{ slots: { main: "item_1" } }];
  const loaded = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, {}))), {}).state;
  const inv = createInventory({ data, state: loaded, roster: createRoster({ data, state: loaded }),
    rng: createRng(1), isTeamLocked: () => false });
  assert.equal(new Set(loaded.inventory.map((gear) => gear.id)).size, 2);
  assert.equal(inv.applyEquipmentSet(loaded.roster[0], 0).reason, "ambiguous");
  assert.equal(loaded.roster[0].equip.main, null);
  assert.equal(loaded.inventory.length, 2);
  const again = save.deserialize(JSON.parse(JSON.stringify(save.serialize({ ...loaded, autoRepeat: [] }, {}))), {}).state;
  assert.equal(again.equipmentSets[c.id][0].slots.main, loaded.equipmentSets[c.id][0].slots.main);
});

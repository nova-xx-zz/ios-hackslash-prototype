"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/ui/inventory.js"), "utf8");
const begin = source.indexOf("let openSlot = null;");
const end = source.indexOf("// ---------- 装備強化 ----------", begin);
assert.ok(begin >= 0 && end > begin);
const implementation = source.slice(begin, end);

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.disabled = false;
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  set innerHTML(content) {
    // 本体の装備スロットで使う固定のspan要素。入力HTMLは扱わない。
    assert.match(content, /slot-name/);
    this.children = ["slot-name", "slot-item", "slot-stats"].map((name) => {
      const span = new Element("span");
      span.className = name;
      return span;
    });
  }
  querySelector(selector) {
    return this.children.find((node) => node.className.split(" ").includes(selector.slice(1))) || null;
  }
}

function find(node, predicate) {
  const results = [];
  const visit = (item) => {
    if (predicate(item)) results.push(item);
    for (const c of item.children) visit(c);
  };
  visit(node);
  return results;
}

function setup() {
  const sword = { id: "s1", name: "ミスリルソード", plus: 7, rarity: "sr", hands: 1, slot: "weapon", stats: {} };
  const candidate = { id: "s2", name: "ドラゴンソード", plus: 3, rarity: "ur", hands: 1, slot: "weapon", stats: {} };
  const char = { id: "hero", team: null, equip: { main: sword, head: null }, isMonster: false };
  const state = { inventory: [candidate], purchases: { presetPacks: 0 } };
  const sets = [{ slots: { main: "s1" }, name: "ボス用", preview: { main: { name: "ミスリルソード", rarity: "sr", plus: 7 } } }, null, null];
  let drawCalls = 0, saved = 0, loadCalls = 0, openedShop = null;
  const context = vm.createContext({
    document: { createElement: (tag) => new Element(tag) }, S: state,
    Shop: { presetCapacity: () => 5 + (state.purchases.presetPacks || 0) * 5 },
    isFeatureEnabled: () => true,
    openShop: (screen, product) => { openedShop = { screen, product }; },
    EQUIP_POSITIONS: [{ key: "main", name: "右手" }, { key: "head", name: "頭" }],
    QPCore: { equipment: { ACC_POSITIONS: [] } },
    equipProfile: () => ({ weapons: ["sword"], shields: [], head: [], body: [] }),
    getItemType: (key) => ({ name: key }), accessorySlots: () => 0, MONSTER_ACCESSORY_SLOT_LEVELS: [],
    rarityColor: () => "green", itemMark: () => "", itemStatsText: () => "ATK+10",
    itemEffectText: () => "", itemOptionsText: () => "",
    setBonuses: () => ({ active: [], uniques: [] }),
    savedSet: (_, index) => sets[index], saveEquipmentSet: () => ({ ok: true }),
    applyEquipmentSet: () => { loadCalls++; char.equip.main = candidate; return { ok: true }; },
    deleteEquipmentSet: () => true, renameEquipmentSet: () => ({ ok: true }),
    equipmentSetPreview: () => [{ position: "main", name: "ミスリルソード", plus: 7, rarity: "sr", status: "equipped" }],
    isTeamLocked: () => false, canPlaceItem: () => true, itemScore: () => 1, itemLabel: (item) => item.name,
    renderCharDetail: () => { drawCalls++; },
    flashDetailNotice: () => {}, armConfirm: () => {}, confirmReady: () => true,
    saveGame: () => { saved++; }, autoEquip: () => {}, unequipSlot: () => {}, equipItem: () => {},
  });
  vm.runInContext(implementation, context);
  return { char, candidate, sets, context, get drawCalls() { return drawCalls; },
    get saved() { return saved; }, get loadCalls() { return loadCalls; },
    get openedShop() { return openedShop; },
    build: () => context.buildEquipSection(char),
  };
}

test("マイセットは右上ボタンから開く非占有パネルで、初期状態は閉じている", () => {
  const x = setup(), root = x.build();
  const toolbar = find(root, (e) => e.className === "equip-toolbar")[0];
  const anchor = find(toolbar, (e) => e.className === "equip-mysets-anchor")[0];
  const toggle = find(anchor, (e) => e.className.includes("equip-mysets-toggle"))[0];
  const panel = find(anchor, (e) => e.id === "equip-mysets-panel")[0];
  assert.ok(toolbar && anchor && toggle && panel);
  assert.equal(toggle.textContent, "マイセット");
  assert.equal(toggle.attrs["aria-expanded"], "false");
  assert.match(panel.className, /hidden/);
  assert.equal(root.children[0], toolbar, "右上操作は装備画面の先頭に表示");
  assert.equal(root.children.includes(panel), false, "マイセットは装備一覧下部の通常フローに配置しない");

  toggle.click();
  assert.equal(x.drawCalls, 1);
  const opened = x.build();
  const shown = find(opened, (e) => e.id === "equip-mysets-panel")[0];
  assert.doesNotMatch(shown.className, /hidden/);
  assert.equal(find(opened, (e) => e.className.includes("equip-mysets-toggle"))[0].attrs["aria-expanded"], "true");
  assert.ok(find(shown, (e) => e.textContent === "ボス用").length > 0);
});

test("装備枠を選ぶと装備候補が直下に出る。マイセットの展開でも順序は変わらない", () => {
  const x = setup();
  let root = x.build();
  const slot = find(root, (e) => e.className.includes("equip-slot") && e.tagName === "button")[0];
  slot.click();
  assert.equal(x.drawCalls, 1);
  root = x.build();
  const grid = find(root, (e) => e.className === "equip-slot-grid")[0];
  const container = find(root, (e) => e.className === "equip-choice-container")[0];
  assert.ok(container);
  assert.equal(root.children.indexOf(container), root.children.indexOf(grid) + 1);
  assert.ok(find(container, (e) => e.textContent === "右手の装備を選ぶ").length);
  assert.ok(find(container, (e) => e.textContent.includes("ドラゴンソード")).length);
  const toggle = find(root, (e) => e.className.includes("equip-mysets-toggle"))[0];
  toggle.click();
  root = x.build();
  const reopenedGrid = find(root, (e) => e.className === "equip-slot-grid")[0];
  const reopenedContainer = find(root, (e) => e.className === "equip-choice-container")[0];
  assert.equal(root.children.indexOf(reopenedContainer), root.children.indexOf(reopenedGrid) + 1);
});

test("マイセット呼出後はメニューを閉じ、変更された装備がすぐ見える", () => {
  const x = setup();
  let root = x.build();
  find(root, (e) => e.className.includes("equip-mysets-toggle"))[0].click();
  root = x.build();
  const load = find(root, (e) => e.tagName === "button" && e.textContent === "呼出")[0];
  assert.ok(load);
  load.click();
  assert.equal(x.loadCalls, 1);
  assert.equal(x.saved, 1);
  assert.equal(vm.runInContext("openEquipmentSetsCharId", x.context), null);
  assert.equal(vm.runInContext("openSlot", x.context), null);
  root = x.build();
  const main = find(root, (e) => e.className.includes("equip-slot filled"))[0];
  assert.ok(main);
  assert.equal(main.querySelector(".slot-item").textContent, "ドラゴンソード+3");
});

test("ポップオーバーは高さ制限つきでスクロール可能", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /\.equip-mysets\s*\{[^}]*position:\s*absolute;/s);
  assert.match(css, /\.equip-mysets\s*\{[^}]*max-height:[^;]+;/s);
  assert.match(css, /\.equip-mysets\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.equip-mysets\.hidden\s*\{\s*display:\s*none;/);
});


test("マイセット: 無課金は5枠。＋5枠のテスト購入導線をショップに表示", () => {
  const x = setup();
  const root = x.build();
  const panel = find(root, (e) => e.id === "equip-mysets-panel")[0];
  assert.equal(find(panel, (e) => e.className === "equip-myset-row").length, 5);
  assert.ok(find(panel, (e) => e.textContent === "装備マイセット（5/20枠）").length);
  const expand = find(panel, (e) => e.className.includes("equip-myset-expand"))[0];
  assert.ok(expand);
  expand.click();
  assert.deepEqual(x.openedShop, { screen: "screen-chardetail", product: "preset_slots_5" });
});

test("マイセット: パック解放ごとに10/15/20枠。20枠で追加購入導線が消える", () => {
  const x = setup();
  for (const packs of [1, 2, 3]) {
    x.context.S.purchases.presetPacks = packs;
    const panel = find(x.build(), (e) => e.id === "equip-mysets-panel")[0];
    assert.equal(find(panel, (e) => e.className === "equip-myset-row").length, 5 + packs * 5);
    assert.ok(find(panel, (e) => e.textContent === `装備マイセット（${5 + packs * 5}/20枠）`).length);
    assert.equal(find(panel, (e) => e.className.includes("equip-myset-expand")).length, packs < 3 ? 1 : 0);
  }
});

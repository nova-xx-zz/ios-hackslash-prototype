"use strict";
// 装備強化の一覧: 装備分解と同じく部位の絞り込み・価値の表示・並び替え・部位ごとのまとまり（2026-10-24 フィードバック#6）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Rewards = require("../js/core/rewards.js");
const Organize = require("../js/core/inventory-organize.js");

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.textContent = ""; this.className = "";
    this.style = {}; this.listeners = {}; this.attrs = {}; this.value = ""; this.disabled = false; this.scrollTop = 0;
  }
  set innerHTML(v) { assert.equal(v, ""); this.children = []; }
  appendChild(e) { this.children.push(e); return e; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  change(v) { this.value = v; this.listeners.change?.({ target: this }); }
  get classList() {
    const el = this;
    return {
      toggle(name, force) {
        const classes = new Set(el.className.split(/\s+/).filter(Boolean));
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        el.className = [...classes].join(" ");
        return on;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
    };
  }
}
const all = (n) => { const out = []; const visit = (x) => { for (const c of x.children) { out.push(c); visit(c); } }; visit(n); return out; };

function setup({ inventoryCount = 0 } = {}) {
  const ids = {};
  const document = {
    getElementById: (id) => ids[id] || (ids[id] = new Element()),
    createElement: (t) => new Element(t),
    addEventListener: () => {}, // 同じ menu.js 内の別画面がイベント登録するためのDOMモック
  };
  const mk = (id, over) => ({ id, name: id, slot: "weapon", rarity: "n", plus: 0, options: [], stats: { atk: 1 }, ...over });
  const alice = { id: "c1", name: "アリス", team: 0, equip: {
    main: mk("a-sword", { rarity: "sr", plus: 3, stats: { atk: 30 } }), head: mk("a-helm", { slot: "head", rarity: "ur" }) } };
  const bob = { id: "c2", name: "ボブ", team: null, equip: {
    main: mk("b-sword", { rarity: "r", locked: true }), body: mk("b-mail", { slot: "body", rarity: "n", plus: 7 }) } };
  const inventory = Array.from({ length: inventoryCount }, (_, i) => mk("inv-" + i, { stats: { atk: i } }));
  const S = { roster: [alice, bob], inventory, material: 50 };
  const opened = [];
  const ctx = vm.createContext({
    document, S,
    SLOTS: [{ key: "weapon", name: "武器" }, { key: "head", name: "頭" }, { key: "body", name: "体" }],
    RARITIES: [{ key: "n" }, { key: "r" }, { key: "sr" }, { key: "ur" }, { key: "lr" }],
    TEAM_NAMES: ["第一のパーティ"], isTeamLocked: (i) => i === 0,
    itemEffectiveValue: (i) => i.stats.atk, QPCore: { inventoryOrganize: Organize, rewards: Rewards },
    isFeatureEnabled: () => false, guaranteedStoneTotal: () => 0,
    sectionLabel: (t) => { const e = new Element(); e.className = "roster-section"; e.textContent = t; return e; },
    rarityColor: () => "#fff", itemLabel: (i) => i.name + (i.plus ? "+" + i.plus : ""), SLOT_ICONS: {},
    openEnhanceModal: (item) => opened.push(item), clampVitals: () => {}, showScreen: () => {},
    openExploreHub: () => {}, Shop: { rosterCapacity: () => 100, canAddToRoster: () => true },
    openPartyScreen: () => {}, openInventoryScreen: () => {}, openShop: () => {}, openForgeTrial: () => {},
    openCreateScreen: () => {}, armConfirm: () => {}, confirmReady: () => true, saveGame: () => true,
    RACES: {}, jobDef: () => ({ name: "" }), setTimeout, clearTimeout,
  });
  for (const f of ["../js/ui/list-controls.js", "../js/ui/menu.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
  }
  const body = document.getElementById("enhanceListBody");
  const controls = document.getElementById("enhanceFilterRow");
  const sections = () => all(body).filter((e) => e.className === "roster-section").map((e) => e.textContent);
  const rowNames = () => all(body).filter((e) => e.className === "skill-row-name").map((e) => e.textContent);
  const select = (caption) => all(controls).find((e) => e.className === "list-filter-select-label" &&
    e.children[0].textContent === caption).children[1];
  const chip = (text) => all(controls).find((e) => e.tagName === "button" && e.textContent === text);
  return { ctx, body, ids, controls, sections, rowNames, select, chip, opened, open: () => ctx.openEnhanceList() };
}

test("装備中: 部位ごとにまとめ、レア度順。探索中パーティの装備は強化ボタンが押せない", () => {
  const x = setup();
  x.open();
  assert.deepEqual(x.sections(), ["武器（2個）", "頭（1個）", "体（1個）"]);
  assert.deepEqual(x.rowNames(), ["a-sword+3", "🔒b-sword", "a-helm", "b-mail+7"]);
  const buttons = all(x.body).filter((e) => e.tagName === "button" && e.textContent === "強化する");
  assert.equal(buttons[0].disabled, true, "第一のパーティは探索中");
  assert.equal(buttons[1].disabled, false);
});

test("装備中: キャラごとにまとめ、部位・表示・並び順で絞り込める", () => {
  const x = setup();
  x.open();
  x.chip("キャラごと").click();
  assert.deepEqual(x.sections(), ["アリス（第一のパーティ）（2個）", "ボブ（控え）（2個）"]);
  x.select("表示").change("enhanced");
  assert.deepEqual(x.rowNames(), ["a-sword+3", "b-mail+7"]);
  x.select("並び順").change("plus");
  x.chip("部位ごと").click();
  x.select("表示").change("all");
  x.select("部位").change("weapon");
  assert.deepEqual(x.sections(), ["武器（2個）"]);
  x.select("表示").change("locked");
  assert.deepEqual(x.rowNames(), ["🔒b-sword"]);
  x.select("部位").change("head");
  assert.ok(all(x.body).some((e) => e.textContent === "条件に合う装備がありません"));
});

test("所持品: 80件ずつ表示し、能力順に並び替えられる。強化後も一覧の位置を保つ", () => {
  const x = setup({ inventoryCount: 170 });
  x.open();
  x.chip("所持品").click();
  assert.equal(x.chip("キャラごと"), undefined, "所持品ではキャラごとのまとめは出さない");
  assert.equal(x.rowNames().length, 80);
  const more = all(x.body).find((e) => e.textContent.startsWith("さらに表示"));
  more.click();
  assert.equal(x.rowNames().length, 160);
  x.select("並び順").change("power");
  assert.equal(x.rowNames()[0], "inv-169");
  x.body.scrollTop = 300;
  all(x.body).find((e) => e.tagName === "button" && e.textContent === "強化する").click();
  assert.equal(x.opened.length, 1);
});


test("装備強化: 固定フィルターを開閉でき、選択条件と件数・80件表示を維持", () => {
  const x = setup({ inventoryCount: 170 });
  x.open();
  assert.equal(x.ids.btnEnhanceFilter.attrs["aria-expanded"], "false");
  x.ids.btnEnhanceFilter.click();
  assert.equal(x.ids.btnEnhanceFilter.attrs["aria-expanded"], "true");
  assert.equal(x.ids.enhanceFilterPopover.attrs["aria-hidden"], "false");
  x.chip("所持品").click();
  x.select("表示").change("enhanced");
  assert.equal(x.rowNames().length, 0);
  assert.ok(x.ids.btnEnhanceFilter.className.includes("active"));
  x.ids.btnEnhanceFilterClose.click();
  assert.equal(x.ids.btnEnhanceFilter.attrs["aria-expanded"], "false");
  assert.equal(x.select("表示").value, "enhanced", "パネルを閉じても条件を保持");
  x.ids.btnEnhanceFilter.click();
  x.ids.btnEnhanceFilterReset.click();
  assert.equal(x.ids.btnEnhanceFilter.attrs["aria-expanded"], "true");
  assert.equal(x.select("表示").value, "all");
  assert.equal(x.rowNames().length, 4, "既定は装備中の全アイテム");
  assert.ok(!x.ids.btnEnhanceFilter.className.includes("active"));
  x.ids.btnEnhanceFilterClose.click();
  assert.equal(x.ids.btnEnhanceFilter.attrs["aria-expanded"], "false");
});

test("装備強化: フィルターはスクロール外の右上固定、ポップアップに既存の操作群を格納", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const section = html.slice(html.indexOf('id="screen-enhance"'), html.indexOf('id="screen-shop"'));
  assert.ok(section.indexOf('id="btnEnhanceFilter"') < section.indexOf('id="enhanceListBody"'));
  assert.ok(section.indexOf('id="enhanceFilterRow"') < section.indexOf('id="enhanceListBody"'));
  assert.match(section, /id="enhanceFilterPopover"[^>]*class=/);
  assert.ok(html.includes('js/ui/menu.js?v=7'));
});

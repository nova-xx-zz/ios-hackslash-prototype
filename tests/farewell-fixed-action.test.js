"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/ui/menu.js"), "utf8");
const start = source.indexOf("// ---------- 仲間と別れる ----------");
const end = source.indexOf("// ---------- 装備強化", start);
assert.ok(start >= 0 && end > start, "仲間と別れる画面の実装が存在すること");
const implementation = source.slice(start, end);
const listControls = fs.readFileSync(path.join(__dirname, "../js/ui/list-controls.js"), "utf8");
const RosterOrganize = require("../js/core/roster-organize.js");
const Stats = require("../js/core/stats.js");

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.textContent = "";
    this.className = "";
    this.scrollTop = 0;
    this.disabled = false;
    this.attrs = {};
    this.listeners = {};
    this.value = "";
  }
  set innerHTML(value) {
    assert.equal(value, "");
    this.children = [];
  }
  appendChild(element) { this.children.push(element); return element; }
  replaceChildren(...nodes) { this.children = nodes; }
  contains(target) { return this === target || this.children.some((c) => c.contains(target)); }
  get classList() {
    const el = this;
    return {
      toggle(name, force) {
        const items = new Set(el.className.split(/\s+/).filter(Boolean));
        const on = force === undefined ? !items.has(name) : !!force;
        if (on) items.add(name); else items.delete(name);
        el.className = [...items].join(" ");
        return on;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
      contains(name) { return el.className.split(/\s+/).includes(name); },
    };
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  change(value) { this.value = value; this.listeners.change?.({ target: this }); }
}
function allDescendants(node) {
  const result = [];
  const visit = (n) => {
    for (const child of n.children) { result.push(child); visit(child); }
  };
  visit(node);
  return result;
}

function setup(candidateCount = 24, extra = []) {
  const elements = {};
  const documentListeners = {};
  const document = {
    getElementById: (id) => elements[id] ||= new Element(),
    createElement: (tag) => new Element(tag),
    addEventListener: (event, fn) => { documentListeners[event] = fn; },
  };
  const roster = Array.from({ length: candidateCount }, (_, i) =>
    ({ id: "c" + i, name: "仲間" + (i + 1), race: "human",
      level: i + 1, team: null, favorite: false, equip: {} }));
  roster.push(...extra);
  // モデルでは全員との別れを禁止する。候補が残り1人でも常に最低1人残す。
  const alive = [{ id: "protected", name: "主役", team: 0, favorite: true, equip: {} }, ...roster];
  const calls = [];
  let saved = 0, armed = 0, ready = true;
  const context = vm.createContext({
    document, RACES: { human: { name: "人間" }, slime: { name: "スライム" }, wolf: { name: "オオカミ" } },
    jobDef: (c) => ({ name: c.isMonster ? c.race : (c.job || "戦士") }),
    QPCore: { rosterOrganize: RosterOrganize, stats: Stats },
    Inventory: {
      releaseCandidates: () => alive.filter((c) => c.team === null && !c.favorite),
      releaseMembers: (chosen) => {
        calls.push(chosen.slice());
        if (alive.length - chosen.length < 1)
          return { ok: false, reason: "lastMember" };
        for (const c of chosen) alive.splice(alive.indexOf(c), 1);
        return { ok: true, names: chosen.map((c) => c.name), returnedItems: 0 };
      },
    },
    armConfirm: () => { armed++; }, confirmReady: () => ready,
    saveGame: () => { saved++; },
    openPartyMenu: () => {}, showScreen: () => {},
  });
  vm.runInContext(listControls, context);
  vm.runInContext(implementation, context);
  const getButton = () => document.getElementById("farewellActionBar").children
    .find((e) => e.tagName === "button");
  const rows = () => allDescendants(document.getElementById("farewellBody"))
    .filter((e) => e.className.startsWith("skill-row selectable"));
  return {
    context, roster, alive, calls, elements, documentListeners, getButton, rows,
    get saved() { return saved; }, get armed() { return armed; },
    set ready(v) { ready = v; },
    open: () => context.openFarewell(),
    render: () => context.renderFarewell(),
  };
}

test("仲間が24人いても別れる操作は独立フッター内に常時表示", () => {
  const x = setup();
  x.open();
  assert.equal(x.rows().length, 24);
  // 説明・絞り込み・件数と一括選択・「人間」見出し・一覧
  assert.equal(x.elements.farewellBody.children.length, 4, "説明・件数と一括選択・人間見出し・一覧（フィルターはヘッダーへ移動）");
  assert.equal(x.getButton().disabled, true);
  assert.equal(x.getButton().textContent, "別れる仲間を選んでください");
  assert.equal(x.elements.farewellActionBar.children[0].textContent, "選択中：0人");
  assert.equal(allDescendants(x.elements.farewellBody).some((n) => n.className.includes("farewell-btn")), false);
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /<div id="farewellBody" class="roster-body"><\/div>\s*<div id="farewellActionBar"/);
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /\.farewell-action-bar\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /#screen-farewell \.farewell-btn\s*\{[^}]*min-height:\s*48px;/s);
});

test("スクロール途中で仲間を選択しても位置を維持し、選択人数が更新される", () => {
  const x = setup();
  x.open();
  x.elements.farewellBody.scrollTop = 740;
  x.rows()[1].click();
  assert.equal(x.elements.farewellBody.scrollTop, 740);
  assert.equal(x.getButton().textContent, "1人と別れる");
  assert.equal(x.elements.farewellActionBar.children[0].textContent, "選択中：1人");
  x.rows()[2].click();
  assert.equal(x.elements.farewellBody.scrollTop, 740);
  assert.equal(x.getButton().textContent, "2人と別れる");
  assert.equal(x.elements.farewellActionBar.children[0].textContent, "選択中：2人");
  x.rows()[1].click();
  assert.equal(x.getButton().textContent, "1人と別れる");
});

test("別れは2段階確認、選択変更時に確認解除し、成功時のみ即保存", () => {
  const x = setup(3);
  x.open();
  x.rows()[0].click();
  x.getButton().click();
  assert.equal(x.calls.length, 0);
  assert.equal(x.armed, 1);
  assert.match(x.getButton().textContent, /本当に1人と別れる/);
  x.rows()[1].click();
  assert.equal(x.getButton().textContent, "2人と別れる");
  assert.equal(x.calls.length, 0);
  x.getButton().click();
  assert.equal(x.calls.length, 0);
  x.ready = false;
  x.getButton().click();
  assert.equal(x.calls.length, 0, "確認期限切れでは実行しない");
  x.ready = true;
  x.getButton().click();
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].length, 2);
  assert.equal(x.saved, 1);
  assert.equal(x.rows().length, 1);
  assert.equal(x.getButton().disabled, true);
  const status = x.elements.farewellActionBar.children
    .find((e) => e.className.includes("farewell-feedback"));
  assert.ok(status);
  assert.equal(status.attrs.role, "status");
  assert.match(status.textContent, /仲間1・仲間2と別れた/);
});

test("別れられる候補が0人でも固定ボタンは無効のまま、誤削除しない", () => {
  const x = setup(0);
  x.open();
  assert.equal(x.getButton().disabled, true);
  assert.match(x.elements.farewellBody.children[1].textContent, /別れられる仲間がいません/);
  x.getButton().click();
  assert.equal(x.calls.length, 0);
  assert.equal(x.saved, 0);
});

const mon = (id, race, level) => ({ id, name: race + id, race, isMonster: true, level, team: null, favorite: false, equip: {} });
const find = (root, pred) => allDescendants(root).filter(pred);

test("仲間と別れる: 人間とモンスターを分けて表示し、種類・種族で絞り込める", () => {
  const x = setup(3, [mon("c90", "slime", 2), mon("c91", "wolf", 7), mon("c92", "slime", 4)]);
  x.open();
  const body = x.elements.farewellBody;
  const sections = find(body, (n) => n.className === "roster-section").map((n) => n.textContent);
  assert.deepEqual(sections, ["人間（3人）", "モンスター（3人）"]);
  // 既定は従来どおり仲間にした順。並び順を「Lvが高い順」に変えられる
  const names = () => x.rows().map((r) => r.children[0].textContent.split("（")[0]);
  assert.deepEqual(names(), ["仲間1", "仲間2", "仲間3", "slimec90", "wolfc91", "slimec92"]);
  find(x.elements.farewellFilterControls, (n) => n.tagName === "select")[1].change("level");
  assert.deepEqual(names(), ["仲間3", "仲間2", "仲間1", "wolfc91", "slimec92", "slimec90"]);
  const chip = (text) => find(x.elements.farewellFilterControls, (n) => n.tagName === "button" && n.textContent === text)[0];
  chip("モンスター").click();
  assert.deepEqual(find(x.elements.farewellBody, (n) => n.className === "roster-section").map((n) => n.textContent), ["モンスター（3人）"]);
  const select = () => find(x.elements.farewellFilterControls, (n) => n.tagName === "select");
  select()[0].change("m:slime");
  assert.deepEqual(names(), ["slimec92", "slimec90"]);
  select()[1].change("levelAsc");
  assert.deepEqual(names(), ["slimec90", "slimec92"]);
});

test("仲間と別れる: 表示中をまとめて選び、絞り込みで隠れた選択は人数に明示する", () => {
  const x = setup(2, [mon("c90", "slime", 2), mon("c91", "slime", 3)]);
  x.open();
  const body = () => x.elements.farewellBody;
  const chip = (pred) => find(x.elements.farewellFilterControls, (n) => n.tagName === "button" && pred(n.textContent))[0];
  chip((t) => t === "モンスター").click();
  chip((t) => t.startsWith("表示中をすべて選ぶ")).click();
  assert.equal(x.getButton().textContent, "2人と別れる");
  chip((t) => t === "人間").click();
  assert.equal(x.elements.farewellActionBar.children[0].textContent, "選択中：2人（うち表示外2人）");
  x.getButton().click();
  x.getButton().click();
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].map((c) => c.id).sort().join(","), "c90,c91");
});


test("仲間と別れるでも個体値Sを抽出でき、人間切替で条件解除する", () => {
  const ivs = (v) => Object.fromEntries(Stats.IV_KEYS.map((k) => [k, v]));
  const x = setup(2, [
    { ...mon("c90", "slime", 3), ivs: ivs(1.05) },
    { ...mon("c91", "slime", 6), ivs: ivs(1) },
    mon("c92", "wolf", 8),
  ]);
  x.open();
  const selects = () => find(x.elements.farewellFilterControls, (n) => n.tagName === "select");
  assert.equal(selects().length, 3);
  selects()[2].change("S");
  assert.deepEqual(x.rows().map((r) => r.children[0].textContent.split("（")[0]), ["slimec90"]);
  assert.deepEqual(find(x.elements.farewellBody, (n) => n.className === "roster-section").map((n) => n.textContent), ["モンスター（1人）"]);
  assert.equal(x.elements.farewellBody.children[1].children[0].textContent, "条件一致 1人／候補 5人");
  const human = find(x.elements.farewellFilterControls, (n) => n.tagName === "button" && n.textContent === "人間")[0];
  human.click();
  assert.equal(selects().length, 2, "人間だけなら個体値フィルターは非表示");
  assert.equal(x.rows().length, 2);
});


test("仲間と別れる: フィルターは右上固定・一覧内には置かない", () => {
  const x = setup(20, [mon("c90", "slime", 3)]);
  x.open();
  assert.equal(find(x.elements.farewellBody, (e) => e.className === "list-filter-bar").length, 0);
  assert.equal(find(x.elements.farewellFilterControls, (e) => e.className === "list-filter-bar").length, 1);
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "false");
  x.elements.btnFarewellFilter.click();
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "true");
  assert.equal(x.elements.farewellFilterPopover.attrs["aria-hidden"], "false");
  x.elements.btnFarewellFilterClose.click();
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "false");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const section = html.slice(html.indexOf('id="screen-farewell"'), html.indexOf('id="screen-enhance"'));
  assert.ok(section.indexOf('id="btnFarewellFilter"') < section.indexOf('id="farewellBody"'));
  assert.ok(section.indexOf('id="farewellFilterPopover"') < section.indexOf('id="farewellBody"'));
  assert.match(html, /js\\/ui\\/menu\\.js\\?v=6/);
});

test("仲間と別れる: フィルター変更・リセット・パネル外タップ・Escape と一覧スクロールの維持", () => {
  const x = setup(5, [mon("c90", "slime", 3), mon("c91", "wolf", 4)]);
  x.open();
  x.elements.btnFarewellFilter.click();
  x.elements.farewellBody.scrollTop = 650;
  const select = () => find(x.elements.farewellFilterControls, (e) => e.tagName === "select");
  select()[0].change("m:slime");
  assert.equal(x.elements.farewellBody.scrollTop, 650);
  assert.ok(x.elements.btnFarewellFilter.className.includes("active"));
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "true");
  assert.deepEqual(x.rows().map((r) => r.children[0].textContent.split("（")[0]), ["slimec90"]);
  x.elements.btnFarewellFilterClose.click();
  assert.ok(x.elements.btnFarewellFilter.className.includes("active"), "閉じても絞り込み条件は維持");
  x.elements.btnFarewellFilter.click();
  x.documentListeners.keydown({ key: "Escape" });
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "false");
  x.elements.btnFarewellFilter.click();
  x.documentListeners.pointerdown({ target: new Element("button") });
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "false");
  x.elements.btnFarewellFilter.click();
  x.elements.btnFarewellFilterReset.click();
  assert.equal(select()[0].value, "all");
  assert.equal(x.elements.farewellBody.scrollTop, 650);
  assert.ok(!x.elements.btnFarewellFilter.className.includes("active"));
});

test("仲間と別れる: フィルター変更後も選択は維持、確認待ちはキャンセル、誤削除なし", () => {
  const x = setup(2, [mon("c90", "slime", 2), mon("c91", "wolf", 3)]);
  x.open();
  x.rows()[2].click(); // スライムを選択
  x.getButton().click();
  assert.match(x.getButton().textContent, /本当に1人と別れる/);
  const filter = () => find(x.elements.farewellFilterControls, (e) => e.tagName === "button" && e.textContent === "人間")[0];
  filter().click();
  assert.equal(x.getButton().textContent, "1人と別れる", "確認待ちは解除");
  assert.equal(x.elements.farewellActionBar.children[0].textContent, "選択中：1人（うち表示外1人）");
  assert.equal(x.calls.length, 0, "絞り込みで別れる処理は実行されない");
  x.elements.btnFarewellFilterReset.click();
  assert.equal(x.getButton().textContent, "1人と別れる");
  assert.equal(x.calls.length, 0);
  x.elements.btnFarewellBack.click();
  assert.equal(x.elements.btnFarewellFilter.attrs["aria-expanded"], "false");
});

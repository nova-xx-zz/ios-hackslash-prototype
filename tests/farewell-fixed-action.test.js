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
  }
  set innerHTML(value) {
    assert.equal(value, "");
    this.children = [];
  }
  appendChild(element) { this.children.push(element); return element; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
function allDescendants(node) {
  const result = [];
  const visit = (n) => {
    for (const child of n.children) { result.push(child); visit(child); }
  };
  visit(node);
  return result;
}

function setup(candidateCount = 24) {
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] ||= new Element(),
    createElement: (tag) => new Element(tag),
  };
  const roster = Array.from({ length: candidateCount }, (_, i) =>
    ({ id: "c" + i, name: "仲間" + (i + 1), race: "human",
      level: i + 1, team: null, favorite: false, equip: {} }));
  // モデルでは全員との別れを禁止する。候補が残り1人でも常に最低1人残す。
  const alive = [{ id: "protected", name: "主役", team: 0, favorite: true, equip: {} }, ...roster];
  const calls = [];
  let saved = 0, armed = 0, ready = true;
  const context = vm.createContext({
    document, RACES: { human: { name: "人間" } }, jobDef: () => ({ name: "戦士" }),
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
  vm.runInContext(implementation, context);
  const getButton = () => document.getElementById("farewellActionBar").children
    .find((e) => e.tagName === "button");
  const rows = () => allDescendants(document.getElementById("farewellBody"))
    .filter((e) => e.className.startsWith("skill-row selectable"));
  return {
    context, roster, alive, calls, elements, getButton, rows,
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
  assert.equal(x.elements.farewellBody.children.length, 2);
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

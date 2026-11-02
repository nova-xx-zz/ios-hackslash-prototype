"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../tools/lib/load-data.js").loadGameData();

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.disabled = false;
    this.clientWidth = 320;
    this.clientHeight = 320;
    this.classList = {
      add: (name) => { this.className += " " + name; },
      remove: (name) => { this.className = this.className.split(" ").filter((x) => x !== name).join(" "); },
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === "class") this.className = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 320 }; }
  click() { this.listeners.click?.(); }
}
function findAll(root, className) {
  const out = [];
  function visit(el) {
    if (el.className.split(" ").includes(className)) out.push(el);
    for (const child of el.children) visit(child);
  }
  visit(root);
  return out;
}
function setup(ranks = { w1: 1 }) {
  const calls = { renders: 0, saves: 0 };
  const state = { exclusiveRanks: { ...ranks }, general: {} };
  const context = vm.createContext({
    document: {
      createElement: (tag) => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
      getElementById: () => null,
    },
    S: { material: 99999 },
    treeSelectedNode: null,
    treeSwapConfirm: null,
    getExclusiveTree: () => data.EXCLUSIVE_TREES.warrior,
    getTreeState: () => state,
    jobDef: (c) => ({ name: c.job === "warrior" ? "剣士" : "剣豪" }),
    GENERAL_SLOTS: [],
    totalSp: () => 100,
    totalSpentSp: () => Object.values(state.exclusiveRanks).filter(Boolean).length,
    canAcquireNode: (c, tree, current, node) => {
      if (node.reqLevel > c.level) return false;
      if ((node.prerequisites || []).some((pre) => (current[pre.nodeId] || 0) < pre.minRank)) return false;
      if (node.exclusiveGroup && tree.nodes.some((other) =>
        other.id !== node.id && other.exclusiveGroup === node.exclusiveGroup && current[other.id] > 0)) return false;
      return true;
    },
    acquireNode: (_c, _tree, current, node) => { current[node.id] = 1; return true; },
    isTeamLocked: () => false,
    availableSp: () => 97,
    scheduleSave: () => { calls.saves++; },
    renderCharDetail: () => { calls.renders++; },
    treeResetCost: () => 240,
    canResetTree: () => true,
    resetTree: () => {},
    confirmReady: () => true,
    armConfirm: () => {},
  });
  for (const file of ["detail-tree.js", "skill-panel-board.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui", file), "utf8"),
      context, { filename: file });
  }
  const hero = { id: "hero", job: "warrior", name: "剣士", level: 99, team: null };
  return { context, calls, state, hero };
}

test("試作は剣士の固有だけ: 既定の紋章盤を保持して六角パネルへ切り替えられる", () => {
  const { context, calls, hero } = setup();
  const initial = context.buildTreeTab(hero);
  assert.equal(findAll(initial, "tree-web-node").length, 17);
  assert.equal(findAll(initial, "hex-panel-node").length, 0);
  assert.equal(findAll(initial, "hex-panel-switch").length, 1);
  const modes = findAll(initial, "hex-panel-mode");
  assert.deepEqual(modes.map((m) => m.textContent), ["紋章盤", "六角パネル"]);
  modes[1].click();
  assert.equal(calls.renders, 1);

  const preview = context.buildTreeTab(hero);
  assert.equal(findAll(preview, "hex-panel-node").length, 17);
  assert.equal(findAll(preview, "hex-panel-placeholder").length, 27, "周囲のロックは装飾用、実スキルとは分離");
  assert.equal(findAll(preview, "hex-panel-medallion").length, 17, "全スキルは中央のSVGアイコン");
  assert.equal(findAll(preview, "hex-panel-mark").length, 0, "大きな漢字を盤面に載せない");
  assert.equal(findAll(preview, "hex-panel-links").length, 1, "実際の習得前提だけを光路で表現");
  const slots = [...findAll(preview, "hex-panel-node"), ...findAll(preview, "hex-panel-placeholder")];
  assert.equal(new Set(slots.map(n => n.style.left + ":" + n.style.top)).size, 44, "全44マスが重複のない位置に収まる");
  assert.ok(findAll(preview, "hex-panel-placeholder").every(n => n.tagName === "div" && !n.listeners.click),
    "見た目だけのロックパネルはタップできない");
  assert.ok(preview.children.includes(findAll(preview, "hex-panel-switch")[0]),
    "切替ボタンを盤面外の行に配置しパネルとの重なりを防ぐ");
  assert.equal(findAll(preview, "tree-web-node").length, 0);
  assert.equal(findAll(preview, "tree-web-control").length, 3, "拡大・縮小・全体表示を維持");
  assert.equal(findAll(preview, "crest-inline-detail").length, 1, "下部の詳細と習得ボタンを維持");

  findAll(preview, "hex-panel-mode")[0].click();
  assert.equal(findAll(context.buildTreeTab(hero), "tree-web-node").length, 17);
});

test("六角パネルの状態表示・二択封印・Lv条件は既存の正本から決定", () => {
  const { context, hero } = setup({ w1: 1, w2: 1, w3: 1, w4a: 1 });
  const before = JSON.stringify(data.EXCLUSIVE_TREES.warrior);
  context.buildTreeTab(hero);
  vm.runInContext('warriorBoardMode = "hex"', context);
  const tab = context.buildTreeTab(hero);
  const node = (id) => {
    const name = data.EXCLUSIVE_TREES.warrior.nodes.find((n) => n.id === id).name;
    return findAll(tab, "hex-panel-node").find((el) => el.title === name);
  };
  assert.ok(node("w4a").className.includes("acquired"));
  assert.ok(node("w4b").className.includes("choice-sealed"));
  assert.match(node("w4b").attrs["aria-label"], /二択で封印中/);
  assert.ok(findAll(tab, "hex-panel-choice").length >= 6, "二択グループの番号を表示");
  const beforeSelected = node("w3").attrs["aria-pressed"];
  assert.equal(beforeSelected, "true", "初期選択は既存の剣撃突き");
  node("w12").click();
  assert.equal(context.treeSelectedNode.nodeId, "w12");
  const selected = context.buildTreeTab(hero);
  assert.equal(findAll(selected, "hex-panel-node").filter((n) => n.className.includes("selected")).length, 1);
  assert.equal(JSON.stringify(data.EXCLUSIVE_TREES.warrior), before, "スキル正本は描画で変更しない");

  const lowLevel = { ...hero, level: 1 };
  const lowTab = context.buildTreeTab(lowLevel);
  const ultimate = findAll(lowTab, "hex-panel-node").find((n) => n.title === "剛勇覇斬");
  assert.ok(ultimate.className.includes("level-locked"), "Lv不足を表示");
});

test("試作の読み込みとデザインを分離し、非対応職には切替を表示しない", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /js\/ui\/skill-panel-board\.js\?v=\d+/);
  assert.match(html, /css\/skill-panel-board\.css\?v=\d+/);
  const css = fs.readFileSync(path.join(__dirname, "../css/skill-panel-board.css"), "utf8");
  assert.match(css, /\.hex-panel-node\.choice-sealed/);
  assert.match(css, /\.hex-panel-board \.hex-panel-viewport/);
  assert.match(css, /\.hex-panel-board \.hex-panel-node,/);
  assert.match(css, /\.hex-panel-board \.hex-panel-placeholder/);
  assert.doesNotMatch(css, /font:\s*800 max\(2\.8em/, "漢字の巨大表示に使っていたCSSを排除");
  const { context, hero } = setup();
  const other = context.buildTreeTab({ ...hero, job: "swordmaster" });
  assert.equal(findAll(other, "hex-panel-switch").length, 0);
  assert.equal(findAll(other, "hex-panel-node").length, 0);
});

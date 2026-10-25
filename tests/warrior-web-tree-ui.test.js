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
    this.clientWidth = 320;
    this.clientHeight = 320;
    this.classList = {
      add: (name) => { this.className += " " + name; },
      remove: (name) => { this.className = this.className.split(" ").filter(x => x !== name).join(" "); },
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, val) { this.attrs[key] = String(val); if (key === "class") this.className = String(val); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 320 }; }
  click() { this.listeners.click?.(); }
}

function descendants(el, predicate) {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    for (const child of node.children) visit(child);
  };
  visit(el);
  return results;
}
const byClass = (root, name) => descendants(root, n => n.className.split(" ").includes(name));

function renderContext() {
  let rerenders = 0;
  let saved = 0;
  const state = { roster: [] };
  const context = vm.createContext({
    document: {
      createElement: tag => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
      getElementById: () => null,
    },
    S: state,
    treeSelectedNode: null,
    treeSwapConfirm: null,
    renderCharDetail: () => { rerenders++; },
    canAcquireNode: (_c, _tree, _ranks, node) => node.reqLevel <= 99,
    isTeamLocked: () => false,
    scheduleSave: () => { saved++; },
  });
  const js = fs.readFileSync(path.join(__dirname, "../js/ui/detail-tree.js"), "utf8");
  vm.runInContext(js, context, { filename: "detail-tree.js" });
  return { context, get rerenders() { return rerenders; }, get saved() { return saved; } };
}

test("剣士の蜘蛛の巣: 正本17ノードが全表示され、3リング・6放射線・実データの前提線を描画", () => {
  const { context } = renderContext();
  const nodes = data.EXCLUSIVE_TREES.warrior.nodes;
  assert.equal(nodes.length, 17);
  const root = context.buildWarriorWebGraph({ level: 99 }, "exclusive", data.EXCLUSIVE_TREES.warrior, {});
  const buttons = byClass(root, "tree-web-node");
  assert.equal(buttons.length, nodes.length);
  assert.deepEqual(buttons.map(b => b.title).sort(), Array.from(nodes, n => n.name).sort());
  assert.equal(byClass(root, "tree-web-ring").length, 3);
  assert.equal(byClass(root, "tree-web-spoke").length, 6);
  assert.equal(byClass(root, "tree-web-link").length, nodes.reduce((n, v) => n + v.prerequisites.length, 0));
  assert.equal(byClass(root, "tree-web-lane").length, 6);
  assert.equal(byClass(root, "tree-web-core").length, 1);
  assert.ok(buttons.every(x => x.attrs["aria-label"]));
});

test("剣士の蜘蛛の巣: ノード選択・習得済み色・ズーム/全体表示・ピンチが動作", () => {
  const env = renderContext();
  const context = env.context;
  const root = context.buildWarriorWebGraph({ level: 99 }, "exclusive",
    data.EXCLUSIVE_TREES.warrior, { w1: 1, w2: 1, w3: 1 });
  assert.equal(byClass(root, "tree-web-node").length, 17);
  assert.equal(byClass(root, "acquired").filter(e => e.className.includes("tree-web-node")).length, 3);
  const node = byClass(root, "tree-web-node").find(b => b.title === "剣撃突き");
  node.click();
  assert.equal(context.treeSelectedNode.nodeId, "w3");
  assert.equal(context.treeSelectedNode.scope, "exclusive");
  assert.equal(env.rerenders, 1); // 1回の再描画
  const controls = byClass(root, "tree-web-control");
  assert.equal(controls.length, 3);
  const scene = byClass(root, "tree-web-scene")[0];
  controls[1].click();
  assert.match(scene.style.transform, /scale\(1\.25\)/);
  controls[2].click();
  assert.match(scene.style.transform, /scale\(1\)/);
  const viewport = byClass(root, "tree-web-viewport")[0];
  const touch = (x, y) => ({ clientX: x, clientY: y });
  viewport.listeners.touchstart({ touches: [touch(100, 100), touch(200, 100)] });
  viewport.listeners.touchmove({
    touches: [touch(85, 100), touch(215, 100)], cancelable: true, preventDefault() {},
  });
  assert.match(scene.style.transform, /scale\(1\.3\)/);
  controls[2].click();
  assert.match(scene.style.transform, /scale\(1\)/);
});

test("剣士以外と汎用枠は従来の縦分岐図を維持する", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const root = context.buildTreeGraph({ level: 99 }, "general", tree, {});
  assert.equal(byClass(root, "tree-graph").length, 1);
  assert.equal(byClass(root, "tree-web").length, 0);
  assert.equal(byClass(root, "tree-node").length, tree.nodes.length);
});

test("描画のみの刷新: 剣士固有ノードの効果/前提/必要SPの正本は変更しない", () => {
  const nodes = data.EXCLUSIVE_TREES.warrior.nodes;
  const prereqs = JSON.parse(JSON.stringify(nodes.find(n => n.id === "w12").prerequisites));
  assert.deepEqual(prereqs, [{ nodeId: "w11", minRank: 1 }]);
  assert.equal(nodes.find(n => n.id === "w12").costByRank[0], 9);
  assert.equal(nodes.find(n => n.id === "w4a").exclusiveGroup, "w_style");
  assert.equal(nodes.find(n => n.id === "w4b").exclusiveGroup, "w_style");
  assert.equal(nodes.find(n => n.id === "w12").ability.id, "tree_w12");
});

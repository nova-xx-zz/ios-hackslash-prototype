"use strict";
// 二択（exclusiveGroup）のUI: 割符の印・分岐の門・比較表示・2回押しの確定。
// 全職の固有ツリーと汎用ツリーで共通。判定と習得は既存の canAcquireNode / acquireNode のまま。
// 設計: docs/スキルの二択UI設計.md
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../tools/lib/load-data.js").loadGameData();

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.parent = null; this.style = {}; this.attrs = {}; this.listeners = {};
    this.className = ""; this.textContent = ""; this.title = ""; this.disabled = false; this.type = "";
    this.clientWidth = 320; this.clientHeight = 320;
    this.classList = {
      add: (name) => { this.className += " " + name; },
      remove: (name) => { this.className = this.className.split(" ").filter((x) => x !== name).join(" "); },
    };
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  setAttribute(key, val) { this.attrs[key] = String(val); if (key === "class") this.className = String(val); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 320 }; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const all = (el, pred, out = []) => { if (pred(el)) out.push(el); el.children.forEach((c) => all(c, pred, out)); return out; };
const byClass = (el, name) => all(el, (n) => n.className.split(" ").includes(name));
const text = (el) => el.textContent + el.children.map(text).join("");

function context(overrides = {}) {
  const calls = { acquired: [], rerenders: 0, saved: 0, armed: 0 };
  let ready = true;
  const ctx = vm.createContext({
    document: { createElement: (t) => new Element(t), createElementNS: (_, t) => new Element(t), getElementById: () => null },
    S: { material: 9999 }, treeSelectedNode: null, treeSwapConfirm: null,
    jobDef: (c) => data.JOBS[c.job] || data.JOBS.warrior,
    renderCharDetail: () => { calls.rerenders++; },
    canAcquireNode: (c, tree, ranks, node) => node.reqLevel <= c.level &&
      node.prerequisites.every((p) => (ranks[p.nodeId] || 0) >= p.minRank) &&
      !(node.exclusiveGroup && tree.nodes.some((o) => o.id !== node.id && o.exclusiveGroup === node.exclusiveGroup && (ranks[o.id] || 0) > 0)),
    acquireNode: (c, tree, ranks, node) => { calls.acquired.push(node.id); ranks[node.id] = 1; return true; },
    isTeamLocked: () => false, availableSp: () => 30,
    scheduleSave: () => { calls.saved++; },
    armConfirm: () => { calls.armed++; }, confirmReady: () => ready,
    ...overrides,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui/detail-tree.js"), "utf8"), ctx, { filename: "detail-tree.js" });
  return { ctx, calls, setReady: (v) => { ready = v; } };
}
const warrior = data.EXCLUSIVE_TREES.warrior;

test("全職の固有ツリー・全汎用ツリーで二択の組と分岐の門（共通の親）を取り出せる", () => {
  const { ctx } = context();
  const trees = [...Object.values(data.EXCLUSIVE_TREES), ...Object.values(data.GENERAL_TREES)];
  assert.ok(trees.length >= 13);
  for (const tree of trees) {
    const info = ctx.treeChoiceInfo(tree, {});
    const groups = new Set(tree.nodes.filter((n) => n.exclusiveGroup).map((n) => n.exclusiveGroup));
    assert.equal(Object.keys(info.byNode).length, tree.nodes.filter((n) => n.exclusiveGroup).length, tree.id);
    assert.equal(Object.values(info.gates).flat().length, groups.size, tree.id + " の各組に分岐の門がある");
    for (const choice of Object.values(info.byNode)) {
      assert.equal(choice.state, "open");
      assert.ok(choice.rivals.length >= 1);
    }
  }
  const w = ctx.treeChoiceInfo(warrior, { w4b: 1 });
  assert.deepEqual([w.byNode.w4a.group.label, w.byNode.w7a.group.label, w.byNode.w10a.group.label], ["Ⅰ", "Ⅱ", "Ⅲ"]);
  assert.deepEqual(Object.keys(w.gates).sort(), ["w3", "w6", "w9"]);
  assert.equal(w.byNode.w4b.state, "chosen");
  assert.equal(w.byNode.w4a.state, "sealed");
  assert.equal(w.byNode.w7a.state, "open", "別の組は独立");
});

test("紋章盤: 割符の印・分岐の門・相方の強調・選ばなかった線の切れ目", () => {
  const { ctx } = context();
  ctx.treeSelectedNode = { scope: "exclusive", nodeId: "w7b" };
  const board = ctx.buildWarriorWebGraph({ job: "warrior", level: 99 }, "exclusive", warrior, { w1: 1, w2: 1, w3: 1, w4b: 1, w5: 1, w6: 1 });
  const node = (name) => byClass(board, "tree-web-node").find((b) => b.title === name);
  const tagOf = (name) => byClass(node(name), "tree-choice-tag")[0];
  assert.equal(byClass(board, "tree-choice-tag").length, 6);
  assert.equal(tagOf("猛攻の構え").textContent, "Ⅰ");
  assert.match(tagOf("猛攻の構え").className, /chosen/);
  assert.match(tagOf("不動の構え").className, /sealed/);
  assert.match(tagOf("豪腕").className, /open/);
  assert.deepEqual(["剣撃突き", "剛力", "歴戦の体"].map((n) => text(byClass(node(n), "tree-choice-gate")[0])), ["Ⅰ", "Ⅱ", "Ⅲ"]);
  // 豪腕を見ている時は、相方の鉄壁の構えだけが強調される
  assert.deepEqual(byClass(board, "choice-partner").map((b) => b.title), ["鉄壁の構え"]);
  assert.match(node("鉄壁の構え").attrs["aria-label"], /二択Ⅱ（相手: 豪腕）/);
  assert.match(node("剛力").attrs["aria-label"], /ここから二択Ⅱに分かれる/);
  // 選ばなかった側の線は途切れ、切れ目の印が1つ
  assert.equal(byClass(board, "tree-web-link-cut").length, 1);
  const links = byClass(board, "tree-web-link");
  assert.equal(links.length, 16, "前提線の本数は変わらない");
  assert.equal(links.filter((l) => /choice-link/.test(l.className)).length, 6);
  assert.equal(links.filter((l) => /choice-focus/.test(l.className)).length, 2, "見ている組の2本を強調");
});

test("比較表示: 2つを並べ、相手をタップすると選択が移る", () => {
  const { ctx, calls } = context();
  ctx.treeSelectedNode = { scope: "exclusive", nodeId: "w4b" };
  const panel = ctx.buildTreeNodeDetail({ job: "warrior", level: 99, team: null }, warrior, { w1: 1, w2: 1, w3: 1 }, warrior.nodes.find((n) => n.id === "w4b"), "");
  const options = byClass(panel, "tree-choice-option");
  assert.deepEqual(options.map((o) => byClass(o, "tree-choice-option-name")[0].textContent), ["不動の構え", "猛攻の構え"]);
  assert.match(options[1].className, /viewing/);
  assert.equal(options[0].tagName, "button");
  assert.equal(byClass(options[0], "tree-choice-option-desc")[0].textContent, "被ダメージ-8%", "「（4bと選択）」は除く");
  assert.match(byClass(options[0], "tree-choice-option-meta")[0].textContent, /鉄壁・SP2/);
  options[0].click();
  assert.deepEqual({ ...ctx.treeSelectedNode }, { scope: "exclusive", nodeId: "w4a" });
  assert.equal(calls.rerenders, 1);
});

test("二択の習得は2回押し: 1回目は確認のみ、2回目で既存の acquireNode", () => {
  const { ctx, calls, setReady } = context();
  const ranks = { w1: 1, w2: 1, w3: 1 };
  const c = { job: "warrior", level: 99, team: null };
  const node = warrior.nodes.find((n) => n.id === "w4b");
  const btnOf = () => byClass(ctx.buildTreeNodeDetail(c, warrior, ranks, node, ""), "crest-learn-btn")[0];
  let btn = btnOf();
  assert.match(text(btn), /「猛攻の構え」を選ぶ.*SP2・「不動の構え」は封印/);
  btn.click();
  assert.equal(ctx.treeSwapConfirm, "choice:w4b");
  assert.equal(calls.armed, 1);
  assert.deepEqual(calls.acquired, [], "1回目では習得しない");
  btn = btnOf();
  assert.match(text(btn), /本当に選ぶ？.*戻すにはリセット/);
  assert.match(btn.className, /confirming/);
  setReady(false);
  btn.click();
  assert.deepEqual(calls.acquired, [], "誤タップ防止の待ち時間中は習得しない");
  setReady(true);
  btn.click();
  assert.deepEqual(calls.acquired, ["w4b"]);
  assert.equal(ctx.treeSwapConfirm, null);
  assert.equal(calls.saved, 1);
  // 二択でないノードは従来どおり1回で習得
  const plain = byClass(ctx.buildTreeNodeDetail(c, warrior, { w1: 1 }, warrior.nodes.find((n) => n.id === "w2"), ""), "crest-learn-btn")[0];
  plain.click();
  assert.deepEqual(calls.acquired, ["w4b", "w2"]);
});

test("汎用ツリー・他職の縦の分岐図と詳細にも同じ印と比較表示・2回押し", () => {
  const { ctx, calls } = context();
  const tree = data.GENERAL_TREES.offense;
  const c = { job: "warrior", level: 99, team: null };
  const ranks = {};
  const graph = ctx.buildTreeGraph(c, "slot1", tree, ranks);
  assert.equal(byClass(graph, "tree-choice-tag").length, 2);
  assert.equal(byClass(graph, "tree-choice-gate").length, 1);
  ranks.go1 = 1;
  const choiceNode = tree.nodes.find((n) => n.exclusiveGroup);
  const panel = ctx.buildTreeNodeDetail(c, tree, ranks, choiceNode, "汎用");
  assert.equal(byClass(panel, "tree-choice-option").length, 2);
  const btn = all(panel, (n) => n.tagName === "button" && /primary/.test(n.className))[0];
  assert.match(text(btn), /を選ぶ/);
  btn.click();
  assert.deepEqual(calls.acquired, []);
  const again = all(ctx.buildTreeNodeDetail(c, tree, ranks, choiceNode, "汎用"), (n) => n.tagName === "button" && /primary/.test(n.className))[0];
  assert.match(text(again), /本当に選ぶ？/);
  again.click();
  assert.deepEqual(calls.acquired, [choiceNode.id]);
  // 他職（まほうつかい）の縦の分岐図にも印が付く
  const magic = ctx.buildTreeGraph({ job: "mage", level: 99 }, "exclusive", data.EXCLUSIVE_TREES.magic, {});
  assert.equal(byClass(magic, "tree-choice-tag").length, 6);
});

test("二択のCSSは全ツリー共通の節と紋章盤の節にあり、キャッシュ番号を更新", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /二択（どちらか1つだけ習得できるスキル）の共通表示/);
  assert.match(css, /\.tree-choice-tag \{/);
  assert.match(css, /\.tree-web-node \.tree-choice-tag \{[^}]*width: 46%;[^}]*min-width: 14px;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.choice-partner::before/);
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /css\/style\.css\?v=93/);
  assert.match(html, /js\/ui\/detail-tree\.js\?v=17/);
});

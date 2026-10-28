// せんしのスキルツリー専用画面: 「画面固定の層」と「拡大縮小する盤面」の分離、キャラ送り、レイアウトの不変条件。
// 設計: docs/スキルツリー画面再設計.md
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const data = require("../tools/lib/load-data.js").loadGameData();
const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "js/ui/detail-tree.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const detailJs = fs.readFileSync(path.join(root, "js/ui/detail.js"), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.disabled = false;
    this.clientWidth = 360;
    this.clientHeight = 300;
    this.classList = {
      add: (name) => { this.className += " " + name; },
      remove: (name) => { this.className = this.className.split(" ").filter((x) => x !== name).join(" "); },
    };
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  setAttribute(key, val) { this.attrs[key] = String(val); if (key === "class") this.className = String(val); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const descendants = (el, predicate, out = []) => {
  if (predicate(el)) out.push(el);
  for (const child of el.children) descendants(child, predicate, out);
  return out;
};
const byClass = (el, name) => descendants(el, (n) => n.className.split(" ").includes(name));
const ancestorClasses = (el) => { const out = []; for (let p = el.parent; p; p = p.parent) out.push(...p.className.split(" ")); return out; };

function context(overrides = {}) {
  const calls = { switched: [], rerenders: 0 };
  const ctx = vm.createContext({
    document: { createElement: (t) => new Element(t), createElementNS: (_, t) => new Element(t), getElementById: () => null },
    S: { material: 9999 },
    treeSelectedNode: null,
    treeSwapConfirm: null,
    detailTab: "tree",
    renderCharDetail: () => { calls.rerenders++; },
    canAcquireNode: () => true,
    acquireNode: () => true,
    isTeamLocked: () => false,
    availableSp: () => 20,
    scheduleSave: () => {},
    getExclusiveTree: () => data.EXCLUSIVE_TREES.warrior,
    getTreeState: () => ({ exclusiveRanks: { w1: 1 }, general: {} }),
    GENERAL_SLOTS: [],
    totalSp: () => 30,
    totalSpentSp: () => 1,
    treeResetCost: () => 120,
    canResetTree: () => true,
    resetTree: () => {},
    confirmReady: () => true,
    armConfirm: () => {},
    detailPagerInfo: (c) => ({ name: c.name, pos: "I・2/5", canSwitch: true }),
    switchDetail: (d) => { calls.switched.push(d); },
    ...overrides,
  });
  vm.runInContext(js, ctx, { filename: "detail-tree.js" });
  return { ctx, calls };
}

test("盤面に属するもの（魔法陣SVG・紋章・前提線・ノード・6方向の札）はすべて拡大する scene の中", () => {
  const { ctx } = context();
  const board = ctx.buildWarriorWebGraph({ id: "a", job: "warrior", level: 99 }, "exclusive", data.EXCLUSIVE_TREES.warrior, { w1: 1 });
  const inScene = (el) => ancestorClasses(el).includes("tree-web-scene");
  for (const cls of ["tree-web-lines", "tree-web-core", "tree-web-node", "tree-web-lane", "tree-web-link", "tree-web-runes", "tree-web-tick"]) {
    const found = byClass(board, cls);
    assert.ok(found.length > 0, cls);
    assert.ok(found.every(inScene), cls + " は scene の中");
  }
  // 画面固定: 職業の見出し・ズームボタンは scene の外
  for (const cls of ["crest-banner", "tree-web-control"]) {
    const found = byClass(board, cls);
    assert.ok(found.length > 0 && found.every((el) => !inScene(el)), cls + " は scene の外（固定）");
  }
  // transform は scene にだけ掛かる
  assert.match(byClass(board, "tree-web-scene")[0].style.transform, /^translate\(0px, 0px\) scale\(1\)$/);
  assert.equal(byClass(board, "tree-web-viewport")[0].style.transform, undefined);
  assert.equal(byClass(board, "tree-web-lane")[0].style.transform, undefined, "札に個別の transform を掛けない");
});

test("SVGとHTMLは同じ0〜100の盤面座標: 正方形の scene を枠の中央に置き、1em=盤面1単位", () => {
  const { ctx } = context();
  const board = ctx.buildWarriorWebGraph({ id: "a", job: "warrior", level: 99 }, "exclusive", data.EXCLUSIVE_TREES.warrior, {});
  const scene = byClass(board, "tree-web-scene")[0];
  // 枠 360×300 → 正方形 300、左右に30pxずつ余白
  assert.equal(scene.style.width, "300px");
  assert.equal(scene.style.height, "300px");
  assert.equal(scene.style.left, "30px");
  assert.equal(scene.style.top, "0px");
  assert.equal(scene.style.fontSize, "3px");
  const svg = byClass(board, "tree-web-lines")[0];
  assert.equal(svg.attrs.viewBox, "0 0 100 100");
  assert.equal(svg.attrs.preserveAspectRatio, "none");
  // 札の位置はノードと同じ極座標から計算（基礎は真上・覇道は真下）
  const lanes = byClass(board, "tree-web-lane");
  assert.equal(lanes[0].style.left, "50.00%");
  assert.equal(lanes[3].style.left, "50.00%");
  assert.ok(parseFloat(lanes[0].style.top) < 6 && parseFloat(lanes[3].style.top) > 94);
  assert.match(css, /\.tree-web-lane \{[^}]*font: 700 max\(3\.2em, 10px\)/, "札の文字は盤面単位");
  assert.match(css, /\.tree-web-node \{[^}]*width: 8\.6%;/, "ノードは scene に対する%");
});

test("前提線は無関係なノードの上を通らない（中心から4.4単位以上離す）", () => {
  const { ctx } = context();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const pos = Object.fromEntries(tree.nodes.map((n) => { const p = ctx.warriorWebPlace(n.id); return [n.id, ctx.warriorWebPolar(p.angle, p.radius)]; }));
  for (const node of tree.nodes) {
    for (const pre of node.prerequisites) {
      const pts = ctx.warriorWebLinkPoints(pre.nodeId, node.id);
      for (let i = 0; i < pts.length - 1; i++) {
        for (let t = 0; t <= 10; t++) {
          const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t / 10;
          const y = pts[i].y + (pts[i + 1].y - pts[i].y) * t / 10;
          for (const other of tree.nodes) {
            if (other.id === node.id || other.id === pre.nodeId) continue;
            assert.ok(Math.hypot(pos[other.id].x - x, pos[other.id].y - y) >= 4.4, `${pre.nodeId}→${node.id} が ${other.id} に近い`);
          }
        }
      }
    }
  }
});

test("習得は中から外へ: 基礎は剣紋章を囲む環、どの前提線も子は親と同じ環かより外側", () => {
  const { ctx } = context();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const radius = (id) => ctx.warriorWebPlace(id).radius;
  // 基礎の3つ（鍛えた腕→戦いの勘→剣撃突き）がいちばん内側の環
  const inner = Math.min(...tree.nodes.map((n) => radius(n.id)));
  for (const id of ["w1", "w2", "w3"]) assert.equal(radius(id), inner, id + " は基礎の環");
  assert.ok(tree.nodes.filter((n) => radius(n.id) === inner).length === 3, "基礎の環は3つだけ");
  // 前提のない最初のスキルは基礎の環にある
  for (const n of tree.nodes.filter((n) => !n.prerequisites.length)) assert.equal(radius(n.id), inner);
  for (const node of tree.nodes) {
    for (const pre of node.prerequisites) {
      assert.ok(radius(node.id) >= radius(pre.nodeId), `${pre.nodeId}→${node.id} が内側へ戻っている`);
    }
  }
  // 基礎以外の5方向はそれぞれ内→外の順（中心寄りの環ほど前提に近い）
  const lanes = {};
  for (const n of tree.nodes) {
    const lane = vm.runInContext(`WARRIOR_WEB_LAYOUT[${JSON.stringify(n.id)}].lane`, ctx);
    if (lane !== 0) (lanes[lane] = lanes[lane] || []).push(n);
  }
  assert.equal(Object.keys(lanes).length, 5);
  for (const nodes of Object.values(lanes)) {
    const byRadius = nodes.slice().sort((a, b) => radius(a.id) - radius(b.id));
    for (let i = 1; i < byRadius.length; i++) assert.ok(byRadius[i].reqLevel >= byRadius[i - 1].reqLevel, "外ほど後で解放");
  }
});

test("キャラ送り: 名前・位置を表示し、前後ボタンは既存の switchDetail を呼ぶ（1人なら押せない）", () => {
  const { ctx, calls } = context();
  const tab = ctx.buildTreeTab({ id: "a", name: "ガイ", job: "warrior", level: 99, team: 0 });
  assert.equal(byClass(tab, "crest-pager-name")[0].textContent, "ガイ");
  assert.equal(byClass(tab, "crest-pager-pos")[0].textContent, "I・2/5");
  const [prev, next] = byClass(tab, "crest-pager-btn");
  assert.equal(prev.attrs["aria-label"], "前の仲間");
  next.click();
  prev.click();
  assert.deepEqual(calls.switched, [1, -1]);

  const solo = context({ detailPagerInfo: (c) => ({ name: c.name, pos: "控え・1/1", canSwitch: false }) });
  const soloTab = solo.ctx.buildTreeTab({ id: "a", name: "ガイ", job: "warrior", level: 99, team: null });
  assert.ok(byClass(soloTab, "crest-pager-btn").every((b) => b.disabled));
  assert.match(detailJs, /function detailPagerInfo\(c\)/);
  assert.match(detailJs, /const pager = detailPagerInfo\(c\);/, "通常の見出しと同じ情報源");
});

test("仲間が変わったら選択ノード・表示タブ・拡大位置を引き継がない", () => {
  const { ctx } = context();
  ctx.buildTreeTab({ id: "a", name: "ガイ", job: "warrior", level: 99, team: null });
  vm.runInContext("warriorWebView.scale = 2; warriorWebView.x = 40;", ctx);
  ctx.treeSelectedNode = { scope: "exclusive", nodeId: "w12" };
  const tab = ctx.buildTreeTab({ id: "b", name: "リナ", job: "warrior", level: 99, team: null });
  assert.equal(ctx.treeSelectedNode.nodeId, "w3", "初期選択（剣撃突き）に戻る");
  assert.equal(vm.runInContext("JSON.stringify(warriorWebView)", ctx), JSON.stringify({ scale: 1, x: 0, y: 0 }));
  assert.match(byClass(tab, "tree-web-scene")[0].style.transform, /translate\(0px, 0px\) scale\(1\)/);
});

test("画面の器: 盤面・詳細・習得ボタンを1画面に配置し、背景は既存の城郭イラストを画面に固定", () => {
  const { ctx } = context();
  const tab = ctx.buildTreeTab({ id: "a", name: "ガイ", job: "warrior", level: 99, team: null });
  const order = tab.children.map((child) => child.className);
  assert.deepEqual(order, ["crest-focus-navigation", "detail-section-head crest-screen-head", "crest-focus-tabs", "crest-stage-area", "crest-inline-detail"]);
  assert.equal(byClass(tab.children[4], "crest-learn-btn").length, 1, "習得ボタンは下部ドック");
  assert.equal(byClass(tab.children[3], "crest-learn-btn").length, 0);
  assert.match(css, /#app:has\(#screen-chardetail\.warrior-crest-view:not\(\.hidden\)\) \{[^}]*explore-guild\.jpg/);
  assert.match(css, /\.crest-stage-area \{[^}]*flex: 1 1 auto;/);
  assert.match(css, /\.crest-inline-detail \{ flex: 0 0 auto;/);
  assert.match(css, /\.tree-web--crest \.tree-web-viewport \{[^}]*touch-action: none;/);
  assert.equal(fs.existsSync(path.join(root, "icons/skill-tree-gothic-background.svg")), false, "使わなくなった背景SVGは残さない");
  assert.doesNotMatch(css, /skill-tree-gothic-background|crest-zoom-options|crest-tree-stage/);
  const section = css.slice(css.indexOf("/* ===== せんし専用: スキルツリー専用画面"), css.indexOf("/* map */"));
  assert.ok(section.length > 1000);
  assert.doesNotMatch(section, /!important/, "上書き合戦をしない");
  // 剣士の専用CSSは1か所にまとめる（上書きの層を重ねない）
  assert.equal((css.match(/せんし専用: スキルツリー専用画面/g) || []).length, 1);
  assert.equal((css.match(/#app:has\(#screen-chardetail\.warrior-crest-view/g) || []).length, 1);
});

test("キャッシュ番号（iPhoneへの反映）", () => {
  assert.match(html, /css\/style\.css\?v=87/);
  assert.match(html, /js\/ui\/detail-tree\.js\?v=13/);
  assert.match(html, /js\/ui\/detail\.js\?v=11/);
});

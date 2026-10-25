"use strict";
// せんし専用スキルツリー「剛勇の紋章盤」のUIテスト。
// 見た目の刷新のみで、ツリーの正本（前提・排他・Lv・SP・効果）と習得処理は変えないことも確認する。
// 設計: docs/剣士スキルツリーUI改修.md
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
const allText = (el) => el.textContent + el.children.map(allText).join("");

function renderContext(overrides = {}) {
  const calls = { rerenders: 0, saved: 0, acquired: [], resets: 0 };
  const state = { roster: [], material: 99999 };
  const context = vm.createContext({
    document: {
      createElement: tag => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
      getElementById: () => null,
    },
    S: state,
    treeSelectedNode: null,
    treeSwapConfirm: null,
    renderCharDetail: () => { calls.rerenders++; },
    canAcquireNode: (_c, _tree, _ranks, node) => node.reqLevel <= 99,
    acquireNode: (c, tree, ranks, node) => { calls.acquired.push(node.id); ranks[node.id] = 1; return true; },
    isTeamLocked: () => false,
    availableSp: () => 98,
    scheduleSave: () => { calls.saved++; },
    // ツリータブ全体を組み立てる時の依存（汎用枠は0件にして固有ツリーだけ検証する）
    getExclusiveTree: () => data.EXCLUSIVE_TREES.warrior,
    getTreeState: () => ({ exclusiveRanks: { w1: 1 }, general: {} }),
    GENERAL_SLOTS: [],
    totalSp: () => 44,
    totalSpentSp: () => 1,
    treeResetCost: () => 240,
    canResetTree: () => true,
    resetTree: () => { calls.resets++; },
    confirmReady: () => true,
    armConfirm: () => {},
    ...overrides,
  });
  const js = fs.readFileSync(path.join(__dirname, "../js/ui/detail-tree.js"), "utf8");
  vm.runInContext(js, context, { filename: "detail-tree.js" });
  return { context, calls };
}
// SVGパスの始点・終点（盤面座標）
function pathEnds(d) {
  const nums = d.replace(/^M/, "").split("L").map(p => p.trim().split(/\s+/).map(Number));
  return { start: nums[0], end: nums[nums.length - 1] };
}

test("せんしだけ新UI: けんごう・他職・汎用枠は従来の縦分岐図", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  assert.equal(context.isWarriorCrestWeb({ job: "warrior" }, "exclusive", tree), true);
  assert.equal(context.isWarriorCrestWeb({ job: "swordmaster" }, "exclusive", tree), false, "けんごうは同じツリーでも旧UI");
  assert.equal(context.isWarriorCrestWeb({ job: "warrior" }, "general", tree), false, "汎用枠は旧UI");
  assert.equal(context.isWarriorCrestWeb({ job: "mage" }, "exclusive", data.EXCLUSIVE_TREES.magic), false);

  const warriorTab = context.buildTreeTab({ job: "warrior", level: 45, team: null });
  assert.ok(warriorTab.className.includes("tree-tab--crest"));
  assert.equal(byClass(warriorTab, "warrior-crest-section").length, 1);
  assert.equal(byClass(warriorTab, "tree-web--crest").length, 1);
  assert.equal(byClass(warriorTab, "crest-screen-head").length, 1);
  assert.equal(byClass(warriorTab, "tree-graph").length, 0);

  const kengoTab = context.buildTreeTab({ job: "swordmaster", level: 45, team: null });
  assert.ok(!kengoTab.className.includes("tree-tab--crest"));
  assert.equal(byClass(kengoTab, "tree-web").length, 0);
  assert.equal(byClass(kengoTab, "crest-screen-head").length, 0);
  assert.equal(byClass(kengoTab, "tree-graph").length, 1);
  assert.equal(byClass(kengoTab, "tree-node").length, tree.nodes.length);
});

test("紋章盤: 正本17ノード・6方向の飾り札・中央の剣紋章・背景ガイドを描画", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  assert.equal(tree.nodes.length, 17);
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 }, "exclusive", tree, {});
  const buttons = byClass(root, "tree-web-node");
  assert.equal(buttons.length, 17);
  assert.deepEqual(Array.from(buttons, b => b.title).sort(), Array.from(tree.nodes, n => n.name).sort());
  assert.ok(buttons.every(b => b.attrs["aria-label"]), "読み上げ用ラベル");
  assert.deepEqual(byClass(root, "tree-web-lane").map(n => n.textContent), ["基礎", "猛攻", "破砕", "覇道", "鉄壁", "装備"]);
  assert.equal(byClass(root, "tree-web-core").length, 1);
  assert.equal(byClass(byClass(root, "tree-web-core")[0], "crest-emblem").length, 1, "剣紋章は画像でなくSVG");
  assert.equal(byClass(root, "tree-web-ring").length, 3, "同心円ガイド");
  assert.equal(byClass(root, "tree-web-spoke").length, 6, "放射線ガイド");
  assert.equal(byClass(root, "tree-web-tick").length, 72, "古金の外枠の目盛");
  assert.equal(byClass(root, "tree-web-runes").length, 1);
  assert.equal(byClass(root, "crest-banner").length, 1);
  assert.match(allText(byClass(root, "crest-banner")[0]), /せんし.*剛勇の心得/);
  // 位置は重ならない
  const pos = buttons.map(b => [parseFloat(b.style.left), parseFloat(b.style.top)]);
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      // 通常ノードは盤面幅の約8.4%、奥義は約11.4%で描くため、中心間の距離で重なりを判定
      const need = [buttons[i], buttons[j]].some(b => b.className.includes("ultimate-kind")) ? 9.9 : 9.2;
      assert.ok(Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) >= need, `${buttons[i].title}と${buttons[j].title}が近すぎる`);
    }
  }
});

test("ノードの形: パッシブ=円、アクティブ=菱形、奥義w12=八芒星、装備=宝石印章", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 }, "exclusive", tree, {});
  const shapeOf = name => byClass(root, "tree-web-node").find(b => b.title === name).className.match(/shape-(\w+)/)[1];
  assert.equal(shapeOf("鍛えた腕"), "circle");
  assert.equal(shapeOf("剣撃突き"), "diamond");
  assert.equal(shapeOf("鬨の声"), "diamond");
  assert.equal(shapeOf("剛勇覇斬"), "ultimate");
  assert.equal(shapeOf("装備の心得"), "gem");
  assert.equal(shapeOf("装備の極意"), "gem");
  assert.equal(byClass(root, "ultimate-kind").filter(b => b.className.includes("tree-web-node")).length, 1);
});

test("前提線は実データ通り: 16本、親ノードから子ノードへ。背景ガイドとは別クラス", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const ranks = { w1: 1, w2: 1, w3: 1 };
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 }, "exclusive", tree, ranks);
  const links = byClass(root, "tree-web-link");
  const expected = tree.nodes.reduce((n, v) => n + v.prerequisites.length, 0);
  assert.equal(expected, 16);
  assert.equal(links.length, expected);
  assert.equal(byClass(root, "tree-web-link-bed").length, expected);
  // 各前提の親→子の端点に一致する線が1本ずつある
  const btn = Object.fromEntries(byClass(root, "tree-web-node").map(b => [b.title, [parseFloat(b.style.left), parseFloat(b.style.top)]]));
  const nameOf = Object.fromEntries(tree.nodes.map(n => [n.id, n.name]));
  const ends = links.map(l => pathEnds(l.attrs.d));
  for (const node of tree.nodes) {
    for (const pre of node.prerequisites) {
      const from = btn[nameOf[pre.nodeId]], to = btn[node.name];
      const hit = ends.filter(e => Math.hypot(e.start[0] - from[0], e.start[1] - from[1]) < 0.05 &&
        Math.hypot(e.end[0] - to[0], e.end[1] - to[1]) < 0.05);
      assert.equal(hit.length, 1, `${pre.nodeId}→${node.id} の線`);
    }
  }
  // 習得済みルートは青白い線＋魔力の流れ、習得可能な先は金
  assert.equal(links.filter(l => l.className.includes("acquired")).length, 2, "w1→w2→w3");
  assert.ok(links.some(l => l.className.includes("ready")));
  assert.equal(byClass(root, "tree-web-link-flow").filter(l => l.className.includes("acquired")).length, 2);
  // ガイド線（同心円・放射線）は前提線クラスを持たない
  assert.ok(byClass(root, "tree-web-spoke").every(l => !l.className.includes("tree-web-link")));
});

test("状態表現: 習得済み・習得可能・未解放(Lv)・二択封印", () => {
  const { context } = renderContext({
    canAcquireNode: (c, _tree, ranks, node) => node.reqLevel <= c.level &&
      node.prerequisites.every(p => (ranks[p.nodeId] || 0) >= p.minRank) &&
      !(node.exclusiveGroup && data.EXCLUSIVE_TREES.warrior.nodes.some(o => o.id !== node.id &&
        o.exclusiveGroup === node.exclusiveGroup && (ranks[o.id] || 0) > 0)),
  });
  const tree = data.EXCLUSIVE_TREES.warrior;
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 25 }, "exclusive", tree,
    { w1: 1, w2: 1, w3: 1, w4b: 1 });
  const node = name => byClass(root, "tree-web-node").find(b => b.title === name);
  assert.ok(node("剣撃突き").className.includes("acquired"));
  assert.ok(node("鎧砕き").className.includes("available"));
  assert.ok(node("剛力").className.includes("level-locked"), "Lv30未満は封印石");
  assert.ok(node("不動の構え").className.includes("choice-sealed"), "二択の反対側は封印");
  assert.ok(!node("猛攻の構え").className.includes("choice-sealed"));
  assert.equal(byClass(root, "tree-web-core")[0].className.includes("lit"), true, "剣撃突きで紋章が灯る");
  const legend = byClass(root, "tree-web-key").map(allText);
  assert.deepEqual(legend, ["習得済み", "習得可能", "未解放", "封印"]);
});

test("ノード選択で詳細が出る / 拡大・縮小・全体表示・ピンチ・ドラッグ", () => {
  const { context, calls } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 }, "exclusive", tree, { w1: 1, w2: 1, w3: 1 });
  byClass(root, "tree-web-node").find(b => b.title === "剣撃突き").click();
  assert.deepEqual({ ...context.treeSelectedNode }, { scope: "exclusive", nodeId: "w3" });
  assert.equal(calls.rerenders, 1);

  const controls = byClass(root, "tree-web-control");
  assert.deepEqual(controls.map(b => b.attrs["aria-label"]), ["縮小", "拡大", "全体表示"]);
  const scene = byClass(root, "tree-web-scene")[0];
  const viewport = byClass(root, "tree-web-viewport")[0];
  assert.match(scene.style.transform, /scale\(0\.92\)/, "初期表示は92%");
  controls[0].click();
  assert.match(scene.style.transform, /translate\(0px, 0px\) scale\(0\.8\)/, "−で80%まで縮小できる");
  controls[0].click();
  assert.match(scene.style.transform, /scale\(0\.8\)/, "最小80%で止まる");
  assert.ok(!viewport.className.includes("is-zoomed"), "縮小時は縦スクロール可能");
  controls[1].click();
  assert.match(scene.style.transform, /scale\(0\.92\)/, "＋で元の大きさに戻せる");
  controls[1].click();
  assert.match(scene.style.transform, /scale\(1\.04\)/);
  assert.ok(viewport.className.includes("is-zoomed"), "1倍超の時だけドラッグを専有");
  controls[0].click();
  assert.match(scene.style.transform, /scale\(0\.92\)/);
  assert.ok(!viewport.className.includes("is-zoomed"));

  const touch = (x, y) => ({ clientX: x, clientY: y });
  // 等倍の1本指は縦スクロールに任せる（preventDefaultしない）
  let prevented = false;
  viewport.listeners.touchstart({ touches: [touch(100, 100)] });
  viewport.listeners.touchmove({ touches: [touch(100, 160)], cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  // ピンチで拡大
  viewport.listeners.touchstart({ touches: [touch(100, 100), touch(200, 100)] });
  viewport.listeners.touchmove({ touches: [touch(85, 100), touch(215, 100)], cancelable: true, preventDefault() {} });
  const pinchScale = Number(scene.style.transform.match(/scale\\(([^)]+)\\)/)[1]);
  assert.ok(Math.abs(pinchScale - 1.196) < 0.000001, "ピンチで元の92%から正しく1.3倍");
  // 拡大中の1本指ドラッグは盤面を動かす（移動量は範囲内に収める）
  const before = scene.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/).slice(1).map(Number);
  viewport.listeners.touchstart({ touches: [touch(100, 100)] });
  viewport.listeners.touchmove({ touches: [touch(95, 95)], cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const after = scene.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/).slice(1).map(Number);
  assert.deepEqual([after[0] - before[0], after[1] - before[1]], [-5, -5]);
  controls[2].click();
  assert.match(scene.style.transform, /translate\(0px, 0px\) scale\(0\.92\)/);
});

test("剣士の線は16本維持しながら補助線と光量を抑える（ほかの職業には影響しない）", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /\.tree-web-spoke-minor\s*\{[^}]*rgba\(110,185,200,\.035\)/);
  assert.match(css, /\.tree-web-link\.acquired\s*\{[^}]*stroke-width: 2\.05px/);
  assert.match(css, /\.tree-web-link-glow\s*\{[^}]*stroke-width: 4px/);
  assert.match(css, /\.tree-web-link-flow\.acquired\s*\{[^}]*opacity: \.42/);
  const { context } = renderContext();
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 },
    "exclusive", data.EXCLUSIVE_TREES.warrior, { w1: 1, w2: 1, w3: 1 });
  assert.equal(byClass(root, "tree-web-link").length, 16, "線の透明度だけ変更し全前提関係を残す");
});

test("縮小後にズームしてドラッグしても、全体表示で原点へ戻り、ピンチ縮小も80%で止まる", () => {
  const { context } = renderContext();
  const root = context.buildWarriorWebGraph({ job: "warrior", level: 99 },
    "exclusive", data.EXCLUSIVE_TREES.warrior, {});
  const scene = byClass(root, "tree-web-scene")[0];
  const controls = byClass(root, "tree-web-control");
  const viewport = byClass(root, "tree-web-viewport")[0];
  const touch = (x, y) => ({ clientX: x, clientY: y });
  viewport.listeners.touchstart({ touches: [touch(100, 100), touch(200, 100)] });
  viewport.listeners.touchmove({ touches: [touch(130, 100), touch(170, 100)], cancelable: true, preventDefault() {} });
  assert.match(scene.style.transform, /scale\(0\.8\)/);
  assert.match(scene.style.transform, /translate\(0px, 0px\)/, "縮小時は中央に固定");
  controls[1].click();
  controls[1].click();
  controls[1].click();
  assert.match(scene.style.transform, /scale\(1\.16\)/);
  viewport.listeners.touchstart({ touches: [touch(100, 100)] });
  viewport.listeners.touchmove({ touches: [touch(95, 95)], cancelable: true, preventDefault() {} });
  assert.ok(!scene.style.transform.startsWith("translate(0px, 0px)"));
  controls[2].click();
  assert.match(scene.style.transform, /translate\(0px, 0px\) scale\(0\.92\)/);
});

test("専用詳細パネル: アイコン・種別・必要SP/Lv・説明・フレーバー・大きな習得ボタン", () => {
  const { context, calls } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const node = tree.nodes.find(n => n.id === "w3");
  const ranks = { w1: 1, w2: 1 };
  const panel = context.buildTreeNodeDetail({ job: "warrior", level: 99, team: null }, tree, ranks, node, "剛勇の心得（固有）");
  assert.ok(panel.className.includes("warrior-crest-detail"));
  assert.equal(byClass(panel, "crest-detail-icon").length, 1);
  assert.equal(byClass(panel, "tree-node-detail-name")[0].textContent, "剣撃突き");
  const tags = byClass(panel, "crest-tag").map(t => t.textContent);
  assert.deepEqual(tags, ["アクティブ", "基礎", "習得可能"]);
  const facts = byClass(panel, "warrior-crest-facts")[0].children.map(n => n.textContent);
  assert.ok(facts.includes("必要SP 2"));
  assert.ok(facts.includes("必要Lv 1"));
  assert.ok(facts.includes("前提 戦いの勘"));
  assert.equal(byClass(panel, "tree-node-detail-desc")[0].textContent, node.desc);
  assert.match(byClass(panel, "crest-detail-flavor")[0].textContent, /^「.+」$/);
  const btn = byClass(panel, "crest-learn-btn")[0];
  assert.equal(btn.disabled, false);
  assert.match(allText(btn), /習得する/);
  btn.click();
  assert.deepEqual(calls.acquired, ["w3"], "既存の acquireNode をそのまま呼ぶ");
  assert.equal(ranks.w3, 1);
  assert.equal(calls.saved, 1);
  assert.equal(calls.rerenders, 1);

  // 二択の反対側・Lv不足は押せず、理由を表示（可否は canAcquireNode）
  const { context: ctx2 } = renderContext({ canAcquireNode: () => false });
  const sealed = ctx2.buildTreeNodeDetail({ job: "warrior", level: 99, team: null }, tree, { w4b: 1 },
    tree.nodes.find(n => n.id === "w4a"), "");
  const sealedBtn = byClass(sealed, "crest-learn-btn")[0];
  assert.equal(sealedBtn.disabled, true);
  assert.match(allText(sealedBtn), /猛攻の構え/);
  assert.ok(byClass(sealed, "warrior-crest-facts")[0].children.some(n => n.textContent === "二択 猛攻の構え"));
  const low = ctx2.buildTreeNodeDetail({ job: "warrior", level: 10, team: null }, tree, {},
    tree.nodes.find(n => n.id === "w12"), "");
  assert.match(allText(byClass(low, "crest-learn-btn")[0]), /Lv90で解放/);

  // 習得済みは状態表示のみ
  const done = context.buildTreeNodeDetail({ job: "warrior", level: 99 }, tree, { w3: 1 }, node, "");
  assert.equal(byClass(done, "crest-learn-btn").length, 0);
  assert.equal(byClass(done, "tree-node-detail-state")[0].textContent, "習得済み");
  assert.ok(byClass(done, "warrior-crest-facts")[0].children.some(n => n.textContent === "必要SP 2"));
});

test("けんごう・他職の詳細パネルは従来のまま", () => {
  const { context } = renderContext();
  const tree = data.EXCLUSIVE_TREES.warrior;
  const node = tree.nodes.find(n => n.id === "w3");
  const b = context.buildTreeNodeDetail({ job: "swordmaster", level: 99 }, tree, {}, node, "剛勇の心得（固有）");
  assert.equal(b.className, "tree-node-detail");
  assert.equal(byClass(b, "crest-detail-card").length, 0);
  const btn = descendants(b, n => n.tagName === "button" && n.className.includes("primary"))[0];
  assert.equal(btn.textContent, "習得する（SP2／残り98）");
});

test("見出しのSP表示とリセット札（せんしのみ）。振り直しは既存処理・確認手順のまま", () => {
  const { context, calls } = renderContext();
  const tab = context.buildTreeTab({ job: "warrior", level: 45, team: null });
  const sp = byClass(tab, "crest-sp")[0];
  assert.equal(byClass(sp, "crest-sp-value")[0].textContent, "43");
  assert.equal(byClass(sp, "crest-sp-total")[0].textContent, "/ 44");
  const reset = byClass(tab, "tree-swap-btn")[0];
  assert.ok(byClass(tab, "crest-screen-actions")[0].children.some(ch => ch.className.includes("crest-reset-row")));
  assert.match(allText(reset), /リセット.*強化石240/);
  reset.click();
  assert.equal(context.treeSwapConfirm, "reset", "1回目は確認待ち");
  const tab2 = context.buildTreeTab({ job: "warrior", level: 45, team: null });
  const confirmBtn = byClass(tab2, "tree-swap-btn")[0];
  assert.match(allText(confirmBtn), /本当に/);
  confirmBtn.click();
  assert.equal(calls.resets, 1);
  assert.equal(context.treeSwapConfirm, null);
});

test("描画のみの刷新: 剣士固有ツリーの正本（前提・排他・Lv・SP・効果）は変わらない", () => {
  const nodes = data.EXCLUSIVE_TREES.warrior.nodes;
  const shape = Object.fromEntries(nodes.map(n => [n.id, [
    n.kind, n.costByRank.join("/"), n.reqLevel, n.exclusiveGroup || "",
    n.prerequisites.map(p => p.nodeId + ":" + p.minRank).join(","),
  ]]));
  assert.deepEqual(shape, {
    w1: ["passive", "1", 1, "", ""],
    w2: ["passive", "1", 1, "", "w1:1"],
    w3: ["active", "2", 1, "", "w2:1"],
    w4a: ["passive", "2", 1, "w_style", "w3:1"],
    w4b: ["passive", "2", 1, "w_style", "w3:1"],
    w_acc1: ["passive", "3", 1, "", "w2:1"],
    w_acc2: ["passive", "5", 1, "", "w3:1"],
    w5: ["active", "3", 20, "", "w3:1"],
    w6: ["passive", "4", 30, "", "w5:1"],
    w7a: ["passive", "4", 40, "w_style2", "w6:1"],
    w7b: ["passive", "4", 40, "w_style2", "w6:1"],
    w8: ["active", "5", 50, "", "w6:1"],
    w9: ["passive", "5", 60, "", "w8:1"],
    w10a: ["passive", "6", 70, "w_style3", "w9:1"],
    w10b: ["passive", "6", 70, "w_style3", "w9:1"],
    w11: ["passive", "6", 80, "", "w9:1"],
    w12: ["active", "9", 90, "", "w11:1"],
  });
  assert.equal(nodes.find(n => n.id === "w12").ability.id, "tree_w12");
  assert.deepEqual(JSON.parse(JSON.stringify(nodes.find(n => n.id === "w1").effects)), [{ type: "statAdd", stat: "atk", value: 3 }]);
});

test("iPhone反映用のキャッシュ番号と、せんし限定CSS", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /css\/style\.css\?v=\d+/);
  assert.match(html, /js\/ui\/detail-tree\.js\?v=\d+/);
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce\)[^}]*tree-web-link-flow/);
  // 汎用ツリー・他職の共通クラス（.tree-node / .tree-graph / .tree-section）の既存定義は残す
  assert.match(css, /\n\.tree-node \{/);
  assert.match(css, /\n\.tree-graph \{/);
  assert.match(css, /\n\.tree-section \{/);
});


test("せんし専用画面: 横並び4タブの固有を開き、詳細パネルと習得ボタンを盤面下へ常時表示", () => {
  const tree = data.EXCLUSIVE_TREES.warrior;
  const slots = [
    { key: "g1", label: "汎用Ⅰ", candidates: ["first", "second"] },
    { key: "g2", label: "汎用Ⅱ", candidates: ["first", "second"] },
    { key: "g3", label: "汎用Ⅲ", candidates: ["first", "second"] },
  ];
  const generalTree = { ...tree, id: "generic", name: "汎用の心得" };
  const { context, calls } = renderContext({
    GENERAL_SLOTS: slots,
    getTreeState: () => ({
      exclusiveRanks: { w1: 1 }, general: {
        g1: { treeId: "first", ranks: {} }, g2: { treeId: "first", ranks: {} },
        g3: { treeId: "first", ranks: {} },
      },
    }),
    getGeneralTree: () => generalTree,
  });
  const first = context.buildTreeTab({ id: "hero1", name: "ガイ", job: "warrior", level: 99, team: null });
  assert.equal(byClass(first, "crest-focus-navigation").length, 1);
  assert.equal(byClass(first, "crest-focus-tabs").length, 1);
  assert.deepEqual(byClass(first, "crest-focus-tab").map(b => b.textContent), ["せんし", "汎用Ⅰ", "汎用Ⅱ", "汎用Ⅲ"]);
  assert.equal(byClass(first, "tree-web-node").length, 17);
  assert.equal(byClass(first, "tree-graph").length, 0, "汎用の縦リストを一度に出さない");
  assert.equal(byClass(first, "crest-inline-detail").length, 1);
  assert.equal(byClass(first, "warrior-crest-detail").length, 1, "未選択でも剣撃突きを初期表示");
  assert.equal(context.treeSelectedNode.nodeId, "w3");
  assert.equal(byClass(first, "crest-learn-btn").length, 1);

  byClass(first, "crest-focus-tab")[2].click();
  assert.equal(calls.rerenders, 1, "汎用タブの切替で再描画");
  const general = context.buildTreeTab({ id: "hero1", name: "ガイ", job: "warrior", level: 99, team: null });
  assert.equal(byClass(general, "tree-web").length, 0, "汎用タブは既存の分岐図");
  assert.equal(byClass(general, "tree-graph").length, 1);
  assert.equal(byClass(general, "crest-inline-detail").length, 1);
  assert.equal(byClass(general, "crest-focus-tab").filter(n => n.attrs["aria-selected"] === "true")[0].textContent, "汎用Ⅱ");

  byClass(general, "crest-focus-tab")[0].click();
  const restored = context.buildTreeTab({ id: "hero1", name: "ガイ", job: "warrior", level: 99, team: null });
  assert.equal(byClass(restored, "tree-web").length, 1);
  assert.equal(byClass(restored, "crest-inline-detail").length, 1);
  const other = context.buildTreeTab({ id: "hero2", name: "新人", job: "warrior", level: 99, team: null });
  assert.equal(byClass(other, "crest-focus-tab").filter(n => n.attrs["aria-selected"] === "true")[0].textContent, "せんし");
});

test("参考画像に沿った全高レイアウトはせんしのツリー画面に限定し、元画面への導線を残す", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  const detail = fs.readFileSync(path.join(__dirname, "../js/ui/detail.js"), "utf8");
  assert.match(detail, /detailTab === "tree" && c\.job === "warrior"/);
  assert.match(detail, /classList\.toggle\("warrior-crest-view", focus\)/);
  assert.match(css, /#screen-chardetail\.warrior-crest-view \.roster-header/);
  assert.match(css, /#screen-chardetail\.warrior-crest-view #detailTabs/);
  assert.match(css, /#screen-chardetail\.warrior-crest-view.*\.global-nav/);
  const { context, calls } = renderContext({ detailTab: "tree" });
  const first = context.buildTreeTab({ id: "hero1", name: "ガイ", job: "warrior", level: 99, team: null });
  const back = byClass(first, "crest-focus-back")[0];
  assert.equal(back.attrs["aria-label"], "仲間詳細に戻る");
  back.click();
  assert.equal(context.detailTab, "stats");
  assert.equal(calls.rerenders, 1);
});

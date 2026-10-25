// ---------- 画面: キャラ詳細: ツリータブ（分岐図） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- 詳細: ツリータブ（固有ツリー1本＋汎用ツリー3枠を分岐図で表示） ----------
function buildTreeTab(c) {
  const wrap = document.createElement("div");
  const exclusiveTree = getExclusiveTree(c);
  if (!exclusiveTree) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.textContent = "このジョブに対応するスキルツリーがありません";
    wrap.appendChild(none);
    return wrap;
  }
  const st = getTreeState(c);
  const total = totalSp(c);
  const spent = totalSpentSp(c);

  const head = document.createElement("div");
  head.className = "detail-section-head";
  head.innerHTML = `<span>スキルツリー</span><span class="count">SP ${total - spent}/${total}</span>`;
  wrap.appendChild(head);

  // 振り直し（4本ぶんのSPを全部戻す。費用は強化石）
  if (spent > 0) {
    const cost = treeResetCost(c);
    const confirming = treeSwapConfirm === "reset";
    const resetRow = document.createElement("div");
    resetRow.className = "tree-reset-row";
    const resetBtn = document.createElement("button");
    resetBtn.className = "tree-swap-btn" + (confirming ? " confirming" : "");
    resetBtn.textContent = confirming ? `本当に振り直す？（強化石${cost.toLocaleString()}）` : `↺ ツリーを振り直す（強化石${cost.toLocaleString()}）`;
    resetBtn.disabled = !canResetTree(c);
    resetBtn.addEventListener("click", () => {
      if (confirming) {
        if (!confirmReady()) return;
        resetTree(c);
        treeSwapConfirm = null;
        treeSelectedNode = null;
      } else {
        treeSwapConfirm = "reset";
        armConfirm();
      }
      scheduleSave();
      renderCharDetail();
    });
    resetRow.appendChild(resetBtn);
    if (!canResetTree(c) && (S.material || 0) < cost) {
      const note = document.createElement("span");
      note.className = "tree-reset-note";
      note.textContent = `強化石が足りません（${(S.material || 0).toLocaleString()}）`;
      resetRow.appendChild(note);
    }
    wrap.appendChild(resetRow);
  }

  wrap.appendChild(buildTreeSection(c, {
    scopeKey: "exclusive",
    title: `${exclusiveTree.name}（固有）`,
    treeDef: exclusiveTree,
    ranks: st.exclusiveRanks,
    slotDef: null,
  }));

  for (const slot of GENERAL_SLOTS) {
    const slotState = st.general[slot.key];
    const treeDef = getGeneralTree(slotState.treeId);
    wrap.appendChild(buildTreeSection(c, {
      scopeKey: slot.key,
      title: `${slot.label}: ${treeDef.name}`,
      treeDef,
      ranks: slotState.ranks,
      slotDef: slot,
    }));
  }
  return wrap;
}

// 1本ぶんのツリーを「見出し(＋交換ボタン)／分岐図／選択中ノードの詳細パネル」として組み立てる
function buildTreeSection(c, opts) {
  const { scopeKey, title, treeDef, ranks, slotDef } = opts;
  const locked = c.team !== null && isTeamLocked(c.team);
  const section = document.createElement("div");
  section.className = "tree-section";

  const headRow = document.createElement("div");
  headRow.className = "tree-section-head";
  const titleEl = document.createElement("span");
  titleEl.className = "tree-section-title";
  titleEl.textContent = title;
  headRow.appendChild(titleEl);

  if (slotDef) {
    const otherId = slotDef.candidates.find((id) => id !== treeDef.id) || slotDef.candidates[0];
    const otherName = getGeneralTree(otherId).name;
    const confirming = treeSwapConfirm === slotDef.key;
    const swapBtn = document.createElement("button");
    swapBtn.className = "tree-swap-btn" + (confirming ? " confirming" : "");
    swapBtn.textContent = confirming ? "本当に交換する？(SPリセット)" : `⇄ ${otherName}に交換`;
    swapBtn.disabled = locked;
    swapBtn.addEventListener("click", () => {
      if (confirming) {
        if (!confirmReady()) return;
        swapGeneralSlot(c, slotDef.key);
        treeSwapConfirm = null;
        treeSelectedNode = null;
      } else {
        treeSwapConfirm = slotDef.key;
        armConfirm();
      }
      scheduleSave();
      renderCharDetail();
    });
    headRow.appendChild(swapBtn);
  }
  section.appendChild(headRow);

  // 剣士系の固有ツリーのみ新しい蜘蛛の巣型。汎用3枠や他職は既存レイアウトを保持する。
  const warriorWeb = isWarriorCrestWeb(c, scopeKey, treeDef);
  if (warriorWeb) {
    section.classList.add("warrior-crest-section");
    const intro = document.createElement("div");
    intro.className = "tree-web-intro";
    const job = document.createElement("span");
    job.className = "tree-web-intro-job";
    job.textContent = "せんし　/　WARRIOR";
    const subtitle = document.createElement("span");
    subtitle.className = "tree-web-intro-sub";
    subtitle.textContent = "剛勇の心得 ― 力を刻む紋章";
    intro.appendChild(job);
    intro.appendChild(subtitle);
    section.appendChild(intro);
  }
  section.appendChild(warriorWeb ? buildWarriorWebGraph(c, scopeKey, treeDef, ranks) : buildTreeGraph(c, scopeKey, treeDef, ranks));

  // 選んだマスの詳細は、スクロールしなくても押せるように画面の下（タブの上）に固定して出す
  if (treeSelectedNode && treeSelectedNode.scope === scopeKey) {
    const selNode = treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
    const sheet = document.getElementById("detailSheet");
    if (selNode && sheet) {
      sheet.appendChild(buildTreeNodeDetail(c, treeDef, ranks, selNode, title));
      sheet.classList.remove("hidden");
    } else treeSelectedNode = null;
  }
  return section;
}

// ノードを段（row）と横位置（x）で配置し、前提関係をSVGの線で結ぶ「本当の分岐図」を描画する。
// 左端に、段が開くレベル（reqLevel）を表示する
const TREE_ROW_PX = 54;
function nodeY(node, rows) { return ((node.row + 0.5) / rows) * 100; }
function buildTreeGraph(c, scopeKey, treeDef, ranks) {
  const graph = document.createElement("div");
  graph.className = "tree-graph";
  const rows = Math.max(...treeDef.nodes.map((n) => n.row)) + 1;
  graph.style.height = rows * TREE_ROW_PX + "px";
  // 段のレベル（同じ段の最初のマスのreqLevel。Lv1の段は出さない）
  const shownRows = new Set();
  for (const node of treeDef.nodes) {
    if (shownRows.has(node.row) || !(node.reqLevel > 1)) continue;
    shownRows.add(node.row);
    const lv = document.createElement("div");
    lv.className = "tree-row-level" + (c.level >= node.reqLevel ? " open" : "");
    lv.style.top = nodeY(node, rows) + "%";
    lv.textContent = `Lv${node.reqLevel}`;
    graph.appendChild(lv);
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("tree-graph-lines");
  const byId = {};
  for (const node of treeDef.nodes) byId[node.id] = node;
  for (const node of treeDef.nodes) {
    for (const pre of node.prerequisites) {
      const from = byId[pre.nodeId];
      if (!from) continue;
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", nodeY(from, rows));
      line.setAttribute("x2", node.x);
      line.setAttribute("y2", nodeY(node, rows));
      const acquired = (ranks[node.id] || 0) > 0 && (ranks[from.id] || 0) > 0;
      line.setAttribute("class", acquired ? "tree-edge acquired" : "tree-edge");
      svg.appendChild(line);
    }
  }
  graph.appendChild(svg);

  for (const node of treeDef.nodes) {
    const acquired = (ranks[node.id] || 0) > 0;
    const canGet = canAcquireNode(c, treeDef, ranks, node);
    const levelLocked = node.reqLevel > c.level;
    const btn = document.createElement("button");
    btn.className = "tree-node" + (node.kind === "active" ? " active-kind" : " passive-kind")
      + (acquired ? " acquired" : canGet ? " available" : " locked") + (levelLocked ? " level-locked" : "")
      + (treeSelectedNode && treeSelectedNode.scope === scopeKey && treeSelectedNode.nodeId === node.id ? " selected" : "");
    btn.style.left = node.x + "%";
    btn.style.top = nodeY(node, rows) + "%";
    btn.textContent = levelLocked ? "🔒" : node.kind === "active" ? "⚔️" : "🔹";
    btn.setAttribute("aria-label", node.name);
    btn.addEventListener("click", () => {
      treeSelectedNode = { scope: scopeKey, nodeId: node.id };
      treeSwapConfirm = null;
      renderCharDetail();
    });
    graph.appendChild(btn);

    const label = document.createElement("div");
    label.className = "tree-node-label";
    label.style.left = node.x + "%";
    label.style.top = nodeY(node, rows) + "%";
    label.textContent = node.name;
    graph.appendChild(label);
  }
  return graph;
}

// せんし専用の装飾。けんごうはツリーを共有するが従来レイアウトを維持する。
function isWarriorCrestWeb(c, scopeKey, treeDef) {
  return c.job === "warrior" && scopeKey === "exclusive" &&
    treeDef.id === "warrior" && treeDef.nodes.every((node) => WARRIOR_WEB_LAYOUT[node.id]);
}
// ノード描画座標だけを定義する。
// ID・前提・必要SP・排他・Lv・効果はすべてEXCLUSIVE_TREESの正本を使う。
// 6方向×3リング。装備の枝は2段、その他は3段。新ノード追加時は既存分岐図にフォールバック。
const WARRIOR_WEB_LAYOUT = {
  w1: [0, 0, "腕"], w2: [0, 1, "勘"], w3: [0, 2, "剣"],
  w4b: [1, 0, "猛"], w7b: [1, 1, "豪"], w10b: [1, 2, "覇"],
  w5: [2, 0, "鎧"], w6: [2, 1, "力"], w11: [2, 2, "頂"],
  w8: [3, 0, "鬨"], w9: [3, 1, "歴"], w12: [3, 2, "奥"],
  w4a: [4, 0, "守"], w7a: [4, 1, "鉄"], w10a: [4, 2, "闘"],
  w_acc1: [5, 0, "装"], w_acc2: [5, 1, "極"],
};
// 表示範囲の平行移動・ズームはセーブ対象にしない（詳細画面の再描画で視点だけ保持）。
const warriorWebView = { scale: 1, x: 0, y: 0 };
function warriorWebPoint(lane, ring) {
  const angle = (-90 + lane * 60) * Math.PI / 180;
  const radius = [16, 29, 42][ring];
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
}
function buildWarriorWebGraph(c, scopeKey, treeDef, ranks) {
  const wrap = document.createElement("div");
  wrap.className = "tree-web tree-web--crest";
  const toolbar = document.createElement("div");
  toolbar.className = "tree-web-toolbar";
  const info = document.createElement("span");
  info.textContent = "✦  剛勇の刻印  ✦";
  toolbar.appendChild(info);
  const controls = document.createElement("div");
  controls.className = "tree-web-controls";
  toolbar.appendChild(controls);
  wrap.appendChild(toolbar);

  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport";
  viewport.setAttribute("aria-label", "剣士の蜘蛛の巣型スキルツリー。ピンチで拡大、指で移動");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene";
  viewport.appendChild(scene);
  wrap.appendChild(viewport);

  const applyView = () => {
    const width = viewport.clientWidth || 320;
    const height = viewport.clientHeight || width;
    const maxX = (warriorWebView.scale - 1) * width / 2;
    const maxY = (warriorWebView.scale - 1) * height / 2;
    warriorWebView.x = Math.max(-maxX, Math.min(maxX, warriorWebView.x));
    warriorWebView.y = Math.max(-maxY, Math.min(maxY, warriorWebView.y));
    scene.style.transform = "translate(" + warriorWebView.x + "px, " +
      warriorWebView.y + "px) scale(" + warriorWebView.scale + ")";
  };
  const changeScale = (value) => {
    warriorWebView.scale = Math.max(1, Math.min(2.5, value));
    applyView();
  };
  for (const [label, action, hint] of [
    ["−", () => changeScale(warriorWebView.scale - 0.25), "縮小"],
    ["＋", () => changeScale(warriorWebView.scale + 0.25), "拡大"],
    ["全体", () => { warriorWebView.scale = 1; warriorWebView.x = warriorWebView.y = 0; applyView(); }, "全体表示"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-web-control";
    button.textContent = label;
    button.setAttribute("aria-label", hint);
    button.addEventListener("click", action);
    controls.appendChild(button);
  }

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("tree-web-lines");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  const addSvg = (tag, attrs, parent) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    parent.appendChild(el);
    return el;
  };
  // 六角の環と放射線で蜘蛛の巣を表現。取得条件として扱うのは下の実データの前提線だけ。
  for (let ring = 0; ring < 3; ring++) {
    const points = Array.from({ length: 6 }, (_, lane) => {
      const p = warriorWebPoint(lane, ring);
      return p.x + "," + p.y;
    }).join(" ");
    addSvg("polygon", { points, class: "tree-web-ring" }, svg);
  }
  for (let lane = 0; lane < 6; lane++) {
    const p = warriorWebPoint(lane, 2);
    addSvg("line", { x1: 50, y1: 50, x2: p.x, y2: p.y, class: "tree-web-spoke" }, svg);
  }
  const byId = Object.fromEntries(treeDef.nodes.map((node) => [node.id, node]));
  for (const node of treeDef.nodes) {
    const [lane, ring] = WARRIOR_WEB_LAYOUT[node.id];
    const to = warriorWebPoint(lane, ring);
    for (const pre of node.prerequisites) {
      if (!byId[pre.nodeId]) continue;
      const [preLane, preRing] = WARRIOR_WEB_LAYOUT[pre.nodeId];
      const from = warriorWebPoint(preLane, preRing);
      const acquired = (ranks[node.id] || 0) >= pre.minRank &&
        (ranks[pre.nodeId] || 0) >= pre.minRank;
      addSvg("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        class: acquired ? "tree-web-link acquired" : "tree-web-link" }, svg);
    }
  }
  scene.appendChild(svg);
  const core = document.createElement("div");
  core.className = "tree-web-core";
  core.textContent = "⚔";
  core.setAttribute("aria-label", "せんし・中心");
  scene.appendChild(core);
  const laneNames = ["基礎", "猛攻", "破砕", "覇道", "鉄壁", "装備"];
  for (let i = 0; i < laneNames.length; i++) {
    const p = warriorWebPoint(i, 2);
    const label = document.createElement("span");
    label.className = "tree-web-lane tree-web-lane--" + i;
    label.style.left = 50 + (p.x - 50) * 1.12 + "%";
    label.style.top = 50 + (p.y - 50) * 1.12 + "%";
    label.textContent = laneNames[i];
    scene.appendChild(label);
  }
  for (const node of treeDef.nodes) {
    const [lane, ring, mark] = WARRIOR_WEB_LAYOUT[node.id];
    const p = warriorWebPoint(lane, ring);
    const acquired = (ranks[node.id] || 0) > 0;
    const canGet = canAcquireNode(c, treeDef, ranks, node);
    const levelLocked = node.reqLevel > c.level;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-web-node" + (node.kind === "active" ? " active-kind" : " passive-kind")
      + (acquired ? " acquired" : canGet ? " available" : " locked")
      + (levelLocked ? " level-locked" : "")
      + (treeSelectedNode && treeSelectedNode.scope === scopeKey &&
        treeSelectedNode.nodeId === node.id ? " selected" : "");
    btn.style.left = p.x + "%";
    btn.style.top = p.y + "%";
    btn.textContent = levelLocked ? "🔒" : mark;
    btn.title = node.name;
    btn.setAttribute("aria-label", node.name + "、必要Lv" + node.reqLevel);
    btn.setAttribute("aria-pressed", String(!!(treeSelectedNode &&
      treeSelectedNode.scope === scopeKey && treeSelectedNode.nodeId === node.id)));
    btn.addEventListener("click", () => {
      treeSelectedNode = { scope: scopeKey, nodeId: node.id };
      treeSwapConfirm = null;
      renderCharDetail();
    });
    scene.appendChild(btn);
  }
  const legend = document.createElement("div");
  legend.className = "tree-web-legend";
  legend.textContent = "● 習得済み　● 習得可能　● 未解放・条件不足";
  wrap.appendChild(legend);

  // iOS Safari: touch-action:none上の移動を自前で処理。タップはブラウザ標準clickのまま。
  let gesture = null;
  const touchPoint = (touch) => ({ x: touch.clientX, y: touch.clientY });
  const touchDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const startGesture = (touches) => {
    if (!touches.length) { gesture = null; return; }
    const a = touchPoint(touches[0]);
    if (touches.length === 1) {
      gesture = { mode: "pan", start: a, x: warriorWebView.x, y: warriorWebView.y };
    } else {
      const b = touchPoint(touches[1]);
      gesture = { mode: "pinch", start: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        distance: Math.max(1, touchDistance(a, b)), scale: warriorWebView.scale,
        x: warriorWebView.x, y: warriorWebView.y };
    }
  };
  viewport.addEventListener("touchstart", (event) => startGesture(event.touches), { passive: true });
  viewport.addEventListener("touchmove", (event) => {
    if (!gesture || !event.touches.length) return;
    const a = touchPoint(event.touches[0]);
    const pinch = event.touches.length > 1;
    if ((pinch && gesture.mode !== "pinch") || (!pinch && gesture.mode !== "pan")) {
      startGesture(event.touches); return;
    }
    if (event.cancelable) event.preventDefault();
    if (!pinch) {
      warriorWebView.x = gesture.x + a.x - gesture.start.x;
      warriorWebView.y = gesture.y + a.y - gesture.start.y;
    } else {
      const b = touchPoint(event.touches[1]);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = viewport.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const scale = Math.max(1, Math.min(2.5,
        gesture.scale * touchDistance(a, b) / gesture.distance));
      const factor = scale / gesture.scale;
      warriorWebView.x = midpoint.x - cx - (gesture.start.x - cx - gesture.x) * factor;
      warriorWebView.y = midpoint.y - cy - (gesture.start.y - cy - gesture.y) * factor;
      warriorWebView.scale = scale;
    }
    applyView();
  }, { passive: false });
  viewport.addEventListener("touchend", (event) => startGesture(event.touches));
  viewport.addEventListener("touchcancel", () => { gesture = null; });

  // PC・トラックパッド検証時は空白をドラッグして視点を移動する。
  let mouse = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.button !== 0 ||
        (event.target.closest && event.target.closest(".tree-web-node"))) return;
    mouse = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: warriorWebView.x, top: warriorWebView.y };
    if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!mouse || mouse.id !== event.pointerId) return;
    warriorWebView.x = mouse.left + event.clientX - mouse.x;
    warriorWebView.y = mouse.top + event.clientY - mouse.y;
    applyView();
  });
  const endMouse = () => { mouse = null; };
  viewport.addEventListener("pointerup", endMouse);
  viewport.addEventListener("pointercancel", endMouse);
  applyView();
  return wrap;
}

// 選択中ノードの詳細（説明・コスト・習得状況・習得ボタン）を分岐図の下に表示する
function buildTreeNodeDetail(c, treeDef, ranks, node, treeTitle) {
  const panel = document.createElement("div");
  const isWarrior = c.job === "warrior" && treeDef.id === "warrior";
  panel.className = "tree-node-detail" + (isWarrior ? " warrior-crest-detail" : "");
  const rank = ranks[node.id] || 0;
  const acquired = rank > 0;

  const head = document.createElement("div");
  head.className = "tree-node-detail-head";
  const name = document.createElement("div");
  name.className = "tree-node-detail-name";
  name.textContent = node.name;
  if (treeTitle) {
    const from = document.createElement("span");
    from.className = "tree-node-detail-from";
    from.textContent = treeTitle;
    name.appendChild(from);
  }
  head.appendChild(name);
  const close = document.createElement("button");
  close.className = "tree-node-detail-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => { treeSelectedNode = null; renderCharDetail(); });
  head.appendChild(close);
  panel.appendChild(head);

  const desc = document.createElement("div");
  desc.className = "tree-node-detail-desc";
  desc.textContent = node.desc || "";
  panel.appendChild(desc);
  if (isWarrior) {
    const facts = document.createElement("div");
    facts.className = "warrior-crest-facts";
    const prereqs = (node.prerequisites || []).map((pre) => {
      const parent = treeDef.nodes.find((other) => other.id === pre.nodeId);
      return parent ? parent.name : pre.nodeId;
    });
    for (const text of [
      node.kind === "active" ? "⚔ アクティブ" : "✦ パッシブ",
      "必要SP " + (acquired ? "習得済" : node.costByRank[rank]),
      "必要Lv " + node.reqLevel,
      "前提 " + (prereqs.length ? prereqs.join("・") : "なし"),
    ]) {
      const chip = document.createElement("span");
      chip.textContent = text;
      facts.appendChild(chip);
    }
    panel.appendChild(facts);
  }
  if (!acquired && node.reqLevel > c.level) {
    const lock = document.createElement("div");
    lock.className = "tree-node-detail-lock";
    lock.textContent = `🔒 ジョブのLv${node.reqLevel}で解放（今はLv${c.level}）`;
    panel.appendChild(lock);
  }

  if (acquired) {
    const state = document.createElement("div");
    state.className = "tree-node-detail-state";
    state.textContent = "習得済み";
    panel.appendChild(state);
  } else {
    const canGet = canAcquireNode(c, treeDef, ranks, node);
    const btn = document.createElement("button");
    btn.className = "btn primary small";
    btn.textContent = `習得する（SP${node.costByRank[rank]}／残り${availableSp(c)}）`;
    btn.disabled = !canGet;
    btn.addEventListener("click", () => {
      acquireNode(c, treeDef, ranks, node);
      scheduleSave();
      renderCharDetail();
    });
    panel.appendChild(btn);
  }
  return panel;
}

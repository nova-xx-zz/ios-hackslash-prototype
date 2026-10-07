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

  section.appendChild(buildTreeGraph(c, scopeKey, treeDef, ranks));

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

// 選択中ノードの詳細（説明・コスト・習得状況・習得ボタン）を分岐図の下に表示する
function buildTreeNodeDetail(c, treeDef, ranks, node, treeTitle) {
  const panel = document.createElement("div");
  panel.className = "tree-node-detail";
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

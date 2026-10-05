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
        swapGeneralSlot(c, slotDef.key);
        treeSwapConfirm = null;
        treeSelectedNode = null;
      } else {
        treeSwapConfirm = slotDef.key;
      }
      scheduleSave();
      renderCharDetail();
    });
    headRow.appendChild(swapBtn);
  }
  section.appendChild(headRow);

  section.appendChild(buildTreeGraph(c, scopeKey, treeDef, ranks));

  if (treeSelectedNode && treeSelectedNode.scope === scopeKey) {
    const selNode = treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
    if (selNode) section.appendChild(buildTreeNodeDetail(c, treeDef, ranks, selNode));
    else treeSelectedNode = null;
  }
  return section;
}

// ノードをx/y座標で配置し、前提関係をSVGの線で結ぶ「本当の分岐図」を描画する
function buildTreeGraph(c, scopeKey, treeDef, ranks) {
  const graph = document.createElement("div");
  graph.className = "tree-graph " + (treeDef.nodes.length >= 5 ? "tree-graph-tall" : "tree-graph-short");

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
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", node.x);
      line.setAttribute("y2", node.y);
      const acquired = (ranks[node.id] || 0) > 0 && (ranks[from.id] || 0) > 0;
      line.setAttribute("class", acquired ? "tree-edge acquired" : "tree-edge");
      svg.appendChild(line);
    }
  }
  graph.appendChild(svg);

  for (const node of treeDef.nodes) {
    const acquired = (ranks[node.id] || 0) > 0;
    const canGet = canAcquireNode(c, treeDef, ranks, node);
    const btn = document.createElement("button");
    btn.className = "tree-node" + (node.kind === "active" ? " active-kind" : " passive-kind")
      + (acquired ? " acquired" : canGet ? " available" : " locked")
      + (treeSelectedNode && treeSelectedNode.scope === scopeKey && treeSelectedNode.nodeId === node.id ? " selected" : "");
    btn.style.left = node.x + "%";
    btn.style.top = node.y + "%";
    btn.textContent = node.kind === "active" ? "⚔️" : "🔹";
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
    label.style.top = node.y + "%";
    label.textContent = node.name;
    graph.appendChild(label);
  }
  return graph;
}

// 選択中ノードの詳細（説明・コスト・習得状況・習得ボタン）を分岐図の下に表示する
function buildTreeNodeDetail(c, treeDef, ranks, node) {
  const panel = document.createElement("div");
  panel.className = "tree-node-detail";
  const rank = ranks[node.id] || 0;
  const acquired = rank > 0;

  const name = document.createElement("div");
  name.className = "tree-node-detail-name";
  name.textContent = node.name;
  panel.appendChild(name);

  const desc = document.createElement("div");
  desc.className = "tree-node-detail-desc";
  desc.textContent = node.desc || "";
  panel.appendChild(desc);

  if (acquired) {
    const state = document.createElement("div");
    state.className = "tree-node-detail-state";
    state.textContent = "習得済み";
    panel.appendChild(state);
  } else {
    const canGet = canAcquireNode(c, treeDef, ranks, node);
    const btn = document.createElement("button");
    btn.className = "btn primary small";
    btn.textContent = `習得する (SP${node.costByRank[rank]})`;
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

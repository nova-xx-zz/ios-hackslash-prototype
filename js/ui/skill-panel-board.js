// 剣士固有ツリー用：密集した六角形ライセンス盤の試作。
// 既存ノード17個と習得ロジックはそのまま、空き27マスは装飾用（習得不可）。
"use strict";

// 参考の盤面のように各段5/6/7/8/7/6/5マスを敷き詰める。
// 個別スキルは row/column だけを持ち、全て同じ座標式で描く。
const WARRIOR_HEX_ROW_COUNTS = Object.freeze([5, 6, 7, 8, 7, 6, 5]);
const WARRIOR_HEX_PANEL_GRID = Object.freeze({
  w1: [6, 2],
  w2: [5, 2],
  w_acc1: [5, 1],
  w3: [4, 3],
  w_acc2: [4, 5],
  w4a: [3, 4],
  w4b: [3, 2],
  w5: [3, 3],
  w6: [2, 3],
  w7a: [2, 1],
  w7b: [2, 5],
  w8: [2, 4],
  w9: [1, 3],
  w10a: [1, 1],
  w10b: [1, 4],
  w11: [0, 2],
  w12: [0, 3],
});

// %単位の正方形座標。幅14%×高さ16.4%の六角形を12%間隔で隙間なく並べる。
function warriorHexGridPoint(row, column) {
  const count = WARRIOR_HEX_ROW_COUNTS[row];
  return { x: 50 + (column - (count - 1) / 2) * 12, y: 14 + row * 12 };
}

// 既存パネルとの比較用に、テストが使用できる座標マップも公開する。
const WARRIOR_HEX_PANEL_POSITIONS = Object.freeze(Object.fromEntries(
  Object.entries(WARRIOR_HEX_PANEL_GRID).map(([id, [row, column]]) => {
    const point = warriorHexGridPoint(row, column);
    return [id, [point.x, point.y]];
  })
));

function warriorHexTone(node) {
  if (node.id.startsWith("w_acc")) return "violet";
  if (["w4a", "w7a", "w9"].includes(node.id)) return "blue";
  if (["w1", "w2", "w8", "w10a"].includes(node.id)) return "green";
  if (["w5", "w6", "w7b", "w4b", "w10b", "w11", "w12", "w3"].includes(node.id)) return "red";
  return "cyan";
}

function buildWarriorSkillPanelBoard(c, scopeKey, treeDef, ranks) {
  if (!treeDef.nodes.every((node) => WARRIOR_HEX_PANEL_GRID[node.id])) {
    return buildWarriorWebGraph(c, scopeKey, treeDef, ranks);
  }
  const wrap = document.createElement("div");
  wrap.className = "tree-web tree-web--crest hex-panel-board";
  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport hex-panel-viewport";
  viewport.setAttribute("aria-label", "剣士の六角形スキルパネル。スキルアイコンを選択すると下部に説明が表示されます");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene hex-panel-scene";
  viewport.appendChild(scene);
  wrap.appendChild(viewport);

  const choices = treeChoiceInfo(treeDef, ranks);
  const selectedId = treeSelectedNode && treeSelectedNode.scope === scopeKey
    ? treeSelectedNode.nodeId : null;
  const byId = Object.fromEntries(treeDef.nodes.map((node) => [node.id, node]));
  const realSlots = new Map(treeDef.nodes.map((node) => {
    const [row, col] = WARRIOR_HEX_PANEL_GRID[node.id];
    return [row + ":" + col, node];
  }));
  const selectedNode = byId[selectedId];
  const prerequisites = new Set((selectedNode ? selectedNode.prerequisites : []).map((pre) => pre.nodeId));
  const successors = new Set(treeDef.nodes.filter((node) =>
    (node.prerequisites || []).some((pre) => pre.nodeId === selectedId)).map((node) => node.id));

  // 光の筋は本当の前提関係のみ。遠く離れたパネル同士は誤解を避けて描画しない。
  const ns = "http://www.w3.org/2000/svg";
  const paths = document.createElementNS(ns, "svg");
  paths.classList.add("hex-panel-links");
  paths.setAttribute("viewBox", "0 0 100 100");
  paths.setAttribute("preserveAspectRatio", "none");
  paths.setAttribute("aria-hidden", "true");
  for (const node of treeDef.nodes) {
    for (const pre of node.prerequisites || []) {
      const parent = byId[pre.nodeId];
      if (!parent) continue;
      const a = WARRIOR_HEX_PANEL_POSITIONS[parent.id];
      const b = WARRIOR_HEX_PANEL_POSITIONS[node.id];
      const dx = b[0] - a[0], dy = b[1] - a[1], distance = Math.hypot(dx, dy);
      if (distance > 21.5 || distance < 0.01) continue;
      const parentReady = (ranks[parent.id] || 0) >= pre.minRank;
      const finished = parentReady && (ranks[node.id] || 0) > 0;
      const available = parentReady && canAcquireNode(c, treeDef, ranks, node);
      if (!finished && !available) continue;
      const trim = Math.min(6.3, distance * .42);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", (a[0] + dx * trim / distance).toFixed(2));
      line.setAttribute("y1", (a[1] + dy * trim / distance).toFixed(2));
      line.setAttribute("x2", (b[0] - dx * trim / distance).toFixed(2));
      line.setAttribute("y2", (b[1] - dy * trim / distance).toFixed(2));
      line.setAttribute("class", "hex-panel-link " + (finished ? "completed" : "ready") +
        " tone-" + warriorHexTone(node));
      paths.appendChild(line);
    }
  }
  scene.appendChild(paths);

  for (let row = 0; row < WARRIOR_HEX_ROW_COUNTS.length; row++) {
    for (let col = 0; col < WARRIOR_HEX_ROW_COUNTS[row]; col++) {
      const point = warriorHexGridPoint(row, col);
      const node = realSlots.get(row + ":" + col);
      if (!node) {
        // ダミーのスキルではない。ロックの装飾タイルとしてのみ表示する。
        const tile = document.createElement("div");
        tile.className = "hex-panel-placeholder";
        tile.style.left = point.x + "%";
        tile.style.top = point.y + "%";
        tile.setAttribute("aria-hidden", "true");
        const shell = document.createElement("span");
        shell.className = "hex-panel-shell";
        const inner = document.createElement("span");
        inner.className = "hex-panel-inner";
        inner.appendChild(createWarriorCrestGlyph("lock"));
        shell.appendChild(inner);
        tile.appendChild(shell);
        scene.appendChild(tile);
        continue;
      }

      const rank = ranks[node.id] || 0;
      const acquired = rank > 0;
      const canGet = !acquired && canAcquireNode(c, treeDef, ranks, node);
      const choice = choices.byNode[node.id];
      const sealed = !acquired && !!node.exclusiveGroup &&
        treeDef.nodes.some((other) => other.id !== node.id &&
          other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0);
      const levelLocked = !acquired && node.reqLevel > c.level;
      const selected = node.id === selectedId;
      const glyphInfo = WARRIOR_WEB_LAYOUT[node.id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hex-panel-node tone-" + warriorHexTone(node) +
        (acquired ? " acquired" : canGet ? " available" : " locked") +
        (sealed ? " choice-sealed" : "") +
        (levelLocked ? " level-locked" : "") +
        (selected ? " selected" : "") +
        (prerequisites.has(node.id) ? " prerequisite" : "") +
        (successors.has(node.id) ? " successor" : "") +
        (node.kind === "active" ? " active-kind" : " passive-kind") +
        (node.id === "w12" ? " ultimate-kind" : "");
      button.style.left = point.x + "%";
      button.style.top = point.y + "%";
      button.title = node.name;
      const status = acquired ? "習得済み" : sealed ? "二択で封印中" :
        levelLocked ? "Lv" + node.reqLevel + "で解放" : canGet ? "習得可能" : "未解放";
      const need = (node.prerequisites || []).map((pre) => {
        const parent = byId[pre.nodeId];
        return parent ? parent.name : pre.nodeId;
      });
      button.setAttribute("aria-label", node.name + "、" + status +
        "、必要Lv" + node.reqLevel + (need.length ? "、前提：" + need.join("・") : "") +
        (choice ? "、" + treeChoiceAriaText(choice) : ""));
      button.setAttribute("aria-pressed", String(selected));

      const shell = document.createElement("span");
      shell.className = "hex-panel-shell";
      shell.setAttribute("aria-hidden", "true");
      const inner = document.createElement("span");
      inner.className = "hex-panel-inner";
      const medallion = document.createElement("span");
      medallion.className = "hex-panel-medallion";
      medallion.appendChild(sealed || levelLocked || typeof createUnifiedSkillGlyph !== "function"
        ? createWarriorCrestGlyph(sealed ? "seal" : levelLocked ? "lock" : glyphInfo.glyph)
        : createUnifiedSkillGlyph(node));
      inner.appendChild(medallion);
      shell.appendChild(inner);
      button.appendChild(shell);
      if (choice) {
        const chip = document.createElement("span");
        chip.className = "hex-panel-choice";
        chip.textContent = choice.group.label;
        chip.setAttribute("aria-hidden", "true");
        button.appendChild(chip);
      }
      button.addEventListener("click", () => {
        treeSelectedNode = { scope: scopeKey, nodeId: node.id };
        treeSwapConfirm = null;
        renderCharDetail();
      });
      scene.appendChild(button);
    }
  }
  const legend = document.createElement("div");
  legend.className = "hex-panel-legend";
  legend.textContent = "金:習得済 / 青:習得可 / 灰:未解放 / 赤:封印。鍵は装飾用の未設定マス";
  wrap.appendChild(legend);
  const controls = document.createElement("div");
  controls.className = "tree-web-controls";
  wrap.appendChild(controls);
  attachWarriorWebZoom(viewport, scene, controls);
  return wrap;
}

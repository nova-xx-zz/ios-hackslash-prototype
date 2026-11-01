// 剣士・固有ツリーだけで試す六角形スキルパネル。
// 正本（ノードID / prerequisites / exclusiveGroup / SP / 効果）を変更しない。
// detail-tree.js の後で読み込む。既存の習得・詳細・ズーム処理を再利用する。
"use strict";

const WARRIOR_HEX_PANEL_POSITIONS = Object.freeze({
  // 中心から上へ成長する蜂の巣状の配置。座標は正方形盤面の中心位置（%）。
  w1: [42, 89],
  w2: [49, 76],
  w_acc1: [21, 76],
  w3: [42, 63],
  w_acc2: [70, 63],
  w4a: [21, 50],
  w5: [49, 50],
  w4b: [77, 50],
  w7a: [28, 37],
  w6: [42, 37],
  w7b: [56, 37],
  w8: [35, 24],
  w9: [49, 24],
  w10a: [63, 24],
  w10b: [77, 24],
  w11: [35, 11],
  w12: [49, 11],
});

function buildWarriorSkillPanelBoard(c, scopeKey, treeDef, ranks) {
  // 未対応データが追加された場合も、勝手にパネルを欠落させず従来盤面へ戻す。
  if (!treeDef.nodes.every((node) => WARRIOR_HEX_PANEL_POSITIONS[node.id])) {
    return buildWarriorWebGraph(c, scopeKey, treeDef, ranks);
  }

  const wrap = document.createElement("div");
  wrap.className = "tree-web tree-web--crest hex-panel-board";
  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport hex-panel-viewport";
  viewport.setAttribute("aria-label", "剣士の六角形スキルパネル。パネル選択で下部に詳細を表示。ピンチで拡大できます");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene hex-panel-scene";
  viewport.appendChild(scene);
  wrap.appendChild(viewport);

  const choices = treeChoiceInfo(treeDef, ranks);
  const selectedId = treeSelectedNode && treeSelectedNode.scope === scopeKey
    ? treeSelectedNode.nodeId : null;
  const byId = Object.fromEntries(treeDef.nodes.map((node) => [node.id, node]));
  const selectedNode = byId[selectedId];
  const prerequisites = new Set((selectedNode ? selectedNode.prerequisites : []).map((pre) => pre.nodeId));
  const successors = new Set(treeDef.nodes.filter((node) =>
    (node.prerequisites || []).some((pre) => pre.nodeId === selectedId)).map((node) => node.id));

  const crest = document.createElement("span");
  crest.className = "hex-panel-watermark";
  crest.setAttribute("aria-hidden", "true");
  crest.textContent = "剛勇";
  scene.appendChild(crest);

  for (const node of treeDef.nodes) {
    const rank = ranks[node.id] || 0;
    const acquired = rank > 0;
    const canGet = !acquired && canAcquireNode(c, treeDef, ranks, node);
    const choice = choices.byNode[node.id];
    const sealed = !acquired && !!node.exclusiveGroup &&
      treeDef.nodes.some((other) => other.id !== node.id &&
        other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0);
    const levelLocked = !acquired && node.reqLevel > c.level;
    const selected = selectedId === node.id;
    const [x, y] = WARRIOR_HEX_PANEL_POSITIONS[node.id];
    const glyphInfo = WARRIOR_WEB_LAYOUT[node.id];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hex-panel-node" +
      (acquired ? " acquired" : canGet ? " available" : " locked") +
      (sealed ? " choice-sealed" : "") +
      (levelLocked ? " level-locked" : "") +
      (selected ? " selected" : "") +
      (prerequisites.has(node.id) ? " prerequisite" : "") +
      (successors.has(node.id) ? " successor" : "") +
      (node.kind === "active" ? " active-kind" : " passive-kind") +
      (node.id === "w12" ? " ultimate-kind" : "");
    button.style.left = x + "%";
    button.style.top = y + "%";
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
    inner.appendChild(createWarriorCrestGlyph(sealed ? "seal" : levelLocked ? "lock" : glyphInfo.glyph));
    const label = document.createElement("span");
    label.className = "hex-panel-mark";
    label.textContent = glyphInfo.mark;
    inner.appendChild(label);
    shell.appendChild(inner);
    button.appendChild(shell);
    if (acquired) {
      const tick = document.createElement("span");
      tick.className = "hex-panel-tick";
      tick.textContent = "✓";
      tick.setAttribute("aria-hidden", "true");
      button.appendChild(tick);
    }
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

  const legend = document.createElement("div");
  legend.className = "hex-panel-legend";
  legend.textContent = "金:習得済 / 青:習得可 / 灰:未解放 / 赤:封印";
  wrap.appendChild(legend);
  const controls = document.createElement("div");
  controls.className = "tree-web-controls";
  wrap.appendChild(controls);
  attachWarriorWebZoom(viewport, scene, controls);
  return wrap;
}

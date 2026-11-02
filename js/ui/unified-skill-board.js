// 剣士の固有＋汎用3枠を一枚にまとめる統合スキル盤（表示層のみ）。
// ノードID、取得条件、排他、SP、セーブ状態、汎用枠交換処理は正本を再利用。
"use strict";
let unifiedSkillFocus = "all";
let unifiedSkillCharKey = null;

const UNIFIED_AREAS = Object.freeze({
  exclusive: { label: "戦士固有", x: 50, y: 59 },
  slot1: { label: "汎用Ⅰ", x: 26, y: 34 },
  slot2: { label: "汎用Ⅱ", x: 74, y: 34 },
  slot3: { label: "汎用Ⅲ", x: 50, y: 86 },
});

const UNIFIED_SKILL_ICONS = Object.freeze({
  sword: ["M16 3L21 9L18 21L14 25L10 21L13 9Z", "M7 22L25 22", "M16 25L16 30", "M12 30L20 30"],
  staff: ["M15 12L15 29", "M11 29L19 29", "M15 3L22 8L19 15L11 15L8 8Z", "M15 6L18 9L15 12L12 9Z"],
  body: ["M16 3A4 4 0 1 1 16 11A4 4 0 0 1 16 3Z", "M10 14Q16 11 22 14L26 25L20 28L18 21L14 21L12 28L6 25Z"],
  shield: ["M16 3L27 7V17Q27 25 16 30Q5 25 5 17V7Z", "M16 8V25", "M9 16H23"],
  foot: ["M12 3H20L21 14L27 20Q30 24 26 28H8Q3 26 5 21L10 16Z", "M7 23H26", "M12 16L20 16"],
  arm: ["M9 5L13 4L17 10L21 8L26 11L25 18L29 23L25 28L11 28Q5 26 5 20L8 14L14 17L18 16", "M11 23H24"],
});

function unifiedSkillIconType(node) {
  if (node.kind === "active" || node.ability) {
    const kind = node.ability && node.ability.kind;
    return ["magic", "heal", "buff"].includes(kind) ? "staff" : "sword";
  }
  const effects = node.effects || [];
  const stats = effects.map((effect) => effect.stat || "");
  const keys = effects.map((effect) => effect.key || "");
  if (stats.includes("spd") || keys.some((key) => /spd|speed|evad|dodge|initiative/i.test(key))) return "foot";
  if (stats.includes("def") || keys.some((key) => /dmgTaken|guard|block/i.test(key))) return "shield";
  if (stats.includes("mag") || stats.includes("mp") || keys.some((key) => /mpCost|healBonus|magic|mana/i.test(key))) return "staff";
  if (stats.includes("atk") || keys.some((key) => /crit|attack|damage/i.test(key))) return "arm";
  return "body";
}
function unifiedSkillGlyph(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("unified-node-icon");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  for (const d of UNIFIED_SKILL_ICONS[type] || UNIFIED_SKILL_ICONS.body) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function unifiedSkillEntries(exclusiveTree, state) {
  const entries = [{
    scopeKey: "exclusive", label: "固有", title: exclusiveTree.name,
    treeDef: exclusiveTree, ranks: state.exclusiveRanks, slotDef: null,
  }];
  for (const [index, slot] of GENERAL_SLOTS.entries()) {
    const slotState = state.general[slot.key];
    const treeDef = slotState && getGeneralTree(slotState.treeId);
    if (!treeDef) continue;
    entries.push({
      scopeKey: slot.key, label: "汎用" + (["Ⅰ", "Ⅱ", "Ⅲ"][index] || index + 1),
      title: treeDef.name, treeDef, ranks: slotState.ranks, slotDef: slot,
    });
  }
  return entries;
}

function unifiedSkillPoints(scopeKey, count) {
  if (scopeKey === "exclusive") {
    const counts = [3, 4, 3, 4, 3];
    const points = [];
    for (let row = 0; row < counts.length; row++) {
      for (let col = 0; col < counts[row]; col++)
        points.push([50 + (col - (counts[row] - 1) / 2) * 9, 47 + row * 7]);
    }
    // スキルの取得前提があるため、ID並びは固定（ツリーデータの順序を利用する）。
    return points.slice(0, count);
  }
  const pos = UNIFIED_AREAS[scopeKey];
  if (!pos) return [];
  const points = [];
  for (let i = 0; i < count; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    points.push([pos.x + (col - 1) * 9, pos.y + (row - .5) * 8]);
  }
  return points;
}

function buildWarriorUnifiedSkillPanelScreen(c, exclusiveTree, st, total, spent) {
  const charKey = c.id + ":" + c.job;
  if (charKey !== unifiedSkillCharKey) {
    unifiedSkillCharKey = charKey;
    unifiedSkillFocus = "all";
    treeSelectedNode = null;
    resetWarriorWebView();
  }
  const entries = unifiedSkillEntries(exclusiveTree, st);
  const validSelected = treeSelectedNode && entries.some((entry) =>
    entry.scopeKey === treeSelectedNode.scope &&
    entry.treeDef.nodes.some((node) => node.id === treeSelectedNode.nodeId));
  if (!validSelected) {
    const initial = exclusiveTree.nodes.find((node) => node.id === "w3") || exclusiveTree.nodes[0];
    treeSelectedNode = initial ? { scope: "exclusive", nodeId: initial.id } : null;
  }

  const wrap = document.createElement("div");
  wrap.className = "tree-tab tree-tab--crest tree-tab--unified";
  const head = document.createElement("div");
  head.className = "detail-section-head crest-screen-head";
  const bar = buildWarriorCrestScreenHead(total - spent, total, "統合スキルパネル");
  const resetRow = buildTreeResetRow(c, spent, true);
  if (resetRow) bar.crestActions.appendChild(resetRow);
  head.appendChild(bar);
  wrap.appendChild(head);

  const toolbar = document.createElement("div");
  toolbar.className = "unified-toolbar";
  for (const [scope, label] of [["all", "全体"], ["exclusive", "固有"], ["slot1", "汎Ⅰ"], ["slot2", "汎Ⅱ"], ["slot3", "汎Ⅲ"]]) {
    if (scope !== "all" && scope !== "exclusive" && !entries.some((entry) => entry.scopeKey === scope)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unified-filter" + (unifiedSkillFocus === scope ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(unifiedSkillFocus === scope));
    btn.addEventListener("click", () => {
      if (unifiedSkillFocus === scope) return;
      unifiedSkillFocus = scope;
      treeSwapConfirm = null;
      renderCharDetail();
    });
    toolbar.appendChild(btn);
  }
  const oldView = document.createElement("button");
  oldView.type = "button";
  oldView.className = "unified-legacy-toggle";
  oldView.textContent = "旧UI";
  oldView.setAttribute("aria-label", "従来の紋章盤へ戻す");
  oldView.addEventListener("click", () => {
    warriorBoardMode = "crest";
    warriorFocusScope = "exclusive";
    treeSelectedNode = null;
    treeSwapConfirm = null;
    resetWarriorWebView();
    renderCharDetail();
  });
  toolbar.appendChild(oldView);
  wrap.appendChild(toolbar);

  // 汎用スキル交換を残す。全体表示では選択中の汎用領域の切替を案内。
  const activeEntry = entries.find((entry) => entry.scopeKey ===
    (unifiedSkillFocus !== "all" ? unifiedSkillFocus : treeSelectedNode.scope));
  if (activeEntry && activeEntry.slotDef) {
    const info = document.createElement("div");
    info.className = "unified-slot-tools";
    const current = document.createElement("span");
    current.textContent = activeEntry.label + "：" + activeEntry.treeDef.name;
    info.appendChild(current);
    const nextId = activeEntry.slotDef.candidates.find((id) => id !== activeEntry.treeDef.id);
    const next = nextId && getGeneralTree(nextId);
    if (next) {
      const confirming = treeSwapConfirm === activeEntry.scopeKey;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "unified-swap-btn" + (confirming ? " confirming" : "");
      btn.textContent = confirming ? "本当に交換？ SPをリセット" : "⇄ " + next.name;
      btn.disabled = c.team !== null && isTeamLocked(c.team);
      btn.addEventListener("click", () => {
        if (confirming) {
          if (!confirmReady()) return;
          swapGeneralSlot(c, activeEntry.scopeKey);
          treeSwapConfirm = null;
          treeSelectedNode = null;
        } else {
          treeSwapConfirm = activeEntry.scopeKey;
          armConfirm();
        }
        scheduleSave();
        renderCharDetail();
      });
      info.appendChild(btn);
    }
    wrap.appendChild(info);
  }

  const stage = document.createElement("div");
  stage.className = "crest-stage-area unified-stage";
  const graph = document.createElement("div");
  graph.className = "tree-web tree-web--crest unified-board";
  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport unified-viewport";
  viewport.setAttribute("aria-label", "固有・汎用Ⅰ〜Ⅲと覚醒予定枠を統合したスキル盤。ピンチで拡大できます");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene unified-scene";
  viewport.appendChild(scene);
  graph.appendChild(viewport);
  stage.appendChild(graph);

  const awakening = document.createElement("div");
  awakening.className = "unified-awakening-label";
  awakening.textContent = "ジョブ覚醒（今後実装）";
  scene.appendChild(awakening);
  for (let i = 0; i < 3; i++) {
    const marker = document.createElement("div");
    marker.className = "unified-awakening-placeholder";
    marker.style.left = (36 + i * 14) + "%";
    marker.style.top = "12%";
    marker.setAttribute("aria-label", "覚醒" + ["Ⅰ", "Ⅱ", "Ⅲ"][i] + "は今後実装予定");
    marker.setAttribute("title", "覚醒" + ["Ⅰ", "Ⅱ", "Ⅲ"][i] + "：今後実装予定");
    const ic = document.createElement("span");
    ic.className = "unified-awakening-lock";
    ic.appendChild(createWarriorCrestGlyph("lock"));
    marker.appendChild(ic);
    const lbl = document.createElement("span");
    lbl.textContent = "覚醒" + ["Ⅰ", "Ⅱ", "Ⅲ"][i];
    marker.appendChild(lbl);
    scene.appendChild(marker);
  }

  for (const entry of entries) {
    const area = UNIFIED_AREAS[entry.scopeKey];
    if (!area) continue;
    const label = document.createElement("div");
    label.className = "unified-area-label unified-scope-" + entry.scopeKey +
      (unifiedSkillFocus !== "all" && unifiedSkillFocus !== entry.scopeKey ? " muted" : "");
    label.style.left = area.x + "%";
    label.style.top = (entry.scopeKey === "exclusive" ? 42 : entry.scopeKey === "slot3" ? 76 : 24) + "%";
    label.textContent = area.label;
    scene.appendChild(label);
    const positions = unifiedSkillPoints(entry.scopeKey, entry.treeDef.nodes.length);
    const choices = treeChoiceInfo(entry.treeDef, entry.ranks);
    for (const [index, node] of entry.treeDef.nodes.entries()) {
      if (!positions[index]) continue;
      const [x, y] = positions[index];
      const rank = entry.ranks[node.id] || 0, acquired = rank > 0;
      const canGet = !acquired && canAcquireNode(c, entry.treeDef, entry.ranks, node);
      const sealed = !acquired && !!node.exclusiveGroup && entry.treeDef.nodes.some((other) =>
        other.id !== node.id && other.exclusiveGroup === node.exclusiveGroup && (entry.ranks[other.id] || 0) > 0);
      const selected = treeSelectedNode && treeSelectedNode.scope === entry.scopeKey &&
        treeSelectedNode.nodeId === node.id;
      const type = unifiedSkillIconType(node);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "unified-node unified-scope-" + entry.scopeKey +
        (acquired ? " acquired" : canGet ? " available" : " locked") +
        (sealed ? " choice-sealed" : "") + (selected ? " selected" : "") +
        (unifiedSkillFocus !== "all" && unifiedSkillFocus !== entry.scopeKey ? " muted" : "");
      button.style.left = x + "%";
      button.style.top = y + "%";
      button.title = node.name;
      button.setAttribute("data-icon-type", type);
      button.setAttribute("data-scope", entry.scopeKey);
      const status = acquired ? "習得済み" : sealed ? "二択封印中" : canGet ? "習得可能" :
        node.reqLevel > c.level ? "Lv不足" : "未解放";
      button.setAttribute("aria-label", entry.label + " " + node.name + "、" + status);
      button.setAttribute("aria-pressed", String(!!selected));
      const tile = document.createElement("span");
      tile.className = "unified-node-tile";
      tile.appendChild(unifiedSkillGlyph(type));
      button.appendChild(tile);
      if (choices.byNode[node.id]) {
        const choice = document.createElement("span");
        choice.className = "unified-node-choice";
        choice.textContent = choices.byNode[node.id].group.label;
        choice.setAttribute("aria-hidden", "true");
        button.appendChild(choice);
      }
      button.addEventListener("click", () => {
        treeSelectedNode = { scope: entry.scopeKey, nodeId: node.id };
        treeSwapConfirm = null;
        renderCharDetail();
      });
      scene.appendChild(button);
    }
  }

  const controls = document.createElement("div");
  controls.className = "tree-web-controls";
  graph.appendChild(controls);
  attachWarriorWebZoom(viewport, scene, controls);
  wrap.appendChild(stage);

  const dock = document.createElement("div");
  dock.className = "crest-inline-detail";
  const chosenEntry = entries.find((entry) => entry.scopeKey === treeSelectedNode.scope);
  const chosenNode = chosenEntry && chosenEntry.treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
  if (chosenNode) {
    dock.appendChild(buildTreeNodeDetail(c, chosenEntry.treeDef, chosenEntry.ranks, chosenNode, chosenEntry.title));
  }
  wrap.appendChild(dock);
  return wrap;
}

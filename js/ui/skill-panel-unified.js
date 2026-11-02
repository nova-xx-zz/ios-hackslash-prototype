// 剣士向け統合スキルパネル試作。保存・SP・排他・覚醒実績には一切触れない。
// detail-tree.js / skill-panel-board.js の後に読み込む。
"use strict";

// 現在のキャラクターだけの表示フィルター。セーブデータへは書き込まない。
let warriorUnifiedFilter = "all";
const UNIFIED_FILTERS = Object.freeze([
  ["all", "全体"], ["exclusive", "固有"],
  ["slot1", "汎Ⅰ"], ["slot2", "汎Ⅱ"], ["slot3", "汎Ⅲ"],
  ["ready", "習得可"],
]);

// スキルのアイコンは効果の正本から決める。文言や職業名の文字列には依存しない。
// 物理アクティブ=剣 / 魔法・回復=杖 / HP,MP=体 / DEF,軽減=盾 / SPD=足 / ATK,会心=腕
function unifiedSkillIconForNode(node) {
  if (node.kind === "active" && node.ability) {
    const kind = node.ability.kind;
    return ["magic", "heal"].includes(kind) ? "staff" : "blade";
  }
  const effects = node.effects || [];
  if (effects.some((e) => e.type === "equipSlot")) return "body";
  if (effects.some((e) => e.stat === "spd")) return "foot";
  if (effects.some((e) => e.stat === "def" || e.key === "dmgTakenMult")) return "tower";
  if (effects.some((e) => e.stat === "hp" || e.stat === "mp" ||
      e.key === "lifesteal")) return "body";
  if (effects.some((e) => e.stat === "mag" ||
      e.key === "mpCostMult" || e.key === "healBonus")) return "staff";
  if (effects.some((e) => e.stat === "atk" || e.key === "critBonus")) return "arm";
  return "body";
}

function unifiedSkillEntries(c, exclusiveTree, st) {
  const entries = [{
    scopeKey: "exclusive", label: jobDef(c).name + "固有",
    title: exclusiveTree.name + "（固有）",
    treeDef: exclusiveTree, ranks: st.exclusiveRanks, slotDef: null,
  }];
  GENERAL_SLOTS.forEach((slot, index) => {
    const slotState = st.general[slot.key];
    const treeDef = getGeneralTree(slotState.treeId);
    if (!treeDef) return;
    entries.push({
      scopeKey: slot.key, label: "汎用" + ["Ⅰ", "Ⅱ", "Ⅲ"][index],
      title: slot.label + ": " + treeDef.name,
      treeDef, ranks: slotState.ranks, slotDef: slot,
    });
  });
  return entries;
}

// 1画面の中で系統を切り替えても「別画面」には遷移しない。全体では全4系統を表示。
function buildWarriorUnifiedSkillScreen(c, exclusiveTree, st, total, spent) {
  const entries = unifiedSkillEntries(c, exclusiveTree, st);
  const wrap = document.createElement("div");
  wrap.className = "tree-tab tree-tab--crest unified-skill-screen";
  const head = document.createElement("div");
  head.className = "detail-section-head crest-screen-head";
  const bar = buildWarriorCrestScreenHead(total - spent, total, "統合スキルパネル");
  const reset = buildTreeResetRow(c, spent, true);
  if (reset) bar.crestActions.appendChild(reset);
  head.appendChild(bar);
  wrap.appendChild(head);

  const toolbar = document.createElement("div");
  toolbar.className = "unified-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "スキルパネルの表示切替");
  const filters = document.createElement("div");
  filters.className = "unified-filters";
  for (const [key, label] of UNIFIED_FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "unified-filter" + (warriorUnifiedFilter === key ? " active" : "");
    button.textContent = label;
    button.setAttribute("aria-pressed", String(warriorUnifiedFilter === key));
    button.addEventListener("click", () => {
      if (warriorUnifiedFilter === key) return;
      warriorUnifiedFilter = key;
      treeSwapConfirm = null;
      renderCharDetail();
    });
    filters.appendChild(button);
  }
  toolbar.appendChild(filters);
  const legacy = document.createElement("button");
  legacy.type = "button";
  legacy.className = "unified-legacy";
  legacy.textContent = "旧盤面";
  legacy.setAttribute("aria-label", "従来の紋章盤に戻る");
  legacy.addEventListener("click", () => {
    warriorBoardMode = "crest";
    warriorFocusScope = "exclusive";
    treeSwapConfirm = null;
    treeSelectedNode = null;
    resetWarriorWebView();
    renderCharDetail();
  });
  toolbar.appendChild(legacy);
  wrap.appendChild(toolbar);

  const activeEntry = entries.find((entry) => treeSelectedNode &&
    entry.scopeKey === treeSelectedNode.scope &&
    entry.treeDef.nodes.some((node) => node.id === treeSelectedNode.nodeId));
  if (!activeEntry) {
    const initial = exclusiveTree.nodes.find((node) => node.id === "w3") || exclusiveTree.nodes[0];
    treeSelectedNode = initial ? {scope:"exclusive", nodeId:initial.id} : null;
  }

  const stage = document.createElement("div");
  stage.className = "crest-stage-area unified-stage";
  const board = document.createElement("div");
  board.className = "unified-board";
  board.setAttribute("aria-label", "固有と汎用3枠をまとめたスキルパネル");
  const awaken = document.createElement("div");
  awaken.className = "unified-awakening";
  const awakenTitle = document.createElement("div");
  awakenTitle.className = "unified-awakening-label";
  awakenTitle.textContent = "ジョブ覚醒・試練の道（準備中）";
  awaken.appendChild(awakenTitle);
  const awakenSteps = document.createElement("div");
  awakenSteps.className = "unified-awakening-steps";
  for (const [index, label] of ["Ⅰ", "Ⅱ", "Ⅲ"].entries()) {
    const step = document.createElement("div");
    step.className = "unified-awakening-step";
    step.setAttribute("aria-label", "覚醒" + label + "、未実装");
    const icon = document.createElement("span");
    icon.className = "unified-awakening-icon";
    icon.appendChild(createWarriorCrestGlyph("lock"));
    step.appendChild(icon);
    const text = document.createElement("span");
    text.textContent = "覚醒" + label;
    step.appendChild(text);
    awakenSteps.appendChild(step);
  }
  awaken.appendChild(awakenSteps);
  board.appendChild(awaken);

  // 常に1つの盤面DOMの中に4つの系統がある。絞り込みでは対象だけを大きく表示。
  const zones = document.createElement("div");
  zones.className = "unified-zones" +
    (warriorUnifiedFilter !== "all" && warriorUnifiedFilter !== "ready" ? " single-zone" : "");
  for (const entry of entries) {
    if (warriorUnifiedFilter !== "all" && warriorUnifiedFilter !== "ready" &&
        entry.scopeKey !== warriorUnifiedFilter) continue;
    zones.appendChild(buildUnifiedSkillZone(c, entry));
  }
  board.appendChild(zones);
  stage.appendChild(board);
  wrap.appendChild(stage);

  const dock = document.createElement("div");
  dock.className = "crest-inline-detail unified-detail";
  const detailEntry = entries.find((entry) => entry.scopeKey === treeSelectedNode?.scope);
  const detailNode = detailEntry && detailEntry.treeDef.nodes.find((node) => node.id === treeSelectedNode.nodeId);
  if (detailNode) {
    const from = document.createElement("div");
    from.className = "unified-detail-source";
    from.textContent = detailEntry.label + " / " + detailEntry.treeDef.name;
    dock.appendChild(from);
    dock.appendChild(buildTreeNodeDetail(c, detailEntry.treeDef, detailEntry.ranks, detailNode, detailEntry.title));
  }
  wrap.appendChild(dock);
  return wrap;
}

function buildUnifiedSkillZone(c, entry) {
  const zone = document.createElement("section");
  zone.className = "unified-zone" +
    (entry.scopeKey === "exclusive" ? " unified-zone--exclusive" : " unified-zone--general") +
    " unified-zone--" + entry.scopeKey;
  const header = document.createElement("div");
  header.className = "unified-zone-header";
  const heading = document.createElement("div");
  heading.className = "unified-zone-title";
  heading.textContent = entry.label;
  const sub = document.createElement("span");
  sub.textContent = entry.treeDef.name;
  heading.appendChild(sub);
  header.appendChild(heading);

  // 汎用ツリーの切替は消さない。現在の枠にある交換候補だけが対象。
  if (entry.slotDef) {
    const nextId = entry.slotDef.candidates.find((id) => id !== entry.treeDef.id) ||
      entry.slotDef.candidates[0];
    const next = getGeneralTree(nextId);
    const confirm = treeSwapConfirm === entry.slotDef.key;
    const swap = document.createElement("button");
    swap.type = "button";
    swap.className = "unified-swap" + (confirm ? " confirming" : "");
    swap.textContent = confirm ? "交換を確定" : "⇄ " + next.name;
    swap.disabled = c.team !== null && isTeamLocked(c.team);
    swap.addEventListener("click", () => {
      if (confirm) {
        if (!confirmReady()) return;
        swapGeneralSlot(c, entry.slotDef.key);
        treeSelectedNode = null;
        treeSwapConfirm = null;
        scheduleSave();
      } else {
        treeSwapConfirm = entry.slotDef.key;
        armConfirm();
      }
      renderCharDetail();
    });
    header.appendChild(swap);
  }
  zone.appendChild(header);

  const rows = document.createElement("div");
  rows.className = "unified-hex-rows";
  const nodes = entry.treeDef.nodes;
  const groups = entry.scopeKey === "exclusive" ? [4, 5, 4, 4] : [3, 3];
  let offset = 0;
  for (const count of groups) {
    const row = document.createElement("div");
    row.className = "unified-hex-row";
    for (const node of nodes.slice(offset, offset + count)) {
      row.appendChild(buildUnifiedSkillNode(c, entry, node));
    }
    rows.appendChild(row);
    offset += count;
  }
  // マスターに将来ノードが増えたら欠落させず、追加行で表示する。
  while (offset < nodes.length) {
    const row = document.createElement("div");
    row.className = "unified-hex-row";
    for (const node of nodes.slice(offset, offset + 4)) row.appendChild(buildUnifiedSkillNode(c, entry, node));
    rows.appendChild(row);
    offset += 4;
  }
  zone.appendChild(rows);
  return zone;
}

function buildUnifiedSkillNode(c, entry, node) {
  const ranks = entry.ranks;
  const acquired = (ranks[node.id] || 0) > 0;
  const sealed = !acquired && !!node.exclusiveGroup &&
    entry.treeDef.nodes.some((other) => other.id !== node.id &&
      other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0);
  const available = !acquired && canAcquireNode(c, entry.treeDef, ranks, node);
  const selected = treeSelectedNode && treeSelectedNode.scope === entry.scopeKey &&
    treeSelectedNode.nodeId === node.id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "unified-hex-node" +
    (acquired ? " acquired" : available ? " available" : " locked") +
    (sealed ? " choice-sealed" : "") +
    (selected ? " selected" : "") +
    (warriorUnifiedFilter === "ready" && !available ? " dimmed" : "");
  const iconName = unifiedSkillIconForNode(node);
  button.setAttribute("data-glyph", iconName);
  button.setAttribute("data-scope", entry.scopeKey);
  button.setAttribute("aria-pressed", String(!!selected));
  button.setAttribute("aria-label", entry.label + "・" + node.name + "・" +
    (acquired ? "習得済み" : sealed ? "二択で封印" : available ? "習得可能" : "未解放"));
  button.title = node.name;
  const face = document.createElement("span");
  face.className = "unified-hex-face";
  face.appendChild(createWarriorCrestGlyph(iconName));
  button.appendChild(face);
  if (node.exclusiveGroup) {
    const choice = treeChoiceInfo(entry.treeDef, ranks).byNode[node.id];
    if (choice) {
      const badge = document.createElement("span");
      badge.className = "unified-hex-choice";
      badge.textContent = choice.group.label;
      badge.setAttribute("aria-hidden", "true");
      button.appendChild(badge);
    }
  }
  button.addEventListener("click", () => {
    treeSelectedNode = {scope:entry.scopeKey,nodeId:node.id};
    treeSwapConfirm = null;
    renderCharDetail();
  });
  return button;
}

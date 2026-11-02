// 剣士の固有17ノード＋汎用3枠（各6ノード）を1枚の盤面に合成する表示専用UI。
// 習得・排他・SP・ツリー交換・セーブの正本は既存の各treeDefとranksのまま。
"use strict";

const UNIFIED_SKILL_ICON_PATHS = Object.freeze({
  sword: ["M8 26L23 11", "M18 7l7-3-3 7", "M6 21l8 8", "M5 28l3-3", "M11 21l-3-3"],
  staff: ["M9 29L22 10", "M22 10a5 5 0 1 0-1-1", "M21 5l2-4 2 4", "M16 8l-5-2", "M20 20l4 3"],
  body: ["M16 3a5 5 0 1 0 0 10a5 5 0 0 0 0-10", "M6 29v-8c0-4 4-7 10-7s10 3 10 7v8", "M16 14v14", "M11 23h10"],
  shield: ["M16 2L28 7v8c0 7-4 12-12 15C8 27 4 22 4 15V7Z", "M16 5v22", "M7 13h18"],
  foot: ["M8 4l8 2 1 9 7 6 3 6c1 2 0 3-3 3H6c-3 0-4-2-2-4l6-7 1-9Z", "M11 20l5 4", "M5 27h20"],
  arm: ["M7 23l5-8 4 3 3-9 4-3 3 3-3 10 4 5-5 5H9Z", "M12 16l-2-5 3-3 4 3", "M17 19l4 5"]
});
function unifiedSkillIconName(node) {
  if (node.kind === "active") {
    return node.ability && ["magic", "heal", "buff"].includes(node.ability.kind) ? "staff" : "sword";
  }
  const effects = node.effects || [];
  const types = new Set(effects.map((e) => e.stat));
  const keys = effects.map((e) => e.key || "").join(" ");
  if (types.has("def") || /dmgTaken|guard|block/i.test(keys)) return "shield";
  if (types.has("spd") || /speed|evasion/i.test(keys)) return "foot";
  if (types.has("atk") || /crit|attack/i.test(keys)) return "arm";
  if (types.has("mag") || types.has("mp") || /mpCost|magic/i.test(keys)) return "staff";
  if (types.has("hp") || /heal|lifesteal|hp/i.test(keys)) return "body";
  return "body";
}
function createUnifiedSkillGlyph(node) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("tree-web-glyph");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const icon = unifiedSkillIconName(node);
  for (const d of UNIFIED_SKILL_ICON_PATHS[icon]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
// 全エリアを同じ正方形sceneに置く。中心固有、左上汎I、右上汎II、下部汎III。
const UNIFIED_CENTRAL_GRID = Object.freeze([
  [49,14], [37,25],[49,25],[61,25], [37,36],[49,36],[61,36],
  [37,47],[49,47],[61,47], [37,58],[49,58],[61,58],
  [37,69],[49,69],[61,69], [49,79]
]);
const UNIFIED_LEFT_GRID = Object.freeze([[12,24],[23,34],[12,44],[23,54],[12,64],[23,74]]);
const UNIFIED_RIGHT_GRID = Object.freeze([[88,24],[77,34],[88,44],[77,54],[88,64],[77,74]]);
const UNIFIED_BOTTOM_GRID = Object.freeze([[24,91],[34.4,91],[44.8,91],[55.2,91],[65.6,91],[76,91]]);
const UNIFIED_GRID_BY_SCOPE = Object.freeze({
  exclusive: UNIFIED_CENTRAL_GRID, slot1: UNIFIED_LEFT_GRID,
  slot2: UNIFIED_RIGHT_GRID, slot3: UNIFIED_BOTTOM_GRID
});
const UNIFIED_TONE_BY_SCOPE = Object.freeze({
  exclusive:"red",slot1:"blue",slot2:"green",slot3:"violet"
});
let warriorUnifiedFocus = "all";
const UNIFIED_FILTERS = Object.freeze([
  ["all","全体"],["exclusive","固有"],["slot1","汎Ⅰ"],
  ["slot2","汎Ⅱ"],["slot3","汎Ⅲ"],["ready","習得可"]
]);

function unifiedSkillNodeState(c, entry, node) {
  const ranks = entry.ranks;
  const rank = ranks[node.id] || 0;
  const acquired = rank > 0;
  const choice = treeChoiceInfo(entry.treeDef, ranks).byNode[node.id] || null;
  const sealed = !acquired && !!node.exclusiveGroup &&
    entry.treeDef.nodes.some((other) => other.id !== node.id &&
      other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0);
  const levelLocked = !acquired && node.reqLevel > c.level;
  const canGet = !acquired && canAcquireNode(c, entry.treeDef, ranks, node);
  return { acquired, choice, sealed, levelLocked, canGet };
}

function buildWarriorUnifiedBoard(c, entries) {
  const wrap = document.createElement("div");
  wrap.className = "tree-web tree-web--crest hex-panel-board unified-skill-board";
  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport hex-panel-viewport";
  viewport.setAttribute("aria-label", "戦士固有と汎用3枠の統合スキルパネル。選択すると下に詳細が表示されます");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene hex-panel-scene unified-skill-scene";
  viewport.appendChild(scene);
  wrap.appendChild(viewport);
  for (const [scope, name, x, y] of [
    ["slot1","汎用Ⅰ",15,9],["exclusive","戦士固有",49,5],
    ["slot2","汎用Ⅱ",85,9],["slot3","汎用Ⅲ",50,83]
  ]) {
    const label = document.createElement("span");
    label.className = "unified-area-label group-" + scope;
    label.style.left = x + "%";
    label.style.top = y + "%";
    label.textContent = name;
    scene.appendChild(label);
  }

  const selected = treeSelectedNode || {};
  for (const entry of entries) {
    const positions = UNIFIED_GRID_BY_SCOPE[entry.scopeKey];
    if (!positions) continue;
    entry.treeDef.nodes.forEach((node, i) => {
      const pos = positions[i];
      if (!pos) return;
      const state = unifiedSkillNodeState(c, entry, node);
      const isSelected = selected.scope === entry.scopeKey && selected.nodeId === node.id;
      const dimmed = warriorUnifiedFocus !== "all" &&
        (warriorUnifiedFocus === "ready" ? !state.canGet : entry.scopeKey !== warriorUnifiedFocus);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hex-panel-node unified-skill-node tone-" +
        UNIFIED_TONE_BY_SCOPE[entry.scopeKey] + " group-" + entry.scopeKey +
        (state.acquired ? " acquired" : state.canGet ? " available" : " locked") +
        (state.sealed ? " choice-sealed" : "") +
        (state.levelLocked ? " level-locked" : "") +
        (isSelected ? " selected" : "") +
        (dimmed ? " muted" : "");
      button.style.left = pos[0] + "%";
      button.style.top = pos[1] + "%";
      button.title = node.name;
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute("aria-label", entry.label + "・" + node.name +
        "、" + (state.acquired ? "習得済み" : state.sealed ? "二択で封印中" :
        state.canGet ? "習得可能" : "未解放") + "、必要Lv" + node.reqLevel);
      const shell = document.createElement("span");
      shell.className = "hex-panel-shell";
      const inner = document.createElement("span");
      inner.className = "hex-panel-inner";
      const medal = document.createElement("span");
      medal.className = "hex-panel-medallion";
      medal.appendChild(createUnifiedSkillGlyph(node));
      inner.appendChild(medal);
      shell.appendChild(inner);
      button.appendChild(shell);
      if (state.choice) {
        const mark = document.createElement("span");
        mark.className = "hex-panel-choice";
        mark.textContent = state.choice.group.label;
        mark.setAttribute("aria-hidden","true");
        button.appendChild(mark);
      }
      button.addEventListener("click", () => {
        treeSelectedNode = { scope: entry.scopeKey, nodeId: node.id };
        warriorUnifiedFocus = entry.scopeKey;
        treeSwapConfirm = null;
        renderCharDetail();
      });
      scene.appendChild(button);
    });
  }
  const controls = document.createElement("div");
  controls.className = "tree-web-controls";
  wrap.appendChild(controls);
  attachWarriorWebZoom(viewport, scene, controls);
  return wrap;
}

function buildWarriorUnifiedSkillScreen(c, entries, total, spent) {
  const wrap = document.createElement("div");
  wrap.className = "tree-tab tree-tab--crest unified-skill-screen";
  const head = document.createElement("div");
  head.className = "detail-section-head crest-screen-head";
  const bar = buildWarriorCrestScreenHead(total - spent, total, "統合スキルパネル");
  const reset = buildTreeResetRow(c, spent, true);
  if (reset) bar.crestActions.appendChild(reset);
  head.appendChild(bar);
  wrap.appendChild(head);

  const modeSwitch = document.createElement("div");
  modeSwitch.className = "hex-panel-switch unified-mode-switch";
  for (const [mode, label] of [["integrated","統合"],["crest","紋章盤"],["hex","六角パネル"]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hex-panel-mode" + (warriorBoardMode === mode ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(warriorBoardMode === mode));
    btn.addEventListener("click", () => {
      if (warriorBoardMode === mode) return;
      warriorBoardMode = mode;
      treeSwapConfirm = null;
      resetWarriorWebView();
      renderCharDetail();
    });
    modeSwitch.appendChild(btn);
  }
  wrap.appendChild(modeSwitch);

  const filters = document.createElement("div");
  filters.className = "unified-skill-filters";
  filters.setAttribute("role","group");
  filters.setAttribute("aria-label","スキル表示の絞り込み");
  for (const [key,label] of UNIFIED_FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unified-filter" + (warriorUnifiedFocus === key ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("aria-pressed",String(warriorUnifiedFocus === key));
    btn.addEventListener("click",()=>{warriorUnifiedFocus = key;renderCharDetail();});
    filters.appendChild(btn);
  }
  wrap.appendChild(filters);

  // 覚醒はUI予約のみ。状態・試練・効果やセーブを創作しない。
  const awakenings = document.createElement("div");
  awakenings.className = "unified-awakening";
  const text = document.createElement("span");
  text.className = "unified-awakening-title";
  text.textContent = "ジョブ覚醒";
  awakenings.appendChild(text);
  ["Ⅰ","Ⅱ","Ⅲ"].forEach((tier) => {
    const stamp = document.createElement("span");
    stamp.className = "unified-awakening-stamp";
    stamp.textContent = "覚醒" + tier + "・準備中";
    stamp.setAttribute("aria-label","覚醒"+tier+" は未実装");
    awakenings.appendChild(stamp);
  });
  wrap.appendChild(awakenings);

  const swaps = document.createElement("div");
  swaps.className = "unified-slot-swaps";
  const locked = c.team !== null && isTeamLocked(c.team);
  for (const entry of entries.filter((e) => !!e.slotDef)) {
    const otherId = entry.slotDef.candidates.find((id) => id !== entry.treeDef.id);
    const other = otherId && getGeneralTree(otherId);
    const confirm = treeSwapConfirm === entry.scopeKey;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unified-slot-swap" + (confirm ? " confirming" : "");
    btn.disabled = locked || !other;
    btn.textContent = confirm ? "汎" + (entries.indexOf(entry)) + " 交換確定？" :
      "汎" + (entries.indexOf(entry)) + "：" + entry.treeDef.name + " ⇄";
    btn.title = other ? "切替候補：" + other.name + "（既存のSPリセット確認あり）" : "";
    btn.addEventListener("click", () => {
      if (confirm) {
        if (!confirmReady()) return;
        swapGeneralSlot(c, entry.scopeKey);
        treeSelectedNode = null;
        treeSwapConfirm = null;
      } else {
        treeSwapConfirm = entry.scopeKey;
        armConfirm();
      }
      scheduleSave();
      renderCharDetail();
    });
    swaps.appendChild(btn);
  }
  wrap.appendChild(swaps);

  const selectedEntry = entries.find((entry) => entry.scopeKey === (treeSelectedNode && treeSelectedNode.scope) &&
    entry.treeDef.nodes.some((node) => node.id === treeSelectedNode.nodeId));
  if (!selectedEntry) {
    const first = entries[0].treeDef.nodes.find((n) => n.id === "w3") || entries[0].treeDef.nodes[0];
    treeSelectedNode = { scope: "exclusive", nodeId: first.id };
  }
  const stage = document.createElement("div");
  stage.className = "crest-stage-area unified-skill-stage";
  stage.appendChild(buildWarriorUnifiedBoard(c,entries));
  wrap.appendChild(stage);
  const detail = document.createElement("div");
  detail.className = "crest-inline-detail";
  const activeEntry = entries.find((e) => e.scopeKey === treeSelectedNode.scope) || entries[0];
  const node = activeEntry.treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
  if (node) detail.appendChild(buildTreeNodeDetail(c,activeEntry.treeDef,activeEntry.ranks,node,activeEntry.title));
  wrap.appendChild(detail);
  return wrap;
}

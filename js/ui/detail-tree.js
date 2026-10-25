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
  // せんしだけはスキルツリー専用画面の見た目にする（見出し・SP表示も装飾版）。計算と操作は全職共通のまま。
  const crest = isWarriorCrestWeb(c, "exclusive", exclusiveTree);
  if (crest) {
    wrap.className = "tree-tab tree-tab--crest";
    // ページャーで仲間が変わったら前の仲間の表示枠・選択ノードを引き継がない。
    if (warriorFocusCharId !== c.id) {
      warriorFocusCharId = c.id;
      warriorFocusScope = "exclusive";
      treeSelectedNode = null;
    }
    const nav = document.createElement("div");
    nav.className = "crest-focus-navigation";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "crest-focus-back";
    back.textContent = "‹";
    back.setAttribute("aria-label", "仲間詳細に戻る");
    back.addEventListener("click", () => { detailTab = "stats"; renderCharDetail(); });
    const brand = document.createElement("span");
    brand.className = "crest-focus-brand";
    brand.textContent = "SWORD CREST  ✦";
    // 参考画像と同じ最上段: 戻る矢印＋作品名。仲間の切替は戻った詳細画面から行う。
    nav.appendChild(back);
    nav.appendChild(brand);
    wrap.appendChild(nav);
  }

  const head = document.createElement("div");
  head.className = "detail-section-head";
  let crestActions = null;
  if (crest) {
    head.classList.add("crest-screen-head");
    const bar = buildWarriorCrestScreenHead(total - spent, total);
    crestActions = bar.crestActions;
    head.appendChild(bar);
  } else {
    head.innerHTML = `<span>スキルツリー</span><span class="count">SP ${total - spent}/${total}</span>`;
  }
  wrap.appendChild(head);

  // 振り直し（4本ぶんのSPを全部戻す。費用は強化石）
  if (spent > 0) {
    const cost = treeResetCost(c);
    const confirming = treeSwapConfirm === "reset";
    const resetRow = document.createElement("div");
    resetRow.className = "tree-reset-row" + (crest ? " crest-reset-row" : "");
    const resetBtn = document.createElement("button");
    resetBtn.className = "tree-swap-btn" + (confirming ? " confirming" : "");
    resetBtn.textContent = confirming ? `本当に振り直す？（強化石${cost.toLocaleString()}）` : `↺ ツリーを振り直す（強化石${cost.toLocaleString()}）`;
    const shortOfStone = !canResetTree(c) && (S.material || 0) < cost;
    if (crest) {
      // せんしの専用画面では見出し右の小さな「リセット」札にまとめる（処理・費用・確認手順は共通のまま）
      resetBtn.setAttribute("aria-label", resetBtn.textContent);
      resetBtn.textContent = "";
      const resetMain = document.createElement("span");
      resetMain.className = "crest-reset-main";
      resetMain.textContent = confirming ? "本当に？" : "リセット";
      const resetSub = document.createElement("span");
      resetSub.className = "crest-reset-sub";
      resetSub.textContent = `強化石${cost.toLocaleString()}` + (shortOfStone ? `（所持${(S.material || 0).toLocaleString()}）` : "");
      resetBtn.appendChild(resetMain);
      resetBtn.appendChild(resetSub);
    }
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
    if (shortOfStone && !crest) {
      const note = document.createElement("span");
      note.className = "tree-reset-note";
      note.textContent = `強化石が足りません（${(S.material || 0).toLocaleString()}）`;
      resetRow.appendChild(note);
    }
    (crestActions || wrap).appendChild(resetRow);
  }

  if (crest) {
    // 参考画面の横並び4タブ。従来の「汎用3本を縦に全表示」はしない。
    const entries = [{
      scopeKey: "exclusive", label: "せんし", title: exclusiveTree.name + "（固有）",
      treeDef: exclusiveTree, ranks: st.exclusiveRanks, slotDef: null,
    }];
    for (const slot of GENERAL_SLOTS) {
      const slotState = st.general[slot.key];
      entries.push({
        scopeKey: slot.key, label: slot.label, title: slot.label + ": " + getGeneralTree(slotState.treeId).name,
        treeDef: getGeneralTree(slotState.treeId), ranks: slotState.ranks, slotDef: slot,
      });
    }
    const active = entries.find((entry) => entry.scopeKey === warriorFocusScope) || entries[0];
    warriorFocusScope = active.scopeKey;
    const tabs = document.createElement("div");
    tabs.className = "crest-focus-tabs";
    tabs.setAttribute("role", "tablist");
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "crest-focus-tab" + (entry.scopeKey === warriorFocusScope ? " active" : "");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(entry.scopeKey === warriorFocusScope));
      button.textContent = entry.label;
      button.addEventListener("click", () => {
        if (warriorFocusScope === entry.scopeKey) return;
        warriorFocusScope = entry.scopeKey;
        treeSelectedNode = null;
        treeSwapConfirm = null;
        renderCharDetail();
        const body = document.getElementById("detailBody");
        if (body) body.scrollTop = 0;
      });
      tabs.appendChild(button);
    }
    // HTMLの見た目順は「タイトル/SP → 4タブ → ジョブ情報と巨大な紋章盤 → 詳細」
    wrap.appendChild(tabs);
    if (!treeSelectedNode || treeSelectedNode.scope !== active.scopeKey ||
        !active.treeDef.nodes.some((node) => node.id === treeSelectedNode.nodeId)) {
      const initial = active.scopeKey === "exclusive"
        ? active.treeDef.nodes.find((node) => node.id === "w3")
        : active.treeDef.nodes[0];
      treeSelectedNode = initial ? { scope: active.scopeKey, nodeId: initial.id } : null;
    }
    wrap.appendChild(buildTreeSection(c, { ...active, inlineDetail: true }));
    return wrap;
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
  const { scopeKey, title, treeDef, ranks, slotDef, inlineDetail = false } = opts;
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
  // せんしの固有ツリーだけ専用の紋章盤（見出し・盤面・凡例を一体で描く）。汎用3枠・けんごう・他職は既存レイアウト。
  const warriorWeb = isWarriorCrestWeb(c, scopeKey, treeDef);
  if (warriorWeb) {
    section.classList.add("warrior-crest-section");
    section.appendChild(buildWarriorWebGraph(c, scopeKey, treeDef, ranks));
  } else {
    section.appendChild(headRow);
    section.appendChild(buildTreeGraph(c, scopeKey, treeDef, ranks));
  }

  // 選んだマスの詳細は、スクロールしなくても押せるように画面の下（タブの上）に固定して出す
  if (treeSelectedNode && treeSelectedNode.scope === scopeKey) {
    const selNode = treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
    const sheet = inlineDetail ? document.createElement("div") : document.getElementById("detailSheet");
    if (selNode && sheet) {
      if (inlineDetail) sheet.className = "crest-inline-detail";
      sheet.appendChild(buildTreeNodeDetail(c, treeDef, ranks, selNode, title));
      if (inlineDetail) section.appendChild(sheet);
      else sheet.classList.remove("hidden");
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

// ===================== せんし専用: 剛勇の紋章盤（スキルツリー専用画面） =====================
// 見た目だけを受け持つ。ノードID・前提・排他・必要SP/Lv・効果・保存形式・習得処理はすべて
// EXCLUSIVE_TREES.warrior（js/data.js）と既存関数 canAcquireNode / acquireNode をそのまま使う。
// 設計: docs/剣士スキルツリーUI改修.md

// 専用の4タブ表示状態は一時的なUI値。セーブせず、仲間変更時は固有に戻す。
let warriorFocusScope = "exclusive";
let warriorFocusCharId = null;

// せんしだけに適用。同じ固有ツリーを使う「けんごう」・他職・汎用3枠は従来の縦分岐図のまま。
function isWarriorCrestWeb(c, scopeKey, treeDef) {
  return !!(c && treeDef) && c.job === "warrior" && scopeKey === "exclusive" &&
    treeDef.id === "warrior" && treeDef.nodes.every((node) => WARRIOR_WEB_LAYOUT[node.id]);
}

// 6方向の枝（盤面上の角度。-90°が真上で時計回り）。色は控えめに枝の個性だけ付ける。
const WARRIOR_WEB_LANES = [
  { name: "基礎", angle: -90 },
  { name: "猛攻", angle: -30 },
  { name: "破砕", angle: 30 },
  { name: "覇道", angle: 90 },
  { name: "鉄壁", angle: 150 },
  { name: "装備", angle: 210 },
];
// 盤面は0〜100の座標。リングは中心寄りから外周へ。
const WARRIOR_WEB_RINGS = [18.8, 29.3, 39.2];
// 「剣撃突き」から紋章を経由して4方向へ魔力が流れる、中心の導線リング
const WARRIOR_WEB_CORE_BUS = 14.3;
// ノードの描画位置だけを定義する（正本のツリー構造は変えない）。
// lane=方向、ring=0中心寄り〜2外周、offset=角度の微調整、glyph=刻印、
// via=前提線の通り道（"core"=中心の導線、数値=その半径を回り込む）、ease=回り込みへ入る角度幅。
// radius=リング位置からの微調整（隣り合うノードや導線と重ならないように）。
// 基礎の3つは外周→中心へ進み、紋章に至ると残りの5方向へ広がる構成。
const WARRIOR_WEB_LAYOUT = {
  w1: { lane: 0, ring: 2, mark: "腕", glyph: "power" },
  w2: { lane: 0, ring: 1, mark: "勘", glyph: "insight" },
  w3: { lane: 0, ring: 0, mark: "剣", glyph: "thrust" },
  w4b: { lane: 1, ring: 0, mark: "猛", glyph: "crossed", via: "core" },
  w7b: { lane: 1, ring: 1, mark: "豪", glyph: "claws" },
  w10b: { lane: 1, ring: 2, mark: "覇", glyph: "aura", via: 44.4 },
  w5: { lane: 2, ring: 0, mark: "鎧", glyph: "armorBreak", via: "core" },
  w6: { lane: 2, ring: 1, mark: "力", glyph: "might" },
  w11: { lane: 2, ring: 2, mark: "頂", glyph: "summit", offset: 6 },
  w8: { lane: 3, ring: 0, mark: "鬨", glyph: "banner", radius: 18 },
  w9: { lane: 3, ring: 1, mark: "歴", glyph: "heart", radius: 29 },
  w12: { lane: 3, ring: 2, mark: "奥", glyph: "ultimate", radius: 39 },
  w4a: { lane: 4, ring: 0, mark: "守", glyph: "rooted", via: "core" },
  w7a: { lane: 4, ring: 1, mark: "鉄", glyph: "tower", via: 23.8, ease: 20 },
  w10a: { lane: 4, ring: 2, mark: "闘", glyph: "flame" },
  w_acc2: { lane: 5, ring: 0, mark: "極", glyph: "amulet", via: "core" },
  w_acc1: { lane: 5, ring: 1, mark: "装", glyph: "ring" },
};
// 詳細パネルの短いフレーバー文（表示専用。効果説明は正本の desc を使う）
const WARRIOR_CREST_FLAVOR = {
  w1: "振るい続けた腕こそ、最初の剣。",
  w2: "刃より先に、勘が敵を捉える。",
  w3: "真っ直ぐに、より深く。",
  w4a: "大地に根を張れ。揺らぐのは敵の方だ。",
  w4b: "守りは捨てた。攻めこそが盾となる。",
  w5: "どれほど堅い鎧も、一点から砕ける。",
  w6: "理屈を超える、ただ純粋な力。",
  w7a: "この背の後ろへは、誰も通さない。",
  w7b: "一撃に、すべての重さを乗せる。",
  w8: "吼えよ。仲間の剣に火が灯る。",
  w9: "刻まれた傷の数だけ、倒れぬ体になる。",
  w10a: "受けた痛みを、燃える力に変えて。",
  w10b: "立つだけで、敵の足がすくむ。",
  w11: "剣の道、その頂に風が吹く。",
  w12: "剛勇の紋章よ、すべてを断て。",
  w_acc1: "良き戦士は、良き道具を知る。",
  w_acc2: "身に着けたすべてが、己の力となる。",
};

function warriorWebPolar(angle, radius) {
  const t = angle * Math.PI / 180;
  return { x: 50 + radius * Math.cos(t), y: 50 + radius * Math.sin(t) };
}
function warriorWebPlace(nodeId) {
  const layout = WARRIOR_WEB_LAYOUT[nodeId];
  return { angle: WARRIOR_WEB_LANES[layout.lane].angle + (layout.offset || 0),
    radius: layout.radius || WARRIOR_WEB_RINGS[layout.ring] };
}
// 互換: 方向とリングから座標を得る（外部の検証用）
function warriorWebPoint(lane, ring) {
  return warriorWebPolar(WARRIOR_WEB_LANES[lane].angle, WARRIOR_WEB_RINGS[ring]);
}
// 角度と半径を同時に補間する（中心を突っ切らず、紋章盤の円に沿って曲がる線）
function warriorWebSpiral(a1, r1, a2, r2) {
  const delta = ((a2 - a1 + 540) % 360) - 180;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 4));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push(warriorWebPolar(a1 + delta * i / steps, r1 + (r2 - r1) * i / steps));
  }
  return points;
}
// 実データの前提線（親→子）を、盤面の刻印に沿う導線として描くパス
function warriorWebLinkPath(parentId, childId) {
  const a = warriorWebPlace(parentId);
  const b = warriorWebPlace(childId);
  const via = WARRIOR_WEB_LAYOUT[childId].via;
  let points;
  if (via != null) {
    const r = via === "core" ? WARRIOR_WEB_CORE_BUS : via;
    const ease = WARRIOR_WEB_LAYOUT[childId].ease || 0;
    const dir = (((b.angle - a.angle + 540) % 360) - 180) < 0 ? -1 : 1;
    const a2 = a.angle + dir * ease, b2 = b.angle - dir * ease;
    // 親から導線の半径へ（ease>0なら斜めに滑らかに）→導線に沿って回る→子へ
    points = (ease ? warriorWebSpiral(a.angle, a.radius, a2, r) : [warriorWebPolar(a.angle, a.radius)])
      .concat(warriorWebSpiral(a2, r, b2, r).slice(ease ? 1 : 0),
        ease ? warriorWebSpiral(b2, r, b.angle, b.radius).slice(1) : [warriorWebPolar(b.angle, b.radius)]);
  } else {
    points = warriorWebSpiral(a.angle, a.radius, b.angle, b.radius);
  }
  return "M" + points.map((p) => p.x.toFixed(2) + " " + p.y.toFixed(2)).join("L");
}

// ---------- 刻印（ノード・詳細アイコン用の線画SVG。CSSの色を継承し、画像ファイルに依存しない） ----------
function warriorGlyphCircle(cx, cy, r) {
  return "M" + (cx - r) + " " + cy + "a" + r + " " + r + " 0 1 0 " + (2 * r) + " 0a" + r + " " + r + " 0 1 0 " + (-2 * r) + " 0";
}
const WARRIOR_CREST_GLYPHS = {
  power: ["M16 28V7", "M8.5 14.5L16 6l7.5 8.5", "M10 21h12", "M12 25h8"],
  insight: ["M3.5 16Q16 4.5 28.5 16Q16 27.5 3.5 16Z", warriorGlyphCircle(16, 16, 4.2), warriorGlyphCircle(16, 16, 1.1), "M16 2.5v3M16 26.5v3"],
  thrust: ["M9.5 22.5L24 8l3-3-.8 4.6-14.8 14.8Z", "M7.5 19.5l5 5", "M10 23l-4.5 4.5", "M3.5 12h7M6 7.5h6M15 27.5h6"],
  crossed: ["M6 5l17.5 17.5", "M26 5L8.5 22.5", "M19.5 25l5.5-5.5", "M7 19.5l5.5 5.5", "M22.5 22.5l4 4M9.5 22.5l-4 4"],
  rooted: ["M16 4l10 3.6v8.2c0 6-4.2 10.2-10 12.2C10.2 26 6 21.8 6 15.8V7.6Z", "M11 11.5l5 4 5-4", "M11 17l5 4 5-4"],
  armorBreak: ["M7 25V15.5C7 9.5 11 6 16 6s9 3.5 9 9.5V25Z", "M10.5 17h11", "M16 6l-2 5 3.5 3-3 4.5 2 6.5"],
  might: ["M5 8.5h14.5v7.5H5Z", "M12.25 16v12.5", "M23 7.5l4.5-3M23.5 12.25H29M23 17l4.5 3"],
  tower: ["M7 5h18v14.5c0 5-4 8.2-9 9.5-5-1.3-9-4.5-9-9.5Z", "M16 5v24", "M7 12.5h18", warriorGlyphCircle(11.5, 8.7, .9), warriorGlyphCircle(20.5, 8.7, .9)],
  claws: ["M6.5 25Q12 14 21 5", "M11 27.5Q17 16 26 8.5", "M16.5 29Q22 20 28.5 14.5"],
  banner: ["M8 3.5v25.5", "M8 5.5h15l-3.5 5 3.5 5H8", "M24.5 20.5q2 2.5 0 5M27.5 18.5q3.5 4.5 0 9"],
  heart: ["M16 27.5L6.5 18C3 14.5 3.5 9.5 7.5 7.5c3-1.5 6 0 8.5 3 2.5-3 5.5-4.5 8.5-3 4 2 4.5 7 1 10.5Z", "M10.5 12.5l9.5 9", "M12.5 17.5l2.4-2.4M16 21l2.4-2.4"],
  flame: ["M16 3.5C20 9 24.5 13.5 24.5 19.5a8.5 8.5 0 0 1-17 0C7.5 13.5 12 9 16 3.5Z", "M16 13.5c2.4 3 3.8 5 3.8 7a3.8 3.8 0 0 1-7.6 0c0-2 1.4-4 3.8-7Z"],
  aura: ["M16 2.5l2.4 7.4 7.6-3-3.6 7.2L29.5 18l-7.8 1.4L23 27.5l-7-4.6-7 4.6 1.3-8.1L2.5 18l7.1-3.9L6 6.9l7.6 3Z", warriorGlyphCircle(16, 16, 3.2)],
  summit: ["M3 28.5L11.5 15l4.5 6 6-10 7 17.5Z", "M22 2.5V11", "M19.2 6h5.6"],
  ultimate: ["M7.5 24.5L24 8l2.5-2.5-.6 3.1-16.4 16.4", "M24.5 24.5L8 8 5.5 5.5l.6 3.1 16.4 16.4", "M9.5 19.5l3 3M22.5 19.5l-3 3", warriorGlyphCircle(6.2, 25.8, 1.6), warriorGlyphCircle(25.8, 25.8, 1.6), "M16 11.5l1.6 3 3.2.4-2.3 2.2.6 3.2-3.1-1.6-3.1 1.6.6-3.2-2.3-2.2 3.2-.4Z"],
  ring: [warriorGlyphCircle(16, 19.5, 7.5), warriorGlyphCircle(16, 19.5, 4.4), "M12.5 9.5L16 5l3.5 4.5L16 12.2Z"],
  amulet: ["M8 3.5q8 9 16 0", "M16 10.5l6.5 5.5-3 9.5h-7l-3-9.5Z", "M9.5 16h13", "M16 10.5l-2.6 5.5 2.6 9.5 2.6-9.5Z"],
  lock: ["M9 15h14v11.5H9Z", "M12 15v-3.5a4 4 0 0 1 8 0V15", "M16 19.5v3"],
  seal: ["M9 15h14v11.5H9Z", "M12 15v-3.5a4 4 0 0 1 8 0V15", "M16 19.5v3", "M3.5 5.5l5 4M28.5 5.5l-5 4M3.5 30l5-3.5M28.5 30l-5-3.5"],
  gem: ["M16 3l12 11.5L16 29 4 14.5Z", "M4 14.5h24", "M10 8.8l6 5.7 6-5.7"],
  blade: ["M16 3l3 5v14l-3 5-3-5V8Z", "M16 3v24", "M8 19h16", "M11 27h10"],
};
function createWarriorCrestGlyph(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("tree-web-glyph");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  for (const d of WARRIOR_CREST_GLYPHS[kind] || WARRIOR_CREST_GLYPHS.blade) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
// ノードの形（パッシブ=円、アクティブ=菱形、装備=宝石の六角印章、奥義=八芒星）
function warriorNodeShape(node) {
  if (node.id === "w12") return "ultimate";
  if (WARRIOR_WEB_LAYOUT[node.id] && WARRIOR_WEB_LAYOUT[node.id].lane === 5) return "gem";
  return node.kind === "active" ? "diamond" : "circle";
}
function warriorShapePolygon(count, radii, start) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (start + i * 360 / count) * Math.PI / 180;
    const r = radii[i % radii.length];
    pts.push((r * Math.cos(a)).toFixed(2) + " " + (r * Math.sin(a)).toFixed(2));
  }
  return "M" + pts.join("L") + "Z";
}
function warriorShapePaths(shape) {
  if (shape === "diamond") return { rim: "M0 -21.5L21.5 0L0 21.5L-21.5 0Z", core: "M0 -16.2L16.2 0L0 16.2L-16.2 0Z" };
  if (shape === "gem") return { rim: warriorShapePolygon(6, [20.6], -90), core: warriorShapePolygon(6, [15.6], -90) };
  if (shape === "ultimate") return { rim: warriorShapePolygon(16, [22.5, 17.6], -90), core: warriorGlyphCircle(0, 0, 14.6), ring: warriorGlyphCircle(0, 0, 11.8) };
  return { rim: warriorGlyphCircle(0, 0, 19.2), core: warriorGlyphCircle(0, 0, 14.8) };
}
// 枠（縁・内側・光沢）。色は状態クラスのCSS変数で切り替える
function createWarriorNodeFrame(shape) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("tree-web-frame");
  svg.setAttribute("viewBox", "-23 -23 46 46");
  svg.setAttribute("aria-hidden", "true");
  const paths = warriorShapePaths(shape);
  for (const [cls, d] of [["f-rim", paths.rim], ["f-core", paths.core], ["f-ring", paths.ring],
    ["f-shine", "M-11 -9.5Q0 -17 11 -9.5Q0 -12.5 -11 -9.5Z"]]) {
    if (!d) continue;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    svg.appendChild(path);
  }
  return svg;
}
// 中央・見出しの剣紋章（塗り＋線の大きな紋章。グラデーションIDは画面内で1組だけ使う）
function createWarriorCoreEmblem(extraClass) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("crest-emblem");
  if (extraClass) svg.classList.add(extraClass);
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
    return el;
  };
  add("path", { class: "e-star", d: "M50 3L54.5 45.5L97 50L54.5 54.5L50 97L45.5 54.5L3 50L45.5 45.5Z" });
  add("path", { class: "e-star e-star--minor", d: "M50 50L72 28M50 50L72 72M50 50L28 72M50 50L28 28" });
  add("path", { class: "e-ring", d: warriorGlyphCircle(50, 50, 41) });
  add("path", { class: "e-ring e-ring--dash", d: warriorGlyphCircle(50, 50, 35.5) });
  add("path", { class: "e-blade", d: "M50 9L55.5 20L55.5 63L50 71L44.5 63L44.5 20Z" });
  add("path", { class: "e-fuller", d: "M50 19V62" });
  add("path", { class: "e-guard", d: "M27 62Q38 67.5 50 63Q62 67.5 73 62L68.5 69.5Q59 67.5 50 71Q41 67.5 31.5 69.5Z" });
  add("path", { class: "e-grip", d: "M46.6 71H53.4V84H46.6Z" });
  add("path", { class: "e-pommel", d: warriorGlyphCircle(50, 88.5, 4.4) });
  add("path", { class: "e-gem", d: "M50 62.5L53.5 66.5L50 70.5L46.5 66.5Z" });
  return svg;
}

// ---------- 画面上部（せんしのみ）: タイトルとSP ----------
function buildWarriorCrestScreenHead(available, total) {
  const frag = document.createElement("div");
  frag.className = "crest-screen-bar";
  const title = document.createElement("div");
  title.className = "crest-screen-title";
  const kicker = document.createElement("span");
  kicker.className = "crest-screen-kicker";
  kicker.textContent = "SWORD CREST ✦";
  const name = document.createElement("span");
  name.className = "crest-screen-name";
  name.textContent = "スキルツリー";
  title.appendChild(kicker);
  title.appendChild(name);
  frag.appendChild(title);
  const sp = document.createElement("div");
  sp.className = "crest-sp";
  sp.setAttribute("aria-label", "スキルポイント 残り" + available + "／合計" + total);
  sp.appendChild(createWarriorCrestGlyph("gem"));
  const label = document.createElement("span");
  label.className = "crest-sp-label";
  label.textContent = "SP";
  const value = document.createElement("span");
  value.className = "crest-sp-value";
  value.textContent = String(available);
  const max = document.createElement("span");
  max.className = "crest-sp-total";
  max.textContent = "/ " + total;
  sp.appendChild(label);
  sp.appendChild(value);
  sp.appendChild(max);
  const actions = document.createElement("div");
  actions.className = "crest-screen-actions";
  actions.appendChild(sp);
  frag.appendChild(actions);
  frag.crestActions = actions; // リセット札の差し込み先
  return frag;
}

// ---------- 盤面の装飾（同心円・放射線・古金の外枠・刻印。すべて当たり判定なしの背景ガイド） ----------
function drawWarriorWebBoard(addSvg, svg) {
  const defs = addSvg("defs", {}, svg);
  const board = addSvg("radialGradient", { id: "wcBoardGrad", cx: "50%", cy: "50%", r: "50%" }, defs);
  addSvg("stop", { offset: "0%", "stop-color": "#163a44", "stop-opacity": ".78" }, board);
  addSvg("stop", { offset: "42%", "stop-color": "#0b2029", "stop-opacity": ".74" }, board);
  addSvg("stop", { offset: "86%", "stop-color": "#050f15", "stop-opacity": ".82" }, board);
  addSvg("stop", { offset: "100%", "stop-color": "#03090d", "stop-opacity": ".55" }, board);
  const gold = addSvg("linearGradient", { id: "wcGoldStroke", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
  addSvg("stop", { offset: "0%", "stop-color": "#f3dca0" }, gold);
  addSvg("stop", { offset: "50%", "stop-color": "#a77d3e" }, gold);
  addSvg("stop", { offset: "100%", "stop-color": "#e2bf78" }, gold);
  const core = addSvg("radialGradient", { id: "wcCoreHalo", cx: "50%", cy: "50%", r: "50%" }, defs);
  addSvg("stop", { offset: "0%", "stop-color": "#5fd3f0", "stop-opacity": ".42" }, core);
  addSvg("stop", { offset: "60%", "stop-color": "#1f6f86", "stop-opacity": ".12" }, core);
  addSvg("stop", { offset: "100%", "stop-color": "#1f6f86", "stop-opacity": "0" }, core);

  addSvg("circle", { cx: 50, cy: 50, r: 49.4, class: "tree-web-disc", fill: "url(#wcBoardGrad)" }, svg);
  // 枝ごとの淡い色の扇（色分けはやりすぎず、方向の気配だけ）
  WARRIOR_WEB_LANES.forEach((lane, i) => {
    const a1 = lane.angle - 27, a2 = lane.angle + 27;
    const p1 = warriorWebPolar(a1, 44), p2 = warriorWebPolar(a2, 44);
    const q1 = warriorWebPolar(a2, 15), q2 = warriorWebPolar(a1, 15);
    addSvg("path", {
      d: "M" + p1.x.toFixed(2) + " " + p1.y.toFixed(2) + "A44 44 0 0 1 " + p2.x.toFixed(2) + " " + p2.y.toFixed(2) +
        "L" + q1.x.toFixed(2) + " " + q1.y.toFixed(2) + "A15 15 0 0 0 " + q2.x.toFixed(2) + " " + q2.y.toFixed(2) + "Z",
      class: "tree-web-sector tree-web-sector--" + i,
    }, svg);
  });
  addSvg("circle", { cx: 50, cy: 50, r: 22, fill: "url(#wcCoreHalo)", class: "tree-web-halo" }, svg);
  // 古金の外枠（二重線＋目盛＋ルーン帯）
  for (const [r, cls] of [[48.4, "tree-web-frame-line"], [46.2, "tree-web-frame-line thin"], [43.8, "tree-web-frame-line thin"]]) {
    addSvg("circle", { cx: 50, cy: 50, r, class: cls }, svg);
  }
  for (let i = 0; i < 72; i++) {
    const a = i * 5;
    const long = i % 6 === 0;
    const p = warriorWebPolar(a, long ? 46.4 : 47.2);
    const q = warriorWebPolar(a, 48.2);
    addSvg("line", { x1: p.x.toFixed(2), y1: p.y.toFixed(2), x2: q.x.toFixed(2), y2: q.y.toFixed(2), class: "tree-web-tick" }, svg);
  }
  // ルーン風の刻印（意味のない線刻。フォントに依存しない）
  const runeShapes = [
    [[0, -0.9, 0, 0.9], [0, -0.9, 0.6, -0.3]],
    [[0, -0.9, 0, 0.9], [0, -0.2, 0.6, 0.4], [0, -0.2, -0.6, 0.4]],
    [[-0.5, -0.9, 0.5, 0.9], [0.5, -0.9, -0.5, 0.9]],
    [[0, -0.9, 0, 0.9], [0, -0.9, 0.6, -0.5], [0.6, -0.5, 0, -0.1]],
    [[-0.55, 0.9, 0, -0.9], [0, -0.9, 0.55, 0.9]],
    [[0, -0.9, 0, 0.9], [-0.55, -0.4, 0.55, 0.2]],
  ];
  let runes = "";
  for (let i = 0; i < 84; i++) {
    const angle = i * 360 / 84 + 2;
    if (WARRIOR_WEB_LANES.some((lane) => Math.abs(((angle - lane.angle + 540) % 360) - 180) < 9)) continue;
    const t = angle * Math.PI / 180;
    const c = warriorWebPolar(angle, 45);
    const ux = -Math.sin(t), uy = Math.cos(t); // 接線方向
    const vx = Math.cos(t), vy = Math.sin(t); // 半径方向
    for (const [u1, v1, u2, v2] of runeShapes[(i * 7) % runeShapes.length]) {
      const s = 0.62;
      runes += "M" + (c.x + (u1 * ux + v1 * vx) * s).toFixed(2) + " " + (c.y + (u1 * uy + v1 * vy) * s).toFixed(2) +
        "L" + (c.x + (u2 * ux + v2 * vx) * s).toFixed(2) + " " + (c.y + (u2 * uy + v2 * vy) * s).toFixed(2);
    }
  }
  addSvg("path", { d: runes, class: "tree-web-runes" }, svg);
  // 背景ガイド: 同心円（各リング）と放射線。実際の前提線とは別の、細く暗い線で描く
  WARRIOR_WEB_RINGS.forEach((r) => addSvg("circle", { cx: 50, cy: 50, r, class: "tree-web-ring" }, svg));
  for (const r of [22.6, 34.2]) addSvg("circle", { cx: 50, cy: 50, r, class: "tree-web-orbit" }, svg);
  WARRIOR_WEB_LANES.forEach((lane) => {
    const p = warriorWebPolar(lane.angle, 15.5), q = warriorWebPolar(lane.angle, 43.8);
    addSvg("line", { x1: p.x.toFixed(2), y1: p.y.toFixed(2), x2: q.x.toFixed(2), y2: q.y.toFixed(2), class: "tree-web-spoke" }, svg);
    const m1 = warriorWebPolar(lane.angle + 30, 15.5), m2 = warriorWebPolar(lane.angle + 30, 43.8);
    addSvg("line", { x1: m1.x.toFixed(2), y1: m1.y.toFixed(2), x2: m2.x.toFixed(2), y2: m2.y.toFixed(2), class: "tree-web-spoke-minor" }, svg);
  });
  // 中心の魔法陣（六芒星と二重円）
  const tri = (start) => [0, 1, 2].map((k) => warriorWebPolar(start + k * 120, 16.6))
    .map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(" ");
  addSvg("polygon", { points: tri(-90), class: "tree-web-sigil" }, svg);
  addSvg("polygon", { points: tri(90), class: "tree-web-sigil" }, svg);
  addSvg("circle", { cx: 50, cy: 50, r: 16.6, class: "tree-web-sigil-ring" }, svg);
  addSvg("circle", { cx: 50, cy: 50, r: WARRIOR_WEB_CORE_BUS, class: "tree-web-sigil-ring faint" }, svg);
}

// 表示範囲の平行移動・ズームはセーブ対象にしない（詳細画面の再描画で視点だけ保持）。
// 全体表示は少し余白を持たせ、さらに「−」1回で見渡せる縮小段階を用意する。
const WARRIOR_WEB_MIN_SCALE = 0.8;
const WARRIOR_WEB_DEFAULT_SCALE = 0.92;
const WARRIOR_WEB_MAX_SCALE = 2.5;
const WARRIOR_WEB_ZOOM_STEP = 0.12;
const warriorWebView = { scale: WARRIOR_WEB_DEFAULT_SCALE, x: 0, y: 0 };
let warriorWebRevealId = null;
function buildWarriorWebGraph(c, scopeKey, treeDef, ranks) {
  const wrap = document.createElement("div");
  wrap.className = "tree-web tree-web--crest";

  // 見出し: 剣紋章＋「せんし」「剛勇の心得」＋拡大縮小
  const banner = document.createElement("div");
  banner.className = "crest-banner";
  const emblem = document.createElement("div");
  emblem.className = "crest-banner-emblem";
  emblem.appendChild(createWarriorCoreEmblem("crest-emblem--banner"));
  banner.appendChild(emblem);
  const text = document.createElement("div");
  text.className = "crest-banner-text";
  const job = document.createElement("span");
  job.className = "crest-banner-job";
  job.textContent = "せんし";
  const tree = document.createElement("span");
  tree.className = "crest-banner-tree";
  tree.textContent = treeDef.name;
  const rule = document.createElement("span");
  rule.className = "crest-banner-rule";
  text.appendChild(job);
  text.appendChild(tree);
  text.appendChild(rule);
  banner.appendChild(text);
  const controls = document.createElement("div");
  controls.className = "tree-web-controls";

  // 盤面と6系統の札を別レイヤーに分離。拡大時も方向札は位置固定。
  const stage = document.createElement("div");
  stage.className = "crest-tree-stage";
  const viewport = document.createElement("div");
  viewport.className = "tree-web-viewport";
  viewport.setAttribute("aria-label", "せんしのスキルツリー（剛勇の紋章盤）。ピンチで拡大、指で移動");
  const scene = document.createElement("div");
  scene.className = "tree-web-scene";
  viewport.appendChild(scene);
  wrap.appendChild(banner);
  stage.appendChild(viewport);
  wrap.appendChild(stage);
  // 2枚目の見本にない「−／＋／全体」3連ボタンは常時重ねない。
  // ピンチ操作とズーム機能は維持し、必要時だけ「表示調整」から操作する。
  const zoomPanel = document.createElement("details");
  zoomPanel.className = "crest-zoom-options";
  const zoomTitle = document.createElement("summary");
  zoomTitle.textContent = "表示調整";
  zoomPanel.appendChild(zoomTitle);
  zoomPanel.appendChild(controls);
  wrap.appendChild(zoomPanel);

  const applyView = () => {
    const width = viewport.clientWidth || 320;
    const height = viewport.clientHeight || width;
    // 1倍未満の時は盤面を中央固定。負の移動上限で中心がずれるのを防ぐ。
    const maxX = Math.max(0, (warriorWebView.scale - 1) * width / 2);
    const maxY = Math.max(0, (warriorWebView.scale - 1) * height / 2);
    warriorWebView.x = Math.max(-maxX, Math.min(maxX, warriorWebView.x));
    warriorWebView.y = Math.max(-maxY, Math.min(maxY, warriorWebView.y));
    scene.style.transform = "translate(" + warriorWebView.x + "px, " +
      warriorWebView.y + "px) scale(" + warriorWebView.scale + ")";
    // 拡大中だけ盤面がドラッグを専有する（等倍時は縦スクロール可）
    viewport.className = "tree-web-viewport" + (warriorWebView.scale > 1.001 ? " is-zoomed" : "");
  };
  const changeScale = (value) => {
    warriorWebView.scale = Math.max(WARRIOR_WEB_MIN_SCALE,
      Math.min(WARRIOR_WEB_MAX_SCALE, Math.round(value * 100) / 100));
    applyView();
  };
  for (const [label, action, hint] of [
    ["−", () => changeScale(warriorWebView.scale - WARRIOR_WEB_ZOOM_STEP), "縮小"],
    ["＋", () => changeScale(warriorWebView.scale + WARRIOR_WEB_ZOOM_STEP), "拡大"],
    ["全体", () => { warriorWebView.scale = WARRIOR_WEB_DEFAULT_SCALE;
      warriorWebView.x = warriorWebView.y = 0; applyView(); }, "全体表示"],
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
  drawWarriorWebBoard(addSvg, svg);

  // ノード状態（表示用）。判定は既存の canAcquireNode と ranks のみ
  const byId = Object.fromEntries(treeDef.nodes.map((node) => [node.id, node]));
  const stateOf = {};
  for (const node of treeDef.nodes) {
    const acquired = (ranks[node.id] || 0) > 0;
    const canGet = !acquired && canAcquireNode(c, treeDef, ranks, node);
    const sealed = !!(node.exclusiveGroup && !acquired &&
      treeDef.nodes.some((other) => other.id !== node.id &&
        other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0));
    stateOf[node.id] = { acquired, canGet, sealed, levelLocked: node.reqLevel > c.level };
  }

  // 実データの前提線。下地（溝）→線→魔力の流れの順に重ね、習得済みルートを最前面へ
  const links = [];
  for (const node of treeDef.nodes) {
    for (const pre of node.prerequisites) {
      if (!byId[pre.nodeId]) continue;
      const acquired = (ranks[node.id] || 0) >= pre.minRank && (ranks[pre.nodeId] || 0) >= pre.minRank;
      const parentDone = (ranks[pre.nodeId] || 0) >= pre.minRank;
      const st = stateOf[node.id];
      const kind = acquired ? "acquired" : st.sealed ? "sealed" : parentDone && st.canGet ? "ready" : "dormant";
      links.push({ d: warriorWebLinkPath(pre.nodeId, node.id), kind, lane: WARRIOR_WEB_LAYOUT[node.id].lane });
    }
  }
  const order = { sealed: 0, dormant: 1, ready: 2, acquired: 3 };
  links.sort((a, b) => order[a.kind] - order[b.kind]);
  const linkLayer = addSvg("g", { class: "tree-web-link-layer" }, svg);
  for (const link of links) {
    addSvg("path", { d: link.d, class: "tree-web-link-bed" }, linkLayer);
    if (link.kind === "acquired") addSvg("path", { d: link.d, class: "tree-web-link-glow" }, linkLayer);
    addSvg("path", { d: link.d, class: "tree-web-link " + link.kind + " lane-" + link.lane }, linkLayer);
    if (link.kind === "acquired" || link.kind === "ready") {
      addSvg("path", { d: link.d, class: "tree-web-link-flow " + link.kind }, linkLayer);
    }
  }
  scene.appendChild(svg);

  // 中央の剣紋章（盤面の主役）。「剣撃突き」習得で紋章に魔力が満ちる
  const core = document.createElement("div");
  const coreLit = (ranks.w3 || 0) > 0;
  core.className = "tree-web-core" + (coreLit ? " lit" : "");
  core.appendChild(createWarriorCoreEmblem());
  core.setAttribute("aria-hidden", "true");
  scene.appendChild(core);

  // 六方向の札は盤の外側へ。画面の縮小・拡大やノード線と一緒に動かない。
  const labelAnchors = [
    [50, 0], [86, 17], [86, 83], [50, 99], [14, 83], [14, 17],
  ];
  WARRIOR_WEB_LANES.forEach((lane, i) => {
    const label = document.createElement("span");
    label.className = "tree-web-lane tree-web-lane--" + i;
    label.style.left = labelAnchors[i][0] + "%";
    label.style.top = labelAnchors[i][1] + "%";
    label.textContent = lane.name;
    stage.appendChild(label);
  });

  for (const node of treeDef.nodes) {
    const layout = WARRIOR_WEB_LAYOUT[node.id];
    const place = warriorWebPlace(node.id);
    const p = warriorWebPolar(place.angle, place.radius);
    const st = stateOf[node.id];
    const shape = warriorNodeShape(node);
    const selected = !!(treeSelectedNode && treeSelectedNode.scope === scopeKey && treeSelectedNode.nodeId === node.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-web-node tree-web-node--lane-" + layout.lane + " shape-" + shape +
      (node.kind === "active" ? " active-kind" : " passive-kind") +
      (node.id === "w12" ? " ultimate-kind" : "") +
      (shape === "gem" ? " gear-kind" : "") +
      (st.acquired ? " acquired" : st.canGet ? " available" : " locked") +
      (st.sealed ? " choice-sealed" : "") +
      (!st.acquired && st.levelLocked ? " level-locked" : "") +
      (selected ? " selected" : "");
    btn.style.left = p.x + "%";
    btn.style.top = p.y + "%";
    const aura = document.createElement("span");
    aura.className = "tree-web-node-aura";
    btn.appendChild(aura);
    btn.appendChild(createWarriorNodeFrame(shape));
    const sealedLook = !st.acquired && (st.sealed || st.levelLocked);
    btn.appendChild(createWarriorCrestGlyph(sealedLook ? (st.sealed ? "seal" : "lock") : layout.glyph));
    // SVGが表示できない環境でもノードを見分けられるよう略字を持つ。
    const fallback = document.createElement("span");
    fallback.className = "tree-web-node-mark";
    fallback.textContent = layout.mark;
    btn.appendChild(fallback);
    btn.title = node.name;
    const stateText = st.acquired ? "習得済み" : st.canGet ? "習得可能" : st.sealed ? "二択で封印中" :
      st.levelLocked ? "Lv" + node.reqLevel + "で解放" : "未解放";
    btn.setAttribute("aria-label", node.name + "、" + WARRIOR_WEB_LANES[layout.lane].name + "、" + stateText + "、必要Lv" + node.reqLevel);
    btn.setAttribute("aria-pressed", String(selected));
    btn.addEventListener("click", () => {
      treeSelectedNode = { scope: scopeKey, nodeId: node.id };
      treeSwapConfirm = null;
      warriorWebRevealId = node.id;
      renderCharDetail();
    });
    scene.appendChild(btn);
    // 選んだ直後だけ、下部パネルに隠れないよう選択ノードを画面内へ寄せる（スクロール位置は保存しない）
    if (selected && warriorWebRevealId === node.id) {
      warriorWebRevealId = null;
      if (typeof requestAnimationFrame === "function" && btn.scrollIntoView) {
        requestAnimationFrame(() => btn.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
    }
  }

  const legend = document.createElement("div");
  legend.className = "tree-web-legend";
  for (const [cls, label] of [["learned", "習得済み"], ["ready", "習得可能"], ["dormant", "未解放"], ["sealed", "封印"]]) {
    const key = document.createElement("span");
    key.className = "tree-web-key " + cls;
    const chip = document.createElement("i");
    chip.setAttribute("aria-hidden", "true");
    key.appendChild(chip);
    const keyText = document.createElement("span");
    keyText.textContent = label;
    key.appendChild(keyText);
    legend.appendChild(key);
  }
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
    // 1倍以下の1本指は縦スクロールに任せ、詳細パネルへ進める。
    if (!pinch && warriorWebView.scale <= 1) return;
    if (event.cancelable) event.preventDefault();
    if (!pinch) {
      warriorWebView.x = gesture.x + a.x - gesture.start.x;
      warriorWebView.y = gesture.y + a.y - gesture.start.y;
    } else {
      const b = touchPoint(event.touches[1]);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = viewport.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const scale = Math.max(WARRIOR_WEB_MIN_SCALE, Math.min(WARRIOR_WEB_MAX_SCALE,
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
        (event.target.closest && event.target.closest(".tree-web-node, .tree-web-control"))) return;
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

// ---------- 下部の専用詳細パネル（せんしのみ） ----------
function buildWarriorCrestDetail(c, treeDef, ranks, node, panel) {
  const layout = WARRIOR_WEB_LAYOUT[node.id];
  const rank = ranks[node.id] || 0;
  const acquired = rank > 0;
  const canGet = !acquired && canAcquireNode(c, treeDef, ranks, node);
  const levelLocked = !acquired && node.reqLevel > c.level;
  const rival = node.exclusiveGroup ? treeDef.nodes.find((other) => other.id !== node.id &&
    other.exclusiveGroup === node.exclusiveGroup) : null;
  const sealed = !acquired && !!rival && (ranks[rival.id] || 0) > 0;
  const lane = layout ? layout.lane : 0;
  const shape = warriorNodeShape(node);
  const stateClass = acquired ? "acquired" : canGet ? "available" : "locked";
  panel.classList.add("lane-" + lane);
  panel.classList.add(stateClass);

  const card = document.createElement("div");
  card.className = "crest-detail-card";
  const close = document.createElement("button");
  close.className = "tree-node-detail-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => { treeSelectedNode = null; renderCharDetail(); });
  card.appendChild(close);

  const main = document.createElement("div");
  main.className = "crest-detail-main";
  const icon = document.createElement("div");
  icon.className = "crest-detail-icon tree-web-node--lane-" + lane + " shape-" + shape + " " + stateClass +
    (sealed ? " choice-sealed" : "");
  const iconAura = document.createElement("span");
  iconAura.className = "tree-web-node-aura";
  icon.appendChild(iconAura);
  icon.appendChild(createWarriorNodeFrame(shape));
  icon.appendChild(createWarriorCrestGlyph(layout ? layout.glyph : "blade"));
  main.appendChild(icon);

  const info = document.createElement("div");
  info.className = "crest-detail-info";
  const name = document.createElement("div");
  name.className = "tree-node-detail-name";
  name.textContent = node.name;
  info.appendChild(name);

  const tags = document.createElement("div");
  tags.className = "crest-detail-tags";
  for (const [cls, label] of [
    ["kind", node.kind === "active" ? "アクティブ" : "パッシブ"],
    ["lane", WARRIOR_WEB_LANES[lane].name],
    ["state", acquired ? "習得済み" : canGet ? "習得可能" : sealed ? "封印" : "未解放"],
  ]) {
    const tag = document.createElement("span");
    tag.className = "crest-tag " + cls;
    tag.textContent = label;
    tags.appendChild(tag);
  }
  info.appendChild(tags);

  const facts = document.createElement("div");
  facts.className = "warrior-crest-facts";
  const prereqs = (node.prerequisites || []).map((pre) => {
    const parent = treeDef.nodes.find((other) => other.id === pre.nodeId);
    return parent ? parent.name : pre.nodeId;
  });
  const factRows = [
    ["sp", "必要SP", String(node.costByRank[acquired ? Math.max(0, rank - 1) : rank])],
    ["lv", "必要Lv", String(node.reqLevel)],
    ["pre", "前提", prereqs.length ? prereqs.join("・") : "なし"],
  ];
  if (rival) factRows.push(["rival", "二択", rival.name]);
  for (const [cls, label, value] of factRows) {
    const fact = document.createElement("span");
    fact.className = "crest-fact " + cls;
    fact.setAttribute("data-label", label);
    fact.textContent = label + " " + value;
    facts.appendChild(fact);
  }
  info.appendChild(facts);
  main.appendChild(info);
  card.appendChild(main);

  const desc = document.createElement("div");
  desc.className = "tree-node-detail-desc";
  desc.textContent = node.desc || "";
  card.appendChild(desc);
  if (node.ability && node.ability.desc && !(node.desc || "").includes(node.ability.desc)) {
    const ability = document.createElement("div");
    ability.className = "crest-detail-ability";
    ability.textContent = "技: " + node.ability.desc + (node.ability.mpCost ? "（消費MP" + node.ability.mpCost + "）" : "");
    card.appendChild(ability);
  }
  if (WARRIOR_CREST_FLAVOR[node.id]) {
    const flavor = document.createElement("div");
    flavor.className = "crest-detail-flavor";
    flavor.textContent = "「" + WARRIOR_CREST_FLAVOR[node.id] + "」";
    card.appendChild(flavor);
  }
  panel.appendChild(card);

  if (acquired) {
    const state = document.createElement("div");
    state.className = "tree-node-detail-state crest-learned";
    state.textContent = "習得済み";
    panel.appendChild(state);
    return panel;
  }
  // 習得できない理由は表示だけ（可否そのものは canAcquireNode の結果）
  let reason = "";
  if (!canGet) {
    const missing = (node.prerequisites || []).find((pre) => (ranks[pre.nodeId] || 0) < pre.minRank);
    const missingNode = missing && treeDef.nodes.find((other) => other.id === missing.nodeId);
    if (c.team !== null && c.team !== undefined && isTeamLocked(c.team)) reason = "探索中は習得できません";
    else if (sealed) reason = "二択の「" + rival.name + "」を習得済み";
    else if (levelLocked) reason = `🔒 ジョブのLv${node.reqLevel}で解放（今はLv${c.level}）`;
    else if (missingNode) reason = "先に「" + missingNode.name + "」を習得";
    else reason = "SPが足りません";
  }
  const btn = document.createElement("button");
  btn.className = "btn primary small crest-learn-btn";
  const main1 = document.createElement("span");
  main1.className = "crest-learn-main";
  main1.textContent = "習得する";
  const sub = document.createElement("span");
  sub.className = "crest-learn-sub";
  sub.textContent = reason || `SP${node.costByRank[rank]}を使用／残り${availableSp(c)}`;
  btn.appendChild(main1);
  btn.appendChild(sub);
  btn.setAttribute("aria-label", `習得する（SP${node.costByRank[rank]}／残り${availableSp(c)}）`);
  btn.disabled = !canGet;
  btn.addEventListener("click", () => {
    acquireNode(c, treeDef, ranks, node);
    scheduleSave();
    renderCharDetail();
  });
  panel.appendChild(btn);
  return panel;
}

// 選択中ノードの詳細（説明・コスト・習得状況・習得ボタン）を分岐図の下に表示する
function buildTreeNodeDetail(c, treeDef, ranks, node, treeTitle) {
  const panel = document.createElement("div");
  const isWarrior = c.job === "warrior" && treeDef.id === "warrior" && !!WARRIOR_WEB_LAYOUT[node.id];
  panel.className = "tree-node-detail" + (isWarrior ? " warrior-crest-detail" : "");
  if (isWarrior) return buildWarriorCrestDetail(c, treeDef, ranks, node, panel);
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

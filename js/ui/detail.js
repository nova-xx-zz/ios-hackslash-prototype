// ---------- 画面: キャラ詳細（タブの切り替え） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- キャラ詳細 ----------
function openCharDetail(c) {
  detailCharId = c.id;
  detailTab = "stats";
  fusionSelection = new Set();
  fusionConfirm = false;
  fusionMessage = "";
  treeSelectedNode = null;
  treeSwapConfirm = null;
  renderCharDetail();
  showScreen("screen-chardetail");
}

// ---------- 仲間の切り替え（‹ ›） ----------
// 詳細を開いたまま、前後の仲間に切り替える（今のタブのまま）。並びはパーティ編成の画面と同じ
// 第一〜第四のパーティの順、その後に控え（未編成）
function detailOrder() {
  const order = [];
  for (let t = 0; t < TEAM_COUNT; t++) order.push(...teamMembers(t));
  for (const c of S.roster) if (!order.includes(c)) order.push(c);
  return order;
}
function switchDetail(delta) {
  const order = detailOrder();
  const i = order.findIndex((x) => x.id === detailCharId);
  if (order.length < 2 || i < 0) return;
  const next = order[(i + delta + order.length) % order.length];
  detailCharId = next.id;
  // そのキャラだけの選択状態（合成の素材・ツリーのノード・開いている装備枠）は持ち越さない
  fusionSelection = new Set();
  fusionConfirm = false;
  fusionMessage = "";
  treeSelectedNode = null;
  treeSwapConfirm = null;
  openSlot = null;
  renderCharDetail();
  document.getElementById("detailBody").scrollTop = 0;
}
document.getElementById("btnDetailPrev").addEventListener("click", () => switchDetail(-1));
document.getElementById("btnDetailNext").addEventListener("click", () => switchDetail(1));

const DETAIL_TABS = [
  { key: "stats", label: "能力値" },
  { key: "equip", label: "装備" },
  { key: "skill", label: "スキル" },
  { key: "tree", label: "ツリー" },
  { key: "job", label: "ジョブ" },
];

// キャラ詳細の上に一時的に出す知らせ（転職で装備を外した時など）
let detailNotice = "";
let detailNoticeTimer = null;
function flashDetailNotice(text) {
  detailNotice = text;
  clearTimeout(detailNoticeTimer);
  detailNoticeTimer = setTimeout(() => {
    detailNotice = "";
    if (!document.getElementById("screen-chardetail").classList.contains("hidden")) renderCharDetail();
  }, 3500);
}

function renderCharDetail() {
  scheduleSave();
  const c = S.roster.find((x) => x.id === detailCharId);
  if (!c) { showScreen("screen-jobs"); return; }
  document.getElementById("detailName").textContent =
    `${c.name}${c.isMonster ? "（テイム）" : ""}`;
  const order = detailOrder();
  const where = c.team !== null ? TEAM_LABELS[c.team] : "控え";
  document.getElementById("detailPos").textContent = `${where}・${order.indexOf(c) + 1}/${order.length}`;
  document.getElementById("btnDetailPrev").disabled = order.length < 2;
  document.getElementById("btnDetailNext").disabled = order.length < 2;

  renderDetailTabs();

  const wrap = document.getElementById("detailBody");
  wrap.innerHTML = "";

  // 探索中のチームに所属するキャラは、装備・スキル・転職・合成などを変更すると
  // 戦闘中の状態が不整合になるため、表示のみ（操作不可）にする
  const locked = c.team !== null && isTeamLocked(c.team);
  if (locked) {
    const notice = document.createElement("div");
    notice.className = "sub-ability-row locked-notice";
    notice.textContent = `${TEAM_NAMES[c.team]}は探索中のため、この画面では変更できません（表示のみ）`;
    wrap.appendChild(notice);
  }

  if (detailNotice) {
    const notice = document.createElement("div");
    notice.className = "sub-ability-row detail-notice";
    notice.textContent = detailNotice;
    wrap.appendChild(notice);
  }

  if (detailTab === "tree" && !getExclusiveTree(c)) detailTab = "stats"; // モンスター等、ツリーの無いキャラでは表示しない
  const card = document.createElement("div");
  card.className = "job-char-card" + (locked ? " readonly" : "");
  if (detailTab === "equip") card.appendChild(buildEquipSection(c));
  else if (detailTab === "skill") card.appendChild(buildSkillTab(c));
  else if (detailTab === "tree") card.appendChild(buildTreeTab(c));
  else if (detailTab === "job") card.appendChild(buildJobTab(c));
  else card.appendChild(buildStatsTab(c));
  wrap.appendChild(card);
}

function renderDetailTabs() {
  const c = S.roster.find((x) => x.id === detailCharId);
  const tabs = document.getElementById("detailTabs");
  tabs.innerHTML = "";
  for (const t of DETAIL_TABS) {
    if (t.key === "tree" && !getExclusiveTree(c)) continue; // モンスターやツリー未対応ジョブでは非表示
    const btn = document.createElement("button");
    btn.className = "detail-tab" + (detailTab === t.key ? " active" : "");
    btn.textContent = t.key === "job" && c && c.isMonster ? "合成" : t.label;
    btn.addEventListener("click", () => { detailTab = t.key; renderCharDetail(); });
    tabs.appendChild(btn);
  }
}

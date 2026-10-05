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

const DETAIL_TABS = [
  { key: "stats", label: "能力値" },
  { key: "equip", label: "装備" },
  { key: "skill", label: "スキル" },
  { key: "tree", label: "ツリー" },
  { key: "job", label: "ジョブ" },
];

function renderCharDetail() {
  scheduleSave();
  const c = S.roster.find((x) => x.id === detailCharId);
  if (!c) { showScreen("screen-jobs"); return; }
  document.getElementById("detailName").textContent =
    `${c.name}${c.isMonster ? "（テイム）" : ""}`;

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

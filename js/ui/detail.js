// ---------- 画面: キャラ詳細（タブの切り替え） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- キャラ詳細 ----------
// 開いた元の画面。編成画面（既定）か探索画面（ドックの仲間カードから開いた時）。「もどる」で元の画面へ帰る
let detailReturnScreen = "screen-jobs";
// 編成画面のどの行から開いたかを保持する表示専用の情報（セーブには含めない）。
let detailNavContext = null;
function openCharDetail(c, opts) {
  detailReturnScreen = (opts && opts.returnScreen) || "screen-jobs";
  detailCharId = c.id;
  // 以前の詳細画面の情報は引き継がず、今回タップした行の順番に必ず切り替える。
  detailNavContext = opts && Array.isArray(opts.orderIds) && opts.orderIds.includes(c.id)
    ? { ids: opts.orderIds.slice(), label: String(opts.orderLabel || "") }
    : null;
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
// 詳細を開いたまま、前後の仲間に切り替える（今のタブのまま）。
// 編成画面からは、開いた行（パーティ・未編成グループ・控え）で実際に表示された順を辿る。
// 探索画面から開いた時は、表示中のパーティの仲間だけを回る。
function detailOrder() {
  if (detailReturnScreen === "screen-battle") {
    const party = teamMembers(S.activeTeam);
    if (party.some((x) => x.id === detailCharId)) return party;
  }
  if (detailNavContext) {
    // 仲間IDを現在のロスターで引き直し、削除・移動後も古いオブジェクトを参照しない。
    const current = new Map(S.roster.map((c) => [c.id, c]));
    const scoped = detailNavContext.ids.map((id) => current.get(id)).filter(Boolean);
    if (scoped.some((c) => c.id === detailCharId)) return scoped;
  }
  // 旧来の呼び出し元など、表示順情報が渡されていない場合だけ全体を辿る。
  const order = [];
  for (let t = 0; t < TEAM_COUNT; t++) order.push(...teamMembers(t));
  for (const c of S.roster) if (!order.includes(c)) order.push(c);
  return order;
}
// 詳細画面の上部に出す「名前・所属・何人目か」（通常の見出しと、せんしのスキルツリー専用画面で共通）
function detailPagerInfo(c) {
  const order = detailOrder();
  const where = detailNavContext && detailNavContext.ids.includes(c.id) && detailNavContext.label
    ? detailNavContext.label
    : (c.team !== null ? TEAM_LABELS[c.team] : "控え");
  return {
    name: `${c.name}${c.isMonster ? "（テイム）" : ""}`,
    pos: `${where}・${order.indexOf(c) + 1}/${order.length}`,
    canSwitch: order.length >= 2,
  };
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
// 「もどる」: 開いた元の画面へ帰る。探索画面へは、詳細で変えたジョブ・装備・Lvを仲間カードに反映して戻る
function closeCharDetail() {
  detailCharId = null;
  detailNavContext = null;
  openSlot = null;
  if (detailReturnScreen === "screen-battle") {
    detailReturnScreen = "screen-jobs";
    openExploreHub();
    return;
  }
  renderJobsScreen();
  showScreen("screen-jobs");
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
  if (!c) { closeCharDetail(); return; }
  // 基本職せんしのツリー画面だけ専用レイアウトにする（他ジョブ・他タブはそのまま）。
  const focus = detailTab === "tree" && c.job === "warrior" &&
    isWarriorCrestWeb(c, "exclusive", getExclusiveTree(c));
  document.getElementById("screen-chardetail").classList.toggle("warrior-crest-view", focus);
  const pager = detailPagerInfo(c);
  document.getElementById("detailName").textContent = pager.name;
  document.getElementById("detailPos").textContent = pager.pos;
  document.getElementById("btnDetailPrev").disabled = !pager.canSwitch;
  document.getElementById("btnDetailNext").disabled = !pager.canSwitch;

  renderDetailTabs();

  const wrap = document.getElementById("detailBody");
  // 同じ仲間・同じタブを描き直す時は、スクロール位置を保つ（ツリーでマスを習得するたびに上に戻らないように）
  const sameView = wrap.dataset.view === `${c.id}:${detailTab}`;
  const keepScroll = sameView ? wrap.scrollTop : 0;
  wrap.innerHTML = "";
  // モンスター合成などの実行ボタンは一覧スクロールから独立して下部へ固定。
  const actionBar = document.getElementById("detailActionBar");
  actionBar.replaceChildren();
  actionBar.classList.add("hidden");
  // ツリーの選んだマスの詳細は、画面の下に固定して出す（buildTreeTab が中身を入れる）
  const sheet = document.getElementById("detailSheet");
  sheet.innerHTML = "";
  sheet.classList.add("hidden");

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
  wrap.dataset.view = `${c.id}:${detailTab}`;
  wrap.scrollTop = keepScroll;
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

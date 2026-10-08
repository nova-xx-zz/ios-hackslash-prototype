// ---------- 画面: パーティ一覧（編成画面）とメンバーカードのドラッグ移動 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- パーティ一覧（編成画面） ----------
const expandedTeams = new Set([0]);
let benchExpanded = true;
const expandedGroups = new Set(); // 開いている未編成グループのid
let detailCharId = null;
let detailTab = "stats";
let fusionSelection = new Set(); // モンスター合成: 選択中の素材モンスターのid
let fusionMessage = "";
let fusionConfirm = false; // 合成ボタンを1回押して確認待ちか（素材の消滅は取り消せないため2回押しで確定）
let treeSelectedNode = null; // ツリータブ: 選択中ノード { scope: "exclusive"|スロットkey, nodeId }
let treeSwapConfirm = null; // ツリータブ: 交換ボタンを1回押して確認待ちの枠key

function renderJobsScreen() {
  scheduleSave();
  const wrap = document.getElementById("rosterBody");
  wrap.innerHTML = "";

  wrap.appendChild(sectionLabel("パーティ"));
  for (let i = 0; i < TEAM_LABELS.length; i++) {
    const members = teamMembers(i);
    wrap.appendChild(buildPartyRow({
      key: "t" + i,
      name: `${TEAM_NAMES[i]}（${TEAM_LABELS[i]}）`,
      meta: `${members.length}/${MAX_ACTIVE}人`,
      viewed: i === S.activeTeam,
      exploring: isTeamRunActive(i),
      locked: isTeamLocked(i),
      expanded: expandedTeams.has(i),
      onToggle: () => {
        if (expandedTeams.has(i)) expandedTeams.delete(i); else expandedTeams.add(i);
        renderJobsScreen();
      },
      onView: () => {
        S.activeTeam = i;
        scheduleSave();
        renderJobsScreen();
      },
      members,
      dropKey: String(i),
      emptyTile: null,
    }));
  }

  // 未編成グループ: パーティに入れていない仲間を「育成中」などに分けておく（プレイヤーが名前を付けて作る）
  wrap.appendChild(sectionLabel("未編成グループ"));
  for (const g of S.groups) {
    const members = S.roster.filter((c) => c.team === null && c.group === g.id);
    wrap.appendChild(buildPartyRow({
      key: "g:" + g.id,
      name: g.name,
      meta: `${members.length}人`,
      expanded: expandedGroups.has(g.id),
      onToggle: () => {
        if (expandedGroups.has(g.id)) expandedGroups.delete(g.id); else expandedGroups.add(g.id);
        renderJobsScreen();
      },
      onMenu: () => openGroupModal(g),
      members,
      dropKey: "g:" + g.id,
      emptyTile: null,
      emptyText: "（長押しで仲間をここへ移動できます）",
      grid: true, // 人数が多くなるので、横スクロールではなく折り返して縦に並べる
    }));
  }
  if (S.groups.length < QPModel.save.GROUP_MAX) {
    const add = document.createElement("button");
    add.className = "group-add";
    add.textContent = "＋ 新しいグループを作る";
    add.addEventListener("click", () => openGroupModal(null));
    wrap.appendChild(add);
  }

  wrap.appendChild(sectionLabel("未編成"));
  const bench = S.roster.filter((c) => c.team === null && !c.group);
  wrap.appendChild(buildPartyRow({
    key: "bench",
    name: "控え",
    meta: `${bench.length}人`,
    expanded: benchExpanded,
    onToggle: () => { benchExpanded = !benchExpanded; renderJobsScreen(); },
    members: bench,
    dropKey: "bench",
    grid: true,
    emptyTile: () => openCreateScreen(),
  }));

  document.getElementById("rosterCount").textContent = rosterMessage ||
    `所持なかま ${S.roster.length}/${Shop.rosterCapacity()}人　（カードを長押しでドラッグ移動）`;
}

let rosterMessage = "";
let rosterMessageTimer = null;
function flashRosterMessage(text) {
  rosterMessage = text;
  clearTimeout(rosterMessageTimer);
  rosterMessageTimer = setTimeout(() => { rosterMessage = ""; renderJobsScreen(); }, 1800);
}

function sectionLabel(text) {
  const el = document.createElement("div");
  el.className = "roster-section";
  el.textContent = text;
  return el;
}

function buildPartyRow(opts) {
  const frag = document.createDocumentFragment();

  const head = document.createElement("div");
  head.className = "party-row-head";
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  head.dataset.drop = opts.dropKey;
  head.innerHTML = `<span class="chev">${opts.expanded ? "∨" : "＞"}</span><span class="pname"></span>`;
  head.querySelector(".pname").textContent = opts.name; // グループ名はプレイヤーが入力するので文字として入れる
  if (opts.viewed) {
    const tag = document.createElement("span");
    tag.className = "deployed";
    tag.textContent = "表示中";
    head.appendChild(tag);
  }
  if (opts.exploring) {
    const tag = document.createElement("span");
    tag.className = "exploring-badge";
    tag.textContent = "探索中";
    head.appendChild(tag);
  }
  const meta = document.createElement("span");
  meta.className = "pmeta";
  meta.textContent = opts.meta;
  head.appendChild(meta);
  if (opts.onMenu) {
    const menu = document.createElement("button");
    menu.className = "party-row-menu";
    menu.setAttribute("aria-label", "グループの設定");
    menu.textContent = "…";
    menu.addEventListener("click", (e) => { e.stopPropagation(); opts.onMenu(); });
    head.appendChild(menu);
  }
  head.addEventListener("click", opts.onToggle);
  head.addEventListener("keydown", (e) => {
    if (e.target === head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); opts.onToggle(); }
  });
  frag.appendChild(head);

  if (!opts.expanded) return frag;

  const strip = document.createElement("div");
  strip.className = "member-strip" + (opts.grid ? " grid" : "") + (opts.locked ? " locked" : "");
  strip.dataset.drop = opts.dropKey;
  for (const c of opts.members) strip.appendChild(buildMemberCard(c));
  if (opts.emptyTile) {
    const add = document.createElement("button");
    add.className = "member-card empty";
    add.textContent = "＋";
    add.title = "仲間を呼ぶ";
    add.addEventListener("click", opts.emptyTile);
    strip.appendChild(add);
  }
  if (opts.members.length === 0 && !opts.emptyTile) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.style.padding = "2px 4px 8px";
    none.dataset.drop = opts.dropKey;
    none.textContent = opts.emptyText || "（このパーティは空です）";
    frag.appendChild(none);
  }
  frag.appendChild(strip);

  if (opts.onView && !opts.viewed && opts.members.length > 0) {
    const btn = document.createElement("button");
    btn.className = "equip-choice";
    btn.style.margin = "0 2px 10px";
    btn.textContent = "このパーティを表示する";
    btn.addEventListener("click", opts.onView);
    frag.appendChild(btn);
  }
  return frag;
}

// ---------- 未編成グループの作成・名前の変更・削除 ----------
let groupModalTarget = null; // 編集中のグループ（新しく作る時は null）
let groupDeleteConfirm = false; // 削除ボタンを1回押して確認待ちか

function openGroupModal(g) {
  groupModalTarget = g;
  groupDeleteConfirm = false;
  document.getElementById("groupModalTitle").textContent = g ? "グループの設定" : "新しいグループ";
  document.getElementById("btnGroupSave").textContent = g ? "名前を変更する" : "作成する";
  const del = document.getElementById("btnGroupDelete");
  del.classList.toggle("hidden", !g);
  del.textContent = "このグループを削除する";
  document.getElementById("groupModalMsg").textContent = "";
  const input = document.getElementById("groupNameInput");
  input.value = g ? g.name : "";
  document.getElementById("groupModal").classList.remove("hidden");
  if (!g) input.focus();
}

function closeGroupModal() {
  document.getElementById("groupModal").classList.add("hidden");
  groupModalTarget = null;
}

function saveGroupModal() {
  const name = document.getElementById("groupNameInput").value.trim().slice(0, QPModel.save.GROUP_NAME_MAX);
  if (!name) {
    document.getElementById("groupModalMsg").textContent = "名前を入力してください";
    return;
  }
  if (groupModalTarget) {
    groupModalTarget.name = name;
  } else {
    if (S.groups.length >= QPModel.save.GROUP_MAX) return closeGroupModal();
    let n = 1;
    while (S.groups.some((x) => x.id === "g" + n)) n += 1;
    S.groups.push({ id: "g" + n, name });
    expandedGroups.add("g" + n);
  }
  closeGroupModal();
  renderJobsScreen();
}

// 削除してもグループにいた仲間はいなくならず、「未編成」に戻る
function deleteGroupModal() {
  const g = groupModalTarget;
  if (!g) return;
  const count = S.roster.filter((c) => c.group === g.id).length;
  if (!groupDeleteConfirm) {
    groupDeleteConfirm = true;
    armConfirm();
    document.getElementById("btnGroupDelete").textContent = "もう一度押すと削除します";
    document.getElementById("groupModalMsg").textContent = count > 0 ? `中の仲間${count}人は「未編成」に戻ります` : "";
    return;
  }
  if (!confirmReady()) return;
  for (const c of S.roster) if (c.group === g.id) c.group = null;
  S.groups = S.groups.filter((x) => x !== g);
  expandedGroups.delete(g.id);
  closeGroupModal();
  renderJobsScreen();
}

document.getElementById("btnGroupSave").addEventListener("click", saveGroupModal);
document.getElementById("btnGroupDelete").addEventListener("click", deleteGroupModal);
document.getElementById("btnGroupCancel").addEventListener("click", closeGroupModal);
document.getElementById("groupNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveGroupModal(); }
});

// 仲間のカード: ジョブの紋章・種族・名前・レベル（ジョブ名は紋章で表す。モンスターは共通の盾）
function buildMemberCard(c) {
  const btn = document.createElement("button");
  btn.className = "member-card" + (c.isMonster ? " monster" : "");
  btn.title = `${RACES[c.race].name}・${jobDef(c).name}`;
  btn.innerHTML = `
    <div class="micon">${jobInsignia(c.isMonster ? null : c.job)}</div>
    <div class="mtitle">${RACES[c.race].name}${c.ivs ? " " + QPCore.stats.ivRank(c.ivs) : ""}</div>
    <div class="mname">${c.favorite ? "★" : ""}${escapeHtml(c.name)}</div>
    <div class="mstats"><span>Lv.${c.level}</span></div>`;
  attachMemberDrag(btn, c);
  return btn;
}

// ---------- メンバーカードのドラッグ移動 ----------
// iOS Safari では HTML5 drag&drop が使えないので Pointer Events で実装する。
// 長押しでドラッグ開始、それ以前の指の移動は横スクロールとして扱う。
const DRAG_HOLD_MS = 260;
const DRAG_SLOP = 10;
let dragState = null;

// ドラッグが始まった後の指の動きをブラウザがスクロールとして扱うと、iOS Safari では
// pointercancel が来てドラッグが途中で止まる。touch-action は指を置いた時点の値しか効かないため、
// ドラッグ中は touchmove を止めてスクロールさせない（ドラッグ前の指の移動は今までどおりスクロールになる）
document.addEventListener("touchmove", (e) => {
  if (dragState) e.preventDefault();
}, { passive: false });

function attachMemberDrag(card, c) {
  card.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let canceled = false;

    const holdTimer = setTimeout(() => {
      if (canceled) return;
      // 探索中のチームに所属するキャラは、途中で編成が変わらないようドラッグ移動できない
      if (c.team !== null && isTeamLocked(c.team)) {
        canceled = true;
        flashRosterMessage(`${TEAM_NAMES[c.team]}は探索中のため編成を変更できません`);
        return;
      }
      dragging = true;
      // 長押しで始まりかけた文字の範囲選択を消してからドラッグする
      const sel = window.getSelection && window.getSelection();
      if (sel) sel.removeAllRanges();
      startMemberDrag(c, card, start);
    }, DRAG_HOLD_MS);

    const onMove = (ev) => {
      if (dragging) {
        ev.preventDefault();
        moveMemberDrag(ev);
        return;
      }
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_SLOP) {
        canceled = true;
        clearTimeout(holdTimer);
        detach();
      }
    };
    const onUp = (ev) => {
      clearTimeout(holdTimer);
      detach();
      if (dragging) dropMemberDrag(ev);
      else if (!canceled && ev.type === "pointerup") openCharDetail(c); // スクロールで中断された時は開かない
    };
    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // 長押しで出る文字選択・コンテキストメニューを止める
  card.addEventListener("selectstart", (e) => e.preventDefault());
  card.addEventListener("contextmenu", (e) => e.preventDefault());

  // キーボード操作など、ポインタを伴わない click のためのフォールバック
  card.addEventListener("click", (e) => {
    if (e.detail === 0) openCharDetail(c);
  });
}

// ドラッグ中に指が一覧の上端・下端の近くにある間は、一覧を自動でスクロールする
// （第一のパーティから下のパーティへ、またはその逆へ運べるようにする）
const DRAG_SCROLL_EDGE = 70; // 端からこの距離(px)以内でスクロールする
const DRAG_SCROLL_MAX_SPEED = 14; // 1フレームあたりの最大スクロール量(px)

function dragAutoScrollStep() {
  if (!dragState) return;
  const body = document.getElementById("rosterBody");
  const rect = body.getBoundingClientRect();
  const y = dragState.pos.y;
  let dy = 0;
  if (y < rect.top + DRAG_SCROLL_EDGE) dy = -DRAG_SCROLL_MAX_SPEED * Math.min(1, (rect.top + DRAG_SCROLL_EDGE - y) / DRAG_SCROLL_EDGE);
  else if (y > rect.bottom - DRAG_SCROLL_EDGE) dy = DRAG_SCROLL_MAX_SPEED * Math.min(1, (y - (rect.bottom - DRAG_SCROLL_EDGE)) / DRAG_SCROLL_EDGE);
  if (dy) {
    const before = body.scrollTop;
    body.scrollTop += dy;
    if (body.scrollTop !== before) updateDropZone(); // 指の下に来た行が変わるので、移動先の表示を更新する
  }
  dragState.scrollRaf = requestAnimationFrame(dragAutoScrollStep);
}

function startMemberDrag(c, card, pos) {
  const ghost = card.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = card.offsetWidth + "px";
  ghost.style.left = pos.x + "px";
  ghost.style.top = pos.y + "px";
  document.body.appendChild(ghost);
  card.classList.add("dragging");
  document.body.classList.add("dragging-member");
  dragState = { char: c, card, ghost, zone: null, pos: { x: pos.x, y: pos.y }, scrollRaf: 0 };
  dragState.scrollRaf = requestAnimationFrame(dragAutoScrollStep);
}

function moveMemberDrag(ev) {
  if (!dragState) return;
  dragState.ghost.style.left = ev.clientX + "px";
  dragState.ghost.style.top = ev.clientY + "px";
  dragState.pos = { x: ev.clientX, y: ev.clientY };
  updateDropZone();
}

function updateDropZone() {
  const el = document.elementFromPoint(dragState.pos.x, dragState.pos.y);
  const zone = el ? el.closest("[data-drop]") : null;
  if (zone === dragState.zone) return;
  if (dragState.zone) dragState.zone.classList.remove("drop-target", "full");
  if (zone) {
    zone.classList.add("drop-target");
    if (!canDropOn(zone.dataset.drop, dragState.char)) zone.classList.add("full");
  }
  dragState.zone = zone;
}

function canDropOn(key, c) {
  if (key === "bench" || key.startsWith("g:")) return true;
  const i = parseInt(key, 10);
  if (isTeamLocked(i)) return false;
  if (c.team === i) return true;
  return teamMembers(i).length < MAX_ACTIVE;
}

function dropMemberDrag() {
  if (!dragState) return;
  const { char, card, ghost, zone } = dragState;
  cancelAnimationFrame(dragState.scrollRaf);
  ghost.remove();
  card.classList.remove("dragging");
  document.body.classList.remove("dragging-member");
  if (zone) zone.classList.remove("drop-target", "full");
  dragState = null;

  if (zone) {
    const key = zone.dataset.drop;
    if (key === "bench") {
      char.team = null;
      char.group = null;
      benchExpanded = true;
    } else if (key.startsWith("g:")) {
      const id = key.slice(2);
      char.team = null;
      char.group = id;
      expandedGroups.add(id);
    } else {
      const i = parseInt(key, 10);
      if (char.team !== i) {
        if (isTeamLocked(i)) {
          flashRosterMessage(`${TEAM_NAMES[i]}は探索中のため編成できません`);
          renderJobsScreen();
          return;
        }
        if (!canDropOn(key, char)) {
          flashRosterMessage(`${TEAM_NAMES[i]}は満員です（最大${MAX_ACTIVE}人）`);
          renderJobsScreen();
          return;
        }
        char.team = i;
        char.group = null;
        clampVitals(char);
        expandedTeams.add(i);
      }
    }
  }
  renderJobsScreen();
}

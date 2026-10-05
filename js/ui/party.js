// ---------- 画面: パーティ一覧（編成画面）とメンバーカードのドラッグ移動 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- パーティ一覧（編成画面） ----------
const expandedTeams = new Set([0]);
let benchExpanded = true;
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

  wrap.appendChild(sectionLabel("未編成"));
  const bench = S.roster.filter((c) => c.team === null);
  wrap.appendChild(buildPartyRow({
    key: "bench",
    name: "控え",
    meta: `${bench.length}人`,
    expanded: benchExpanded,
    onToggle: () => { benchExpanded = !benchExpanded; renderJobsScreen(); },
    members: bench,
    dropKey: "bench",
    emptyTile: () => openCreateScreen(),
  }));

  document.getElementById("rosterCount").textContent = rosterMessage ||
    `所持なかま ${S.roster.length}人　/　所持品 ${S.inventory.length}個　（カードを長押しでドラッグ移動）`;
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

  const head = document.createElement("button");
  head.className = "party-row-head";
  head.dataset.drop = opts.dropKey;
  head.innerHTML = `<span class="chev">${opts.expanded ? "∨" : "＞"}</span>
    <span class="pname">${opts.name}</span>`;
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
  head.addEventListener("click", opts.onToggle);
  frag.appendChild(head);

  if (!opts.expanded) return frag;

  const strip = document.createElement("div");
  strip.className = "member-strip" + (opts.locked ? " locked" : "");
  strip.dataset.drop = opts.dropKey;
  for (const c of opts.members) strip.appendChild(buildMemberCard(c));
  if (opts.emptyTile) {
    const add = document.createElement("button");
    add.className = "member-card empty";
    add.textContent = "＋";
    add.title = "仲間を探す";
    add.addEventListener("click", opts.emptyTile);
    strip.appendChild(add);
  }
  if (opts.members.length === 0 && !opts.emptyTile) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.style.padding = "2px 4px 8px";
    none.textContent = "（このパーティは空です）";
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

function buildMemberCard(c) {
  const stats = computeStats(c);
  const btn = document.createElement("button");
  btn.className = "member-card" + (c.isMonster ? " monster" : "");
  btn.innerHTML = `
    <div class="mtitle">${RACES[c.race].name}・${jobDef(c).name}</div>
    <div class="mname">${c.name}</div>
    <div class="mstats"><span>Lv.${c.level}</span><span>HP${stats.maxHp}</span></div>`;
  attachMemberDrag(btn, c);
  return btn;
}

// ---------- メンバーカードのドラッグ移動 ----------
// iOS Safari では HTML5 drag&drop が使えないので Pointer Events で実装する。
// 長押しでドラッグ開始、それ以前の指の移動は横スクロールとして扱う。
const DRAG_HOLD_MS = 260;
const DRAG_SLOP = 10;
let dragState = null;

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
      else if (!canceled) openCharDetail(c);
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

  // キーボード操作など、ポインタを伴わない click のためのフォールバック
  card.addEventListener("click", (e) => {
    if (e.detail === 0) openCharDetail(c);
  });
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
  dragState = { char: c, card, ghost, zone: null };
}

function moveMemberDrag(ev) {
  if (!dragState) return;
  dragState.ghost.style.left = ev.clientX + "px";
  dragState.ghost.style.top = ev.clientY + "px";
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
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
  if (key === "bench") return true;
  const i = parseInt(key, 10);
  if (isTeamLocked(i)) return false;
  if (c.team === i) return true;
  return teamMembers(i).length < MAX_ACTIVE;
}

function dropMemberDrag() {
  if (!dragState) return;
  const { char, card, ghost, zone } = dragState;
  ghost.remove();
  card.classList.remove("dragging");
  document.body.classList.remove("dragging-member");
  if (zone) zone.classList.remove("drop-target", "full");
  dragState = null;

  if (zone) {
    const key = zone.dataset.drop;
    if (key === "bench") {
      char.team = null;
      benchExpanded = true;
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
        clampVitals(char);
        expandedTeams.add(i);
      }
    }
  }
  renderJobsScreen();
}

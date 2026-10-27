// ---------- 画面: 編成メニュー（ギルド・鍛冶屋・ショップ）・仲間と別れる・装備強化の一覧 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
// 下のナビの「編成」はこのメニューを開き、各画面の「もどる」はこのメニューに戻る。
"use strict";

// メニューの行のアイコン（線画。下のナビと同じ描き方）
const MENU_ICONS = {
  recruit: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M19 8v6m-3-3h6"/>',
  party: '<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="17" r="2.2"/><circle cx="12" cy="17" r="2.2"/><circle cx="19" cy="17" r="2.2"/><path d="M12 7.5V11M5 14.5V11h14v3.5M12 11v3.5"/>',
  farewell: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 6l5 5m0-5-5 5"/>',
  enhance: '<path d="M4 20h10M6 20v-3h6v3M9 17V9M5 9h8l2-3H7z"/><path d="m17 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  disassemble: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3"/>',
  items: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2M4 12h16M11 12v2h2v-2"/>',
  shop: '<path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"/><path d="M10 14h4"/>',
  forgeTrial: '<path d="M5 20h14M7 20V9l5-5 5 5v11M9 14h6M12 12v6"/>',
};
const MENU_SECTIONS = [
  { title: "ギルド", rows: [
    { key: "recruit", label: "仲間を呼ぶ", open: () => menuOpenCreate() },
    { key: "party", label: "パーティ編成", open: () => openPartyScreen("screen-menu") },
    { key: "farewell", label: "仲間と別れる", open: () => openFarewell() },
  ] },
  { title: "鍛冶屋", rows: [
    { key: "enhance", label: "装備強化", open: () => openEnhanceList() },
    { key: "forgeTrial", label: "オプション抽出・継承【試作】", previewOnly: true, open: () => openForgeTrial() },
    { key: "disassemble", label: "装備分解", open: () => openInventoryScreen({ disassemble: true, returnScreen: "screen-menu" }) },
    { key: "items", label: "所持品確認", open: () => openInventoryScreen({ returnScreen: "screen-menu" }) },
  ] },
  { title: "ショップ（課金アイテム）", feature: "shop", rows: [
    { key: "shop", label: "ショップ", open: () => openShop("screen-menu") },
  ] },
];

let menuMessageTimer = null;
function showMenuMessage(text) {
  const el = document.getElementById("menuMessage");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  clearTimeout(menuMessageTimer);
  if (text) menuMessageTimer = setTimeout(() => showMenuMessage(""), 3000);
}

function openPartyMenu() {
  showMenuMessage("");
  renderPartyMenu();
  showScreen("screen-menu");
}

function renderPartyMenu() {
  const body = document.getElementById("menuBody");
  body.innerHTML = "";
  for (const section of MENU_SECTIONS) {
    if (section.feature && !isFeatureEnabled(section.feature)) continue;
    const head = document.createElement("div");
    head.className = "menu-section-title";
    head.textContent = section.title;
    body.appendChild(head);
    const list = document.createElement("div");
    list.className = "menu-list";
    for (const row of section.rows) {
      if (row.previewOnly && (!window.QPRuntime || QPRuntime.channel !== "preview")) continue;
      const btn = document.createElement("button");
      btn.className = "menu-row";
      btn.innerHTML = `<svg class="menu-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICONS[row.key]}</svg>` +
        `<span class="menu-row-label"></span><span class="menu-row-sub"></span><span class="menu-row-chevron" aria-hidden="true">›</span>`;
      btn.querySelector(".menu-row-label").textContent = row.label;
      btn.querySelector(".menu-row-sub").textContent = menuRowSub(row.key);
      btn.addEventListener("click", row.open);
      list.appendChild(btn);
    }
    body.appendChild(list);
  }
}

// 行の右に出す小さな数字（仲間の数・所持品の数など）
function menuRowSub(key) {
  if (key === "recruit" || key === "farewell") return `${S.roster.length}/${Shop.rosterCapacity()}人`;
  if (key === "items" || key === "disassemble") return `${S.inventory.length}個`;
  if (key === "enhance") return `強化石 ${S.material}`;
  if (key === "forgeTrial") return "体験版";
  return "";
}

// 仲間を呼ぶ: 仲間のBOXが満員なら、メニューに理由を出して開かない
function menuOpenCreate() {
  if (!Shop.canAddToRoster(1)) {
    showMenuMessage(`仲間のBOXがいっぱいです（${S.roster.length}/${Shop.rosterCapacity()}人）。ショップでBOXを拡張できます`);
    return;
  }
  openCreateScreen("screen-menu");
}

document.getElementById("btnMenuBack").addEventListener("click", () => openExploreHub());

// ---------- 仲間と別れる ----------
// どのチームにも編成していない、お気に入り（★）でない仲間を選んで別れる（js/model/inventory.js の releaseMembers）。
// 別れた仲間は戻らないため2回押しで確定する。装備していたアイテムは所持品に戻る。
// 一覧は人間・モンスターに分けて表示し、種類・ジョブ／種族で絞り込み、Lv・ジョブ・仲間にした順で並び替えられる
// （js/core/roster-organize.js。条件は画面内の一時状態でセーブには入れない）
let farewellSelection = new Set();
let farewellConfirm = false;
let farewellMessage = "";
let farewellView = newRosterListView();
let farewellFilterOpen = false;

function setFarewellFilterOpen(open) {
  farewellFilterOpen = !!open;
  const panel = document.getElementById("farewellFilterPopover");
  panel.classList.toggle("hidden", !farewellFilterOpen);
  panel.setAttribute("aria-hidden", farewellFilterOpen ? "false" : "true");
  document.getElementById("btnFarewellFilter").setAttribute("aria-expanded", farewellFilterOpen ? "true" : "false");
}
function renderFarewellFilterControls(candidates) {
  const controls = document.getElementById("farewellFilterControls");
  controls.replaceChildren(buildRosterFilterBar(farewellView, {
    chars: candidates, showKind: true, showFavorite: false,
    onChange: () => {
      // 検索条件の変更時は二段階確認をキャンセルし、一覧のスクロール位置を維持。
      farewellConfirm = false;
      farewellMessage = "";
      renderFarewell();
    },
  }));
  const applied = rosterListViewActive(farewellView);
  const button = document.getElementById("btnFarewellFilter");
  button.classList.toggle("active", !!applied);
  button.setAttribute("aria-label", applied ? "仲間を絞り込む（条件適用中）" : "仲間を絞り込む");
  button.title = applied ? "仲間を絞り込む（条件適用中）" : "仲間を絞り込む";
}
document.getElementById("btnFarewellFilter").addEventListener("click", () => setFarewellFilterOpen(!farewellFilterOpen));
document.getElementById("btnFarewellFilterClose").addEventListener("click", () => setFarewellFilterOpen(false));
document.getElementById("btnFarewellFilterReset").addEventListener("click", () => {
  farewellView = newRosterListView();
  farewellConfirm = false;
  farewellMessage = "";
  renderFarewell();
});
document.addEventListener("pointerdown", (event) => {
  if (!farewellFilterOpen) return;
  const panel = document.getElementById("farewellFilterPopover");
  const trigger = document.getElementById("btnFarewellFilter");
  if (!panel.contains(event.target) && !trigger.contains(event.target)) setFarewellFilterOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (farewellFilterOpen && event.key === "Escape") setFarewellFilterOpen(false);
});

function openFarewell() {
  farewellSelection = new Set();
  farewellConfirm = false;
  farewellMessage = "";
  setFarewellFilterOpen(false);
  renderFarewell();
  showScreen("screen-farewell");
}

function farewellSectionLabel(text) {
  const el = document.createElement("div");
  el.className = "roster-section";
  el.textContent = text;
  return el;
}

function buildFarewellRow(c) {
  const row = document.createElement("div");
  row.className = "skill-row selectable" + (farewellSelection.has(c) ? " selected" : "");
  const name = document.createElement("div");
  name.className = "skill-row-name";
  const equipped = Object.values(c.equip || {}).filter(Boolean).length;
  name.textContent = `${c.name}（${RACES[c.race].name}・${jobDef(c).name}） Lv.${c.level}` + (equipped ? `　装備${equipped}個` : "");
  row.appendChild(name);
  const mark = document.createElement("div");
  mark.className = "skill-toggle-circle static" + (farewellSelection.has(c) ? " on" : "");
  row.appendChild(mark);
  row.addEventListener("click", () => {
    if (farewellSelection.has(c)) farewellSelection.delete(c); else farewellSelection.add(c);
    farewellConfirm = false;
    farewellMessage = "";
    renderFarewell();
  });
  return row;
}

function renderFarewell() {
  const body = document.getElementById("farewellBody");
  // 選択状態が変わっても、長い仲間一覧のスクロール位置を維持する。
  const scrollTop = body.scrollTop;
  body.innerHTML = "";
  const desc = document.createElement("div");
  desc.className = "sub-ability-row";
  desc.textContent = "選んだ仲間と別れます（取り消せません）。装備していたアイテムは所持品に戻ります。パーティに編成中の仲間と、お気に入り（★）の仲間は選べません。";
  body.appendChild(desc);

  const candidates = Inventory.releaseCandidates();
  for (const c of [...farewellSelection]) if (!candidates.includes(c)) farewellSelection.delete(c);
  // フィルターは一覧と独立した固定ヘッダー内。候補0でも条件のクリアは可能。
  renderFarewellFilterControls(candidates);
  if (candidates.length === 0) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.textContent = "別れられる仲間がいません（パーティの外にいる仲間だけ選べます）";
    body.appendChild(none);
  }
  const shown = applyRosterListView(candidates, farewellView);
  if (candidates.length > 0) {
    const tools = document.createElement("div");
    tools.className = "list-filter-line farewell-tools";
    const count = document.createElement("span");
    count.className = "disassemble-filter-label";
    count.textContent = rosterListViewActive(farewellView) ? `条件一致 ${shown.length}人／候補 ${candidates.length}人` : `候補 ${candidates.length}人`;
    tools.appendChild(count);
    // 表示中の仲間をまとめて選ぶ（全員選ばれていれば外す）。確定は従来どおり2回押し
    const allShown = shown.length > 0 && shown.every((c) => farewellSelection.has(c));
    const pick = document.createElement("button");
    pick.className = "disassemble-chip" + (allShown ? " active" : "");
    pick.textContent = allShown ? "表示中の選択を外す" : `表示中をすべて選ぶ（${shown.length}人）`;
    pick.disabled = shown.length === 0;
    pick.addEventListener("click", () => {
      for (const c of shown) { if (allShown) farewellSelection.delete(c); else farewellSelection.add(c); }
      farewellConfirm = false;
      farewellMessage = "";
      renderFarewell();
    });
    tools.appendChild(pick);
    body.appendChild(tools);
    if (shown.length === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = "条件に合う仲間がいません";
      body.appendChild(none);
    }
  }
  // 人間・モンスターに分けて並べる（種類で絞り込んでいる時は1つだけ）
  const sections = [["human", "人間"], ["monster", "モンスター"]];
  for (const [kind, label] of sections) {
    const members = shown.filter((c) => QPCore.rosterOrganize.kindOf(c) === kind);
    if (members.length === 0) continue;
    body.appendChild(farewellSectionLabel(`${label}（${members.length}人）`));
    const list = document.createElement("div");
    list.className = "skill-row-list";
    for (const c of members) list.appendChild(buildFarewellRow(c));
    body.appendChild(list);
  }
  body.scrollTop = scrollTop;
  renderFarewellActionBar(shown);
}

// 一覧とは独立した下部の固定操作エリア。グローバルナビより上に配置される。
function renderFarewellActionBar(shown) {
  const footer = document.getElementById("farewellActionBar");
  footer.replaceChildren();
  const n = farewellSelection.size;
  const count = document.createElement("div");
  count.id = "farewellSelectedCount";
  count.className = "farewell-selected-count";
  // 絞り込みで見えなくなった選択も、別れる対象に含まれることを示す
  const hidden = shown ? [...farewellSelection].filter((c) => !shown.includes(c)).length : 0;
  count.textContent = `選択中：${n}人` + (hidden ? `（うち表示外${hidden}人）` : "");
  footer.appendChild(count);

  // 実行結果やエラーをスクロールなしで確認できるよう、操作ボタンの上に表示する。
  if (farewellMessage) {
    const msg = document.createElement("p");
    msg.className = "settings-message farewell-feedback";
    msg.textContent = farewellMessage;
    msg.setAttribute("role", "status");
    footer.appendChild(msg);
  }
  const btn = document.createElement("button");
  btn.className = "btn " + (farewellConfirm ? "danger" : "primary") + " farewell-btn";
  btn.textContent = n === 0 ? "別れる仲間を選んでください" : farewellConfirm ? `本当に${n}人と別れる（取り消せません）` : `${n}人と別れる`;
  btn.disabled = n === 0;
  btn.addEventListener("click", () => {
    if (!farewellConfirm) { farewellConfirm = true; armConfirm(); renderFarewell(); return; }
    if (!confirmReady()) return;
    farewellConfirm = false;
    const r = Inventory.releaseMembers([...farewellSelection]);
    farewellSelection = new Set();
    farewellMessage = r.ok
      ? `${r.names.join("・")}と別れた` + (r.returnedItems ? `／装備${r.returnedItems}個は所持品に戻した` : "")
      : r.reason === "lastMember" ? "仲間を全員と別れることはできません（最低1人は残してください）" : "別れられる仲間が選ばれていません";
    if (r.ok) saveGame(); // 取り消せない操作のため、遅延保存を待たない
    renderFarewell();
  });
  btn.setAttribute("aria-describedby", "farewellSelectedCount");
  footer.appendChild(btn);
}
document.getElementById("btnFarewellBack").addEventListener("click", () => {
  setFarewellFilterOpen(false);
  openPartyMenu();
});

// ---------- 装備強化（装備中・所持品の装備をまとめて選ぶ） ----------
// 探索中・自動周回中のチームのキャラが付けている装備は、戦闘中の能力値が変わらないよう強化できない。
// 装備分解（js/ui/inventory.js）と同じく、部位の絞り込み・価値の表示・並び替え・部位ごとのまとまりを持つ。
// 装備中は「キャラごと」にもまとめられる。条件は画面内の一時状態で、セーブには入れない
const ENHANCE_LIST_PAGE = 80; // 大量の所持品でも一度に全行を作らない（所持品の数は制限しない）
let enhanceListFilter = "equipped"; // equipped | inventory
let enhanceListSlot = "all"; // all | SLOTS[].key
let enhanceListView = "all"; // all | valuable | enhanced | unenhanced | locked
let enhanceListSort = "rarity"; // rarity | plus | power
let enhanceListGroup = "slot"; // slot | owner（装備中のみ）
let enhanceListLimit = ENHANCE_LIST_PAGE;
const ENHANCE_LIST_VIEWS = [
  ["all", "すべて"], ["valuable", "保護・貴重"], ["enhanced", "強化済み"], ["unenhanced", "未強化"], ["locked", "ロック"],
];
const ENHANCE_LIST_SORTS = [["rarity", "レア度"], ["plus", "強化値"], ["power", "能力"]];
let enhanceFilterOpen = false;

function setEnhanceFilterOpen(open) {
  enhanceFilterOpen = !!open;
  const panel = document.getElementById("enhanceFilterPopover");
  panel.classList.toggle("hidden", !enhanceFilterOpen);
  panel.setAttribute("aria-hidden", enhanceFilterOpen ? "false" : "true");
  document.getElementById("btnEnhanceFilter").setAttribute("aria-expanded", enhanceFilterOpen ? "true" : "false");
}
function refreshEnhanceFilterIndicator() {
  const active = enhanceListFilter !== "equipped" || enhanceListSlot !== "all" ||
    enhanceListView !== "all" || enhanceListSort !== "rarity" ||
    (enhanceListFilter === "equipped" && enhanceListGroup !== "slot");
  const btn = document.getElementById("btnEnhanceFilter");
  btn.classList.toggle("active", active);
  btn.setAttribute("aria-label", active ? "装備強化を絞り込む（条件適用中）" : "装備強化を絞り込む");
}
document.getElementById("btnEnhanceFilter").addEventListener("click", () => setEnhanceFilterOpen(!enhanceFilterOpen));
document.getElementById("btnEnhanceFilterClose").addEventListener("click", () => setEnhanceFilterOpen(false));
document.getElementById("btnEnhanceFilterReset").addEventListener("click", () => {
  enhanceListFilter = "equipped";
  enhanceListSlot = "all";
  enhanceListView = "all";
  enhanceListSort = "rarity";
  enhanceListGroup = "slot";
  enhanceListLimit = ENHANCE_LIST_PAGE;
  document.getElementById("enhanceListBody").scrollTop = 0;
  renderEnhanceList();
});
document.addEventListener("pointerdown", (event) => {
  if (!enhanceFilterOpen) return;
  const panel = document.getElementById("enhanceFilterPopover");
  const trigger = document.getElementById("btnEnhanceFilter");
  if (!panel.contains(event.target) && !trigger.contains(event.target)) setEnhanceFilterOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (enhanceFilterOpen && event.key === "Escape") setEnhanceFilterOpen(false);
});

function openEnhanceList() {
  setEnhanceFilterOpen(false);
  enhanceListLimit = ENHANCE_LIST_PAGE;
  renderEnhanceList();
  showScreen("screen-enhance");
}

function enhanceListMatchesView(item) {
  if (enhanceListView === "valuable") return QPCore.inventoryOrganize.isValuable(item);
  if (enhanceListView === "enhanced") return (item.plus || 0) > 0;
  if (enhanceListView === "unenhanced") return !(item.plus > 0);
  if (enhanceListView === "locked") return !!item.locked;
  return true;
}

// 並び替え: 元の配列は変えず、能力値は1件につき1回だけ計算する
function sortEnhanceRows(rows) {
  const rank = new Map(RARITIES.map((r, i) => [r.key, i]));
  const metrics = rows.map((row, index) => ({
    row, index,
    rarity: rank.has(row.item.rarity) ? rank.get(row.item.rarity) : -1,
    plus: row.item.plus || 0,
    power: enhanceListSort === "power" ? (Number(itemEffectiveValue(row.item)) || 0) : 0,
  }));
  metrics.sort((a, b) => {
    const primary = enhanceListSort === "plus" ? b.plus - a.plus
      : enhanceListSort === "power" ? b.power - a.power
      : b.rarity - a.rarity;
    return primary || b.rarity - a.rarity || b.plus - a.plus || a.index - b.index;
  });
  return metrics.map((m) => m.row);
}

function enhanceListRows() {
  const rows = [];
  if (enhanceListFilter === "equipped") {
    for (const c of S.roster) {
      for (const pos of Object.keys(c.equip || {})) {
        const item = c.equip[pos];
        if (item) rows.push({ item, owner: c, locked: c.team !== null && isTeamLocked(c.team) });
      }
    }
  } else {
    for (const item of S.inventory) rows.push({ item, owner: null, locked: false });
  }
  return rows.filter(({ item }) =>
    (enhanceListSlot === "all" || item.slot === enhanceListSlot) && enhanceListMatchesView(item));
}

// まとまり: 部位ごと（装備分解と同じ）、または装備しているキャラごと（パーティ順、その後に控え）
function groupEnhanceRows(rows) {
  if (enhanceListFilter === "equipped" && enhanceListGroup === "owner") {
    const order = (c) => (c.team === null || c.team === undefined ? 99 : c.team);
    const owners = [...new Set(rows.map((r) => r.owner))]
      .sort((a, b) => order(a) - order(b) || S.roster.indexOf(a) - S.roster.indexOf(b));
    return owners.map((c) => ({
      label: `${c.name}（${c.team === null || c.team === undefined ? "控え" : TEAM_NAMES[c.team]}）`,
      rows: sortEnhanceRows(rows.filter((r) => r.owner === c)),
    }));
  }
  return SLOTS.map((slot) => ({ label: slot.name, rows: sortEnhanceRows(rows.filter((r) => r.item.slot === slot.key)) }))
    .filter((g) => g.rows.length > 0);
}

function renderEnhanceListControls() {
  const filterRow = document.getElementById("enhanceFilterRow");
  filterRow.innerHTML = "";
  const change = (fn) => (value) => {
    fn(value);
    enhanceListLimit = ENHANCE_LIST_PAGE;
    document.getElementById("enhanceListBody").scrollTop = 0;
    renderEnhanceList();
  };
  const chips = document.createElement("div");
  chips.className = "list-filter-line";
  chips.appendChild(buildFilterChips("", [["equipped", "装備中"], ["inventory", "所持品"]], enhanceListFilter,
    change((v) => { enhanceListFilter = v; })));
  if (enhanceListFilter === "equipped") {
    chips.appendChild(buildFilterChips("まとめ", [["slot", "部位ごと"], ["owner", "キャラごと"]], enhanceListGroup,
      change((v) => { enhanceListGroup = v; })));
  }
  filterRow.appendChild(chips);
  const selects = document.createElement("div");
  selects.className = "list-filter-line";
  selects.appendChild(buildFilterSelect("部位", [["all", "すべて"], ...SLOTS.map((sl) => [sl.key, sl.name])], enhanceListSlot,
    change((v) => { enhanceListSlot = v; })));
  selects.appendChild(buildFilterSelect("表示", ENHANCE_LIST_VIEWS, enhanceListView, change((v) => { enhanceListView = v; })));
  selects.appendChild(buildFilterSelect("並び順", ENHANCE_LIST_SORTS, enhanceListSort, change((v) => { enhanceListSort = v; })));
  filterRow.appendChild(selects);
  refreshEnhanceFilterIndicator();
}

function renderEnhanceList() {
  renderEnhanceListControls();
  const body = document.getElementById("enhanceListBody");
  body.innerHTML = "";
  const head = document.createElement("div");
  head.className = "sub-ability-row";
  const rows = enhanceListRows();
  head.textContent = `強化石 ${S.material}個` + (isFeatureEnabled("guaranteedStone") ? `／確定強化石 ${guaranteedStoneTotal()}個` : "") +
    `／条件一致 ${rows.length}個`;
  body.appendChild(head);

  if (rows.length === 0) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    const narrowed = enhanceListSlot !== "all" || enhanceListView !== "all";
    none.textContent = narrowed ? "条件に合う装備がありません"
      : enhanceListFilter === "equipped" ? "装備中のアイテムがありません" : "未装備の所持品がありません";
    body.appendChild(none);
    return;
  }
  let remaining = enhanceListLimit;
  for (const group of groupEnhanceRows(rows)) {
    if (remaining <= 0) break;
    const showing = group.rows.slice(0, remaining);
    remaining -= showing.length;
    body.appendChild(sectionLabel(`${group.label}（${group.rows.length}個${showing.length < group.rows.length ? `中${showing.length}個` : ""}）`));
    const list = document.createElement("div");
    list.className = "skill-row-list";
    for (const row of showing) list.appendChild(buildEnhanceListRow(row));
    body.appendChild(list);
  }
  if (rows.length > enhanceListLimit) {
    const more = document.createElement("button");
    more.className = "btn small ghost inventory-more";
    more.textContent = `さらに表示（残り${rows.length - enhanceListLimit}個）`;
    more.addEventListener("click", () => {
      const previousScrollTop = body.scrollTop;
      enhanceListLimit += ENHANCE_LIST_PAGE;
      renderEnhanceList();
      document.getElementById("enhanceListBody").scrollTop = previousScrollTop;
    });
    body.appendChild(more);
  }
}

function buildEnhanceListRow({ item, owner, locked }) {
  const row = document.createElement("div");
  row.className = "skill-row";
  row.style.borderColor = rarityColor(item.rarity);
  const icon = document.createElement("div");
  icon.className = "skill-row-icon";
  icon.textContent = SLOT_ICONS[item.slot] || "❓";
  row.appendChild(icon);
  const name = document.createElement("div");
  name.className = "skill-row-name";
  name.textContent = (item.locked ? "🔒" : "") + itemLabel(item);
  name.style.color = rarityColor(item.rarity);
  if (QPCore.rewards.hasProtectedOption(item)) {
    const badge = document.createElement("span");
    badge.className = "inv-valuable-tag";
    badge.textContent = "★ 高品質OP";
    name.appendChild(badge);
  }
  if (owner && !(enhanceListFilter === "equipped" && enhanceListGroup === "owner")) {
    const who = document.createElement("span");
    who.className = "item-options";
    who.textContent = `${owner.name}が装備中` + (locked ? "（探索中のため強化できません）" : "");
    name.appendChild(who);
  } else if (locked) {
    const who = document.createElement("span");
    who.className = "item-options";
    who.textContent = "探索中のため強化できません";
    name.appendChild(who);
  }
  row.appendChild(name);
  const btn = document.createElement("button");
  btn.className = "priority-chip";
  btn.textContent = "強化する";
  btn.disabled = locked;
  btn.addEventListener("click", () => openEnhanceModal(item, () => {
    if (owner) clampVitals(owner); // 強化で最大HP/MPが変わった時のため
    const scrollTop = document.getElementById("enhanceListBody").scrollTop;
    renderEnhanceList();
    document.getElementById("enhanceListBody").scrollTop = scrollTop; // 強化後も一覧の位置を保つ
  }));
  row.appendChild(btn);
  return row;
}
document.getElementById("btnEnhanceListBack").addEventListener("click", () => {
  setEnhanceFilterOpen(false);
  openPartyMenu();
});

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
};
const MENU_SECTIONS = [
  { title: "ギルド", rows: [
    { key: "recruit", label: "仲間を呼ぶ", open: () => menuOpenCreate() },
    { key: "party", label: "パーティ編成", open: () => openPartyScreen("screen-menu") },
    { key: "farewell", label: "仲間と別れる", open: () => openFarewell() },
  ] },
  { title: "鍛冶屋", rows: [
    { key: "enhance", label: "装備強化", open: () => openEnhanceList() },
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
// 別れた仲間は戻らないため2回押しで確定する。装備していたアイテムは所持品に戻る
let farewellSelection = new Set();
let farewellConfirm = false;
let farewellMessage = "";

function openFarewell() {
  farewellSelection = new Set();
  farewellConfirm = false;
  farewellMessage = "";
  renderFarewell();
  showScreen("screen-farewell");
}

function renderFarewell() {
  const body = document.getElementById("farewellBody");
  body.innerHTML = "";
  const desc = document.createElement("div");
  desc.className = "sub-ability-row";
  desc.textContent = "選んだ仲間と別れます（取り消せません）。装備していたアイテムは所持品に戻ります。パーティに編成中の仲間と、お気に入り（★）の仲間は選べません。";
  body.appendChild(desc);

  const candidates = Inventory.releaseCandidates();
  for (const c of [...farewellSelection]) if (!candidates.includes(c)) farewellSelection.delete(c);
  if (candidates.length === 0) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.textContent = "別れられる仲間がいません（パーティの外にいる仲間だけ選べます）";
    body.appendChild(none);
  }
  const list = document.createElement("div");
  list.className = "skill-row-list";
  for (const c of candidates) {
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
    list.appendChild(row);
  }
  body.appendChild(list);

  const n = farewellSelection.size;
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
  body.appendChild(btn);
  if (farewellMessage) {
    const msg = document.createElement("p");
    msg.className = "settings-message";
    msg.textContent = farewellMessage;
    body.appendChild(msg);
  }
}
document.getElementById("btnFarewellBack").addEventListener("click", () => openPartyMenu());

// ---------- 装備強化（装備中・所持品の装備をまとめて選ぶ） ----------
// 探索中・自動周回中のチームのキャラが付けている装備は、戦闘中の能力値が変わらないよう強化できない
let enhanceListFilter = "equipped";
function openEnhanceList() {
  renderEnhanceList();
  showScreen("screen-enhance");
}
function renderEnhanceList() {
  const filterRow = document.getElementById("enhanceFilterRow");
  filterRow.innerHTML = "";
  for (const f of [{ key: "equipped", name: "装備中" }, { key: "inventory", name: "所持品" }]) {
    const chip = document.createElement("button");
    chip.className = "priority-chip inv-filter" + (enhanceListFilter === f.key ? " tier-3" : "");
    chip.textContent = f.name;
    chip.addEventListener("click", () => { enhanceListFilter = f.key; renderEnhanceList(); });
    filterRow.appendChild(chip);
  }
  const body = document.getElementById("enhanceListBody");
  body.innerHTML = "";
  const head = document.createElement("div");
  head.className = "sub-ability-row";
  head.textContent = `強化石 ${S.material}個` + (isFeatureEnabled("guaranteedStone") ? `／確定強化石 ${guaranteedStoneTotal()}個` : "");
  body.appendChild(head);

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
  const rank = (it) => RARITIES.findIndex((r) => r.key === it.rarity);
  rows.sort((a, b) => rank(b.item) - rank(a.item) || (b.item.plus || 0) - (a.item.plus || 0));
  if (rows.length === 0) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.textContent = enhanceListFilter === "equipped" ? "装備中のアイテムがありません" : "未装備の所持品がありません";
    body.appendChild(none);
    return;
  }
  const list = document.createElement("div");
  list.className = "skill-row-list";
  for (const { item, owner, locked } of rows) {
    const row = document.createElement("div");
    row.className = "skill-row";
    row.style.borderColor = rarityColor(item.rarity);
    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = SLOT_ICONS[item.slot] || "❓";
    row.appendChild(icon);
    const name = document.createElement("div");
    name.className = "skill-row-name";
    name.textContent = itemLabel(item);
    name.style.color = rarityColor(item.rarity);
    if (owner) {
      const who = document.createElement("span");
      who.className = "item-options";
      who.textContent = `${owner.name}が装備中` + (locked ? "（探索中のため強化できません）" : "");
      name.appendChild(who);
    }
    row.appendChild(name);
    const btn = document.createElement("button");
    btn.className = "priority-chip";
    btn.textContent = "強化する";
    btn.disabled = locked;
    btn.addEventListener("click", () => openEnhanceModal(item, () => {
      if (owner) clampVitals(owner); // 強化で最大HP/MPが変わった時のため
      renderEnhanceList();
    }));
    row.appendChild(btn);
    list.appendChild(row);
  }
  body.appendChild(list);
}
document.getElementById("btnEnhanceListBack").addEventListener("click", () => openPartyMenu());

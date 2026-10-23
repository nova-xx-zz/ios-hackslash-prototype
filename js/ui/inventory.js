// ---------- 画面: 所持品一覧・装備強化モーダル ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- 所持品一覧 ----------
// 未装備のアイテム(inventory配列)と、スキルブック(skillBooks配列。ドロップ・鑑定・
// 使用はまだ未実装の予約フィールド)をスロット種別／スキルブックで絞り込んで一覧表示する。
// 装備中のアイテムはinventoryから除外されており(equipItem/unequipSlot参照)、
// 各キャラの装備タブからいつでも確認できるため、ここでは未装備分だけを扱う。
let inventoryFilterSlot = "all"; // "all" | SLOTS[].key | "skillBook"
let inventoryQualityView = "all"; // all | valuable | safe | locked
let inventorySortMode = "rarity"; // rarity | power | materials
let inventoryVisibleLimit = 80; // 大量所持品でも一度に全DOMを生成しない
const inventoryOrganize = QPCore.inventoryOrganize;

// 手動の分解: 「分解する」で選択モードにし、アイテムをタップで選んで強化石に変える（自動分解と同じ量）。
// 取り消せないため、実行は2回押し（1回目で内容を確認、2回目で確定）。装備中のアイテムは所持品に無いので対象外
let disassembleMode = false;
let disassembleSelection = new Set(); // 選んだアイテム（オブジェクトそのもの）
let disassembleConfirming = false;
let bulkIncludeValuable = false; // 貴重品・強化済み・UR/LRは明示した時だけ一括候補
let bulkIncludeCursed = false; // 呪いは独立した選択条件

let inventoryReturnScreen = "screen-jobs"; // 「もどる」の戻り先（編成メニューから開いた時は screen-menu）
// opts: { disassemble（分解する装備を選ぶ状態で開く）, returnScreen }
function openInventoryScreen(opts) {
  opts = opts || {};
  inventoryReturnScreen = opts.returnScreen || "screen-jobs";
  inventoryFilterSlot = "all";
  inventoryQualityView = "all";
  inventorySortMode = "rarity";
  inventoryVisibleLimit = 80;
  exitDisassembleMode();
  if (opts.disassemble) disassembleMode = true;
  showInventoryMessage("");
  renderInventoryScreen();
  showScreen("screen-inventory");
}

function exitDisassembleMode() {
  disassembleMode = false;
  disassembleSelection = new Set();
  disassembleConfirming = false;
  bulkIncludeValuable = false;
  bulkIncludeCursed = false;
}

function showInventoryMessage(text) {
  const el = document.getElementById("inventoryMessage");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

// 今の絞り込みで表示されている装備（スキルブックは分解の対象外）
function shownInventoryItems() {
  if (inventoryFilterSlot === "skillBook") return [];
  return inventoryOrganize.filter(S.inventory, inventoryFilterSlot, inventoryQualityView);
}

function renderInventoryManageControls() {
  const row = document.getElementById("inventoryManageRow");
  row.innerHTML = "";
  row.classList.toggle("hidden", inventoryFilterSlot === "skillBook");
  if (inventoryFilterSlot === "skillBook") return;
  const addChoice = (name, options, current, change) => {
    const label = document.createElement("span");
    label.className = "disassemble-filter-label";
    label.textContent = name + ":";
    row.appendChild(label);
    for (const [key,text] of options) {
      const button = document.createElement("button");
      button.className = "priority-chip inv-filter" + (current === key ? " tier-3" : "");
      button.textContent = text;
      button.addEventListener("click", () => {
        change(key);
        inventoryVisibleLimit = 80;
        disassembleConfirming = false;
        document.getElementById("inventoryBody").scrollTop = 0;
        renderInventoryScreen();
      });
      row.appendChild(button);
    }
  };
  addChoice("表示", [["all","すべて"],["valuable","保護・貴重"],["safe","整理候補"],["locked","ロック"]],
    inventoryQualityView, v => {inventoryQualityView=v;});
  addChoice("順序", [["rarity","レア度"],["power","能力"],["materials","素材価値"]],
    inventorySortMode, v => {inventorySortMode=v;});
}

function renderDisassembleControls() {
  // .btn.small の display 指定が .hidden より強いため、style で隠す
  document.getElementById("btnInventoryDisassemble").style.display = disassembleMode ? "none" : "";
  // まとめて選ぶ: 表示中のアイテムのうち、そのレア度をすべて選ぶ（全部選ばれていれば外す）
  const bulk = document.getElementById("inventoryBulkRow");
  bulk.classList.toggle("hidden", !disassembleMode);
  bulk.innerHTML = "";
  if (disassembleMode) {
    const label = document.createElement("span");
    label.className = "disassemble-filter-label";
    label.textContent = "まとめて選ぶ:";
    bulk.appendChild(label);
    const shown = shownInventoryItems();
    // 初期状態は安全候補のみ。任意で貴重品/呪い/UR/LRも対象にできるが、ロックは常に除外する。
    const mode = document.createElement("button");
    mode.className = "disassemble-chip" + (bulkIncludeValuable ? " active" : "");
    mode.textContent = bulkIncludeValuable ? "貴重を含む" : "貴重を含まない";
    mode.setAttribute("aria-pressed", bulkIncludeValuable ? "true" : "false");
    mode.addEventListener("click", () => {
      bulkIncludeValuable = !bulkIncludeValuable;
      for (const item of [...disassembleSelection]) {
        if (!inventoryOrganize.isBulkSelectable(item, bulkIncludeValuable, bulkIncludeCursed)) disassembleSelection.delete(item);
      }
      disassembleConfirming = false;
      renderInventoryScreen();
    });
    bulk.appendChild(mode);
    const cursedMode = document.createElement("button");
    cursedMode.className = "disassemble-chip" + (bulkIncludeCursed ? " active" : "");
    cursedMode.textContent = bulkIncludeCursed ? "呪いを含む" : "呪いを含まない";
    cursedMode.setAttribute("aria-pressed", bulkIncludeCursed ? "true" : "false");
    cursedMode.addEventListener("click", () => {
      bulkIncludeCursed = !bulkIncludeCursed;
      for (const item of [...disassembleSelection]) {
        if (!inventoryOrganize.isBulkSelectable(item, bulkIncludeValuable, bulkIncludeCursed)) disassembleSelection.delete(item);
      }
      disassembleConfirming = false;
      renderInventoryScreen();
    });
    bulk.appendChild(cursedMode);
    const safe = shown.filter((item) => inventoryOrganize.isBulkSelectable(item, bulkIncludeValuable, bulkIncludeCursed));
    const safeAll = safe.length > 0 && safe.every(i => disassembleSelection.has(i));
    const safeBtn = document.createElement("button");
    safeBtn.className = "disassemble-chip" + (safeAll ? " active" : "");
    safeBtn.textContent = `${bulkIncludeValuable || bulkIncludeCursed ? "条件一致すべて" : "安全候補すべて"} (${safe.length})`;
    safeBtn.disabled = safe.length === 0;
    safeBtn.addEventListener("click", () => {
      for (const item of safe) { if (safeAll) disassembleSelection.delete(item); else disassembleSelection.add(item); }
      disassembleConfirming = false;
      renderInventoryScreen();
    });
    bulk.appendChild(safeBtn);
    for (const rarity of RARITIES) {
      const items = safe.filter((i) => i.rarity === rarity.key);
      const all = items.length > 0 && items.every((i) => disassembleSelection.has(i));
      const chip = document.createElement("button");
      chip.className = "disassemble-chip" + (all ? " active" : "");
      chip.textContent = rarity.key.toUpperCase();
      chip.title = rarity.name + "の現在の一括選択条件に一致する装備を選ぶ（ロック除外）";
      chip.disabled = items.length === 0;
      if (all) { chip.style.background = rarity.color; chip.style.color = "#171a1a"; }
      chip.addEventListener("click", () => {
        for (const i of items) { if (all) disassembleSelection.delete(i); else disassembleSelection.add(i); }
        disassembleConfirming = false;
        renderInventoryScreen();
      });
      bulk.appendChild(chip);
    }
  }

  const bar = document.getElementById("inventoryDisassembleBar");
  bar.classList.toggle("hidden", !disassembleMode);
  if (!disassembleMode) return;
  const selected = [...disassembleSelection];
  const gain = selected.reduce((sum, i) => sum + Inventory.disassembleValue(i), 0);
  const enhanced = selected.filter((i) => (i.plus || 0) > 0).length;
  const lockedSelected = selected.some((i) => i.locked);
  const high = selected.filter((i) => i.rarity === "ur" || i.rarity === "lr").length;
  const highOp = selected.filter((i) => QPCore.rewards.hasProtectedOption(i)).length;
  const special = selected.filter((i) => i.unique || i.cursed).length;
  let text = selected.length ? `${selected.length}個を選択中 → 強化石 +${gain}` : "分解するアイテムをタップして選んでください";
  if (disassembleConfirming) {
    const warn = [];
    if (enhanced) warn.push(`強化済み${enhanced}個`);
    if (high) warn.push(`UR・LR ${high}個`);
    if (highOp) warn.push(`高品質OP ${highOp}個`);
    if (special) warn.push(`名のある・呪いの装備 ${special}個`);
    text += `\n${warn.length ? warn.join("・") + "を含みます。" : ""}分解すると戻せません。もう一度押すと分解します。`;
  }
  document.getElementById("inventoryDisassembleSummary").textContent = text;
  const confirm = document.getElementById("btnDisassembleConfirm");
  confirm.disabled = selected.length === 0 || lockedSelected;
  confirm.textContent = disassembleConfirming ? "本当に分解する" : "分解する";
}

function renderInventoryScreen() {
  const filterRow = document.getElementById("inventoryFilterRow");
  filterRow.innerHTML = "";
  const filters = [{ key: "all", name: "すべて" }, ...SLOTS, { key: "skillBook", name: "スキルブック" }];
  for (const f of filters) {
    const btn = document.createElement("button");
    btn.className = "priority-chip inv-filter" + (inventoryFilterSlot === f.key ? " tier-3" : "");
    btn.textContent = f.name;
    btn.addEventListener("click", () => { inventoryFilterSlot = f.key; inventoryVisibleLimit = 80; disassembleConfirming = false; document.getElementById("inventoryBody").scrollTop=0; renderInventoryScreen(); });
    filterRow.appendChild(btn);
  }

  renderInventoryManageControls();
  const shownItems = shownInventoryItems();
  const totalCount = S.inventory.length + S.skillBooks.length;
  const includesBooks = inventoryFilterSlot === "skillBook" || (inventoryFilterSlot === "all" && inventoryQualityView === "all");
  const shownCount = shownItems.length + (includesBooks ? S.skillBooks.length : 0);
  const safeCount = S.inventory.filter(inventoryOrganize.isSafeBulkCandidate).length;
  const valuableCount = S.inventory.filter(inventoryOrganize.isValuable).length;
  document.getElementById("inventoryCount").textContent = `所持品 ${totalCount}個（保護・貴重 ${valuableCount} / 整理候補 ${safeCount}）・条件一致 ${shownCount}個`;
  renderDisassembleControls();

  const body = document.getElementById("inventoryBody");
  body.innerHTML = "";
  let remaining = inventoryVisibleLimit;
  if (shownCount === 0) {
    const none = document.createElement("div");
    none.className = "sub-ability-row";
    none.textContent = inventoryFilterSlot === "skillBook"
      ? "スキルブックがありません（スキルブックの入手・鑑定・使用はまだ実装されていません）"
      : "未装備の所持品がありません（装備中のアイテムは各キャラの装備タブで確認できます）";
    body.appendChild(none);
    return;
  }

  for (const slot of SLOTS) {
    if (inventoryFilterSlot !== "all" && inventoryFilterSlot !== slot.key) continue;
    const items = inventoryOrganize.sort(shownItems.filter(i => i.slot === slot.key), RARITIES, inventorySortMode, itemEffectiveValue);
    if (items.length === 0 || remaining <= 0) continue;
    const showing = items.slice(0, remaining);
    remaining -= showing.length;
    body.appendChild(sectionLabel(`${slot.name}（${items.length}個中${showing.length}個）`));
    const list = document.createElement("div");
    list.className = "skill-row-list";
    for (const item of showing) list.appendChild(buildInventoryItemRow(item));
    body.appendChild(list);
  }

  if (includesBooks && remaining > 0) {
    const books = S.skillBooks.slice().sort((a, b) => {
      const ra = RARITIES.findIndex((r) => r.key === a.rarity);
      const rb = RARITIES.findIndex((r) => r.key === b.rarity);
      return rb - ra;
    });
    if (books.length > 0) {
      const showing = books.slice(0, remaining);
      remaining -= showing.length;
      body.appendChild(sectionLabel(`スキルブック（${books.length}個中${showing.length}個）`));
      const list = document.createElement("div");
      list.className = "skill-row-list";
      for (const book of showing) list.appendChild(buildInventorySkillBookRow(book));
      body.appendChild(list);
    }
  }
  if (shownCount > inventoryVisibleLimit) {
    const more = document.createElement("button");
    more.className = "btn small ghost inventory-more";
    more.textContent = `さらに表示（残り${shownCount - inventoryVisibleLimit}個）`;
    more.addEventListener("click", () => {
      const previousScrollTop = body.scrollTop;
      inventoryVisibleLimit += 80;
      renderInventoryScreen();
      document.getElementById("inventoryBody").scrollTop = previousScrollTop;
    });
    body.appendChild(more);
  }
}

function buildInventoryItemRow(item) {
  const row = document.createElement("div");
  row.className = "skill-row";
  row.style.borderColor = rarityColor(item.rarity);

  const icon = document.createElement("div");
  icon.className = "skill-row-icon";
  icon.textContent = SLOT_ICONS[item.slot] || "❓";
  row.appendChild(icon);

  const name = document.createElement("div");
  name.className = "skill-row-name";
  name.textContent = (item.locked ? "🔒" : "") + itemLabel(item); // レア度は名前の色で表す（ノーマル白〜レジェンドレア金）
  name.style.color = rarityColor(item.rarity);
  if (item.unique) {
    const eff = document.createElement("span");
    eff.className = "inv-unique-effect" + (item.cursed ? " cursed" : "");
    eff.textContent = itemEffectText(item);
    name.appendChild(eff);
  }
  if (inventoryOrganize.isValuable(item)) {
    const badge = document.createElement("span");
    badge.className = "inv-valuable-tag";
    badge.textContent = QPCore.rewards.hasProtectedOption(item) ? "★ 高品質OP" : "◆ 保護・貴重";
    name.appendChild(badge);
  }
  if (item.options && item.options.length) {
    const opt = document.createElement("span");
    opt.className = "item-options";
    opt.textContent = `オプション: ${itemOptionsText(item)}`;
    name.appendChild(opt);
  }
  row.appendChild(name);

  if (disassembleMode && item.locked) {
    // ロックした装備は選べない（ロックは選択モードを抜けてから外す）
    row.classList.add("locked");
    const note = document.createElement("div");
    note.className = "disassemble-gain";
    note.textContent = "ロック中";
    row.appendChild(note);
    return row;
  }
  if (disassembleMode) {
    // 選択モードでは行全体をタップで選ぶ（右に選択の印と、分解で得られる強化石の量）
    const selected = disassembleSelection.has(item);
    row.classList.add("selectable");
    row.classList.toggle("selected", selected);
    const gain = document.createElement("div");
    gain.className = "disassemble-gain";
    gain.textContent = `+${Inventory.disassembleValue(item)}`;
    row.appendChild(gain);
    const mark = document.createElement("div");
    mark.className = "skill-toggle-circle static" + (selected ? " on" : "");
    row.appendChild(mark);
    row.addEventListener("click", () => {
      if (disassembleSelection.has(item)) disassembleSelection.delete(item); else disassembleSelection.add(item);
      disassembleConfirming = false;
      renderInventoryScreen();
    });
    return row;
  }

  const lock = document.createElement("button");
  lock.className = "priority-chip lock-chip" + (item.locked ? " tier-3" : "");
  lock.textContent = item.locked ? "🔒" : "🔓";
  lock.title = item.locked ? "ロック中（分解されません）。押すとロックを外す" : "ロックする（手動・自動の分解から守る）";
  lock.addEventListener("click", () => { Inventory.setLocked(item, !item.locked); scheduleSave(); renderInventoryScreen(); });
  row.appendChild(lock);

  const enhance = document.createElement("button");
  enhance.className = "priority-chip";
  enhance.textContent = "強化する";
  enhance.addEventListener("click", () => openEnhanceModal(item, () => renderInventoryScreen()));
  row.appendChild(enhance);

  return row;
}

// スキルブックのドロップ・鑑定・使用は未実装のため、現状は一覧表示のみ（操作ボタンなし）。
// 未鑑定では詳細設計§6.3のとおりレア度だけを表示し、名称・効果・適性はUIに出さない
function buildInventorySkillBookRow(book) {
  const row = document.createElement("div");
  row.className = "skill-row";
  const rarity = RARITIES.find((r) => r.key === book.rarity);
  if (rarity) row.style.borderColor = rarity.color;

  const icon = document.createElement("div");
  icon.className = "skill-row-icon";
  icon.textContent = "📖";
  row.appendChild(icon);

  const name = document.createElement("div");
  name.className = "skill-row-name";
  const rarityName = rarity ? rarity.name : book.rarity;
  name.textContent = book.identified
    ? `${book.name || "鑑定済みのスキルブック"}（${rarityName}）`
    : `未鑑定のスキルブック（${rarityName}）`;
  row.appendChild(name);

  return row;
}

document.getElementById("btnInventoryBack").addEventListener("click", () => {
  exitDisassembleMode();
  if (inventoryReturnScreen === "screen-menu") { openPartyMenu(); return; }
  renderJobsScreen();
  showScreen("screen-jobs");
});
document.getElementById("btnInventoryDisassemble").addEventListener("click", () => {
  disassembleMode = true;
  disassembleSelection = new Set();
  disassembleConfirming = false;
  showInventoryMessage("");
  renderInventoryScreen();
});
document.getElementById("btnDisassembleCancel").addEventListener("click", () => {
  exitDisassembleMode();
  renderInventoryScreen();
});
document.getElementById("btnDisassembleConfirm").addEventListener("click", () => {
  if (disassembleSelection.size === 0 || [...disassembleSelection].some((item) => item.locked)) return;
  if (!disassembleConfirming) { disassembleConfirming = true; armConfirm(); renderInventoryScreen(); return; }
  if (!confirmReady()) return;
  const result = Inventory.disassembleItems([...disassembleSelection]);
  exitDisassembleMode();
  saveGame();
  showInventoryMessage(`${result.count}個を分解して、強化石を${result.materialGained}個手に入れました（所持 ${S.material}）`);
  renderInventoryScreen();
});

// 装備セクション（枠をタップで所持品から選ぶ）
let openSlot = null; // "charId:枠のkey"
let unequipAllConfirmCharId = null;
let unequipAllConfirmUntil = 0;
let overwriteEquipmentSetConfirm = null;
let overwriteEquipmentSetUntil = 0;
let expandedEquipmentSetKey = null;
let editingEquipmentSetKey = null;
let openEquipmentSetsCharId = null; // 右上メニューの表示対象。キャラを切り替えた際は閉じる。

function buildEquipSection(c) {
  const wrap = document.createElement("div");

  const toolbar = document.createElement("div");
  toolbar.className = "equip-toolbar";
  const head = document.createElement("div");
  head.className = "sub-ability-row equip-toolbar-title";
  head.textContent = `装備（所持品 ${S.inventory.length}個）`;
  toolbar.appendChild(head);

  // マイセットを通常の装備一覧から外し、装備欄の右上から開く。
  // 開いたメニューは浮かせて表示し、装備枠や装備変更の候補を下へ押し出さない。
  const mysetsAnchor = document.createElement("div");
  mysetsAnchor.className = "equip-mysets-anchor";
  const mysetsOpen = openEquipmentSetsCharId === c.id;
  const mysetsToggle = document.createElement("button");
  mysetsToggle.className = "equip-choice equip-mysets-toggle";
  mysetsToggle.textContent = mysetsOpen ? "閉じる ✕" : "マイセット";
  mysetsToggle.setAttribute("aria-expanded", mysetsOpen ? "true" : "false");
  mysetsToggle.setAttribute("aria-controls", "equip-mysets-panel");
  mysetsToggle.addEventListener("click", () => {
    openEquipmentSetsCharId = mysetsOpen ? null : c.id;
    renderCharDetail();
  });
  mysetsAnchor.appendChild(mysetsToggle);
  toolbar.appendChild(mysetsAnchor);
  wrap.appendChild(toolbar);

  // このジョブが持てる種類
  const profile = equipProfile(c);
  const typeNames = (keys) => keys.map((k) => getItemType(k).name).join("・");
  const canUse = document.createElement("div");
  canUse.className = "equip-can-use";
  canUse.textContent = `持てる武器: ${typeNames(profile.weapons) || "なし"}${profile.dualWield ? "（二刀流）" : ""}` +
    ` ／ 盾: ${typeNames(profile.shields) || "なし"} ／ 頭: ${typeNames(profile.head)} ／ 体: ${typeNames(profile.body)}`;
  wrap.appendChild(canUse);

  const accSlots = accessorySlots(c);
  const grid = document.createElement("div");
  grid.className = "equip-slot-grid";
  for (const pos of EQUIP_POSITIONS) {
    const item = c.equip[pos.key];
    const key = `${c.id}:${pos.key}`;
    const accIndex = QPCore.equipment.ACC_POSITIONS.indexOf(pos.key);
    const locked = accIndex >= accSlots;
    const blocked = pos.key === "off" && c.equip.main && c.equip.main.hands === 2;
    const btn = document.createElement("button");
    btn.className = "equip-slot" + (item ? " filled" : "") + (openSlot === key ? " open" : "") + (locked || blocked ? " locked" : "");
    if (item) btn.style.borderColor = rarityColor(item.rarity);
    const emptyText = locked ? (c.isMonster ? `Lv${MONSTER_ACCESSORY_SLOT_LEVELS[accIndex - 1]}で解放` : "スキルツリーで解放")
      : blocked ? "（両手武器）" : "なし";
    btn.innerHTML = `<span class="slot-name"></span><span class="slot-item"></span><span class="slot-stats"></span>`;
    btn.querySelector(".slot-name").textContent = pos.name;
    btn.querySelector(".slot-item").textContent = item ? `${itemMark(item)}${item.name}${item.plus > 0 ? "+" + item.plus : ""}` : emptyText;
    btn.querySelector(".slot-stats").textContent = item ? [itemStatsText(item), itemEffectText(item), itemOptionsText(item)].filter(Boolean).join(" ／ ") : "";
    if (item) btn.querySelector(".slot-item").style.color = rarityColor(item.rarity);
    if (locked || blocked) btn.disabled = true;
    btn.addEventListener("click", () => {
      openSlot = openSlot === key ? null : key;
      renderCharDetail();
    });
    grid.appendChild(btn);
  }
  wrap.appendChild(grid);

  // 装備の候補は装備枠の直後に表示。マイセットより下に押し出さない。
  const choiceListContainer = document.createElement("div");
  choiceListContainer.className = "equip-choice-container";
  wrap.appendChild(choiceListContainer);

  // セット効果（同じシリーズを2個以上付けている時）
  for (const set of setBonuses(c).active) {
    const row = document.createElement("div");
    row.className = "equip-set-row";
    const name = document.createElement("span");
    name.className = "equip-set-name";
    name.textContent = `${set.series.name}セット ${set.count}個`;
    row.appendChild(name);
    for (const b of set.bonuses) {
      const chip = document.createElement("span");
      chip.className = "equip-set-bonus" + (b.active ? " on" : "");
      chip.textContent = `${b.count}: ${b.desc}`;
      row.appendChild(chip);
    }
    wrap.appendChild(row);
  }

  // 付けている名のある装備の説明文
  for (const { item, def } of setBonuses(c).uniques) {
    const row = document.createElement("div");
    row.className = "equip-unique-row" + (item.cursed ? " cursed" : "");
    row.innerHTML = `<span class="equip-unique-name"></span><span class="equip-unique-flavor"></span>`;
    row.querySelector(".equip-unique-name").textContent = `${itemMark(item)}${item.name}: ${def.effect.desc}`;
    row.querySelector(".equip-unique-flavor").textContent = def.flavor;
    wrap.appendChild(row);
  }

  const autoBtn = document.createElement("button");
  autoBtn.className = "equip-choice";
  autoBtn.style.marginTop = "6px";
  autoBtn.textContent = "おまかせ装備（呪いの装備は選ばない）";
  autoBtn.addEventListener("click", () => { autoEquip(c); renderCharDetail(); });
  wrap.appendChild(autoBtn);

  if (EQUIP_POSITIONS.some((pos) => !!c.equip[pos.key])) {
    const removeAll = document.createElement("button");
    removeAll.className = "equip-choice equip-unequip-all";
    const confirming = unequipAllConfirmCharId === c.id && Date.now() < unequipAllConfirmUntil;
    removeAll.textContent = confirming ? "もう一度押すと装備をすべて外します" : "装備をすべて外す";
    removeAll.disabled = c.team !== null && isTeamLocked(c.team);
    removeAll.addEventListener("click", () => {
      if (c.team !== null && isTeamLocked(c.team)) return;
      if (unequipAllConfirmCharId !== c.id || Date.now() >= unequipAllConfirmUntil) {
        unequipAllConfirmCharId = c.id;
        unequipAllConfirmUntil = Date.now() + 10000;
        armConfirm();
        renderCharDetail();
        return;
      }
      if (!confirmReady()) return;
      for (const pos of EQUIP_POSITIONS) if (c.equip[pos.key]) unequipSlot(c, pos.key);
      unequipAllConfirmCharId = null;
      unequipAllConfirmUntil = 0;
      openSlot = null;
      saveGame();
      renderCharDetail();
    });
    wrap.appendChild(removeAll);
  }

  // マイセットは初期5枠、購入パック1つにつき+5枠（最大20）。実物の装備IDを保存するので、
  // 分解・他キャラへ移動した装備は勝手に代替せず、読み込みを中止する。
  const sets = document.createElement("section");
  sets.id = "equip-mysets-panel";
  sets.className = "equip-mysets" + (mysetsOpen ? "" : " hidden");
  const setsLabel = document.createElement("div");
  setsLabel.className = "equip-mysets-title";
  const presetLimit = Shop.presetCapacity();
  setsLabel.textContent = `装備マイセット（${presetLimit}/20枠）`;
  sets.appendChild(setsLabel);
  for (let slotIndex = 0; slotIndex < presetLimit; slotIndex++) {
    const preset = savedSet(c, slotIndex);
    const row = document.createElement("div");
    row.className = "equip-myset-row";
    const label = document.createElement("span");
    const presetKey = c.id + ":" + slotIndex;
    label.className = "equip-myset-name";
    label.textContent = preset ? (preset.name || `セット${slotIndex + 1}`) : `セット${slotIndex + 1}（未登録）`;
    row.appendChild(label);
    const save = document.createElement("button");
    save.className = "equip-choice";
    const overwriteKey = c.id + ":" + slotIndex;
    save.textContent = preset && overwriteEquipmentSetConfirm === overwriteKey && Date.now() < overwriteEquipmentSetUntil ? "上書きを確定" : "保存";
    save.disabled = c.team !== null && isTeamLocked(c.team);
    save.addEventListener("click", () => {
      if (preset && (overwriteEquipmentSetConfirm !== overwriteKey || Date.now() >= overwriteEquipmentSetUntil)) {
        overwriteEquipmentSetConfirm = overwriteKey;
        overwriteEquipmentSetUntil = Date.now() + 10000;
        armConfirm();
        renderCharDetail();
        return;
      }
      if (preset && !confirmReady()) return;
      const result = saveEquipmentSet(c, slotIndex);
      overwriteEquipmentSetConfirm = null;
      overwriteEquipmentSetUntil = 0;
      flashDetailNotice(result.ok ? `装備マイセット${slotIndex + 1}を保存しました` :
        "装備を1つ以上付けてください（IDのない装備は登録できません）");
      if (result.ok) saveGame();
      renderCharDetail();
    });
    row.appendChild(save);
    const load = document.createElement("button");
    load.className = "equip-choice";
    load.textContent = "呼出";
    load.disabled = !preset || c.team !== null && isTeamLocked(c.team);
    load.addEventListener("click", () => {
      const result = applyEquipmentSet(c, slotIndex);
      const messages = {
        missing: "登録した装備が見つかりません。分解・移動の有無を確認してください",
        taken: "登録した装備は別の仲間が装備中です。外してから呼び出してください",
        duplicate: "装備IDに重複があります。セットを再登録してください",
        ambiguous: "旧データで同じ装備IDが重複しています。装備を確認してセットを再登録してください",
        job: "現在のジョブや装備枠では装着できません", locked: "探索中のため変更できません" };
      flashDetailNotice(result.ok ? `装備マイセット${slotIndex + 1}に切り替えました` :
        messages[result.reason] || "装備マイセットを呼び出せません");
      if (result.ok) {
        saveGame();
        // 呼び出した装備をすぐ見比べられるよう、パネルを閉じて候補表示も解除する。
        openEquipmentSetsCharId = null;
        openSlot = null;
      }
      renderCharDetail();
    });
    row.appendChild(load);
    if (preset) {
      const previewButton = document.createElement("button");
      previewButton.className = "equip-choice";
      previewButton.textContent = expandedEquipmentSetKey === presetKey ? "閉じる" : "内容";
      previewButton.setAttribute("aria-expanded", expandedEquipmentSetKey === presetKey ? "true" : "false");
      previewButton.addEventListener("click", () => {
        expandedEquipmentSetKey = expandedEquipmentSetKey === presetKey ? null : presetKey;
        renderCharDetail();
      });
      row.appendChild(previewButton);

      const renameButton = document.createElement("button");
      renameButton.className = "equip-choice";
      renameButton.textContent = editingEquipmentSetKey === presetKey ? "編集終了" : "名前変更";
      renameButton.disabled = c.team !== null && isTeamLocked(c.team);
      renameButton.addEventListener("click", () => {
        editingEquipmentSetKey = editingEquipmentSetKey === presetKey ? null : presetKey;
        renderCharDetail();
      });
      row.appendChild(renameButton);
      if (editingEquipmentSetKey === presetKey) {
        const editor = document.createElement("div");
        editor.className = "equip-myset-editor";
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 20;
        input.value = preset.name || `セット${slotIndex + 1}`;
        input.placeholder = "マイセット名（20文字以内）";
        input.setAttribute("aria-label", "マイセット名");
        editor.appendChild(input);
        const confirm = document.createElement("button");
        confirm.className = "equip-choice";
        confirm.textContent = "決定";
        const commit = () => {
          const result = renameEquipmentSet(c, slotIndex, input.value);
          if (result.ok) {
            editingEquipmentSetKey = null;
            saveGame();
            flashDetailNotice("マイセット名を変更しました");
            renderCharDetail();
          } else flashDetailNotice("1〜20文字で名前を入力してください");
        };
        confirm.addEventListener("click", commit);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") { editingEquipmentSetKey = null; renderCharDetail(); }
        });
        editor.appendChild(confirm);
        row.appendChild(editor);
      }
      if (expandedEquipmentSetKey === presetKey) {
        const preview = document.createElement("div");
        preview.className = "equip-myset-preview";
        const hint = document.createElement("div");
        hint.className = "equip-myset-hint";
        hint.textContent = "保存した装備構成（状態は現在の所持・装備状況）";
        preview.appendChild(hint);
        const statusNames = { equipped: "装備中", inventory: "所持品", other: "他の仲間が装備中",
          missing: "現在見つからない", empty: "" };
        for (const gear of equipmentSetPreview(c, slotIndex)) {
          const itemRow = document.createElement("div");
          itemRow.className = "equip-myset-item" + (gear.empty ? " empty" : "");
          const part = document.createElement("span");
          part.className = "equip-myset-part";
          const def = EQUIP_POSITIONS.find((p) => p.key === gear.position);
          part.textContent = def ? def.name : gear.position;
          itemRow.appendChild(part);
          const desc = document.createElement("span");
          desc.className = "equip-myset-gear";
          desc.textContent = gear.empty ? "未装備" :
            `${gear.rarity ? "[" + gear.rarity.toUpperCase() + "] " : ""}${gear.name}${gear.plus > 0 ? " +" + gear.plus : ""}`;
          itemRow.appendChild(desc);
          if (!gear.empty) {
            const state = document.createElement("span");
            state.className = "equip-myset-status";
            state.textContent = statusNames[gear.status] || "";
            itemRow.appendChild(state);
          }
          preview.appendChild(itemRow);
        }
        row.appendChild(preview);
      }
      const del = document.createElement("button");
      del.className = "equip-choice";
      del.textContent = "削除";
      del.disabled = c.team !== null && isTeamLocked(c.team);
      del.addEventListener("click", () => {
        if (deleteEquipmentSet(c, slotIndex)) {
          saveGame();
          flashDetailNotice(`装備マイセット${slotIndex + 1}の登録を解除しました`);
          renderCharDetail();
        }
      });
      row.appendChild(del);
    }
    sets.appendChild(row);
  }
  if (presetLimit < 20 && isFeatureEnabled("shop")) {
    const expansion = document.createElement("button");
    expansion.className = "equip-choice equip-myset-expand";
    expansion.textContent = `＋5枠解放（現在 ${presetLimit}/20枠・480円予定）`;
    expansion.addEventListener("click", () => {
      openEquipmentSetsCharId = null;
      openShop("screen-chardetail", "preset_slots_5");
    });
    sets.appendChild(expansion);
  }
  mysetsAnchor.appendChild(sets);

  // 開いている枠の候補一覧（そのキャラが付けられる物だけ）
  const opened = EQUIP_POSITIONS.find((p) => openSlot === `${c.id}:${p.key}`);
  if (opened) {
    const hint = document.createElement("div");
    hint.className = "equip-choice-heading";
    hint.textContent = `${opened.name}の装備を選ぶ`;
    choiceListContainer.appendChild(hint);
    const list = document.createElement("div");
    list.className = "equip-choice-list";
    const candidates = S.inventory
      .filter((i) => canPlaceItem(c, i, opened.key))
      .sort((a, b) => itemScore(c, b) - itemScore(c, a));

    if (c.equip[opened.key]) {
      const off = document.createElement("button");
      off.className = "equip-choice";
      off.textContent = "はずす";
      off.addEventListener("click", () => { unequipSlot(c, opened.key); renderCharDetail(); });
      list.appendChild(off);

      const enhance = document.createElement("button");
      enhance.className = "equip-choice enhance-open";
      enhance.textContent = "強化する";
      enhance.addEventListener("click", () => openEnhanceModal(c.equip[opened.key]));
      list.appendChild(enhance);
    }
    if (candidates.length === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = `（${opened.name}に付けられる手持ちがありません）`;
      list.appendChild(none);
    }
    for (const item of candidates) {
      const btn = document.createElement("button");
      btn.className = "equip-choice";
      btn.style.borderColor = rarityColor(item.rarity);
      btn.style.color = rarityColor(item.rarity);
      btn.textContent = itemLabel(item) + (item.hands === 2 ? "・両手" : "") + (item.unique ? ` ${itemEffectText(item)}` : "") +
        (item.options && item.options.length ? ` [${itemOptionsText(item)}]` : "");

      btn.addEventListener("click", () => { equipItem(c, item, opened.key); openSlot = null; renderCharDetail(); });
      list.appendChild(btn);
    }
    choiceListContainer.appendChild(list);
  }

  return wrap;
}

// ---------- 装備強化 ----------
const SLOT_ICONS = Object.fromEntries(SLOTS.map((sl) => [sl.key, sl.icon]));
let enhanceItem = null;
let enhanceMessage = "";
let enhanceOnClose = null; // 呼び出し元の画面を再描画するコールバック（未指定ならキャラ詳細を再描画）
let enhanceGuaranteedConfirm = false; // 確定強化石のボタンを1回押して確認待ちか（有償の石も使うため2回押しで確定）
let enhanceBatchTarget = 10; // プルダウンで選ぶ目標値。画面を開く時は+10（現在が高ければ+1上）
let enhanceBatchConfirm = false;
let enhanceBatchBusy = false;
let enhanceBatchMessage = "";
let enhanceBatchSucceeded = false;

function openEnhanceModal(item, onClose) {
  enhanceItem = item;
  enhanceMessage = "";
  enhanceOnClose = onClose || null;
  enhanceGuaranteedConfirm = false;
  enhanceBatchTarget = Math.min(ENHANCE_MAX_PLUS, Math.max(10, (item.plus || 0) + 1));
  enhanceBatchConfirm = false;
  enhanceBatchBusy = false;
  enhanceBatchMessage = "";
  enhanceBatchSucceeded = false;
  renderEnhanceModal();
  document.getElementById("enhanceModal").classList.remove("hidden");
}

function closeEnhanceModal() {
  document.getElementById("enhanceModal").classList.add("hidden");
  enhanceBatchConfirm = false;
  enhanceItem = null;
  const onClose = enhanceOnClose;
  enhanceOnClose = null;
  if (onClose) onClose();
  else renderCharDetail();
}

function renderEnhanceModal() {
  const item = enhanceItem;
  if (!item) return;
  const rarity = RARITIES.find((r) => r.key === item.rarity);
  const maxed = item.plus >= ENHANCE_MAX_PLUS;
  const nextText = itemStatsText({ ...item, plus: item.plus + 1 });

  document.getElementById("enIcon").textContent = SLOT_ICONS[item.slot] || "❓";
  document.getElementById("enName").textContent = `${item.locked ? "🔒" : ""}${itemMark(item)}${item.name}${item.plus > 0 ? "+" + item.plus : ""}`;
  document.getElementById("btnEnhanceLock").textContent = item.locked ? "🔒 ロック中（押すと外す）" : "🔓 ロックする（分解から守る）";
  document.getElementById("enName").style.color = rarityColor(item.rarity);
  document.getElementById("enDesc").textContent =
    `${rarity.name} / ${itemStatsText(item)}` +
    (maxed ? "（強化値が上限に達しています）" : ` → 成功で ${nextText}`) +
    (item.options && item.options.length ? `\nオプション: ${itemOptionsText(item)}` : "") +
    (item.unique ? `\n${itemEffectText(item)}\n「${getUniqueItem(item.base).flavor}」` : "");

  const rate = enhanceSuccessRate(item);
  const cost = enhanceCost(item);
  const statsBox = document.getElementById("enStats");
  statsBox.innerHTML = `
    <div class="pm-stat-row"><span class="pm-stat-label">強化値</span><span>+${item.plus} / +${ENHANCE_MAX_PLUS}</span></div>
    <div class="pm-stat-row"><span class="pm-stat-label">成功率</span><span>${formatEnhanceRate(rate)}</span></div>
    <div class="pm-stat-row"><span class="pm-stat-label">消費強化石</span><span>${cost}（所持 ${S.material}）</span></div>` +
    (isFeatureEnabled("enhancePity") && !maxed ? buildPityRow(item) : "") +
    (isFeatureEnabled("guaranteedStone") && !maxed
      ? `<div class="pm-stat-row"><span class="pm-stat-label">確定強化石</span><span>必要 ${guaranteedStonesRequired(item)}個（所持 ${guaranteedStoneTotal()}：無償${S.guaranteedStones.free}／有償${S.guaranteedStones.paid}）</span></div>`
      : "");

  const resultBox = document.getElementById("enResult");
  resultBox.textContent = enhanceMessage;
  resultBox.className = "enhance-result" + (enhanceMessage.startsWith("成功") ? " success" : enhanceMessage ? " fail" : "");

  const btn = document.getElementById("btnEnhanceGo");
  btn.disabled = maxed || S.material < cost;
  btn.textContent = maxed ? "強化値が上限です" : (S.material < cost ? "強化石が足りません" : "1回だけ強化する");

  // 現在値より上の+段だけをネイティブselectに表示する。
  // 1回強化・一括強化で現在値が進んだ際は、古い目標を自動で無効化する。
  const minTarget = Math.min(ENHANCE_MAX_PLUS, item.plus + 1);
  if (enhanceBatchTarget < minTarget || enhanceBatchTarget > ENHANCE_MAX_PLUS) {
    enhanceBatchTarget = minTarget;
    enhanceBatchConfirm = false;
  }
  const targetSelect = document.getElementById("enBatchTarget");
  targetSelect.innerHTML = Array.from(
    { length: ENHANCE_MAX_PLUS - minTarget + 1 },
    (_, index) => {
      const value = minTarget + index;
      return `<option value="${value}">+${value}</option>`;
    },
  ).join("");
  targetSelect.value = String(enhanceBatchTarget);
  targetSelect.disabled = maxed || enhanceBatchBusy;
  const estimate = Inventory.estimateEnhanceToTarget(item, enhanceBatchTarget);
  const costLabel = (n) => n.toLocaleString("ja-JP");
  const estimateBox = document.getElementById("enBatchEstimate");
  estimateBox.textContent = !estimate ? "すでに最大強化値に達しています。"
    : estimate.maxStones === null
      ? `天井機能なし：必要総数の上限は計算できません（所持 ${costLabel(S.material)}個）`
      : `天井までの最大必要数：${costLabel(estimate.maxStones)}個（所持 ${costLabel(S.material)}個）`;
  const canBatch = !enhanceBatchBusy && Inventory.canBatchEnhance(item) &&
    !!estimate && S.material >= cost;
  const batchBtn = document.getElementById("btnEnhanceBatch");
  batchBtn.disabled = !canBatch;
  batchBtn.textContent = enhanceBatchConfirm && canBatch
    ? `本当に+${enhanceBatchTarget}まで強化する`
    : `+${enhanceBatchTarget}まで強化する`;
  const batchHint = document.getElementById("enBatchHint");
  batchHint.textContent = !Inventory.canBatchEnhance(item) && !maxed
    ? "所持していない装備、または探索中のパーティの装備は強化できません。"
    : maxed ? "強化値が上限に達しています。"
    : S.material < cost ? "次の1回に必要な通常強化石が足りません。"
    : enhanceBatchConfirm ? "成功するたび次の段階へ進みます。実際に使用した石だけ消費します。もう一度押すと開始します。"
    : estimate && estimate.maxStones !== null && S.material < estimate.maxStones
      ? "天井までの最大必要数には不足していますが、所持石で試行できます。石不足で途中停止します。"
      : "天井分を先払いしません。成功したらその段階の残りは使わず、次の段階に進みます。";
  const batchResult = document.getElementById("enBatchResult");
  batchResult.textContent = enhanceBatchMessage;
  batchResult.className = "enhance-result" + (enhanceBatchMessage ? enhanceBatchSucceeded ? " success" : " fail" : "");

  const gBtn = document.getElementById("btnEnhanceGuaranteed");
  gBtn.classList.toggle("hidden", !isFeatureEnabled("guaranteedStone"));
  const required = maxed ? 0 : guaranteedStonesRequired(item);
  const enough = guaranteedStoneTotal() >= required;
  // 足りない時は押すとショップを開く（確定強化石はショップで手に入る）
  gBtn.disabled = maxed;
  // 消費は無償分が先。有償分まで使う時は、確認の文言にその個数を出す
  const paidUse = Math.max(0, required - S.guaranteedStones.free);
  const confirming = enhanceGuaranteedConfirm && enough && !maxed;
  gBtn.classList.toggle("danger", confirming);
  gBtn.textContent = maxed ? "強化値が上限です"
    : !enough ? `確定強化石が足りません（あと${required - guaranteedStoneTotal()}個）→ショップへ`
    : confirming ? `本当に確定強化石${required}個を使う${paidUse > 0 ? `（うち有償${paidUse}個）` : ""}`
    : `確定強化石${required}個で強化する（成功率100%）`;
}

function buildPityRow(item) {
  const threshold = enhancePityThreshold(item);
  const pity = Math.min(item.pity || 0, threshold);
  const text = isPityReady(item) ? "次の強化は必ず成功" : `${pity} / ${threshold}`;
  return `<div class="pm-stat-row"><span class="pm-stat-label">天井</span><span>${text}</span></div>`;
}

// 成功率は低い帯（LRの終盤は0.5%）でも0%と表示されないよう、10%未満は小数第1位まで出す
function formatEnhanceRate(rate) {
  const pct = rate * 100;
  return (pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) + "%";
}

document.getElementById("btnEnhanceGo").addEventListener("click", () => {
  enhanceBatchConfirm = false;
  enhanceBatchMessage = "";
  // 判定と強化石・+値・天井ゲージへの反映は js/model/inventory.js
  const result = Inventory.enhanceItem(enhanceItem);
  if (!result) return;
  enhanceGuaranteedConfirm = false;
  enhanceMessage = result.success
    ? `成功！ +${result.plus} になった` + (result.pityHit ? "（天井）" : "")
    : `失敗…（+${result.plus} のまま）`;
  scheduleSave();
  renderEnhanceModal();
});
// プルダウン変更時は必ず確認を取り消し、天井までの最大必要数を再計算する。
document.getElementById("enBatchTarget").addEventListener("change", (event) => {
  if (!enhanceItem || enhanceBatchBusy) return;
  const value = Number(event.target.value);
  const minTarget = Math.min(ENHANCE_MAX_PLUS, enhanceItem.plus + 1);
  if (!Number.isSafeInteger(value) || value < minTarget || value > ENHANCE_MAX_PLUS) {
    renderEnhanceModal(); // 不正・古い値は採用しない
    return;
  }
  enhanceBatchTarget = value;
  enhanceBatchConfirm = false;
  enhanceBatchMessage = "";
  renderEnhanceModal();
});
document.getElementById("btnEnhanceBatch").addEventListener("click", () => {
  if (!enhanceItem || enhanceBatchBusy) return;
  if (!Inventory.canBatchEnhance(enhanceItem) ||
      !Inventory.estimateEnhanceToTarget(enhanceItem, enhanceBatchTarget) ||
      S.material < enhanceCost(enhanceItem)) {
    enhanceBatchConfirm = false;
    renderEnhanceModal();
    return;
  }
  if (!enhanceBatchConfirm) {
    enhanceGuaranteedConfirm = false; // 有償石の二段階確認と混線させない
    enhanceBatchConfirm = true;
    armConfirm();
    enhanceBatchMessage = "";
    renderEnhanceModal();
    return;
  }
  if (!confirmReady()) return;
  enhanceBatchConfirm = false;
  enhanceBatchBusy = true;
  try {
    const result = Inventory.enhanceToTarget(enhanceItem, enhanceBatchTarget);
    if (!result) return;
    const reason = {
      target: "目標達成",
      material: "強化石不足で停止",
      invalid: "強化を安全に続けられず停止",
    }[result.reason] || "停止";
    enhanceBatchSucceeded = result.reason === "target";
    enhanceBatchMessage =
      `${reason}：+${result.fromPlus} → +${result.plus}（目標+${result.targetPlus}）\n` +
      `${result.attempts}回挑戦／成功${result.successes}回・失敗${result.failures}回\n` +
      `通常強化石 ${result.spent}個消費／残り${result.remainingMaterial}個`;
    // 結果を同じセーブとして保存。課金・確定強化石は使わない。
    if (result.attempts > 0 && !saveGame()) enhanceBatchMessage += "\n端末保存に失敗しました。保存容量を確認してください。";
  } finally {
    enhanceBatchBusy = false;
    renderEnhanceModal();
  }
});

// 確定強化石: その段の期待消費に応じた個数を消費して必ず+1する（通常の強化石は消費しない）。
// 消費は取り消せないため即時保存する
document.getElementById("btnEnhanceGuaranteed").addEventListener("click", () => {
  enhanceBatchConfirm = false;
  if (enhanceItem && !Inventory.isMaxed(enhanceItem) && guaranteedStoneTotal() < guaranteedStonesRequired(enhanceItem)) {
    const screen = document.querySelector(".screen:not(.hidden)");
    closeEnhanceModal();
    openShop(screen ? screen.id : "screen-battle", "guaranteed_stone_11");
    return;
  }
  if (!enhanceGuaranteedConfirm) { enhanceGuaranteedConfirm = true; armConfirm(); enhanceMessage = ""; renderEnhanceModal(); return; }
  if (!confirmReady()) return;
  enhanceGuaranteedConfirm = false;
  const result = Inventory.enhanceWithGuaranteed(enhanceItem); // 消費は無償分から
  if (!result) return;
  enhanceMessage = `成功！ +${result.plus} になった（確定強化石${result.required}個を使用）`;
  saveGame();
  renderEnhanceModal();
});
document.getElementById("btnEnhanceLock").addEventListener("click", () => {
  if (!enhanceItem) return;
  Inventory.setLocked(enhanceItem, !enhanceItem.locked);
  scheduleSave();
  renderEnhanceModal();
});
document.getElementById("btnEnhanceClose").addEventListener("click", closeEnhanceModal);
document.getElementById("enhanceModal").addEventListener("click", (e) => {
  if (e.target.id === "enhanceModal") closeEnhanceModal();
});

document.getElementById("btnJobsDone").addEventListener("click", () => {
  if (jobsReturnScreen === "screen-menu") {
    openPartyMenu();
  } else if (jobsReturnScreen === "screen-map") {
    openMap();
  } else {
    openExploreHub();
  }
});
document.getElementById("btnMapJobs").addEventListener("click", () => {
  jobsReturnScreen = "screen-map";
  renderJobsScreen();
  showScreen("screen-jobs");
});
document.getElementById("btnDetailBack").addEventListener("click", () => {
  detailCharId = null;
  openSlot = null;
  renderJobsScreen();
  showScreen("screen-jobs");
});

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

// 手動の分解: 「分解する」で選択モードにし、アイテムをタップで選んで強化石に変える（自動分解と同じ量）。
// 取り消せないため、実行は2回押し（1回目で内容を確認、2回目で確定）。装備中のアイテムは所持品に無いので対象外
let disassembleMode = false;
let disassembleSelection = new Set(); // 選んだアイテム（オブジェクトそのもの）
let disassembleConfirming = false;

let inventoryReturnScreen = "screen-jobs"; // 「もどる」の戻り先（編成メニューから開いた時は screen-menu）
// opts: { disassemble（分解する装備を選ぶ状態で開く）, returnScreen }
function openInventoryScreen(opts) {
  opts = opts || {};
  inventoryReturnScreen = opts.returnScreen || "screen-jobs";
  inventoryFilterSlot = "all";
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
}

function showInventoryMessage(text) {
  const el = document.getElementById("inventoryMessage");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

// 今の絞り込みで表示されている装備（スキルブックは分解の対象外）
function shownInventoryItems() {
  return S.inventory.filter((i) => inventoryFilterSlot === "all" || inventoryFilterSlot === i.slot);
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
    for (const rarity of RARITIES) {
      const items = shown.filter((i) => i.rarity === rarity.key);
      const all = items.length > 0 && items.every((i) => disassembleSelection.has(i));
      const chip = document.createElement("button");
      chip.className = "disassemble-chip" + (all ? " active" : "");
      chip.textContent = rarity.key.toUpperCase();
      chip.title = rarity.name;
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
  const high = selected.filter((i) => i.rarity === "ur" || i.rarity === "lr").length;
  let text = selected.length ? `${selected.length}個を選択中 → 強化石 +${gain}` : "分解するアイテムをタップして選んでください";
  if (disassembleConfirming) {
    const warn = [];
    if (enhanced) warn.push(`強化済み${enhanced}個`);
    if (high) warn.push(`UR・LR ${high}個`);
    text += `\n${warn.length ? warn.join("・") + "を含みます。" : ""}分解すると戻せません。もう一度押すと分解します。`;
  }
  document.getElementById("inventoryDisassembleSummary").textContent = text;
  const confirm = document.getElementById("btnDisassembleConfirm");
  confirm.disabled = selected.length === 0;
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
    btn.addEventListener("click", () => { inventoryFilterSlot = f.key; disassembleConfirming = false; renderInventoryScreen(); });
    filterRow.appendChild(btn);
  }

  const totalCount = S.inventory.length + S.skillBooks.length;
  const shownCount = inventoryFilterSlot === "all" ? totalCount
    : inventoryFilterSlot === "skillBook" ? S.skillBooks.length
    : S.inventory.filter((i) => i.slot === inventoryFilterSlot).length;
  document.getElementById("inventoryCount").textContent = `所持品 ${totalCount}個中 ${shownCount}個を表示`;
  renderDisassembleControls();

  const body = document.getElementById("inventoryBody");
  body.innerHTML = "";
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
    const items = S.inventory
      .filter((i) => i.slot === slot.key)
      .sort((a, b) => {
        const ra = RARITIES.findIndex((r) => r.key === a.rarity);
        const rb = RARITIES.findIndex((r) => r.key === b.rarity);
        return rb - ra || itemEffectiveValue(b) - itemEffectiveValue(a);
      });
    if (items.length === 0) continue;
    body.appendChild(sectionLabel(`${slot.name}（${items.length}個）`));
    const list = document.createElement("div");
    list.className = "skill-row-list";
    for (const item of items) list.appendChild(buildInventoryItemRow(item));
    body.appendChild(list);
  }

  if (inventoryFilterSlot === "all" || inventoryFilterSlot === "skillBook") {
    const books = S.skillBooks.slice().sort((a, b) => {
      const ra = RARITIES.findIndex((r) => r.key === a.rarity);
      const rb = RARITIES.findIndex((r) => r.key === b.rarity);
      return rb - ra;
    });
    if (books.length > 0) {
      body.appendChild(sectionLabel(`スキルブック（${books.length}個）`));
      const list = document.createElement("div");
      list.className = "skill-row-list";
      for (const book of books) list.appendChild(buildInventorySkillBookRow(book));
      body.appendChild(list);
    }
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
  name.textContent = itemLabel(item); // レア度は名前の色で表す（ノーマル白〜レジェンドレア金）
  name.style.color = rarityColor(item.rarity);
  if (item.unique) {
    const eff = document.createElement("span");
    eff.className = "inv-unique-effect" + (item.cursed ? " cursed" : "");
    eff.textContent = itemEffectText(item);
    name.appendChild(eff);
  }
  if (item.options && item.options.length) {
    const opt = document.createElement("span");
    opt.className = "item-options";
    opt.textContent = `オプション: ${itemOptionsText(item)}`;
    name.appendChild(opt);
  }
  row.appendChild(name);

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

document.getElementById("btnOpenInventory").addEventListener("click", () => { openInventoryScreen(); });
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
  if (disassembleSelection.size === 0) return;
  if (!disassembleConfirming) { disassembleConfirming = true; renderInventoryScreen(); return; }
  const result = Inventory.disassembleItems([...disassembleSelection]);
  exitDisassembleMode();
  saveGame();
  showInventoryMessage(`${result.count}個を分解して、強化石を${result.materialGained}個手に入れました（所持 ${S.material}）`);
  renderInventoryScreen();
});

// 装備セクション（枠をタップで所持品から選ぶ）
let openSlot = null; // "charId:枠のkey"

function buildEquipSection(c) {
  const wrap = document.createElement("div");

  const head = document.createElement("div");
  head.className = "sub-ability-row";
  head.textContent = `装備（所持品 ${S.inventory.length}個）`;
  wrap.appendChild(head);

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

  // 開いている枠の候補一覧（そのキャラが付けられる物だけ）
  const opened = EQUIP_POSITIONS.find((p) => openSlot === `${c.id}:${p.key}`);
  if (opened) {
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
    wrap.appendChild(list);
  }

  return wrap;
}

// ---------- 装備強化 ----------
const SLOT_ICONS = Object.fromEntries(SLOTS.map((sl) => [sl.key, sl.icon]));
let enhanceItem = null;
let enhanceMessage = "";
let enhanceOnClose = null; // 呼び出し元の画面を再描画するコールバック（未指定ならキャラ詳細を再描画）

function openEnhanceModal(item, onClose) {
  enhanceItem = item;
  enhanceMessage = "";
  enhanceOnClose = onClose || null;
  renderEnhanceModal();
  document.getElementById("enhanceModal").classList.remove("hidden");
}

function closeEnhanceModal() {
  document.getElementById("enhanceModal").classList.add("hidden");
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
  document.getElementById("enName").textContent = `${itemMark(item)}${item.name}${item.plus > 0 ? "+" + item.plus : ""}`;
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
  btn.textContent = maxed ? "強化値が上限です" : (S.material < cost ? "強化石が足りません" : "強化する");

  const gBtn = document.getElementById("btnEnhanceGuaranteed");
  gBtn.classList.toggle("hidden", !isFeatureEnabled("guaranteedStone"));
  const required = maxed ? 0 : guaranteedStonesRequired(item);
  const enough = guaranteedStoneTotal() >= required;
  // 足りない時は押すとショップを開く（確定強化石はショップで手に入る）
  gBtn.disabled = maxed;
  gBtn.textContent = maxed ? "強化値が上限です"
    : (enough ? `確定強化石${required}個で強化する（成功率100%）` : `確定強化石が足りません（あと${required - guaranteedStoneTotal()}個）→ショップへ`);
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
  // 判定と強化石・+値・天井ゲージへの反映は js/model/inventory.js
  const result = Inventory.enhanceItem(enhanceItem);
  if (!result) return;
  enhanceMessage = result.success
    ? `成功！ +${result.plus} になった` + (result.pityHit ? "（天井）" : "")
    : `失敗…（+${result.plus} のまま）`;
  scheduleSave();
  renderEnhanceModal();
});
// 確定強化石: その段の期待消費に応じた個数を消費して必ず+1する（通常の強化石は消費しない）。
// 消費は取り消せないため即時保存する
document.getElementById("btnEnhanceGuaranteed").addEventListener("click", () => {
  if (enhanceItem && !Inventory.isMaxed(enhanceItem) && guaranteedStoneTotal() < guaranteedStonesRequired(enhanceItem)) {
    const screen = document.querySelector(".screen:not(.hidden)");
    closeEnhanceModal();
    openShop(screen ? screen.id : "screen-battle", "guaranteed_stone_11");
    return;
  }
  const result = Inventory.enhanceWithGuaranteed(enhanceItem); // 消費は無償分から
  if (!result) return;
  enhanceMessage = `成功！ +${result.plus} になった（確定強化石${result.required}個を使用）`;
  saveGame();
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
document.getElementById("btnRecruit").addEventListener("click", () => { openCreateScreen(); });
document.getElementById("btnDetailBack").addEventListener("click", () => {
  detailCharId = null;
  openSlot = null;
  renderJobsScreen();
  showScreen("screen-jobs");
});

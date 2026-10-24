// ---------- 画面: ショップ（課金要素） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
// 商品と付与の処理は js/model/shop.js（Shop）。プロトタイプでは決済の代わりに、購入ボタンを2回押すと無料で受け取れる。
"use strict";

let shopReturnScreen = "screen-settings";
let shopHighlight = null; // 開いた時に目立たせる商品のid（ロックされた x100 から開いた時など）
let shopConfirmId = null; // 「本当に購入する」の確認中の商品
let shopMessage = "";
const shopExpandedProducts = new Set(); // 詳細を開いた商品。確認ボタンで再描画しても状態を維持する

// ショップを開く。returnScreen: もどる先、highlightId: 目立たせる商品
function openShop(returnScreen, highlightId) {
  shopReturnScreen = returnScreen || "screen-settings";
  shopHighlight = highlightId || null;
  shopConfirmId = null;
  shopMessage = "";
  shopExpandedProducts.clear();
  const body = document.getElementById("shopBody");
  if (body) body.scrollTop = 0;
  renderShop();
  showScreen("screen-shop");
  if (shopHighlight) {
    const el = document.querySelector(`[data-product="${shopHighlight}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

// 特殊ジョブの解放は便利機能とは分ける。アイコンは世界観に合わせて記号に統一する。
const isJobProduct = (p) => p.feature === "specialJobs";
const SHOP_SECTIONS = [
  { title: "便利な機能（買い切り）", symbol: "✦", match: (p) => p.kind === "unlock" && !isJobProduct(p) },
  { title: "特殊ジョブ（テスト中）", symbol: "⚔", match: isJobProduct },
  { title: "確定強化石", symbol: "◆", match: (p) => p.kind === "guaranteedStone" },
  { title: "仲間のBOX", symbol: "♜", match: (p) => p.kind === "rosterBox" },
  { title: "マイセット登録枠", symbol: "▣", match: (p) => p.kind === "presetPack" },
];

function shopStat(labelText, valueText, detailText) {
  const stat = document.createElement("div");
  stat.className = "shop-stat";
  for (const [className, value] of [
    ["shop-stat-label", labelText],
    ["shop-stat-value", valueText],
    ["shop-stat-detail", detailText],
  ]) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = value;
    stat.appendChild(el);
  }
  return stat;
}

function renderShop() {
  const body = document.getElementById("shopBody");
  // 再描画（購入確認・購入完了）で、見ていた商品からページ先頭へ戻さない。
  const previousScrollTop = body.scrollTop;
  body.replaceChildren();

  const note = document.createElement("p");
  note.className = "shop-note";
  note.textContent = "テスト版：商品は無料で受け取れます。取り消し線の価格は本番予定の仮価格です。";
  body.appendChild(note);

  const status = document.createElement("section");
  status.className = "shop-status";
  status.setAttribute("aria-label", "現在の所持・解放状況");
  const statusTitle = document.createElement("div");
  statusTitle.className = "shop-status-title";
  statusTitle.textContent = "所持・解放状況";
  const statusGrid = document.createElement("div");
  statusGrid.className = "shop-status-grid";
  const maxRepeat = Math.max(...Shop.autoRepeatChoices().filter((c) => !c.locked).map((c) => c.n));
  statusGrid.append(
    shopStat("確定強化石", guaranteedStoneTotal() + "個",
      "無償" + S.guaranteedStones.free + " / 有償" + S.guaranteedStones.paid),
    shopStat("仲間", S.roster.length + " / " + Shop.rosterCapacity() + "人", "所持 / 上限"),
    shopStat("マイセット枠", Shop.presetCapacity() + " / 20枠", "全キャラクター共通"),
    shopStat("自動周回", "最大 ×" + maxRepeat,
      "戦闘速度 " + Shop.battleSpeeds().map((m) => "×" + m).join("・"))
  );
  status.append(statusTitle, statusGrid);
  body.appendChild(status);

  if (shopMessage) {
    const msg = document.createElement("p");
    msg.className = "shop-feedback";
    msg.setAttribute("role", "status");
    msg.textContent = shopMessage;
    body.appendChild(msg);
  }

  for (const section of SHOP_SECTIONS) {
    const items = Shop.products().filter(section.match);
    if (!items.length) continue;
    const group = document.createElement("section");
    group.className = "shop-section";
    const header = document.createElement("div");
    header.className = "shop-section-heading";
    const symbol = document.createElement("span");
    symbol.className = "shop-section-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = section.symbol;
    const title = document.createElement("h2");
    title.className = "shop-section-title";
    title.textContent = section.title;
    const count = document.createElement("span");
    count.className = "shop-section-count";
    count.textContent = items.length + "商品";
    header.append(symbol, title, count);
    const grid = document.createElement("div");
    grid.className = "shop-grid";
    for (const product of items) grid.appendChild(buildShopItem(product));
    group.append(header, grid);
    body.appendChild(group);
  }
  body.scrollTop = previousScrollTop;
}

function shopItemMeta(product, status) {
  if (status.locked) return "踏破後に解放";
  if (status.owned) return "購入済み";
  if (status.freeUnlocked) return "解放済み";
  if (product.kind === "rosterBox") return "上限 " + Shop.rosterCapacity() + "人";
  if (product.kind === "presetPack") return "解放 " + status.count + " / 3回";
  if (product.kind === "guaranteedStone") return "消費アイテム";
  return "買い切り";
}

function shopItemSymbol(product) {
  if (product.kind === "guaranteedStone") return "✧";
  if (product.kind === "rosterBox") return "♜";
  if (product.kind === "presetPack") return "▣";
  if (product.feature === "specialJobs") return "⚔";
  return "✦";
}

function buildShopItem(product) {
  const st = Shop.productStatus(product);
  const unavailable = st.soldOut || st.locked;
  const confirming = shopConfirmId === product.id;
  const row = document.createElement("article");
  row.className = "shop-item" +
    (shopHighlight === product.id ? " highlight" : "") +
    (unavailable ? " is-unavailable" : "") +
    (confirming ? " is-confirming" : "");
  row.dataset.product = product.id;

  const top = document.createElement("div");
  top.className = "shop-item-top";
  const symbol = document.createElement("span");
  symbol.className = "shop-item-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = shopItemSymbol(product);
  const name = document.createElement("div");
  name.className = "shop-item-name";
  name.textContent = product.name;
  top.append(symbol, name);

  const meta = document.createElement("div");
  meta.className = "shop-item-meta";
  meta.textContent = shopItemMeta(product, st);
  row.append(top, meta);

  const expanded = shopExpandedProducts.has(product.id);
  const desc = document.createElement("div");
  desc.className = "shop-item-desc";
  desc.id = "shop-desc-" + product.id;
  desc.textContent = product.desc +
    (product.kind === "rosterBox" ? "（拡張 " + st.count + "回）" :
      product.kind === "presetPack" ? "（現在 " + st.capacity + "/20枠）" : "") +
    (st.locked ? "\n「" + st.requires.dungeonName + "」を踏破すると購入できます" : "");
  desc.hidden = !expanded;

  const detailToggle = document.createElement("button");
  detailToggle.type = "button";
  detailToggle.className = "shop-item-details-toggle";
  detailToggle.setAttribute("aria-controls", desc.id);
  detailToggle.setAttribute("aria-expanded", String(expanded));
  detailToggle.textContent = expanded ? "詳細を閉じる ▲" : "詳細を見る ▼";
  detailToggle.addEventListener("click", () => {
    const show = desc.hidden;
    desc.hidden = !show;
    detailToggle.setAttribute("aria-expanded", String(show));
    detailToggle.textContent = show ? "詳細を閉じる ▲" : "詳細を見る ▼";
    if (show) shopExpandedProducts.add(product.id);
    else shopExpandedProducts.delete(product.id);
  });
  row.append(detailToggle, desc);

  const footer = document.createElement("div");
  footer.className = "shop-item-footer";
  const price = document.createElement("div");
  price.className = "shop-item-price";
  const originalPrice = document.createElement("s");
  originalPrice.textContent = "¥" + product.price.toLocaleString("ja-JP");
  const freePrice = document.createElement("strong");
  freePrice.textContent = "テスト無料";
  price.append(originalPrice, freePrice);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn small " + (unavailable ? "ghost" : "primary");
  btn.textContent = st.owned ? "購入済み" : st.freeUnlocked ? "解放済み" :
    st.soldOut ? "上限です" : st.locked ? "未解放" :
    confirming ? "受取を確定" : "購入する";
  btn.disabled = unavailable;
  btn.addEventListener("click", () => {
    if (shopConfirmId !== product.id) {
      shopConfirmId = product.id;
      shopMessage = "";
      armConfirm();
      renderShop();
      return;
    }
    if (!confirmReady()) return;
    shopConfirmId = null;
    const result = Shop.purchase(product.id);
    shopMessage = result.ok ? "「" + product.name + "」を受け取りました" : "購入できませんでした";
    // テスト購入も即時保存する。購入ロジックと付与仕様は変更しない。
    if (result.ok) saveGame();
    renderShop();
  });
  footer.append(price, btn);
  row.appendChild(footer);
  return row;
}

document.getElementById("btnShopBack").addEventListener("click", () => {
  shopConfirmId = null;
  // もどる先の画面を今の購入状況で描き直す
  if (shopReturnScreen === "screen-battle") renderDock();
  if (shopReturnScreen === "screen-jobs") renderJobsScreen();
  if (shopReturnScreen === "screen-menu") renderPartyMenu();
  // 強化画面の「確定強化石が足りない→ショップへ」から来た時は、所持数の表示を描き直す
  if (shopReturnScreen === "screen-enhance") renderEnhanceList();
  if (shopReturnScreen === "screen-inventory") renderInventoryScreen();
  if (shopReturnScreen === "screen-chardetail") renderCharDetail();
  showScreen(shopReturnScreen);
});
document.getElementById("btnSettingsShop").addEventListener("click", () => openShop("screen-settings"));
document.getElementById("btnSettingsShop").classList.toggle("hidden", !isFeatureEnabled("shop"));

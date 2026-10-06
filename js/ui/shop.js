// ---------- 画面: ショップ（課金要素） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
// 商品と付与の処理は js/model/shop.js（Shop）。プロトタイプでは決済の代わりに、購入ボタンを2回押すと無料で受け取れる。
"use strict";

let shopReturnScreen = "screen-settings";
let shopHighlight = null; // 開いた時に目立たせる商品のid（ロックされた x100 から開いた時など）
let shopConfirmId = null; // 「本当に購入する」の確認中の商品
let shopMessage = "";

// ショップを開く。returnScreen: もどる先、highlightId: 目立たせる商品
function openShop(returnScreen, highlightId) {
  shopReturnScreen = returnScreen || "screen-settings";
  shopHighlight = highlightId || null;
  shopConfirmId = null;
  shopMessage = "";
  renderShop();
  showScreen("screen-shop");
  if (shopHighlight) {
    const el = document.querySelector(`[data-product="${shopHighlight}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

const SHOP_SECTIONS = [
  { title: "便利な機能（買い切り）", kinds: ["unlock"] },
  { title: "確定強化石", kinds: ["guaranteedStone"] },
  { title: "仲間のBOX", kinds: ["rosterBox"] },
];

function renderShop() {
  const body = document.getElementById("shopBody");
  body.innerHTML = "";
  const note = document.createElement("p");
  note.className = "sub shop-note";
  note.textContent = "テスト版のため、購入ボタンで無料で受け取れます（表示している価格は本番の予定の仮の価格です）。";
  body.appendChild(note);

  const status = document.createElement("div");
  status.className = "shop-status";
  status.innerHTML =
    `確定強化石: ${guaranteedStoneTotal()}個（無償${S.guaranteedStones.free}／有償${S.guaranteedStones.paid}）<br>` +
    `仲間: ${S.roster.length}/${Shop.rosterCapacity()}人<br>` +
    `戦闘速度: ${Shop.battleSpeeds().map((m) => "x" + m).join("・")}　自動周回: 最大x${Math.max(...Shop.autoRepeatChoices().filter((c) => !c.locked).map((c) => c.n))}`;
  body.appendChild(status);
  // 購入した結果は、一覧の下ではなく見える位置（所持状況のすぐ下）に出す
  if (shopMessage) {
    const msg = document.createElement("p");
    msg.className = "settings-message";
    msg.textContent = shopMessage;
    body.appendChild(msg);
  }

  for (const section of SHOP_SECTIONS) {
    const title = document.createElement("div");
    title.className = "shop-section-title";
    title.textContent = section.title;
    body.appendChild(title);
    for (const product of SHOP_PRODUCTS.filter((p) => section.kinds.includes(p.kind))) body.appendChild(buildShopItem(product));
  }

}

function buildShopItem(product) {
  const st = Shop.productStatus(product);
  const row = document.createElement("div");
  row.className = "shop-item" + (shopHighlight === product.id ? " highlight" : "");
  row.dataset.product = product.id;

  const main = document.createElement("div");
  main.className = "shop-item-main";
  const name = document.createElement("div");
  name.className = "shop-item-name";
  name.textContent = product.name;
  const desc = document.createElement("div");
  desc.className = "shop-item-desc";
  desc.textContent = product.desc + (product.kind === "rosterBox" ? `（拡張 ${st.count}回・今の上限 ${Shop.rosterCapacity()}人）` : "") +
    (st.locked ? `\n「${st.requires.dungeonName}」を踏破すると購入できます` : "");
  const price = document.createElement("div");
  price.className = "shop-item-price";
  price.innerHTML = `<s>¥${product.price.toLocaleString("ja-JP")}</s>　テスト中は無料`;
  main.append(name, desc, price);
  row.appendChild(main);

  const btn = document.createElement("button");
  const confirming = shopConfirmId === product.id;
  btn.className = "btn small " + (st.soldOut || st.locked ? "ghost" : "primary");
  btn.textContent = st.owned ? "購入済み" : st.soldOut ? "上限です" : st.locked ? "未解放" : confirming ? "本当に受け取る" : "購入する";
  btn.disabled = st.soldOut || st.locked;
  btn.addEventListener("click", () => {
    if (shopConfirmId !== product.id) { shopConfirmId = product.id; shopMessage = ""; renderShop(); return; }
    shopConfirmId = null;
    const r = Shop.purchase(product.id);
    shopMessage = r.ok ? `「${product.name}」を受け取りました` : "購入できませんでした";
    // 購入はすぐ保存する（取り消せない操作のため、遅延保存を待たない）
    if (r.ok) saveGame();
    renderShop();
  });
  row.appendChild(btn);
  return row;
}

document.getElementById("btnShopBack").addEventListener("click", () => {
  shopConfirmId = null;
  // もどる先の画面を今の購入状況で描き直す
  if (shopReturnScreen === "screen-battle") renderDock();
  if (shopReturnScreen === "screen-jobs") renderJobsScreen();
  showScreen(shopReturnScreen);
});
document.getElementById("btnSettingsShop").addEventListener("click", () => openShop("screen-settings"));
document.getElementById("btnSettingsShop").classList.toggle("hidden", !isFeatureEnabled("shop"));

// 法務ページはJavaScriptなしでも読める静的HTMLとし、Web/iOSビルドに同梱する。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const docs = ["privacy", "terms", "commercial", "beta"];

test("設定とショップの双方から、全法務ページを開ける", () => {
  const index = read("index.html");
  const shop = read("js/ui/shop.js");
  for (const name of docs) {
    const href = `legal/${name}.html`;
    assert.ok(index.includes(`href="${href}"`), `設定画面: ${href}`);
    assert.ok(shop.includes(`"${href}"`), `ショップ: ${href}`);
  }
  assert.match(index, /css\/legal\.css\?v=/);
  assert.match(index, /js\/ui\/shop\.js\?v=9/);
  assert.match(index, /rel="noopener noreferrer"/);
});

test("法務ページのHTMLが揃い、相互移動とゲーム画面へ戻る導線がある", () => {
  for (const name of docs) {
    const html = read(`legal/${name}.html`);
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /lang="ja"/);
    assert.match(html, /<main/);
    assert.match(html, /href="\.\.\/index\.html"/);
    assert.match(html, /href="\.\.\/css\/legal\.css\?v=1"/);
    assert.match(html, /2026年10月25日/);
    for (const linked of docs) assert.ok(html.includes(`href="${linked}.html"`));
  }
  assert.ok(fs.existsSync(path.join(root, "css/legal.css")));
});

test("無料テスト購入と実決済なしを明示し、未確定の法定情報を偽装しない", () => {
  const beta = read("legal/beta.html");
  const sales = read("legal/commercial.html");
  const privacy = read("legal/privacy.html");
  assert.match(beta, /すべてのテスト購入は0円/);
  assert.match(sales, /現在は有料販売を行っていません/);
  assert.match(sales, /【要設定】/);
  assert.match(privacy, /Firebase Authentication/);
  assert.match(privacy, /Firestore/);
  assert.match(privacy, /【要設定/);
});

test("配布ビルドは法務ページを同梱する", () => {
  const build = read("tools/build-www.js");
  assert.match(build, /"fonts","legal"/);
});

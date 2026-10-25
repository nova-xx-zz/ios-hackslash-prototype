// 参考画像に合わせた表示専用UIの不変条件（ロジックの再設計ではない）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "js/ui/detail-tree.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("17ノードの正本を残し、方向札はズームするsceneからstageへ切り出す", () => {
  assert.match(js, /stage\.appendChild\(viewport\)/);
  assert.match(js, /stage\.appendChild\(label\)/);
  assert.doesNotMatch(js, /scene\.appendChild\(label\)/);
  assert.match(js, /const labelAnchors = \[/);
  assert.match(js, /const byId = Object\.fromEntries\(treeDef\.nodes/);
  assert.match(js, /for \(const node of treeDef\.nodes\)/);
  assert.match(js, /for \(const pre of node\.prerequisites\)/);
});

test("ズーム操作を失わず、3連ボタンを盤面内の常時表示から外す", () => {
  assert.match(js, /zoomPanel\.appendChild\(controls\)/);
  assert.match(js, /zoomTitle\.textContent = "表示調整"/);
  assert.doesNotMatch(js, /viewport\.appendChild\(controls\)/);
  assert.match(css, /\.crest-zoom-options:not\(\[open\]\) \.tree-web-controls/);
});

test("重厚な背景、丸札の分離、金縁の習得ボタンは剣士専用画面のみ", () => {
  assert.match(css, /#app:has\(#screen-chardetail\.warrior-crest-view:not\(\.hidden\)\)/);
  assert.match(css, /title-guild\.jpg/);
  assert.match(css, /\.crest-tree-stage \{/);
  assert.match(css, /\.tree-web-node\.ultimate-kind \{\s*width: 9\.8%/);
  assert.match(css, /\.crest-inline-detail \.crest-learn-btn \{/);
});

test("参照画像版の表示だけを変更し、他職・汎用やセーブのソースを触らない", () => {
  assert.match(js, /c\.job === "warrior" && scopeKey === "exclusive"/);
  assert.match(js, /canAcquireNode\(c, treeDef, ranks, node\)/);
  assert.match(js, /acquireNode\(c, treeDef, ranks, node\)/);
  assert.match(html, /css\/style\.css\?v=73/);
  assert.match(html, /js\/ui\/detail-tree\.js\?v=10/);
});

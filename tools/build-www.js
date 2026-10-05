// アプリ（Capacitor）に入れるファイルを www/ にまとめる。実行: npm run build:www（npm run cap:sync で自動実行）
// ゲーム本体はビルド不要のままで、ここではコピーするだけ（GitHub Pages ではリポジトリ直下をそのまま配信している）。
// docs/・tests/・tools/ などゲームに不要なものは入れない。新しいフォルダやファイルを index.html から読み込む時は INCLUDE に足す。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");
const INCLUDE = ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "data", "icons", "fonts"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const name of INCLUDE) {
  fs.cpSync(path.join(ROOT, name), path.join(OUT, name), { recursive: true });
}

// index.html から読み込んでいるファイルがすべて www/ に入ったか確かめる（INCLUDE の足し忘れを防ぐ）
const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map((m) => m[1]);
const missing = refs.filter((ref) => !fs.existsSync(path.join(OUT, ref)));
if (missing.length) {
  console.error("www/ に入っていないファイルがあります（tools/build-www.js の INCLUDE に追加してください）:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`www/ を作成しました（${INCLUDE.join(", ")}。index.html の参照 ${refs.length} 件を確認）`);

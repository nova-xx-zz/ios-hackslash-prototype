#!/usr/bin/env node
// ---------- キャッシュ番号（?v=）の上げ忘れチェック ----------
// index.html などが読み込む css/js/画像には `?v=N` を付け、中身を変えたら N を上げる運用になっている
// （GitHub Pages/Safariのキャッシュで古いファイルが残らないようにするため。docs/detailed-design.md §5）。
// 手作業では上げ忘れが起きるので、各ファイルの「いまの ?v= 番号」と「中身のハッシュ」を
// tools/cache-versions.json に記録しておき、次の2つを検出する:
//   1) 中身が変わったのに ?v= が記録と同じ（＝上げ忘れ）
//   2) ?v= や中身が変わったのに記録を更新していない、記録にないファイルがある、ページ間で番号が食い違う
//
//   node tools/cache-versions.js           … チェックだけ（問題があれば終了コード1。テストからも呼ぶ）
//   node tools/cache-versions.js --update  … 中身が変わったファイルの ?v= を1つ上げ、記録を書き直す
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "admin.html"];
const MANIFEST = path.join(__dirname, "cache-versions.json");
const REF_RE = /((?:src|href)=")([^"?#:]+)\?v=(\d+)(")/g;

function hashFile(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
}

// 各ページの ?v= 付きの参照を集める: { file: { versions: Set, pages: [] } }
function collectRefs(root = ROOT) {
  const refs = {};
  for (const page of PAGES) {
    const p = path.join(root, page);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, "utf8").matchAll(REF_RE)) {
      const file = m[2];
      const r = refs[file] || (refs[file] = { versions: new Set(), pages: [] });
      r.versions.add(Number(m[3]));
      r.pages.push(page);
    }
  }
  return refs;
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files || {}; } catch (e) { return {}; }
}

// 問題の一覧を返す（空ならOK）
function check() {
  const refs = collectRefs();
  const manifest = readManifest();
  const problems = [];
  for (const [file, r] of Object.entries(refs)) {
    if (!fs.existsSync(path.join(ROOT, file))) { problems.push(`${file}: ファイルがありません`); continue; }
    if (r.versions.size > 1) { problems.push(`${file}: ページによって ?v= が違います（${[...r.versions].join(", ")}）`); continue; }
    const v = [...r.versions][0];
    const hash = hashFile(file);
    const rec = manifest[file];
    if (!rec) { problems.push(`${file}: 記録がありません（新しく追加したファイル）`); continue; }
    if (rec.hash !== hash && rec.v === v) problems.push(`${file}: 中身が変わったのに ?v=${v} のままです`);
    else if (rec.hash !== hash || rec.v !== v) problems.push(`${file}: ?v= か中身が変わったのに記録が古いままです`);
  }
  for (const file of Object.keys(manifest)) {
    if (!refs[file]) problems.push(`${file}: もう読み込んでいないのに記録に残っています`);
  }
  return problems;
}

// 中身が変わったファイルの ?v= を上げ（記録の番号より大きい値にする）、記録を書き直す
function update() {
  const refs = collectRefs();
  const manifest = readManifest();
  const bumped = [];
  const next = {};
  for (const [file, r] of Object.entries(refs)) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file}: ファイルがありません`);
    const hash = hashFile(file);
    const cur = Math.max(...r.versions);
    const rec = manifest[file];
    let v = cur;
    // ページ間で番号が食い違う時は大きい方にそろえる（cur は最大値）
    if (rec && rec.hash !== hash && cur <= rec.v) v = rec.v + 1;
    if (v !== cur || r.versions.size > 1) bumped.push(`${file}: ?v=${[...r.versions].join("/")} → ?v=${v}`);
    next[file] = { v, hash };
  }
  for (const page of PAGES) {
    const p = path.join(ROOT, page);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, "utf8");
    const out = html.replace(REF_RE, (all, a, file, v, z) => (next[file] ? `${a}${file}?v=${next[file].v}${z}` : all));
    if (out !== html) fs.writeFileSync(p, out);
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  fs.writeFileSync(MANIFEST, JSON.stringify({
    note: "node tools/cache-versions.js --update で更新する。手で編集しない。",
    files: sorted,
  }, null, 2) + "\n");
  return bumped;
}

module.exports = { check, update, collectRefs, PAGES };

if (require.main === module) {
  if (process.argv.includes("--update")) {
    const bumped = update();
    console.log(bumped.length ? bumped.join("\n") : "?v= を上げるファイルはありません（記録を更新しました）");
  } else {
    const problems = check();
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error("\n`node tools/cache-versions.js --update`（または `npm run cache:bump`）で ?v= を上げて記録を更新してください。");
      process.exit(1);
    }
    console.log("?v= の上げ忘れはありません");
  }
}

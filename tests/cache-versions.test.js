"use strict";
// index.html などの ?v= の上げ忘れを CI で止める（tools/cache-versions.js）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "tools/cache-versions.js");

test("?v= の上げ忘れがない（中身を変えたら npm run cache:bump）", () => {
  const { check } = require(TOOL);
  const problems = check();
  assert.deepEqual(problems, [], "\n" + problems.join("\n") + "\n→ `npm run cache:bump` で ?v= を上げて記録を更新してください");
});

test("ツール自体: 中身だけ変えると検出し、--update で番号が上がって通る", () => {
  // リポジトリを汚さないよう、一時ディレクトリに小さな構成を作って試す
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cachever-"));
  fs.mkdirSync(path.join(dir, "tools"));
  fs.mkdirSync(path.join(dir, "js"));
  fs.copyFileSync(TOOL, path.join(dir, "tools/cache-versions.js"));
  fs.writeFileSync(path.join(dir, "js/a.js"), "a1");
  fs.writeFileSync(path.join(dir, "js/b.js"), "b1");
  fs.writeFileSync(path.join(dir, "index.html"), '<script src="js/a.js?v=3"></script><script src="js/b.js?v=7"></script>');
  fs.writeFileSync(path.join(dir, "admin.html"), '<script src="js/a.js?v=3"></script>');
  const run = (...args) => spawnSync(process.execPath, [path.join(dir, "tools/cache-versions.js"), ...args], { encoding: "utf8" });

  assert.notEqual(run().status, 0, "記録が無い状態は失敗する");
  assert.equal(run("--update").status, 0);
  assert.equal(run().status, 0, "記録した直後は通る");

  fs.writeFileSync(path.join(dir, "js/a.js"), "a2");
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /js\/a\.js: 中身が変わったのに \?v=3 のまま/);

  assert.equal(run("--update").status, 0);
  assert.equal(run().status, 0);
  const idx = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(idx, /js\/a\.js\?v=4/, "変えたファイルだけ上がる");
  assert.match(idx, /js\/b\.js\?v=7/, "変えていないファイルはそのまま");
  assert.match(fs.readFileSync(path.join(dir, "admin.html"), "utf8"), /js\/a\.js\?v=4/, "別ページの参照もそろう");

  // 手で番号だけ上げて記録を忘れた場合も検出する
  fs.writeFileSync(path.join(dir, "index.html"), idx.replace("b.js?v=7", "b.js?v=8"));
  assert.notEqual(run().status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

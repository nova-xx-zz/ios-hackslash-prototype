// 実行: node --test（リポジトリ直下で）
// 確認用モードの合言葉（js/debug-gate.js）: SHA-256の実装が正しいこと。合言葉そのものはテストにも書かない
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const gate = require("../js/debug-gate.js");

test("確認用モードの合言葉: SHA-256がNode.jsの実装と一致する（日本語・空文字・長い文字列）", () => {
  for (const s of ["", "abc", "あいうえお", "x".repeat(200), "合言葉-1234"]) {
    assert.equal(gate.sha256(s), crypto.createHash("sha256").update(s).digest("hex"), s.slice(0, 10));
  }
  assert.match(gate.PASS_HASH, /^[0-9a-f]{64}$/);
});

test("確認用モードの合言葉: iPhoneの入力でずれやすいところ（先頭の大文字・全角・「ー」・空白）をそろえて比べる", () => {
  const n = gate.normalize;
  assert.equal(n("Abc-Def"), "abc-def");
  assert.equal(n("ＡＢＣ－１２"), "abc-12");
  assert.equal(n(" abcーdef—1 "), "abc-def-1");
  assert.equal(gate.check(""), false);
});

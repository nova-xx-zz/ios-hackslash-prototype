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

// localStorage と location を差し替えて、入る・抜けるの印を確かめる（合言葉そのものは使わない）
function withBrowser(search, fn) {
  const store = new Map();
  const saved = { ls: globalThis.localStorage, loc: globalThis.location };
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.location = { search };
  try { fn(store); } finally { globalThis.localStorage = saved.ls; globalThis.location = saved.loc; }
}

test("確認用モード: 合言葉を入れ済みで、?debug か設定画面から入ったままの時だけ有効", () => {
  withBrowser("", (store) => {
    assert.equal(gate.active(), false);
    store.set(gate.ACTIVE_KEY, "1");
    assert.equal(gate.active(), false, "合言葉なしでは入らない");
    store.set(gate.UNLOCK_KEY, "1");
    assert.equal(gate.active(), true, "設定画面から入ったまま（URLに関係なし）");
    store.delete(gate.ACTIVE_KEY);
    assert.equal(gate.active(), false, "?debug なし・入った印なしなら、ふつうのモード");
  });
  withBrowser("?debug", (store) => {
    store.set(gate.UNLOCK_KEY, "1");
    assert.equal(gate.active(), true, "?debug は今までどおり");
  });
});

test("確認用モード: 違う合言葉では入らず、ふつうのモードに戻ると印も合言葉も消える。コンプリートの印は1回だけ", () => {
  withBrowser("", (store) => {
    assert.equal(gate.enter("admin"), false);
    assert.equal(store.size, 0);
    store.set(gate.UNLOCK_KEY, "1"); store.set(gate.ACTIVE_KEY, "1"); store.set(gate.AUTO_COMPLETE_KEY, "1");
    assert.equal(gate.takeAutoComplete(), true);
    assert.equal(gate.takeAutoComplete(), false);
    gate.leave();
    assert.equal(store.size, 0);
    assert.equal(gate.active(), false);
  });
});

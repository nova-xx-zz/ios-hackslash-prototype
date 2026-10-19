"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHandles, draw } = require("../tools/beta-lottery.js");

test("Xユーザー名を小文字で正規化し、大文字小文字・@による二重応募を除外", () => {
  assert.deepEqual(parseHandles("# 応募一覧\n @Alice \nBOB\n@alice\n bob\n\n@_Dev123\n"), ["@alice", "@bob", "@_dev123"]);
});

test("不正なリスト形式やユーザー名は拒否", () => {
  for (const text of ["@a, @b", "@bad-name", "hello@domain.com", "@", "あいうえお", "@very_long_username", "@a extra"]) {
    assert.throws(() => parseHandles(text), /ユーザー名形式/);
  }
});

test("抽選結果に重複・応募者外のアカウントが含まれず、当選者と補欠は相互排他", () => {
  const handles = ["@a", "@b", "@c", "@d", "@e"];
  const result = draw(handles, 2, max => max - 1);
  assert.equal(result.winners.length, 2);
  assert.equal(result.waitlist.length, 3);
  assert.deepEqual(new Set(result.ranking), new Set(handles));
  assert.equal(new Set(result.ranking).size, handles.length);
  assert.deepEqual(result.winners, result.ranking.slice(0, 2));
  assert.deepEqual(result.waitlist, result.ranking.slice(2));
  assert.deepEqual(handles, ["@a", "@b", "@c", "@d", "@e"], "元リストを変更しない");
});

test("応募者数を超える抽選や0人、整数以外は拒否する", () => {
  const handles = parseHandles("@a\n@b");
  for (const count of [0, -1, 3, 1.5, NaN, Infinity]) {
    assert.throws(() => draw(handles, count), /当選枠/);
  }
  assert.deepEqual(draw(handles, 2, () => 0).winners.length, 2);
});

test("当選者のみを最初の指定枠とし、残りは固定順位の補欠にする", () => {
  const handles = parseHandles("@one\n@two\n@three\n@four");
  const result = draw(handles, 1, () => 0);
  assert.equal(result.ranking[0], "@one");
  assert.deepEqual(result.waitlist, ["@two", "@three", "@four"]);
});

// 実行: node --test（リポジトリ直下で）
// ダンジョンの難易度の基準。ダンジョンを追加・調整した時に、難しすぎ・易しすぎ・レベルを上げると
// 弱くなる逆転を検出する。基準の中身は tools/lib/difficulty.js、詳細は node tools/simulate.js --check で確認できる
const test = require("node:test");
const assert = require("node:assert/strict");
const { STANDARD, check } = require("../tools/lib/difficulty.js");

const results = check();

for (const r of results) {
  const label = `${r.dungeon.name}（推奨Lv${r.dungeon.level}${r.dungeon.challenge ? "・やり込み枠" : ""}）`;
  test(`難易度の基準: ${label}`, () => {
    assert.deepEqual(r.problems, [], r.problems.join(" / "));
  });
}

test("最初のダンジョンは初期パーティ（Lv1）で踏破できる", () => {
  const first = results[0];
  assert.ok(first.firstLevelAtTarget !== null && first.firstLevelAtTarget <= 1,
    `Lv1で踏破率${Math.round(STANDARD.targetRate * 100)}%に届かない`);
});

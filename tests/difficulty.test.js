// 実行: node --test（リポジトリ直下で）
// ダンジョンの難易度の基準。想定プレイヤー（適正装備＋素直なスキル振り）で、推奨Lvでの踏破率・レベル不足時の
// 挑みやすさ・装備の意味・レベルを上げると弱くなる逆転を確認する。ダンジョンを追加・調整した時に
// 難しすぎ・易しすぎを検出する。基準の中身は tools/lib/difficulty.js、表示付きの確認は
// node tools/simulate.js --check、基準に合う強さ倍率の提案は node tools/simulate.js --calibrate
const test = require("node:test");
const assert = require("node:assert/strict");
const { check } = require("../tools/lib/difficulty.js");

for (const r of check()) {
  const d = r.dungeon;
  test(`難易度の基準: ${d.name}（推奨Lv${d.level}${d.challenge ? "・やり込み枠" : ""}）`, () => {
    assert.deepEqual(r.problems, [], r.problems.join(" / "));
  });
}

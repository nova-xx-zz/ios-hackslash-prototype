"use strict";
// 仲間一覧（控え・仲間と別れる）の絞り込み・並び替え（js/core/roster-organize.js）
const test = require("node:test");
const assert = require("node:assert/strict");
const Org = require("../js/core/roster-organize.js");
const Stats = require("../js/core/stats.js");

const chars = [
  { id: "c1", name: "アレン", job: "warrior", race: "human", level: 12, favorite: true },
  { id: "c7", name: "スラ", race: "slime", isMonster: true, level: 3 },
  { id: "c3", name: "ミナ", job: "priest", race: "elf", level: 12 },
  { id: "c12", name: "ウルフ", race: "wolf", isMonster: true, level: 20 },
  { id: "c5", name: "ゴウ", job: "warrior", race: "human", level: 5 },
];
const label = (c) => ({ warrior: "せんし", priest: "そうりょ" }[c.job] || { slime: "スライム", wolf: "オオカミ" }[c.race]);
const ids = (list) => list.map((c) => c.id);

test("種類・ジョブ／種族・お気に入りで絞り込み、元の配列は変えない", () => {
  const before = ids(chars);
  assert.deepEqual(ids(Org.filter(chars, { kind: "human" })), ["c1", "c3", "c5"]);
  assert.deepEqual(ids(Org.filter(chars, { kind: "monster" })), ["c7", "c12"]);
  assert.deepEqual(ids(Org.filter(chars, { group: "j:warrior" })), ["c1", "c5"]);
  assert.deepEqual(ids(Org.filter(chars, { group: "m:slime" })), ["c7"]);
  assert.deepEqual(ids(Org.filter(chars, { favoriteOnly: true })), ["c1"]);
  assert.deepEqual(ids(chars), before);
  assert.throws(() => Org.filter(chars, { kind: "robot" }), RangeError);
});

test("Lv・ジョブ・仲間にした順で並べ、同点は元の順を保つ", () => {
  assert.deepEqual(ids(Org.sort(chars, "level", label)), ["c12", "c1", "c3", "c5", "c7"]);
  assert.deepEqual(ids(Org.sort(chars, "levelAsc", label)), ["c7", "c5", "c1", "c3", "c12"]);
  assert.deepEqual(ids(Org.sort(chars, "newest", label)), ["c12", "c7", "c5", "c3", "c1"]);
  assert.deepEqual(ids(Org.sort(chars, "oldest", label)), ["c1", "c3", "c5", "c7", "c12"]);
  // 人間が先、ジョブ名順、同じジョブはLvの高い順
  assert.deepEqual(ids(Org.sort(chars, "job", label)), ["c1", "c5", "c3", "c12", "c7"]);
  assert.throws(() => Org.sort(chars, "random", label), RangeError);
});

test("絞り込みの選択肢は今いる仲間のジョブ・種族だけ、人間が先", () => {
  const all = Org.groupOptions(chars, "all", label);
  assert.deepEqual(all.map((g) => [g.key, g.count]),
    [["j:warrior", 2], ["j:priest", 1], ["m:wolf", 1], ["m:slime", 1]]);
  assert.deepEqual(Org.groupOptions(chars, "monster", label).map((g) => g.key), ["m:wolf", "m:slime"]);
  assert.deepEqual(Org.groupOptions([], "all", label), []);
});

const ivs = (value) => Object.fromEntries(Stats.IV_KEYS.map((k) => [k, value]));

test("個体値S〜Dのフィルターは既存の評価式を使い、旧データは未評価だけに一致する", () => {
  const monsters = [
    ...[["S", 1.05], ["A", 1.02], ["B", 1], ["C", 0.98], ["D", 0.95]].map(([rank, value]) =>
      ({ id: "m" + rank, isMonster: true, race: "slime", ivs: ivs(value) })),
    { id: "legacy", isMonster: true, race: "slime" },
    { id: "human", isMonster: false, race: "human", ivs: ivs(1.05) },
  ];
  const before = monsters.map((c) => c.id);
  for (const rank of ["S", "A", "B", "C", "D"]) {
    assert.deepEqual(ids(Org.filter(monsters, { ivRank: rank })), ["m" + rank]);
  }
  assert.deepEqual(ids(Org.filter(monsters, { ivRank: "unrated" })), ["legacy"]);
  assert.deepEqual(ids(Org.filter(monsters, { ivRank: "all" })), before);
  assert.deepEqual(ids(Org.filter(monsters, { group: "m:slime", ivRank: "S" })), ["mS"]);
  assert.deepEqual(ids(Org.filter(monsters, { kind: "human", ivRank: "S" })), []);
  assert.throws(() => Org.filter(monsters, { ivRank: "Z" }), RangeError);
  assert.deepEqual(monsters.map((c) => c.id), before, "元の配列は変更されない");
});

test("個体値ランクは★のみ・種族条件・並び順と併用できる", () => {
  const members = [
    { id: "c10", isMonster: true, race: "slime", level: 8, ivs: ivs(1.05), favorite: true },
    { id: "c2", isMonster: true, race: "slime", level: 3, ivs: ivs(1.05), favorite: true },
    { id: "c3", isMonster: true, race: "wolf", level: 5, ivs: ivs(1.05), favorite: true },
    { id: "c4", isMonster: true, race: "slime", level: 10, ivs: ivs(1.05), favorite: false },
  ];
  const shown = Org.sort(Org.filter(members, { group: "m:slime", ivRank: "S", favoriteOnly: true }), "levelAsc");
  assert.deepEqual(ids(shown), ["c2", "c10"]);
});

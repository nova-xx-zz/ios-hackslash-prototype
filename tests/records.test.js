// 実行: node --test（リポジトリ直下で）
// 冒険の記録（js/model/records.js）と、セーブへの書き出し・読み込み（js/model/save.js）
const test = require("node:test");
const assert = require("node:assert/strict");
const records = require("../js/model/records.js");
const save = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

test("出会った敵はダンジョン別に1回ずつ、装備は種類とレア度で1回ずつ記録する", () => {
  const r = records.createRecords();
  assert.equal(records.recordEncounter(r, "plains", "slime"), true);
  assert.equal(records.recordEncounter(r, "plains", "slime"), false);
  records.recordEncounter(r, "forest", "slime");
  assert.deepEqual(r.dungeonEncounters, { plains: ["slime"], forest: ["slime"] });
  const added = records.recordItemsFound(r, [
    { base: "ring", slot: "accessory", stat: "mag", rarity: "sr" },
    { slot: "accessory", stat: "mag", rarity: "sr" }, // base の無い古い形も同じ種類
    { slot: "weapon", stat: "nope", rarity: "n" }, // 種類が分からない物は記録しない
  ], data.ITEM_BASES);
  assert.equal(added, 1);
  assert.deepEqual(r.itemsFound, ["ring:sr"]);
});

test("履歴は新しい順に、最大件数まで", () => {
  const r = records.createRecords();
  for (let i = 0; i < records.RUN_HISTORY_MAX + 5; i++) records.addRunHistory(r, { at: i, dungeonId: "plains" });
  assert.equal(r.runHistory.length, records.RUN_HISTORY_MAX);
  assert.equal(r.runHistory[0].at, records.RUN_HISTORY_MAX + 4);
});

test("セーブ: 記録を書き出して読み直せる。記録の無い古いセーブは空から始め、持っている装備はアイテム辞典に載せる", () => {
  const s = save.createState({ teamCount: 4 });
  s.roster = [{ id: "c1", level: 1, exp: 0, jobLevels: {}, equip: { weapon: { slot: "weapon", stat: "atk", rarity: "lr" } } }];
  records.recordEncounter(s.records, "cave", "wolf");
  records.addRunHistory(s.records, { at: 5, dungeonId: "cave", cleared: true });
  const loaded = save.deserialize(JSON.parse(JSON.stringify(save.serialize(s, { now: 1 }))), {});
  assert.deepEqual(loaded.state.records, s.records);

  const old = { schemaVersion: 2, roster: s.roster, inventory: [{ slot: "armor", stat: "mp", rarity: "n" }] };
  const fromOld = save.deserialize(old, { itemBases: data.ITEM_BASES });
  assert.deepEqual(fromOld.state.records.dungeonEncounters, {});
  assert.deepEqual(fromOld.state.records.runHistory, []);
  assert.deepEqual(fromOld.state.records.itemsFound.sort(), ["robe:n", "sword:lr"]);

  const broken = save.deserialize({ schemaVersion: 2, roster: s.roster, records: { dungeonEncounters: { x: "bad" }, itemsFound: [1, "ring:n"], runHistory: [null, { at: 1 }, { dungeonId: "plains" }] } }, {});
  assert.deepEqual(broken.state.records, { dungeonEncounters: {}, itemsFound: ["ring:n"], runHistory: [{ dungeonId: "plains" }] });
});

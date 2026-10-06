// 実行: node --test（リポジトリ直下で）
// ゲームの状態とセーブ（js/model/save.js）。書き出して読み直すと同じ状態に戻ること、
// 旧形式セーブの移行、壊れたセーブの扱いを確認する
const test = require("node:test");
const assert = require("node:assert/strict");
const save = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function sampleState() {
  const s = save.createState({ teamCount: 4, autoRepeatTarget: 10 });
  s.roster = [
    { id: "c1", name: "アレン", job: "warrior", level: 3, exp: 50, expToNext: data.expForLevel(3), team: 0,
      jobLevels: { warrior: { level: 3, exp: 50, expToNext: data.expForLevel(3), skillTree: { exclusiveRanks: { a: 1 } } } } },
    { id: "c2", name: "スライム", job: null, isMonster: true, level: 2, exp: 0, expToNext: data.expForLevel(2), team: null, jobLevels: {} },
  ];
  s.inventory = [{ id: "i1", slot: "weapon", rarity: "sr", plus: 3 }];
  s.activeTeam = 2;
  s.clearedDungeons = new Set(["plains", "forest"]);
  s.nextCharSeq = 3;
  s.material = 1234;
  s.guaranteedStones = { free: 2, paid: 5 };
  s.autoRepeat[1] = { active: true, target: 20, done: 4 };
  return s;
}

const roundTrip = (state, opts) => save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, opts))), { syncExpToNext: data.syncExpToNext });

test("初期状態: 空のロスター・所持品、チームごとの自動周回", () => {
  const s = save.createState({ teamCount: 4, autoRepeatTarget: 10 });
  assert.deepEqual(s.roster, []);
  assert.equal(s.autoRepeat.length, 4);
  assert.deepEqual(s.autoRepeat[0], { active: false, target: 10, done: 0 });
  assert.notEqual(s.autoRepeat[0], s.autoRepeat[1]); // チームごとに別のオブジェクト
  assert.deepEqual(s.guaranteedStones, { free: 0, paid: 0 });
});

test("書き出して読み直すと同じ状態に戻る", () => {
  const s = sampleState();
  s.clearedHard = new Set(["forest"]);
  s.clearedExtra = new Set(["plains"]);
  const loaded = roundTrip(s, { now: 1700000000000, runDungeonIds: [null, "forest"], runModes: [null, "hard"], enabledFeatures: ["skillTree"] });
  assert.equal(loaded.isLegacy, false);
  assert.equal(loaded.savedAt, 1700000000000);
  for (const key of ["roster", "inventory", "activeTeam", "nextCharSeq", "skillBooks", "material", "guaranteedStones"]) {
    assert.deepEqual(loaded.state[key], s[key], key);
  }
  assert.deepEqual([...loaded.state.clearedDungeons], ["plains", "forest"]);
  assert.deepEqual([...loaded.state.clearedHard], ["forest"]);
  assert.deepEqual([...loaded.state.clearedExtra], ["plains"]);
  // 自動周回は状態には戻さず、オフライン精算用に探索中ダンジョンと一緒に返す
  assert.equal(loaded.state.autoRepeat, undefined);
  assert.deepEqual(loaded.savedAutoRepeat[1], { active: true, target: 20, done: 4, dungeonId: "forest", mode: "hard" });
  assert.equal(loaded.savedAutoRepeat[0].dungeonId, null);
});

test("セーブデータの形: schemaVersion・保存時の機能フラグを含む", () => {
  const out = save.serialize(sampleState(), { now: 1, enabledFeatures: ["skillTree", "enhancePity"] });
  assert.equal(out.schemaVersion, save.SCHEMA_VERSION);
  assert.deepEqual(out.enabledFeaturesAtSave, ["skillTree", "enhancePity"]);
  assert.deepEqual(out.clearedDungeons, ["plains", "forest"]); // SetはJSONにできないため配列にする
});

test("旧形式セーブ: 強化石は旧キーから、確定強化石の数値は無償分として引き継ぐ", () => {
  const old = { roster: [{ id: "c1", level: 3, exp: 70, expToNext: 75, jobLevels: { warrior: { level: 3, exp: 70, expToNext: 75 } } }], material: 999, guaranteedStones: 4 };
  const loaded = save.deserialize(old, { legacyMaterial: 321, syncExpToNext: data.syncExpToNext });
  assert.equal(loaded.isLegacy, true);
  assert.equal(loaded.state.material, 321); // schemaVersion 2未満はセーブ内のmaterialを使わない
  assert.deepEqual(loaded.state.guaranteedStones, { free: 4, paid: 0 });
  assert.deepEqual(loaded.state.inventory, []);
  assert.equal(loaded.state.activeTeam, 0);
  assert.equal(loaded.state.nextCharSeq, 1);
  assert.deepEqual(loaded.savedAutoRepeat, []); // 旧形式（配列でない）の自動周回は精算の対象外
  // 必要EXPは現在の曲線で計算し直す（キャラ本体とジョブごとの記録）
  assert.equal(loaded.state.roster[0].expToNext, data.expForLevel(3));
  assert.equal(loaded.state.roster[0].jobLevels.warrior.expToNext, data.expForLevel(3));
});

test("壊れたセーブ・空のロスターは読み込まない", () => {
  for (const bad of [null, {}, { roster: "x" }, { roster: [] }]) {
    assert.equal(save.deserialize(bad, {}), null, JSON.stringify(bad));
  }
});

test("型の合わない項目は既定値にする", () => {
  const loaded = save.deserialize({ schemaVersion: 2, roster: [{ id: "c1" }], inventory: "x", activeTeam: "1", clearedDungeons: 5, skillBooks: {}, material: "9", guaranteedStones: { free: "x", paid: 3 } }, { legacyMaterial: 7 });
  assert.deepEqual(loaded.state.inventory, []);
  assert.equal(loaded.state.activeTeam, 0);
  assert.deepEqual([...loaded.state.clearedDungeons], []);
  assert.deepEqual(loaded.state.skillBooks, []);
  assert.equal(loaded.state.material, 7);
  assert.deepEqual(loaded.state.guaranteedStones, { free: 0, paid: 3 });
});

test("クラウドからの復元: 自動周回は止め、内容の要約を返す。壊れたデータはnull", () => {
  const s = sampleState();
  const json = JSON.stringify(save.serialize(s, { now: 1700000000000, runDungeonIds: [null, "forest"] }));
  const r = save.prepareRestore(json);
  assert.equal(r.savedAt, 1700000000000);
  assert.deepEqual(r.summary, { members: 2, maxLevel: 3, clearedDungeons: 2, material: 1234 });
  const restored = JSON.parse(r.json);
  assert.ok(restored.autoRepeat.every((ar) => ar.active === false));
  assert.equal(restored.autoRepeat[1].done, 4); // 進行の記録はそのまま
  assert.deepEqual(restored.roster, JSON.parse(json).roster);
  for (const bad of ["", "{", "null", JSON.stringify({ roster: [] })]) assert.equal(save.prepareRestore(bad), null, bad);
});

test("未編成グループ: 書き出して読み直すと同じ。キャラのgroupは存在するグループのみ、パーティ所属中はnull", () => {
  const s = sampleState();
  s.groups = [{ id: "g1", name: "育成中" }, { id: "g2", name: "メイン" }];
  s.roster[1].group = "g2";
  s.roster.push({ id: "c3", name: "ミナ", job: "mage", level: 1, exp: 0, expToNext: data.expForLevel(1), team: null, group: "gone", jobLevels: {} });
  s.roster[0].group = "g1"; // パーティ所属中なのにグループを持っている（壊れたデータ）
  const loaded = roundTrip(s);
  assert.deepEqual(loaded.state.groups, s.groups);
  assert.equal(loaded.state.roster[0].group, null);
  assert.equal(loaded.state.roster[1].group, "g2");
  assert.equal(loaded.state.roster[2].group, null);
});

test("未編成グループ: グループの無い旧セーブは空。壊れた項目・重複したid・長すぎる名前をそろえる", () => {
  const s = sampleState();
  const json = JSON.parse(JSON.stringify(save.serialize(s)));
  delete json.groups;
  assert.deepEqual(save.deserialize(json).state.groups, []);
  assert.deepEqual(save.normalizeGroups([
    null, { id: "" }, { id: "g1", name: "  あいうえおかきくけこさしすせそ  " }, { id: "g1", name: "重複" }, { id: "g2" },
  ]), [{ id: "g1", name: "あいうえおかきくけこさし" }, { id: "g2", name: "グループ" }]);
  assert.equal(save.normalizeGroups(Array.from({ length: 30 }, (_, i) => ({ id: "g" + i, name: "x" }))).length, save.GROUP_MAX);
});

test("旧セーブの装備: 3枠（武器・防具・装飾品）を右手・体・装飾品1に、8種類の装備をブロンズの同じ種類に移す", () => {
  const s = sampleState();
  const json = JSON.parse(JSON.stringify(save.serialize(s)));
  json.roster[0].equip = {
    weapon: { id: "w", name: "ノーマルの剣", base: "sword", slot: "weapon", stat: "atk", value: 3, rarity: "n", plus: 2 },
    armor: { id: "a", slot: "armor", stat: "mp", value: 4, rarity: "r", plus: 0 }, // base の無いさらに古い形
    accessory: null,
  };
  json.inventory = [{ id: "i", base: "boots", slot: "accessory", stat: "spd", value: 2, rarity: "sr", plus: 0 }];
  const loaded = save.deserialize(json, { legacyItemBases: data.LEGACY_ITEM_BASES });
  const eq = loaded.state.roster[0].equip;
  assert.deepEqual(Object.keys(eq), ["main", "off", "head", "body", "acc1", "acc2", "acc3"]);
  assert.deepEqual([eq.main.base, eq.main.name, eq.main.slot, eq.main.series, eq.main.plus], ["bronze_sword", "ブロンズソード", "weapon", "bronze", 2]);
  assert.deepEqual(eq.main.stats, { atk: 3 });
  assert.equal(eq.main.stat, undefined);
  assert.deepEqual([eq.body.base, eq.body.slot, eq.body.stats], ["bronze_robe", "body", { mp: 4 }]);
  assert.equal(eq.acc1, null);
  assert.deepEqual([loaded.state.inventory[0].base, loaded.state.inventory[0].stats], ["bronze_boots", { spd: 2 }]);
  // 新しい形のセーブは読み直しても変わらない
  const again = save.deserialize(JSON.parse(JSON.stringify(save.serialize(Object.assign(sampleState(), loaded.state)))), { legacyItemBases: data.LEGACY_ITEM_BASES });
  assert.deepEqual(again.state.roster[0].equip, eq);
});

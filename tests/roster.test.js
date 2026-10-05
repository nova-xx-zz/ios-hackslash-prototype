// 実行: node --test（リポジトリ直下で）
// キャラまわり（js/model/roster.js）。作成・EXPとレベルアップ・転職・上級職の解放・
// スキルツリー（SP・ノード取得・汎用枠の交換・パッシブ）・能力値を確認する
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup(opts) {
  opts = opts || {};
  const state = createState({ teamCount: 4 });
  const R = createRoster({
    data,
    state,
    runBuffs: (team) => (opts.buffs && opts.buffs[team]) || null,
    isTeamLocked: (team) => !!(opts.locked && opts.locked[team]),
  });
  return { state, R };
}

test("キャラの作成: idは連番、Lv1・HP/MP満タン、ジョブのレベル記録を持つ", () => {
  const { state, R } = setup();
  const a = R.newCharacter("アレン", "warrior", "human", { team: 0 });
  const b = R.newCharacter("ミナ", "mage", "sylvan", { level: 5 });
  assert.equal(a.id, "c1");
  assert.equal(b.id, "c2");
  assert.equal(state.nextCharSeq, 3);
  assert.equal(a.level, 1);
  assert.equal(a.expToNext, data.expForLevel(1));
  assert.equal(a.team, 0);
  assert.equal(b.team, null);
  const rec = a.jobLevels.warrior;
  assert.deepEqual({ level: rec.level, exp: rec.exp, expToNext: rec.expToNext }, { level: 1, exp: 0, expToNext: data.expForLevel(1) });
  const s = R.computeStats(a);
  assert.equal(a.hp, s.maxHp);
  assert.equal(a.mp, s.maxMp);
  const mon = R.newCharacter("スライム", null, "slime", { isMonster: true, level: 3 });
  assert.deepEqual(mon.jobLevels, {}); // モンスターはジョブの記録を持たない
  assert.equal(R.jobDef(mon), data.MONSTER_JOBS.slime);
});

test("EXP: 必要量に達するとレベルが上がり、余りは持ち越す。技の習得を知らせる", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  const need = data.expForLevel(1) + data.expForLevel(2) + data.expForLevel(3) + data.expForLevel(4);
  const result = R.gainExp(c, need + 10);
  assert.equal(c.level, 5);
  assert.equal(c.exp, 10);
  assert.equal(c.expToNext, data.expForLevel(5));
  assert.deepEqual(result.levelUps, ["アレン Lv.2", "アレン Lv.3", "アレン Lv.4", "アレン Lv.5"]);
  assert.deepEqual(result.abilityUnlocks, ["アレンが「かいしんのいちげき」を習得！"]); // reqLevel 5
  assert.deepEqual({ level: c.jobLevels.warrior.level, exp: c.jobLevels.warrior.exp }, { level: 5, exp: 10 });
  assert.equal(R.totalExpInvested(c), need + 10);
});

test("EXP: スキルツリーの進行はレベルアップで消えない", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  R.gainExp(c, data.expForLevel(1) + data.expForLevel(2));
  const tree = R.getExclusiveTree(c);
  R.acquireNode(c, tree, R.getTreeState(c).exclusiveRanks, tree.nodes[0]);
  R.gainExp(c, data.expForLevel(3));
  assert.equal(R.getTreeState(c).exclusiveRanks[tree.nodes[0].id], 1);
});

test("転職: 元のジョブのレベルを保持し、戻ると再開できる。新しいジョブはLv1から", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  R.gainExp(c, data.expForLevel(1) + data.expForLevel(2) + 5);
  c.subAbilityIds = ["fire", null];
  R.switchJob(c, "mage");
  assert.equal(c.job, "mage");
  assert.equal(c.level, 1);
  assert.deepEqual(c.subAbilityIds, [null, null]); // 転職先の固有技はサブアビリティから外す
  R.switchJob(c, "warrior");
  assert.equal(c.level, 3);
  assert.equal(c.exp, 5);
  assert.deepEqual(R.subAbilityCandidates(c).map((a) => a.id), ["fire"]); // まほうつかいLv1で覚えた技
});

test("上級職: 対応する基本職をJOB_MASTER_LEVELまで上げると解放", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  assert.equal(R.jobUnlocked(c, "warrior"), true);
  assert.equal(R.jobUnlocked(c, "swordmaster"), false);
  c.jobLevels.warrior.level = data.JOBS.swordmaster.requires.level - 1;
  assert.equal(R.jobUnlocked(c, "swordmaster"), false);
  c.jobLevels.warrior.level = data.JOBS.swordmaster.requires.level;
  assert.equal(R.jobUnlocked(c, "swordmaster"), true);
  assert.equal(R.jobUnlocked(c, "archmage"), false);
});

test("スキルツリー: SPはLv−1。前提・二択・SP不足・探索中は取得できない", () => {
  const locked = {};
  const { R } = setup({ locked });
  const c = R.newCharacter("アレン", "warrior", "human", { team: 0 });
  const tree = R.getExclusiveTree(c);
  const ranks = R.getTreeState(c).exclusiveRanks;
  const node = (id) => tree.nodes.find((n) => n.id === id);
  assert.equal(R.availableSp(c), 0);
  assert.equal(R.acquireNode(c, tree, ranks, node("w1")), false); // SP不足
  R.gainExp(c, [1, 2, 3, 4, 5, 6, 7].reduce((t, lv) => t + data.expForLevel(lv), 0)); // Lv8 → SP7
  assert.equal(R.totalSp(c), 7);
  assert.equal(R.acquireNode(c, tree, ranks, node("w2")), false); // 前提(w1)未取得
  for (const id of ["w1", "w2", "w3", "w4a"]) assert.equal(R.acquireNode(c, tree, ranks, node(id)), true, id);
  assert.equal(R.acquireNode(c, tree, ranks, node("w4b")), false); // 二択の片方を取得済み
  assert.equal(R.totalSpentSp(c), 6);
  assert.equal(R.availableSp(c), 1);
  locked[0] = true;
  assert.equal(R.canSwapGeneralSlot(c), false);
  const gTree = R.generalSlotTreeDef(c, "slot1");
  assert.equal(R.acquireNode(c, gTree, R.getTreeState(c).general.slot1.ranks, gTree.nodes[0]), false); // 探索中
});

test("スキルツリー: パッシブは能力値に乗り、汎用枠を交換するとその枠の振り分けは戻る", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  R.gainExp(c, [1, 2, 3, 4].reduce((t, lv) => t + data.expForLevel(lv), 0));
  const before = R.computeStats(c).atk;
  const tree = R.getExclusiveTree(c);
  R.acquireNode(c, tree, R.getTreeState(c).exclusiveRanks, tree.nodes.find((n) => n.id === "w1")); // ATK+3
  assert.equal(R.computeStats(c).atk, before + 3);
  assert.equal(R.treePassive(c, "critBonus"), 0);

  const st = R.getTreeState(c);
  const gTree = R.generalSlotTreeDef(c, "slot1");
  assert.equal(R.acquireNode(c, gTree, st.general.slot1.ranks, gTree.nodes[0]), true);
  assert.ok(R.totalSpentSp(c) > 1);
  assert.equal(R.swapGeneralSlot(c, "slot1"), true);
  assert.equal(st.general.slot1.treeId, "speed");
  assert.deepEqual(st.general.slot1.ranks, {});
  assert.equal(R.totalSpentSp(c), 1);
});

test("スキルツリー: 旧形式（固有ツリー1本の nodeRanks）を固有ツリーの進行として引き継ぐ", () => {
  const { R } = setup();
  const c = R.newCharacter("アレン", "warrior", "human");
  c.jobLevels.warrior.skillTree = { nodeRanks: { w1: 1 } };
  const st = R.getTreeState(c);
  assert.deepEqual(st.exclusiveRanks, { w1: 1 });
  assert.equal(st.nodeRanks, undefined);
  assert.equal(st.general.slot2.treeId, "defense");
});

test("能力値: 装備と、挑戦中ダンジョンの石碑の加護が乗る", () => {
  const buffs = {};
  const { R } = setup({ buffs });
  const c = R.newCharacter("アレン", "warrior", "human", { team: 1 });
  const base = R.computeStats(c);
  c.equip.weapon = { slot: "weapon", stat: "atk", value: 10, rarity: "n", plus: 0 };
  assert.equal(R.computeStats(c).atk, base.atk + data.itemEffectiveValue(c.equip.weapon));
  buffs[1] = { atk: 0.2 };
  const buffed = R.computeStats(c);
  assert.ok(buffed.atk > base.atk + data.itemEffectiveValue(c.equip.weapon));
  assert.equal(buffed.maxHp, base.maxHp); // 加護はHP/MPには乗らない
});

test("チーム: 所属メンバー・表示中のパーティ・最高レベル", () => {
  const { state, R } = setup();
  state.roster = [
    R.newCharacter("A", "warrior", "human", { team: 0 }),
    R.newCharacter("B", "mage", "human", { team: 1, level: 7 }),
    R.newCharacter("C", "priest", "human"),
  ];
  assert.deepEqual(R.teamMembers(1).map((c) => c.name), ["B"]);
  state.activeTeam = 0;
  assert.deepEqual(R.activeParty().map((c) => c.name), ["A"]);
  assert.equal(R.currentMaxLevel(), 7);
});

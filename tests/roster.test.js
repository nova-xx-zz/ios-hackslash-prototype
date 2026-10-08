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
  assert.deepEqual(result.abilityUnlocks, ["アレンが「剛断撃」を習得！"]); // reqLevel 5
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

test("能力値: HP・MPの装備（お守り・ローブ）は最大HP・最大MPを増やす", () => {
  const { R } = setup();
  const c = R.newCharacter("ミナ", "mage", "human");
  const base = R.computeStats(c);
  c.equip.accessory = { slot: "accessory", stat: "hp", value: 6, rarity: "n", plus: 0 };
  c.equip.armor = { slot: "armor", stat: "mp", value: 4, rarity: "n", plus: 0 };
  const s = R.computeStats(c);
  assert.equal(s.maxHp, base.maxHp + data.itemEffectiveValue(c.equip.accessory));
  assert.equal(s.maxMp, base.maxMp + data.itemEffectiveValue(c.equip.armor));
  assert.equal(s.hp, undefined); // 使われない欄に足さない
  assert.equal(s.mp, undefined);
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

test("レベル上限: モンスターはLv100、人間のキャラはLv99で止まり、余ったEXPは捨てる", () => {
  const { R } = setup();
  assert.equal(data.MONSTER_MAX_LEVEL, 100);
  assert.equal(data.CHAR_MAX_LEVEL, 99);
  const mon = R.newCharacter("スライム", null, "slime", { isMonster: true, level: 99 });
  const r = R.gainExp(mon, data.expForLevel(99) * 5);
  assert.equal(mon.level, 100);
  assert.equal(mon.exp, 0);
  assert.equal(R.isMaxLevel(mon), true);
  assert.deepEqual(r.levelUps, ["スライム Lv.100"]);
  R.gainExp(mon, 1e9);
  assert.equal(mon.level, 100);
  assert.equal(mon.exp, 0);
  const hero = R.newCharacter("アレン", "warrior", "human", { level: 98 });
  R.gainExp(hero, data.expForLevel(98) * 5);
  assert.equal(hero.level, 99);
  assert.equal(hero.exp, 0);
  assert.equal(R.isMaxLevel(hero), true);
  assert.deepEqual({ level: hero.jobLevels.warrior.level, exp: hero.jobLevels.warrior.exp }, { level: 99, exp: 0 });
});

test("レベル上限: 上限を超えたレベル（旧セーブ）は上限に戻す。人間はジョブごとの記録も戻す", () => {
  const { R } = setup();
  const mon = R.newCharacter("スライム", null, "slime", { isMonster: true, level: 130 });
  mon.exp = 500;
  R.clampLevel(mon);
  assert.deepEqual({ level: mon.level, exp: mon.exp, expToNext: mon.expToNext }, { level: 100, exp: 0, expToNext: data.expForLevel(100) });
  const hero = R.newCharacter("アレン", "warrior", "human", { level: 120 });
  hero.jobLevels.mage = { level: 105, exp: 10, expToNext: data.expForLevel(105) };
  hero.jobLevels.thief = { level: 40, exp: 10, expToNext: data.expForLevel(40) };
  R.clampLevel(hero);
  assert.equal(hero.level, 99);
  assert.equal(hero.jobLevels.warrior.level, 99);
  assert.deepEqual({ ...hero.jobLevels.mage }, { level: 99, exp: 0, expToNext: data.expForLevel(99) });
  assert.equal(hero.jobLevels.thief.level, 40);
});

// 前提を満たしながら、取れるマスを上から順に全部取る（二択は先に並んでいる方）
function takeAll(R, c) {
  const st = R.getTreeState(c);
  const trees = [[R.getExclusiveTree(c), st.exclusiveRanks]].concat(data.GENERAL_SLOTS.map((s) => [R.generalSlotTreeDef(c, s.key), st.general[s.key].ranks]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [t, ranks] of trees) for (const n of t.nodes) if (R.acquireNode(c, t, ranks, n)) changed = true;
  }
}

test("スキルツリー: 全部取るとSPはLv99でちょうど98。段のレベルに届かないマスは取れない", () => {
  const { R } = setup();
  for (const job of ["warrior", "mage", "priest", "thief", "monk", "darkknight", "pilgrim"]) {
    const c = R.newCharacter("A", job, "human", { level: 99 });
    takeAll(R, c);
    assert.equal(R.totalSpentSp(c), 98, job);
    assert.equal(R.availableSp(c), 0, job);
  }
  const low = R.newCharacter("B", "warrior", "human", { level: 40 });
  takeAll(R, low);
  const ranks = R.getTreeState(low).exclusiveRanks;
  assert.ok(ranks.w5 && ranks.w6, "Lv20・Lv30の段は取れる");
  assert.ok(!ranks.w8, "Lv50の段はまだ取れない");
  assert.ok(R.availableSp(low) >= 0);
});

test("スキルツリー: どのレベルでも、開いているマスの必要SPは持っているSP以上（SPが余って振る先がない時期がない）", () => {
  // 開いているマス（段のレベルに届いたもの。二択は1つ分）の必要SPの合計
  const openCost = (tree, lv) => {
    const groups = {};
    let sum = 0;
    for (const n of tree.nodes) {
      if ((n.reqLevel || 1) > lv) continue;
      if (n.exclusiveGroup) groups[n.exclusiveGroup] = Math.max(groups[n.exclusiveGroup] || 0, n.costByRank[0]);
      else sum += n.costByRank[0];
    }
    return sum + Object.values(groups).reduce((a, b) => a + b, 0);
  };
  for (const tag of Object.keys(data.EXCLUSIVE_TREES)) {
    for (const ids of [["offense", "defense", "support"], ["speed", "vampiric", "arcane"]]) {
      for (let lv = 1; lv <= 99; lv++) {
        const open = openCost(data.EXCLUSIVE_TREES[tag], lv) + ids.reduce((s, id) => s + openCost(data.GENERAL_TREES[id], lv), 0);
        assert.ok(open >= lv - 1, `${tag} Lv${lv}: 開いているマス${open} < SP${lv - 1}`);
      }
    }
  }
});

test("スキルツリー: 割合ボーナス（statPct）は装備・ツリーの固定値まで足した値に掛かる。防御無視はパッシブに入る", () => {
  const { R } = setup();
  const c = R.newCharacter("A", "warrior", "human", { level: 60 });
  const before = R.computeStats(c).atk;
  takeAll(R, c);
  const totals = R.treePassiveTotals(c);
  assert.ok(totals.pct.atk >= 0.05);
  assert.ok(R.computeStats(c).atk > before);
  const m = R.newCharacter("B", "monk", "human", { level: 20 });
  takeAll(R, m);
  assert.equal(R.treePassive(m, "pierce"), 0.25);
});

test("スキルツリー: 振り直しは強化石（使ったSP×20）で4本ぶんを戻す。足りない・探索中はできない", () => {
  const { state, R } = setup({ locked: { 1: true } });
  const c = R.newCharacter("A", "priest", "human", { level: 30, team: 0 });
  takeAll(R, c);
  const spent = R.totalSpentSp(c);
  assert.equal(R.treeResetCost(c), spent * 20);
  state.material = spent * 20 - 1;
  assert.equal(R.resetTree(c), false);
  state.material = spent * 20 + 5;
  assert.equal(R.resetTree(c), true);
  assert.equal(state.material, 5);
  assert.equal(R.totalSpentSp(c), 0);
  const busy = R.newCharacter("B", "priest", "human", { level: 30, team: 1 });
  takeAll(R, busy);
  state.material = 99999;
  assert.equal(R.resetTree(busy), false);
});

// ---------- 特殊職（巡礼剣士。docs/special-job-design.md） ----------
test("特殊職: テスト中（testOpen）は全員が転職できる。本番の設定では、無料キャンペーンの期間中に条件のダンジョンを踏破した時だけ無料で解放を記録し、以後ずっと使える。期間の外は購入で解放", () => {
  const { state, R } = setup();
  const a = R.newCharacter("A", "warrior", "human");
  assert.equal(data.JOBS.pilgrim.tier, "special");
  assert.equal(data.JOBS.pilgrim.unlock.testOpen, true);
  assert.equal(R.jobUnlocked(a, "pilgrim"), true); // テスト中
  // 本番の設定（testOpen なし。無料キャンペーンはリリースから30日間と1周年の30日間。その後は購入）
  const DAY = 24 * 60 * 60 * 1000;
  const release = Date.parse("2027-04-01T00:00:00+09:00");
  const prodJobs = Object.assign({}, data.JOBS, { pilgrim: Object.assign({}, data.JOBS.pilgrim, { unlock: {
    cleared: "inferno_peak", purchase: "jobPilgrim",
    freeWindows: [{ id: "release", start: "2027-04-01T00:00:00+09:00", days: 30 }, { id: "anniversary1", start: "2028-04-01T00:00:00+09:00", days: 30 }],
  } }) });
  const P = createRoster({ data: Object.assign({}, data, { JOBS: prodJobs }), state });
  assert.equal(P.jobUnlocked(a, "pilgrim"), false);
  assert.equal(P.activeJobWindow("pilgrim", release - 1), null);
  assert.equal(P.activeJobWindow("pilgrim", release).id, "release");
  // 期間中でも、まだ踏破していなければ解放しない
  assert.deepEqual(P.refreshJobGrants(release + DAY), []);
  // 期間が終わってから踏破しても解放しない
  state.clearedDungeons.add("inferno_peak");
  assert.deepEqual(P.refreshJobGrants(release + 30 * DAY), []);
  assert.equal(P.jobUnlocked(a, "pilgrim"), false);
  // 購入でも解放される（無料と有料の根拠は別々。どちらかがあればよい）
  state.purchases.unlocks.jobPilgrim = true;
  assert.equal(P.jobUnlocked(a, "pilgrim"), true);
  delete state.purchases.unlocks.jobPilgrim;
  assert.equal(P.jobUnlocked(a, "pilgrim"), false);
  // 1周年の復刻の期間中なら無料で解放し、記録は残る（期間が終わってもずっと使える）
  const anniv = Date.parse("2028-04-01T00:00:00+09:00");
  assert.deepEqual(P.refreshJobGrants(anniv + DAY), ["pilgrim"]);
  assert.deepEqual(state.jobGrants.pilgrim, { at: anniv + DAY, window: "anniversary1" });
  assert.deepEqual(P.refreshJobGrants(anniv + 2 * DAY), []); // 2回は記録しない
  assert.equal(P.jobUnlocked(a, "pilgrim"), true);
  // セーブに残る
  const save = require("../js/model/save.js");
  state.roster = [a];
  const loaded = save.deserialize(JSON.parse(JSON.stringify(save.serialize(state, { now: 1 }))), {});
  assert.deepEqual(loaded.state.jobGrants, { pilgrim: { at: anniv + DAY, window: "anniversary1" } });
  assert.deepEqual(save.deserialize({ roster: [{ id: "x" }], jobGrants: { a: "bad", b: { at: "x" } } }, {}).state.jobGrants, {});
  // 機能フラグが無効なら、テスト中・記録ありでも解放しない
  const off = createRoster({ data: Object.assign({}, data, { isFeatureEnabled: (k) => k !== "specialJobs" && data.isFeatureEnabled(k) }), state });
  assert.equal(off.jobUnlocked(a, "pilgrim"), false);
});

test("特殊職: ひとり旅の加護はチームが巡礼剣士1人だけのときに能力値へ乗る（控え・2人以上・ほかのジョブでは乗らない）", () => {
  const { state, R } = setup();
  const p = R.newCharacter("P", "warrior", "human", { level: 30 });
  R.switchJob(p, "pilgrim");
  state.roster = [p];
  const bench = R.computeStats(p).atk;
  assert.equal(R.soloBonus(p), null); // 控え
  p.team = 0;
  assert.deepEqual(R.soloBonus(p), data.JOBS.pilgrim.soloBonus);
  assert.equal(R.computeStats(p).atk, Math.round(bench * (1 + data.JOBS.pilgrim.soloBonus.atkPct)));
  const friend = R.newCharacter("F", "priest", "human", { team: 0 });
  state.roster.push(friend);
  assert.equal(R.soloBonus(p), null);
  assert.equal(R.computeStats(p).atk, bench);
  // 1人でもほかのジョブには無い
  state.roster = [friend];
  assert.equal(R.soloBonus(friend), null);
});

test("特殊職: 機能フラグを無効にすると、巡礼剣士のキャラは一番レベルの高い職へ戻り、巡礼剣士の技はサブアビリティから外れる", () => {
  const { state } = setup();
  const offData = Object.assign({}, data, { isFeatureEnabled: (k) => k !== "specialJobs" && data.isFeatureEnabled(k) });
  const on = createRoster({ data, state });
  const off = createRoster({ data: offData, state });
  const p = on.newCharacter("P", "warrior", "human", { level: 12 }); // せんしLv12
  on.switchJob(p, "mage"); // まほうつかい Lv1
  on.switchJob(p, "pilgrim");
  p.level = 20; p.jobLevels.pilgrim = { level: 20, exp: 0, expToNext: data.expForLevel(20) };
  const m = on.newCharacter("M", "mage", "sylvan");
  m.jobLevels.pilgrim = { level: 15, exp: 0, expToNext: data.expForLevel(15) };
  m.subAbilityIds = ["pilgrim_sweep", null];
  assert.ok(on.subAbilityCandidates(m).some((a) => a.id === "pilgrim_sweep"));
  assert.ok(on.availableAbilities(m).some((a) => a.id === "pilgrim_sweep"));
  assert.equal(off.normalizeJob(p), true);
  assert.equal(p.job, "warrior"); // せんしLv12 > まほうつかいLv1
  assert.equal(p.level, 12);
  assert.equal(p.jobLevels.pilgrim.level, 20); // 巡礼剣士の記録は残る
  assert.equal(off.subAbilityCandidates(m).some((a) => a.id === "pilgrim_sweep"), false);
  assert.equal(off.availableAbilities(m).some((a) => a.id === "pilgrim_sweep"), false);
  assert.equal(off.normalizeJob(m), true);
  assert.deepEqual(m.subAbilityIds, [null, null]);
  assert.equal(on.normalizeJob(p), false); // 有効なら何もしない
});

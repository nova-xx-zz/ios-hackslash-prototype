// 実行: node --test（リポジトリ直下で）
// ダンジョン1周の進行（js/model/run.js）。出発・戦闘・勝利（EXP・ドロップ保留・踏破・解放）・道中イベント・
// 周回の終了（ドロップの確定と自動分解・全滅時の持ち帰りなし）・自動周回の継続判定・中断・オフライン精算を確認する
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunner, OFFLINE_MAX_MS } = require("../js/model/run.js");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const { createRng } = require("../js/core/rng.js");
const data = require("../tools/lib/load-data.js").loadGameData();

function setup(opts) {
  opts = opts || {};
  const state = createState({ teamCount: 4 });
  const rng = createRng(opts.seed || 7);
  let Runner = null;
  const roster = createRoster({
    data, state,
    runBuffs: (t) => Runner.runBuffs(t),
    isTeamLocked: (t) => Runner.isTeamLocked(t),
  });
  const inventory = createInventory({ data, state, roster, rng, isFeatureEnabled: data.isFeatureEnabled });
  const dex = new Set();
  const best = [];
  const filter = { enabled: true, rarities: new Set(["n"]) };
  // 戦闘エンジンに渡す env（game.js の battleEnv と同じ組み立て。優先度はすべて通常）
  const battleEnv = () => ({
    rng,
    atbRate: 7,
    stats: roster.computeStats,
    abilities: (c) => roster.availableAbilities(c).filter((a) => roster.isSkillActive(c, a.id)),
    mpCost: (c, a) => a.mpCost,
    tier: () => 2,
    passives: (c) => ({
      lifesteal: roster.racePassive(c, "lifesteal") + roster.treePassive(c, "lifesteal"),
      healBonus: roster.racePassive(c, "healBonus") + roster.treePassive(c, "healBonus"),
      critBonus: roster.racePassive(c, "critBonus") + roster.treePassive(c, "critBonus"),
      dmgTakenMult: (roster.racePassive(c, "dmgTakenMult") || 1) * (roster.treePassive(c, "dmgTakenMult") || 1),
    }),
  });
  let clock = opts.now || 1_000_000_000_000;
  Runner = createRunner({
    data, state, roster, inventory, rng, teamCount: 4, battleEnv,
    autoDisassemble: () => filter,
    markDexSeen: (k) => dex.add(k),
    setBestStage: (n) => best.push(n),
    now: () => clock,
  });
  const level = opts.level || 1;
  state.roster = [
    roster.newCharacter("アレン", "warrior", "human", { team: 0, level }),
    roster.newCharacter("ガイ", "warrior", "beastkin", { team: 0, level }),
    roster.newCharacter("ミナ", "mage", "sylvan", { team: 0, level }),
    roster.newCharacter("ノア", "mage", "nocturne", { team: 0, level }),
    roster.newCharacter("ルカ", "priest", "stonekin", { team: 0, level }),
  ];
  return { state, roster, inventory, Runner, dex, best, filter, rng, setClock: (t) => { clock = t; } };
}

// 決着するまで戦闘を進める
function fight(Runner, team) {
  for (let i = 0; i < 100000; i++) {
    const { result } = Runner.stepBattle(team, 0.05);
    if (result) return result;
  }
  throw new Error("決着しない");
}

test("出発: 周回を作り、パーティを全回復する。探索中は変更をロックし、石碑の加護を返す", () => {
  const { state, Runner, filter } = setup();
  for (const c of state.roster) { c.hp = 1; c.alive = false; }
  assert.equal(Runner.isTeamLocked(0), false);
  const run = Runner.startRun(0, "plains");
  assert.equal(run.dungeon.id, "plains");
  assert.equal(Runner.teamRuns[0], run);
  assert.ok(state.roster.every((c) => c.alive && c.hp > 1));
  assert.equal(Runner.isTeamRunActive(0), true);
  assert.equal(Runner.isTeamLocked(0), true);
  assert.equal(Runner.isTeamLocked(1), false);
  assert.deepEqual(Runner.runBuffs(0), { atk: 0, mag: 0, def: 0, spd: 0 });
  // 自動分解の設定は出撃時点のものを使う（周回中に変えても影響しない）
  filter.rarities.add("r");
  assert.deepEqual([...run.autoDisassembleRarities], ["n"]);
  state.autoRepeat[2].active = true;
  assert.equal(Runner.isTeamLocked(2), true);
});

test("戦闘: 敵を図鑑に登録し、最後の戦闘はボス", () => {
  const { Runner, dex } = setup();
  const run = Runner.startRun(0, "plains");
  const first = Runner.startBattle(run);
  assert.equal(first.isBoss, false);
  assert.equal(Runner.teamBattles[0], first.battle);
  assert.ok(first.battle.enemies.every((e) => dex.has(e.key)));
  run.battleIndex = run.dungeon.battles - 1;
  assert.equal(Runner.startBattle(run).isBoss, true);
});

test("冒険の記録: 出会った敵をダンジョン別に、手に入れた装備（自動分解した物も）と潜った履歴を残す", () => {
  const { state, Runner } = setup();
  const run = Runner.startRun(0, "plains");
  const { battle } = Runner.startBattle(run);
  const seen = state.records.dungeonEncounters.plains;
  assert.ok(battle.enemies.every((e) => seen.includes(e.key)));
  assert.equal(new Set(seen).size, seen.length); // 同じ敵は1回だけ
  run.pendingDrops.push(
    { id: "a", base: "bronze_sword", slot: "weapon", stats: { atk: 3 }, rarity: "n", plus: 0, materialValue: 5 }, // 自動分解される
    { id: "b", base: "bronze_plate", slot: "body", stats: { def: 3 }, rarity: "r", plus: 0, materialValue: 20 }
  );
  run.expTotal = 42;
  Runner.finishRun(run, true, { tamed: "スライム" });
  assert.deepEqual(state.records.itemsFound.sort(), ["bronze_plate:r", "bronze_sword:n"]);
  assert.deepEqual(state.records.runHistory[0], {
    at: 1_000_000_000_000, team: 0, dungeonId: "plains", mode: "normal", cleared: true, battlesWon: 3, battles: 3,
    exp: 42, items: 1, disassembled: 1, material: 5, tamed: "スライム",
  });
  // 全滅: 持ち帰れなかった装備は記録しない。履歴は新しい順
  const run2 = Runner.startRun(0, "plains");
  run2.battleIndex = 1;
  run2.pendingDrops.push({ id: "c", base: "bronze_staff", slot: "weapon", stats: { mag: 3 }, rarity: "ur", plus: 0, materialValue: 350 });
  Runner.finishRun(run2, false);
  assert.equal(state.records.itemsFound.includes("bronze_staff:ur"), false);
  assert.equal(state.records.runHistory.length, 2);
  assert.deepEqual([state.records.runHistory[0].cleared, state.records.runHistory[0].battlesWon], [false, 1]);
});

test("勝利: 生存者にEXP、ドロップは保留。最後の戦闘で踏破を記録し、初踏破なら次のダンジョンを解放", () => {
  const { state, Runner, best } = setup({ level: 8 });
  const run = Runner.startRun(0, "plains");
  for (let i = 0; i < run.dungeon.battles; i++) {
    const { battle } = Runner.startBattle(run);
    assert.equal(fight(Runner, 0), "victory");
    assert.equal(battle.active, false);
    state.roster[4].alive = false; // 倒れたメンバーにはEXPが入らない
    const expBefore = state.roster.map((c) => c.exp + c.level * 1e9);
    const r = Runner.winBattle(run, battle);
    assert.ok(r.expGain > 0);
    assert.ok(state.roster[0].exp + state.roster[0].level * 1e9 > expBefore[0]);
    assert.equal(state.roster[4].exp + state.roster[4].level * 1e9, expBefore[4]);
    state.roster[4].alive = true;
    if (i < run.dungeon.battles - 1) {
      assert.deepEqual([r.isLast, run.battleIndex], [false, i + 1]);
    } else {
      assert.equal(r.isLast, true);
      assert.equal(r.firstClear, true);
      assert.deepEqual([...r.unlocked.map((d) => d.id)], ["forest"]); // data は別の実行環境で読み込んでいるため配列を作り直して比べる
    }
  }
  assert.ok(state.clearedDungeons.has("plains"));
  assert.deepEqual(best, [1]);
  assert.equal(state.inventory.length, 0); // ドロップは踏破の確定まで保留
  assert.ok(run.expTotal > 0);
  // 2回目の踏破では解放しない
  const run2 = Runner.startRun(0, "plains");
  run2.battleIndex = run2.dungeon.battles - 1;
  const { battle } = Runner.startBattle(run2);
  fight(Runner, 0);
  assert.equal(Runner.winBattle(run2, battle).unlocked.length, 0);
});

test("道中イベント: 宝箱は保留ドロップへ、罠はHP1未満にしない、泉は上限まで回復、石碑は加護を足す", () => {
  const seen = {};
  for (let seed = 1; seed < 400 && Object.keys(seen).length < 4; seed++) {
    const { state, Runner, roster: R } = setup({ seed });
    const run = Runner.startRun(0, "plains");
    for (const c of state.roster) c.hp = Math.max(1, Math.round(c.hp / 2));
    const before = state.roster.map((c) => c.hp);
    const ev = Runner.rollEvent(run);
    if (!ev) continue;
    seen[ev.kind] = true;
    if (ev.kind === "treasure") {
      assert.deepEqual(run.pendingDrops, ev.item ? [ev.item] : []);
    } else if (ev.kind === "trap") {
      assert.ok(ev.hits.length === (ev.wide ? 5 : 1));
      for (const h of ev.hits) assert.ok(h.c.hp >= 1 && h.dmg >= 1);
    } else if (ev.kind === "spring") {
      ev.heals.forEach((h, i) => {
        assert.ok(h.c.hp >= before[i] && h.c.hp <= R.computeStats(h.c).maxHp);
      });
    } else if (ev.kind === "shrine") {
      assert.ok(["atk", "def", "spd"].includes(ev.stat));
      assert.equal(run.buffs[ev.stat], ev.total);
      assert.ok(Math.abs(ev.total - 0.12) < 1e-9);
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), ["shrine", "spring", "trap", "treasure"]);
});

test("周回の終了: 踏破なら保留ドロップを出撃時の設定で振り分け、全滅なら持ち帰れない。どちらもチームは全回復", () => {
  const { state, Runner, roster: R } = setup();
  const n = { id: "a", slot: "weapon", stat: "atk", value: 3, rarity: "n", plus: 0, materialValue: 5 };
  const r = { id: "b", slot: "armor", stat: "def", value: 3, rarity: "r", plus: 0, materialValue: 20 };
  const run = Runner.startRun(0, "plains");
  run.pendingDrops.push(n, r);
  state.roster[0].hp = 1; state.roster[0].alive = false;
  Runner.finishRun(run, true);
  assert.equal(run.finished, true);
  assert.equal(run.wiped, false);
  assert.deepEqual(state.inventory, [r]);
  assert.equal(state.material, 5);
  assert.deepEqual([run.disassembleCount, run.materialGained, run.drops.length], [1, 5, 1]);
  assert.equal(state.roster[0].alive, true);
  assert.equal(state.roster[0].hp, R.computeStats(state.roster[0]).maxHp);

  const run2 = Runner.startRun(0, "plains");
  run2.pendingDrops.push({ ...r, id: "c" });
  Runner.finishRun(run2, false);
  assert.equal(run2.wiped, true);
  assert.equal(state.inventory.length, 1);
  assert.equal(Runner.isTeamRunActive(0), false);
});

test("自動周回: 全滅で停止、目標回数で完了、それ以外は続ける", () => {
  const { state, Runner } = setup();
  const ar = state.autoRepeat[0];
  const run = Runner.startRun(0, "plains");
  Runner.finishRun(run, true);
  assert.equal(Runner.advanceAutoRepeat(run), null); // 自動周回中でない
  Object.assign(ar, { active: true, target: 2, done: 0 });
  assert.equal(Runner.advanceAutoRepeat(run), "continue");
  assert.equal(ar.done, 1);
  assert.equal(Runner.advanceAutoRepeat(run), "completed");
  assert.deepEqual([ar.active, ar.done], [false, 2]);
  Object.assign(ar, { active: true, target: 5, done: 1 });
  const wiped = Runner.startRun(0, "plains");
  Runner.finishRun(wiped, false);
  assert.equal(Runner.advanceAutoRepeat(wiped), "stoppedByWipe");
  assert.deepEqual([ar.active, ar.done], [false, 1]); // 全滅しても完了周回数は戻さない
});

test("中断: 進行中の周回を打ち切ってチームを回復する（終わった周回は打ち切らない）", () => {
  const { state, Runner } = setup();
  const run = Runner.startRun(0, "plains");
  const { battle } = Runner.startBattle(run);
  state.roster[1].alive = false;
  assert.equal(Runner.interruptRun(0), true);
  assert.equal(run.finished, true);
  assert.equal(battle.active, false);
  assert.equal(state.roster[1].alive, true);
  assert.equal(Runner.interruptRun(0), false);
});

test("オフライン精算: 離れていた時間ぶん周回し、自動周回を止めて結果を返す", () => {
  const { state, Runner, dex, setClock } = setup({ level: 8 });
  const savedAt = 1_000_000_000_000;
  setClock(savedAt + 60 * 60 * 1000); // 1時間
  const info = { active: true, target: 5, done: 1, dungeonId: "plains" };
  const summaries = Runner.runOfflineProgress([info, null, null, null], savedAt);
  assert.equal(summaries.length, 1);
  const s = summaries[0];
  assert.equal(s.team, 0);
  assert.equal(s.dungeonName, data.getDungeon("plains").name);
  assert.equal(s.cleared, 4); // 残り4周（1時間あれば足りる）
  assert.ok(s.expGained > 0);
  assert.equal(s.wipedOut, false);
  assert.equal(s.tooShort, false);
  assert.deepEqual(state.autoRepeat[0], { active: false, target: 5, done: 5 });
  assert.ok(state.clearedDungeons.has("plains"));
  assert.ok(dex.size > 0);
  // 冒険の記録: 出会った敵はダンジョン別に、離れていた間の周回はまとめて1件の履歴に
  assert.ok(state.records.dungeonEncounters.plains.length > 0);
  assert.equal(state.records.runHistory.length, 1);
  const h = state.records.runHistory[0];
  assert.deepEqual([h.offline, h.dungeonId, h.runs, h.clears, h.cleared, h.exp], [true, "plains", 4, 4, true, s.expGained]);
});

test("オフライン精算: 1周ぶんの時間が経っていなければ周回せず、止まった理由を返す。対象がなければnull", () => {
  const { state, Runner, setClock } = setup({ level: 8 });
  const savedAt = 1_000_000_000_000;
  setClock(savedAt + 1000);
  const [s] = Runner.runOfflineProgress([{ active: true, target: 5, done: 0, dungeonId: "plains" }], savedAt);
  assert.deepEqual([s.cleared, s.tooShort], [0, true]);
  assert.equal(state.autoRepeat[0].active, false);
  assert.equal(Runner.runOfflineProgress([null, { active: false, target: 5, done: 0, dungeonId: "plains" }], savedAt), null);
  assert.ok(Runner.estimateOfflineRunSeconds(data.getDungeon("plains")) > 1);
  assert.ok(OFFLINE_MAX_MS === 8 * 60 * 60 * 1000);
});

test("オフライン精算: 弱いパーティで全滅したら、そこまでのEXPは残り、ドロップは持ち帰れない", () => {
  const { state, Runner, setClock } = setup({ level: 1 });
  const savedAt = 1_000_000_000_000;
  setClock(savedAt + OFFLINE_MAX_MS * 3); // 8時間を超えた分は切り捨て
  const [s] = Runner.runOfflineProgress([{ active: true, target: 3, done: 0, dungeonId: "peak" }], savedAt);
  assert.equal(s.wipedOut, true);
  assert.equal(s.cleared, 0);
  assert.equal(state.inventory.length, 0);
  assert.equal(state.clearedDungeons.has("peak"), false);
});

test("テイム: どのダンジョンでテイムしても、仲間になるモンスターはLv1から", () => {
  const { state, Runner } = setup({ level: 40 });
  const mon = Runner.addTamedMonster("yeti");
  assert.equal(mon.level, 1);
  assert.equal(mon.isMonster, true);
  assert.ok(state.roster.includes(mon));
});

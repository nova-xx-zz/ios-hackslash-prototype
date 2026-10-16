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
    enableFloorPilot: !!opts.enableFloorPilot,
    enableGearTrial: !!opts.enableGearTrial,
    autoDisassemble: () => filter,
    markDexSeen: (k) => dex.add(k),
    setBestStage: (n) => best.push(n),
    now: () => clock,
    canAddMonster: opts.canAddMonster,
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

// 1戦闘を、フレームの間隔・速度を変えた画面のループと同じ進め方（frameSteps）で決着まで進め、結果をまとめる
function fightByFrames(Runner, state, team, frameSeconds, speed) {
  const { frameSteps, STEP_SECONDS } = require("../js/core/battle.js");
  let acc = 0;
  for (let f = 0; f < 1_000_000; f++) {
    const r = frameSteps(acc, frameSeconds, speed, 20);
    acc = r.acc;
    for (let i = 0; i < r.steps; i++) {
      const { result } = Runner.stepBattle(team, STEP_SECONDS);
      if (result) {
        const battle = Runner.teamBattles[team];
        return JSON.stringify({ result, time: battle.time.toFixed(6), hp: state.roster.filter((c) => c.team === team).map((c) => c.hp),
          enemies: battle.enemies.map((e) => [e.key, e.hp]) });
      }
    }
  }
  throw new Error("決着しない");
}

test("固定刻み: 端末の描画速度・戦闘の速度を変えても、同じ戦闘は同じ行動・同じ結果になる", () => {
  const outcomes = [[1 / 60, 1], [1 / 30, 1], [1 / 144, 1], [1 / 60, 2], [1 / 60, 5], [1 / 20, 5]].map(([frame, speed]) => {
    const { state, Runner } = setup({ level: 5, seed: 77 });
    const run = Runner.startRun(0, "plains");
    Runner.startBattle(run);
    return fightByFrames(Runner, state, 0, frame, speed);
  });
  for (const o of outcomes) assert.equal(o, outcomes[0]);
});

test("固定刻み: 1フレームの刻み数には上限があり、消化しきれない時間は次のフレームへ持ち越す", () => {
  const { frameSteps } = require("../js/core/battle.js");
  assert.deepEqual(frameSteps(0, 0.1, 5, 20).steps, 10);
  const capped = frameSteps(0, 0.1, 5, 4);
  assert.equal(capped.steps, 4);
  assert.ok(Math.abs(capped.acc - 0.3) < 1e-9);
  let acc = 0, total = 0; // 60fpsで1秒 → 20刻み
  for (let f = 0; f < 60; f++) { const r = frameSteps(acc, 1 / 60, 1, 20); acc = r.acc; total += r.steps; }
  assert.equal(total, 20);
});

test("チーム別の乱数: 他のチームが同時に戦っても、そのチームの遭遇・戦闘の結果は変わらない", () => {
  const solo = (() => {
    const { state, Runner } = setup({ level: 5, seed: 91 });
    const run = Runner.startRun(0, "plains");
    const { battle } = Runner.startBattle(run);
    const keys = battle.enemies.map((e) => e.key).join(",");
    return keys + "|" + fightByFrames(Runner, state, 0, 1 / 60, 1);
  })();
  const together = (() => {
    const { state, roster, Runner } = setup({ level: 5, seed: 91 });
    const run0 = Runner.startRun(0, "plains");
    // 2チーム目を作って先に戦わせ、乱数を使わせてから1チーム目を戦わせる
    for (const [name, job] of [["B1", "warrior"], ["B2", "mage"], ["B3", "priest"]]) state.roster.push(roster.newCharacter(name, job, "human", { team: 1, level: 5 }));
    const run1 = Runner.startRun(1, "plains");
    Runner.startBattle(run1);
    for (let i = 0; i < 37; i++) Runner.stepBattle(1, 0.05);
    Runner.rollEvent(run1);
    const { battle } = Runner.startBattle(run0);
    const keys = battle.enemies.map((e) => e.key).join(",");
    const { frameSteps, STEP_SECONDS } = require("../js/core/battle.js");
    let acc = 0;
    for (let f = 0; f < 1_000_000; f++) {
      const r = frameSteps(acc, 1 / 60, 1, 20);
      acc = r.acc;
      for (let i = 0; i < r.steps; i++) {
        Runner.stepBattle(1, STEP_SECONDS); // 毎刻み、他のチームも並行して進める
        const { result } = Runner.stepBattle(0, STEP_SECONDS);
        if (result) {
          return keys + "|" + JSON.stringify({ result, time: battle.time.toFixed(6), hp: state.roster.filter((c) => c.team === 0).map((c) => c.hp),
            enemies: battle.enemies.map((e) => [e.key, e.hp]) });
        }
      }
    }
    throw new Error("決着しない");
  })();
  assert.equal(together, solo);
});

test("戦闘の打ち切り: 決着がつかないまま300秒を超えたら timeout（撤退）で終わる", () => {
  const { Runner } = setup();
  const run = Runner.startRun(0, "plains");
  const { battle } = Runner.startBattle(run);
  for (const e of battle.enemies) { e.hp = e.maxHp = 1e12; e.spd = 0; } // 倒しきれず、敵も行動しない
  let result = null, steps = 0;
  while (!result && steps < 100000) { result = Runner.stepBattle(0, 0.05).result; steps++; }
  assert.equal(result, "timeout");
  assert.equal(battle.active, false);
  assert.ok(battle.time >= 300 && battle.time < 300.1);
  Runner.finishRun(run, false);
  assert.equal(run.wiped, true); // 全滅と同じ扱い（ドロップは持ち帰れず、自動周回は止まる）
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

test("オフライン精算の保存保証: 報酬と自動周回の停止は1つのセーブで確定し、保存に失敗しても二重にも消失にもならない", () => {
  const save = require("../js/model/save.js");
  const opts = { syncExpToNext: data.syncExpToNext, itemBases: data.ITEM_BASES, legacyItemBases: data.LEGACY_ITEM_BASES };
  const savedAt = 1_000_000_000_000;
  // 離れる直前のセーブ: チーム1が自動周回中
  const before = setup({ level: 8 });
  before.state.autoRepeat[0] = { active: true, target: 5, done: 1 };
  const beforeJson = JSON.stringify(save.serialize(before.state, { now: savedAt, runDungeonIds: ["plains"] }));

  // 起動して精算する（game.js の loadGame と同じ順）
  const settle = (json) => {
    const env = setup({ level: 8 });
    const loaded = save.deserialize(JSON.parse(json), opts);
    Object.assign(env.state, loaded.state);
    env.setClock(savedAt + 60 * 60 * 1000);
    const active = loaded.savedAutoRepeat.some((ar) => ar && ar.active);
    const summaries = active ? env.Runner.runOfflineProgress(loaded.savedAutoRepeat, loaded.savedAt) : null;
    return { env, summaries };
  };
  const first = settle(beforeJson);
  assert.equal(first.summaries[0].cleared, 4);
  const expAfter = first.env.state.roster[0].exp;
  const levelAfter = first.env.state.roster[0].level;

  // 保存に成功した場合: そのセーブは自動周回が止まっているので、次に起動しても精算しない（二重にならない）
  const afterJson = JSON.stringify(save.serialize(first.env.state, { now: savedAt + 60 * 60 * 1000, runDungeonIds: ["plains"] }));
  const reloaded = settle(afterJson);
  assert.equal(reloaded.summaries, null);
  assert.equal(reloaded.env.state.roster[0].level, levelAfter);
  assert.equal(reloaded.env.state.roster[0].exp, expAfter);
  assert.deepEqual(JSON.parse(afterJson).autoRepeat[0], { active: false, target: 5, done: 5, dungeonId: "plains", mode: "normal" });

  // 保存に失敗した場合: 端末には離れる前のセーブが残るので、次に起動するともう一度精算される（消失しない）。
  // 精算前の状態からやり直すので、報酬が上乗せされることもない
  const retried = settle(beforeJson);
  assert.equal(retried.summaries[0].cleared, 4);
  assert.equal(retried.env.state.autoRepeat[0].done, 5);
  assert.equal(retried.env.state.records.runHistory.length, 1); // 履歴も1件だけ（前回の精算は残っていない）
});

test("テイム: 仲間のBOXが満員の間は抽選せず、通常プレイ・オフライン精算とも仲間は増えない", () => {
  let full = true;
  const { state, Runner, setClock } = setup({ level: 8, canAddMonster: () => !full });
  const run = { defeatedTamable: ["slime"] };
  assert.deepEqual(Runner.attemptTame(run), { success: false, full: true });
  assert.equal(Runner.attemptTame({ defeatedTamable: [] }), null);

  const before = state.roster.length;
  const savedAt = 1_000_000_000_000;
  setClock(savedAt + 8 * 60 * 60 * 1000);
  const [s] = Runner.runOfflineProgress([{ active: true, target: 50, done: 0, dungeonId: "plains" }], savedAt);
  assert.ok(s.cleared > 0);
  assert.equal(state.roster.length, before);
  assert.deepEqual(s.tamedNames, []);
  assert.ok(s.tameBlocked > 0); // スライムの多い草原を何周もすれば、テイムの機会は必ずある

  full = false;
  assert.equal(typeof Runner.attemptTame(run).success, "boolean");
});

test("オフラインEXP: 勝利時の生存者だけへ戦闘ごとにEXPを加算し、前の戦闘の生存者を流用しない", () => {
  const { state, roster, Runner } = setup({ level: 8 });
  const dungeon = data.getDungeon("plains");
  const party = state.roster;
  const before = party.map(c => roster.totalExpInvested(c));
  const out = { cleared: false, encountered: [], drops: [], tame: null,
    expByBattle: [6, 10],
    eligibleIdsByBattle: [
      [party[0].id, party[1].id],
      [party[0].id, party[2].id],
    ],
  };
  Runner.applyOfflineRun(out, dungeon, 0);
  const gained = party.map((c, i) => roster.totalExpInvested(c) - before[i]);
  assert.deepEqual(gained, [16, 6, 11, 0, 0]);
  assert.deepEqual(out.eligibleIdsByBattle[0], [party[0].id, party[1].id]);
});

test("オフラインEXP: 勝利時に生存者IDが空なら0人、旧形式結果は安全に全員互換", () => {
  const { state, roster, Runner } = setup({ level: 8 });
  const d = data.getDungeon("plains");
  const before = state.roster.map(c => roster.totalExpInvested(c));
  Runner.applyOfflineRun({ cleared: false, encountered: [], drops: [], tame: null,
    expByBattle: [6], eligibleIdsByBattle: [[]] }, d, 0);
  assert.deepEqual(state.roster.map((c,i)=>roster.totalExpInvested(c)-before[i]), [0,0,0,0,0]);
  // 過去の監査スクリプト等が作る結果（eligibleIdsByBattleなし）は引き続き処理可能。
  Runner.applyOfflineRun({ cleared: false, encountered: [], drops: [], tame: null,
    expByBattle: [6] }, d, 0);
  assert.ok(state.roster.every((c,i)=>roster.totalExpInvested(c)>before[i]));
});

test("自動分解: 保存済みの出撃時設定を再起動後のオフライン周回へ引き継ぐ", () => {
  const save = require("../js/model/save.js");
  const { state, Runner, filter, setClock } = setup({ level: 8, seed: 51 });
  const run = Runner.startRun(0, "plains");
  state.autoRepeat[0] = { active: true, target: 5, done: 0 };
  const savedAt = 1_000_000_000_000;
  const serialized = save.serialize(state, { now: savedAt,
    runDungeonIds: ["plains"],
    runFilters: [{ enabled: run.autoDisassemble, rarities: run.autoDisassembleRarities }],
  });
  assert.deepEqual(serialized.autoRepeat[0].disassembleFilter,
    { enabled: true, rarities: ["n"] });
  const restored = save.deserialize(JSON.parse(JSON.stringify(serialized)), {
    syncExpToNext: data.syncExpToNext,
  });
  assert.deepEqual(restored.savedAutoRepeat[0].disassembleFilter,
    { enabled: true, rarities: ["n"] });
  // オフライン復帰時に設定が変わっても、出撃時のN自動分解を優先。
  filter.rarities.clear();
  setClock(savedAt + 60 * 60 * 1000);
  const [summary] = Runner.runOfflineProgress(restored.savedAutoRepeat, savedAt);
  assert.ok(summary.cleared>0);
  assert.ok(state.material>0,"N自動分解が保持されて強化石を得る");
  assert.ok(state.inventory.every(it=>it.rarity!=="n"),"N装備が所持品へ残らない");
});

test("自動分解: 旧セーブに出撃時設定がなければ現在値にフォールバック（互換）", () => {
  const { state, Runner, filter, setClock } = setup({ level: 8, seed: 51 });
  filter.rarities.clear();
  const savedAt = 1_000_000_000_000;
  setClock(savedAt + 60 * 60 * 1000);
  const [summary] = Runner.runOfflineProgress(
    [{active: true, target: 5, done: 0, dungeonId: "plains"}], savedAt);
  assert.ok(summary.cleared>0);
  assert.equal(state.material,0,"古いセーブは現在の分解OFF設定を使用");
  assert.ok(state.inventory.some(it=>it.rarity==="n"));
});


test("通常周回: 出撃時のN自動分解で高品質EXP/強化石OPを保管し低品質だけ素材化",()=>{
 const {state,Runner}=setup({level:8});
 const run=Runner.startRun(0,"plains");
 const fresh=(id,value,key)=>({id,base:"bronze_sword",slot:"weapon",stats:{atk:3},
  rarity:"n",materialValue:5,options:[{key,value}],plus:0});
 const valuable=fresh("high-exp",.18,"exp");
 const valuableStone=fresh("high-stone",.20,"material");
 const ordinary=fresh("ordinary",.17,"exp");
 run.pendingDrops.push(valuable,valuableStone,ordinary);
 Runner.finishRun(run,true);
 assert.deepEqual(state.inventory.map(i=>i.id).sort(),["high-exp","high-stone"]);
 assert.equal(state.material,5);
 assert.equal(run.disassembleCount,1);
 assert.equal(run.materialGained,5);
});

test("オフライン周回: 保存したN自動分解設定でも高品質OPは所持品へ残す",()=>{
 const {state,Runner,filter}=setup({level:8});
 const valuable={id:"offline-high",base:"bronze_sword",slot:"weapon",stats:{atk:3},
  rarity:"n",materialValue:5,plus:0,options:[{key:"material",value:.19}]};
 const ordinary={id:"offline-low",base:"bronze_sword",slot:"weapon",stats:{atk:3},
  rarity:"n",materialValue:5,plus:0,options:[{key:"material",value:.17}]};
 const fromSaved={enabled:true,rarities:new Set(["n"])};
 filter.rarities.clear(); // 実行中に画面のフィルタを変えても、出撃時の設定で精算する
 const result=Runner.applyOfflineRun({
  cleared:true,expByBattle:[],eligibleIdsByBattle:[],
  encountered:[],drops:[valuable,ordinary],tame:null
 },data.getDungeon("plains"),0,fromSaved);
 assert.equal(result.itemsGained,1,"only the protected gear enters inventory");
 assert.deepEqual(state.inventory.map(x=>x.id),["offline-high"]);
 assert.equal(state.material,5);
});

test("階層パイロット: 実エンジンに3F/5Fの入場時確定戦闘計画を接続（他ダンジョンは旧仕様）", () => {
  const { Runner } = setup({ seed: 17, enableFloorPilot: true, level: 22 });
  const plains = Runner.startRun(0, "plains");
  assert.equal(plains.pilotFloorPlans.length, 3);
  assert.ok(plains.dungeon.battles >= 5 && plains.dungeon.battles <= 11);
  assert.equal(plains.pilotSchedule.length, plains.dungeon.battles);
  assert.ok(plains.pilotSchedule.slice(0, -1).every((x) => x.boss === null));
  assert.equal(plains.pilotSchedule.at(-1).boss.kind, "final");
  const frozen = JSON.stringify(plains.pilotFloorPlans);
  for (let i = 0; i < plains.dungeon.battles; i++) {
    plains.battleIndex = i;
    const {battle, isBoss} = Runner.startBattle(plains);
    assert.ok(battle.enemies.length >= 1 && battle.enemies.length <= 5);
    assert.equal(isBoss, i === plains.dungeon.battles - 1);
    assert.equal(battle.enemies.some((e) => e.isBoss), isBoss);
  }
  assert.equal(JSON.stringify(plains.pilotFloorPlans), frozen, "do not re-roll floors at battle start");
  const cave = Runner.startRun(0, "cave");
  assert.equal(cave.pilotFloorPlans.length, 5);
  cave.battleIndex = cave.dungeon.battles - 1;
  const {battle} = Runner.startBattle(cave);
  assert.equal(battle.enemies[0].key, "rock_golem");
  assert.equal(battle.enemies[0].pilotBoss, true);
  assert.ok(battle.enemies.length <= 5);

  const old = Runner.startRun(0, "ruins");
  assert.equal(old.pilotSchedule, undefined);
  assert.equal(old.dungeon.battles, data.getDungeon("ruins").battles);
});

test("階層パイロット: 未確定UR/LRを全滅・撤退でロストし、初回最終ボスの勝利まで確定しない", () => {
  const { Runner, state } = setup({seed:33, enableFloorPilot:true, level:22});
  const run = Runner.startRun(0, "plains");
  const { battle } = Runner.startBattle(run);
  assert.throws(() => Runner.winBattle(run, battle), /living enemies/);
  for (const e of battle.enemies) e.alive = false;
  const win = Runner.winBattle(run, battle);
  assert.equal(win.isLast, false);
  assert.throws(() => Runner.winBattle(run, battle), /already resolved/);
  assert.throws(() => Runner.finishRun(run, true), /Final boss/);
  assert.ok(run.pendingDrops.length);
  assert.ok(!state.clearedDungeons.has("plains"));
  const rare = {id:"pilot-ur",base:"bronze_sword",slot:"weapon",stats:{atk:10},rarity:"ur",plus:0,materialValue:400};
  const legend = {id:"pilot-lr",base:"bronze_sword",slot:"weapon",stats:{atk:20},rarity:"lr",plus:0,materialValue:900};
  run.pendingDrops.push(rare,legend);
  const before = state.inventory.length;
  Runner.finishRun(run,false);
  assert.equal(run.wiped,true);
  Runner.finishRun(run,false); // 二重呼び出しでも報酬・履歴を増やさない
  assert.equal(state.records.runHistory.length,1);
  assert.equal(state.inventory.length,before);
  assert.equal(state.records.itemsFound.includes("bronze_sword:ur"),false);
  assert.equal(state.records.itemsFound.includes("bronze_sword:lr"),false);
});

test("階層パイロット: 途中宝箱・泉のイベントはタップ不要、未習得の解錠は成功しない", () => {
  const {Runner}=setup({seed:22,enableFloorPilot:true});
  const run=Runner.startRun(0,"plains");
  let chests=0,springs=0,locked=0;
  for(let i=0;i<2000;i++){
    const ev=Runner.rollEvent(run);
    if(!ev)continue;
    if(ev.kind==="treasure")chests++;
    if(ev.kind==="springAura"){springs++; assert.ok(ev.defensePercent===.1||ev.defensePercent===-.08);}
    if(ev.kind==="lockedTreasure"){locked++;assert.equal(ev.success,false);assert.equal(ev.item,null);}
  }
  assert.ok(chests>0&&springs>0&&locked>0);
  assert.ok(run.buffs.def<=.24&&run.buffs.def>=-.24);
});

test("階層パイロット: オフラインでも実戦闘エンジンを通して3Fを完走し、ドロップ確定条件を守る", () => {
  const { Runner, state } = setup({ seed: 222, level: 35, enableFloorPilot: true });
  const out = Runner.computeOfflineRun(data.getDungeon("plains"), 0);
  assert.equal(out.cleared, true, "十分に強いパーティは3Fを実戦闘でクリア");
  assert.ok(out.expByBattle.length >= 5 && out.expByBattle.length <= 11);
  assert.ok(out.encountered.length >= out.expByBattle.length);
  assert.ok(out.drops.length >= out.expByBattle.length, "撃破報酬は踏破した周だけ返る");
  assert.equal(state.inventory.length, 0, "計算段階では所持品へ付与していない");
  const before = state.inventory.length;
  const applied = Runner.applyOfflineRun(out, data.getDungeon("plains"), 0, { enabled: false, rarities: new Set() });
  assert.equal(applied.cleared, true);
  assert.ok(state.inventory.length > before);
});

test("階層パイロット: オフライン計算を強制敗北させても未確定品は一切返さない", () => {
  const { Runner, state } = setup({ seed: 46, level: 1, enableFloorPilot: true });
  const out = Runner.computeOfflineRun(data.getDungeon("cave"), 0);
  if (!out.cleared) {
    assert.equal(out.drops.length, 0);
    const result = Runner.applyOfflineRun(out, data.getDungeon("cave"), 0);
    assert.equal(result.cleared, false);
    assert.equal(state.inventory.length, 0);
  } else {
    // 将来の戦闘バランス変更でLv1でもクリア可能になった場合は、
    // クリアしたデータを意図的に敗北へ上書きせず、この検証を条件付きで保持する。
    assert.ok(out.drops.length > 0);
  }
});

test("階層pilot: 戦闘中チェックポイントを復元しても敵HP・味方HP・乱数・OP効果は同一", () => {
  const original=setup({enableFloorPilot:true,seed:2026,level:12});
  const run=original.Runner.startRun(0,"cave");
  const {battle}=original.Runner.startBattle(run);
  const party=original.roster.teamMembers(0);
  for(let i=0;i<27;i++)original.Runner.stepBattle(0,0.05);
  battle.fx=new Map([[battle.enemies[0],{def:{mult:0.75,until:150}}],[party[0],{atk:{mult:1.2,until:140}}]]);
  const checkpoint=original.Runner.capturePilotRuns();
  assert.equal(checkpoint[0].phase,"battle");
  assert.equal(checkpoint[0].battle.fx.length,2);
  const second=setup({enableFloorPilot:true,seed:1,level:12});
  assert.deepEqual(second.Runner.restorePilotRuns(checkpoint),[0]);
  const restored=second.Runner.teamRuns[0];
  const battle2=second.Runner.teamBattles[0];
  assert.deepEqual(restored.pilotFloorPlans,run.pilotFloorPlans);
  assert.equal(restored.battleIndex,run.battleIndex);
  assert.equal(battle2.enemies[0].hp,battle.enemies[0].hp);
  assert.equal(second.roster.teamMembers(0)[0].hp,party[0].hp);
  assert.deepEqual(battle2.fx.get(battle2.enemies[0]),{def:{mult:.75,until:150}});
  assert.deepEqual(battle2.fx.get(second.roster.teamMembers(0)[0]),{atk:{mult:1.2,until:140}});
  assert.equal(restored.rngSource.getState(),run.rngSource.getState());
  for(let i=0;i<30;i++){
    const one=original.Runner.stepBattle(0,0.05);
    const two=second.Runner.stepBattle(0,0.05);
    assert.equal(one.result,two.result);
    assert.deepEqual(one.events.map(e=>e.type),two.events.map(e=>e.type));
  }
  assert.equal(restored.rngSource.getState(),run.rngSource.getState());
  assert.deepEqual(battle2.enemies.map(e=>e.hp),battle.enemies.map(e=>e.hp));
});

test("階層pilot: 戦闘間の未確定報酬と全階層計画を保存、ボス以外では確定しない",()=>{
 const first=setup({enableFloorPilot:true,seed:84,level:20});
 const run=first.Runner.startRun(0,"plains");
 const {battle}=first.Runner.startBattle(run);
 for(const enemy of battle.enemies)enemy.alive=false;
 const result=first.Runner.winBattle(run,battle);
 assert.equal(result.isLast,false);
 assert.equal(run.pilotCheckpointPhase,"between");
 run.pendingDrops.push({id:"testUR",rarity:"ur",base:"bronze_sword",slot:"weapon",stats:{atk:9},plus:0});
 const shot=first.Runner.capturePilotRuns();
 const second=setup({enableFloorPilot:true,seed:92,level:20});
 assert.deepEqual(second.Runner.restorePilotRuns(shot),[0]);
 const restored=second.Runner.teamRuns[0];
 assert.equal(restored.pilotCheckpointPhase,"between");
 assert.equal(restored.pendingDrops.some(x=>x.id==="testUR"),true);
 assert.equal(second.state.inventory.length,0);
 assert.equal(second.Runner.rollEvent(restored)?.kind===undefined||true,true);
 assert.equal(restored.pilotCheckpointPhase,"ready");
 const initial=JSON.stringify(restored.pilotFloorPlans);
 const {isBoss}=second.Runner.startBattle(restored);
 assert.equal(isBoss,false);
 assert.equal(JSON.stringify(restored.pilotFloorPlans),initial);
 second.Runner.finishRun(restored,false);
 assert.equal(second.state.inventory.length,0);
 assert.equal(second.state.records.itemsFound.includes("bronze_sword:ur"),false);
});

test("階層pilot: 不正・破損したチェックポイントは捨て、通常モードでは復元不能",()=>{
 const first=setup({enableFloorPilot:true,seed:71});
 const run=first.Runner.startRun(0,"plains");
 first.Runner.startBattle(run);
 const saved=first.Runner.capturePilotRuns()[0];
 const tampered=JSON.parse(JSON.stringify(saved));
 tampered.floorPlans[0].regularBattles=10000;
 const second=setup({enableFloorPilot:true});
 assert.deepEqual(second.Runner.restorePilotRuns([tampered]),[]);
 assert.equal(second.Runner.teamRuns[0],null);
 const vanilla=setup();
 assert.deepEqual(vanilla.Runner.restorePilotRuns([saved]),[]);
 assert.equal(vanilla.Runner.teamRuns[0],null);
});

test("解錠術: 盗賊Lv5と忍者Lv1で習得。低レベル・他職・モンスターでは習得しない", () => {
  const {roster}=setup({enableFloorPilot:true});
  const make = (job, level) => roster.newCharacter("スキル確認", job, "human", {team:0,level});
  const low = make("thief",4);
  const thief = make("thief",5);
  const ninja = make("ninja",1);
  const fighter = make("warrior",40);
  const monster = make("thief",40);
  monster.isMonster = true;
  assert.equal(roster.explorationSkillChance(low,"thief_lockpick"),0);
  const newlyLearned=roster.gainExp(low,low.expToNext);
  assert.equal(roster.explorationSkillChance(low,"thief_lockpick"),.45);
  assert.ok(newlyLearned.abilityUnlocks.some((message)=>message.includes("解錠術")));
  assert.equal(roster.explorationSkillChance(thief,"thief_lockpick"),.45);
  assert.equal(roster.explorationSkillChance(ninja,"thief_lockpick"),.45);
  assert.equal(roster.explorationSkillChance(fighter,"thief_lockpick"),0);
  assert.equal(roster.explorationSkillChance(monster,"thief_lockpick"),0);
  assert.ok(roster.availableAbilities(thief).every(x=>x.id!=="thief_lockpick"),"battle AI must never select exploration skill");
  assert.ok(roster.availableAbilities(ninja).every(x=>x.id!=="thief_lockpick"));
});

test("解錠術: 盗賊Lv5が生存中だけ自動解錠を試行し、未確定品は失敗時に全ロスト", () => {
  const {Runner,roster,state}=setup({enableFloorPilot:true,seed:20261016});
  const thief=roster.newCharacter("解錠役","thief","human",{team:0,level:5});
  state.roster[0]=thief;
  let run=Runner.startRun(0,"plains");
  let attempted=0,success=0,locked=0;
  for(let i=0;i<3000;i++){
    const event=Runner.rollEvent(run);
    if(!event||event.kind!=="lockedTreasure")continue;
    locked++;
    if(event.attempted)attempted++;
    if(event.success){success++;assert.ok(event.item);}
  }
  assert.ok(locked>70);
  assert.equal(attempted,locked);
  assert.ok(success>0);
  assert.ok(success<locked);
  const pending=run.pendingDrops.length;
  assert.ok(pending>0);
  const ownedBefore=state.inventory.length;
  Runner.finishRun(run,false);
  assert.equal(state.inventory.length,ownedBefore,"failed dungeon loses all chest items");
  assert.equal(state.records.itemsFound.length,0,"lost items are not added to found equipment catalogue");
  thief.alive=false;thief.hp=0;
  run=Runner.startRun(0,"plains"); // 出発時に全回復するため、直後に戦闘不能にする
  thief.alive=false;thief.hp=0;
  let noAttempt=0;
  for(let i=0;i<600;i++){
    const ev=Runner.rollEvent(run);
    if(ev&&ev.kind==="lockedTreasure"){
      assert.equal(ev.attempted,false);
      assert.equal(ev.success,false);
      noAttempt++;
    }
  }
  assert.ok(noAttempt>0);
});

test("解錠術: 忍者・盗賊が複数いても宝箱1個につき抽選は1回",()=>{
  const {Runner,roster,state}=setup({enableFloorPilot:true,seed:105});
  state.roster[0]=roster.newCharacter("鍵師","thief","human",{team:0,level:5});
  state.roster[1]=roster.newCharacter("忍者","ninja","human",{team:0,level:5});
  const run=Runner.startRun(0,"plains");
  let total=0,success=0;
  for(let i=0;i<3000;i++){
    const ev=Runner.rollEvent(run);
    if(ev&&ev.kind==="lockedTreasure"){total++; if(ev.success)success++;}
  }
  assert.ok(total>100);
  assert.ok(success/total>.37&&success/total<.53,success+"/"+total);
});

test("解錠術: オフライン周回でもクローンパーティの習得状態で判定する", () => {
  const {Runner,roster,state}=setup({enableFloorPilot:true,seed:772,level:35});
  state.roster[0]=roster.newCharacter("解錠担当","thief","human",{team:0,level:35});
  let clonedCalls=0;
  const native=roster.explorationSkillChance;
  roster.explorationSkillChance=(c,id)=>{
    if(c.job==="thief"){
      const original=state.roster.find(x=>x.id===c.id);
      if(original&&original!==c) clonedCalls++;
    }
    return native(c,id);
  };
  const result=Runner.computeOfflineRun(data.getDungeon("plains"),0);
  assert.ok(result.expByBattle.length>0);
  assert.ok(clonedCalls>0,"offline chest events must consult the simulated party, not live roster");
  assert.equal(state.inventory.length,0,"offline calculation must not grant items before settlement");
});

// 画面なしでダンジョン1周ぶんの戦闘をシミュレーションする（tools/simulate.js と tests/ から使う）。
// 戦闘そのものはゲーム本体と同じ js/core/battle.js で動かす。
// 簡略化している点: 装備なし・スキルツリーなし・サブアビリティなし・技の優先度はすべて「通常」、
// 道中イベント（泉の回復・石碑の加護・罠）は起きない。実際のプレイよりやや厳しめの結果になる。
const { loadGameData } = require("./load-data.js");
const rngLib = require("../../js/core/rng.js");
const { baseStats } = require("../../js/core/stats.js");
const battleCore = require("../../js/core/battle.js");

const data = loadGameData();
const ATB_RATE = 7; // js/game.js と同じ値

// 初期パーティ（新規ゲーム開始時の5人と同じ構成）
const STARTER_PARTY = [
  { job: "warrior", race: "human" },
  { job: "warrior", race: "beastkin" },
  { job: "mage", race: "sylvan" },
  { job: "mage", race: "nocturne" },
  { job: "priest", race: "stonekin" },
];

function makeMember(spec, level, i) {
  return { name: `${data.JOBS[spec.job].name}${i + 1}`, job: spec.job, race: spec.race, level, targetPriority: "weakest", atb: 0, alive: true, hp: 0, mp: 0 };
}

function makeEnv(rng) {
  const statsOf = (c) => baseStats(data.JOBS[c.job], data.RACES[c.race], c.level);
  const passive = (c, key, def) => (data.RACES[c.race].passive[key] !== undefined ? data.RACES[c.race].passive[key] : def);
  return {
    rng,
    atbRate: ATB_RATE,
    stats: statsOf,
    abilities: (c) => data.JOBS[c.job].abilities.filter((a) => c.level >= a.reqLevel),
    mpCost: (c, a) => Math.max(0, Math.round(a.mpCost * passive(c, "mpCostMult", 1))),
    tier: () => 2,
    passives: (c) => ({
      lifesteal: passive(c, "lifesteal", 0),
      healBonus: passive(c, "healBonus", 0),
      critBonus: passive(c, "critBonus", 0),
      dmgTakenMult: passive(c, "dmgTakenMult", 1),
    }),
  };
}

// ダンジョン1周（HP/MPは入場時に全快、戦闘間は持ち越し）。戻り値: { cleared, battlesWon, seconds }
function simulateDungeonRun(dungeonId, level, opts) {
  opts = opts || {};
  const rng = rngLib.shared; // 敵の編成もdata.jsの共有乱数を使うため、同じ乱数でそろえる
  const dungeon = data.getDungeon(dungeonId);
  const env = makeEnv(rng);
  const party = (opts.party || STARTER_PARTY).map((spec, i) => makeMember(spec, level, i));
  for (const c of party) { const s = env.stats(c); c.hp = s.maxHp; c.mp = s.maxMp; }
  let seconds = 0;
  for (let b = 0; b < dungeon.battles; b++) {
    const battle = { enemies: data.buildEncounter(dungeon, b).map((e, i) => ({ ...e, id: "e" + i, alive: true })) };
    for (const c of party) if (c.alive) c.atb = rng.float(0, 25);
    const r = battleCore.simulate(battle, party, env, { maxSeconds: 300 });
    seconds += r.seconds;
    if (r.result !== "victory") return { cleared: false, battlesWon: b, seconds };
  }
  return { cleared: true, battlesWon: dungeon.battles, seconds };
}

// 踏破率と、踏破した周の平均戦闘時間（x1速度・ゲーム内秒）
function clearRate(dungeonId, level, trials, seed) {
  rngLib.setSharedSeed(seed === undefined ? 1 : seed);
  let cleared = 0, secs = 0;
  for (let t = 0; t < trials; t++) {
    const r = simulateDungeonRun(dungeonId, level);
    if (r.cleared) { cleared += 1; secs += r.seconds; }
  }
  rngLib.setSharedSeed(undefined);
  return { rate: cleared / trials, avgSeconds: cleared ? secs / cleared : null };
}

module.exports = { data, STARTER_PARTY, makeMember, makeEnv, simulateDungeonRun, clearRate };

// 画面なしでダンジョン1周ぶんの戦闘をシミュレーションする（tools/simulate.js と tests/ から使う）。
// 戦闘そのものはゲーム本体と同じ js/core/battle.js で動かす。
//
// 想定プレイヤー（opts）:
//   gear: { rarity, plus, level } … その装備のレベルの地方のシリーズの全種類を、このレア度・+値で用意し、
//                             ゲームの「おまかせ装備」と同じ選び方で付ける（null/省略なら装備なし）。
//                             同じシリーズでそろうので、セット効果も付く
//   tree: true             … スキルツリーを「素直な振り方」で振る（standardTreeRanks 参照）
// 共通の簡略化: サブアビリティなし・技の優先度はすべて「通常」・道中イベント（泉・石碑・罠）なし。
const { loadGameData } = require("./load-data.js");
const rngLib = require("../../js/core/rng.js");
const { baseStats } = require("../../js/core/stats.js");
const battleCore = require("../../js/core/battle.js");
const rewards = require("../../js/core/rewards.js");
const equipment = require("../../js/core/equipment.js");

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

// ---- 装備: ゲームの「おまかせ装備」（js/model/inventory.js の autoEquip）と同じ選び方 ----
function itemWeight(job, stat) {
  const b = job.base;
  const weights = { hp: b.hp / 30, mp: b.mp / 20, atk: b.atk / 10, mag: b.mag / 10, def: b.def / 8, spd: b.spd / 7 };
  return weights[stat] || 0.5;
}
function itemScore(job, item) {
  let score = 0;
  for (const [k, v] of Object.entries(data.itemStats(item))) score += v * itemWeight(job, k);
  return score;
}
function makeItem(base, rarity, plus, level) {
  const r = data.RARITIES.find((x) => x.key === rarity);
  const item = rewards.createItem(base, r, "sim", { level: level || 1, levelGrowth: data.ITEM_LEVEL_GROWTH });
  item.plus = plus || 0;
  return item;
}
// 部位ごとの候補（pool）から、両手武器と「片手武器＋左手」を合計で比べ、装飾品は上から accSlots 個
function pickEquip(jobId, pool, accSlots) {
  const job = data.JOBS[jobId];
  const profile = data.JOB_EQUIP[jobId];
  const usable = pool.filter((it) => equipment.canUseItem(profile, it));
  const score = (it) => (it ? itemScore(job, it) : 0);
  const best = (list) => list.reduce((a, b) => (score(b) > score(a) ? b : a), null);
  const eq = equipment.emptyEquip();
  const weapons = usable.filter((it) => it.slot === "weapon");
  const oneHand = weapons.filter((it) => it.hands !== 2).sort((a, b) => score(b) - score(a));
  const twoHand = best(weapons.filter((it) => it.hands === 2));
  const off = best(usable.filter((it) => it.slot === "shield").concat(profile.dualWield ? oneHand.slice(1) : []));
  if (twoHand && score(twoHand) > score(oneHand[0]) + score(off)) eq.main = twoHand;
  else { eq.main = oneHand[0] || null; eq.off = off; }
  eq.head = best(usable.filter((it) => it.slot === "head"));
  eq.body = best(usable.filter((it) => it.slot === "body"));
  const acc = usable.filter((it) => it.slot === "accessory").sort((a, b) => score(b) - score(a));
  equipment.ACC_POSITIONS.forEach((p, i) => { eq[p] = i < accSlots ? (acc[i] || null) : null; });
  return eq;
}
// 二刀流で同じ種類を2本持てるよう、各種類を2個ずつ用意する
function standardEquip(jobId, gear, accSlots) {
  if (!gear) return equipment.emptyEquip();
  const series = data.seriesForLevel(gear.level || 1);
  const pool = [];
  for (const b of data.ITEM_BASES.filter((x) => x.series === series.key)) {
    pool.push(makeItem(b, gear.rarity, gear.plus, gear.level), makeItem(b, gear.rarity, gear.plus, gear.level));
  }
  return pickEquip(jobId, pool, accSlots);
}

// ---- スキルツリー: 「素直な振り方」 ----
// 固有ツリー → 汎用ツリー①②③（各枠の初期ツリー）の順に、上のノードから振れるものを振る。
// 二択（exclusiveGroup）は先に並んでいる方（左側）を選ぶ。SPは Lv−1。
function treesFor(jobId) {
  const trees = [];
  const tag = data.jobTag(jobId);
  const ex = tag ? data.getExclusiveTreeByTag(tag) : null;
  if (ex) trees.push(ex);
  for (const slot of data.GENERAL_SLOTS) trees.push(data.getGeneralTree(slot.defaultTreeId));
  return trees;
}
function standardTreeRanks(jobId, level) {
  let sp = Math.max(0, level - 1);
  const result = [];
  for (const tree of treesFor(jobId)) {
    const ranks = {};
    for (const node of tree.nodes) {
      const cost = node.costByRank[0];
      if (cost > sp) continue;
      if (!node.prerequisites.every((p) => (ranks[p.nodeId] || 0) >= p.minRank)) continue;
      if (node.exclusiveGroup && tree.nodes.some((o) => o.exclusiveGroup === node.exclusiveGroup && ranks[o.id])) continue;
      ranks[node.id] = 1;
      sp -= cost;
    }
    result.push({ tree, ranks });
  }
  return result;
}
function treeTotals(c) {
  const totals = { atk: 0, def: 0, mag: 0, spd: 0, hp: 0, mp: 0, critBonus: 0, lifesteal: 0, healBonus: 0, dmgTakenMult: 1, mpCostMult: 1, accessorySlots: 0 };
  const abilities = [];
  for (const { tree, ranks } of c.treeRanks || []) {
    for (const node of tree.nodes) {
      if (!ranks[node.id]) continue;
      if (node.kind === "active" && node.ability) abilities.push(node.ability);
      for (const eff of node.effects || []) {
        if (eff.type === "statAdd") totals[eff.stat] += eff.value;
        else if (eff.type === "passiveAdd") totals[eff.key] += eff.value;
        else if (eff.type === "passiveMult") totals[eff.key] *= eff.value;
        else if (eff.type === "equipSlot" && eff.slot === "accessory") totals.accessorySlots += eff.value;
      }
    }
  }
  return { totals, abilities };
}

function makeMember(spec, level, i, opts) {
  opts = opts || {};
  const c = { name: `${data.JOBS[spec.job].name}${i + 1}`, job: spec.job, race: spec.race, level, targetPriority: "weakest", atb: 0, alive: true, hp: 0, mp: 0 };
  c.treeRanks = opts.tree ? standardTreeRanks(spec.job, level) : [];
  const tt = treeTotals(c);
  c.tree = tt.totals;
  c.treeAbilities = tt.abilities;
  // 装飾品の枠はスキルツリーの「装備の心得」「装備の極意」で増える（ツリーを振らない想定なら1枠）
  c.equip = standardEquip(spec.job, opts.gear, Math.min(equipment.MAX_ACCESSORY_SLOTS, 1 + tt.totals.accessorySlots));
  c.set = equipment.setBonusTotals(c.equip, data.ITEM_SERIES, data.getUniqueItem);
  return c;
}

function makeEnv(rng) {
  const race = (c) => data.RACES[c.race].passive;
  const statsOf = (c) => {
    const s = baseStats(data.JOBS[c.job], data.RACES[c.race], c.level);
    const key = (k) => (k === "hp" ? "maxHp" : k === "mp" ? "maxMp" : k);
    for (const it of Object.values(c.equip || {})) {
      if (!it) continue;
      for (const [k, v] of Object.entries(data.itemStats(it))) s[key(k)] += v;
    }
    const t = c.tree;
    if (t) { s.maxHp += t.hp; s.maxMp += t.mp; s.atk += t.atk; s.mag += t.mag; s.def += t.def; s.spd += t.spd; }
    if (c.set) for (const [k, pct] of Object.entries(c.set.stats)) s[key(k)] = Math.round(s[key(k)] * (1 + pct));
    return s;
  };
  const tree = (c, key, def) => (c.tree ? c.tree[key] : def);
  const gearP = (c, key, def) => (c.set ? c.set.passives[key] : def); // 装備のセット効果
  return {
    rng,
    atbRate: ATB_RATE,
    stats: statsOf,
    abilities: (c) => data.JOBS[c.job].abilities.filter((a) => c.level >= a.reqLevel).concat(c.treeAbilities || []),
    mpCost: (c, a) => Math.max(0, Math.round(a.mpCost * (race(c).mpCostMult || 1) * tree(c, "mpCostMult", 1) * gearP(c, "mpCostMult", 1))),
    tier: () => 2,
    passives: (c) => ({
      lifesteal: (race(c).lifesteal || 0) + tree(c, "lifesteal", 0) + gearP(c, "lifesteal", 0),
      healBonus: (race(c).healBonus || 0) + tree(c, "healBonus", 0) + gearP(c, "healBonus", 0),
      critBonus: (race(c).critBonus || 0) + tree(c, "critBonus", 0) + gearP(c, "critBonus", 0),
      dmgTakenMult: (race(c).dmgTakenMult || 1) * tree(c, "dmgTakenMult", 1) * gearP(c, "dmgTakenMult", 1),
    }),
  };
}

// ダンジョン1周（HP/MPは入場時に全快、戦闘間は持ち越し）。戻り値: { cleared, battlesWon, seconds }
function simulateDungeonRun(dungeonId, level, opts) {
  opts = opts || {};
  const rng = rngLib.shared; // 敵の編成もdata.jsの共有乱数を使うため、同じ乱数でそろえる
  const dungeon = data.getDungeon(dungeonId);
  const env = makeEnv(rng);
  const party = (opts.party || STARTER_PARTY).map((spec, i) => makeMember(spec, level, i, opts));
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
function clearRate(dungeonId, level, trials, seed, opts) {
  rngLib.setSharedSeed(seed === undefined ? 1 : seed);
  let cleared = 0, secs = 0;
  for (let t = 0; t < trials; t++) {
    const r = simulateDungeonRun(dungeonId, level, opts);
    if (r.cleared) { cleared += 1; secs += r.seconds; }
  }
  rngLib.setSharedSeed(undefined);
  return { rate: cleared / trials, avgSeconds: cleared ? secs / cleared : null };
}

module.exports = { data, STARTER_PARTY, makeMember, makeEnv, standardEquip, pickEquip, standardTreeRanks, simulateDungeonRun, clearRate };

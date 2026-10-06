// 進行シミュレーション: ふつうに遊んだ時、各ダンジョンに着く頃にどんな装備を持っているかを推定する。
// ダンジョンごとの適正装備（DUNGEONS[].benchmarkGear）を決める根拠に使う。
// 実行: node tools/progression.js [試行回数=50]
//
// 前提（遊び方のモデル）:
// - 草原から始め、次のダンジョンの推奨Lvに届くまで、今いるダンジョンを周回する（全滅はしない前提）
// - 1周のEXP・ドロップは通常プレイと同じ計算（戦闘ごとのドロップ、道中の宝箱。js/core/rewards.js）
// - ドロップのうち、部位ごとに使う個数（KEEP: 5人で武器5・盾3・頭5・体5・装飾品15）だけ一番強いもの
//   （装備のレベル・レア度・強化値を合わせた主能力の値）を使い、使わない分はすべて強化石にする
//   （自動分解を上手に使った場合。実際はやや下回る）
// - 強化石は、使う装備の+値がなるべく揃うように、+値の低いものから期待消費で強化していく
// - 全員同じレベル・種族補正なしで近似する
const { data } = require("./lib/sim.js");
const rngLib = require("../js/core/rng.js");
const rewards = require("../js/core/rewards.js");
const enhance = require("../js/core/enhance.js");

const R = data.ENHANCE_RULES;
const RARITY_ORDER = data.RARITIES.map((r) => r.key); // n, r, sr, ur, lr
const rank = (k) => RARITY_ORDER.indexOf(k);
// 部位ごとに使う個数（初期パーティ5人: せんし2・まほうつかい2・そうりょ1。盾はせんし2人とそうりょ、装飾品は1人3枠）
const KEEP = { weapon: 5, shield: 3, head: 5, body: 5, accessory: 15 };
const SLOTS = Object.keys(KEEP);
const KEPT_TOTAL = SLOTS.reduce((n, k) => n + KEEP[k], 0);

function runOnce(dungeon) {
  let exp = 0;
  const drops = [];
  for (let i = 0; i < dungeon.battles; i++) {
    const enemies = data.buildEncounter(dungeon, i);
    exp += rewards.battleExp(enemies);
    drops.push(...rewards.rollBattleDrops(data.REWARD_RULES, () => data.rollItemDrop(dungeon.level), rngLib.shared));
    drops.push(...rewards.rollRareDrops(enemies, () => data.rollItemDrop(dungeon.level, data.RARE_DROP_MIN_RARITY)));
    if (i < dungeon.battles - 1 && rewards.rollEventKind(data.REWARD_RULES, rngLib.shared) === "treasure") {
      const it = rewards.rollTreasure(data.REWARD_RULES, () => data.rollItemDrop(dungeon.level), rngLib.shared);
      if (it) drops.push(it);
    }
  }
  return { exp, drops };
}

// 部位ごとに上位 KEEP 個を装備に回し、残りを強化石にする
function settle(pool, stones) {
  const equipped = {};
  for (const slot of SLOTS) {
    const items = pool.filter((it) => it.slot === slot).sort((a, b) => data.itemEffectiveValue(b) - data.itemEffectiveValue(a) || rank(b.rarity) - rank(a.rarity));
    equipped[slot] = items.slice(0, KEEP[slot]);
    for (const it of items.slice(KEEP[slot])) stones += it.materialValue;
  }
  return { equipped, stones };
}

// 使う装備の+値を揃えるように、+値の低いものから期待消費で強化する（使い切れない端数は持ち越す）
function enhanceAll(items, stones) {
  for (;;) {
    const target = items.filter((it) => it.plus < data.ENHANCE_MAX_PLUS).sort((a, b) => a.plus - b.plus)[0];
    if (!target) break;
    const cost = enhance.expectedCost(R, target.rarity, target.plus);
    if (cost > stones) break;
    stones -= cost;
    target.plus += 1;
  }
  return stones;
}

function simulate(seed, expForLevel = data.expForLevel) {
  rngLib.setSharedSeed(seed);
  let level = 1, exp = 0, stones = 0, totalRuns = 0;
  let pool = [];
  const arrivals = [];
  for (let i = 0; i + 1 < data.DUNGEONS.length; i++) {
    const farm = data.DUNGEONS[i];
    const next = data.DUNGEONS[i + 1];
    let runs = 0;
    while (level < next.level) {
      const r = runOnce(farm);
      runs += 1;
      exp += r.exp;
      while (exp >= expForLevel(level)) { exp -= expForLevel(level); level += 1; }
      pool.push(...r.drops);
      const s = settle(pool, stones);
      stones = s.stones;
      pool = SLOTS.flatMap((slot) => s.equipped[slot]);
      stones = enhanceAll(pool, stones);
    }
    totalRuns += runs;
    arrivals.push({ dungeon: next, runs, totalRuns, items: pool.map((it) => ({ rarity: it.rarity, plus: it.plus, level: it.level || 1 })) });
  }
  rngLib.setSharedSeed(undefined);
  return arrivals;
}

// 使う装備の「代表値」: 下から3分の1（全員がだいたい持っている水準）のレア度と+値（と装備のレベル）
function typical(items) {
  const sorted = items.slice().sort((a, b) => rank(a.rarity) - rank(b.rarity) || a.plus - b.plus);
  const it = sorted[Math.floor(sorted.length / 3)] || { rarity: "-", plus: 0 };
  return it;
}

if (require.main === module) {
  const trials = parseInt(process.argv[2] || "50", 10);
  const results = Array.from({ length: trials }, (_, t) => simulate(500 + t));
  console.log(`試行回数: ${trials}回（遊び方の前提は tools/progression.js 冒頭）\n`);
  for (let i = 0; i < results[0].length; i++) {
    const d = results[0][i].dungeon;
    const runs = results.map((r) => r[i].totalRuns).sort((a, b) => a - b);
    const typ = results.map((r) => typical(r[i].items));
    const byRarity = {};
    for (const t of typ) byRarity[t.rarity] = (byRarity[t.rarity] || 0) + 1;
    const plusMedian = (k) => { const ps = typ.filter((t) => t.rarity === k).map((t) => t.plus).sort((a, b) => a - b); return ps.length ? ps[Math.floor(ps.length / 2)] : null; };
    const dist = RARITY_ORDER.filter((k) => byRarity[k]).map((k) => `${k.toUpperCase()}+${plusMedian(k)}（${Math.round(byRarity[k] / trials * 100)}%）`).join(" / ");
    const allRar = {};
    for (const r of results) for (const it of r[i].items) allRar[it.rarity] = (allRar[it.rarity] || 0) + 1;
    const mix = RARITY_ORDER.filter((k) => allRar[k]).map((k) => `${k.toUpperCase()}${Math.round(allRar[k] / (trials * KEPT_TOTAL) * 100)}%`).join(" ");
    console.log(`${d.name}（推奨Lv${d.level}）到着時: 累計周回 中央値${runs[Math.floor(trials / 2)]}周`);
    console.log(`   使う装備${KEPT_TOTAL}個の内訳: ${mix}`);
    console.log(`   代表値（下から1/3の装備）: ${dist}`);
  }
}

module.exports = { simulate, typical };

// 課金経済の再計算（設計書レビューRV-07、docs/production-plan.md §5.4）:
//   1) 進行帯・モード別の強化石の収入（想定プレイヤーで実際に周回させる。踏破率・1周の時間・1周の強化石）
//   2) 天井込みの装備強化の消費分布（LR +0→+99 を強化を繰り返して数える）
//   3) 1日のログイン回数・4チームの自動周回・全滅による停止を入れた、1日の強化石の収入
//   4) 無課金／月パス／追加購入ごとの、LR 1個を+99にするまでの日数（中央値とばらつき）
// 実行: node tools/economy.js [--quick]（--quick は試行回数を減らした確認用。結果は docs/production-plan.md §5.4）
//
// 前提（数値は下の ASSUME にまとめる）:
// - 周回するパーティは難易度の基準と同じ「想定プレイヤー」（初期パーティ構成＋適正装備＋素直なスキル振り。tools/lib/difficulty.js）
// - 4チームとも同じダンジョン・モードを周回する。ログインのたびに4チームとも自動周回x50を始め、次のログインまで放置する
// - 1回の放置で進むのは、8時間（オフライン進行の上限）と次のログインまでの短い方。全滅したチームはそこで止まる
// - 強化石は自動分解の分だけ数える（N・R・SRを分解し、UR・LRは手元に残す）。装備のオプション効果「パーティの強化石」は入れない
// - 道中イベントは宝箱だけ入れる（泉・罠・石碑は踏破率への影響が小さいため省略。tools/lib/sim.js と同じ）
// - 強化する LR 装備はすでに持っている前提（LRの入手にかかる日数は含めない）
// - 確定強化石は「強化石の期待消費 ÷ 必要個数」が大きい段から使う（いちばん得をする使い方）
"use strict";
const { data, makeMember, makeEnv, STARTER_PARTY } = require("./lib/sim.js");
const { benchmark, modeBenchmark } = require("./lib/difficulty.js");
const rngLib = require("../js/core/rng.js");
const battleCore = require("../js/core/battle.js");
const rewards = require("../js/core/rewards.js");
const enhance = require("../js/core/enhance.js");

const QUICK = process.argv.includes("--quick");
const ASSUME = {
  runSamples: QUICK ? 150 : 600, // ダンジョン・モードごとに試す周回数
  enhanceTrials: QUICK ? 300 : 2000, // LR +0→+99 を試す回数
  dayTrials: QUICK ? 200 : 1000, // 日数を試す回数
  teams: 4,
  repeatTarget: 50, // 自動周回の最大回数（x50）
  offlineMaxHours: 8,
  timing: { perGap: 2, overhead: 2 }, // js/model/run.js の OFFLINE_TIMING と同じ（戦闘間2秒・出発〜踏破2秒）
  battleMaxSeconds: 300,
  disassemble: new Set(["n", "r", "sr"]),
  freeStonesPerMonth: 15, // 確定強化石の無料配布（§5.3 の月10〜20個の中間）
  passStonesPerMonth: 30, // 月パス（毎日1個×30日）
  purchaseStones: 70, // 追加購入の例: 1万円ぶん（1個140円前後）
  logins: [1, 3, 5],
};

// ---------- 1) 1周の結果（踏破・所要時間・強化石） ----------
function simulateRun(dungeon, party, env, rng, level) {
  for (const c of party) { const s = env.stats(c); c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true; c.atb = 0; }
  const opts = { regionLevel: dungeon.baseLevel || dungeon.level, mode: dungeon.mode };
  const rollOne = () => data.rollItemDrop(dungeon.level, undefined, opts);
  const rollRareOne = (e) => data.rollSpecialDrop(dungeon.level, e, opts);
  let seconds = ASSUME.timing.overhead;
  const drops = [];
  for (let b = 0; b < dungeon.battles; b++) {
    const enemies = data.buildEncounter(dungeon, b);
    const battle = { enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })) };
    for (const c of party) if (c.alive) c.atb = rng.float(0, 25);
    const r = battleCore.simulate(battle, party, env, { maxSeconds: ASSUME.battleMaxSeconds });
    seconds += r.seconds;
    if (r.result !== "victory") return { cleared: false, seconds, stones: 0 };
    drops.push(...rewards.rollBattleDrops(data.REWARD_RULES, rollOne, rng));
    drops.push(...rewards.rollRareDrops(enemies, rollRareOne));
    if (b < dungeon.battles - 1) {
      seconds += ASSUME.timing.perGap;
      if (rewards.rollEventKind(data.REWARD_RULES, rng) === "treasure") {
        const item = rewards.rollTreasure(data.REWARD_RULES, rollOne, rng);
        if (item) drops.push(item);
      }
    }
  }
  const stones = rewards.settleDrops(drops, { enabled: true, rarities: ASSUME.disassemble }).materialGained;
  return { cleared: true, seconds, stones };
}

// そのダンジョン・モードの周回結果をまとめて作る（日数の計算で、ここから無作為に引く）
// over: { level, gearFrom } … 想定より強いパーティで周回する（レベルと、適正装備をどのダンジョンのものにするか）
function runPool(d, mode, seed, over) {
  const md = data.getModeDungeon(d.id, mode);
  const level = over ? over.level : Math.min(100, md.level);
  const opts = over ? benchmark(over.gearFrom) : mode === "normal" ? benchmark(d) : Object.assign({ mode }, modeBenchmark(md.level));
  rngLib.setSharedSeed(seed);
  const rng = rngLib.shared;
  const env = makeEnv(rng);
  const party = STARTER_PARTY.map((spec, i) => makeMember(spec, level, i, opts));
  const runs = [];
  for (let i = 0; i < ASSUME.runSamples; i++) runs.push(simulateRun(md, party, env, rng, level));
  rngLib.setSharedSeed(undefined);
  const cleared = runs.filter((r) => r.cleared);
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  return {
    dungeon: md, runs,
    clearRate: cleared.length / runs.length,
    avgSeconds: sum(runs, (r) => r.seconds) / runs.length,
    stonesPerClear: cleared.length ? sum(cleared, (r) => r.stones) / cleared.length : 0,
    stonesPerHour: sum(runs, (r) => r.stones) / (sum(runs, (r) => r.seconds) / 3600),
  };
}

// ---------- 2) 天井込みの強化の消費 ----------
// 1回分の LR +0→+99 の、段ごとに使った強化石
function enhanceOnce(rng, rarity) {
  const item = { rarity, plus: 0, pity: 0 };
  const steps = [];
  while (item.plus < data.ENHANCE_MAX_PLUS) {
    let spent = 0;
    for (;;) {
      const r = enhance.attempt(data.ENHANCE_RULES, item, { rng, pityEnabled: true });
      spent += r.cost;
      item.pity = r.pity;
      if (r.success) { item.plus = r.plus; break; }
    }
    steps.push(spent);
  }
  return steps;
}
const quantile = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };

// ---------- 3) 1日の強化石 ----------
// 1回の放置（hours 時間）で4チームが稼ぐ強化石。チームごとに、x50・時間・全滅のどれかで止まる
function windowIncome(pool, hours, rng) {
  const budget = Math.min(hours, ASSUME.offlineMaxHours) * 3600;
  let stones = 0;
  for (let t = 0; t < ASSUME.teams; t++) {
    let left = budget;
    for (let i = 0; i < ASSUME.repeatTarget; i++) {
      const r = pool.runs[rng.int(pool.runs.length)];
      if (r.seconds > left) break; // 時間内に終わらなかった周は数えない
      left -= r.seconds;
      if (!r.cleared) break; // 全滅したら自動周回が止まる
      stones += r.stones;
    }
  }
  return stones;
}

// ---------- 4) +99までの日数 ----------
// 確定強化石 g 個を、得をする段から使った時に、強化石で上げる必要が残る段の消費の合計
function remainingCost(steps, order, required, g) {
  let total = 0;
  for (const s of steps) total += s;
  let left = g;
  for (const i of order) {
    if (required[i] > left) continue;
    left -= required[i];
    total -= steps[i];
  }
  return total;
}
function daysToFinish(pool, logins, gsPerDay, gsAtStart, rng, stepSamples, order, required) {
  const steps = stepSamples[rng.int(stepSamples.length)];
  const hours = 24 / logins;
  let stones = 0;
  for (let day = 1; day <= 3650; day++) {
    for (let k = 0; k < logins; k++) stones += windowIncome(pool, hours, rng);
    const g = Math.floor(gsAtStart + gsPerDay * day);
    if (stones >= remainingCost(steps, order, required, g)) return day;
  }
  return Infinity;
}

// ---------- 実行 ----------
function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
function main() {
  // 進行帯: 各地方の最後のダンジョン（ノーマル）と、最後のダンジョンのハード・エクストラ
  const lastOfRegion = data.REGIONS.map((r) => data.DUNGEONS.filter((d) => d.region === r.id).slice(-1)[0]);
  const final = data.DUNGEONS[data.DUNGEONS.length - 1];
  const targets = lastOfRegion.map((d) => [d, "normal"]).concat([[final, "hard"], [final, "extra"]]);
  // 余裕を持った周回: Lv100・最後のダンジョンの適正装備のパーティで、ひとつ前の地方の最後のダンジョンを回る
  const farm = lastOfRegion[lastOfRegion.length - 2];
  const farmOver = { level: 100, gearFrom: final };

  console.log("## 1) 進行帯・モード別の強化石の収入（想定プレイヤー、N・R・SRを自動分解）");
  console.log("| ダンジョン | 推奨Lv | モード | 踏破率 | 1周の時間 | 1周の強化石（踏破時） | 1時間あたり |");
  console.log("|---|---:|---|---:|---:|---:|---:|");
  const pools = {};
  targets.forEach(([d, mode], i) => {
    const p = runPool(d, mode, 9000 + i);
    pools[`${d.id}:${mode}`] = p;
    const modeName = { normal: "ノーマル", hard: "ハード", extra: "エクストラ" }[mode];
    console.log(`| ${d.name} | ${p.dungeon.level} | ${modeName} | ${Math.round(p.clearRate * 100)}% | ${Math.round(p.avgSeconds)}秒 | ${fmt(p.stonesPerClear)} | ${fmt(p.stonesPerHour)} |`);
  });
  {
    const p = runPool(farm, "normal", 9100, farmOver);
    pools.farm = p;
    p.label = `${farm.name}（Lv100・${final.name}の適正装備で余裕を持って周回）`;
    console.log(`| ${p.label} | ${p.dungeon.level} | ノーマル | ${Math.round(p.clearRate * 100)}% | ${Math.round(p.avgSeconds)}秒 | ${fmt(p.stonesPerClear)} | ${fmt(p.stonesPerHour)} |`);
  }

  console.log("\n## 2) LR +0→+99 の強化石（天井あり）");
  const rng = rngLib.createRng(777);
  const stepSamples = [];
  for (let t = 0; t < ASSUME.enhanceTrials; t++) stepSamples.push(enhanceOnce(rng, "lr"));
  const totals = stepSamples.map((s) => s.reduce((a, b) => a + b, 0));
  const noPity = Array.from({ length: 99 }, (_, p) => enhance.expectedCost(data.ENHANCE_RULES, "lr", p)).reduce((a, b) => a + b, 0);
  console.log(`- 天井なしの期待消費（cost/rate の合計）: ${fmt(noPity)}`);
  console.log(`- 天井あり: 平均 ${fmt(totals.reduce((a, b) => a + b, 0) / totals.length)}、中央値 ${fmt(quantile(totals, 0.5))}、10% ${fmt(quantile(totals, 0.1))}、90% ${fmt(quantile(totals, 0.9))}`);
  const required = Array.from({ length: 99 }, (_, p) => enhance.guaranteedRequired(data.ENHANCE_RULES, "lr", p));
  const meanStep = required.map((_, i) => stepSamples.reduce((s, x) => s + x[i], 0) / stepSamples.length);
  const order = required.map((_, i) => i).sort((a, b) => meanStep[b] / required[b] - meanStep[a] / required[a]);
  console.log(`- 確定強化石だけで+99にする個数: ${required.reduce((a, b) => a + b, 0)}`);

  console.log("\n## 3) 1日の強化石（4チームが自動周回x50、全滅で停止、1回の放置は最大8時間）");
  console.log("| ダンジョン・モード | " + ASSUME.logins.map((l) => `1日${l}回`).join(" | ") + " |");
  console.log("|---|" + ASSUME.logins.map(() => "---:").join("|") + "|");
  for (const [key, p] of Object.entries(pools)) {
    const cells = ASSUME.logins.map((l) => {
      const r = rngLib.createRng(31 + l);
      const days = [];
      for (let t = 0; t < 200; t++) { let s = 0; for (let k = 0; k < l; k++) s += windowIncome(p, 24 / l, r); days.push(s); }
      return fmt(quantile(days, 0.5));
    });
    const modeName = { normal: "", hard: "（ハード）", extra: "（エクストラ）" }[p.dungeon.mode || "normal"];
    console.log(`| ${p.label || p.dungeon.name + modeName} | ${cells.join(" | ")} |`);
  }

  console.log("\n## 4) LR 1個を+99にするまでの日数（中央値〔10%〜90%〕）");
  const scenarios = [
    ["無課金（無料配布 月15個）", ASSUME.freeStonesPerMonth / 30, 0],
    ["月パス（＋月30個）", (ASSUME.freeStonesPerMonth + ASSUME.passStonesPerMonth) / 30, 0],
    [`追加購入（最初に${ASSUME.purchaseStones}個＋無料配布）`, ASSUME.freeStonesPerMonth / 30, ASSUME.purchaseStones],
    [`月パス＋追加購入`, (ASSUME.freeStonesPerMonth + ASSUME.passStonesPerMonth) / 30, ASSUME.purchaseStones],
  ];
  for (const key of ["farm", `${final.id}:normal`, `${final.id}:hard`, `${final.id}:extra`]) {
    const p = pools[key];
    const modeName = { normal: "ノーマル", hard: "ハード", extra: "エクストラ" }[p.dungeon.mode || "normal"];
    console.log(`\n### ${p.label || `${final.name}（${modeName}・想定プレイヤー）`}`);
    console.log("| プレイヤー | " + ASSUME.logins.map((l) => `1日${l}回`).join(" | ") + " |");
    console.log("|---|" + ASSUME.logins.map(() => "---").join("|") + "|");
    for (const [name, perDay, atStart] of scenarios) {
      const cells = ASSUME.logins.map((l) => {
        const r = rngLib.createRng(100 + l);
        const days = [];
        for (let t = 0; t < ASSUME.dayTrials; t++) days.push(daysToFinish(p, l, perDay, atStart, r, stepSamples, order, required));
        return `${quantile(days, 0.5)}日〔${quantile(days, 0.1)}〜${quantile(days, 0.9)}〕`;
      });
      console.log(`| ${name} | ${cells.join(" | ")} |`);
    }
  }
}

if (require.main === module) main();
module.exports = { ASSUME, runPool, enhanceOnce, windowIncome, daysToFinish };

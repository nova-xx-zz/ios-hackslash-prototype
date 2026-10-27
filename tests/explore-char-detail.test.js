"use strict";
// 探索画面の仲間カードからキャラ詳細を開き、もどるで探索画面へ帰る。‹ › は表示中のパーティの仲間だけを回る
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const slice = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${from} が見つかる`);
  return source.slice(start, end);
};

function loadDetail(roster) {
  const source = read("js/ui/detail.js");
  const calls = [];
  const context = vm.createContext({
    S: { roster, activeTeam: 1 },
    TEAM_COUNT: 4, TEAM_LABELS: ["I", "II", "III", "IV"],
    document: { getElementById: () => ({ scrollTop: 0 }) },
    teamMembers: (t) => roster.filter((c) => c.team === t),
    renderCharDetail: () => calls.push("render"),
    renderJobsScreen: () => calls.push("jobs"),
    openExploreHub: () => calls.push("explore"),
    showScreen: (id) => calls.push("show:" + id),
    detailCharId: null, detailTab: "stats", fusionSelection: null, fusionConfirm: false,
    fusionMessage: "", treeSelectedNode: null, treeSwapConfirm: null, openSlot: null,
  });
  const code = slice(source, "let detailReturnScreen", "\ndocument.getElementById(\"btnDetailPrev\")");
  // トップレベルの let は vm の外から見えないので、確認用の読み出し口を足す
  vm.runInContext(code + "\nthis.peek = () => ({ detailReturnScreen, detailCharId, detailNavContext });", context);
  return { context, calls };
}

const roster = [
  { id: "a", team: 0 }, { id: "b", team: 1 }, { id: "c", team: 1 }, { id: "d", team: null },
];

test("探索画面から開くと、もどるで探索画面へ帰り、‹ › は表示中のパーティだけを回る", () => {
  const { context, calls } = loadDetail(roster);
  context.openCharDetail(roster[1], { returnScreen: "screen-battle" });
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["b", "c"]);
  context.closeCharDetail();
  assert.ok(calls.includes("explore"));
  assert.ok(!calls.includes("show:screen-jobs"));
  assert.equal(context.peek().detailReturnScreen, "screen-jobs", "戻った後は既定に戻す");
});

test("編成画面から開いた時は、従来どおり全パーティ＋控えを回り、編成画面へ帰る", () => {
  const { context, calls } = loadDetail(roster);
  context.openCharDetail(roster[1]);
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["a", "b", "c", "d"]);
  context.closeCharDetail();
  assert.ok(calls.includes("show:screen-jobs"));
  assert.ok(!calls.includes("explore"));
});

test("探索画面の仲間カードはボタンで、タップで探索画面に戻る形のキャラ詳細を開く", () => {
  const dock = read("js/ui/dock.js");
  const build = slice(dock, "function buildPartyDock()", "\nfunction renderDock()");
  assert.match(build, /createElement\("button"\)/);
  assert.match(build, /openDockCharDetail\(c\.id\)/);
  assert.match(build, /openCharDetail\(c, \{ returnScreen: "screen-battle" \}\)/);
  assert.match(read("js/ui/inventory.js"), /btnDetailBack"\)\.addEventListener\("click", \(\) => closeCharDetail\(\)\)/);
});


test("未編成グループから開くと、コウモリの次はセイレーンで他の控えに飛ばない", () => {
  const characters = [
    { id: "a", name: "控えA", team: null, group: null },
    { id: "s", name: "スライム", team: null, group: "S", isMonster: true },
    { id: "bat", name: "コウモリ", team: null, group: "S", isMonster: true },
    { id: "b", name: "控えB", team: null, group: null },
    { id: "siren", name: "セイレーン", team: null, group: "S", isMonster: true },
  ];
  const { context, calls } = loadDetail(characters);
  context.openCharDetail(characters[2], { orderIds: ["s", "bat", "siren"], orderLabel: "モンスターS" });
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["s", "bat", "siren"]);
  assert.equal(context.detailPagerInfo(characters[2]).pos, "モンスターS・2/3");
  context.switchDetail(1);
  assert.equal(context.peek().detailCharId, "siren");
  assert.equal(context.detailPagerInfo(characters[4]).pos, "モンスターS・3/3");
  context.switchDetail(1);
  assert.equal(context.peek().detailCharId, "s", "最後から先頭へループする");
  context.switchDetail(-1);
  assert.equal(context.peek().detailCharId, "siren", "前送りもグループ内でループする");
  assert.ok(calls.includes("render"));
});

test("詳細画面を別の行から開き直すと前のグループの並びが残らない", () => {
  const characters = [
    { id: "a", team: 0 }, { id: "s", team: null, group: "S" },
    { id: "bat", team: null, group: "S" }, { id: "siren", team: null, group: "S" },
    { id: "bench", team: null, group: null },
  ];
  const { context } = loadDetail(characters);
  context.openCharDetail(characters[2], { orderIds: ["s", "bat", "siren"], orderLabel: "モンスターS" });
  context.closeCharDetail();
  assert.equal(context.peek().detailNavContext, null);
  context.openCharDetail(characters[4], { orderIds: ["bench"], orderLabel: "控え（人間）" });
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["bench"]);
  assert.equal(context.detailPagerInfo(characters[4]).canSwitch, false);
  context.openCharDetail(characters[0]);
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["a", "s", "bat", "siren", "bench"], "情報なしの従来呼び出しにも対応");
});

test("控えを絞り込み・並べ替えて開いた場合も画面の表示順を維持する", () => {
  const characters = [
    { id: "a", name: "控えA", team: null },
    { id: "b", name: "控えB", team: null },
    { id: "c", name: "控えC", team: null },
  ];
  const { context } = loadDetail(characters);
  context.openCharDetail(characters[1], { orderIds: ["c", "b"], orderLabel: "控え（モンスター）" });
  assert.deepEqual([...context.detailOrder()].map((c) => c.id), ["c", "b"]);
  assert.equal(context.detailPagerInfo(characters[1]).pos, "控え（モンスター）・2/2");
  context.switchDetail(1);
  assert.equal(context.peek().detailCharId, "c");
});

test("詳細画面: モンスターの見出しは名前・個体ランク・Lvのみ、人間は従来表記", () => {
  const Stats = require("../js/core/stats.js");
  const code = slice(read("js/ui/detail-tabs.js"), "function buildStatsTab(c)", "\n// 特殊職の解放の条件の文");
  const getStats = (c) => {
    const created = [];
    class Element {
      constructor() { this.className = ""; this.innerHTML = ""; this.textContent = ""; this.children = []; }
      appendChild(el) { this.children.push(el); return el; }
      addEventListener() {}
    }
    const context = vm.createContext({
      document: { createElement: () => { const el = new Element(); created.push(el); return el; } },
      RACES: { kraken: { name: "クラーケン族", desc: "海の魔物" }, human: { name: "ヒト", desc: "人間" } },
      QPCore: { stats: { ivRank: Stats.ivRank } },
      computeStats: () => ({ maxHp: 37, maxMp: 3, atk: 15, mag: 1, def: 9, spd: 3.8 }),
      escapeHtml: (v) => v, jobDef: (c) => ({ name: c.isMonster ? "クラーケンの落とし子" : "せんし" }),
      TEAM_LABELS: ["I", "II", "III", "IV"], MAX_ACTIVE: 5,
      teamMembers: () => [], isTeamLocked: () => false, clampVitals: () => {},
      renderCharDetail: () => {}, JOBS: { warrior: {} },
    });
    vm.runInContext(code, context);
    return context.buildStatsTab(c);
  };
  const ivs = Object.fromEntries(Stats.IV_KEYS.map((key) => [key, .97]));
  const monster = getStats({
    id: "m1", name: "クラーケンの落とし子", race: "kraken", isMonster: true,
    team: null, level: 1, ivs, favorite: false,
  });
  assert.match(monster.innerHTML, /<div class="cname">クラーケンの落とし子 <span class="iv-rank iv-C" title="個体値の評価">個体C<\/span> Lv\.1<\/div>/);
  assert.doesNotMatch(monster.innerHTML.split("</div>")[0], /テイム|クラーケン族|—|・/);
  assert.match(monster.innerHTML, /<div class="sub-ability-row">海の魔物<\/div>/, "説明文は残す");
  const old = getStats({ id: "m2", name: "旧個体", race: "kraken", isMonster: true, team: null, level: 5 });
  assert.match(old.innerHTML, /<div class="cname">旧個体 Lv\.5<\/div>/, "ランクのない旧モンスターには個体表示を付けない");
  const human = getStats({ id: "h1", name: "アレン", race: "human", job: "warrior", isMonster: false, team: null, level: 3 });
  assert.match(human.innerHTML, /<div class="cname">アレン — ヒト・せんし Lv\.3<\/div>/, "人間の名前欄は変更しない");
});

test("詳細画面: キャラ送りのヘッダーもモンスターのテイム表記だけを削除", () => {
  const monsters = [{ id: "m", name: "クラーケンの落とし子", isMonster: true, team: null }];
  const x = loadDetail(monsters);
  x.context.openCharDetail(monsters[0], { orderIds: ["m"], orderLabel: "控え（モンスター）" });
  assert.equal(x.context.detailPagerInfo(monsters[0]).name, "クラーケンの落とし子");
  assert.equal(x.context.detailPagerInfo(monsters[0]).pos, "控え（モンスター）・1/1");
});

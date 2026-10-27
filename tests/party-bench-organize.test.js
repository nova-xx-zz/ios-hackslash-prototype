"use strict";
// パーティ編成: 控えを人間／モンスターに分け、ジョブ・種族・★で絞り込み、並び替える（2026-10-24 フィードバック#3・#5）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RosterOrganize = require("../js/core/roster-organize.js");
const Stats = require("../js/core/stats.js");

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.textContent = ""; this.className = "";
    this.dataset = {}; this.style = {}; this.listeners = {}; this.attrs = {}; this.value = ""; this._html = "";
  }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(e) { this.children.push(e); return e; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector() { const e = new Element("span"); this.children.push(e); return e; }
  click() { this.listeners.click?.({ stopPropagation() {} }); }
  change(v) { this.value = v; this.listeners.change?.({ target: this }); }
}
const all = (n) => { const out = []; const visit = (x) => { for (const c of x.children) { out.push(c); visit(c); } }; visit(n); return out; };

function setup(roster) {
  const ids = {};
  const document = {
    getElementById: (id) => ids[id] || (ids[id] = new Element()),
    createElement: (t) => new Element(t),
    createDocumentFragment: () => new Element("fragment"),
    addEventListener: () => {},
  };
  const S = { roster, groups: [], activeTeam: 0 };
  const opened = [];
  const windowHandlers = {};
  const window = {
    addEventListener: (name, fn) => { windowHandlers[name] = fn; },
    removeEventListener: (name) => { delete windowHandlers[name]; },
  };
  const ctx = vm.createContext({
    document, S, window,
    TEAM_LABELS: ["I", "II", "III", "IV"], TEAM_NAMES: ["第一", "第二", "第三", "第四"], MAX_ACTIVE: 5,
    teamMembers: (i) => roster.filter((c) => c.team === i), isTeamLocked: () => false,
    QPModel: { save: { GROUP_MAX: 8, GROUP_NAME_MAX: 12 } }, Shop: { rosterCapacity: () => 100 },
    scheduleSave: () => {}, RACES: { human: { name: "ヒト" }, slime: { name: "スライム" }, wolf: { name: "オオカミ" } },
    jobDef: (c) => ({ name: c.isMonster ? { slime: "スライム", wolf: "オオカミ" }[c.race] : { warrior: "せんし", mage: "まほう" }[c.job] }),
    jobInsignia: () => "", escapeHtml: (s) => s,
    QPCore: { stats: { ivRank: Stats.ivRank }, rosterOrganize: RosterOrganize },
    openCreateScreen: () => {}, openCharDetail: (c, opts) => opened.push({ c, opts }), clampVitals: () => {},
    armConfirm: () => {}, confirmReady: () => true, setTimeout, clearTimeout,
  });
  for (const f of ["../js/ui/list-controls.js", "../js/ui/party.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
  }
  const body = document.getElementById("rosterBody");
  const heads = () => all(body).filter((e) => e.className === "party-row-head");
  const headName = (h) => h.children.find((c) => c.tagName === "span").textContent;
  const headMeta = (h) => h.children.find((c) => c.className === "pmeta").textContent;
  const benchStrips = () => all(body).filter((e) => e.className === "member-strip grid" && e.dataset.drop === "bench");
  const cardNames = (strip) => strip.children.filter((c) => c.className.startsWith("member-card") && !c.className.includes("empty"))
    .map((c) => c.title);
  return { ctx, body, heads, headName, headMeta, benchStrips, cardNames, opened, windowHandlers, render: () => ctx.renderJobsScreen() };
}

const roster = () => [
  { id: "c1", name: "アレン", job: "warrior", race: "human", level: 8, team: 0, equip: {} },
  { id: "c2", name: "ミナ", job: "mage", race: "human", level: 12, team: null, equip: {}, favorite: true },
  { id: "c3", name: "スラ", race: "slime", isMonster: true, level: 4, team: null, equip: {} },
  { id: "c4", name: "ゴウ", job: "warrior", race: "human", level: 3, team: null, equip: {} },
  { id: "c5", name: "ウル", race: "wolf", isMonster: true, level: 9, team: null, equip: {} },
];

test("控え: 人間とモンスターが別の行に並び、どちらも控えへのドロップ先になる", () => {
  const x = setup(roster());
  x.render();
  const names = x.heads().map(x.headName);
  assert.ok(names.includes("控え（人間）") && names.includes("控え（モンスター）"));
  const [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(humans), ["ヒト・まほう", "ヒト・せんし"]);
  assert.deepEqual(x.cardNames(monsters), ["スライム・スライム", "オオカミ・オオカミ"]);
  // 人間の行には仲間を呼ぶ「＋」があり、モンスターの行には無い
  assert.ok(humans.children.some((c) => c.className.includes("empty")));
  assert.ok(!monsters.children.some((c) => c.className.includes("empty")));
});

test("控え: ジョブ・種族と★で絞り込み、件数は「表示/全体」で示す。並び順も変えられる", () => {
  const x = setup(roster());
  x.render();
  const selects = () => all(x.body).filter((e) => e.tagName === "select");
  selects()[0].change("j:warrior");
  let [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(humans), ["ヒト・せんし"]);
  assert.deepEqual(x.cardNames(monsters), []);
  const metas = x.heads().filter((h) => x.headName(h).startsWith("控え")).map(x.headMeta);
  assert.deepEqual(metas, ["1/2人", "0/2人"]);
  selects()[0].change("all");
  selects()[1].change("level");
  [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(monsters), ["オオカミ・オオカミ", "スライム・スライム"]);
  const fav = all(x.body).find((e) => e.tagName === "button" && e.textContent === "★のみ");
  fav.click();
  [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(humans), ["ヒト・まほう"]);
  assert.deepEqual(x.cardNames(monsters), []);
});

test("控えが1人以下なら絞り込みバーは出さない", () => {
  const x = setup(roster().slice(0, 2));
  x.render();
  assert.equal(all(x.body).some((e) => e.className === "list-filter-bar"), false);
});

test("モンスターの個体値S〜Dで名前色のクラスが切り替わり、人間・旧データは着色しない", () => {
  const x = setup(roster());
  const ranks = [
    ["S", 1.05], ["A", 1.02], ["B", 1], ["C", 0.98], ["D", 0.95],
  ];
  for (const [rank, value] of ranks) {
    const ivs = Object.fromEntries(Stats.IV_KEYS.map((k) => [k, value]));
    const card = x.ctx.buildMemberCard({
      id: "m-" + rank, race: "slime", isMonster: true, name: "スライム", level: 1, ivs,
    });
    assert.equal(card.className, "member-card monster iv-" + rank);
    assert.ok(card.innerHTML.includes("class=\"mname\""), "名前の要素は維持する");
    assert.ok(card.innerHTML.includes("スライム " + rank), "種族横の評価表記も維持する");
    assert.ok(card.title.includes("個体値" + rank), "省略された名前でもランクを確認できる");
  }
  const legacy = x.ctx.buildMemberCard({ race: "slime", isMonster: true, name: "旧スライム", level: 1 });
  assert.equal(legacy.className, "member-card monster", "個体値のない既存モンスターは従来色");
  const human = x.ctx.buildMemberCard({
    race: "human", job: "warrior", name: "ヒト", level: 1,
    ivs: Object.fromEntries(Stats.IV_KEYS.map((k) => [k, 1.05])),
  });
  assert.equal(human.className, "member-card", "人間は個体値による着色をしない");
});

test("編成カードのランク色は詳細画面のランク色と一致する", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  for (const rank of ["S", "A", "B", "C", "D"]) {
    const rankRule = css.match(new RegExp("\\.iv-rank\\.iv-" + rank + " \\{ color: ([^;]+); \\}"));
    const cardRule = css.match(new RegExp("\\.member-card\\.monster\\.iv-" + rank + " \\.mname \\{ color: ([^;]+);"));
    assert.ok(rankRule && cardRule, rank + " の詳細画面と編成カードのCSSが存在する");
    assert.equal(cardRule[1], rankRule[1], rank + " の配色が一致する");
  }
});


test("控えの個体値フィルターはS〜D・未評価を選べ、人間を除外し件数も更新する", () => {
  const ranks = [["S", 1.05], ["A", 1.02], ["B", 1], ["C", 0.98], ["D", 0.95]];
  const ivs = (v) => Object.fromEntries(Stats.IV_KEYS.map((k) => [k, v]));
  const characters = [
    { id: "c1", name: "アレン", job: "warrior", race: "human", level: 3, team: null },
    ...ranks.map(([rank, value], i) => ({
      id: "c" + (i + 2), name: rank + "個体", race: "slime", isMonster: true,
      level: i + 1, team: null, ivs: ivs(value), favorite: rank === "S",
    })),
    { id: "c7", name: "旧個体", race: "slime", isMonster: true, level: 1, team: null },
  ];
  const x = setup(characters);
  x.render();
  const selects = () => all(x.body).filter((e) => e.tagName === "select");
  assert.equal(selects().length, 3, "ジョブ・種族、並び順、モンスター個体値");
  for (const [rank] of ranks) {
    selects()[2].change(rank);
    const [humans, monsters] = x.benchStrips();
    assert.deepEqual(x.cardNames(humans), [], "ランク指定中は人間を表示しない");
    assert.deepEqual(x.cardNames(monsters), ["スライム・スライム・個体値" + rank]);
    const heads = x.heads().filter((h) => x.headName(h).startsWith("控え"));
    assert.deepEqual(heads.map(x.headMeta), ["0/1人", "1/6人"]);
  }
  selects()[2].change("unrated");
  assert.deepEqual(x.cardNames(x.benchStrips()[1]), ["スライム・スライム"]);
  selects()[2].change("S");
  const fav = all(x.body).find((e) => e.tagName === "button" && e.textContent === "★のみ");
  fav.click();
  assert.deepEqual(x.cardNames(x.benchStrips()[1]), ["スライム・スライム・個体値S"]);
  selects()[0].change("j:warrior");
  assert.deepEqual(x.cardNames(x.benchStrips()[0]), [], "人間の職を選ぶと個体値条件を解除（★のみは維持）");
  const ivSelect = selects()[2];
  assert.equal(ivSelect.value, "all");
  assert.equal(all(x.body).some((e) => e.tagName === "button" && e.textContent === "★のみ"), true);
});

test("控えにモンスターがいない場合は個体値プルダウンを出さない", () => {
  const x = setup(roster().filter((c) => !c.isMonster));
  x.render();
  assert.equal(all(x.body).filter((e) => e.tagName === "select").length, 2);
});


test("未編成グループのカードからは同じグループの表示順と名前を詳細へ渡す", () => {
  const characters = [
    { id: "c1", name: "控え", race: "human", job: "warrior", team: null, group: null, level: 1 },
    { id: "c2", name: "コウモリ", race: "slime", isMonster: true, team: null, group: "g1", level: 1 },
    { id: "c3", name: "他の控え", race: "wolf", isMonster: true, team: null, group: null, level: 1 },
    { id: "c4", name: "セイレーン", race: "wolf", isMonster: true, team: null, group: "g1", level: 1 },
  ];
  const x = setup(characters);
  x.ctx.S.groups.push({ id: "g1", name: "モンスターS" });
  // group g1 は初期状態では折りたたみ。グループ見出しを開いてカードを描画する。
  x.render();
  const groupHead = x.heads().find((h) => x.headName(h) === "モンスターS");
  assert.ok(groupHead);
  groupHead.click();
  const strip = all(x.body).find((el) => el.className === "member-strip grid" && el.dataset.drop === "g:g1");
  assert.ok(strip);
  assert.equal(strip.children.length, 2);
  strip.children[0].listeners.click({ detail: 0 });
  assert.equal(x.opened[0].c.id, "c2");
  assert.deepEqual(Array.from(x.opened[0].opts.orderIds), ["c2", "c4"]);
  assert.equal(x.opened[0].opts.orderLabel, "モンスターS");
  // iPhone Safari のポインター操作でも同じオプションを渡す。
  strip.children[0].listeners.pointerdown({ pointerType: "touch", clientX: 5, clientY: 5 });
  x.windowHandlers.pointerup({ type: "pointerup" });
  assert.equal(x.opened[1].c.id, "c2");
  assert.deepEqual(Array.from(x.opened[1].opts.orderIds), ["c2", "c4"]);
});

test("控えのカードはフィルター適用後の表示順だけを詳細送りの対象にする", () => {
  const characters = [
    { id: "c1", name: "人間", job: "warrior", race: "human", team: null, level: 1 },
    { id: "c2", name: "モンスターA", race: "slime", isMonster: true, team: null, level: 4 },
    { id: "c3", name: "モンスターB", race: "wolf", isMonster: true, team: null, level: 9 },
  ];
  const x = setup(characters);
  x.render();
  const select = all(x.body).filter((el) => el.tagName === "select");
  select[1].change("level");
  const monsterStrip = x.benchStrips()[1];
  monsterStrip.children[0].listeners.click({ detail: 0 });
  assert.equal(x.opened[0].c.id, "c3");
  assert.deepEqual(Array.from(x.opened[0].opts.orderIds), ["c3", "c2"]);
  assert.equal(x.opened[0].opts.orderLabel, "控え（モンスター）");
});

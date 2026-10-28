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
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  get classList() {
    const el = this;
    return {
      toggle(name, force) {
        const names = new Set(el.className.split(/\s+/).filter(Boolean));
        const add = force === undefined ? !names.has(name) : !!force;
        if (add) names.add(name); else names.delete(name);
        el.className = [...names].join(" ");
        return add;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
      contains(name) { return el.className.split(/\s+/).includes(name); },
    };
  }
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
  const controls = () => document.getElementById("jobsFilterControls");
  const icon = () => document.getElementById("btnJobsFilter");
  const groupButton = () => document.getElementById("btnJobsNewGroup");
  const popover = () => document.getElementById("jobsFilterPopover");
  return { ctx, body, heads, headName, headMeta, benchStrips, cardNames, opened, windowHandlers,
    controls, icon, groupButton, popover, elements: ids, render: () => ctx.renderJobsScreen() };
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
  assert.deepEqual(x.cardNames(monsters), ["スラ Lv.4", "ウル Lv.9"]);
  // 人間の行には仲間を呼ぶ「＋」があり、モンスターの行には無い
  assert.ok(humans.children.some((c) => c.className.includes("empty")));
  assert.ok(!monsters.children.some((c) => c.className.includes("empty")));
});

test("控え: ジョブ・種族と★で絞り込み、件数は「表示/全体」で示す。並び順も変えられる", () => {
  const x = setup(roster());
  x.render();
  const selects = () => all(x.controls()).filter((e) => e.tagName === "select");
  selects()[0].change("j:warrior");
  let [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(humans), ["ヒト・せんし"]);
  assert.deepEqual(x.cardNames(monsters), []);
  const metas = x.heads().filter((h) => x.headName(h).startsWith("控え")).map(x.headMeta);
  assert.deepEqual(metas, ["1/2人", "0/2人"]);
  selects()[0].change("all");
  selects()[1].change("level");
  [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(monsters), ["ウル Lv.9", "スラ Lv.4"]);
  const fav = all(x.controls()).find((e) => e.tagName === "button" && e.textContent === "★のみ");
  fav.click();
  [humans, monsters] = x.benchStrips();
  assert.deepEqual(x.cardNames(humans), ["ヒト・まほう"]);
  assert.deepEqual(x.cardNames(monsters), []);
});

test("控えが1人以下でも画面右上のフィルターから開け、一覧の途中には表示しない", () => {
  const x = setup(roster().slice(0, 2));
  x.render();
  assert.equal(all(x.body).some((e) => e.className === "list-filter-bar"), false);
  assert.equal(all(x.controls()).some((e) => e.className === "list-filter-bar"), true);
  x.icon().click();
  assert.equal(x.icon().attrs["aria-expanded"], "true");
  assert.equal(x.popover().attrs["aria-hidden"], "false");
  x.elements.btnJobsFilterClose.click();
  assert.equal(x.icon().attrs["aria-expanded"], "false");
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
    assert.equal(card.innerHTML.includes('class="mtitle"'), false, "モンスターカードに種族・評価の文字行は表示しない");
    assert.ok(card.innerHTML.includes('<div class="mname">スライム</div>'), "カードに名前を表示する");
    assert.ok(card.innerHTML.includes('<span>Lv.1</span>'), "カードにレベルを表示する");
    assert.equal(card.title, "スライム Lv.1", "省略された名前はツールチップから確認できる");
    assert.equal(card.attrs["aria-label"], "スライム、レベル1、個体値" + rank, "音声読み上げには評価を残す");
    assert.equal(card.innerHTML.includes(" " + rank), false, "ランク文字を描画しない");
  }
  const legacy = x.ctx.buildMemberCard({ race: "slime", isMonster: true, name: "旧スライム", level: 1 });
  assert.equal(legacy.className, "member-card monster", "個体値のない既存モンスターは従来色");
  assert.equal(legacy.innerHTML.includes('class="mtitle"'), false, "旧モンスターにも種族行を出さない");
  assert.equal(legacy.title, "旧スライム Lv.1");
  const human = x.ctx.buildMemberCard({
    race: "human", job: "warrior", name: "ヒト", level: 1,
    ivs: Object.fromEntries(Stats.IV_KEYS.map((k) => [k, 1.05])),
  });
  assert.equal(human.className, "member-card", "人間は個体値による着色をしない");
  assert.ok(human.innerHTML.includes('<div class="mtitle">ヒト</div>'), "人間の既存種族表示は維持する");
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
  const selects = () => all(x.controls()).filter((e) => e.tagName === "select");
  assert.equal(selects().length, 3, "ジョブ・種族、並び順、モンスター個体値");
  for (const [rank] of ranks) {
    selects()[2].change(rank);
    const [humans, monsters] = x.benchStrips();
    assert.deepEqual(x.cardNames(humans), [], "ランク指定中は人間を表示しない");
    assert.deepEqual(x.cardNames(monsters), [rank + "個体 Lv." + (ranks.findIndex(([r]) => r === rank) + 1)]);
    const heads = x.heads().filter((h) => x.headName(h).startsWith("控え"));
    assert.deepEqual(heads.map(x.headMeta), ["0/1人", "1/6人"]);
  }
  selects()[2].change("unrated");
  assert.deepEqual(x.cardNames(x.benchStrips()[1]), ["旧個体 Lv.1"]);
  selects()[2].change("S");
  const fav = all(x.controls()).find((e) => e.tagName === "button" && e.textContent === "★のみ");
  fav.click();
  assert.deepEqual(x.cardNames(x.benchStrips()[1]), ["S個体 Lv.1"]);
  selects()[0].change("j:warrior");
  assert.deepEqual(x.cardNames(x.benchStrips()[0]), [], "人間の職を選ぶと個体値条件を解除（★のみは維持）");
  const ivSelect = selects()[2];
  assert.equal(ivSelect.value, "all");
  assert.equal(all(x.controls()).some((e) => e.tagName === "button" && e.textContent === "★のみ"), true);
});

test("控えにモンスターがいない場合は個体値プルダウンを出さない", () => {
  const x = setup(roster().filter((c) => !c.isMonster));
  x.render();
  assert.equal(all(x.controls()).filter((e) => e.tagName === "select").length, 2);
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
  const select = all(x.controls()).filter((el) => el.tagName === "select");
  select[1].change("level");
  const monsterStrip = x.benchStrips()[1];
  monsterStrip.children[0].listeners.click({ detail: 0 });
  assert.equal(x.opened[0].c.id, "c3");
  assert.deepEqual(Array.from(x.opened[0].opts.orderIds), ["c3", "c2"]);
  assert.equal(x.opened[0].opts.orderLabel, "控え（モンスター）");
});


test("固定ヘッダーの絞り込みを開閉し、条件を保持したまま一覧スクロール位置を維持", () => {
  const x = setup(roster());
  x.render();
  assert.equal(all(x.body).some((e) => e.className === "list-filter-bar"), false);
  x.icon().click();
  assert.equal(x.icon().attrs["aria-expanded"], "true");
  const select = all(x.controls()).filter((e) => e.tagName === "select");
  x.body.scrollTop = 420;
  select[0].change("m:slime");
  assert.equal(x.body.scrollTop, 420);
  assert.ok(x.icon().className.includes("active"), "条件ありの場合は金色の適用中マークを表示");
  assert.equal(x.icon().attrs["aria-expanded"], "true", "条件変更時にパネルは閉じない");
  x.elements.btnJobsFilterClose.click();
  assert.equal(x.icon().attrs["aria-expanded"], "false");
  assert.ok(x.icon().className.includes("active"), "パネルを閉じても条件を保持");
  x.icon().click();
  x.elements.btnJobsFilterReset.click();
  assert.equal(x.body.scrollTop, 420);
  assert.ok(!x.icon().className.includes("active"));
  assert.equal(all(x.controls()).filter((e) => e.tagName === "select")[0].value, "all");
});

test("フォルダ＋ボタンが既存のグループ作成モーダルを呼び、上限到達で無効になる", () => {
  const x = setup(roster());
  x.render();
  assert.equal(all(x.body).some((e) => e.className === "group-add"), false);
  assert.equal(x.groupButton().disabled, false);
  x.icon().click();
  x.groupButton().click();
  assert.equal(x.icon().attrs["aria-expanded"], "false", "新しいグループ作成時はフィルターを閉じる");
  assert.equal(x.elements.groupModalTitle.textContent, "新しいグループ");
  assert.equal(x.elements.groupNameInput.focused, true);
  x.ctx.S.groups.push(...Array.from({ length: 8 }, (_, i) => ({ id: "g" + (i + 1), name: "G" + i })));
  x.render();
  assert.equal(x.groupButton().disabled, true);
});

test("固定操作ボタンはスクロール領域の外、フィルターは右上のパネル内に置く", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  const jobs = html.slice(html.indexOf('<section id="screen-jobs"'), html.indexOf("<!-- 所持品一覧画面 -->"));
  assert.match(jobs, /id="btnJobsFilter"/);
  assert.match(jobs, /id="btnJobsNewGroup"/);
  assert.ok(jobs.indexOf('id="btnJobsFilter"') < jobs.indexOf('id="rosterBody"'));
  assert.ok(jobs.indexOf('id="btnJobsNewGroup"') < jobs.indexOf('id="rosterBody"'));
  assert.match(css, /\.jobs-filter-popover\.hidden \{ display: none; \}/);
  assert.match(html, /js\/ui\/party\.js\?v=14/);
  assert.match(html, /css\/style\.css\?v=96/);
});


test("モンスターカードの文字だけ2px小さくし、人間と共通の名前・レベルに適用する", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.ok(css.includes(".member-card .mname {\n  font-size: 11px;"), "名前は13pxから11px");
  assert.ok(css.includes(".member-card .mstats {\n  display: flex; gap: 8px; margin-top: 6px;\n  font-size: 8px;"), "レベルは10pxから8px");
  assert.ok(css.includes(".member-card.monster .mname { padding-right: 22px; margin-top: 0; }"), "右上の紋章を避ける");
  const x = setup(roster());
  const monster = x.ctx.buildMemberCard({
    id: "m-long", race: "slime", isMonster: true, name: "デザートスコーピオン", level: 99,
    ivs: Object.fromEntries(Stats.IV_KEYS.map((k) => [k, 1.05])),
  });
  assert.equal(monster.title, "デザートスコーピオン Lv.99");
  assert.ok(monster.innerHTML.includes("デザートスコーピオン"));
  assert.ok(monster.innerHTML.includes("Lv.99"));
  assert.equal(monster.innerHTML.includes("mtitle"), false);
});

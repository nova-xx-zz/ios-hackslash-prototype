"use strict";
// パーティ編成: 控えを人間／モンスターに分け、ジョブ・種族・★で絞り込み、並び替える（2026-10-24 フィードバック#3・#5）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RosterOrganize = require("../js/core/roster-organize.js");

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
  const ctx = vm.createContext({
    document, S, window: {},
    TEAM_LABELS: ["I", "II", "III", "IV"], TEAM_NAMES: ["第一", "第二", "第三", "第四"], MAX_ACTIVE: 5,
    teamMembers: (i) => roster.filter((c) => c.team === i), isTeamLocked: () => false,
    QPModel: { save: { GROUP_MAX: 8, GROUP_NAME_MAX: 12 } }, Shop: { rosterCapacity: () => 100 },
    scheduleSave: () => {}, RACES: { human: { name: "ヒト" }, slime: { name: "スライム" }, wolf: { name: "オオカミ" } },
    jobDef: (c) => ({ name: c.isMonster ? { slime: "スライム", wolf: "オオカミ" }[c.race] : { warrior: "せんし", mage: "まほう" }[c.job] }),
    jobInsignia: () => "", escapeHtml: (s) => s,
    QPCore: { stats: { ivRank: () => "" }, rosterOrganize: RosterOrganize },
    openCreateScreen: () => {}, openCharDetail: () => {}, clampVitals: () => {},
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
  return { ctx, body, heads, headName, headMeta, benchStrips, cardNames, render: () => ctx.renderJobsScreen() };
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

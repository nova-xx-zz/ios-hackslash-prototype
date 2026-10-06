"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ログ・待機案内の切替と出発導線を確認する最小DOM。
// CSSレイアウト・Safariの描画はこのテストの対象外。
class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.textContent = "";
    this.listeners = {};
    this.className = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
    };
  }
  set innerHTML(value) {
    assert.equal(value, "", "ログには待機案内のHTMLを混ぜない");
    this.children = [];
  }
  get lastElementChild() { return this.children.at(-1); }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) {
    return this.children.find((child) => child.classList.contains(selector.slice(1))) || null;
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { this.listeners.click?.(); }
}

function setup() {
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = new Element()),
    createElement: () => new Element(),
  };
  const members = [[{ id: "hero" }], [], [], []];
  const runs = [null, null, null, null];
  const locked = new Set();
  const routes = [];
  const context = vm.createContext({
    document, TEAM_COUNT: 4, S: { activeTeam: 0 }, teamRuns: runs,
    teamMembers: (i) => members[i], activeParty: () => members[context.S.activeTeam],
    isTeamRunActive: (i) => !!runs[i]?.active, isTeamLocked: (i) => locked.has(i),
    // 未編成の時はパーティ編成の画面を直接開く（下のナビの「編成」は編成メニューを開くため）
    openPartyScreen: () => routes.push("party"),
  });
  document.getElementById("btnDockMap").addEventListener("click", () => routes.push("map"));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui/log.js"), "utf8"), context);
  return { context, elements, runs, locked, routes };
}

test("待機中は出発案内を表示し、ログの追記先には案内を入れない", () => {
  const { context: c, elements: e } = setup();
  c.renderLogFeed(0);
  assert.equal(e.exploreWelcome.classList.contains("hidden"), false);
  assert.equal(e.logFeed.classList.contains("hidden"), true);
  assert.equal(e.logFeed.children.length, 0);
  assert.equal(e.exploreEmbarkLabel.textContent, "マップを開く");
});

test("最初の戦闘ログが案内を隠し、行と敵の残り状況はログカードに追記される", () => {
  const { context: c, elements: e, runs } = setup();
  c.renderLogFeed(0);
  runs[0] = { active: true };
  c.logEvent(0, "encounter", "敵が現れた！", "スライム ×2");
  c.logLine(0, "スライムをたおした！", "system");
  c.updateCardSubtitle(0, "スライム ×1");
  assert.equal(e.exploreWelcome.classList.contains("hidden"), true);
  assert.equal(e.logFeed.classList.contains("hidden"), false);
  assert.equal(e.exploreState.textContent, "探索中");
  assert.equal(e.logFeed.children.length, 1);
  assert.equal(e.logFeed.lastElementChild.querySelector(".lc-sub").textContent, "スライム ×1");
  assert.equal(e.logFeed.lastElementChild.querySelector(".lc-lines").children[0].textContent, "スライムをたおした！");
});

test("探索中・未編成のパーティを往復しても各パーティのログが混ざらない", () => {
  const { context: c, elements: e, runs } = setup();
  runs[0] = { active: true };
  c.logEvent(0, "start", "草原へ出発", "");
  c.S.activeTeam = 1;
  c.renderLogFeed(1);
  assert.equal(e.exploreWelcomeTitle.textContent, "仲間を編成しよう");
  assert.equal(e.exploreEmbarkLabel.textContent, "仲間を編成する");
  assert.equal(e.logFeed.children.length, 0);
  c.S.activeTeam = 0;
  c.renderLogFeed(0);
  assert.equal(e.exploreWelcome.classList.contains("hidden"), true);
  assert.equal(e.logFeed.lastElementChild.querySelector(".lc-title").textContent, "草原へ出発");
  runs[0].active = false;
  c.renderLogFeed(0);
  assert.equal(e.exploreState.textContent, "帰還");
  assert.equal(e.logFeed.children.length, 1);
});

test("出発案内は編成状況に応じた既存導線を開き、探索ロック中には遷移しない", () => {
  const { context: c, elements: e, routes, locked } = setup();
  e.btnExploreEmbark.click();
  c.S.activeTeam = 1;
  e.btnExploreEmbark.click();
  locked.add(1);
  e.btnExploreEmbark.click();
  assert.deepEqual(routes, ["map", "party"]);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 探索ドックのタブ部分を実行し、人数非表示・探索中の更新・既存の切替操作を検証する。
const source = fs.readFileSync(path.join(__dirname, "../js/ui/dock.js"), "utf8");
const start = source.indexOf("function renderDock() {");
const end = source.indexOf("\nfunction renderAutoRepeatRow()", start);
assert.ok(start !== -1 && end > start, "renderDock と状態更新の実装が見つかること");

class Element {
  constructor() {
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.disabled = false;
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        const on = force === undefined ? !names.has(name) : force;
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  set innerHTML(value) {
    this.children = [];
    if (value === "") return;
    // 実装の期待HTMLは番号と探索状態の2要素のみ。人数表示が紛れ込むのを検出する。
    const match = value.match(/^<span class="team-tab-label">([^<]+)<\/span><span class="team-tab-status"><\/span>$/);
    assert.ok(match, "タブは人数を含まない1行構造");
    const label = new Element();
    label.className = "team-tab-label";
    label.textContent = match[1];
    const status = new Element();
    status.className = "team-tab-status";
    this.children = [label, status];
  }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) { return this.children.find((child) => child.classList.contains(selector.slice(1))) || null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { this.listeners.click?.(); }
}

function setup() {
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = new Element()),
    createElement: () => new Element(),
  };
  const running = new Set([0]);
  const repeating = new Set();
  const runs = [{ battleIndex: 0, buffs: {}, dungeon: { id: "plains", name: "はじまりの草原", mode: "normal", battles: 3 } }, null, null, null];
  const S = { activeTeam: 0, material: 123, lastDungeons: [null, null, null, null] };
  const events = [];
  const ctx = vm.createContext({
    document, TEAM_LABELS: ["I", "II", "III", "IV"],
    TEAM_NAMES: ["第一のパーティ", "第二のパーティ", "第三のパーティ", "第四のパーティ"],
    S, teamRuns: runs, pendingDungeons: [null, null, null, null], STAT_LABELS: {},
    isTeamRunActive: (i) => running.has(i), isTeamLocked: (i) => running.has(i) || repeating.has(i),
    getModeDungeon: () => null, getDungeonMode: () => ({ name: "通常" }),
    teamMembers: (i) => i === 0 ? [{ id: "a" }] : [],
    renderLogFeed: (i) => events.push("log:" + i),
    buildPartyDock: () => events.push("party"),
    updateAutoDisassembleButton: () => {},
    renderDisassembleFilter: () => {},
    renderAutoRepeatRow: () => {},
    scheduleSave: () => events.push("save"),
    clamp: (n, lo, hi) => Math.max(lo, Math.min(n, hi)),
    autoDisassembleLockShown: null,
  });
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, elements, running, repeating, runs, events, S };
}

test("探索画面タブから人数を除き、番号＋探索中だけを表示する", () => {
  const { ctx, elements } = setup();
  ctx.renderDock();
  const tabs = elements.teamTabs.children;
  assert.equal(tabs.length, 4);
  assert.deepEqual(tabs.map((button) => button.children[0].textContent), ["I", "II", "III", "IV"]);
  assert.equal(tabs[0].querySelector(".team-tab-status").textContent, "探索中");
  assert.equal(tabs[0].attrs["aria-label"], "第一のパーティ・探索中");
  assert.equal(tabs[1].querySelector(".team-tab-status").textContent, "");
  assert.equal(tabs[1].attrs["aria-label"], "第二のパーティ");
  assert.equal(tabs[0].classList.contains("active"), true);
});

test("別チームの探索開始・終了が描画し直さず表示に反映される", () => {
  const { ctx, elements, running } = setup();
  ctx.renderDock();
  const [first, , third] = elements.teamTabs.children;
  running.delete(0);
  running.add(2);
  ctx.updateTeamTabStatus();
  assert.equal(first.querySelector(".team-tab-status").textContent, "");
  assert.equal(first.attrs["aria-label"], "第一のパーティ");
  assert.equal(third.querySelector(".team-tab-status").textContent, "探索中");
  assert.equal(third.attrs["aria-label"], "第三のパーティ・探索中");
  ctx.updateTeamTabStatus();
  assert.equal(elements.teamTabs.children[2], third, "変更なしではタブを再生成しない");
});

test("タブを切り替えると従来通りパーティ情報とログが切り替わり、保存される", () => {
  const { ctx, elements, events, S } = setup();
  ctx.renderDock();
  elements.teamTabs.children[1].click();
  assert.equal(S.activeTeam, 1);
  assert.equal(elements.teamTabs.children[1].classList.contains("active"), true);
  assert.ok(events.includes("party"));
  assert.ok(events.includes("log:1"));
  assert.equal(events.at(-1), "save");
});

test("探索ドックの表示領域は拡大しつつタブのタップ領域を確保する", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  assert.match(css, /#screen-battle \.team-tab \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /#screen-battle \.team-tab-status:empty \{ display: none; \}/);
  assert.doesNotMatch(css, /\.team-tab\.exploring::after/);
  assert.match(css, /#screen-battle \.party-row \{ gap: 6px; padding: 5px 10px 6px; \}/);
});

test("自動周回の周回間は「探索中」を維持し、全周回完了・全滅で解除する", () => {
  const { ctx, elements, running, repeating, runs } = setup();
  running.delete(0);
  runs[0].finished = true; // 1周クリア後、次の周回の出撃待ち
  repeating.add(0);
  ctx.renderDock();
  assert.equal(elements.dockStatus.textContent, "探索中…");
  assert.equal(elements.teamTabs.children[0].querySelector(".team-tab-status").textContent, "探索中");

  repeating.add(2); // 別チームも自動周回の周回間
  ctx.updateTeamTabStatus();
  assert.equal(elements.teamTabs.children[2].querySelector(".team-tab-status").textContent, "探索中");

  repeating.delete(0); // 指定した周回数がすべて完了
  ctx.renderDock();
  assert.equal(elements.dockStatus.textContent, "踏破");
  assert.equal(elements.teamTabs.children[0].querySelector(".team-tab-status").textContent, "");

  repeating.add(0);
  runs[0].wiped = true;
  repeating.delete(0); // 自動周回中の全滅・撤退
  ctx.renderDock();
  assert.equal(elements.dockStatus.textContent, "失敗");
  assert.equal(elements.teamTabs.children[0].querySelector(".team-tab-status").textContent, "");

  repeating.delete(2); // オフライン精算後は自動周回が解除される
  ctx.updateTeamTabStatus();
  assert.equal(elements.teamTabs.children[2].querySelector(".team-tab-status").textContent, "");
});

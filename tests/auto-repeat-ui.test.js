"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ドックの自動周回行だけを最小DOMで実行する。画面のボタン表示とクリック時の再検証を両方確認。
const source = fs.readFileSync(path.join(__dirname, "../js/ui/dock.js"), "utf8");
const start = source.indexOf("function renderAutoRepeatRow() {");
const end = source.indexOf("\nfunction updateBattleDOM()", start);
assert.ok(start >= 0 && end > start, "自動周回行の実装が見つかること");
const implementation = source.slice(start, end);

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.disabled = false;
    this.title = "";
    this.value = "";
  }
  set innerHTML(value) {
    assert.equal(value, "");
    this.children = [];
  }
  appendChild(node) { this.children.push(node); return node; }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { this.listeners.click?.(); }
}

function setup() {
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = new Element("div")),
    createElement: (tag) => new Element(tag),
  };
  const state = {
    activeTeam: 0,
    clearedDungeons: new Set(),
    clearedHard: new Set(),
    clearedExtra: new Set(),
    autoRepeat: Array.from({ length: 4 }, () => ({ active: false, target: 5, done: 0 })),
    lastDungeons: [null, null, null, null],
  };
  const runs = [{ finished: true, dungeon: { id: "plains", mode: "normal" } }, null, null, null];
  const started = [];
  const pendingDungeons = [null, null, null, null];
  const context = vm.createContext({
    document, S: state, teamRuns: runs, pendingDungeons,
    Runner: {
      canAutoRepeat: (id, mode) => {
        const cleared = mode === "hard" ? state.clearedHard
          : mode === "extra" ? state.clearedExtra : state.clearedDungeons;
        return cleared.has(id);
      },
    },
    isTeamLocked: () => false,
    teamMembers: () => [{ id: "c1" }], // 実ゲームの編成済みチーム相当
    Shop: { autoRepeatChoices: () => [{ n: 1, locked: false }, { n: 5, locked: false }] },
    store: { set: () => {} }, KEYS: { autoRepeatTarget: "target" },
    logLine: () => {}, renderDock: () => {}, ensureNotifyPermission: () => {},
    startDungeon: (team, id, options) => started.push({ team, id, mode: options.mode }),
    openShop: () => {},
  });
  vm.runInContext(implementation, context, { filename: "renderAutoRepeatRow" });
  function render() {
    context.renderAutoRepeatRow();
    const row = document.getElementById("autoRepeatRow");
    return { row, button: row.children.find((c) => c.tagName === "button") };
  }
  return { state, runs, started, pendingDungeons, render };
}

test("自動周回ボタンは挑戦済みでも未踏破なら無効、踏破後に有効", () => {
  const { state, render, started } = setup();
  let { row, button } = render();
  assert.equal(button.disabled, true);
  assert.match(button.title, /1回クリア/);
  assert.ok(row.children.some((child) => child.textContent.includes("1回クリア")));

  state.clearedDungeons.add("plains");
  ({ button } = render());
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(state.autoRepeat[0].active, true);
  assert.equal(state.autoRepeat[0].done, 0);
  assert.deepEqual(started, [{ team: 0, id: "plains", mode: "normal" }]);
});

test("同じダンジョンでも難易度ごとに初回クリアが必要、別パーティにも共通", () => {
  const { state, runs, render } = setup();
  state.clearedDungeons.add("plains");
  runs[0] = { finished: true, dungeon: { id: "plains", mode: "hard" } };
  assert.equal(render().button.disabled, true);
  state.clearedHard.add("plains");
  assert.equal(render().button.disabled, false);

  state.activeTeam = 1;
  runs[1] = { finished: true, dungeon: { id: "plains", mode: "normal" } };
  assert.equal(render().button.disabled, false, "踏破履歴はチーム共通");
  runs[1] = { finished: true, dungeon: { id: "forest", mode: "normal" } };
  assert.equal(render().button.disabled, true, "別ダンジョンは未解放");
});

test("描画後に状態が変わってもクリック時の再検証で不正開始しない", () => {
  const { state, runs, started, render } = setup();
  state.clearedDungeons.add("plains");
  const { button } = render();
  assert.equal(button.disabled, false);
  state.clearedDungeons.delete("plains");
  button.click(); // 直接イベントを呼ぶことで画面更新前の押下も確認
  assert.equal(state.autoRepeat[0].active, false);
  assert.equal(started.length, 0);

  state.clearedDungeons.add("plains");
  const next = render().button;
  runs[0] = { finished: true, dungeon: { id: "forest", mode: "normal" } };
  next.click();
  assert.equal(started.length, 0, "描画時とは別のダンジョンへの切替も検知");
});

test("別ダンジョンを準備中は前回ダンジョンの自動周回が始まらない", () => {
  const { state, pendingDungeons, render, started } = setup();
  state.clearedDungeons.add("plains");
  state.lastDungeons[0] = { id: "plains", mode: "normal" };
  assert.equal(render().button.disabled, false);
  pendingDungeons[0] = { id: "forest", mode: "normal" };
  const out = render();
  assert.equal(out.button.disabled, true);
  assert.ok(out.row.children.some((node) => node.textContent.includes("1回クリア")));
  out.button.click();
  assert.deepEqual(started, []);
  assert.deepEqual(state.lastDungeons[0], { id: "plains", mode: "normal" });
  pendingDungeons[0] = null;
  render().button.click();
  assert.deepEqual(started, [{ team: 0, id: "plains", mode: "normal" }]);
});
test("自動周回の表示後でも選択中の行き先が変われば誤出撃しない", () => {
  const { state, pendingDungeons, render, started } = setup();
  state.clearedDungeons.add("plains");
  const button = render().button;
  assert.equal(button.disabled, false);
  pendingDungeons[0] = { id: "forest", mode: "normal" };
  button.click();
  assert.deepEqual(started, []);
  assert.equal(state.autoRepeat[0].active, false);
});

test("踏破済みダンジョン選択中は出撃待ち画面から自動周回でき、前回出撃先と取り違えない", () => {
  const { state, pendingDungeons, started, render } = setup();
  state.clearedDungeons.add("plains");
  state.clearedDungeons.add("forest");
  state.lastDungeons[0] = { id: "plains", mode: "normal" };
  pendingDungeons[0] = { id: "forest", mode: "normal" };
  const { button, row } = render();
  assert.equal(button.disabled, false);
  assert.equal(row.children.some((node) => node.textContent.includes("行き先決定中")), false);
  button.click();
  assert.equal(state.autoRepeat[0].active, true);
  assert.deepEqual(started, [{ team: 0, id: "forest", mode: "normal" }]);
});

test("出撃準備先がハードなら、ノーマル踏破だけでは自動周回できない", () => {
  const { state, pendingDungeons, started, render } = setup();
  state.clearedDungeons.add("forest");
  pendingDungeons[0] = { id: "forest", mode: "hard" };
  assert.equal(render().button.disabled, true);
  state.clearedHard.add("forest");
  const { button } = render();
  assert.equal(button.disabled, false);
  button.click();
  assert.deepEqual(started, [{ team: 0, id: "forest", mode: "hard" }]);
});

test("表示後に出撃準備先が未踏破へ変更されたら周回は開始しない", () => {
  const { state, pendingDungeons, started, render } = setup();
  state.clearedDungeons.add("plains");
  pendingDungeons[0] = { id: "plains", mode: "normal" };
  const { button } = render();
  assert.equal(button.disabled, false);
  pendingDungeons[0] = { id: "forest", mode: "normal" };
  button.click();
  assert.equal(state.autoRepeat[0].active, false);
  assert.deepEqual(started, []);
});

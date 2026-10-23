"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("味方の行動時に発光クラスを付けず、HP・MP・ATBと戦闘不能表示は更新する", () => {
  const source = read("js/ui/dock.js");
  const start = source.indexOf("function updateBattleDOM() {");
  const end = source.indexOf("\n// 戦闘の速さ:", start);
  assert.ok(start >= 0 && end > start);
  const bars = {};
  for (const selector of [".stat-bar.hp .fill", ".hpnum", ".stat-bar.mp .fill", ".mpnum", ".stat-bar.atb .fill"]) {
    bars[selector] = { style: {}, textContent: "" };
  }
  const classes = new Set(["actor-card"]);
  const card = {
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelector: (selector) => {
      assert.ok(bars[selector], "必要なゲージを更新する");
      return bars[selector];
    },
  };
  const member = { id: "hero", alive: true, actedFlash: 1, hp: 50, mp: 20, atb: 75 };
  const context = vm.createContext({
    activeParty: () => [member],
    partyEls: { hero: card },
    computeStats: () => ({ maxHp: 100, maxMp: 40 }),
    clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  });
  vm.runInContext(source.slice(start, end), context);
  context.updateBattleDOM();
  assert.equal(classes.has("acted"), false);
  assert.equal(classes.has("down"), false);
  assert.equal(bars[".stat-bar.hp .fill"].style.width, "50%");
  assert.equal(bars[".hpnum"].textContent, "HP 50/100");
  assert.equal(bars[".stat-bar.mp .fill"].style.width, "50%");
  assert.equal(bars[".mpnum"].textContent, "MP 20/40");
  assert.equal(bars[".stat-bar.atb .fill"].style.width, "75%");
  member.alive = false;
  context.updateBattleDOM();
  assert.equal(classes.has("down"), true);
  assert.equal(classes.has("acted"), false);
});

test("行動時の発光CSS・イベント状態・旧チェックポイント項目を残さない", () => {
  assert.doesNotMatch(read("css/style.css"), /\.actor-card\.acted/);
  assert.doesNotMatch(read("js/ui/explore.js"), /actedFlash|case "acted":/);
  assert.doesNotMatch(read("js/ui/dock.js"), /classList\.toggle\("acted"/);
  assert.doesNotMatch(read("js/model/run.js"), /actedFlash/);
  assert.doesNotMatch(read("js/core/dungeon-checkpoint.js"), /actedFlash/);
});

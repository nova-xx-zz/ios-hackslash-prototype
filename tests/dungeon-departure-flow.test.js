"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mapSrc = fs.readFileSync(path.join(__dirname, "../js/ui/title-map.js"), "utf8");
const dockSrc = fs.readFileSync(path.join(__dirname, "../js/ui/dock.js"), "utf8");
const battleSrc = fs.readFileSync(path.join(__dirname, "../js/ui/battle.js"), "utf8");
const stageStart = mapSrc.indexOf("function stageDungeonDeparture(");
const stageEnd = mapSrc.indexOf("function renderDungeonInfo(", stageStart);
const deployStart = dockSrc.indexOf('document.getElementById("btnPrepareDeploy").addEventListener("click"');
const deployEnd = dockSrc.indexOf('document.getElementById("btnDockMap").addEventListener("click"', deployStart);
assert.ok(stageStart >= 0 && stageEnd > stageStart, "selection must stage before rendering dungeon info");
assert.ok(deployStart >= 0 && deployEnd > deployStart, "dock should expose a separate departure action");
assert.match(mapSrc.slice(stageEnd), /stageDungeonDeparture\(S\.activeTeam, d\.id, mode\)/);
assert.doesNotMatch(mapSrc.slice(stageEnd), /startDungeon\(S\.activeTeam, d\.id/);
assert.match(battleSrc, /pendingDungeons\[teamIndex\] = null;/);

function fixture() {
  const pendingDungeons = [null, null, null, null];
  const lastDungeons = [{ id: "plains", mode: "normal" }, null, null, null];
  const state = { activeTeam: 0, lastDungeons };
  const party = [[{ id: "first" }], [{ id: "second" }], [], []];
  const departures = [];
  const callbacks = {};
  let hubOpens = 0;
  let lockedTeam = null;
  let allowedHard = false;
  const dungeons = {
    plains: { id: "plains", name: "平原" },
    forest: { id: "forest", name: "森林" },
  };
  const ctx = vm.createContext({
    S: state, pendingDungeons,
    teamMembers: (i) => party[i],
    isTeamLocked: (i) => i === lockedTeam,
    getDungeon: (id) => dungeons[id] || null,
    isDungeonModeOpen: (d, mode) => mode === "normal" || (mode === "hard" && allowedHard),
    openExploreHub: () => { hubOpens++; },
    startDungeon: (i, id, opts) => { departures.push({ i, id, mode: opts.mode, navigate: opts.navigate }); },
    document: {
      getElementById: (id) => ({
        addEventListener: (type, handler) => { callbacks[id + ":" + type] = handler; },
      }),
    },
  });
  vm.runInContext(mapSrc.slice(stageStart, stageEnd), ctx);
  vm.runInContext(dockSrc.slice(deployStart, deployEnd), ctx);
  return { pendingDungeons, lastDungeons, state, party, departures, callbacks,
    stage: (i, id, mode) => ctx.stageDungeonDeparture(i, id, mode),
    get hubOpens() { return hubOpens; },
    set lockedTeam(v) { lockedTeam = v; },
    set allowedHard(v) { allowedHard = v; },
  };
}

test("マップで行き先を決定しても出撃せず、探索画面の出撃で初めて戦闘を始める", () => {
  const f = fixture();
  assert.equal(f.stage(0, "forest", "normal"), true);
  assert.equal(f.hubOpens, 1);
  assert.deepEqual(f.departures, []);
  assert.deepEqual(f.lastDungeons[0], { id: "plains", mode: "normal" });
  assert.deepEqual(JSON.parse(JSON.stringify(f.pendingDungeons[0])), { id: "forest", mode: "normal" });
  f.callbacks["btnPrepareDeploy:click"]();
  assert.deepEqual(f.departures, [{ i: 0, id: "forest", mode: "normal", navigate: true }]);
});

test("チームごとに出撃準備先が分かれ、別の仲間のダンジョンへ誤出撃しない", () => {
  const f = fixture();
  assert.equal(f.stage(0, "forest", "normal"), true);
  assert.equal(f.stage(1, "plains", "normal"), true);
  f.state.activeTeam = 1;
  f.callbacks["btnPrepareDeploy:click"]();
  assert.deepEqual(f.departures, [{ i: 1, id: "plains", mode: "normal", navigate: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.pendingDungeons[0])), { id: "forest", mode: "normal" });
  f.state.activeTeam = 0;
  f.callbacks["btnPrepareDeploy:click"]();
  assert.equal(f.departures[1].id, "forest");
});

test("未編成・探索中・未解放の難易度・不正な行き先は出撃を拒否する", () => {
  const f = fixture();
  assert.equal(f.stage(2, "forest", "normal"), false);
  assert.equal(f.stage(0, "missing", "normal"), false);
  assert.equal(f.stage(0, "forest", "hard"), false);
  f.lockedTeam = 0;
  assert.equal(f.stage(0, "forest", "normal"), false);
  assert.deepEqual(f.departures, []);
  assert.deepEqual(f.pendingDungeons, [null, null, null, null]);
  f.lockedTeam = null;
  f.allowedHard = true;
  assert.equal(f.stage(0, "forest", "hard"), true);
  f.allowedHard = false;
  f.callbacks["btnPrepareDeploy:click"]();
  assert.deepEqual(f.departures, [], "prepared mode is validated again at departure");
  f.allowedHard = true;
  f.lockedTeam = 0;
  f.callbacks["btnPrepareDeploy:click"]();
  assert.deepEqual(f.departures, [], "cannot launch a locked team");
});

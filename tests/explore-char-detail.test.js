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
    TEAM_COUNT: 4,
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
  vm.runInContext(code + "\nthis.peek = () => ({ detailReturnScreen, detailCharId });", context);
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

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../tools/lib/load-data.js").loadGameData();
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const tree = fs.readFileSync(path.join(root, "js/ui/detail-tree.js"), "utf8");

const expected = {
  warrior: "戦士", mage: "魔法使い", priest: "僧侶", thief: "盗賊",
  monk: "武闘家", darkknight: "暗黒士", swordmaster: "剣豪",
  archmage: "大魔導士", archpriest: "大神官", ninja: "忍者",
  saintfist: "剣聖", reaper: "死神", pilgrim: "巡礼剣士",
};

test("基本・上級・特殊の全ジョブ名を漢字化し既存ID・習得スキルを保持", () => {
  assert.deepEqual(Object.keys(data.JOBS).sort(), Object.keys(expected).sort());
  for (const [id, name] of Object.entries(expected)) {
    const job = data.JOBS[id];
    assert.equal(job.id, id);
    assert.equal(job.name, name, id);
    assert.ok(job.abilities && job.abilities.length > 0, id + " のスキルを維持");
  }
  assert.equal(data.JOBS.warrior.tier, "basic");
  assert.equal(data.JOBS.swordmaster.requires.job, "warrior");
  assert.equal(data.JOBS.pilgrim.unlock.purchase, "jobPilgrim");
});

test("4分割タブは幅オーバー防止、表示名変更に合わせてキャッシュ更新", () => {
  assert.match(css, /\.crest-focus-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.crest-focus-tab\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden/);
  assert.match(html, /css\/style\.css\?v=92/);
  assert.match(html, /js\/data\.js\?v=39/);
  assert.match(html, /js\/ui\/detail-tree\.js\?v=17/);
});

test("習得済みはカード内状態タグに集約し未取得のみカード内習得ボタンを生成", () => {
  const start = tree.indexOf("function buildWarriorCrestDetail(");
  const end = tree.indexOf("function buildTreeNodeDetail(", start);
  const section = tree.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(section, /\["state", acquired \? "習得済み"/);
  assert.doesNotMatch(section, /className = "tree-node-detail-state crest-learned"/);
  assert.match(section, /if \(acquired\) \{\s*panel\.appendChild\(card\);\s*return panel;/);
  assert.match(section, /actions\.appendChild\(btn\);\s*card\.appendChild\(actions\);\s*panel\.appendChild\(card\)/);
  assert.match(css, /\.crest-detail-actions\s*\{[^}]*border-top:/);
  assert.match(css, /\.crest-inline-detail \.crest-detail-actions \.crest-learn-btn\s*\{[^}]*width:\s*100%/);
});

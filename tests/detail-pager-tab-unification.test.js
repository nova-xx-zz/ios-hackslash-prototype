"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const detail = fs.readFileSync(path.join(__dirname, "../js/ui/detail.js"), "utf8");

function declaration(selector) {
  // All selectors under test are simple literal CSS selectors.
  const escape = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = css.match(new RegExp("(?:^|\\n)" + escape + "\\s*\\{([^}]*)\\}", "m"));
  assert.ok(found, selector + " must exist");
  return found[1];
}
test("キャラ送りは全タブ共通の固定2段グリッドで文字数・タブ変更によるズレを防ぐ", () => {
  const header = declaration("#screen-chardetail .roster-header");
  assert.match(header, /display:\s*grid/);
  assert.match(header, /grid-template-columns:\s*minmax\(0, 1fr\) 84px/);
  assert.match(header, /height:\s*60px/);
  assert.match(header, /min-height:\s*60px/);
  const pager = declaration(".detail-switch");
  assert.match(pager, /display:\s*grid/);
  assert.match(pager, /grid-template-columns:\s*44px minmax\(0, 1fr\) 44px/);
  const btn = declaration("#screen-chardetail .detail-switch-btn");
  assert.match(btn, /width:\s*44px/);
  assert.match(btn, /height:\s*44px/);
  const back = declaration("#screen-chardetail #btnDetailBack");
  assert.match(back, /width:\s*84px/);
  assert.match(back, /height:\s*44px/);
  assert.match(declaration(".detail-switch-name .map-title"), /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(css, /#screen-chardetail\.warrior-crest-view \.roster-header\s*\{/);
  assert.doesNotMatch(css, /#screen-chardetail\.warrior-crest-view \.roster-wrap\s*\{/);
});

test("ツリー型の能力値〜ジョブ5タブを全詳細画面に適用（4タブのモンスターも均等幅）", () => {
  const tabs = declaration("#screen-chardetail #detailTabs");
  assert.match(tabs, /display:\s*flex/);
  assert.match(tabs, /flex:\s*0 0 43px/);
  assert.match(tabs, /margin:\s*3px -10px 0/);
  assert.match(tabs, /background:\s*rgba\(5,14,20,\.97\)/);
  const tab = declaration("#screen-chardetail #detailTabs .detail-tab");
  assert.match(tab, /flex:\s*1 1 0/);
  assert.match(tab, /min-height:\s*43px/);
  assert.match(tab, /font-size:\s*12px/);
  assert.doesNotMatch(css, /#screen-chardetail\.warrior-crest-view #detailTabs/);
  assert.match(css, /\.detail-tab\.active\s*\{[^}]*inset 0 2px 0 var\(--accent\)/);
  const labels = ["能力値", "装備", "スキル", "ツリー", "ジョブ"];
  for(const label of labels) assert.ok(detail.includes('label: "' + label + '"'), label);
  assert.match(detail, /if \(t\.key === "tree" && !getExclusiveTree\(c\)\) continue/);
});

test("2枚の画面に同じキャラ送りDOMを使い、描画時は名前のみ変更", () => {
  const start = html.indexOf('id="screen-chardetail"');
  const end = html.indexOf('id="screen-map"', start);
  const section = html.slice(start, end);
  for(const id of ["btnDetailPrev", "detailName", "detailPos", "btnDetailNext", "btnDetailBack", "detailTabs"]) {
    assert.match(section, new RegExp('id="' + id + '"'));
  }
  assert.match(detail, /document\.getElementById\("detailName"\)\.textContent = pager\.name/);
  assert.match(detail, /document\.getElementById\("detailPos"\)\.textContent = pager\.pos/);
  assert.match(detail, /classList\.toggle\("warrior-crest-view", focus\)/);
  assert.match(html, /css\/style\.css\?v=93/);
});

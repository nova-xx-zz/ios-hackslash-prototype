"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const create = fs.readFileSync(path.join(__dirname, "../js/ui/create.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");

test("仲間作成の導線・BOX制限・Lv1作成は維持する", () => {
  for (const id of ["screen-create","createBody","btnCreateBack","btnCreateRandom","btnCreateConfirm","pickModal","btnPickModalOk"])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.match(create, /Shop\.canAddToRoster\(1\)/);
  assert.match(create, /newCharacter\(name, draft\.job, draft\.race, \{ level: createStartLevel\(\) \}\)/);
  assert.match(create, /S\.roster\.push\(c\)/);
  assert.match(create, /draft\[field\] = id;/);
});

test("UIはギルド見出し・下部固定ボタン・iOSの16px入力・狭幅対応", () => {
  assert.match(html, /class="roster-header create-header"/);
  assert.match(html, /class="roster-footer create-footer"/);
  assert.match(css, /#screen-create \.create-footer\s*\{[^}]*flex: 0 0 auto;/s);
  assert.match(css, /#screen-create \.name-input\s*\{[^}]*font-size: 16px;/s);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(html, /css\/create-ornate\.css\?v=1/);
  assert.match(html, /js\/ui\/create\.js\?v=8/);
});

test("種族ジョブの選択カードをクリックでき、表示文言はtextContent", () => {
  const start = create.indexOf("function buildCreatePickRow(");
  const end = create.indexOf("function statStars(", start);
  assert.ok(start >= 0 && end > start);
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.className = ""; this.textContent = ""; }
    appendChild(el) { this.children.push(el); return el; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    setAttribute(k, v) { this.attrs[k] = v; }
    click() { this.listeners.click?.(); }
  }
  const cx = vm.createContext({ document: { createElement: tag => new El(tag) }, RACES: { human: { icon: "♜" } }, jobInsignia: () => "<svg></svg>" });
  vm.runInContext(create.slice(start, end), cx);
  let clicked = false;
  const row = cx.buildCreatePickRow("しゅぞく", "<img src=x>", "説明", () => clicked = true, "race", "human");
  assert.equal(row.tag, "button");
  assert.match(row.className, /create-pick-row/);
  assert.equal(row.children[1].children[0].children[1].children[0].textContent, "<img src=x>");
  row.click();
  assert.equal(clicked, true);
});

test("登録プレビューは6能力値・特性・習得スキルを表示し、名前をエスケープする", () => {
  const start = create.indexOf("function updateCreatePreview() {");
  const end = create.indexOf("const PASSIVE_LABELS =", start);
  assert.ok(start >= 0 && end > start);
  const box = { innerHTML: "" };
  const cx = vm.createContext({
    document: { getElementById: () => box },
    draft: { name: "<b>エマ</b>", race: "human", job: "rogue" },
    newCharacter: (name, job, race, opts) => ({ name, job, race, level: opts.level }),
    createStartLevel: () => 1,
    computeStats: () => ({ maxHp: 22, maxMp: 10, atk: 8, mag: 4, def: 6, spd: 10.5 }),
    RACES: { human: { name: "もりびと", passive: {}, expMult: 1.1 } },
    JOBS: { rogue: { name: "とうぞく" } },
    availableAbilities: () => [{ name: "影刃" }],
    PASSIVE_LABELS: {},
    escapeHtml: t => String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),
  });
  vm.runInContext(create.slice(start, end), cx);
  cx.updateCreatePreview();
  assert.match(box.innerHTML, /&lt;b&gt;エマ&lt;\/b&gt;/);
  assert.doesNotMatch(box.innerHTML, /<b>エマ<\/b>/);
  assert.equal((box.innerHTML.match(/class="pv-stat"/g)||[]).length,6);
  assert.match(box.innerHTML, /獲得経験値 10%/);
  assert.match(box.innerHTML, /影刃/);
});

test("v2: 装飾付き選択帯・登録プレビュー・名前入力のスクロール復帰", () => {
  const ornate = fs.readFileSync(path.join(__dirname,"../css/create-ornate.css"),"utf8");
  const frame = fs.readFileSync(path.join(__dirname,"../icons/companion-ornate-frame.svg"),"utf8");
  const art = fs.readFileSync(path.join(__dirname,"../icons/companion-stilllife.svg"),"utf8");
  assert.match(create, /create-name-input-shell/);
  assert.match(create, /cr-select-box/);
  assert.match(create, /create-preview-shell/);
  assert.match(create, /getElementById\("createBody"\)\.scrollTop = 0/);
  assert.match(ornate, /border-image-source:url\("\.\.\/icons\/companion-ornate-frame.svg"\)/);
  assert.match(ornate, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(ornate, /position:absolute; z-index:-1/);
  assert.match(frame, /<svg/);
  assert.match(art, /<svg/);
});

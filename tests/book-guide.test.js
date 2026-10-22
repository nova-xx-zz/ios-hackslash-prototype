"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class MockElement {
  constructor() {
    this.children = [];
    this.textContent = "";
    this.className = "";
    this.scrollTop = 0;
    this.listeners = {};
    this.classList = {
      toggle: () => {},
      add: (name) => { this.className += " " + name; },
    };
  }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    this._label = new MockElement();
    this._meta = new MockElement();
  }
  get innerHTML() { return this._html || ""; }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) {
    if (selector === ".book-row-label") return this._label;
    if (selector === ".book-row-meta") return this._meta;
    return null;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  click() { this.listeners.click?.(); }
}

function setup() {
  const nodes = {};
  const document = {
    createElement: () => new MockElement(),
    getElementById: (id) => nodes[id] || (nodes[id] = new MockElement()),
  };
  const ctx = vm.createContext({ document, showScreen: () => {}, openExploreHub: () => {} });
  for (const file of ["book-guide-content.js", "book.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui", file), "utf8"), ctx, { filename: file });
  }
  return { ctx, nodes, run: (source) => vm.runInContext(source, ctx) };
}

test("4章26項目でIDが一意、旧BOOK_GUIDE定義なし", () => {
  const { run } = setup();
  assert.equal(run("BOOK_GUIDE_CONTENT.chapters.length"), 4);
  assert.equal(run("BOOK_GUIDE_CONTENT.topics.length"), 26);
  assert.equal(run("new Set(BOOK_GUIDE_CONTENT.topics.map(x => x.id)).size"), 26);
  assert.equal(run("typeof BOOK_GUIDE"), "undefined");
});

test("プロトタイプ未提供のGoogle引継ぎ・実課金は公開せず、他24記事は読める", () => {
  const { run } = setup();
  assert.equal(run("visibleBookGuideTopics().length"), 24);
  assert.equal(run('bookGuideById("BKG-024")'), null);
  assert.equal(run('bookGuideById("BKG-025")'), null);
  assert.equal(run('bookGuideById("BKG-026").title'), "困ったときは");
});

test("章→記事→関連項目へ移動でき、全滅の注意が本文に表示される", () => {
  const { run, nodes } = setup();
  run("bookStack = [guideIndexPage()]; renderBook()");
  assert.equal(nodes.bookBody.children[0].children.length, 4);
  nodes.bookBody.children[0].children[0].click();
  assert.equal(nodes.bookTitle.textContent, "第1章 冒険の始め方");
  assert.equal(nodes.bookBody.children[0].children.length, 5);
  nodes.bookBody.children[0].children[4].click();
  assert.equal(nodes.bookTitle.textContent, "帰還と戦利品");
  const bookText = nodes.bookBody.children[0];
  assert.ok(bookText.children.some((p) => p.textContent.includes("失われます")));
  assert.ok(bookText.children.some((p) => p.className.includes("book-guide-warning")));
  assert.ok(nodes.bookBody.children.length > 1, "関連項目");
  nodes.btnBookBack.click();
  assert.equal(nodes.bookTitle.textContent, "第1章 冒険の始め方");
});

test("FAQの試作版向け案内に正式Web版専用のログインを混在させない", () => {
  const { run, nodes } = setup();
  run('bookStack = [guideTopicPage(bookGuideById("BKG-026"))]; renderBook()');
  const content = nodes.bookBody.children[0].children.map((el) => el.textContent).join("\n");
  assert.match(content, /データ復元/);
  assert.doesNotMatch(content, /Googleアカウント/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeGoogleFormUrl, setupContactLinks } = require("../js/ui/contact.js");

const LONG = "https://docs.google.com/forms/d/e/1FAIpQLTestForm123/viewform?usp=sf_link";
const SHORT = "https://forms.gle/AaBbCc123";

test("Googleフォームの回答用URLのみを許可し、不正スキーム・なりすまし・編集URLは拒否する", () => {
  assert.equal(normalizeGoogleFormUrl(LONG), LONG);
  assert.equal(normalizeGoogleFormUrl(SHORT), SHORT);
  for (const bad of [
    "", null, "javascript:alert(1)", "http://forms.gle/ABC",
    "https://evil.example/forms.gle/ABC", "https://forms.gle.evil.example/ABC",
    "https://docs.google.com/forms/d/e/FORM/edit", "https://docs.google.com@evil.example/forms/d/e/FORM/viewform",
    "https://docs.google.com/forms/d/e/FORM/viewform/extra",
    "https://forms.gle/", "https://forms.gle/ABC/other", "https://a:b@forms.gle/ABC",
  ]) assert.equal(normalizeGoogleFormUrl(bad), null, String(bad));
});

test("フォーム未設定時はリンクを表示せず、設定時だけ両画面のリンクを有効化する", () => {
  const nodes = Object.fromEntries(["settingsContactSection", "contactSettingsLink", "contactExploreLink"].map(id => {
    const classes = new Set(["hidden"]);
    const attributes = {};
    return [id, {
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, force) => force ? classes.add(c) : classes.delete(c), contains: c => classes.has(c) },
      setAttribute: (k,v) => { attributes[k] = v; },
      removeAttribute: k => { delete attributes[k]; },
      getAttribute: k => attributes[k],
    }];
  }));
  const doc = { getElementById: id => nodes[id] || null };
  assert.equal(setupContactLinks(doc, ""), false);
  assert.equal(nodes.settingsContactSection.classList.contains("hidden"), true);
  assert.equal(nodes.contactSettingsLink.classList.contains("hidden"), true);
  assert.equal(setupContactLinks(doc, LONG), true);
  assert.equal(nodes.settingsContactSection.classList.contains("hidden"), false);
  for (const id of ["contactSettingsLink", "contactExploreLink"]) {
    assert.equal(nodes[id].href, LONG);
    assert.equal(nodes[id].getAttribute("target"), "_blank");
    assert.equal(nodes[id].getAttribute("rel"), "noopener noreferrer");
    assert.equal(nodes[id].classList.contains("hidden"), false);
  }
  assert.equal(setupContactLinks(doc, "https://invalid.example/"), false);
  assert.equal(nodes.contactExploreLink.classList.contains("hidden"), true);
  assert.equal(nodes.contactExploreLink.getAttribute("href"), undefined);
});

test("設定・探索画面にリンクがあり、設定用スクリプトがUI初期化より前に読み込まれる", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="contactSettingsLink"/);
  assert.match(html, /id="contactExploreLink"/);
  const cfg = html.indexOf('src="js/contact-config.js?v=1"');
  const ui = html.indexOf('src="js/ui/contact.js?v=1"');
  const settings = html.indexOf('src="js/ui/settings.js?v=7"');
  assert.ok(cfg >= 0 && ui > cfg && settings > ui);
});

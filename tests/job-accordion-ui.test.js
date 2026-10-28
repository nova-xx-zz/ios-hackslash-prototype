"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  setAttribute(key,value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { if (this.listeners.click) this.listeners.click(); }
}
function descendants(el, predicate, output = []) {
  if (predicate(el)) output.push(el);
  for (const child of el.children) descendants(child, predicate, output);
  return output;
}
const cls = (el, name) => descendants(el, n => n.className.split(" ").includes(name));
const text = (el) => (el.textContent || "") + el.children.map(text).join("");
const section = (root, key) => descendants(root, el => el.dataset.group === key)[0];

function setup({purchased = false, shop = true, job = "swordmaster", special = true} = {}) {
  const jobs = {
    warrior: {name:"せんし",tier:"basic"},
    priest: {name:"そうりょ",tier:"basic"},
    swordmaster: {name:"けんごう",tier:"advanced"},
    champion: {name:"とうぎ",tier:"advanced"},
    necromancer: {name:"しれい",tier:"special"},
  };
  const character = {
    id: "guy", job, jobLevels: {
      warrior: {level:99}, priest: {level:99},
      swordmaster: {level:48}, champion: {level:0}, necromancer: {level:0}
    },
  };
  let current = null;
  let openedShop = null;
  const ctx = vm.createContext({
    document: { createElement: tag => new Element(tag) },
    JOBS: jobs,
    BASIC_JOB_IDS: ["warrior","priest"],
    SPECIAL_JOB_IDS: ["necromancer"],
    JOB_MASTER_LEVEL: 99,
    isFeatureEnabled: name => name === "shop" ? shop : false,
    jobUnlocked: (c,id) => id !== "necromancer",
    jobUsable: () => special,
    specialJobUnlockText: () => "試練達成",
    Shop: {hasUnlock: key => key === "basicJobMaxPass" && purchased},
    openShop: (...args) => { openedShop = args; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui/detail-tabs.js"), "utf8"), ctx);
  // ジョブカードの内部描画は別責務。ここでは個数とアコーディオンの動作のみ確認。
  // js/ui/detail-tabs.js の関数宣言が単体テスト用スタブより後で評価されるので上書きする。
  ctx.specialJobUnlockText = () => "試練達成";
  ctx.buildJobCard = (c,id) => { const node = new Element("button"); node.textContent = jobs[id].name; return node; };
  ctx.renderCharDetail = () => { current = ctx.buildJobTab(character); };
  ctx.renderCharDetail();
  return {ctx,character,get root() {return current;}, get shopArgs(){return openedShop;}};
}
test("初期は現在のジョブ区分のみ展開、基本・上級・特殊職の見出しを個別に折りたためる",()=>{
  const ui = setup();
  assert.equal(cls(ui.root,"job-accordion").length,3);
  assert.equal(section(ui.root,"basic").children[1].hidden,true);
  assert.equal(section(ui.root,"advanced").children[1].hidden,false);
  assert.equal(section(ui.root,"special").children[1].hidden,true);
  const basicButton = section(ui.root,"basic").children[0];
  assert.equal(basicButton.tagName,"button");
  assert.equal(basicButton.attrs["aria-expanded"],"false");
  assert.equal(basicButton.attrs["aria-controls"],section(ui.root,"basic").children[1].id);
  basicButton.click();
  assert.equal(section(ui.root,"basic").children[1].hidden,false);
  assert.equal(section(ui.root,"basic").children[0].attrs["aria-expanded"],"true");
  assert.equal(section(ui.root,"advanced").children[1].hidden,false,"他セクションは維持");
  section(ui.root,"advanced").children[0].click();
  assert.equal(section(ui.root,"advanced").children[1].hidden,true);
  assert.equal(section(ui.root,"basic").children[1].hidden,false);
  section(ui.root,"special").children[0].click();
  assert.equal(section(ui.root,"special").children[1].hidden,false);
});
test("購入済みなら基本職見出しの横に指定文言だけを出し、折りたたんでも見える",()=>{
  const ui = setup({purchased:true});
  const basic = section(ui.root,"basic");
  assert.equal(basic.children[1].hidden,true);
  const badges = cls(basic.children[0],"job-pass-purchased");
  assert.equal(badges.length,1);
  assert.equal(badges[0].textContent,"基本職育成パス:購入済み");
  assert.match(text(basic.children[0]),/^基本職基本職育成パス:購入済み2\/2/);
  assert.equal(text(basic.children[1]).includes("購入済み"),false,"下部に購入済み説明を重複表示しない");
  assert.equal(cls(ui.root,"job-unpurchased").length,0);
});
test("未購入なら購入済みバッジを出さず、基本職展開中にショップへの導線を残す",()=>{
  const ui = setup({purchased:false});
  assert.equal(cls(ui.root,"job-pass-purchased").length,0);
  const basic = section(ui.root,"basic");
  assert.equal(basic.children[1].hidden,true);
  basic.children[0].click();
  assert.match(text(section(ui.root,"basic").children[1]),/基本職育成パス：未購入/);
  const shop = descendants(section(ui.root,"basic"), x => x.textContent === "ショップで確認")[0];
  assert.ok(shop);
  shop.click();
  assert.equal(JSON.stringify(ui.shopArgs),JSON.stringify(["screen-chardetail","basic_job_max_pass"]));
});
test("ショップ非表示ならパス文言もリンクも出さず、基本職カードは維持",()=>{
  const ui = setup({shop:false,purchased:true,job:"warrior"});
  assert.equal(section(ui.root,"basic").children[1].hidden,false);
  assert.equal(cls(ui.root,"job-pass-purchased").length,0);
  assert.equal(cls(ui.root,"job-unpurchased").length,0);
  assert.equal(cls(section(ui.root,"basic"),"job-card-grid")[0].children.length,2);
  assert.equal(cls(section(ui.root,"advanced"),"job-card-grid")[0].children.length,2);
});
test("特殊職が無効の場合は余計な見出しを生成せず、購入後もジョブロック判定を変更しない",()=>{
  const ui = setup({special:false,purchased:true});
  assert.equal(section(ui.root,"special"),undefined);
  assert.equal(cls(ui.root,"job-accordion").length,2);
  const source=fs.readFileSync(path.join(__dirname,"../js/ui/detail-tabs.js"),"utf8");
  assert.match(source,/buildJobCard\(c, jobId, jobUnlocked\(c, jobId\)\)/);
  assert.match(source,/jobAccordionState\(c\)\[jobCategoryOf\(jobId\)\] = true/);
});
test("iPhone向け折りたたみCSSとキャッシュ番号が更新されている",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../css/style.css"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  assert.match(css,/\.job-accordion-content\[hidden\]/);
  assert.match(css,/\.job-pass-purchased/);
  assert.match(html,/css\/style\.css\?v=88/);
  assert.match(html,/js\/ui\/detail-tabs\.js\?v=21/);
});

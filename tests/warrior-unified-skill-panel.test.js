"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../tools/lib/load-data.js").loadGameData();

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.disabled = false;
    this.clientWidth = 320;
    this.clientHeight = 320;
    this.classList = {
      add: (name) => { this.className += " " + name; },
      remove: (name) => { this.className = this.className.split(" ").filter(x => x !== name).join(" "); },
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === "class") this.className = String(value); }
  addEventListener(key, handler) { this.listeners[key] = handler; }
  getBoundingClientRect() { return { left:0, top:0, width:320, height:320 }; }
  click() { this.listeners.click?.(); }
}
function all(root, className) {
  const out = [];
  function visit(node) {
    if (node.className.split(" ").includes(className)) out.push(node);
    for (const child of node.children) visit(child);
  }
  visit(root);
  return out;
}
function boot() {
  const calls = { render:0, save:0, swap:[], learn:[] };
  const st = {exclusiveRanks:{w1:1,w2:1,w3:1},general:{
    slot1:{treeId:"offense",ranks:{}},
    slot2:{treeId:"defense",ranks:{}},
    slot3:{treeId:"support",ranks:{}},
  }};
  const context = vm.createContext({
    document:{
      createElement:tag=>new Element(tag),
      createElementNS:(_,tag)=>new Element(tag),
      getElementById:()=>null,
    },
    S:{material:99999},
    treeSelectedNode:null,
    treeSwapConfirm:null,
    jobDef:c=>({name:c.job === "warrior" ? "戦士" : "剣豪"}),
    getExclusiveTree:()=>data.EXCLUSIVE_TREES.warrior,
    getTreeState:()=>st,
    getGeneralTree:id=>data.GENERAL_TREES[id],
    GENERAL_SLOTS:data.GENERAL_SLOTS,
    totalSp:()=>100,
    totalSpentSp:()=>3,
    availableSp:()=>97,
    canAcquireNode:(c,tree,ranks,node)=>{
      if (node.reqLevel>c.level) return false;
      if ((node.prerequisites||[]).some(pre=>(ranks[pre.nodeId]||0)<pre.minRank)) return false;
      if (node.exclusiveGroup && tree.nodes.some(other=>other.id!==node.id&&
        other.exclusiveGroup===node.exclusiveGroup&&(ranks[other.id]||0)>0)) return false;
      return true;
    },
    acquireNode:(c,tree,ranks,node)=>{ ranks[node.id]=1; calls.learn.push(node.id); return true; },
    isTeamLocked:()=>false,
    treeResetCost:()=>90,
    canResetTree:()=>true,
    resetTree:()=>{},
    swapGeneralSlot:(_c, key)=>{
      calls.swap.push(key);
      const slot=data.GENERAL_SLOTS.find(s=>s.key===key);
      const current=st.general[key].treeId;
      st.general[key].treeId=slot.candidates.find(v=>v!==current);
      st.general[key].ranks={};
    },
    confirmReady:()=>true,
    armConfirm:()=>{},
    renderCharDetail:()=>{calls.render++;},
    scheduleSave:()=>{calls.save++;},
  });
  for (const name of ["detail-tree.js","skill-panel-board.js","skill-panel-unified.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui", name),"utf8"),context,{filename:name});
  }
  const c={id:"a",name:"ロイ",job:"warrior",level:99,team:null};
  return {context,c,calls,st};
}
function showIntegrated(b) {
  b.context.buildTreeTab(b.c);
  vm.runInContext('warriorBoardMode="hex"',b.context);
  return b.context.buildTreeTab(b.c);
}

test("剣/杖/体/盾/足/腕のアイコンはスキルの正本効果で決まる",()=>{
  const {context}=boot();
  const f=node=>context.unifiedSkillIconForNode(node);
  assert.equal(f({kind:"active",ability:{kind:"physical"}}),"blade");
  assert.equal(f({kind:"active",ability:{kind:"magic"}}),"staff");
  assert.equal(f({kind:"active",ability:{kind:"heal"}}),"staff");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"hp"}]}),"body");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"mp"}]}),"staff");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"def"}]}),"tower");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"spd"}]}),"foot");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"atk"}]}),"arm");
  assert.equal(f({kind:"passive",effects:[{type:"statAdd",stat:"mag"}]}),"staff");
  assert.equal(f(data.EXCLUSIVE_TREES.warrior.nodes.find(n=>n.id==="w3")),"blade");
  assert.equal(f(data.GENERAL_TREES.speed.nodes.find(n=>n.id==="gs1")),"foot");
  assert.equal(f(data.GENERAL_TREES.support.nodes.find(n=>n.id==="gu4")),"staff","MP増強は魔法系");
  assert.equal(f(data.EXCLUSIVE_TREES.magic.nodes.find(n=>n.id==="m5")),"staff","魔力強化も杖");
  assert.equal(f(data.EXCLUSIVE_TREES.healer.nodes.find(n=>n.id==="h8")),"staff","属性付与も杖");
  assert.equal(f(data.EXCLUSIVE_TREES.warrior.nodes.find(n=>n.id==="w8")),"blade","物理支援技は剣");
});

test("統合表示に固有17と汎用3枠各6、覚醒の予約3段を収容し旧4タブを非表示",()=>{
  const b=boot();
  const root=showIntegrated(b);
  assert.equal(all(root,"unified-skill-screen").length,1);
  assert.equal(all(root,"crest-focus-tabs").length,0,"統合盤に個別タブは置かない");
  assert.equal(all(root,"unified-zone").length,4);
  assert.equal(all(root,"unified-hex-node").length,35);
  assert.equal(all(root,"unified-awakening-step").length,3);
  assert.equal(all(root,"unified-hex-node").filter(n=>n.attrs["data-glyph"]==="blade").length>=1,true);
  assert.equal(all(root,"crest-inline-detail").length,1);
  assert.equal(all(root,"crest-learn-btn").length,0,"既に習得済みの剣撃突きはボタンなし");
  assert.equal(b.context.treeSelectedNode.nodeId,"w3");
  const heading=all(root,"unified-awakening-label")[0].textContent;
  assert.match(heading,/準備中/);
  assert.equal(all(root,"unified-awakening-step").every(n=>n.tagName==="div"&&!n.listeners.click),true);
});

test("1枚盤から汎用スキルを選んで下部詳細から習得できる",()=>{
  const b=boot();
  let screen=showIntegrated(b);
  const general=all(screen,"unified-hex-node").find(n=>n.attrs["data-scope"]==="slot1");
  assert.ok(general);
  general.click();
  assert.equal(b.context.treeSelectedNode.scope,"slot1");
  assert.equal(b.context.treeSelectedNode.nodeId,"go1");
  screen=b.context.buildTreeTab(b.c);
  assert.match(all(screen,"unified-detail-source")[0].textContent,/汎用Ⅰ/);
  const learn=all(screen,"crest-learn-btn");
  assert.equal(learn.length,1);
  assert.equal(learn[0].disabled,false);
  learn[0].click();
  assert.equal(b.st.general.slot1.ranks.go1,1);
  assert.deepEqual(b.calls.learn,["go1"]);
  assert.equal(b.calls.save,1);
});

test("汎用フィルターとツリー交換は既存枠の正本を変更するだけ",()=>{
  const b=boot();
  let screen=showIntegrated(b);
  const filter=all(screen,"unified-filter").find(n=>n.textContent==="汎Ⅱ");
  filter.click();
  screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"unified-zone").length,1);
  assert.equal(all(screen,"unified-zone--slot2").length,1);
  const swap=all(screen,"unified-swap")[0];
  assert.ok(swap);
  swap.click();
  screen=b.context.buildTreeTab(b.c);
  assert.match(all(screen,"unified-swap")[0].textContent,/交換を確定/);
  all(screen,"unified-swap")[0].click();
  assert.equal(b.st.general.slot2.treeId,"vampiric");
  assert.deepEqual(b.calls.swap,["slot2"]);
  assert.equal(b.calls.save,1);
});

test("旧盤面に戻せる。スキル正本、保存形式、覚醒ステータスを変更しない",()=>{
  const b=boot(),before=JSON.stringify(data.EXCLUSIVE_TREES.warrior);
  const screen=showIntegrated(b);
  const back=all(screen,"unified-legacy")[0];
  back.click();
  const legacy=b.context.buildTreeTab(b.c);
  assert.equal(all(legacy,"crest-focus-tab").length,4);
  assert.equal(all(legacy,"unified-zone").length,0);
  assert.equal(JSON.stringify(data.EXCLUSIVE_TREES.warrior),before);
  assert.equal(Object.hasOwn(b.st,"awakeningTier"),false);
});


test("統合パネルの6分類は専用SVGで表示され、小さい画面でも形を保つ", () => {
  const b = boot();
  const icons = ["blade", "body", "tower", "foot", "arm", "staff"];
  for (const icon of icons) {
    const svg = b.context.createUnifiedSkillGlyph(icon);
    assert.ok(svg.className.includes("unified-icon-glyph"), icon);
    assert.equal(svg.attrs.viewBox, "0 0 32 32");
    assert.equal(svg.attrs.preserveAspectRatio, "xMidYMid meet");
    assert.ok(svg.children.length >= 2, icon + " は識別可能な複数要素を持つ");
    assert.ok(svg.children.every((path) => path.attrs.d && path.attrs.class.startsWith("unified-icon-")));
  }
  const screen = showIntegrated(b);
  const nodes = all(screen, "unified-hex-node");
  assert.equal(nodes.length, 35);
  assert.equal(all(screen, "unified-icon-glyph").length, 35);
  assert.equal(all(screen, "unified-hex-node").filter(n => n.attrs["data-glyph"] === "arm").length > 0, true);
  const css = fs.readFileSync(path.join(__dirname, "../css/skill-panel-unified.css"), "utf8");
  assert.match(css, /\.unified-hex-node \.unified-icon-glyph\s*\{[^}]*width: calc\(76% - 2px\);[^}]*height: calc\(76% - 2px\);/);
  assert.match(css, /preserveAspectRatio|aspect-ratio: 1 \/ 1/);
  assert.match(css, /dimmed:not\(\.selected\)\s*\{ opacity: \.48;/);
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /css\/skill-panel-unified\.css\?v=\d+/);
  assert.match(html, /js\/ui\/skill-panel-unified\.js\?v=\d+/);
});

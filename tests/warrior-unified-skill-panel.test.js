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
    jobDef:c=>data.JOBS[c.job],
    getExclusiveTree:c=>data.EXCLUSIVE_TREES[data.jobTag(c.job)] || null,
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
  const arm = b.context.createUnifiedSkillGlyph("arm");
  assert.equal(arm.children.filter((p) => p.attrs.class === "unified-icon-solid").length, 2,
    "腕は拳と力こぶの2つのシルエットで表す");
  assert.match(arm.children.find((p) => p.attrs.class === "unified-icon-detail").attrs.d, /M7 24c3-4/,
    "腕には力こぶを識別する陰影線がある");
  const staff = b.context.createUnifiedSkillGlyph("staff");
  assert.equal(staff.children.length, 3, "小サイズで潰れないシンプルな3要素");
  assert.match(staff.children[0].attrs.d, /M7 4C4 11/,
    "杖の上部は魔法球を抱える三日月状の飾り");
  assert.match(staff.children[1].attrs.d, /M12\.5 9a3\.5/,
    "中心に魔法球を描く");
  assert.match(staff.children[2].attrs.d, /M16 17v12/,
    "柄は斜めではなく縦に伸びる");
  const screen = showIntegrated(b);
  const nodes = all(screen, "unified-hex-node");
  assert.equal(nodes.length, 35);
  assert.equal(all(screen, "unified-icon-glyph").length, 35);
  assert.equal(all(screen, "unified-hex-node").filter(n => n.attrs["data-glyph"] === "arm").length > 0, true);
  const css = fs.readFileSync(path.join(__dirname, "../css/skill-panel-unified.css"), "utf8");
  assert.match(css, /\.unified-hex-node \.unified-icon-glyph\s*\{[^}]*width: 70%;[^}]*height: 70%;/);
  assert.match(css, /preserveAspectRatio|aspect-ratio: 1 \/ 1/);
  assert.match(css, /dimmed:not\(\.selected\)\s*\{ opacity: \.48;/);
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /css\/skill-panel-unified\.css\?v=\d+/);
  assert.match(html, /js\/ui\/skill-panel-unified\.js\?v=\d+/);
});


test("分岐のチップは六角形背景のクリップを受けず表示できる", () => {
  const b = boot();
  const screen = showIntegrated(b);
  const nodes = all(screen, "unified-hex-node");
  const choiceNodes = nodes.filter((node) => node.className.includes("choice-node"));
  assert.ok(choiceNodes.length >= 2, "分岐を持つパネルには個別の識別クラスを付与");
  assert.ok(choiceNodes.every((node) => node.children.some((child) =>
    child.className === "unified-hex-choice")), "チップは選択可能ボタンの子要素のまま");
  assert.equal(all(screen, "unified-hex-choice").length, choiceNodes.length);
  const css = fs.readFileSync(path.join(__dirname, "../css/skill-panel-unified.css"), "utf8");
  const buttonRule = css.match(/\.unified-hex-node\s*\{([^}]*)\}/);
  assert.ok(buttonRule);
  assert.doesNotMatch(buttonRule[1], /clip-path/, "ボタン全体を六角で切り抜かない");
  assert.match(css, /\.unified-hex-node::before\s*\{[^}]*clip-path:/,
    "六角形背景だけを切り抜く");
  assert.match(css, /\.unified-hex-node\.choice-node:not\(\.selected\)\s*\{ z-index: 3;/,
    "他ノードより分岐チップを前面表示");
  const first = choiceNodes[0];
  first.click();
  assert.equal(b.context.treeSelectedNode.scope, first.attrs["data-scope"]);
  assert.equal(b.calls.render, 1, "チップ付きノードの選択動作を維持");
});


test("戦士以外の基本・上級・特殊職12職で統合盤を既定表示し、実スキル17+汎用18を欠落させない",()=>{
  const seen = [];
  for (const [tag, jobs] of Object.entries(data.JOB_TAGS)) {
    for (const job of jobs) {
      if (job === "warrior") continue;
      const b = boot();
      b.c.job = job;
      b.c.id = "test-" + job;
      const tree = data.EXCLUSIVE_TREES[tag];
      const before = JSON.stringify(tree);
      const screen = b.context.buildTreeTab(b.c);
      assert.equal(all(screen,"unified-skill-screen").length,1,job+" 統合盤");
      assert.equal(all(screen,"crest-focus-tabs").length,0,job+" 旧4タブを廃止");
      assert.equal(all(screen,"unified-zone").length,4,job+" 固有+汎用3枠");
      assert.equal(all(screen,"unified-awakening-step").length,3,job+" 覚醒Ⅰ〜Ⅲは予約枠");
      const exclusive = all(screen,"unified-hex-node").filter(n=>n.attrs["data-scope"]==="exclusive");
      assert.equal(exclusive.length,tree.nodes.length,job+" 固有の全ノード");
      assert.equal(all(screen,"unified-hex-node").length,tree.nodes.length+18,job+" 総パネル数");
      assert.ok(exclusive.every(n=>n.children.some(c=>c.className==="unified-hex-face")),job+" 専用アイコン");
      assert.equal(b.context.treeSelectedNode.scope,"exclusive",job);
      assert.ok(tree.nodes.some(n=>n.id===b.context.treeSelectedNode.nodeId),job+" 初期選択");
      assert.equal(JSON.stringify(tree),before,job+" スキル正本は変更しない");
      assert.equal(Object.hasOwn(b.st,"awakeningTier"),false,job+" 覚醒セーブなし");
      seen.push(job);
    }
  }
  assert.equal(seen.length,12,"戦士以外の全職を網羅");
});

test("職業を変えたら旧フィルターと選択ノードを引き継がず全体盤に戻す",()=>{
  const b=boot();
  b.c.job="mage";
  let screen=b.context.buildTreeTab(b.c);
  const filter=all(screen,"unified-filter").find(n=>n.textContent==="汎Ⅲ");
  filter.click();
  screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"unified-zone").length,1);
  b.c.job="priest";
  b.c.id="next-character";
  screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"unified-zone").length,4);
  assert.equal(all(screen,"unified-hex-node").filter(n=>n.attrs["data-scope"]==="exclusive").length,
    data.EXCLUSIVE_TREES.healer.nodes.length);
  assert.ok(data.EXCLUSIVE_TREES.healer.nodes.some(n=>n.id===b.context.treeSelectedNode.nodeId));
});

test("他職も旧盤面に戻してから再び統合盤に復帰でき、習得ロジックは共通",()=>{
  const b=boot();
  b.c.job="mage";
  let screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"unified-legacy").length,1);
  all(screen,"unified-legacy")[0].click();
  screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"crest-focus-tab").length,4,"従来の4タブに戻る");
  const switcher=all(screen,"hex-panel-mode").find(n=>n.textContent==="統合パネル");
  assert.ok(switcher,"旧盤面から戻る切替を提供");
  switcher.click();
  screen=b.context.buildTreeTab(b.c);
  assert.equal(all(screen,"unified-zone").length,4);
  assert.equal(b.calls.save,0,"表示切替では保存しない");
  const first=all(screen,"unified-hex-node").find(n=>n.attrs["data-scope"]==="exclusive" &&
    n.attrs["data-glyph"]==="staff");
  assert.ok(first,"魔法職のスキルを杖で描画");
  first.click();
  assert.equal(b.context.treeSelectedNode.scope,"exclusive");
  const selected=b.context.treeSelectedNode.nodeId;
  assert.ok(data.EXCLUSIVE_TREES.magic.nodes.some(n=>n.id===selected),"魔法職の正しいノードを選ぶ");
  assert.equal(b.calls.save,0,"ノード選択でも保存しない");
});

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
function boot(job = "warrior") {
  const calls = { render:0, save:0, swap:[], learn:[] };
  const st = {exclusiveRanks:job === "warrior" ? {w1:1,w2:1,w3:1} : {},general:{
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
    jobDef:c=>data.JOBS[c.job] || {name:c.job},
    getExclusiveTree:c=>data.EXCLUSIVE_TREES[data.jobTag(c.job)],
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
  const c={id:"a",name:"ロイ",job,level:99,team:null};
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


test("全13ジョブで統合盤を初期表示し、固有17＋汎用18＋覚醒予約を欠けず表示", () => {
  const jobs = Object.values(data.JOBS).filter(j=>["basic","advanced","special"].includes(j.tier));
  assert.equal(jobs.length, 13);
  for(const job of jobs) {
    const b=boot(job.id);
    const original=JSON.stringify(data.EXCLUSIVE_TREES[data.jobTag(job.id)]);
    const root=b.context.buildTreeTab(b.c);
    assert.equal(all(root,"unified-skill-screen").length,1,job.id+" 統合盤");
    assert.equal(all(root,"unified-zone").length,4,job.id+" 固有＋汎用3");
    const nodes=all(root,"unified-hex-node");
    assert.equal(nodes.length,35,job.id+" スキル35個");
    assert.equal(nodes.filter(n=>n.attrs["data-scope"]==="exclusive").length,17,job.id+" 固有17個");
    assert.equal(all(root,"unified-icon-glyph").length,35,job.id+" アイコン欠けなし");
    assert.equal(all(root,"unified-awakening-step").length,3,job.id+" 覚醒ⅠⅡⅢ予約");
    assert.equal(all(root,"crest-focus-tabs").length,0,job.id+" 統合盤に旧4タブなし");
    assert.equal(JSON.stringify(data.EXCLUSIVE_TREES[data.jobTag(job.id)]),original,job.id+" 正本不変");
    assert.ok(b.context.treeSelectedNode?.nodeId,job.id+" 初期選択");
    assert.equal(Object.hasOwn(b.st,"awakeningTier"),false,job.id+" 覚醒保存データ追加なし");
  }
});

test("魔法使い・僧侶・盗賊・剣豪・巡礼剣士で選択/習得/旧盤面への切替と復帰",()=>{
  for(const id of ["mage","priest","thief","swordmaster","pilgrim"]){
    const b=boot(id);
    let root=b.context.buildTreeTab(b.c);
    const tree=data.EXCLUSIVE_TREES[data.jobTag(id)];
    const first=all(root,"unified-hex-node").find(n=>n.attrs["data-scope"]==="exclusive"&&
      n.title===tree.nodes[0].name);
    assert.ok(first,id+" の固有スキル");
    first.click();
    assert.equal(b.context.treeSelectedNode.scope,"exclusive");
    assert.equal(b.context.treeSelectedNode.nodeId,tree.nodes[0].id);
    root=b.context.buildTreeTab(b.c);
    assert.match(all(root,"unified-detail-source")[0].textContent,new RegExp(tree.name));
    const learn=all(root,"crest-learn-btn");
    assert.equal(learn.length,1,id+" 初期スキルの習得ボタン");
    assert.equal(learn[0].disabled,false);
    learn[0].click();
    assert.equal(b.st.exclusiveRanks[tree.nodes[0].id],1,id+" 固有スキル習得");
    assert.equal(b.calls.save,1,id+" 習得を保存");
    root=b.context.buildTreeTab(b.c);
    all(root,"unified-legacy")[0].click();
    root=b.context.buildTreeTab(b.c);
    assert.equal(all(root,"crest-focus-tab").length,4,id+" 旧盤面も利用可");
    assert.equal(all(root,"unified-zone").length,0);
    const toNew=all(root,"hex-panel-mode").find(n=>n.textContent==="統合パネル");
    assert.ok(toNew,id+" 統合へ戻るボタン");
    toNew.click();
    root=b.context.buildTreeTab(b.c);
    assert.equal(all(root,"unified-zone").length,4,id+" 統合盤に復帰");
  }
});

test("他職の分岐グループ・交換・習得可フィルターは戦士と同じロジック",()=>{
  const b=boot("mage");
  let root=b.context.buildTreeTab(b.c);
  const choices=all(root,"choice-node");
  assert.ok(choices.length>=6,"魔法使い固有の二択と汎用のチップ");
  assert.ok(choices.some(n=>n.children.some(child=>child.className==="unified-hex-choice")));
  all(root,"unified-filter").find(n=>n.textContent==="汎Ⅲ").click();
  root=b.context.buildTreeTab(b.c);
  assert.equal(all(root,"unified-zone").length,1);
  assert.equal(all(root,"unified-zone--slot3").length,1);
  const swap=all(root,"unified-swap")[0];
  swap.click();
  root=b.context.buildTreeTab(b.c);
  all(root,"unified-swap")[0].click();
  assert.equal(b.st.general.slot3.treeId,"arcane");
  assert.deepEqual(b.calls.swap,["slot3"]);
  assert.equal(b.calls.save,1);
  all(b.context.buildTreeTab(b.c),"unified-filter").find(n=>n.textContent==="習得可").click();
  root=b.context.buildTreeTab(b.c);
  assert.equal(all(root,"unified-zone").length,4);
  assert.ok(all(root,"unified-hex-node").some(n=>n.className.includes("dimmed")));
});

test("キャラ送りで前職の選択ノードと表示フィルターを引き継がない",()=>{
  const b=boot("mage");
  const first=b.context.buildTreeTab(b.c);
  all(first,"unified-filter").find(n=>n.textContent==="汎Ⅱ").click();
  let root=b.context.buildTreeTab(b.c);
  assert.equal(all(root,"unified-zone").length,1);
  b.c={...b.c,id:"b",job:"priest"};
  root=b.context.buildTreeTab(b.c);
  assert.equal(all(root,"unified-zone").length,4,"別ジョブで全体に戻す");
  assert.equal(all(root,"unified-filter").find(n=>n.textContent==="全体").attrs["aria-pressed"],"true");
  const priestTree=data.EXCLUSIVE_TREES.healer;
  assert.ok(priestTree.nodes.some(n=>n.id===b.context.treeSelectedNode.nodeId),
    "別職のノードを自動選択");
});

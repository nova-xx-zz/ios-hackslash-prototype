"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../tools/lib/load-data.js").loadGameData();

class Element {
  constructor(tag) {
    this.tagName=tag; this.className=""; this.style={}; this.attrs={};
    this.children=[]; this.listeners={}; this.textContent=""; this.clientWidth=320; this.clientHeight=320;
    this.classList={add:(x)=>{this.className+=" "+x;},remove:()=>{}};
  }
  appendChild(child){this.children.push(child);return child;}
  addEventListener(event,handler){this.listeners[event]=handler;}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==="class")this.className=String(v);}
  getBoundingClientRect(){return {left:0,top:0,width:320,height:320};}
  click(){this.listeners.click?.();}
}
const find=(root,cls)=>{
  const out=[];
  const walk=(x)=>{if(x.className.split(" ").includes(cls))out.push(x);x.children.forEach(walk);};
  walk(root);return out;
};
function renderContext(){
  const slots=["slot1","slot2","slot3"];
  const ids=["offense","defense","support"];
  const state={exclusiveRanks:{w1:1,w2:1,w3:1},general:Object.fromEntries(slots.map((key,i)=>[key,{treeId:ids[i],ranks:{}}]))};
  const ctx=vm.createContext({
    document:{createElement:(tag)=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),getElementById:()=>null},
    S:{material:9999},treeSelectedNode:null,treeSwapConfirm:null,
    getExclusiveTree:()=>data.EXCLUSIVE_TREES.warrior,
    getTreeState:()=>state,
    GENERAL_SLOTS:slots.map((key,i)=>({key,label:"汎用"+i,candidates:[ids[i],["speed","vampiric","arcane"][i]]})),
    getGeneralTree:(id)=>data.GENERAL_TREES[id],jobDef:()=>({name:"戦士"}),
    totalSp:()=>98,totalSpentSp:()=>9,availableSp:()=>89,treeResetCost:()=>180,canResetTree:()=>true,
    isTeamLocked:()=>false,resetTree:()=>{},swapGeneralSlot:()=>{},
    scheduleSave:()=>{},renderCharDetail:()=>{},confirmReady:()=>true,armConfirm:()=>{},
    canAcquireNode:(c,t,r,n)=>c.level>=n.reqLevel&&(n.prerequisites||[]).every(p=>(r[p.nodeId]||0)>=p.minRank),
    acquireNode:()=>true,
  });
  for(const name of ["detail-tree.js","skill-panel-board.js","unified-skill-board.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/ui",name),"utf8"),ctx);
  }
  vm.runInContext('warriorBoardMode="hex"',ctx);
  return {ctx,state,c:{id:"hero",job:"warrior",level:99,team:null}};
}
test("統合盤: 固有17＋汎用18と覚醒予約3枠",()=>{
  const {ctx,c}=renderContext(),tab=ctx.buildTreeTab(c);
  assert.equal(find(tab,"unified-node").length,35);
  assert.equal(find(tab,"unified-awakening-placeholder").length,3);
  assert.equal(find(tab,"crest-focus-tabs").length,0);
  assert.equal(find(tab,"unified-filter").length,5);
  assert.equal(find(tab,"crest-inline-detail").length,1);
});
test("アイコン: 技は剣、魔法は杖、ステータスは体・盾・足・腕",()=>{
  const {ctx,c}=renderContext(),tab=ctx.buildTreeTab(c);
  const nodes=find(tab,"unified-node");
  const type=(name)=>nodes.find(n=>n.title===name)?.attrs["data-icon-type"];
  assert.equal(type("剣撃突き"),"sword");
  assert.equal(type("鍛えた腕"),"arm");
  assert.equal(type("鉄の肌"),"shield");
  assert.equal(type("頑強"),"body");
  assert.equal(ctx.unifiedSkillIconType(data.GENERAL_TREES.speed.nodes[0]),"foot");
  assert.equal(ctx.unifiedSkillIconType(data.EXCLUSIVE_TREES.magic.nodes[2]),"staff");
});
test("汎用を選択しても統合盤内に残り、各系統の詳細を表示",()=>{
  const {ctx,c}=renderContext();
  const tab=ctx.buildTreeTab(c);
  const target=find(tab,"unified-node").find(n=>n.title==="会心の芽生え");
  target.click();
  assert.equal(ctx.treeSelectedNode.scope,"slot1");
  const chosen=ctx.buildTreeTab(c);
  assert.equal(find(chosen,"unified-node").length,35);
  assert.equal(find(chosen,"warrior-crest-detail").length,1);
  assert.equal(find(chosen,"unified-swap-btn").length,1);
});
test("描画しても既存ゲームデータ・セーブ形式は不変",()=>{
  const {ctx,c,state}=renderContext(),old=JSON.stringify(state);
  ctx.buildTreeTab(c);
  assert.equal(JSON.stringify(state),old);
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  assert.match(html,/unified-skill-board\.js\?v=\d+/);
});

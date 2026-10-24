"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const Rewards=require("../js/core/rewards.js");
const Organize=require("../js/core/inventory-organize.js");
class Element {
 constructor(tag="div"){
  this.tagName=tag;this.children=[];this.textContent="";this.className="";this.style={};
  this.listeners={};this.scrollTop=0;this.disabled=false;this.title="";
  this.classList={
   contains:n=>this.className.split(" ").includes(n),
   toggle:(name,force)=>{
    const names=new Set(this.className.split(" ").filter(Boolean));
    const on=force===undefined?!names.has(name):force;
    if(on)names.add(name);else names.delete(name);
    this.className=[...names].join(" ");
   },
   add:name=>{const a=new Set(this.className.split(" ").filter(Boolean));a.add(name);this.className=[...a].join(" ");}
  };
 }
 set innerHTML(v){assert.equal(v,"");this.children=[];}
 appendChild(v){this.children.push(v);return v;}
 setAttribute(name,value){this[name]=String(value);}
 addEventListener(name,fn){this.listeners[name]=fn;}
 click(){if(!this.disabled)this.listeners.click?.();}
}
const descend=(node,pred)=>{
 const found=[];const visit=n=>{if(pred(n))found.push(n);for(const c of n.children)visit(c);};visit(node);return found;
};
function setup(safeItems=135){
 const ids={},doc={getElementById:id=>ids[id]||(ids[id]=new Element()),createElement:t=>new Element(t)};
 const items=[];
 const mk=(id,over={})=>({id,name:id,slot:"weapon",rarity:"n",plus:0,materialValue:5,stats:{atk:1},options:[],...over});
 for(let i=0;i<safeItems;i++)items.push(mk("safe-"+i));
 for(let i=0;i<20;i++)items.push(mk("high-"+i,{options:[{key:"exp",value:.2}]}));
 for(let i=0;i<4;i++)items.push(mk("locked-"+i,{locked:true}));
 for(let i=0;i<3;i++)items.push(mk("ur-"+i,{rarity:"ur"}));
 for(let i=0;i<5;i++)items.push(mk("r-"+i,{rarity:"r",materialValue:20}));
 const state={inventory:items,skillBooks:[{id:"book",rarity:"sr"}],material:0};
 const rarities=[{key:"n",color:"white",material:5},{key:"r",color:"blue",material:20},{key:"sr",color:"green",material:80},{key:"ur",color:"purple",material:350},{key:"lr",color:"gold",material:1500}];
 let saved=0;
 const inventory={
  disassembleValue:i=>i.materialValue,
  disassembleItems:selection=>{
   let count=0,materialGained=0;
   for(const i of selection){
    const idx=state.inventory.indexOf(i);
    if(idx<0||i.locked)continue;
    state.inventory.splice(idx,1);count++;materialGained+=i.materialValue;
   }
   state.material+=materialGained;return {count,materialGained};
  },
  setLocked:(i,locked)=>{i.locked=locked;}
 };
 const globals={
  document:doc,S:state,SLOTS:[{key:"weapon",name:"武器"},{key:"body",name:"胴"}],
  RARITIES:rarities,QPCore:{rewards:Rewards,inventoryOrganize:Organize},
  Inventory:inventory,sectionLabel:txt=>{const e=new Element();e.textContent=txt;return e;},
  itemEffectiveValue:i=>i.stats?.atk||0,rarityColor:r=>r,itemLabel:i=>i.name,
  itemEffectText:()=>"",itemOptionsText:i=>i.options?.map(x=>x.key).join(",")||"",
  SLOT_ICONS:{weapon:"剣"},store:{},scheduleSave:()=>{saved++;},saveGame:()=>{saved++;},
  showScreen:()=>{},openPartyMenu:()=>{},renderJobsScreen:()=>{},armConfirm:()=>{},confirmReady:()=>true,
 };
 const c=vm.createContext(globals);
 const src=fs.readFileSync(path.join(__dirname,"../js/ui/inventory.js"),"utf8");
 vm.runInContext(src,c,{filename:"js/ui/inventory.js"});
 return {c,ids,items,state,get saved(){return saved;}};
}
test("200件近い所持品でも80件だけ描画し、追加ボタンと価値フィルタが機能する",()=>{
 const {c,ids,state}=setup();
 c.renderInventoryScreen();
 const body=ids.inventoryBody;
 assert.equal(descend(body,x=>x.className.split(" ").includes("skill-row")).length,80);
 const more=descend(body,x=>x.textContent.startsWith("さらに表示"))[0];
 assert.ok(more);body.scrollTop=123;more.click();
 assert.equal(body.scrollTop,123,"additional rows must not throw the user back to the list top");
 assert.equal(descend(body,x=>x.className.split(" ").includes("skill-row")).length,160);
 const valuable=ids.inventoryManageRow.children.find(x=>x.textContent==="保護・貴重");
 valuable.click();
 assert.equal(descend(body,x=>x.className.split(" ").includes("skill-row")).length,27);
 assert.ok(ids.inventoryCount.textContent.includes("条件一致 27個"));
 assert.equal(state.inventory.length,167);
});
test("整理候補の一括分解はロック/高OP/高レアを選ばず、2段階確認して保存",()=>{
 const x=setup(),{c,ids,state}=x;c.renderInventoryScreen();
 ids.inventoryManageRow.children.find(e=>e.textContent==="整理候補").click();
 ids.btnInventoryDisassemble.click();
 const all=ids.inventoryBulkRow.children.find(e=>e.textContent==="安全候補すべて (140)");
 assert.ok(all);all.click();
 const chosen=vm.runInContext("[...disassembleSelection].map(i=>i.id)",c);
 assert.equal(chosen.length,140);
 assert.ok(chosen.every(id=>id.startsWith("safe-")||id.startsWith("r-")));
 const count=state.inventory.length;
 ids.btnDisassembleConfirm.click();
 assert.equal(state.inventory.length,count,"初回操作は確認だけ");
 assert.ok(ids.inventoryDisassembleSummary.textContent.includes("140個を選択中"));
 ids.btnDisassembleConfirm.click();
 assert.equal(state.inventory.length,27);
 assert.equal(state.material,135*5+5*20);
 assert.ok(state.inventory.some(i=>i.id==="high-0"));
 assert.ok(state.inventory.some(i=>i.id==="ur-0"));
 assert.ok(x.saved>0);
});
test("価値あり装備は一括選択不可、個別選択と明示確認では分解可能",()=>{
 const {c,ids,state}=setup();c.renderInventoryScreen();
 ids.inventoryManageRow.children.find(e=>e.textContent==="保護・貴重").click();
 ids.btnInventoryDisassemble.click();
 assert.equal(ids.inventoryBulkRow.children.find(e=>e.textContent.startsWith("安全候補すべて")).disabled,true);
 const high=descend(ids.inventoryBody,x=>x.className==="skill-row selectable"&&
   x.children.some(ch=>ch.className==="skill-row-name"&&ch.textContent.startsWith("high-")))[0];
 assert.ok(high);high.click();
 const chosen=vm.runInContext("[...disassembleSelection]",c);assert.equal(chosen.length,1);
 ids.btnDisassembleConfirm.click();
 assert.ok(ids.inventoryDisassembleSummary.textContent.includes("高品質OP 1個"));
 ids.btnDisassembleConfirm.click();
 assert.equal(state.inventory.includes(chosen[0]),false);
});

test("10,000件でも初回の所持品DOMは80行、絞り込みと一括選択でデータを失わない",()=>{
 const {performance}=require("node:perf_hooks");
 const x=setup(10000),{c,ids,state}=x;
 const now=performance.now();
 c.renderInventoryScreen();
 const elapsed=performance.now()-now;
 const body=ids.inventoryBody;
 assert.equal(descend(body,e=>e.className.split(" ").includes("skill-row")).length,80);
 assert.ok(ids.inventoryCount.textContent.includes("10033個"));
 assert.equal(state.inventory.length,10032);
 ids.inventoryManageRow.children.find(e=>e.textContent==="整理候補").click();
 assert.equal(descend(body,e=>e.className.split(" ").includes("skill-row")).length,80);
 ids.btnInventoryDisassemble.click();
 const all=ids.inventoryBulkRow.children.find(e=>e.textContent==="安全候補すべて (10005)");
 assert.ok(all);
 all.click();
 assert.equal(vm.runInContext("disassembleSelection.size",c),10005);
 assert.ok(state.inventory.some(i=>i.id==="high-0"));
 assert.ok(state.inventory.some(i=>i.id==="ur-0"));
 assert.equal(state.inventory.length,10032);
 console.log("INVENTORY_UI_LOAD "+JSON.stringify({
  inventory:state.inventory.length,firstRenderMs:+elapsed.toFixed(2),renderedRows:80,bulkSelection:10005
 }));
});
test("分解まとめて選ぶ: 普通・貴重を外して呪いだけにし、UR・LRの呪いだけを一括選択できる（10/24 #8）",()=>{
 const {c,ids,state}=setup(10);
 state.inventory.push({id:"ur-curse",name:"ur-curse",slot:"weapon",rarity:"ur",plus:0,cursed:true,materialValue:350,stats:{atk:1},options:[]},
  {id:"r-curse",name:"r-curse",slot:"weapon",rarity:"r",plus:0,cursed:true,materialValue:20,stats:{atk:1},options:[]},
  {id:"lr-curse-locked",name:"lr-curse-locked",slot:"weapon",rarity:"lr",plus:0,cursed:true,locked:true,materialValue:1500,stats:{atk:1},options:[]});
 c.renderInventoryScreen();
 ids.btnInventoryDisassemble.click();
 const chip=t=>ids.inventoryBulkRow.children.find(e=>e.textContent===t||e.textContent.startsWith(t));
 assert.ok(chip("普通を含む")&&chip("貴重を含まない")&&chip("呪いを含まない"));
 chip("呪いを含まない").click();
 chip("普通を含む").click();
 assert.ok(chip("普通を含まない"));
 assert.equal(chip("条件一致すべて").textContent,"条件一致すべて (2)","ロック中の呪いは含めない");
 chip("UR").click();
 assert.equal(ids.inventoryDisassembleSummary.textContent.startsWith("1個を選択中"),true);
 ids.btnDisassembleConfirm.click();ids.btnDisassembleConfirm.click();
 assert.deepEqual(state.inventory.filter(i=>i.cursed).map(i=>i.id).join(","),"r-curse,lr-curse-locked");
});
test("分解まとめて選ぶ: 普通を外すと、一度選んだ普通の装備は選択から外れる",()=>{
 const {c,ids}=setup(5);
 c.renderInventoryScreen();
 ids.btnInventoryDisassemble.click();
 const chip=t=>ids.inventoryBulkRow.children.find(e=>e.textContent.startsWith(t));
 chip("安全候補すべて").click();
 assert.ok(ids.inventoryDisassembleSummary.textContent.startsWith("10個を選択中"));
 chip("普通を含む").click();
 assert.equal(ids.inventoryDisassembleSummary.textContent,"分解するアイテムをタップして選んでください");
});

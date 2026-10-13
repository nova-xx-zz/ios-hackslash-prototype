"use strict";
// DOMを簡易的に再現し、試作工房の実際のボタン押下とコアAPIの接続を検証する。
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const Gear=require("../js/core/forge-gear-trial.js");
const Loot=require("../js/core/loot-protection-trial.js");
const Rarity=require("../js/core/option-rarity-trial.js");
const Legacy=require("../js/core/option-inheritance-trial.js");

class Element {
  constructor(tag) {
    this.tag=tag;this.children=[];this.listeners={};this.textContent="";
    this.disabled=false;this.scrollTop=0;this.selected=false;this.value="";
  }
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,callback){this.listeners[name]=callback;}
  setAttribute(){}
  click(){assert.equal(this.disabled,false,"ボタンが無効化されています: "+this.textContent);assert.ok(this.listeners.click);this.listeners.click();}
}
function setup(storageValues) {
  const nodes={forgeTrialBody:new Element("div"),btnForgeTrialBack:new Element("button")};
  const saved=new Map(storageValues||[]);
  const context=vm.createContext({
    QPCore:{forgeGearTrial:Gear,lootProtectionTrial:Loot,optionRarityTrial:Rarity},
    document:{
      createElement:tag=>new Element(tag),
      getElementById:id=>nodes[id]
    },
    localStorage:{
      getItem:key=>saved.has(key)?saved.get(key):null,
      setItem:(key,value)=>saved.set(key,value)
    },
    window:{confirm:()=>true},
    showScreen:()=>{},
    openPartyMenu:()=>{}
  });
  const script=fs.readFileSync(path.join(__dirname,"../js/ui/forge-trial.js"),"utf8");
  vm.runInContext(script,context,{filename:"forge-trial.js"});
  vm.runInContext("openForgeTrial()",context);
  function find(text) {
    const scan=el=>{
      if(el.tag==="button"&&el.textContent.includes(text))return el;
      for(const child of el.children) {const found=scan(child);if(found)return found;}
      return null;
    };
    const found=scan(nodes.forgeTrialBody);
    assert.ok(found,"画面にボタンがない: "+text);
    return found;
  }
  function visibleText(){
    const texts=[];
    const scan=el=>{if(el.textContent)texts.push(el.textContent);for(const child of el.children)scan(child);};
    scan(nodes.forgeTrialBody);
    return texts.join(" ");
  }
  return {click:text=>find(text).click(),find,visibleText,
    state:()=>vm.runInContext("forgeTrialState",context),storage:saved};
}
test("画面からSRを+50へ強化し1穴、+99へ強化できる",()=>{
  const app=setup();
  const target=()=>app.state().targets.find(t=>t.id==="sr");
  app.click("試験強化 +50");
  assert.equal(target().plus,50);
  assert.equal(app.find("枠1を穴あけ").disabled,false);
  app.click("枠1を穴あけ");
  assert.equal(target().opened,1);
  app.click("試験強化 +99");
  assert.equal(target().plus,99);
  assert.equal(app.find("枠2を穴あけ").disabled,false,"天然OP1個のみなら2穴目が開けられる");
  app.click("枠2を穴あけ");
  assert.equal(target().opened,2);
  assert.equal(app.state().version,2);
});
test("画面で天然OP＋継承OPが満枠なら穴あけ不可と理由を表示、抽出後に解除",()=>{
  const app=setup();
  const target=()=>app.state().targets.find(t=>t.id==="sr");
  app.click("試験強化 +50");
  app.click("枠1を穴あけ");
  app.click("抽出する"); // R ブロンズソード ATK+5%
  app.click("通常継承");
  assert.equal(target().options[0].key,"atk");
  assert.equal(target().naturalOptions.length,1);
  app.click("試験強化 +99");
  assert.equal(app.find("枠2を穴あけ").disabled,true);
  assert.match(app.visibleText(),/天然OP.*上限2個/);
  app.click("天然OPを抽出");
  assert.equal(target().naturalOptions.length,0);
  assert.equal(app.find("枠2を穴あけ").disabled,false);
  app.click("枠2を穴あけ");
  assert.equal(target().opened,2);
  assert.equal(target().options.length,1,"既存の継承OPが残る");
  assert.equal(Gear.isValid(app.state()),true);
});
test("旧v1試作保存から復元した武器も強化できる",()=>{
  const old=Legacy.createDemo();
  Legacy.increasePlus(old,"sr",50);
  const oldSerialized=JSON.stringify(old);
  const app=setup([["swordcrest_forge_trial_v1",oldSerialized]]);
  assert.equal(app.state().version,2);
  assert.equal(app.state().targets.find(t=>t.id==="sr").plus,50);
  app.click("枠1を穴あけ");
  app.click("試験強化 +99");
  assert.equal(app.state().targets.find(t=>t.id==="sr").plus,99);
  assert.equal(app.storage.get("swordcrest_forge_trial_v1"),oldSerialized,"旧保存は維持する");
});

test("UIから希少OPの保護ON/OFFとSR/UR基準を切り替えられる",()=>{
  const app=setup();
  assert.match(app.visibleText(),/保持 5個 \/ 分解 3個 \/ 強化石 30個 \/ OP保護 4個/);
  app.click("希少OPの保護 ON");
  assert.match(app.visibleText(),/保持 1個 \/ 分解 7個 \/ 強化石 80個 \/ OP保護 0個/);
  app.click("希少OPの保護 OFF");
  app.click("保護基準 SR以上");
  assert.match(app.visibleText(),/保持 4個 \/ 分解 4個 \/ 強化石 35個 \/ OP保護 3個/);
});

test("画面で通常・ハード・エクストラを切替え、1,000件のOP抽選を実行できる",()=>{
  const app=setup();
  assert.match(app.visibleText(),/⑦ OPレアリティ・出現確率の試算/);
  assert.match(app.visibleText(),/ハード（候補）/);
  app.click("1,000個を試抽選");
  assert.match(app.visibleText(),/抽選 1,000件/);
  assert.match(app.visibleText(),/N武器＋SR以上OP/);
  app.click("エクストラ（候補）");
  assert.doesNotMatch(app.visibleText(),/抽選 1,000件/,"モード切替時は古い集計結果を消す");
  app.click("1,000個を試抽選");
  assert.match(app.visibleText(),/抽選 1,000件/);
  app.click("通常（候補）");
  assert.match(app.visibleText(),/天然OP付与率（試案） 10%/);
  app.click("10,000個を試抽選");
  assert.match(app.visibleText(),/抽選 10,000件/);
});
test("保護基準変更後には、古い抽選結果を残さず再試算する",()=>{
  const app=setup();
  app.click("1,000個を試抽選");
  assert.match(app.visibleText(),/抽選 1,000件/);
  app.click("保護基準 SR以上");
  assert.doesNotMatch(app.visibleText(),/抽選 1,000件/);
  app.click("1,000個を試抽選");
  assert.match(app.visibleText(),/保護基準 UR以上/);
});

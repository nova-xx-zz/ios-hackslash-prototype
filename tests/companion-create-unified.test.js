"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const create=fs.readFileSync(path.join(__dirname,"../js/ui/create.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../css/style.css"),"utf8");
const ui=fs.readFileSync(path.join(__dirname,"../css/create-unified.css"),"utf8");
test("生成・登録・選択の既存ゲーム動作を維持",()=>{
  for(const id of ["screen-create","createBody","btnCreateBack","btnCreateRandom","btnCreateConfirm","pickModal","btnPickModalOk"])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(create,/Shop\.canAddToRoster\(1\)/);assert.match(create,/S\.roster\.push\(c\)/);
  assert.match(create,/newCharacter\(name, draft\.job, draft\.race, \{ level: createStartLevel\(\) \}\)/);
  assert.match(create,/draft\[field\] = id;/);
  assert.match(create,/getElementById\("createBody"\)\.scrollTop = 0/);
  assert.doesNotThrow(()=>new vm.Script(create));
});
test("編成画面の共通フォント・背景・枠線に統一し、旧装飾を読み込まない",()=>{
  assert.match(html,/css\/style\.css\?v=61/);assert.match(html,/css\/create-unified\.css\?v=1/);
  assert.doesNotMatch(html,/create-ornate\.css|create-reference\.css|CREATE COMPANION|create-btn-icon/);
  assert.doesNotMatch(css,/仲間作成: ソードクレストのギルド登録帳/);
  assert.doesNotMatch(create,/create-ornate|pv-art|create-name-dice/);
  assert.match(ui,/border:1px solid var\(--border\)/);
  assert.match(ui,/background:rgba\(255,255,255,\.045\)/);
  assert.match(ui,/border-radius:12px/);
  assert.match(ui,/#pickModal \.modal-card/);
  assert.doesNotMatch(ui,/border-image-source|companion-corner|companion-preview-stilllife/);
});
test("コンパクトなプレビューとiPhone幅/高さに対応",()=>{
  assert.match(html,/class="roster-header create-header"/);assert.match(html,/class="roster-footer create-footer"/);
  assert.match(ui,/#screen-create #createBody\s*\{[^}]*overflow-y:auto;/s);
  assert.match(ui,/#screen-create \.name-input\s*\{[^}]*font:600 16px\/1\.35/s);
  assert.match(ui,/#screen-create \.create-pick-row \.cr-sub\s*\{[^}]*overflow-wrap:anywhere;/s);
  assert.match(ui,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(ui,/\.create-footer\s*\{[^}]*flex:0 0 auto;/s);
  assert.match(ui,/@media\(max-width:359px\)/);assert.match(ui,/@media\(max-height:700px\)/);
});
test("種族選択はXSSなくクリックでモーダル導線へ",()=>{
  const start=create.indexOf("function createRaceInsignia("),end=create.indexOf("function statStars(",start);
  assert.ok(start>=0&&end>start);
  class El{constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.textContent="";this.attrs={};}appendChild(el){this.children.push(el);return el;}addEventListener(k,fn){this.listeners[k]=fn;}setAttribute(k,v){this.attrs[k]=v;}click(){this.listeners.click?.();}}
  const cx=vm.createContext({document:{createElement:tag=>new El(tag)},RACES:{human:{icon:"♜"}},jobInsignia:()=>"<svg></svg>"});
  vm.runInContext(create.slice(start,end),cx);
  let clicked=false;const row=cx.buildCreatePickRow("しゅぞく","<img src=x>","説明",()=>{clicked=true;},"race","human");
  assert.equal(row.tag,"button");assert.equal(row.children[1].children[0].children[1].children[0].textContent,"<img src=x>");
  row.click();assert.equal(clicked,true);
});
test("プレビューは6能力値・特性・スキルを表示し名前をエスケープ",()=>{
  const start=create.indexOf("function updateCreatePreview() {"),end=create.indexOf("const PASSIVE_LABELS =",start);
  assert.ok(start>=0&&end>start);
  const box={innerHTML:""};
  const cx=vm.createContext({document:{getElementById:()=>box},draft:{name:"<b>エマ</b>",race:"human",job:"rogue"},
    newCharacter:(name,job,race,opts)=>({name,job,race,level:opts.level}),createStartLevel:()=>1,
    computeStats:()=>({maxHp:22,maxMp:10,atk:8,mag:4,def:6,spd:10.5}),
    RACES:{human:{name:"もりびと",passive:{},expMult:1.1}},JOBS:{rogue:{name:"とうぞく"}},
    availableAbilities:()=>[{name:"影刃"}],PASSIVE_LABELS:{},
    escapeHtml:t=>String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")});
  vm.runInContext(create.slice(start,end),cx);cx.updateCreatePreview();
  assert.match(box.innerHTML,/&lt;b&gt;エマ&lt;\/b&gt;/);assert.doesNotMatch(box.innerHTML,/<b>エマ<\/b>/);
  assert.equal((box.innerHTML.match(/class="pv-stat"/g)||[]).length,6);
  assert.match(box.innerHTML,/獲得経験値 10%/);assert.match(box.innerHTML,/影刃/);
});

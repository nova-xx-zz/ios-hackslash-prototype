"use strict";
// 実装ごとに画面の参照先APIを検証。旧関数名や存在しない関数を読むとCIが落ちる。
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Forge=require("../js/core/forge-gear-trial.js");
const Loot=require("../js/core/loot-protection-trial.js");
const Rarity=require("../js/core/option-rarity-trial.js");
const ROOT=path.join(__dirname,"..");
const ui=fs.readFileSync(path.join(ROOT,"js/ui/forge-trial.js"),"utf8");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");

function references(object) {
 const pattern=new RegExp("\\b"+object+"\\.([a-zA-Z_$][\\w$]*)","g");
 return [...ui.matchAll(pattern)].map(m=>m[1]);
}
test("セルフRV: 試作工房UIから呼び出すAPIはすべて実在する（旧関数排除）",()=>{
 const forgeRefs=[...new Set(references("ForgeTrial"))];
 const lootRefs=[...new Set(references("LootTrial"))];
 const rarityRefs=[...new Set(references("RarityTrial"))];
 assert.ok(forgeRefs.includes("enhance"),"新しい強化APIを必ず利用する");
 assert.ok(!forgeRefs.includes("increasePlus"),"旧 increasePlus を使用しない");
 assert.ok(lootRefs.includes("simulate"));
 assert.ok(rarityRefs.includes("simulate"));
 assert.ok(rarityRefs.includes("probability"));
 for(const method of forgeRefs)assert.ok(Object.hasOwn(Forge,method),"ForgeTrial."+method+" is missing");
 for(const method of lootRefs)assert.ok(Object.hasOwn(Loot,method),"LootTrial."+method+" is missing");
 for(const method of rarityRefs)assert.ok(Object.hasOwn(Rarity,method),"RarityTrial."+method+" is missing");
});
test("セルフRV: Script順と参照ファイルの整合性を確認",()=>{
 const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1].split("?")[0]);
 const ordered=[
  "js/core/option-inheritance-trial.js",
  "js/core/element-affinity-trial.js",
  "js/core/option-slots-trial.js",
  "js/core/forge-gear-trial.js",
  "js/core/loot-protection-trial.js",
  "js/core/option-balance-trial.js",
  "js/core/option-rarity-trial.js",
  "js/ui/forge-trial.js"
 ];
 let previous=-1;
 for(const name of ordered){
  const i=scripts.indexOf(name);
  assert.ok(i>previous,"Missing or incorrect script order: "+name);
  assert.ok(fs.existsSync(path.join(ROOT,name)),"Missing source file "+name);
  previous=i;
 }
});

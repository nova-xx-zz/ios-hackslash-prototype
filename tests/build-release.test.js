"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {spawnSync}=require("node:child_process");
const ROOT=path.join(__dirname,".."),TOOL=path.join(ROOT,"tools/build-www.js");
const TEST_FB={apiKey:"CI-NOT-A-REAL-FIREBASE-KEY",authDomain:"sword-crest-ci-build.firebaseapp.com",projectId:"sword-crest-ci-build",appId:"1:11111111111:web:ci-build-only"};
function build(args,config=TEST_FB){
  const env={...process.env};delete env.SWORD_CREST_FIREBASE_CONFIG_JSON;
  if(config)env.SWORD_CREST_FIREBASE_CONFIG_JSON=JSON.stringify(config);
  env.SWORD_CREST_API_BASE_URL="https://api-ci.invalid/swordcrestApi";
  env.SWORD_CREST_RECAPTCHA_SITE_KEY="CI_APP_CHECK_SITE_KEY";
  return spawnSync(process.execPath,[TOOL,...args],{cwd:ROOT,encoding:"utf8",env});
}
test("production fails closed for missing and preview Firebase",()=>{
  for(const config of [null,{...TEST_FB,projectId:"sword-crest-jp"},{...TEST_FB,authDomain:"sword-crest-jp.firebaseapp.com"}]){
    const r=build(["--web","--release"],config);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Production Firebase config required|dedicated production Firebase project/);
  }
  const r=spawnSync(process.execPath,[TOOL,"--web","--release"],{cwd:ROOT,encoding:"utf8",env:{...process.env,SWORD_CREST_FIREBASE_CONFIG_JSON:"{broken"}});
  assert.notEqual(r.status,0);
});
test("web production strips debug executable code and separates local saves",()=>{
  const r=build(["--web","--release"]);assert.equal(r.status,0,r.stderr);
  const base=path.join(ROOT,"dist/web"),file=p=>fs.readFileSync(path.join(base,p),"utf8");
  const storage={values:new Map([["jobquest_save_v1","preview"],["qp_debug_unlocked","1"],["qp_debug_active","1"]]),
    getItem(k){return this.values.get(k)??null;},setItem(k,v){this.values.set(k,v);},removeItem(k){this.values.delete(k);}};
  const ctx={location:{search:"?debug"},localStorage:storage};
  vm.runInNewContext(file("js/runtime-env.js"),ctx);
  assert.equal(ctx.QPRuntime.channel,"production");assert.equal(ctx.QPRuntime.allowTestPurchases,false);
  vm.runInNewContext(file("js/debug-gate.js"),ctx);
  assert.equal(ctx.QPDebugGate.active(),false);assert.equal(ctx.QPDebugGate.enter("anything"),false);
  assert.doesNotMatch(file("js/debug-gate.js"),/PASS_HASH|sha256/);
  assert.doesNotMatch(file("js/ui/debug.js"),/debugComplete|debugJumpTo|99999999/);
  assert.match(file("js/ui/debug.js"),/btnSettingsShop/);
  assert.match(file("sw.js"),/swordcrest-production-v1/);
  assert.match(file("js/firebase-config.js"),/sword-crest-ci-build/);
  assert.match(file("js/api-config.js"),/api-ci.invalid/);
  assert.ok(file("js/vendor/firebase.js").length>10000);
  assert.equal(fs.existsSync(path.join(base,"admin.html")),false);
  ctx.module={exports:{}};vm.runInNewContext(file("js/core/storage.js"),ctx);
  const backend=ctx.QPCore.storage.defaultBackend();
  assert.equal(backend.getItem("jobquest_save_v1"),null);
  backend.setItem("jobquest_save_v1","official");
  assert.equal(storage.getItem("jobquest_save_v1"),"preview");
  assert.equal(storage.getItem("scprod:jobquest_save_v1"),"official");
});
test("iOS production candidate uses the same security gates",()=>{
  const r=build(["--release"]);assert.equal(r.status,0,r.stderr);
  const file=p=>fs.readFileSync(path.join(ROOT,"www",p),"utf8");
  assert.match(file("js/runtime-env.js"),/"platform":"ios"/);
  assert.doesNotMatch(file("js/ui/debug.js"),/debugComplete/);
  assert.match(file("js/api-config.js"),/api-ci.invalid/);
});
test("web preview retains developer workflow and test project",()=>{
  const r=build(["--web"]);assert.equal(r.status,0,r.stderr);
  const file=p=>fs.readFileSync(path.join(ROOT,"dist/web",p),"utf8");
  assert.match(file("js/debug-gate.js"),/PASS_HASH/);
  assert.match(file("js/ui/debug.js"),/debugComplete/);
  assert.match(file("js/firebase-config.js"),/sword-crest-jp/);
  assert.match(file("js/runtime-env.js"),/"channel":"preview"/);
});
test("purchase model denies test grants in production mode",()=>{
  const mod=require("../js/model/shop.js");
  const state={roster:[],clearedDungeons:new Set(),purchases:{unlocks:{},rosterBoxes:0,history:[]},guaranteedStones:{free:0,paid:0}};
  const shop=mod.createShop({data:{SHOP_PRODUCTS:[{id:"test",kind:"unlock",unlock:"speed5"}],ROSTER_CAPACITY:{base:5,step:5,max:30},AUTO_REPEAT_CHOICES:[],BATTLE_SPEEDS:[]},state,allowTestPurchases:false});
  assert.deepEqual(shop.purchase("test"),{ok:false,reason:"disabled"});
  assert.equal(state.purchases.unlocks.speed5,undefined);
  assert.equal(state.purchases.history.length,0);
});

test("release refuses missing backup endpoint and App Check key",()=>{
  const env={...process.env,SWORD_CREST_FIREBASE_CONFIG_JSON:JSON.stringify(TEST_FB)};
  delete env.SWORD_CREST_API_BASE_URL;
  delete env.SWORD_CREST_RECAPTCHA_SITE_KEY;
  const r=spawnSync(process.execPath,[TOOL,"--release","--web"],{cwd:ROOT,encoding:"utf8",env});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/App Check site key required/);
});

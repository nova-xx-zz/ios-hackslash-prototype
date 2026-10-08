"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const ROOT=path.join(__dirname,"..");
const source=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
test("preview cloud client is isolated from new production bridge",()=>{
  const ctx={QPRuntime:{channel:"preview"}};
  vm.runInNewContext(source("js/cloud-production.js"),ctx);
  assert.equal(ctx.QPCloud,undefined);
});
test("production bridge exposes account actions without initializing unauthorized Firebase",()=>{
  const callbacks={};
  const ctx={
    QPRuntime:{channel:"production",platform:"web"},QP_FIREBASE_CONFIG:{projectId:"ci"},QP_API_CONFIG:{baseUrl:"https://ci.invalid",recaptchaSiteKey:"ci-key"},
    QPCloudBinding:{canAutoUpload:()=>false},
    addEventListener:(name,fn)=>{callbacks[name]=fn;},
    document:{addEventListener:(name,fn)=>{callbacks[name]=fn;}},
  };
  vm.runInNewContext(source("js/cloud-production.js"),ctx);
  assert.equal(ctx.QPCloud.getState().status,"off");
  assert.equal(typeof ctx.QPCloud.connectGoogle,"function");
  assert.equal(typeof ctx.QPCloud.preferLocal,"function");
  assert.equal(typeof ctx.QPCloud.markRestored,"function");
  assert.equal(typeof callbacks["qp:saved"],"function");
});
test("production page includes only guarded cloud paths, keeps preview module separate",()=>{
  const html=source("index.html");
  for(const script of ["js/api-config.js","js/core/sync-contract.js","js/cloud-binding.js","js/cloud-production.js","js/cloud.js"]){
    assert.ok(html.includes('src="'+script+"?"),"missing "+script);
  }
  assert.ok(html.indexOf("js/cloud-production.js")<html.indexOf('src="js/cloud.js'));
  assert.match(source("js/cloud.js"),/channel === "production"\) return;/);
  assert.match(source("js/model/save.js"),/SCHEMA_VERSION = 2/);
});

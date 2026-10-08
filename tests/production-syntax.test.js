"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const ROOT=path.join(__dirname,"..");
test("all production Firebase/API sources and browser bridge parse in Node",()=>{
  const files=[
    "functions/index.js","functions/backup-core.js","functions/firestore-repository.js",
    "functions/http-handler.js","js/cloud-production.js","js/cloud-binding.js","tools/build-www.js"
  ];
  for(const file of files){
    const result=spawnSync(process.execPath,["--check",path.join(ROOT,file)],{encoding:"utf8"});
    assert.equal(result.status,0,file+": "+result.stderr);
  }
});

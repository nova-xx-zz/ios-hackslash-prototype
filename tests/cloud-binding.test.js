"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {canAutoUpload}=require("../js/cloud-binding.js");
test("first official cloud save is eligible",()=>{assert.equal(canAutoUpload(0,"uid",null),true);});
test("existing cloud save must match user and revision",()=>{
 assert.equal(canAutoUpload(2,"uid",null),false);
 assert.equal(canAutoUpload(2,"uid",{uid:"other",revision:2}),false);
 assert.equal(canAutoUpload(2,"uid",{uid:"uid",revision:1}),false);
 assert.equal(canAutoUpload(2,"uid",{uid:"uid",revision:2}),true);
});

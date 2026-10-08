"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {hasExternalWrite}=require("../js/core/local-save-guard.js");
test("first save without an existing key is allowed",()=>{
 assert.equal(hasExternalWrite(null,null),false);
});
test("another tab's save must not overwrite current in-memory progress",()=>{
 assert.equal(hasExternalWrite(null,JSON.stringify({savedAt:10})),true);
 assert.equal(hasExternalWrite(10,JSON.stringify({savedAt:11})),true);
 assert.equal(hasExternalWrite(10,JSON.stringify({savedAt:10})),false);
});
test("unreadable or malformed saves are not silently discarded",()=>{
 assert.equal(hasExternalWrite(10,"{"),true);
 assert.equal(hasExternalWrite(10,JSON.stringify({savedAt:null})),true);
});

"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createSessionLock}=require("../js/core/tab-session.js");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function manager(){
  let active=false;
  return {request(_name,opts,fn){
    assert.equal(opts.mode,"exclusive");
    assert.equal(opts.ifAvailable,true);
    if(active)return Promise.resolve(fn(null));
    active=true;
    return Promise.resolve(fn({name:"test"})).finally(()=>{active=false;});
  }};
}
test("Web Locks makes only one tab writable, releases and transfers ownership",async()=>{
  const locks=manager(),events=[];
  const a=createSessionLock(locks,s=>events.push("a:"+s));
  const b=createSessionLock(locks,s=>events.push("b:"+s));
  a.start();await tick();assert.equal(a.owns(),true);
  await b.start();assert.equal(b.owns(),false);assert.equal(b.getState(),"blocked");
  a.stop();await tick();assert.equal(a.owns(),false);
  b.start();await tick();assert.equal(b.owns(),true);
  b.stop();await tick();
  assert.ok(events.includes("a:held"));assert.ok(events.includes("b:blocked"));
  assert.ok(events.includes("b:held"));
});
test("missing Web Locks is read-only rather than unsafe fallback",async()=>{
  const s=createSessionLock(null);
  assert.equal(await s.start(),false);
  assert.equal(s.getState(),"unsupported");
  assert.equal(s.owns(),false);
});

"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHandler, activeMember, safeFile, CSRF, SESSION } = require("./server.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "swordcrest-beta-secure-"));
fs.mkdirSync(path.join(root, "js", "vendor"), { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>SECRET-GAME</title>");
fs.writeFileSync(path.join(root, "js", "game.js"), "SECRET-GAME-SCRIPT");
fs.writeFileSync(path.join(root, "js", "vendor", "firebase.js"), "PUBLIC-FIREBASE-SDK");
fs.writeFileSync(path.join(root, "js", "firebase-config.js"), "PUBLIC-FIREBASE-WEB-CONFIG");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const tNow = Date.now();
let invited = true, expiry = tNow + 86400000, failLookup = false;
const claims = { uid: "allowed_uid", firebase: { sign_in_provider: "google.com" }, auth_time: Math.floor(tNow/1000) };
const fakeAuth = {
  async verifyIdToken(token) {
    if (!token.startsWith("trusted")) { const e=Error("bad");e.code="auth/invalid-id-token"; throw e; }
    if (token.includes("password")) return { ...claims, firebase: { sign_in_provider:"password" } };
    if (token.includes("old")) return { ...claims, auth_time:Math.floor(tNow/1000)-1000 };
    return claims;
  },
  async createSessionCookie() { return "secure-session-token"; },
  async verifySessionCookie(token) {
    if (token !== "secure-session-token") throw Error("invalid_cookie");
    return claims;
  }
};
const handler = createHandler({
  auth: fakeAuth, assetDir: root, now: () => tNow,
  lookupMember: async uid => {
    if (failLookup) throw Error("Firestore offline");
    return uid==="allowed_uid" && invited ? { enabled:true, expiresAt:{ toMillis:()=>expiry } } : null;
  }
});
const server = http.createServer((req,res) =>
  Promise.resolve(handler(req,res)).catch(err => {
    res.statusCode = 500; res.end("test handler exception: "+err.message);
  }));
let port;
test("protected beta server initial setup", async () => {
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  port=server.address().port;
  assert.ok(port>0);
});
after(() => server.close());

function send(route, {method="GET",headers={},data} = {}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({ host:"127.0.0.1", port, path:route, method,
      headers:{ host:"beta.example", ...headers } },r=>{
      const chunks=[];
      r.on("data",v=>chunks.push(v));
      r.on("end",()=>resolve({code:r.statusCode,body:Buffer.concat(chunks).toString("utf8"),headers:r.headers}));
    });req.on("error",reject);if(data)req.write(data);req.end();
  });
}
async function csrfRequest(extra={}) {
  const page=await send("/login");
  assert.equal(page.code,200);
  const token=page.body.match(/name="sc-csrf" content="([a-f0-9]{64})"/)[1];
  const cookie=page.headers["set-cookie"][0].split(";")[0];
  return send("/api/session",{method:"POST",headers:{
    origin:"https://beta.example","content-type":"application/json",
    cookie,...(extra.headers||{})
  },data:JSON.stringify({csrf:token,idToken:"trusted"+"x".repeat(120),...(extra.data||{})})});
}
test("unauthenticated users see only public login, not game HTML or scripts",async()=>{
  let r=await send("/");
  assert.equal(r.code,302);
  assert.equal(r.headers.location,"/login");
  for(const p of ["/index.html","/js/game.js","/icons/app.png"]){
    r=await send(p);assert.equal(r.code,401);assert.doesNotMatch(r.body,/SECRET-GAME/);
  }
  r=await send("/login");assert.equal(r.code,200);assert.match(r.body,/招待制クローズドβ/);
  assert.doesNotMatch(r.body,/SECRET-GAME/);
  r=await send("/_beta/login.js");assert.equal(r.code,200);assert.match(r.body,/api\/session/);
  r=await send("/js/vendor/firebase.js");assert.equal(r.code,200);
  assert.equal(r.body,"PUBLIC-FIREBASE-SDK");
  r=await send("/js/firebase-config.js");assert.equal(r.code,200);
  assert.equal(r.body,"PUBLIC-FIREBASE-WEB-CONFIG");
});
test("valid Google ID token and fresh active invite establish protected cookie",async()=>{
  invited=true; expiry=tNow+86400000;failLookup=false;
  const r=await csrfRequest();
  assert.equal(r.code,200,r.body);
  assert.deepEqual(JSON.parse(r.body),{ok:true});
  assert.match(r.headers["set-cookie"][0],/Secure; HttpOnly; SameSite=Lax/);
  const cookie=r.headers["set-cookie"][0].split(";")[0];
  assert.match(cookie,new RegExp("^"+SESSION+"="));
  const page=await send("/",{headers:{cookie}});
  assert.equal(page.code,200);assert.match(page.body,/SECRET-GAME/);
  const script=await send("/js/game.js",{headers:{cookie}});
  assert.equal(script.code,200);assert.equal(script.body,"SECRET-GAME-SCRIPT");
});
test("uninvited users are denied server session even with valid Google sign-in",async()=>{
  invited=false;
  const r=await csrfRequest();
  assert.equal(r.code,403);assert.equal(JSON.parse(r.body).error,"not_invited");
  assert.equal(r.headers["set-cookie"],undefined);
  invited=true;
});
test("expired or revoked invitations block EVERY protected resource immediately",async()=>{
  expiry=tNow-1;
  let r=await csrfRequest();assert.equal(r.code,403);
  expiry=tNow+86400000;invited=false;
  r=await send("/js/game.js",{headers:{cookie:SESSION+"=secure-session-token"}});
  assert.equal(r.code,403);assert.doesNotMatch(r.body,/SECRET-GAME/);
  invited=true;
});
test("Google provider and fresh login are mandatory",async()=>{
  let r=await csrfRequest({data:{idToken:"trusted-password"+"x".repeat(120)}});
  assert.equal(r.code,403);assert.equal(JSON.parse(r.body).error,"google_required");
  r=await csrfRequest({data:{idToken:"trusted-old"+"x".repeat(120)}});
  assert.equal(r.code,401);assert.equal(JSON.parse(r.body).error,"recent_login_required");
});
test("cross-site request and wrong CSRF cannot create a session",async()=>{
  let r=await csrfRequest({headers:{origin:"https://evil.example"}});
  assert.equal(r.code,403);
  r=await csrfRequest({data:{csrf:"b".repeat(64)}});
  assert.equal(r.code,403);
  r=await csrfRequest({headers:{cookie:CSRF+"=truncated"}});
  assert.equal(r.code,403);
});
test("outage denies issuance and static game delivery",async()=>{
  failLookup=true;
  let r=await csrfRequest();assert.equal(r.code,503);
  r=await send("/js/game.js",{headers:{cookie:SESSION+"=secure-session-token"}});
  assert.notEqual(r.code,200);assert.doesNotMatch(r.body,/SECRET-GAME/);
  failLookup=false;
});
test("logout clears hosting session only on same-origin POST",async()=>{
  let r=await send("/api/logout",{method:"POST",headers:{origin:"https://evil.example","x-swordcrest-logout":"1"}});
  assert.equal(r.code,403);
  r=await send("/api/logout",{method:"POST",headers:{origin:"https://beta.example","x-swordcrest-logout":"1"}});
  assert.equal(r.code,204);
  assert.match(r.headers["set-cookie"][0],/Max-Age=0/);
});
test("disallow traversal and PWA service-worker files",async()=>{
  assert.equal(safeFile(root,"/%2e%2e/%2e%2e/file"),null);
  assert.equal(safeFile(root,"/../file"),null);
  const r=await send("/sw.js",{headers:{cookie:SESSION+"=secure-session-token"}});
  assert.equal(r.code,404);
});
test("invite schema is fail-closed",()=>{
  assert.equal(activeMember(null,tNow),false);
  assert.equal(activeMember({enabled:true,expiresAt:tNow+100},tNow),false);
  assert.equal(activeMember({enabled:false,expiresAt:{toMillis:()=>tNow+100}},tNow),false);
});

"use strict";
// Invite-only Cloud Run beta delivery. Static game assets are never served before
// Google/Firebase session verification AND a fresh server-side Firestore member lookup.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT = "sword-crest-beta";
const SESSION = "__Host-sc_beta_session";
const CSRF = "__Host-sc_beta_csrf";
const SESSION_MS = 12 * 60 * 60 * 1000;
const PUBLIC_LOGIN_ASSETS = new Set(["/js/vendor/firebase.js", "/js/firebase-config.js"]);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav"
};

function cookies(value) {
  const out = Object.create(null);
  for (const part of String(value || "").split(";")) {
    const n = part.indexOf("=");
    if (n > 0) out[part.slice(0, n).trim()] = part.slice(n + 1).trim();
  }
  return out;
}
function reply(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
}
function harden(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Vary", "Cookie");
}
function randomToken() { return crypto.randomBytes(32).toString("hex"); }
function loginPage(csrf) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="sc-csrf" content="${csrf}">
<title>ソードクレスト 招待制β</title><style>
*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:20px;background:linear-gradient(145deg,#111721,#0b2631);color:#f7e9c8;font-family:system-ui,sans-serif}
main{width:min(100%,460px);padding:30px 20px;background:#0e1926;border:1px solid #a58b5a;border-radius:14px;text-align:center;box-shadow:0 12px 48px #02060c88}
h1{letter-spacing:.15em;font-size:26px}p{line-height:1.8;font-size:14px;white-space:pre-wrap}
button{border:1px solid #c5aa74;background:#183b45;color:#fff5dd;border-radius:8px;padding:12px 18px;font-size:15px;cursor:pointer}
button:disabled{opacity:.5}.detail{overflow-wrap:anywhere;font-size:12px;color:#bdd2d8}
</style></head><body><main><h1>SWORD CREST</h1><p>招待制クローズドβ</p>
<p id="message" role="status">ログインの準備をしています…</p><p id="uid" class="detail"></p>
<button id="login" type="button" hidden>Googleでログイン</button>
<p class="detail">当選者専用・無料テスト版。β版の進行は正式版に引き継がれません。</p></main>
<script src="/js/firebase-config.js"></script><script src="/js/vendor/firebase.js"></script>
<script src="/_beta/login.js"></script></body></html>`;
}
function goodOrigin(req) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  // Cloud Run always fronts TLS. No CORS; CSRF requests must originate at this host.
  return !!host && typeof origin === "string" && origin === "https://" + host;
}
function sessionCookie(value, duration) {
  return SESSION + "=" + value + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + duration;
}
function clearSession() { return sessionCookie("", 0); }
function safeFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes("..") || decoded.startsWith("//")) return null;
  const file = path.resolve(root, "." + (decoded === "/" ? "/index.html" : decoded));
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}
function serveFile(root, pathname, req, res) {
  const file = safeFile(root, pathname);
  if (!file) return reply(res, 404, "Not found");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return reply(res, 404, "Not found");
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", st.size);
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file);
    stream.on("error", () => { if (!res.headersSent) reply(res, 500, "Server error"); else res.destroy(); });
    stream.pipe(res);
  });
}
function readJson(req, limit = 12 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", len = 0;
    req.setEncoding("utf8");
    req.on("data", chunk => {
      len += Buffer.byteLength(chunk);
      if (len > limit) { reject(Error("payload_too_large")); req.destroy(); return; }
      data += chunk;
    });
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(Error("invalid_json")); } });
    req.on("error", reject);
  });
}
function activeMember(member, now) {
  const expiry = member && member.expiresAt;
  return !!(member && member.enabled === true && expiry
    && typeof expiry.toMillis === "function" && expiry.toMillis() > now);
}
function createHandler({ auth, lookupMember, assetDir, now = Date.now }) {
  if (!auth || !lookupMember || !assetDir) throw Error("Missing protected hosting dependencies");
  const root = path.resolve(assetDir);
  let attempts = 0, windowStart = 0;
  return async function handler(req, res) {
    harden(res);
    const host = req.headers.host || "";
    let pathname;
    try { pathname = new URL(req.url, "https://" + host).pathname; }
    catch { return reply(res, 400, "Invalid URL"); }
    if (req.method === "GET" && pathname === "/healthz") return reply(res, 200, "ok");
    if (req.method === "GET" && pathname === "/login") {
      const token = randomToken();
      res.setHeader("Set-Cookie", CSRF + "=" + token + "; Path=/; Secure; HttpOnly; SameSite=Lax");
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.google.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return reply(res, 200, loginPage(token), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/_beta/login.js") {
      return serveFile(path.join(__dirname, "public-login"), "/login.js", req, res);
    }
    if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_LOGIN_ASSETS.has(pathname)) {
      return serveFile(root, pathname, req, res);
    }
    if (req.method === "POST" && pathname === "/api/session") {
      if (!goodOrigin(req) || !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
        return reply(res, 403, "Invalid request");
      }
      if (now() - windowStart > 60000) { windowStart = now(); attempts = 0; }
      if (++attempts > 90) return reply(res, 429, "Try again later");
      let input;
      try { input = await readJson(req); } catch { return reply(res, 400, "Invalid request"); }
      const csrf = cookies(req.headers.cookie)[CSRF];
      if (!csrf || csrf.length !== 64 || !input || typeof input.csrf !== "string" || input.csrf !== input.csrf.trim()
          || input.csrf.length !== 64 || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(input.csrf))) {
        return reply(res, 403, "Invalid request");
      }
      if (typeof input.idToken !== "string" || input.idToken.length < 100 || input.idToken.length > 10000) {
        return reply(res, 400, "Invalid request");
      }
      try {
        const claims = await auth.verifyIdToken(input.idToken, true);
        if (!claims || !claims.uid || !claims.firebase || claims.firebase.sign_in_provider !== "google.com") {
          return reply(res, 403, JSON.stringify({ error: "google_required" }), "application/json");
        }
        if (!Number.isFinite(claims.auth_time) || now() / 1000 - claims.auth_time > 300
            || claims.auth_time > now() / 1000 + 60) {
          return reply(res, 401, JSON.stringify({ error: "recent_login_required" }), "application/json");
        }
        const member = await lookupMember(claims.uid);
        if (!activeMember(member, now())) {
          return reply(res, 403, JSON.stringify({ error: "not_invited", uid: claims.uid }), "application/json");
        }
        const cookie = await auth.createSessionCookie(input.idToken, { expiresIn: SESSION_MS });
        res.setHeader("Set-Cookie", sessionCookie(cookie, SESSION_MS / 1000));
        return reply(res, 200, JSON.stringify({ ok: true }), "application/json");
      } catch (e) {
        if (e.code && String(e.code).startsWith("auth/")) {
          return reply(res, 401, JSON.stringify({ error: "invalid_auth" }), "application/json");
        }
        // Firestore failures must NOT bypass authorization.
        return reply(res, 503, JSON.stringify({ error: "temporarily_unavailable" }), "application/json");
      }
    }
    if (req.method === "POST" && pathname === "/api/logout") {
      if (!goodOrigin(req) || req.headers["x-swordcrest-logout"] !== "1") return reply(res, 403, "Invalid request");
      res.setHeader("Set-Cookie", clearSession());
      return reply(res, 204, "");
    }
    if (pathname === "/sw.js" || pathname === "/manifest.webmanifest"
        || pathname.startsWith("/_beta/") || pathname.startsWith("/api/")) {
      return reply(res, 404, "Not found");
    }
    if (!["GET", "HEAD"].includes(req.method)) return reply(res, 405, "Method not allowed");
    const session = cookies(req.headers.cookie)[SESSION];
    if (!session || session.length > 8192) {
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        res.setHeader("Location", "/login");
        return reply(res, 302, "Login required");
      }
      return reply(res, 401, "Login required");
    }
    try {
      const claims = await auth.verifySessionCookie(session, false);
      if (!claims || !claims.uid || !claims.firebase || claims.firebase.sign_in_provider !== "google.com") {
        throw Error("invalid_provider");
      }
      const member = await lookupMember(claims.uid);
      if (!activeMember(member, now())) {
        res.setHeader("Set-Cookie", clearSession());
        return reply(res, 403, "Invitation not active");
      }
      return serveFile(root, pathname, req, res);
    } catch (e) {
      // A member lookup outage must fail closed, not fall back to static delivery.
      if (e.code === "firestore_error") return reply(res, 503, "Temporarily unavailable");
      res.setHeader("Set-Cookie", clearSession());
      return reply(res, 401, "Session invalid or access unavailable");
    }
  };
}
function run() {
  if (process.env.BETA_FIREBASE_PROJECT_ID !== PROJECT || process.env.BETA_PROJECT_CONFIRM !== PROJECT) {
    throw Error("Refusing startup: explicit sword-crest-beta project confirmation required");
  }
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
  const db = admin.firestore();
  const handler = createHandler({
    auth: admin.auth(),
    lookupMember: async uid => {
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(uid)) return null;
      const doc = await db.doc("betaMembers/" + uid).get();
      return doc.exists ? doc.data() : null;
    },
    assetDir: path.join(__dirname, "game")
  });
  const port = Number(process.env.PORT || 8080);
  http.createServer((req, res) => Promise.resolve(handler(req, res)).catch(err => {
    console.error("Protected beta request failed:", err && err.message);
    if (!res.headersSent) reply(res, 503, "Temporarily unavailable"); else res.destroy();
  })).listen(port, "0.0.0.0", () => console.log("Protected Sword Crest beta listening on port " + port));
}
if (require.main === module) run();
module.exports = { createHandler, activeMember, safeFile, loginPage, PROJECT, SESSION, CSRF };

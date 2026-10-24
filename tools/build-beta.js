// β版専用の隔離されたWebビルド。通常Preview / 正式版の出力先を変更しない。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const out = path.join(ROOT, "dist", "beta");
// Operator-confirmed Firebase project. Fail if an unrelated project is configured.
const BETA_PROJECT_ID = "sword-crest-beta";

function betaFirebase() {
  const raw = process.env.SWORD_CREST_BETA_FIREBASE_CONFIG_JSON;
  if (!raw) throw Error("Beta Firebase config required: SWORD_CREST_BETA_FIREBASE_CONFIG_JSON");
  let c;
  try { c = JSON.parse(raw); } catch { throw Error("Invalid Beta Firebase config JSON"); }
  if (!c || typeof c !== "object" || Array.isArray(c)) throw Error("Invalid Beta Firebase config object");
  for (const key of ["apiKey", "authDomain", "projectId", "appId"]) {
    if (typeof c[key] !== "string" || !c[key].trim()) throw Error("Missing beta Firebase config: " + key);
  }
  if (c.projectId !== BETA_PROJECT_ID || c.authDomain !== BETA_PROJECT_ID + ".firebaseapp.com") {
    throw Error("Beta build is locked to the confirmed sword-crest-beta Firebase project");
  }
  if (process.env.BETA_PROJECT_CONFIRM !== c.projectId) {
    throw Error("Set BETA_PROJECT_CONFIRM to the exact beta Firebase projectId");
  }
  return c;
}

// Validate before touching any existing artifact.
const firebase = betaFirebase();
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "data", "icons", "fonts"]) {
  fs.cpSync(path.join(ROOT, name), path.join(out, name), { recursive: true });
}
fs.writeFileSync(path.join(out, "js", "runtime-env.js"),
  "// Beta-only runtime. Browser flags never grant server permissions.\n" +
  "(function(root){root.QPRuntime=Object.freeze(" +
  JSON.stringify({ channel: "beta", platform: "web", allowDebug: false, allowTestPurchases: true }) +
  ");})(typeof globalThis!==\"undefined\"?globalThis:this);\n");
fs.writeFileSync(path.join(out, "js", "firebase-config.js"),
  "// Beta-only public Firebase app identifiers. No service accounts.\n" +
  "window.QP_FIREBASE_CONFIG=" + JSON.stringify(firebase) + ";\n");

// Beta auth requires GoogleAuthProvider and signInWithPopup: create a separate bundle.
// Existing committed Preview vendor remains unchanged.
require("esbuild").buildSync({
  entryPoints: [path.join(ROOT, "tools", "firebase-entry.js")],
  bundle: true, minify: true, format: "iife", globalName: "QPFirebase",
  target: "es2019", legalComments: "eof",
  outfile: path.join(out, "js", "vendor", "firebase.js"),
});
const htmlPath = path.join(out, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
// All state/UI modules must load after auth: ui/state.js reads storage at top level.
const marker = '<script src="js/ui/state.js?v=';
const begin = html.indexOf(marker);
const game = html.match(/<script src="(js\/game\.js\?v=\d+)"><\/script>/);
if (begin < 0 || !game) throw Error("Game UI entrypoints changed. Review beta bootstrap");
const end = html.indexOf(game[0], begin) + game[0].length;
if (end <= begin) throw Error("Invalid game script block");
const scripts = [...html.slice(begin, end).matchAll(/<script src="([^"]+)"><\/script>/g)].map(x => x[1]);
if (scripts.length < 20 || !scripts.every(x => /^js\/[a-zA-Z0-9_./-]+\.js\?v=\d+$/.test(x))
    || !scripts[0].startsWith("js/ui/state.js?v=") || scripts[scripts.length - 1] !== game[1]) {
  throw Error("Unexpected game script dependency order");
}
fs.writeFileSync(path.join(out, "js", "beta-script-list.js"),
  "// Injected only by the isolated beta build.\nwindow.QPBetaGameScripts=" + JSON.stringify(scripts) + ";\n");
html = html.slice(0, begin) +
  '<script src="js/beta-script-list.js?v=1"></script>\n<script src="js/beta-access.js?v=2"></script>' +
  html.slice(end);
html = html.replace(/<script src="js\/pwa\.js\?v=\d+"><\/script>/, "");
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', "");
if (html.includes('<script src="' + game[1] + '"></script>')
    || html.includes('<script src="' + scripts[0] + '"></script>')) {
  throw Error("Game state still initializes before beta sign-in");
}
fs.writeFileSync(htmlPath, html);

// Ensure the developer password and debug UI do not ship to beta users.
fs.writeFileSync(path.join(out, "js", "debug-gate.js"),
  '"use strict";(function(root){root.QPDebugGate=Object.freeze({active:()=>false,requested:()=>false,enter:()=>false,unlocked:()=>false,leave:()=>{},takeAutoComplete:()=>false});})(typeof globalThis!=="undefined"?globalThis:this);\n');
fs.writeFileSync(path.join(out, "js", "ui", "debug.js"),
  '"use strict";const DEBUG_MODE=false;for(const id of ["btnDevEnter","settingsDebug"]){const el=document.getElementById(id);if(el){el.hidden=true;el.classList.add("hidden");}}\n');

const assets = [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(x => x[1]);
const missing = assets.filter(x => !fs.existsSync(path.join(out, x)));
if (missing.length) throw Error("Missing beta assets: " + missing.join(", "));
process.stdout.write("Built gated beta/web in dist/beta; NOT deployed.\n");

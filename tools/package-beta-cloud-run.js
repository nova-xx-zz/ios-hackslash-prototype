"use strict";
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname, "..");
const sourceDir = path.join(base, "dist", "beta");
const destination = path.join(base, "dist", "beta-cloud-run");
if (process.env.BETA_PROJECT_CONFIRM !== "sword-crest-beta") throw Error("Unexpected project");
if (!fs.existsSync(path.join(sourceDir, "index.html"))) throw Error("Build beta first");
const config = fs.readFileSync(path.join(sourceDir, "js", "firebase-config.js"), "utf8");
if (!config.includes('"projectId":"sword-crest-beta"')) throw Error("Firebase target mismatch");
const page = fs.readFileSync(path.join(sourceDir, "index.html"), "utf8");
if (!page.includes("beta-access.js") || !page.includes("beta-script-list.js")) throw Error("Beta authentication gate missing");
fs.rmSync(destination, { recursive:true, force:true });
fs.mkdirSync(destination, { recursive:true });
const template = path.join(base, "infra", "beta-web");
for (const f of ["server.js", "package.json", "Dockerfile", ".dockerignore"]) {
  fs.copyFileSync(path.join(template, f), path.join(destination, f));
}
fs.copyFileSync(path.join(template,"login.js"),path.join(destination,"login.js"));
fs.cpSync(sourceDir, path.join(destination, "game"), {recursive:true});
fs.writeFileSync(path.join(destination,"game","js","beta-cloud-run.js"),
  'window.QPBetaSecureHosting = true;\n');
fs.writeFileSync(path.join(destination,"game","index.html"),page.replace(
  '<script src="js/beta-access.js?v=2"></script>',
  '<script src="js/beta-cloud-run.js?v=1"></script>\n<script src="js/beta-access.js?v=2"></script>'
));
console.log("Secure beta Cloud Run build: dist/beta-cloud-run");

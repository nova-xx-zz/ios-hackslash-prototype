"use strict";
// The Firebase CLI forbids rule files outside the Emulator project's directory.
// Copy the canonical beta Rules into a local, ignored artifact on every run.
const fs = require("node:fs");
const path = require("node:path");
const canonical = path.join(__dirname, "..", "firebase", "firestore.beta.rules");
const output = path.join(__dirname, "firestore.beta.rules");
const rules = fs.readFileSync(canonical, "utf8");
if (!rules.includes("request.auth.token.firebase.sign_in_provider")
    || !rules.includes("allow read, write: if false;")) {
  throw Error("Beta Rules changed unexpectedly; review before running Emulator");
}
fs.writeFileSync(output, rules);
process.stdout.write("Prepared local Emulator Rules from infra/firebase/firestore.beta.rules\n");

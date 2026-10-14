"use strict";
const Audit=require("./lib/inventory-large-audit.js");
console.log("Sword Crest: inventory bulk/performance and save-size audit (Node, not real device)");
for(const row of Audit.run()){
 console.log("INVENTORY_LOAD "+JSON.stringify(row));
}
console.log("The simulated 5MiB localStorage limit is only a reference; browsers, WebKit and embedded apps vary.");

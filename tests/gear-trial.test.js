"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../js/core/equipment.js");
const storage = require("../js/core/storage.js");
const { loadGameData } = require("../tools/lib/load-data.js");
const { setup: unused } = {}; // model run is exercised in run.test.js
const data = loadGameData();

test("gearTrial URL explicitly requires dungeonPilot and cannot run in production", () => {
  const oldLocation = globalThis.location;
  const oldRuntime = globalThis.QPRuntime;
  const oldLocalStorage = globalThis.localStorage;
  const backend = storage.createMemoryBackend();
  try {
    globalThis.localStorage = backend;
    globalThis.QPRuntime = {channel: "preview"};
    globalThis.location = {search: "?dungeonPilot=1&gearTrial=1"};
    assert.equal(storage.isDungeonPilotMode(), true);
    assert.equal(storage.isGearTrialMode(), true);
    const api=storage.createStorage(storage.defaultBackend());
    assert.equal(api.set(storage.KEYS.save, "gear-only"),true);
    assert.equal(backend.getItem("qpgeartrial:"+storage.KEYS.save),"gear-only");
    assert.equal(backend.getItem("qpdungeonpilot:"+storage.KEYS.save),null);
    assert.equal(backend.getItem(storage.KEYS.save),null);
    globalThis.location = {search:"?dungeonPilot=1"};
    assert.equal(storage.isGearTrialMode(),false);
    assert.equal(storage.createStorage(storage.defaultBackend()).getString(storage.KEYS.save),null);
    globalThis.location = {search:"?gearTrial=1"};
    assert.equal(storage.isGearTrialMode(),false);
    globalThis.QPRuntime = {channel:"production"};
    globalThis.location = {search:"?dungeonPilot=1&gearTrial=1"};
    assert.equal(storage.isGearTrialMode(),false);
    assert.equal(storage.isDungeonPilotMode(),false);
  } finally {
    globalThis.location=oldLocation;
    globalThis.QPRuntime=oldRuntime;
    globalThis.localStorage=oldLocalStorage;
  }
});

test("trial +4/+8/+12 main milestone and +99 bounded effect at all rarity levels", () => {
  for(const rarity of data.RARITIES) {
    let prev = null;
    for(let plus=0;plus<=99;plus++){
      const item={rarity:rarity.key,stats:{atk:10,spd:2},plus};
      const normal=data.itemStats(item);
      const experimental=core.itemStatsEarlyMilestones(item,data.rarityMult(rarity.key));
      const bonus=Math.floor(Math.min(12,plus)/4);
      assert.equal(experimental.atk-normal.atk,bonus,rarity.key+" +"+plus);
      assert.ok(experimental.spd>=normal.spd);
      if(prev)assert.ok(experimental.atk>=prev.atk);
      prev=experimental;
      assert.deepEqual(data.itemStats(item),normal,"production formula stays unchanged");
    }
  }
});

test("actual browser data.itemStats uses the same trial formula only when explicitly enabled", () => {
  const trialData=loadGameData({storage:{isGearTrialMode:()=>true}});
  const legacyData=loadGameData({storage:{isGearTrialMode:()=>false}});
  const item={rarity:"n",stats:{atk:10,spd:2},plus:5};
  const normal=legacyData.itemStats(item);
  const trial=trialData.itemStats(item);
  assert.equal(normal.atk,11);
  assert.equal(trial.atk,12);
  assert.deepEqual(legacyData.itemStats(item),data.itemStats(item));
});

test("script order allows gearTrial opt-in before equipment and data load", () => {
  const index=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  // Asset versions change whenever iPhone Safari caches are invalidated.
  // Assert script load order by filename without pinning cache-buster versions.
  const i=x=>index.indexOf('src="'+x+'?v=');
  assert.ok(i("js/core/storage.js")>=0);
  assert.ok(i("js/core/equipment.js")>i("js/core/storage.js"));
  assert.ok(i("js/data.js")>i("js/core/equipment.js"));
});

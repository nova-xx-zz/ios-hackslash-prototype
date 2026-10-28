"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {loadGameData} = require("../tools/lib/load-data.js");

const names = {
  human:"人族", beastkin:"半獣人", sylvan:"森人", stonekin:"岩人",
  nocturne:"夜行族", artisan:"工人", spiritkin:"精霊族", giant:"巨人",
};
test("プレイヤー用の全8種族を漢字表示に統一し、種族ID・性能・特性を維持", () => {
  const {RACES} = loadGameData();
  const actual = Object.fromEntries(Object.entries(RACES).filter(([,v])=>v.kind==="player").map(([key,v])=>[key,v.name]));
  assert.equal(JSON.stringify(actual),JSON.stringify(names));
  for(const [id,name] of Object.entries(names)) {
    const race=RACES[id];
    assert.equal(race.name,name);
    assert.equal(race.kind,"player");
    assert.ok(race.mult && Object.keys(race.mult).length===6,id+" 能力倍率");
    assert.ok(race.passive && typeof race.passive==="object",id+" 種族特性");
  }
  assert.equal(RACES.beastkin.passive.critBonus,.08);
  assert.equal(RACES.stonekin.passive.dmgTakenMult,.92);
  assert.equal(RACES.spiritkin.passive.healBonus,.25);
  // テイムしたモンスターの固有名は今回変更しない。
  assert.equal(RACES.slime.name,"スライム族");
});
test("仲間作成で漢字の種族名を表示し、保存値はIDのまま",()=>{
  const create=fs.readFileSync(path.join(__dirname,"../js/ui/create.js"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  assert.match(create,/buildCreatePickRow\("種族", RACES\[draft\.race\]\.name/);
  assert.match(create,/document\.getElementById\("pmName"\)\.textContent = def\.name/);
  assert.match(create,/draft\[field\] = id/);
  assert.match(create,/newCharacter\(name, draft\.job, draft\.race/);
  assert.match(html,/js\/data\.js\?v=40/);
  assert.match(html,/js\/ui\/create\.js\?v=11/);
});

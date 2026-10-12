const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/core/option-inheritance-trial.js");

function ready(s, rarity) {
  const levels = F.SLOT_LEVELS[rarity];
  for (const level of levels) {
    assert.equal(F.increasePlus(s, rarity, level).ok, true);
    assert.equal(F.openSocket(s, rarity).ok, true);
  }
}
function extract(s, key) {
  const w = s.sources.find(function (x) { return x.optionKey === key; });
  assert.ok(w);
  assert.equal(F.extract(s, w.id).ok, true);
  return s.essences[s.essences.length - 1];
}

test("天然OP抽出は100%成功、武器本体を残しOPだけ消す", () => {
  const s = F.createDemo();
  const w = s.sources.find((x) => x.optionKey === "atk");
  const essence = extract(s, "atk");
  assert.equal(w.optionKey, null);
  assert.ok(s.sources.includes(w));
  assert.equal(essence.count, 2);
  assert.equal(essence.optionRarity, "r");
  assert.equal(F.extract(s, w.id).ok, false);
  assert.equal(s.essences.length, 1);
});

test("OPレアリティごとの抽出数は同一で、液体は1回の継承分の束", () => {
  const s = F.createDemo();
  for (const key of ["guard", "atk", "crit", "reverse", "void"]) {
    const e = extract(s, key);
    assert.equal(e.count, F.EXTRACT_COUNT[e.optionRarity]);
  }
  assert.deepEqual(s.essences.map((e) => e.count), [1, 2, 3, 5, 8]);
});

test("SR+50で1枠、+99で2枠を個別に穴あけできる", () => {
  const s = F.createDemo();
  assert.equal(F.openSocket(s, "sr").ok, false);
  assert.equal(F.increasePlus(s, "sr", 50).ok, true);
  assert.equal(F.openSocket(s, "sr").ok, true);
  assert.equal(F.openSocket(s, "sr").ok, false);
  assert.equal(F.increasePlus(s, "sr", 99).ok, true);
  assert.equal(F.openSocket(s, "sr").ok, true);
  assert.equal(F.openSocket(s, "sr").ok, false);
  assert.equal(s.targets.find((x) => x.id === "sr").opened, 2);
});

test("R・SRの継承は確定。NからSRへ直接継承可能で継承液は消費される", () => {
  const s = F.createDemo();
  ready(s, "sr");
  const e = extract(s, "crit");
  assert.equal(e.sourceRarity, "n");
  const r = F.inherit(s, "sr", e.id, false, () => 1);
  assert.equal(r.success, true);
  assert.equal(s.essences.length, 0);
  assert.equal(s.targets.find((x) => x.id === "sr").options[0].inherited, true);
  assert.equal(F.extract(s, "src_2").ok, false);
});

test("同一レアリティへの継承・未解放枠・同一OPの重複は禁止", () => {
  const s = F.createDemo();
  const e = extract(s, "atk"); // 元R
  assert.equal(F.inherit(s, "r", e.id, false).ok, false);
  assert.equal(F.inherit(s, "sr", e.id, false).ok, false);
  ready(s, "sr");
  assert.equal(F.inherit(s, "sr", e.id, false).success, true);
  F.addSamples(s);
  const e2 = extract(s, "atk");
  assert.equal(F.inherit(s, "sr", e2.id, false).ok, false);
  assert.equal(s.essences.length, 1);
});

test("UR継承は連続2失敗で次回確定。失敗は抽出液だけ消費、武器は維持", () => {
  const s = F.createDemo();
  ready(s, "ur");
  const target = s.targets.find((x) => x.id === "ur");
  for (let i = 0; i < 2; i++) {
    if (i) F.addSamples(s);
    const e = extract(s, "atk");
    const r = F.inherit(s, "ur", e.id, false, () => 0.999);
    assert.equal(r.success, false);
    assert.equal(target.options.length, 0);
    assert.equal(target.opened, 3);
    assert.equal(target.failures, i + 1);
  }
  F.addSamples(s);
  const final = F.inherit(s, "ur", extract(s, "atk").id, false, () => 0.999);
  assert.equal(final.success, true);
  assert.equal(final.pityHit, true);
  assert.equal(target.failures, 0);
});

test("LRは3回失敗で次回確定、課金液による確定は天井進捗を消さない", () => {
  const s = F.createDemo();
  ready(s, "lr");
  const target = s.targets.find((x) => x.id === "lr");
  for (let i = 0; i < 3; i++) {
    if (i) F.addSamples(s);
    const e = extract(s, "atk");
    assert.equal(F.inherit(s, "lr", e.id, false, () => 0.999).success, false);
  }
  assert.equal(target.failures, 3);
  F.addSamples(s);
  const paidEssence = extract(s, "crit");
  assert.equal(F.inherit(s, "lr", paidEssence.id, true, () => 0.999).success, true);
  assert.equal(s.trialLiquid, 1);
  assert.equal(target.failures, 3);
  F.addSamples(s);
  const free = F.inherit(s, "lr", extract(s, "atk").id, false, () => 0.999);
  assert.equal(free.success, true);
  assert.equal(free.pityHit, true);
  assert.equal(target.failures, 0);
});

test("確定液はUR/LRのみ使用。無効な試行では液体・OP素材を消費しない", () => {
  const s = F.createDemo();
  ready(s, "sr");
  const e = extract(s, "atk");
  const before = s.trialLiquid;
  assert.equal(F.inherit(s, "sr", e.id, true).ok, false);
  assert.equal(s.trialLiquid, before);
  assert.ok(s.essences.includes(e));
});

test("特殊OPは1武器につき1つで、無効な二重継承を拒否", () => {
  const s = F.createDemo();
  ready(s, "lr");
  const first = extract(s, "reverse");
  assert.equal(F.inherit(s, "lr", first.id, true).success, true);
  const next = extract(s, "void");
  const r = F.inherit(s, "lr", next.id, false);
  assert.equal(r.ok, false);
  assert.match(r.message, /特殊OP/);
  assert.ok(s.essences.includes(next));
});


test("試作の保存データは正しい形なら再利用できる", () => {
  const s = F.createDemo();
  ready(s, "sr");
  const e = extract(s, "atk");
  assert.equal(F.inherit(s, "sr", e.id, false).success, true);
  assert.equal(F.isValidDemoState(s), true);
  assert.equal(F.isValidDemoState(JSON.parse(JSON.stringify(s))), true);
});

test("不正な保存データを拒否して、表示クラッシュを防ぐ", () => {
  const clean = F.createDemo();
  const mutate = (callback) => {
    const bad = JSON.parse(JSON.stringify(clean));
    callback(bad);
    assert.equal(F.isValidDemoState(bad), false);
  };
  mutate(s => { s.targets = []; });
  mutate(s => { s.targets[1].options = null; });
  mutate(s => { s.targets[1].opened = 999; });
  mutate(s => { s.targets[1].options = [{ key: "unknown", inherited: true, sourceRarity: "n" }]; s.targets[1].opened = 1; s.targets[1].plus = 50; });
  mutate(s => { s.trialLiquid = -5; });
  mutate(s => { s.sources[0].id = s.sources[1].id; });
  mutate(s => { s.essences = [{id:"ess_999",key:"atk",optionRarity:"r",count:2,sourceRarity:"n"}]; });
  mutate(s => { s.sources[0].natural = true; s.sources[0].optionKey = null; });
  assert.equal(F.isValidDemoState(null), false);
  assert.equal(F.isValidDemoState(clean), true);
});

test("天然OP武器の試作用補充は上限を超えず、失敗時は状態を変えない", () => {
  const s = F.createDemo();
  for (let i = 0; i < 10; i++) assert.equal(F.addSamples(s).ok, true);
  const before = JSON.stringify(s);
  assert.equal(s.sources.length, 55);
  const error = F.addSamples(s);
  assert.equal(error.ok, false);
  assert.equal(JSON.stringify(s), before);
  assert.equal(F.isValidDemoState(s), true);
});

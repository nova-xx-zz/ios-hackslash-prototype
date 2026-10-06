// 実行: node --test（リポジトリ直下で）
// テイムできるモンスター（js/data.js の TAME_SPECIES）と、お気に入りのモンスターを合成の素材にしないこと
const test = require("node:test");
const assert = require("node:assert/strict");
const { createInventory } = require("../js/model/inventory.js");
const { createRoster } = require("../js/model/roster.js");
const { createState } = require("../js/model/save.js");
const data = require("../tools/lib/load-data.js").loadGameData();

test("テイムできるモンスター: 地方ごとに5〜6種類。種族・専用ジョブ（技3つ）・テイム率がそろっている", () => {
  const tamable = data.ENEMY_TEMPLATES.filter((t) => t.tamable);
  assert.equal(tamable.length, 37);
  const abilityIds = new Set();
  for (const t of tamable) {
    const race = data.RACES[t.key], job = data.MONSTER_JOBS[t.key];
    assert.ok(race && race.kind === "monster", t.key);
    assert.ok(job && job.abilities.length === 3, t.key);
    assert.ok(t.tameChance > 0 && t.tameChance < 1, t.key);
    for (const a of job.abilities) {
      assert.ok(!abilityIds.has(a.id), a.id);
      abilityIds.add(a.id);
      assert.equal(data.getAbilityById(a.id), a);
    }
  }
  const bosses = new Set(data.DUNGEONS.map((d) => d.boss));
  for (const region of data.REGIONS) {
    const pool = new Set(data.DUNGEONS.filter((d) => d.region === region.id).flatMap((d) => d.pool));
    const n = tamable.filter((t) => pool.has(t.key) && !bosses.has(t.key)).length;
    assert.ok(n >= 5 && n <= 7, `${region.id}: ${n}`);
  }
});

test("テイムしたモンスターは仲間になれる（能力値と技）", () => {
  const state = createState({ teamCount: 4 });
  const roster = createRoster({ data, state });
  const m = roster.newCharacter("イエティ", null, "yeti", { level: 12, isMonster: true });
  const s = roster.computeStats(m);
  assert.ok(s.maxHp > 0 && s.atk > 0);
  assert.equal(roster.availableAbilities(m).length, 3);
});

test("お気に入りのモンスターは合成の素材に選べない", () => {
  const state = createState({ teamCount: 4 });
  const roster = createRoster({ data, state });
  const inv = createInventory({ data, state, roster });
  const target = roster.newCharacter("スラ", null, "slime", { isMonster: true });
  const a = roster.newCharacter("ゴブ", null, "goblin", { isMonster: true });
  const b = roster.newCharacter("コウ", null, "bat", { isMonster: true });
  state.roster.push(target, a, b);
  assert.deepEqual(inv.fusionCandidates(target).map((m) => m.id), [a.id, b.id]);
  a.favorite = true;
  assert.deepEqual(inv.fusionCandidates(target).map((m) => m.id), [b.id]);
});

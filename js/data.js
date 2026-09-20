// ゲームデータ定義（ジョブ / アビリティ / 敵 / アイテム）
const JOBS = {
  warrior: {
    id: "warrior", name: "せんし", commandName: "とくぎ",
    base: { hp: 34, mp: 4, atk: 11, mag: 2, def: 8, spd: 6 },
    abilities: [
      { id: "double_slash", name: "れんげき", reqJP: 0, mpCost: 0, kind: "physical", target: "single", power: 0.62, hits: 2, desc: "2回連続で攻撃する" },
      { id: "crit_strike", name: "かいしんのいちげき", reqJP: 30, mpCost: 0, kind: "physical", target: "single", power: 2.1, hits: 1, desc: "会心率の高い強打" },
    ],
  },
  mage: {
    id: "mage", name: "まほうつかい", commandName: "まほう",
    base: { hp: 20, mp: 20, atk: 4, mag: 12, def: 3, spd: 7 },
    abilities: [
      { id: "fire", name: "ファイア", reqJP: 0, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1, desc: "敵1体に炎属性の魔法攻撃" },
      { id: "mega_fire", name: "メガファイア", reqJP: 30, mpCost: 10, kind: "magic", target: "all-enemy", power: 1.2, hits: 1, desc: "敵全体に炎属性の魔法攻撃" },
    ],
  },
  priest: {
    id: "priest", name: "そうりょ", commandName: "いのり",
    base: { hp: 24, mp: 18, atk: 5, mag: 9, def: 5, spd: 6 },
    abilities: [
      { id: "heal", name: "ヒール", reqJP: 0, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1, desc: "味方1体のHPを回復" },
      { id: "mega_heal", name: "メガヒール", reqJP: 30, mpCost: 12, kind: "heal", target: "all-ally", power: 1.3, hits: 1, desc: "味方全体のHPを回復" },
    ],
  },
};

function getAbilityById(id) {
  for (const jobId in JOBS) {
    const found = JOBS[jobId].abilities.find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

const ENEMY_TEMPLATES = [
  { key: "slime", name: "スライム", hp: 16, atk: 6, mag: 0, def: 2, spd: 4, exp: 6, jp: 4, color: "#4dc37a" },
  { key: "goblin", name: "ゴブリン", hp: 24, atk: 9, mag: 0, def: 4, spd: 6, exp: 9, jp: 6, color: "#8fae4d" },
  { key: "bat", name: "コウモリ", hp: 12, atk: 7, mag: 0, def: 1, spd: 10, exp: 7, jp: 5, color: "#8a6dd1" },
  { key: "wolf", name: "ウルフ", hp: 22, atk: 10, mag: 0, def: 3, spd: 8, exp: 10, jp: 6, color: "#c9c9c9" },
  { key: "ogre", name: "オーガ", hp: 48, atk: 14, mag: 0, def: 6, spd: 4, exp: 20, jp: 12, color: "#d1704d" },
];

function buildEncounter(stage) {
  const count = Math.min(5, 3 + Math.floor(stage / 2));
  const pool = stage < 3 ? ENEMY_TEMPLATES.slice(0, 3) : ENEMY_TEMPLATES;
  const list = [];
  const mult = 1 + (stage - 1) * 0.18;
  for (let i = 0; i < count; i++) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    list.push({
      key: t.key, name: t.name, color: t.color,
      hp: Math.round(t.hp * mult), maxHp: Math.round(t.hp * mult),
      atk: Math.round(t.atk * mult), mag: t.mag, def: Math.round(t.def * mult),
      spd: t.spd, exp: Math.round(t.exp * mult), jp: Math.round(t.jp * mult),
      atb: Math.random() * 30,
    });
  }
  return list;
}

const RARITIES = [
  { key: "common", name: "コモン", color: "#cfd8dc", mult: 1, weight: 60 },
  { key: "rare", name: "レア", color: "#4dc3ff", mult: 2, weight: 30 },
  { key: "epic", name: "エピック", color: "#b24dff", mult: 3.2, weight: 10 },
];

function rollRarity() {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of RARITIES) {
    if (roll < r.weight) return r;
    roll -= r.weight;
  }
  return RARITIES[0];
}

const ITEM_BASES = [
  { key: "sword", name: "剣", stat: "atk", base: 3 },
  { key: "staff", name: "杖", stat: "mag", base: 3 },
  { key: "armor", name: "よろい", stat: "def", base: 3 },
  { key: "boots", name: "くつ", stat: "spd", base: 2 },
];

function rollItemDrop() {
  const base = ITEM_BASES[Math.floor(Math.random() * ITEM_BASES.length)];
  const rarity = rollRarity();
  return {
    id: "item_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    name: `${rarity.name}の${base.name}`,
    stat: base.stat,
    value: Math.round(base.base * rarity.mult),
    rarity,
  };
}

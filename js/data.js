// ゲームデータ定義（ジョブ / アビリティ / 敵 / アイテム）
const JOBS = {
  warrior: {
    id: "warrior", name: "せんし", commandName: "とくぎ",
    base: { hp: 34, mp: 4, atk: 11, mag: 2, def: 8, spd: 6 },
    abilities: [
      { id: "double_slash", name: "れんげき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.62, hits: 2, desc: "2回連続で攻撃する" },
      { id: "crit_strike", name: "かいしんのいちげき", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 2.1, hits: 1, desc: "会心率の高い強打" },
      { id: "flurry", name: "みだれづき", reqLevel: 10, mpCost: 0, kind: "physical", target: "single", power: 0.55, hits: 3, desc: "3回連続で攻撃する" },
      { id: "cliff_slash", name: "だんがいぎり", reqLevel: 15, mpCost: 5, kind: "physical", target: "all-enemy", power: 1.3, hits: 1, desc: "敵全体を薙ぎ払う渾身の一撃" },
    ],
  },
  mage: {
    id: "mage", name: "まほうつかい", commandName: "まほう",
    base: { hp: 20, mp: 20, atk: 4, mag: 12, def: 3, spd: 7 },
    abilities: [
      { id: "fire", name: "ファイア", reqLevel: 1, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1, desc: "敵1体に炎属性の魔法攻撃" },
      { id: "mega_fire", name: "メガファイア", reqLevel: 5, mpCost: 10, kind: "magic", target: "all-enemy", power: 1.2, hits: 1, desc: "敵全体に炎属性の魔法攻撃" },
      { id: "blizzard", name: "ブリザド", reqLevel: 10, mpCost: 7, kind: "magic", target: "single", power: 2.0, hits: 1, desc: "敵1体に氷属性の強力な魔法攻撃" },
      { id: "great_blast", name: "だいばくれつ", reqLevel: 15, mpCost: 16, kind: "magic", target: "all-enemy", power: 1.6, hits: 1, desc: "敵全体に極大の魔法攻撃" },
    ],
  },
  priest: {
    id: "priest", name: "そうりょ", commandName: "いのり",
    base: { hp: 24, mp: 18, atk: 5, mag: 9, def: 5, spd: 6 },
    abilities: [
      { id: "heal", name: "ヒール", reqLevel: 1, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1, desc: "味方1体のHPを回復" },
      { id: "mega_heal", name: "メガヒール", reqLevel: 5, mpCost: 12, kind: "heal", target: "all-ally", power: 1.3, hits: 1, desc: "味方全体のHPを回復" },
      { id: "pure_light", name: "きよめのひかり", reqLevel: 10, mpCost: 8, kind: "heal", target: "single-ally", power: 2.6, hits: 1, desc: "味方1体のHPを大きく回復" },
      { id: "blessing", name: "せいれいのしゅくふく", reqLevel: 15, mpCost: 18, kind: "heal", target: "all-ally", power: 2.0, hits: 1, desc: "味方全体のHPを大きく回復" },
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
  { key: "slime", name: "スライム", hp: 16, atk: 6, mag: 0, def: 2, spd: 4, exp: 6, color: "#4dc37a", tamable: true, tameChance: 0.35 },
  { key: "goblin", name: "ゴブリン", hp: 24, atk: 9, mag: 0, def: 4, spd: 6, exp: 9, color: "#8fae4d", tamable: true, tameChance: 0.22 },
  { key: "bat", name: "コウモリ", hp: 12, atk: 7, mag: 0, def: 1, spd: 10, exp: 7, color: "#8a6dd1", tamable: true, tameChance: 0.28 },
  { key: "wolf", name: "ウルフ", hp: 22, atk: 10, mag: 0, def: 3, spd: 8, exp: 10, color: "#c9c9c9", tamable: true, tameChance: 0.2 },
  { key: "ogre", name: "オーガ", hp: 48, atk: 14, mag: 0, def: 6, spd: 4, exp: 20, color: "#d1704d", tamable: false, tameChance: 0 },
];

function getEnemyTemplate(key) {
  return ENEMY_TEMPLATES.find((t) => t.key === key);
}

// ---------- 種族 ----------
// mult: ジョブ基礎値にかける倍率。passiveは戦闘に反映する1つの分かりやすい効果のみに絞る。
const RACES = {
  human: {
    name: "ヒトゾク", kind: "player",
    mult: { hp: 1.0, mp: 1.0, atk: 1.0, mag: 1.0, def: 1.0, spd: 1.0 },
    expMult: 1.0, passive: {},
    desc: "もっともバランスの取れた種族。目立った強みはないが弱点もない。",
  },
  beastkin: {
    name: "ハーフビースト", kind: "player",
    mult: { hp: 1.0, mp: 0.85, atk: 1.15, mag: 0.85, def: 0.9, spd: 1.15 },
    expMult: 1.0, passive: { critBonus: 0.08 },
    desc: "野生の勘を宿す種族。攻撃と俊敏さに優れるが魔力は苦手。会心が出やすい。",
  },
  sylvan: {
    name: "もりびと", kind: "player",
    mult: { hp: 0.9, mp: 1.2, atk: 0.85, mag: 1.2, def: 1.1, spd: 1.05 },
    expMult: 1.1, passive: {},
    desc: "森に暮らす魔力の民。物覚えが早く、経験値を多く得られる。",
  },
  stonekin: {
    name: "いわびと", kind: "player",
    mult: { hp: 1.25, mp: 0.8, atk: 1.0, mag: 0.7, def: 1.25, spd: 0.75 },
    expMult: 1.0, passive: { dmgTakenMult: 0.92 },
    desc: "頑丈な体を持つ種族。動きは遅いが打たれ強く、受けるダメージが少し減る。",
  },
  nocturne: {
    name: "よあるきぞく", kind: "player",
    mult: { hp: 1.05, mp: 1.05, atk: 1.1, mag: 1.1, def: 1.0, spd: 1.1 },
    expMult: 0.85, passive: { lifesteal: 0.06 },
    desc: "夜に力を増す一族。総合力は高いが成長は遅く、与えたダメージの一部でHPを回復する。",
  },
  // テイムしたモンスターの種族（せんしジョブ + このステータス倍率で仲間になる）
  slime: {
    name: "スライム族", kind: "monster",
    mult: { hp: 1.3, mp: 0.8, atk: 0.7, mag: 0.6, def: 1.2, spd: 0.7 },
    expMult: 1.0, passive: { dmgTakenMult: 0.95 },
    desc: "ぷるぷるとした体で打たれ強いが、攻撃はやや控えめ。",
  },
  goblin: {
    name: "ゴブリン族", kind: "monster",
    mult: { hp: 0.95, mp: 0.7, atk: 1.1, mag: 0.6, def: 0.95, spd: 1.0 },
    expMult: 1.0, passive: { critBonus: 0.05 },
    desc: "手先が器用で急所を突くのが得意な小型の魔物。",
  },
  bat: {
    name: "コウモリ族", kind: "monster",
    mult: { hp: 0.75, mp: 0.8, atk: 0.9, mag: 0.6, def: 0.7, spd: 1.35 },
    expMult: 1.0, passive: { lifesteal: 0.05 },
    desc: "高速で飛び回り、わずかに相手の力を吸い取る。",
  },
  wolf: {
    name: "ウルフ族", kind: "monster",
    mult: { hp: 0.95, mp: 0.6, atk: 1.15, mag: 0.5, def: 0.85, spd: 1.15 },
    expMult: 1.0, passive: { critBonus: 0.06 },
    desc: "俊敏で鋭い牙を持つ狩人気質の魔物。",
  },
};

const PLAYER_RACE_IDS = Object.keys(RACES).filter((k) => RACES[k].kind === "player");
const RECRUIT_NAME_POOL = ["カイ", "レン", "シオン", "ファナ", "トウカ", "ミル", "ジン", "エマ", "ロイ", "ニナ", "ソラ", "ユキ"];

function rollNewRecruit() {
  const race = PLAYER_RACE_IDS[Math.floor(Math.random() * PLAYER_RACE_IDS.length)];
  const jobIds = Object.keys(JOBS);
  const job = jobIds[Math.floor(Math.random() * jobIds.length)];
  const name = RECRUIT_NAME_POOL[Math.floor(Math.random() * RECRUIT_NAME_POOL.length)];
  return { name, job, race };
}

// ---------- ダンジョン ----------
// x/y はマップ上の配置(％)。unlocks はクリア時に解放されるダンジョンID。
const DUNGEONS = [
  {
    id: "plains", name: "はじまりの草原", x: 20, y: 78, level: 1, battles: 3,
    pool: ["slime", "bat"], boss: "slime", unlocks: ["forest"],
    desc: "見晴らしのよい草原。弱い魔物しかいない。",
  },
  {
    id: "forest", name: "ささやきの森", x: 44, y: 60, level: 4, battles: 3,
    pool: ["slime", "goblin", "bat"], boss: "goblin", unlocks: ["cave"],
    desc: "木々のざわめきに紛れて魔物が潜む。",
  },
  {
    id: "cave", name: "こだまの洞窟", x: 26, y: 40, level: 7, battles: 4,
    pool: ["goblin", "bat", "wolf"], boss: "wolf", unlocks: ["ruins"],
    desc: "暗く入り組んだ洞窟。素早い魔物が多い。",
  },
  {
    id: "ruins", name: "忘れられた遺跡", x: 60, y: 28, level: 11, battles: 4,
    pool: ["goblin", "wolf", "ogre"], boss: "ogre", unlocks: ["peak"],
    desc: "崩れた石柱が並ぶ遺跡。強力な魔物が棲みついている。",
  },
  {
    id: "peak", name: "竜骨の山頂", x: 78, y: 12, level: 15, battles: 5,
    pool: ["wolf", "ogre"], boss: "ogre", unlocks: [],
    desc: "巨大な骨が眠る山頂。最も危険な領域。",
  },
];

function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id);
}

const BOSS_MULT = 1.7;

function buildEncounter(dungeon, battleIndex) {
  const isBossBattle = battleIndex === dungeon.battles - 1;
  // ダンジョン内で進むほど少しずつ強くなる
  const mult = (1 + (dungeon.level - 1) * 0.16) * (1 + battleIndex * 0.06);
  const count = Math.min(5, 3 + Math.floor(dungeon.level / 5));
  const list = [];

  for (let i = 0; i < count; i++) {
    const key = dungeon.pool[Math.floor(Math.random() * dungeon.pool.length)];
    list.push(makeEnemy(getEnemyTemplate(key), mult, false));
  }
  if (isBossBattle) {
    list.unshift(makeEnemy(getEnemyTemplate(dungeon.boss), mult * BOSS_MULT, true));
  }
  return list;
}

function makeEnemy(t, mult, isBoss) {
  return {
    key: t.key,
    name: isBoss ? `${t.name}の主` : t.name,
    color: t.color,
    isBoss: !!isBoss,
    hp: Math.round(t.hp * mult), maxHp: Math.round(t.hp * mult),
    atk: Math.round(t.atk * mult), mag: t.mag, def: Math.round(t.def * mult),
    spd: t.spd, exp: Math.round(t.exp * mult),
    atb: Math.random() * 30,
  };
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

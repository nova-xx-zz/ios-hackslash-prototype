// ゲームデータ定義（ジョブ / アビリティ / 敵 / アイテム）
const JOBS = {
  warrior: {
    id: "warrior", name: "せんし", commandName: "とくぎ", icon: "⚔️", tier: "basic",
    desc: "接近して斬りかかる正統派の近接アタッカー。技はどれも消費MPがなく、安定して打撃を重ねられる。",
    base: { hp: 34, mp: 4, atk: 11, mag: 2, def: 8, spd: 6 },
    abilities: [
      { id: "double_slash", name: "れんげき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.62, hits: 2, desc: "2回連続で攻撃する" },
      { id: "crit_strike", name: "かいしんのいちげき", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 2.1, hits: 1, desc: "会心率の高い強打" },
      { id: "flurry", name: "みだれづき", reqLevel: 10, mpCost: 0, kind: "physical", target: "single", power: 0.55, hits: 3, desc: "3回連続で攻撃する" },
      { id: "cliff_slash", name: "だんがいぎり", reqLevel: 15, mpCost: 5, kind: "physical", target: "all-enemy", power: 1.3, hits: 1, desc: "敵全体を薙ぎ払う渾身の一撃" },
    ],
  },
  mage: {
    id: "mage", name: "まほうつかい", commandName: "まほう", icon: "🪄", tier: "basic",
    desc: "属性魔法で敵を攻撃する後衛職。MPを多く消費するが、敵全体を巻き込む魔法も得意とする。",
    base: { hp: 20, mp: 20, atk: 4, mag: 12, def: 3, spd: 7 },
    abilities: [
      { id: "fire", name: "ファイア", reqLevel: 1, mpCost: 4, kind: "magic", target: "single", power: 1.5, hits: 1, desc: "敵1体に炎属性の魔法攻撃" },
      { id: "mega_fire", name: "メガファイア", reqLevel: 5, mpCost: 10, kind: "magic", target: "all-enemy", power: 1.2, hits: 1, desc: "敵全体に炎属性の魔法攻撃" },
      { id: "blizzard", name: "ブリザド", reqLevel: 10, mpCost: 7, kind: "magic", target: "single", power: 2.0, hits: 1, desc: "敵1体に氷属性の強力な魔法攻撃" },
      { id: "great_blast", name: "だいばくれつ", reqLevel: 15, mpCost: 16, kind: "magic", target: "all-enemy", power: 1.6, hits: 1, desc: "敵全体に極大の魔法攻撃" },
    ],
  },
  priest: {
    id: "priest", name: "そうりょ", commandName: "いのり", icon: "✨", tier: "basic",
    desc: "回復魔法を得意とする支援職。パーティのHPを立て直しながら長期戦を支える。",
    base: { hp: 24, mp: 18, atk: 5, mag: 9, def: 5, spd: 6 },
    abilities: [
      { id: "heal", name: "ヒール", reqLevel: 1, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1, desc: "味方1体のHPを回復" },
      { id: "mega_heal", name: "メガヒール", reqLevel: 5, mpCost: 12, kind: "heal", target: "all-ally", power: 1.3, hits: 1, desc: "味方全体のHPを回復" },
      { id: "pure_light", name: "きよめのひかり", reqLevel: 10, mpCost: 8, kind: "heal", target: "single-ally", power: 2.6, hits: 1, desc: "味方1体のHPを大きく回復" },
      { id: "blessing", name: "せいれいのしゅくふく", reqLevel: 15, mpCost: 18, kind: "heal", target: "all-ally", power: 2.0, hits: 1, desc: "味方全体のHPを大きく回復" },
    ],
  },
  thief: {
    id: "thief", name: "とうぞく", commandName: "わざ", icon: "🗡️", tier: "basic",
    desc: "素早い身のこなしで多段攻撃を得意とする軽戦士。行動速度が高く、手数で押し切る。",
    base: { hp: 24, mp: 8, atk: 9, mag: 3, def: 5, spd: 10 },
    abilities: [
      { id: "slash", name: "きりつけ", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.15, hits: 1, desc: "素早く斬りつける" },
      { id: "wild_slash", name: "みだれぎり", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "3回続けて斬る" },
      { id: "pursuit", name: "ついげき", reqLevel: 10, mpCost: 3, kind: "physical", target: "single", power: 0.45, hits: 4, desc: "4回連続で追撃する" },
      { id: "shadow_sew", name: "かげぬい", reqLevel: 15, mpCost: 6, kind: "physical", target: "all-enemy", power: 1.1, hits: 1, desc: "影から敵全体を斬り抜ける" },
    ],
  },
  monk: {
    id: "monk", name: "ぶとうか", commandName: "けんぽう", icon: "👊", tier: "basic",
    desc: "拳で戦いながら気の力で自らを癒す、攻撃と回復を両立できる近接職。",
    base: { hp: 32, mp: 6, atk: 10, mag: 4, def: 7, spd: 8 },
    abilities: [
      { id: "straight", name: "せいけんづき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "鍛えた拳で突く" },
      { id: "rush", name: "れんだ", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.45, hits: 3, desc: "拳を3回叩き込む" },
      { id: "chi_heal", name: "きこう", reqLevel: 10, mpCost: 5, kind: "heal", target: "single-ally", power: 1.6, hits: 1, desc: "気を巡らせて味方1体を回復する" },
      { id: "wave", name: "はどう", reqLevel: 15, mpCost: 8, kind: "magic", target: "all-enemy", power: 1.3, hits: 1, desc: "闘気の波動で敵全体を撃つ" },
    ],
  },
  darkknight: {
    id: "darkknight", name: "あんこくし", commandName: "あんこく", icon: "🌑", tier: "basic",
    desc: "闇の力で敵のHPを吸収する異端の戦士。攻撃を重ねながら自分のHPも回復できる。",
    base: { hp: 30, mp: 10, atk: 12, mag: 6, def: 7, spd: 6 },
    abilities: [
      { id: "dark_slash", name: "やみぎり", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "闇をまとった斬撃" },
      { id: "drain", name: "ドレイン", reqLevel: 5, mpCost: 5, kind: "magic", target: "single", power: 1.3, hits: 1, lifesteal: 0.6, desc: "与えたダメージの6割を吸収する" },
      { id: "black_mist", name: "くろいきり", reqLevel: 10, mpCost: 9, kind: "magic", target: "all-enemy", power: 1.1, hits: 1, desc: "黒い霧で敵全体を侵す" },
      { id: "soul_edge", name: "こんしんのいちげき", reqLevel: 15, mpCost: 6, kind: "physical", target: "single", power: 2.6, hits: 1, desc: "魂を削る渾身の一撃" },
    ],
  },
  // ---------- 上級職（対応する基本職をLv.15まで極めると転職できる） ----------
  swordmaster: {
    id: "swordmaster", name: "けんごう", commandName: "けんじゅつ", icon: "🌀", tier: "advanced",
    requires: { job: "warrior", level: 15 },
    desc: "せんしの技を極めた剣の達人。一撃の重さと隙のない連撃を兼ね備える。",
    base: { hp: 42, mp: 4, atk: 15, mag: 2, def: 9, spd: 8 },
    abilities: [
      { id: "iai_slash", name: "いあいぎり", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.5, hits: 1, desc: "抜刀の一撃で敵を斬る" },
      { id: "tornado_slash", name: "たつまきぎり", reqLevel: 5, mpCost: 0, kind: "physical", target: "all-enemy", power: 0.95, hits: 1, desc: "刃の竜巻で敵全体を斬り払う" },
      { id: "hundred_slash", name: "ひゃくれつざん", reqLevel: 10, mpCost: 4, kind: "physical", target: "single", power: 0.42, hits: 5, desc: "目にも留まらぬ5連撃" },
      { id: "peerless_slash", name: "むそうのいちげき", reqLevel: 15, mpCost: 8, kind: "physical", target: "single", power: 3.4, hits: 1, desc: "会心必中、奥義の一閃" },
    ],
  },
  archmage: {
    id: "archmage", name: "だいまどうし", commandName: "だいまほう", icon: "🔥", tier: "advanced",
    requires: { job: "mage", level: 15 },
    desc: "まほうつかいの上位職。より強大な魔法を扱い、大魔法で戦況を一変させる。",
    base: { hp: 24, mp: 28, atk: 4, mag: 17, def: 4, spd: 8 },
    abilities: [
      { id: "thunder_bolt", name: "いなずま", reqLevel: 1, mpCost: 5, kind: "magic", target: "single", power: 1.9, hits: 1, desc: "鋭い雷撃を放つ" },
      { id: "grand_thunder", name: "ごくらいせん", reqLevel: 5, mpCost: 12, kind: "magic", target: "all-enemy", power: 1.55, hits: 1, desc: "極大の雷撃で敵全体を撃つ" },
      { id: "absolute_zero", name: "ぜったいれいど", reqLevel: 10, mpCost: 10, kind: "magic", target: "single", power: 2.7, hits: 1, desc: "凍てつく極寒の一撃" },
      { id: "limit_magic", name: "げんかいまほう", reqLevel: 15, mpCost: 20, kind: "magic", target: "all-enemy", power: 2.0, hits: 1, desc: "魔力を限界まで解き放つ大魔法" },
    ],
  },
  archpriest: {
    id: "archpriest", name: "だいしんかん", commandName: "だいいのり", icon: "🕊️", tier: "advanced",
    requires: { job: "priest", level: 15 },
    desc: "そうりょの上位職。回復量と範囲に優れ、パーティを崩れさせない支柱となる。",
    base: { hp: 28, mp: 26, atk: 5, mag: 13, def: 6, spd: 7 },
    abilities: [
      { id: "great_heal", name: "だいちゆ", reqLevel: 1, mpCost: 7, kind: "heal", target: "single-ally", power: 2.2, hits: 1, desc: "味方1体を大きく回復する" },
      { id: "full_heal", name: "かんぜんかいふく", reqLevel: 5, mpCost: 14, kind: "heal", target: "single-ally", power: 4.0, hits: 1, desc: "味方1体のHPを完全に回復する" },
      { id: "sanctuary_prayer", name: "せいいきのいのり", reqLevel: 10, mpCost: 16, kind: "heal", target: "all-ally", power: 2.4, hits: 1, desc: "味方全体を大きく回復する祈り" },
      { id: "miracle_light", name: "きせきのひかり", reqLevel: 15, mpCost: 24, kind: "heal", target: "all-ally", power: 3.2, hits: 1, desc: "奇跡の光で全体を癒やす" },
    ],
  },
  ninja: {
    id: "ninja", name: "にんじゃ", commandName: "にんじゅつ", icon: "🥷", tier: "advanced",
    requires: { job: "thief", level: 15 },
    desc: "とうぞくの上位職。卓越した速さと多彩な技でひたすら手数を重ねる。",
    base: { hp: 27, mp: 10, atk: 13, mag: 4, def: 6, spd: 14 },
    abilities: [
      { id: "shuriken", name: "しゅりけん", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.3, hits: 1, desc: "手裏剣を投げつける" },
      { id: "silent_blade", name: "しのびだち", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.48, hits: 3, desc: "音もなく3連撃を放つ" },
      { id: "poison_needle", name: "どくばり", reqLevel: 10, mpCost: 3, kind: "physical", target: "single", power: 1.7, hits: 1, desc: "急所を狙い深く突き刺す" },
      { id: "ougi_no_jutsu", name: "ごくいのじゅつ", reqLevel: 15, mpCost: 7, kind: "physical", target: "all-enemy", power: 1.35, hits: 1, desc: "会得した奥義で敵全体を斬る" },
    ],
  },
  saintfist: {
    id: "saintfist", name: "けんせい", commandName: "せいけん", icon: "🕉️", tier: "advanced",
    requires: { job: "monk", level: 15 },
    desc: "ぶとうかの上位職。拳の威力と気の扱いが共に極まった、攻守一体の達人。",
    base: { hp: 40, mp: 9, atk: 15, mag: 6, def: 10, spd: 10 },
    abilities: [
      { id: "vacuum_thrust", name: "しんくうづき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.5, hits: 1, desc: "衝撃波を伴う一撃" },
      { id: "fist_barrage", name: "れんげきけん", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.42, hits: 4, desc: "拳による4連撃" },
      { id: "chi_flow_heal", name: "きろのちゆ", reqLevel: 10, mpCost: 6, kind: "heal", target: "all-ally", power: 1.8, hits: 1, desc: "気を巡らせ味方全体を癒やす" },
      { id: "ougi_no_sho", name: "ごくいのしょう", reqLevel: 15, mpCost: 9, kind: "physical", target: "all-enemy", power: 1.7, hits: 1, desc: "会得した掌打の極意で敵全体を打つ" },
    ],
  },
  reaper: {
    id: "reaper", name: "しにがみ", commandName: "しにがみのちから", icon: "💀", tier: "advanced",
    requires: { job: "darkknight", level: 15 },
    desc: "あんこくしの上位職。生命力を刈り取る技で、攻撃と回復を同時に成立させる。",
    base: { hp: 36, mp: 14, atk: 17, mag: 9, def: 8, spd: 8 },
    abilities: [
      { id: "sickle_wind", name: "かまいたち", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.4, hits: 1, desc: "鎌のような斬撃で切り裂く" },
      { id: "soul_sickle", name: "たましいのかま", reqLevel: 5, mpCost: 6, kind: "magic", target: "single", power: 1.6, hits: 1, lifesteal: 0.5, desc: "魂を刈り取るような一撃。与ダメージの5割を吸収する" },
      { id: "kiss_of_death", name: "しのくちづけ", reqLevel: 10, mpCost: 11, kind: "magic", target: "all-enemy", power: 1.3, hits: 1, lifesteal: 0.3, desc: "触れた者の力を吸い取る。与ダメージの3割を吸収する" },
      { id: "grand_sickle", name: "こんぱくのだいかま", reqLevel: 15, mpCost: 10, kind: "physical", target: "single", power: 3.0, hits: 1, lifesteal: 0.4, desc: "魂ごと刈り取る渾身の一撃。与ダメージの4割を吸収する" },
    ],
  },
};

const BASIC_JOB_IDS = Object.keys(JOBS).filter((id) => JOBS[id].tier === "basic");

// テイムしたモンスター専用のジョブ。種族IDと対応し、人間のジョブには転職できない。
const MONSTER_JOBS = {
  slime: {
    id: "slime", name: "スライム",
    base: { hp: 30, mp: 6, atk: 8, mag: 3, def: 9, spd: 5 },
    abilities: [
      { id: "m_body_slam", name: "たいあたり", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.1, hits: 1, desc: "体ごとぶつかる" },
      { id: "m_swallow", name: "まるのみ", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 1.9, hits: 1, desc: "敵を包み込んで締め上げる" },
      { id: "m_split", name: "ぶんれつたい", reqLevel: 10, mpCost: 4, kind: "physical", target: "all-enemy", power: 0.9, hits: 1, desc: "分裂した体で敵全体を叩く" },
    ],
  },
  goblin: {
    id: "goblin", name: "ゴブリン",
    base: { hp: 24, mp: 6, atk: 11, mag: 3, def: 6, spd: 7 },
    abilities: [
      { id: "m_ambush", name: "ふいうち", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.3, hits: 1, desc: "不意を突いて斬りかかる" },
      { id: "m_scratch", name: "みだれひっかき", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "3回続けてひっかく" },
      { id: "m_vital", name: "きゅうしょづき", reqLevel: 10, mpCost: 3, kind: "physical", target: "single", power: 2.2, hits: 1, desc: "急所を的確に突く" },
    ],
  },
  bat: {
    id: "bat", name: "コウモリ",
    base: { hp: 18, mp: 8, atk: 9, mag: 5, def: 4, spd: 11 },
    abilities: [
      { id: "m_bite", name: "かみつく", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.0, hits: 1, desc: "素早くかみつく" },
      { id: "m_drain", name: "きゅうけつ", reqLevel: 5, mpCost: 2, kind: "physical", target: "single", power: 1.2, hits: 1, lifesteal: 0.5, desc: "与えたダメージの半分だけHPを吸収する" },
      { id: "m_sonic", name: "ソニックウェーブ", reqLevel: 10, mpCost: 6, kind: "magic", target: "all-enemy", power: 0.9, hits: 1, desc: "超音波で敵全体を攻撃する" },
    ],
  },
  wolf: {
    id: "wolf", name: "ウルフ",
    base: { hp: 26, mp: 5, atk: 12, mag: 2, def: 6, spd: 9 },
    abilities: [
      { id: "m_crunch", name: "かみくだく", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "鋭い牙でかみくだく" },
      { id: "m_gale_claw", name: "れっぷうづめ", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.6, hits: 3, desc: "疾風のような3連撃" },
      { id: "m_dash", name: "しっそうぎり", reqLevel: 10, mpCost: 4, kind: "physical", target: "all-enemy", power: 1.0, hits: 1, desc: "駆け抜けながら敵全体を裂く" },
    ],
  },
};

function getAbilityById(id) {
  for (const jobId in JOBS) {
    const found = JOBS[jobId].abilities.find((a) => a.id === id);
    if (found) return found;
  }
  for (const jobId in MONSTER_JOBS) {
    const found = MONSTER_JOBS[jobId].abilities.find((a) => a.id === id);
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
    name: "ヒトゾク", kind: "player", icon: "👤",
    mult: { hp: 1.0, mp: 1.0, atk: 1.0, mag: 1.0, def: 1.0, spd: 1.0 },
    expMult: 1.0, passive: {},
    desc: "もっともバランスの取れた種族。目立った強みはないが弱点もない。",
  },
  beastkin: {
    name: "ハーフビースト", kind: "player", icon: "🐾",
    mult: { hp: 1.0, mp: 0.85, atk: 1.15, mag: 0.85, def: 0.9, spd: 1.15 },
    expMult: 1.0, passive: { critBonus: 0.08 },
    desc: "野生の勘を宿す種族。攻撃と俊敏さに優れるが魔力は苦手。会心が出やすい。",
  },
  sylvan: {
    name: "もりびと", kind: "player", icon: "🌿",
    mult: { hp: 0.9, mp: 1.2, atk: 0.85, mag: 1.2, def: 1.1, spd: 1.05 },
    expMult: 1.1, passive: {},
    desc: "森に暮らす魔力の民。物覚えが早く、経験値を多く得られる。",
  },
  stonekin: {
    name: "いわびと", kind: "player", icon: "🪨",
    mult: { hp: 1.25, mp: 0.8, atk: 1.0, mag: 0.7, def: 1.25, spd: 0.75 },
    expMult: 1.0, passive: { dmgTakenMult: 0.92 },
    desc: "頑丈な体を持つ種族。動きは遅いが打たれ強く、受けるダメージが少し減る。",
  },
  nocturne: {
    name: "よあるきぞく", kind: "player", icon: "🌙",
    mult: { hp: 1.05, mp: 1.05, atk: 1.1, mag: 1.1, def: 1.0, spd: 1.1 },
    expMult: 0.85, passive: { lifesteal: 0.06 },
    desc: "夜に力を増す一族。総合力は高いが成長は遅く、与えたダメージの一部でHPを回復する。",
  },
  artisan: {
    name: "こうじん", kind: "player", icon: "🛠️",
    mult: { hp: 0.9, mp: 1.3, atk: 0.85, mag: 1.15, def: 0.95, spd: 1.0 },
    expMult: 1.0, passive: { mpCostMult: 0.8 },
    desc: "魔力の扱いに長けた技巧の民。MPが多く、技の消費MPが2割少なくて済む。",
  },
  spiritkin: {
    name: "せいれいぞく", kind: "player", icon: "🔮",
    mult: { hp: 0.85, mp: 1.25, atk: 0.8, mag: 1.2, def: 0.9, spd: 1.1 },
    expMult: 1.0, passive: { healBonus: 0.25 },
    desc: "精霊の血を引く種族。体は脆いが、使う回復量が25%増える。",
  },
  giant: {
    name: "きょじん", kind: "player", icon: "⛰️",
    mult: { hp: 1.4, mp: 0.7, atk: 1.25, mag: 0.7, def: 1.15, spd: 0.65 },
    expMult: 0.9, passive: { dmgTakenMult: 0.9 },
    desc: "山のような巨躯を持つ種族。圧倒的な体力と攻撃力を誇るが、動きは非常に遅い。",
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
  const jobIds = BASIC_JOB_IDS;
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

const SLOTS = [
  { key: "weapon", name: "武器" },
  { key: "armor", name: "防具" },
  { key: "accessory", name: "装飾品" },
];

const ITEM_BASES = [
  { key: "sword", name: "剣", slot: "weapon", stat: "atk", base: 3 },
  { key: "staff", name: "杖", slot: "weapon", stat: "mag", base: 3 },
  { key: "claw", name: "かぎ爪", slot: "weapon", stat: "spd", base: 2 },
  { key: "armor", name: "よろい", slot: "armor", stat: "def", base: 3 },
  { key: "robe", name: "ローブ", slot: "armor", stat: "mp", base: 4 },
  { key: "amulet", name: "お守り", slot: "accessory", stat: "hp", base: 6 },
  { key: "ring", name: "指輪", slot: "accessory", stat: "mag", base: 2 },
  { key: "boots", name: "くつ", slot: "accessory", stat: "spd", base: 2 },
];

const STAT_LABELS = { hp: "HP", mp: "MP", atk: "ATK", mag: "MAG", def: "DEF", spd: "SPD" };

let itemSeq = 1;
function rollItemDrop() {
  const base = ITEM_BASES[Math.floor(Math.random() * ITEM_BASES.length)];
  const rarity = rollRarity();
  return {
    id: "item_" + itemSeq++,
    name: `${rarity.name}の${base.name}`,
    slot: base.slot,
    stat: base.stat,
    value: Math.round(base.base * rarity.mult),
    rarity: rarity.key,
    rarityColor: rarity.color,
  };
}

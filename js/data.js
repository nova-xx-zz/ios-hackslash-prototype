// ゲームデータ定義（ジョブ / アビリティ / 敵 / アイテム）

// ゲーム内の抽選はすべてこの共有乱数を通す（js/core/rng.js。テストではシード付きに差し替えられる）
const RNG = QPCore.rng.shared;

// 段階公開の機能フラグ（配布バージョンごとの運営設定）。告知の公開日時や端末時計からは
// 算出しない。falseの機能はUI・ドロップ・効果・オフライン精算のいずれにも影響させない。
// スキルツリーは「標準ツリー＋SP」の第1弾として実装済み。スキルブック・鑑定所・一次職の
// 極みは、それらに依存する第2弾以降の機能のため引き続きfalse（設計のみ済みで未実装）。
const FEATURE_FLAGS = {
  announcements: true,
  skillTree: true,
  skillBook: false,
  appraisal: false,
  jobMastery: false,
  guaranteedStone: false, // 確定強化石（成功率100%の有償アイテム）。入手経路（アプリ内課金）が整うまで無効
  enhancePity: true, // 強化の天井（失敗で使った強化石が期待消費の1.5倍に達したら次は必ず成功）
};
function isFeatureEnabled(key) { return !!FEATURE_FLAGS[key]; }

// レベルアップに必要なEXP（Lv.level → level+1）。game.js と tools/progression.js で共有する。
// 各ダンジョンに着く頃の累計周回が 森10・洞窟20・遺跡45・山頂95 前後になるよう
// tools/progression.js で合わせた（＝その頃に適正装備 benchmarkGear がそろう。docs/production-plan.md §8.6）
// Lv15より先（ヴェルデ地方の後、推奨Lv100までのダンジョン）は伸び方をゆるめ（Lvの2.3乗）、1レベルに要る周回数が
// 奥へ行くほどゆっくり増えるようにする（Lv15→16で約7周、Lv99→100で約80周の見込み。地方を足すたびに tools/progression.js で確認）
const EXP_CURVE_KNEE = 15;
function expForLevel(level) {
  const steep = (lv) => Math.round(200 + 2 * Math.pow(lv, 3.3));
  if (level <= EXP_CURVE_KNEE) return steep(level);
  return Math.round(steep(EXP_CURVE_KNEE) * Math.pow(level / EXP_CURVE_KNEE, 2.3));
}
// セーブのレベル記録（キャラ本体・jobLevelsの各ジョブ）の必要EXPを曲線から計算し直す（読み込み時に使用）。
// レベルは据え置き、exp は新しい必要量未満に丸める
function syncExpToNext(rec) {
  if (!rec || typeof rec.level !== "number") return;
  rec.expToNext = expForLevel(rec.level);
  rec.exp = Math.max(0, Math.min(Number(rec.exp) || 0, rec.expToNext - 1));
}

const JOB_MASTER_LEVEL = 50; // 上級職の解放に必要な、対応する基本職のレベル
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
  // ---------- 上級職（対応する基本職をLv.50まで極めると転職できる） ----------
  swordmaster: {
    id: "swordmaster", name: "けんごう", commandName: "けんじゅつ", icon: "🌀", tier: "advanced",
    requires: { job: "warrior", level: JOB_MASTER_LEVEL },
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
    requires: { job: "mage", level: JOB_MASTER_LEVEL },
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
    requires: { job: "priest", level: JOB_MASTER_LEVEL },
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
    requires: { job: "thief", level: JOB_MASTER_LEVEL },
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
    requires: { job: "monk", level: JOB_MASTER_LEVEL },
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
    requires: { job: "darkknight", level: JOB_MASTER_LEVEL },
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

// ---------- スキルツリー（系統タグ単位。基本職と対応する上級職で共有する） ----------
// docs/basic-design.md §7.1 の系統タグ表に対応。上級職も同じタグ＝同じツリーを使う
// （転職してもツリーの「内容」は変わらないが、進行はジョブごとに別管理＝jobLevels[jobId].skillTree）。
const JOB_TAGS = {
  warrior: ["warrior", "swordmaster"],
  magic: ["mage", "archmage"],
  healer: ["priest", "archpriest"],
  rogue: ["thief", "ninja"],
  martial: ["monk", "saintfist"],
  dark: ["darkknight", "reaper"],
};
function jobTag(jobId) {
  for (const tag in JOB_TAGS) {
    if (JOB_TAGS[tag].includes(jobId)) return tag;
  }
  return null;
}

// ノードのeffects種別: statAdd(能力値に加算)/passiveAdd(会心率などに加算)/passiveMult(被ダメ等に乗算)。
// activeノードはabilityに通常のアビリティと同じ形のオブジェクトを持ち、習得すると使える技が1つ増える。
// costByRank/maxRankは将来ランク制に拡張できる形にしているが、現状は全ノードmaxRank:1。
// x/yはツリー図の表示座標（0-100のパーセンテージ、分岐図を手作業でレイアウト）。
// SPの数値・ノード内容は初期実装のための調整値であり、確定した最終バランスではない。
//
// 1キャラは「固有ツリー（系統タグごとに1本、交換不可）」＋「汎用ツリー3枠（GENERAL_SLOTS、
// 枠ごとに決まった2択から交換可能）」の計4本を同時に持つ。SPは全4本で共有する1つのプールから
// 消費する（totalSp(c) - 4本ぶんの消費SP合計）。
const EXCLUSIVE_TREES = {
  warrior: {
    id: "warrior", tag: "warrior", name: "剛勇の心得",
    nodes: [
      { id: "w1", kind: "passive", name: "鍛えた腕", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "atk", value: 3 }], desc: "ATK+3" },
      { id: "w2", kind: "passive", name: "戦いの勘", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "w1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%" },
      { id: "w3", kind: "active", name: "けんげきづき", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_w3", name: "けんげきづき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.8, hits: 1, desc: "剛勇の心得で会得した強撃" },
        effects: [], desc: "新しい技「けんげきづき」を習得" },
      { id: "w4a", kind: "passive", name: "不動の構え", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: "w_style", x: 25, y: 88,
        effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4bと選択）" },
      { id: "w4b", kind: "passive", name: "猛攻の構え", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: "w_style", x: 75, y: 88,
        effects: [{ type: "statAdd", stat: "atk", value: 6 }], desc: "ATK+6（4aと選択）" },
    ],
  },
  magic: {
    id: "magic", tag: "magic", name: "魔導の探求",
    nodes: [
      { id: "m1", kind: "passive", name: "魔力の素地", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3" },
      { id: "m2", kind: "passive", name: "省魔の心得", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "m1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%" },
      { id: "m3", kind: "active", name: "アビスボルト", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_m3", name: "アビスボルト", reqLevel: 1, mpCost: 8, kind: "magic", target: "single", power: 2.2, hits: 1, desc: "魔導の探求で会得した深淵の魔法" },
        effects: [], desc: "新しい技「アビスボルト」を習得" },
      { id: "m4a", kind: "passive", name: "魔力の深化", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: "m_style", x: 25, y: 88,
        effects: [{ type: "statAdd", stat: "mag", value: 6 }], desc: "MAG+6（4bと選択）" },
      { id: "m4b", kind: "passive", name: "魔導障壁", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: "m_style", x: 75, y: 88,
        effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4aと選択）" },
    ],
  },
  healer: {
    id: "healer", tag: "healer", name: "癒しの祈り",
    nodes: [
      { id: "h1", kind: "passive", name: "祈りの基礎", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3" },
      { id: "h2", kind: "passive", name: "癒しの心得", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "h1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveAdd", key: "healBonus", value: 0.15 }], desc: "回復量+15%" },
      { id: "h3", kind: "active", name: "せいれいのしずく", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_h3", name: "せいれいのしずく", reqLevel: 1, mpCost: 6, kind: "heal", target: "single-ally", power: 2.0, hits: 1, desc: "癒しの祈りで会得した回復術" },
        effects: [], desc: "新しい技「せいれいのしずく」を習得" },
      { id: "h4a", kind: "passive", name: "深い祈り", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: "h_style", x: 25, y: 88,
        effects: [{ type: "passiveAdd", key: "healBonus", value: 0.1 }], desc: "回復量さらに+10%（4bと選択）" },
      { id: "h4b", kind: "passive", name: "清貧の心", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: "h_style", x: 75, y: 88,
        effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（4aと選択）" },
    ],
  },
  rogue: {
    id: "rogue", tag: "rogue", name: "迅速の型",
    nodes: [
      { id: "r1", kind: "passive", name: "身のこなし", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2" },
      { id: "r2", kind: "passive", name: "急所の見極め", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "r1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%" },
      { id: "r3", kind: "active", name: "れんぞくげき", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_r3", name: "れんぞくげき", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "迅速の型で会得した3連撃" },
        effects: [], desc: "新しい技「れんぞくげき」を習得" },
      { id: "r4a", kind: "passive", name: "疾風の足", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: "r_style", x: 25, y: 88,
        effects: [{ type: "statAdd", stat: "spd", value: 3 }], desc: "SPD+3（4bと選択）" },
      { id: "r4b", kind: "passive", name: "必殺の視点", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: "r_style", x: 75, y: 88,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.08 }], desc: "会心率さらに+8%（4aと選択）" },
    ],
  },
  martial: {
    id: "martial", tag: "martial", name: "闘気の鍛錬",
    nodes: [
      { id: "k1", kind: "passive", name: "頑健な体", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "hp", value: 15 }], desc: "HP+15" },
      { id: "k2", kind: "passive", name: "気の巡り", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "k1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "与ダメージの5%を吸収" },
      { id: "k3", kind: "active", name: "きあつぶし", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_k3", name: "きあつぶし", reqLevel: 1, mpCost: 4, kind: "physical", target: "single", power: 1.6, hits: 1, desc: "闘気の鍛錬で会得した気の一撃" },
        effects: [], desc: "新しい技「きあつぶし」を習得" },
      { id: "k4a", kind: "passive", name: "鉄壁の体", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: "k_style", x: 25, y: 88,
        effects: [{ type: "statAdd", stat: "def", value: 6 }], desc: "DEF+6（4bと選択）" },
      { id: "k4b", kind: "passive", name: "気吸の極意", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: "k_style", x: 75, y: 88,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "吸収さらに+5%（4aと選択）" },
    ],
  },
  dark: {
    id: "dark", tag: "dark", name: "深淵の契約",
    nodes: [
      { id: "d1", kind: "passive", name: "闇との親和", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 8,
        effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3" },
      { id: "d2", kind: "passive", name: "生気の収奪", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "d1", minRank: 1 }], exclusiveGroup: null, x: 50, y: 32,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "与ダメージの5%を吸収" },
      { id: "d3", kind: "active", name: "ソウルドレイン", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d2", minRank: 1 }], exclusiveGroup: null, x: 50, y: 56,
        ability: { id: "tree_d3", name: "ソウルドレイン", reqLevel: 1, mpCost: 7, kind: "magic", target: "single", power: 1.8, hits: 1, lifesteal: 0.4, desc: "深淵の契約で会得した吸魂の魔法。与ダメージの4割を吸収する" },
        effects: [], desc: "新しい技「ソウルドレイン」を習得" },
      { id: "d4a", kind: "passive", name: "深淵の加護", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: "d_style", x: 25, y: 88,
        effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4bと選択）" },
      { id: "d4b", kind: "passive", name: "渇望の契約", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: "d_style", x: 75, y: 88,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "吸収さらに+5%（4aと選択）" },
    ],
  },
};
function getExclusiveTreeByTag(tag) { return EXCLUSIVE_TREES[tag] || null; }

// ---------- 汎用ツリー（全ジョブ共通のプール。系統を問わず誰でも習得できる） ----------
// GENERAL_SLOTSの3枠それぞれに固定の交換候補2種が割り当てられており、枠の中でだけ
// 切り替えられる（枠をまたいだ自由選択はしない）。汎用ツリーはノードの効果を種族・ジョブに
// 依存しない汎用的なものに統一し、アクティブ技は持たない（パッシブのみ）。
const GENERAL_TREES = {
  offense: {
    id: "offense", name: "攻めの心得",
    nodes: [
      { id: "go1", kind: "passive", name: "会心の芽生え", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.04 }], desc: "会心率+4%" },
      { id: "go2a", kind: "passive", name: "会心の極み", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "go1", minRank: 1 }], exclusiveGroup: "offense_style", x: 25, y: 82,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.06 }], desc: "会心率さらに+6%（右と選択）" },
      { id: "go2b", kind: "passive", name: "猛攻の型", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "go1", minRank: 1 }], exclusiveGroup: "offense_style", x: 75, y: 82,
        effects: [{ type: "statAdd", stat: "atk", value: 4 }, { type: "statAdd", stat: "mag", value: 4 }], desc: "ATK+4・MAG+4（左と選択）" },
    ],
  },
  speed: {
    id: "speed", name: "俊敏の心得",
    nodes: [
      { id: "gs1", kind: "passive", name: "軽い足取り", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "statAdd", stat: "spd", value: 3 }], desc: "SPD+3" },
      { id: "gs2a", kind: "passive", name: "疾風", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gs1", minRank: 1 }], exclusiveGroup: "speed_style", x: 25, y: 82,
        effects: [{ type: "statAdd", stat: "spd", value: 4 }], desc: "SPDさらに+4（右と選択）" },
      { id: "gs2b", kind: "passive", name: "先手必勝", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gs1", minRank: 1 }], exclusiveGroup: "speed_style", x: 75, y: 82,
        effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%（左と選択）" },
    ],
  },
  defense: {
    id: "defense", name: "守りの心得",
    nodes: [
      { id: "gd1", kind: "passive", name: "鉄の肌", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "statAdd", stat: "def", value: 4 }], desc: "DEF+4" },
      { id: "gd2a", kind: "passive", name: "不屈の盾", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gd1", minRank: 1 }], exclusiveGroup: "defense_style", x: 25, y: 82,
        effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（右と選択）" },
      { id: "gd2b", kind: "passive", name: "頑強", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gd1", minRank: 1 }], exclusiveGroup: "defense_style", x: 75, y: 82,
        effects: [{ type: "statAdd", stat: "hp", value: 20 }], desc: "HP+20（左と選択）" },
    ],
  },
  vampiric: {
    id: "vampiric", name: "吸魂の心得",
    nodes: [
      { id: "gv1", kind: "passive", name: "渇きの芽生え", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.03 }], desc: "与ダメージの3%を吸収" },
      { id: "gv2a", kind: "passive", name: "渇望", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gv1", minRank: 1 }], exclusiveGroup: "vampiric_style", x: 25, y: 82,
        effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収さらに+4%（右と選択）" },
      { id: "gv2b", kind: "passive", name: "頑強な渇き", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gv1", minRank: 1 }], exclusiveGroup: "vampiric_style", x: 75, y: 82,
        effects: [{ type: "statAdd", stat: "hp", value: 15 }], desc: "HP+15（左と選択）" },
    ],
  },
  support: {
    id: "support", name: "支援の心得",
    nodes: [
      { id: "gu1", kind: "passive", name: "癒しの手", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "passiveAdd", key: "healBonus", value: 0.08 }], desc: "回復量+8%" },
      { id: "gu2a", kind: "passive", name: "深い慈愛", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gu1", minRank: 1 }], exclusiveGroup: "support_style", x: 25, y: 82,
        effects: [{ type: "passiveAdd", key: "healBonus", value: 0.08 }], desc: "回復量さらに+8%（右と選択）" },
      { id: "gu2b", kind: "passive", name: "節約の心得", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gu1", minRank: 1 }], exclusiveGroup: "support_style", x: 75, y: 82,
        effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（左と選択）" },
    ],
  },
  arcane: {
    id: "arcane", name: "魔導の心得",
    nodes: [
      { id: "ga1", kind: "passive", name: "魔力の残滓", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, y: 12,
        effects: [{ type: "statAdd", stat: "mag", value: 4 }], desc: "MAG+4" },
      { id: "ga2a", kind: "passive", name: "深奥の力", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "ga1", minRank: 1 }], exclusiveGroup: "arcane_style", x: 25, y: 82,
        effects: [{ type: "statAdd", stat: "mag", value: 6 }], desc: "MAGさらに+6（右と選択）" },
      { id: "ga2b", kind: "passive", name: "省魔の極意", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "ga1", minRank: 1 }], exclusiveGroup: "arcane_style", x: 75, y: 82,
        effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（左と選択）" },
    ],
  },
};
function getGeneralTree(id) { return GENERAL_TREES[id] || null; }

// 汎用ツリー3枠。枠ごとに交換候補2種を固定し、キャラは各枠でどちらか一方を装備する。
// defaultTreeIdは新規キャラ・旧セーブ移行時に各枠へ最初に割り当てるツリー。
const GENERAL_SLOTS = [
  { key: "slot1", label: "汎用ツリー①", candidates: ["offense", "speed"], defaultTreeId: "offense" },
  { key: "slot2", label: "汎用ツリー②", candidates: ["defense", "vampiric"], defaultTreeId: "defense" },
  { key: "slot3", label: "汎用ツリー③", candidates: ["support", "arcane"], defaultTreeId: "support" },
];
function getGeneralSlotDef(slotKey) { return GENERAL_SLOTS.find((s) => s.key === slotKey) || null; }

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

// element はフレーバー・図鑑表示専用のタグで、戦闘計算には一切影響しない
const ENEMY_TEMPLATES = [
  // ---- はじまりの草原 (Lv1) ----
  { key: "slime", name: "スライム", hp: 16, atk: 6, mag: 0, def: 2, spd: 4, exp: 6, color: "#4dc37a", icon: "🟢", element: "水", tamable: true, tameChance: 0.35, desc: "どこにでもいる最弱の魔物。柔らかい体で衝撃を吸収する。" },
  { key: "killer_moth", name: "キラーモス", hp: 10, atk: 5, mag: 0, def: 1, spd: 11, exp: 5, color: "#d1c94d", icon: "🦋", element: "風", tamable: false, tameChance: 0, desc: "草原を群れで飛び回る蛾。鱗粉をまき散らして視界を奪う。" },
  { key: "field_rat", name: "フィールドラット", hp: 13, atk: 5, mag: 0, def: 2, spd: 7, exp: 5, color: "#a67c52", icon: "🐀", element: "無", tamable: false, tameChance: 0, desc: "草原にすむ小さなネズミ。繁殖力が高く数で押し寄せる。" },
  { key: "mud_plant", name: "マッドプラント", hp: 22, atk: 4, mag: 0, def: 5, spd: 2, exp: 6, color: "#6d7a3d", icon: "🌿", element: "土", tamable: false, tameChance: 0, desc: "泥の中に潜み、根を伸ばして獲物を絡めとる植物型の魔物。" },
  { key: "leaf_pixie", name: "リーフピクシー", hp: 9, atk: 6, mag: 0, def: 1, spd: 9, exp: 7, color: "#8fe0a0", icon: "🧚", element: "光", tamable: false, tameChance: 0, desc: "木の葉に姿を隠す小さな妖精。悪戯好きだが力は弱い。" },
  { key: "horned_rabbit", name: "ツノウサギ", hp: 26, atk: 8, mag: 0, def: 3, spd: 9, exp: 10, color: "#eee1c6", icon: "🐇", element: "無", tamable: false, tameChance: 0, desc: "額に鋭い角を持つ大型のウサギ。跳躍からの角突きは侮れない。" },

  // ---- ささやきの森 (Lv4) ----
  { key: "goblin", name: "ゴブリン", hp: 24, atk: 9, mag: 0, def: 4, spd: 6, exp: 9, color: "#8fae4d", icon: "👺", element: "無", tamable: true, tameChance: 0.22, desc: "群れで行動する小柄な魔物。武器を手に徒党を組んで襲う。" },
  { key: "bat", name: "コウモリ", hp: 12, atk: 7, mag: 0, def: 1, spd: 10, exp: 7, color: "#8a6dd1", icon: "🦇", element: "風", tamable: true, tameChance: 0.28, desc: "洞窟や森に生息する小型の魔物。素早く飛び回り不意を突く。" },
  { key: "forest_spider", name: "フォレストスパイダー", hp: 20, atk: 9, mag: 0, def: 2, spd: 9, exp: 9, color: "#6a4a86", icon: "🕷️", element: "毒", tamable: false, tameChance: 0, desc: "糸を吐いて獲物の動きを封じる森の蜘蛛。噛まれると痺れる。" },
  { key: "mandrake", name: "マンドレイク", hp: 28, atk: 7, mag: 0, def: 6, spd: 3, exp: 9, color: "#7a8f4d", icon: "🥕", element: "土", tamable: false, tameChance: 0, desc: "根に顔を持つ魔法の植物。引き抜かれると甲高い声で鳴く。" },
  { key: "kobold", name: "コボルト", hp: 21, atk: 10, mag: 0, def: 3, spd: 7, exp: 9, color: "#9a8f6d", icon: "🪓", element: "無", tamable: false, tameChance: 0, desc: "群れで行動する小柄な魔物。粗末な武器でも数を頼みに襲いかかる。" },
  { key: "hornet", name: "ホーネット", hp: 16, atk: 10, mag: 0, def: 2, spd: 11, exp: 9, color: "#d19b2f", icon: "🐝", element: "風", tamable: false, tameChance: 0, desc: "巨大な蜂。小さな体に似合わず毒針の一撃は重い。" },
  { key: "elder_treant", name: "エルダートレント", hp: 42, atk: 11, mag: 0, def: 8, spd: 3, exp: 15, color: "#4d6a3d", icon: "🌳", element: "土", tamable: false, tameChance: 0, desc: "森の奥に根を張る古木の化身。動きは鈍いが一撃は重い。" },

  // ---- こだまの洞窟 (Lv7) ----
  { key: "wolf", name: "ウルフ", hp: 22, atk: 10, mag: 0, def: 3, spd: 8, exp: 10, color: "#c9c9c9", icon: "🐺", element: "無", tamable: true, tameChance: 0.2, desc: "群れで狩りをする獣。俊敏な動きで獲物を追い詰める。" },
  { key: "cave_bat", name: "ケイブバット", hp: 18, atk: 10, mag: 0, def: 2, spd: 13, exp: 11, color: "#5a3f7a", icon: "🦇", element: "闇", tamable: false, tameChance: 0, desc: "洞窟の暗闇を飛び回るコウモリの上位種。超音波で仲間を呼ぶ。" },
  { key: "stone_lizard", name: "ストーンリザード", hp: 30, atk: 10, mag: 0, def: 7, spd: 5, exp: 12, color: "#8a8a82", icon: "🦎", element: "土", tamable: false, tameChance: 0, desc: "岩肌に擬態するトカゲ。硬い鱗が刃を弾き返す。" },
  { key: "shadow_wolf", name: "シャドウウルフ", hp: 26, atk: 13, mag: 0, def: 3, spd: 10, exp: 13, color: "#3a3a4a", icon: "🐺", element: "闇", tamable: false, tameChance: 0, desc: "闇に溶け込む狼。群れのウルフより獰猛で気配を絶って迫る。" },
  { key: "mud_crab", name: "マッドクラブ", hp: 32, atk: 9, mag: 0, def: 8, spd: 3, exp: 11, color: "#8a5a4a", icon: "🦀", element: "水", tamable: false, tameChance: 0, desc: "地底の水脈に潜むカニ。硬い甲殻で攻撃を防ぐ。" },
  { key: "rock_golem", name: "ロックゴーレム", hp: 58, atk: 13, mag: 0, def: 11, spd: 2, exp: 20, color: "#6f6f78", icon: "🗿", element: "土", tamable: false, tameChance: 0, desc: "洞窟の岩が魔力で動き出した巨躯。鈍重だが一撃は岩をも砕く。" },

  // ---- 忘れられた遺跡 (Lv11) ----
  { key: "ogre", name: "オーガ", hp: 48, atk: 14, mag: 0, def: 6, spd: 4, exp: 20, color: "#d1704d", icon: "👹", element: "無", tamable: false, tameChance: 0, desc: "怪力を誇る大型の魔物。一撃の重さは並の魔物の比ではない。" },
  { key: "skeleton", name: "スケルトン", hp: 30, atk: 13, mag: 0, def: 4, spd: 6, exp: 16, color: "#d8d0c0", icon: "💀", element: "闇", tamable: false, tameChance: 0, desc: "遺跡を彷徨う人骨の魔物。痛みを感じず向かってくる。" },
  { key: "living_armor", name: "リビングアーマー", hp: 40, atk: 14, mag: 0, def: 9, spd: 4, exp: 17, color: "#7a7a85", icon: "🛡️", element: "闇", tamable: false, tameChance: 0, desc: "主を失った鎧に宿った怨念。中身のない体で剣を振るう。" },
  { key: "wight", name: "ワイト", hp: 34, atk: 15, mag: 0, def: 5, spd: 7, exp: 18, color: "#6a7a5a", icon: "👻", element: "闇", tamable: false, tameChance: 0, desc: "生者の活力を吸う死霊。触れられるとじわりと力が抜けていく。" },
  { key: "necro_hound", name: "ネクロハウンド", hp: 28, atk: 16, mag: 0, def: 4, spd: 11, exp: 17, color: "#5a2a2a", icon: "🐕", element: "闇", tamable: false, tameChance: 0, desc: "骨だけの犬型魔物。群れで駆け回り獲物を追い詰める。" },
  { key: "stone_gargoyle", name: "ストーンガーゴイル", hp: 62, atk: 17, mag: 0, def: 12, spd: 5, exp: 26, color: "#55555f", icon: "😈", element: "土", tamable: false, tameChance: 0, desc: "遺跡の屋根から舞い降りる石像の魔物。硬い体のまま急襲する。" },

  // ---- 竜骨の山頂 (Lv15) ----
  { key: "frost_wolf", name: "フロストウルフ", hp: 34, atk: 15, mag: 0, def: 5, spd: 12, exp: 22, color: "#a8d8ea", icon: "🐺", element: "氷", tamable: false, tameChance: 0, desc: "雪山に生きる狼の亜種。吐息は凍てつき肌を刺す。" },
  { key: "ice_golem", name: "アイスゴーレム", hp: 60, atk: 14, mag: 0, def: 12, spd: 3, exp: 24, color: "#bfe6ea", icon: "🧊", element: "氷", tamable: false, tameChance: 0, desc: "氷雪が凝結して生まれたゴーレム。触れた者の体温を奪う。" },
  { key: "mountain_troll", name: "マウンテントロール", hp: 70, atk: 19, mag: 0, def: 8, spd: 4, exp: 28, color: "#6a7a4a", icon: "🧌", element: "無", tamable: false, tameChance: 0, desc: "山肌に住む巨躯の魔物。傷を負ってもすぐに再生してしまう。" },
  { key: "bone_drake", name: "ボーンドレイク", hp: 45, atk: 20, mag: 0, def: 7, spd: 9, exp: 27, color: "#cfc6b0", icon: "🐉", element: "闇", tamable: false, tameChance: 0, desc: "竜の骨が魔力で動き出した小竜。牙も爪も古びてなお鋭い。" },
  { key: "ancient_wyvern", name: "エンシェントワイバーン", hp: 95, atk: 24, mag: 0, def: 14, spd: 8, exp: 40, color: "#8a2a3a", icon: "🐲", element: "火", tamable: false, tameChance: 0, desc: "竜骨の山頂に棲まう古き翼竜。伝説の中でしか語られぬ最強格の魔物。" },

  // ---- サブル地方 (Lv17〜30) ----
  { key: "sand_worm", name: "サンドワーム", hp: 62, atk: 17, mag: 0, def: 8, spd: 4, exp: 28, color: "#c9a26b", icon: "🪱", element: "土", tamable: false, tameChance: 0, desc: "砂の中を泳ぐ巨大な環形の魔物。足元の砂が盛り上がったら要注意。" },
  { key: "desert_scorpion", name: "デザートスコーピオン", hp: 44, atk: 20, mag: 0, def: 10, spd: 8, exp: 28, color: "#b5652f", icon: "🦂", element: "毒", tamable: false, tameChance: 0, desc: "砂漠に棲む大サソリ。尾の毒針は鎧の継ぎ目を正確に狙ってくる。" },
  { key: "dust_devil", name: "ダストデビル", hp: 36, atk: 18, mag: 0, def: 5, spd: 14, exp: 27, color: "#d8c9a0", icon: "🌪️", element: "風", tamable: false, tameChance: 0, desc: "砂を巻き上げて渦巻く風の魔物。実体がつかみにくい。" },
  { key: "cactus_man", name: "サボテンマン", hp: 54, atk: 16, mag: 0, def: 12, spd: 6, exp: 27, color: "#6aa84f", icon: "🌵", element: "土", tamable: false, tameChance: 0, desc: "歩くサボテン。うかつに殴ると全身のトゲが刺さる。" },
  { key: "death_vulture", name: "デスバルチャー", hp: 40, atk: 19, mag: 0, def: 6, spd: 13, exp: 28, color: "#6b5444", icon: "🦅", element: "風", tamable: false, tameChance: 0, desc: "弱った旅人の上空を旋回するハゲワシ。獲物が倒れるのを待っている。" },
  { key: "sand_bandit", name: "サンドバンディット", hp: 50, atk: 21, mag: 0, def: 8, spd: 11, exp: 30, color: "#a0522d", icon: "🗡️", element: "無", tamable: false, tameChance: 0, desc: "砂漠を荒らす盗賊団の一味。魔物と手を組んで隊商を襲う。" },
  { key: "sand_golem", name: "サンドゴーレム", hp: 78, atk: 18, mag: 0, def: 15, spd: 3, exp: 31, color: "#cdb88a", icon: "🏜️", element: "土", tamable: false, tameChance: 0, desc: "砂が魔力で固まった巨人。崩しても崩しても形を取り戻す。" },
  { key: "jackal_warrior", name: "ジャッカルウォリアー", hp: 56, atk: 22, mag: 0, def: 10, spd: 11, exp: 31, color: "#8a6a3a", icon: "🐕", element: "闇", tamable: false, tameChance: 0, desc: "獣頭の戦士。墓守の一族と言われ、剣の腕は確か。" },
  { key: "mirage_spirit", name: "ミラージュ", hp: 42, atk: 20, mag: 0, def: 7, spd: 15, exp: 30, color: "#e6d6ff", icon: "🫥", element: "光", tamable: false, tameChance: 0, desc: "蜃気楼が意思を持った精霊。見えている姿は本体ではない。" },
  { key: "fire_salamander", name: "サラマンダー", hp: 58, atk: 23, mag: 0, def: 9, spd: 9, exp: 32, color: "#e0582f", icon: "🦎", element: "火", tamable: false, tameChance: 0, desc: "炎をまとう大トカゲ。熱砂の下で眠り、日中に這い出してくる。" },
  { key: "mummy", name: "マミー", hp: 70, atk: 21, mag: 0, def: 11, spd: 5, exp: 33, color: "#d9cfb2", icon: "🧟", element: "闇", tamable: false, tameChance: 0, desc: "包帯に巻かれた古代の死者。墓を荒らす者を地の底まで追う。" },
  { key: "scarab", name: "スカラベ", hp: 48, atk: 22, mag: 0, def: 14, spd: 10, exp: 32, color: "#2f6b5a", icon: "🪲", element: "土", tamable: false, tameChance: 0, desc: "王墓に巣くう甲虫。群れで現れて屍肉も鎧も食い破る。" },
  { key: "king_worm", name: "キングワーム", hp: 120, atk: 25, mag: 0, def: 13, spd: 5, exp: 52, color: "#a77b42", icon: "🐛", element: "土", tamable: false, tameChance: 0, desc: "砂丘の主。砂ごと獲物を丸呑みにする巨大なワーム。" },
  { key: "emperor_scorpion", name: "エンペラースコーピオン", hp: 118, atk: 28, mag: 0, def: 17, spd: 8, exp: 56, color: "#7a2f1f", icon: "🦂", element: "毒", tamable: false, tameChance: 0, desc: "谷の奥に君臨するサソリの帝王。甲殻は鋼より硬い。" },
  { key: "cursed_naga", name: "カースドナーガ", hp: 126, atk: 29, mag: 0, def: 14, spd: 10, exp: 60, color: "#3f8a7a", icon: "🐍", element: "水", tamable: false, tameChance: 0, desc: "泉を枯らした呪いの化身。半身が蛇の水妖。" },
  { key: "mummy_king", name: "マミーキング", hp: 140, atk: 30, mag: 0, def: 16, spd: 6, exp: 64, color: "#c9b37a", icon: "👑", element: "闇", tamable: false, tameChance: 0, desc: "王墓に眠っていた古王。死してなお玉座を明け渡さない。" },
  { key: "sphinx", name: "スフィンクス", hp: 150, atk: 32, mag: 0, def: 18, spd: 10, exp: 70, color: "#d4a84a", icon: "🦁", element: "光", tamable: false, tameChance: 0, desc: "大神殿を守る獅子の番人。問いに答えられぬ者を引き裂く。" },

  // ---- レア敵（rare: true。各ダンジョンの DUNGEONS[].rares に出る。まれに通常の敵と入れ替わって現れ、倒すと良い装備を落とす） ----
  { key: "gold_slime", name: "ゴールドスライム", hp: 20, atk: 6, mag: 0, def: 7, spd: 12, exp: 8, color: "#f2c94c", icon: "🟡", element: "光", rare: true, tamable: false, tameChance: 0, desc: "黄金色に輝くスライム。めったに姿を見せず、見つかるとすぐ逃げようとする。" },
  { key: "lucky_hare", name: "フォーチュンラビット", hp: 24, atk: 8, mag: 0, def: 3, spd: 14, exp: 10, color: "#9be38f", icon: "🍀", element: "光", rare: true, tamable: false, tameChance: 0, desc: "四つ葉を額に宿したウサギ。出会えた冒険者には幸運が訪れるという。" },
  { key: "gem_beetle", name: "ジェムビートル", hp: 30, atk: 9, mag: 0, def: 10, spd: 8, exp: 12, color: "#5ad1c9", icon: "💎", element: "土", rare: true, tamable: false, tameChance: 0, desc: "背中に宝石を背負った甲虫。殻は硬く、宝石目当ての冒険者を返り討ちにする。" },
  { key: "white_stag", name: "ホワイトスタッグ", hp: 34, atk: 11, mag: 0, def: 5, spd: 12, exp: 13, color: "#f4f1e8", icon: "🦌", element: "光", rare: true, tamable: false, tameChance: 0, desc: "森の奥で一瞬だけ姿を見せる白い鹿。森の守り神とも言われる。" },
  { key: "crystal_lizard", name: "クリスタルリザード", hp: 34, atk: 11, mag: 0, def: 12, spd: 10, exp: 15, color: "#8fd3ff", icon: "🔷", element: "氷", rare: true, tamable: false, tameChance: 0, desc: "水晶の鱗を持つトカゲ。洞窟の奥で鉱石を食べて育つ。" },
  { key: "gold_crab", name: "ゴールドクラブ", hp: 40, atk: 11, mag: 0, def: 11, spd: 5, exp: 15, color: "#e0b040", icon: "🦀", element: "水", rare: true, tamable: false, tameChance: 0, desc: "金色の甲殻を持つカニ。地底湖の宝物を集める習性がある。" },
  { key: "golden_guardian", name: "ゴールデンガーディアン", hp: 56, atk: 16, mag: 0, def: 13, spd: 5, exp: 22, color: "#d4af37", icon: "🗽", element: "光", rare: true, tamable: false, tameChance: 0, desc: "遺跡の宝物庫を守っていた黄金の像。今も侵入者を許さない。" },
  { key: "phantom_lord", name: "ファントムロード", hp: 44, atk: 18, mag: 0, def: 6, spd: 10, exp: 22, color: "#7a4a9a", icon: "🎭", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "遺跡を治めていた王の亡霊。仮面の奥から生者を見下ろしている。" },
  { key: "frost_phoenix", name: "フロストフェニックス", hp: 52, atk: 20, mag: 0, def: 7, spd: 14, exp: 30, color: "#bfe9ff", icon: "🦅", element: "氷", rare: true, tamable: false, tameChance: 0, desc: "吹雪とともに現れる氷の霊鳥。その羽は溶けることがないという。" },
  { key: "dragon_hatchling", name: "ドラゴンの幼体", hp: 64, atk: 19, mag: 0, def: 10, spd: 9, exp: 30, color: "#d8604a", icon: "🐣", element: "火", rare: true, tamable: false, tameChance: 0, desc: "山頂の巣からはぐれた竜の子。幼くとも竜の力は侮れない。" },
  { key: "golden_worm", name: "ゴールデンワーム", hp: 70, atk: 18, mag: 0, def: 12, spd: 8, exp: 32, color: "#f2c94c", icon: "✨", element: "光", rare: true, tamable: false, tameChance: 0, desc: "砂金を食べて育ったワーム。体の中に金の粒をため込んでいる。" },
  { key: "gold_tortoise", name: "ゴールドトータス", hp: 80, atk: 15, mag: 0, def: 20, spd: 4, exp: 32, color: "#d4af37", icon: "🐢", element: "土", rare: true, tamable: false, tameChance: 0, desc: "黄金の甲羅を背負った陸ガメ。めったに砂から顔を出さない。" },
  { key: "ruby_scorpion", name: "ルビースコーピオン", hp: 56, atk: 24, mag: 0, def: 15, spd: 12, exp: 34, color: "#d1304a", icon: "♦️", element: "火", rare: true, tamable: false, tameChance: 0, desc: "紅玉の殻を持つサソリ。盗賊たちが血眼になって探している。" },
  { key: "roc_chick", name: "ロック鳥のヒナ", hp: 66, atk: 22, mag: 0, def: 9, spd: 14, exp: 34, color: "#f0e0b0", icon: "🐤", element: "風", rare: true, tamable: false, tameChance: 0, desc: "巨鳥ロックのヒナ。ヒナでも人の背丈ほどあり、くちばしは鋭い。" },
  { key: "oasis_spirit", name: "オアシスの精霊", hp: 60, atk: 23, mag: 0, def: 10, spd: 15, exp: 36, color: "#7fd3f0", icon: "💧", element: "水", rare: true, tamable: false, tameChance: 0, desc: "枯れた泉に残ったわずかな水の精。泉がよみがえる日を待っている。" },
  { key: "mirage_camel", name: "ミラージュキャメル", hp: 74, atk: 21, mag: 0, def: 12, spd: 12, exp: 36, color: "#e8d3a8", icon: "🐫", element: "光", rare: true, tamable: false, tameChance: 0, desc: "蜃気楼の中だけを歩くラクダ。背の荷には失われた宝が積まれているという。" },
  { key: "jackal_guardian", name: "ジャッカルの守護者", hp: 76, atk: 27, mag: 0, def: 14, spd: 12, exp: 38, color: "#2b2b3a", icon: "🐺", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "古王の魂を導く黒き獣。墓の最も深い場所にだけ現れる。" },
  { key: "golden_scarab", name: "黄金のスカラベ", hp: 62, atk: 24, mag: 0, def: 20, spd: 13, exp: 38, color: "#e0b040", icon: "🪲", element: "光", rare: true, tamable: false, tameChance: 0, desc: "太陽の化身とあがめられた黄金の甲虫。触れた者に富をもたらすという。" },
  { key: "flame_phoenix", name: "フレイムフェニックス", hp: 72, atk: 30, mag: 0, def: 12, spd: 16, exp: 42, color: "#ff7a2f", icon: "🐦‍🔥", element: "火", rare: true, tamable: false, tameChance: 0, desc: "大神殿の聖火から生まれた火の鳥。倒れても灰から舞い戻る。" },
  { key: "temple_guardian", name: "テンプルガーディアン", hp: 96, atk: 28, mag: 0, def: 20, spd: 7, exp: 42, color: "#b8a070", icon: "🗿", element: "土", rare: true, tamable: false, tameChance: 0, desc: "神殿の最奥を守る石の巨兵。千年動かずに侵入者を待ち続けている。" },
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
  const race = RNG.pick(PLAYER_RACE_IDS);
  const jobIds = BASIC_JOB_IDS;
  const job = RNG.pick(jobIds);
  const name = RNG.pick(RECRUIT_NAME_POOL);
  return { name, job, race };
}

// ---------- ダンジョン ----------
// x/y はマップ上の配置(％)。unlocks はクリア時に解放されるダンジョンID。
// 地方: ダンジョンを地方ごとにまとめ、マップは地方ごとに切り替えて表示する。地方の最後のダンジョンを踏破すると
// 次の地方の最初のダンジョンが解放される（DUNGEONS[].unlocks でつなぐ）。x・y は地方のマップ上の位置（%）
const REGIONS = [
  { id: "verde", name: "ヴェルデ地方", desc: "冒険者ギルドのある緑豊かな地方。駆け出しの冒険者が腕を磨く。" },
  { id: "sabul", name: "サブル地方", desc: "照りつける太陽と砂の海が広がる地方。古い王国の遺跡が砂の下に眠っている。" },
];

const DUNGEONS = [
  {
    id: "plains", region: "verde", name: "はじまりの草原", x: 20, y: 78, level: 1, battles: 3,
    pool: ["slime", "bat", "killer_moth", "field_rat", "mud_plant", "leaf_pixie"], boss: "horned_rabbit", rares: ["gold_slime", "lucky_hare"], unlocks: ["forest"],
    desc: "見晴らしのよい草原。弱い魔物しかいない。",
    benchmarkGear: { rarity: "n", plus: 0 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
  },
  {
    id: "forest", region: "verde", name: "ささやきの森", x: 44, y: 60, level: 4, battles: 3,
    pool: ["slime", "goblin", "bat", "forest_spider", "mandrake", "kobold", "hornet"], boss: "elder_treant", rares: ["gem_beetle", "white_stag"], unlocks: ["cave"],
    desc: "木々のざわめきに紛れて魔物が潜む。",
    power: 1.6, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "n", plus: 1 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
  },
  {
    id: "cave", region: "verde", name: "こだまの洞窟", x: 26, y: 40, level: 7, battles: 4,
    pool: ["goblin", "bat", "wolf", "cave_bat", "stone_lizard", "shadow_wolf", "mud_crab"], boss: "rock_golem", rares: ["crystal_lizard", "gold_crab"], unlocks: ["ruins"],
    desc: "暗く入り組んだ洞窟。素早い魔物が多い。",
    power: 1.39, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "r", plus: 2 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
  },
  {
    id: "ruins", region: "verde", name: "忘れられた遺跡", x: 60, y: 28, level: 11, battles: 4,
    pool: ["goblin", "wolf", "ogre", "skeleton", "living_armor", "wight", "necro_hound"], boss: "stone_gargoyle", rares: ["golden_guardian", "phantom_lord"], unlocks: ["peak"],
    desc: "崩れた石柱が並ぶ遺跡。強力な魔物が棲みついている。",
    power: 1.05, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 3 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
  },
  {
    id: "peak", region: "verde", name: "竜骨の山頂", x: 78, y: 12, level: 15, battles: 5,
    pool: ["wolf", "ogre", "frost_wolf", "ice_golem", "mountain_troll", "bone_drake"], boss: "ancient_wyvern", rares: ["frost_phoenix", "dragon_hatchling"], unlocks: ["dunes"],
    desc: "巨大な骨が眠る山頂。ヴェルデ地方で最も危険な領域。",
    power: 0.74, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
  },
  // ---- サブル地方（推奨Lv17〜30） ----
  {
    id: "dunes", region: "sabul", name: "蜃気楼の砂丘", x: 18, y: 80, level: 17, battles: 5,
    pool: ["sand_worm", "desert_scorpion", "dust_devil", "cactus_man", "death_vulture", "ogre"], boss: "king_worm", rares: ["golden_worm", "gold_tortoise"], unlocks: ["canyon"],
    desc: "陽炎に揺れる果てしない砂丘。砂の下を何かが泳いでいる。",
    power: 0.73, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
  },
  {
    id: "canyon", region: "sabul", name: "サソリの谷", x: 42, y: 62, level: 20, battles: 5,
    pool: ["desert_scorpion", "death_vulture", "sand_bandit", "sand_golem", "jackal_warrior", "cactus_man"], boss: "emperor_scorpion", rares: ["ruby_scorpion", "roc_chick"], unlocks: ["oasis"],
    desc: "赤い岩壁に挟まれた谷。岩陰という岩陰にサソリが潜む。",
    power: 0.56, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
  },
  {
    id: "oasis", region: "sabul", name: "枯れたオアシス", x: 72, y: 66, level: 23, battles: 5,
    pool: ["sand_bandit", "mirage_spirit", "fire_salamander", "dust_devil", "sand_golem", "jackal_warrior"], boss: "cursed_naga", rares: ["oasis_spirit", "mirage_camel"], unlocks: ["tomb"],
    desc: "かつて旅人を潤した泉の跡。干上がった水底に呪いが澱んでいる。",
    power: 0.46, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
  },
  {
    id: "tomb", region: "sabul", name: "砂に沈んだ王墓", x: 56, y: 36, level: 26, battles: 5,
    pool: ["mummy", "scarab", "jackal_warrior", "mirage_spirit", "sand_golem", "sand_bandit"], boss: "mummy_king", rares: ["jackal_guardian", "golden_scarab"], unlocks: ["sun_temple"],
    desc: "砂に呑まれた古王の墓。眠りを妨げる者には容赦がない。",
    power: 0.52, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
  },
  {
    id: "sun_temple", region: "sabul", name: "灼熱の大神殿", x: 30, y: 14, level: 30, battles: 5,
    pool: ["mummy", "scarab", "fire_salamander", "sand_golem", "jackal_warrior", "mirage_spirit"], boss: "sphinx", rares: ["flame_phoenix", "temple_guardian"], unlocks: [],
    desc: "太陽を祀る巨大な神殿。謎を解けぬ者は先へ進めない。",
    power: 0.47, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 5 },
  },
];

function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id);
}

const BOSS_MULT = 1.7;
// レア敵（ダンジョンごとの DUNGEONS[].rares）: ボス戦以外の1戦闘ごとにこの確率で、敵1体がレア敵に入れ替わる
// （1周4戦ならおよそ1割強の周回で出会う）。能力値は少し強く、EXPは多い。倒すとレア度の高い装備を必ず1個落とす
const RARE_ENCOUNTER_CHANCE = 0.04;
const RARE_STAT_MULT = 1.3;
const RARE_EXP_MULT = 5;
// 敵のHP・ATK・DEF・EXPがダンジョンの推奨Lvに応じて伸びる割合（1Lvごと）。
// 味方の能力値の伸び（js/core/stats.js の baseStats: 1Lvごとに+12%）と揃えておくことで、
// 推奨Lvで挑んだ時の手応えが奥のダンジョンでも変わらないようにする
// （以前は+16%で、奥のダンジョンほど敵との差が開き続けていた。Lv30では味方4.48倍に対して敵5.64倍）
const ENEMY_LEVEL_GROWTH = 0.12;
const ENEMY_BATTLE_GROWTH = 0.06; // 同じダンジョン内で1戦進むごとの伸び

function enemyStatMult(dungeon, battleIndex) {
  return (1 + (dungeon.level - 1) * ENEMY_LEVEL_GROWTH) * (1 + battleIndex * ENEMY_BATTLE_GROWTH);
}

function buildEncounter(dungeon, battleIndex) {
  const isBossBattle = battleIndex === dungeon.battles - 1;
  // ダンジョン内で進むほど少しずつ強くなる
  const mult = enemyStatMult(dungeon, battleIndex);
  const count = Math.min(5, 3 + Math.floor(dungeon.level / 5));
  const list = [];

  for (let i = 0; i < count; i++) {
    const key = RNG.pick(dungeon.pool);
    list.push(makeEnemy(getEnemyTemplate(key), mult, false, dungeon.power));
  }
  if (isBossBattle) {
    list.unshift(makeEnemy(getEnemyTemplate(dungeon.boss), mult * BOSS_MULT, true, dungeon.power));
  } else if (dungeon.rares && dungeon.rares.length && RNG.chance(RARE_ENCOUNTER_CHANCE)) {
    const i = Math.floor(RNG.float(0, list.length));
    list[i] = makeEnemy(getEnemyTemplate(RNG.pick(dungeon.rares)), mult, false, dungeon.power, true);
  }
  return list;
}

// power: ダンジョンごとの敵の強さの倍率（DUNGEONS[].power、省略時1）。HP・ATK・DEFだけに掛け、EXPには掛けない
// （難易度の調整でレベル上げのペースが変わらないようにするため）
function makeEnemy(t, mult, isBoss, power, isRare) {
  const p = mult * (power || 1) * (isRare ? RARE_STAT_MULT : 1);
  return {
    key: t.key,
    name: isBoss ? `${t.name}の主` : isRare ? `★${t.name}` : t.name,
    color: t.color,
    isBoss: !!isBoss,
    isRare: !!isRare,
    hp: Math.round(t.hp * p), maxHp: Math.round(t.hp * p),
    atk: Math.round(t.atk * p), mag: t.mag, def: Math.round(t.def * p),
    spd: t.spd, exp: Math.round(t.exp * mult * (isRare ? RARE_EXP_MULT : 1)),
    atb: RNG.float(0, 30),
  };
}

// N/R/SR/UR/LRの5段階。上位ほど急激に出にくくなる（1戦闘平均1.4個・1ダンジョン平均約5個のドロップ換算で、
// LRはおおよそ100周に1個出るか出ないかのペース、URは10周やって出たら運がいいと感じるくらい
// （10周で遭遇率およそ15〜25%、30周でも半分弱程度）になるよう重みを設定している）
// material: 自動分解した時に得られる強化石の量
const RARITIES = [
  { key: "n", name: "ノーマル", color: "#cfd8dc", mult: 1, weight: 7100, material: 5 },
  { key: "r", name: "レア", color: "#4dc3ff", mult: 1.4, weight: 2200, material: 20 },
  { key: "sr", name: "スーパーレア", color: "#7c5cff", mult: 2.0, weight: 650, material: 80 },
  { key: "ur", name: "ウルトラレア", color: "#ff9f4d", mult: 2.8, weight: 35, material: 350 },
  { key: "lr", name: "レジェンドレア", color: "#ff4d8f", mult: 4.0, weight: 15, material: 1500 },
];

// 自動分解フィルターの初期値（未設定時はN/Rのみ）。実際に使う対象はプレイヤーが画面上で変更でき、端末に保存される
const DEFAULT_AUTO_DISASSEMBLE_RARITIES = ["n", "r"];

function rollRarity() { return QPCore.rewards.rollRarity(RARITIES, RNG); }

// 報酬まわりの数値（通常プレイとオフライン精算で共通。計算はjs/core/rewards.js）
const REWARD_RULES = {
  extraDropChance: 0.4, // 1戦闘のドロップは基本1個＋この確率で追加1個
  eventChance: 0.6, // 戦闘と戦闘の間に道中イベントが起きる確率
  events: [ // 道中イベントの種類と重み
    { kind: "treasure", weight: 40 },
    { kind: "trap", weight: 25 },
    { kind: "spring", weight: 20 },
    { kind: "shrine", weight: 15 },
  ],
  treasureEmptyChance: 0.35, // 宝箱が空っぽの確率
};

// ---------- 装備強化（+0〜+99） ----------
// レア度が高いほど基礎成功率が低く、かつ+が上がるごとに減衰も速いので、
// 上位レア度ほど「なかなか+が上がらない」体感になる（周回して素材を貯める意味を持たせるため）。
// costPerPlus: +1ごとに1回あたりの消費強化石が増える量 / rateFloor: 成功率の下限（未指定ならENHANCE_RATE_FLOOR）
// LRは+99に近づくほど成功率が0.5%まで沈み、1回の消費も増えるため、+98→+99の期待消費は約10万個になる
// （確定強化石＝成功率100%の有償アイテムの価値が最も高くなる帯）
const ENHANCE_MAX_PLUS = 99;
const ENHANCE_CONFIG = {
  n: { baseRate: 0.90, decay: 0.995, cost: 3 },
  r: { baseRate: 0.75, decay: 0.990, cost: 8 },
  sr: { baseRate: 0.55, decay: 0.985, cost: 20 },
  ur: { baseRate: 0.35, decay: 0.978, cost: 60 },
  lr: { baseRate: 0.15, decay: 0.965, cost: 150, costPerPlus: 350 / 98, rateFloor: 0.005 },
};
const ENHANCE_RATE_FLOOR = 0.03; // 何度失敗しても最低3%は残す（完全に詰まないように）
// 天井: 今の+値で失敗に使った強化石(item.pity)が期待消費のこの倍率に達したら、次の強化は必ず成功する
// （運が極端に悪い場合でも上限が見えるようにするため。成功・+値の変化でゲージは0に戻る）
const ENHANCE_PITY_MULT = 1.5;
// 確定強化石: 1個を強化石この個数ぶんとみなし、その段の期待消費に応じて必要個数が増える
// （N〜URの全段とLR+30付近までは1個、LR+98→+99は10個、LR+0→+99の合計は約300個）
const GUARANTEED_STONE_VALUE = 10000;
const ENHANCE_RULES = {
  config: ENHANCE_CONFIG,
  rateFloor: ENHANCE_RATE_FLOOR,
  pityMult: ENHANCE_PITY_MULT,
  guaranteedStoneValue: GUARANTEED_STONE_VALUE,
};

// 計算はjs/core/enhance.js。ここは装備オブジェクトを受け取る薄い窓口
function enhanceSuccessRate(item) { return QPCore.enhance.successRate(ENHANCE_RULES, item.rarity, item.plus); }
function enhanceCost(item) { return QPCore.enhance.cost(ENHANCE_RULES, item.rarity, item.plus); }
function enhanceExpectedCost(item) { return QPCore.enhance.expectedCost(ENHANCE_RULES, item.rarity, item.plus); }
function enhancePityThreshold(item) { return QPCore.enhance.pityThreshold(ENHANCE_RULES, item.rarity, item.plus); }
function guaranteedStonesRequired(item) { return QPCore.enhance.guaranteedRequired(ENHANCE_RULES, item.rarity, item.plus); }

// 強化値に応じてステータス上昇量を底上げする。装備の元の数値が小さい（2〜6）ため率ではなくレア度に応じた
// 固定量をceilで積み上げる（+1でも必ず変化が見え、かつレア度が高いほど伸びが大きい＝+99で元の値の約4倍になる）
function itemEffectiveValue(item) {
  const rarity = RARITIES.find((r) => r.key === item.rarity);
  const mult = rarity ? rarity.mult : 1;
  const bonus = Math.ceil((item.plus || 0) * mult * 0.08);
  return Math.max(1, item.value + bonus);
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

// 装備のレベル: 拾ったダンジョンの推奨Lvを装備のレベルにし、能力値は1Lvごとに基礎値の+12%伸びる
// （キャラの能力値の伸び js/core/stats.js と同じ割合。奥のダンジョンほど装備も強くなり、装備を集め直す意味が続く）
const ITEM_LEVEL_GROWTH = 0.12;

let itemSeq = 1;
// level: 装備のレベル（拾ったダンジョンの推奨Lv）。minRarity: このレア度以上だけから抽選する（レア敵のドロップ）
function rollItemDrop(level, minRarity) {
  const from = minRarity ? RARITIES.findIndex((r) => r.key === minRarity) : 0;
  return QPCore.rewards.rollItem(ITEM_BASES, RARITIES.slice(Math.max(0, from)), RNG, () => "item_" + itemSeq++,
    { level: level || 1, levelGrowth: ITEM_LEVEL_GROWTH });
}
// レア敵が落とす装備の下限のレア度（SR以上。重みの比でSR約93%・UR約5%・LR約2%）
const RARE_DROP_MIN_RARITY = "sr";

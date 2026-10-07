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
  guaranteedStone: true, // 確定強化石（成功率100%の有償アイテム）。ショップで入手する（js/model/shop.js）
  shop: true, // ショップ（課金要素）。プロトタイプでは決済の代わりに無料で受け取れる
  enhancePity: true, // 強化の天井（失敗で使った強化石が期待消費の1.5倍に達したら次は必ず成功）
};
function isFeatureEnabled(key) { return !!FEATURE_FLAGS[key]; }

// ---------- ショップ（課金要素。docs/production-plan.md §5.7） ----------
// プロトタイプではApp Storeの決済が無いため、購入ボタンで無料で受け取れる（本番化では決済の結果を受けて付与する）。
// kind: unlock（買い切り。unlock のキーを解放）／guaranteedStone（確定強化石を amount 個）／rosterBox（仲間のBOXを ROSTER_CAPACITY.step 人ぶん拡張）。
// price は表示用の仮の価格（円）。requiresCleared: このダンジョンを（ノーマルで）踏破するまで買えない
// （自動周回x100は稼ぐ量が大きく増えるため、ゲームの後半に入ってから。docs/production-plan.md §5.7）
const SHOP_PRODUCTS = [
  { id: "auto_repeat_100", kind: "unlock", unlock: "autoRepeat100", name: "自動周回x100", price: 480, requiresCleared: "inferno_peak",
    desc: "自動周回の回数に「x100」を追加する（買い切り）" },
  { id: "battle_speed_3", kind: "unlock", unlock: "speed3", name: "戦闘速度x3", price: 370,
    desc: "戦闘の速さに「x3」を追加する（買い切り）" },
  { id: "battle_speed_5", kind: "unlock", unlock: "speed5", name: "戦闘速度x5", price: 610,
    desc: "戦闘の速さに「x5」を追加する（買い切り。x3を持っていなくても使える）" },
  { id: "guaranteed_stone_1", kind: "guaranteedStone", amount: 1, name: "確定強化石 1個", price: 160,
    desc: "装備の強化を成功率100%で行える。必要な個数は強化の段階で変わる（LR+98→+99は10個）" },
  { id: "guaranteed_stone_11", kind: "guaranteedStone", amount: 11, name: "確定強化石 10個＋1個", price: 1600,
    desc: "確定強化石10個に、おまけ1個付き" },
  { id: "roster_box_50", kind: "rosterBox", name: "仲間のBOX +50", price: 250,
    desc: "所持できる仲間の上限を50人増やす（何回でも、上限1000人まで）" },
];
// 仲間のBOX（所持できる仲間の数）。最初は base 人、拡張1回につき step 人、max 人まで。
// 上限を超えて持っている仲間は減らさず、新しく増やせなくなるだけ（仲間を呼ぶ・テイム）
const ROSTER_CAPACITY = { base: 50, step: 50, max: 1000 };
// 自動周回の回数と戦闘の速さ。unlock があるものはショップで買うと選べる
const AUTO_REPEAT_CHOICES = [
  { n: 1 }, { n: 3 }, { n: 5 }, { n: 10 }, { n: 20 }, { n: 50 }, { n: 100, unlock: "autoRepeat100" },
];
const BATTLE_SPEEDS = [{ mult: 1 }, { mult: 2 }, { mult: 3, unlock: "speed3" }, { mult: 5, unlock: "speed5" }];

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
// レベル上限（js/model/roster.js の levelCap）。テイムしたモンスターは推奨Lvの上限と同じLv100、人間のキャラはLv99
const MONSTER_MAX_LEVEL = 100;
const CHAR_MAX_LEVEL = 99;
const JOBS = {
  warrior: {
    id: "warrior", name: "せんし", commandName: "とくぎ", icon: "⚔️", tier: "basic",
    desc: "接近して斬りかかる正統派の近接アタッカー。技はどれも消費MPがなく、安定して打撃を重ねられる。",
    base: { hp: 34, mp: 4, atk: 11, mag: 2, def: 8, spd: 6 },
    abilities: [
      { id: "double_slash", name: "双閃", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.62, hits: 2, desc: "2回連続で攻撃する" },
      { id: "crit_strike", name: "剛断撃", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 2.1, hits: 1, desc: "会心率の高い強打" },
      { id: "flurry", name: "三連閃", reqLevel: 10, mpCost: 0, kind: "physical", target: "single", power: 0.55, hits: 3, desc: "3回連続で攻撃する" },
      { id: "cliff_slash", name: "断崖薙ぎ", reqLevel: 15, mpCost: 5, kind: "physical", target: "all-enemy", power: 1.3, hits: 1, desc: "敵全体を薙ぎ払う渾身の一撃" },
    ],
  },
  mage: {
    id: "mage", name: "まほうつかい", commandName: "まほう", icon: "🪄", tier: "basic",
    desc: "属性魔法で敵を攻撃する後衛職。MPを多く消費するが、敵全体を巻き込む魔法も得意とする。",
    base: { hp: 20, mp: 20, atk: 4, mag: 12, def: 3, spd: 7 },
    abilities: [
      { id: "fire", name: "炎紋弾", reqLevel: 1, mpCost: 4, kind: "magic", element: "fire", target: "single", power: 1.5, hits: 1, desc: "敵1体に炎属性の魔法攻撃" },
      { id: "mega_fire", name: "炎紋陣", reqLevel: 5, mpCost: 10, kind: "magic", element: "fire", target: "all-enemy", power: 1.2, hits: 1, desc: "敵全体に炎属性の魔法攻撃" },
      { id: "blizzard", name: "氷紋槍", reqLevel: 10, mpCost: 7, kind: "magic", element: "ice", target: "single", power: 2.0, hits: 1, desc: "敵1体に氷属性の強力な魔法攻撃" },
      { id: "great_blast", name: "爆紋陣", reqLevel: 15, mpCost: 16, kind: "magic", element: "fire", target: "all-enemy", power: 1.6, hits: 1, desc: "敵全体に極大の魔法攻撃" },
    ],
  },
  priest: {
    id: "priest", name: "そうりょ", commandName: "いのり", icon: "✨", tier: "basic",
    desc: "回復魔法を得意とする支援職。パーティのHPを立て直しながら長期戦を支える。",
    base: { hp: 24, mp: 18, atk: 5, mag: 9, def: 5, spd: 6 },
    abilities: [
      { id: "heal", name: "癒しの灯", reqLevel: 1, mpCost: 4, kind: "heal", target: "single-ally", power: 1.8, hits: 1, desc: "味方1体のHPを回復" },
      { id: "mega_heal", name: "癒しの輪", reqLevel: 5, mpCost: 12, kind: "heal", target: "all-ally", power: 1.3, hits: 1, desc: "味方全体のHPを回復" },
      { id: "pure_light", name: "浄化の光", reqLevel: 10, mpCost: 8, kind: "heal", target: "single-ally", power: 2.6, hits: 1, desc: "味方1体のHPを大きく回復" },
      { id: "blessing", name: "精霊の加護", reqLevel: 15, mpCost: 18, kind: "heal", target: "all-ally", power: 2.0, hits: 1, desc: "味方全体のHPを大きく回復" },
    ],
  },
  thief: {
    id: "thief", name: "とうぞく", commandName: "わざ", icon: "🗡️", tier: "basic",
    desc: "素早い身のこなしで多段攻撃を得意とする軽戦士。行動速度が高く、手数で押し切る。",
    base: { hp: 24, mp: 8, atk: 9, mag: 3, def: 5, spd: 10 },
    abilities: [
      { id: "slash", name: "影刃", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.15, hits: 1, desc: "素早く斬りつける" },
      { id: "wild_slash", name: "乱れ刃", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "3回続けて斬る" },
      { id: "pursuit", name: "追い影", reqLevel: 10, mpCost: 3, kind: "physical", target: "single", power: 0.45, hits: 4, desc: "4回連続で追撃する" },
      { id: "shadow_sew", name: "影走り", reqLevel: 15, mpCost: 6, kind: "physical", target: "all-enemy", power: 1.1, hits: 1, desc: "影から敵全体を斬り抜ける" },
    ],
  },
  monk: {
    id: "monk", name: "ぶとうか", commandName: "けんぽう", icon: "👊", tier: "basic",
    desc: "拳で戦いながら気の力で自らを癒す、攻撃と回復を両立できる近接職。",
    base: { hp: 32, mp: 6, atk: 10, mag: 4, def: 7, spd: 8 },
    abilities: [
      { id: "straight", name: "破岩拳", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "鍛えた拳で突く" },
      { id: "rush", name: "三連拳", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.45, hits: 3, desc: "拳を3回叩き込む" },
      { id: "chi_heal", name: "練気", reqLevel: 10, mpCost: 5, kind: "heal", target: "single-ally", power: 1.6, hits: 1, desc: "気を巡らせて味方1体を回復する" },
      { id: "wave", name: "闘気波", reqLevel: 15, mpCost: 8, kind: "magic", element: "holy", target: "all-enemy", power: 1.3, hits: 1, desc: "闘気の波動で敵全体を撃つ" },
    ],
  },
  darkknight: {
    id: "darkknight", name: "あんこくし", commandName: "あんこく", icon: "🌑", tier: "basic",
    desc: "闇の力で敵のHPを吸収する異端の戦士。攻撃を重ねながら自分のHPも回復できる。",
    base: { hp: 30, mp: 10, atk: 12, mag: 6, def: 7, spd: 6 },
    abilities: [
      { id: "dark_slash", name: "黒刃", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "闇をまとった斬撃" },
      { id: "drain", name: "吸命", reqLevel: 5, mpCost: 5, kind: "magic", element: "dark", target: "single", power: 1.3, hits: 1, lifesteal: 0.6, desc: "与えたダメージの6割を吸収する" },
      { id: "black_mist", name: "黒霧", reqLevel: 10, mpCost: 9, kind: "magic", element: "dark", target: "all-enemy", power: 1.1, hits: 1, desc: "黒い霧で敵全体を侵す" },
      { id: "soul_edge", name: "魂削ぎ", reqLevel: 15, mpCost: 6, kind: "physical", target: "single", power: 2.6, hits: 1, desc: "魂を削る渾身の一撃" },
    ],
  },
  // ---------- 上級職（対応する基本職をLv.50まで極めると転職できる） ----------
  swordmaster: {
    id: "swordmaster", name: "けんごう", commandName: "けんじゅつ", icon: "🌀", tier: "advanced",
    requires: { job: "warrior", level: JOB_MASTER_LEVEL },
    desc: "せんしの技を極めた剣の達人。一撃の重さと隙のない連撃を兼ね備える。",
    base: { hp: 42, mp: 4, atk: 15, mag: 2, def: 9, spd: 8 },
    abilities: [
      { id: "iai_slash", name: "抜刀閃", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.5, hits: 1, desc: "抜刀の一撃で敵を斬る" },
      { id: "tornado_slash", name: "旋刃嵐", reqLevel: 5, mpCost: 0, kind: "physical", target: "all-enemy", power: 0.95, hits: 1, desc: "刃の竜巻で敵全体を斬り払う" },
      { id: "hundred_slash", name: "瞬五連", reqLevel: 10, mpCost: 4, kind: "physical", target: "single", power: 0.42, hits: 5, desc: "目にも留まらぬ5連撃" },
      { id: "peerless_slash", name: "一閃・極", reqLevel: 15, mpCost: 8, kind: "physical", target: "single", power: 3.4, hits: 1, desc: "会心必中、奥義の一閃" },
    ],
  },
  archmage: {
    id: "archmage", name: "だいまどうし", commandName: "だいまほう", icon: "🔥", tier: "advanced",
    requires: { job: "mage", level: JOB_MASTER_LEVEL },
    desc: "まほうつかいの上位職。より強大な魔法を扱い、大魔法で戦況を一変させる。",
    base: { hp: 24, mp: 28, atk: 4, mag: 17, def: 4, spd: 8 },
    abilities: [
      { id: "thunder_bolt", name: "雷紋矢", reqLevel: 1, mpCost: 5, kind: "magic", element: "thunder", target: "single", power: 1.9, hits: 1, desc: "鋭い雷撃を放つ" },
      { id: "grand_thunder", name: "雷紋陣", reqLevel: 5, mpCost: 12, kind: "magic", element: "thunder", target: "all-enemy", power: 1.55, hits: 1, desc: "極大の雷撃で敵全体を撃つ" },
      { id: "absolute_zero", name: "凍紋獄", reqLevel: 10, mpCost: 10, kind: "magic", element: "ice", target: "single", power: 2.7, hits: 1, desc: "凍てつく極寒の一撃" },
      { id: "limit_magic", name: "極紋解放", reqLevel: 15, mpCost: 20, kind: "magic", target: "all-enemy", power: 2.0, hits: 1, desc: "魔力を限界まで解き放つ大魔法" },
    ],
  },
  archpriest: {
    id: "archpriest", name: "だいしんかん", commandName: "だいいのり", icon: "🕊️", tier: "advanced",
    requires: { job: "priest", level: JOB_MASTER_LEVEL },
    desc: "そうりょの上位職。回復量と範囲に優れ、パーティを崩れさせない支柱となる。",
    base: { hp: 28, mp: 26, atk: 5, mag: 13, def: 6, spd: 7 },
    abilities: [
      { id: "great_heal", name: "慈光", reqLevel: 1, mpCost: 7, kind: "heal", target: "single-ally", power: 2.2, hits: 1, desc: "味方1体を大きく回復する" },
      { id: "full_heal", name: "再生の光", reqLevel: 5, mpCost: 14, kind: "heal", target: "single-ally", power: 4.0, hits: 1, desc: "味方1体のHPを完全に回復する" },
      { id: "sanctuary_prayer", name: "聖域の調べ", reqLevel: 10, mpCost: 16, kind: "heal", target: "all-ally", power: 2.4, hits: 1, desc: "味方全体を大きく回復する祈り" },
      { id: "miracle_light", name: "天恵の光", reqLevel: 15, mpCost: 24, kind: "heal", target: "all-ally", power: 3.2, hits: 1, desc: "奇跡の光で全体を癒やす" },
    ],
  },
  ninja: {
    id: "ninja", name: "にんじゃ", commandName: "にんじゅつ", icon: "🥷", tier: "advanced",
    requires: { job: "thief", level: JOB_MASTER_LEVEL },
    desc: "とうぞくの上位職。卓越した速さと多彩な技でひたすら手数を重ねる。",
    base: { hp: 27, mp: 10, atk: 13, mag: 4, def: 6, spd: 14 },
    abilities: [
      { id: "shuriken", name: "飛苦無", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.3, hits: 1, desc: "手裏剣を投げつける" },
      { id: "silent_blade", name: "霞斬り", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.48, hits: 3, desc: "音もなく3連撃を放つ" },
      { id: "poison_needle", name: "急所穿ち", reqLevel: 10, mpCost: 3, kind: "physical", target: "single", power: 1.7, hits: 1, desc: "急所を狙い深く突き刺す" },
      { id: "ougi_no_jutsu", name: "朧月", reqLevel: 15, mpCost: 7, kind: "physical", target: "all-enemy", power: 1.35, hits: 1, desc: "会得した奥義で敵全体を斬る" },
    ],
  },
  saintfist: {
    id: "saintfist", name: "けんせい", commandName: "せいけん", icon: "🕉️", tier: "advanced",
    requires: { job: "monk", level: JOB_MASTER_LEVEL },
    desc: "ぶとうかの上位職。拳の威力と気の扱いが共に極まった、攻守一体の達人。",
    base: { hp: 40, mp: 9, atk: 15, mag: 6, def: 10, spd: 10 },
    abilities: [
      { id: "vacuum_thrust", name: "空破拳", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.5, hits: 1, desc: "衝撃波を伴う一撃" },
      { id: "fist_barrage", name: "四連拳", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.42, hits: 4, desc: "拳による4連撃" },
      { id: "chi_flow_heal", name: "循気の癒し", reqLevel: 10, mpCost: 6, kind: "heal", target: "all-ally", power: 1.8, hits: 1, desc: "気を巡らせ味方全体を癒やす" },
      { id: "ougi_no_sho", name: "覇掌", reqLevel: 15, mpCost: 9, kind: "physical", element: "holy", target: "all-enemy", power: 1.7, hits: 1, desc: "会得した掌打の極意で敵全体を打つ" },
    ],
  },
  reaper: {
    id: "reaper", name: "しにがみ", commandName: "しにがみのちから", icon: "💀", tier: "advanced",
    requires: { job: "darkknight", level: JOB_MASTER_LEVEL },
    desc: "あんこくしの上位職。生命力を刈り取る技で、攻撃と回復を同時に成立させる。",
    base: { hp: 36, mp: 14, atk: 17, mag: 9, def: 8, spd: 8 },
    abilities: [
      { id: "sickle_wind", name: "風切り鎌", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.4, hits: 1, desc: "鎌のような斬撃で切り裂く" },
      { id: "soul_sickle", name: "魂刈り", reqLevel: 5, mpCost: 6, kind: "magic", element: "dark", target: "single", power: 1.6, hits: 1, lifesteal: 0.5, desc: "魂を刈り取るような一撃。与ダメージの5割を吸収する" },
      { id: "kiss_of_death", name: "冥府の囁き", reqLevel: 10, mpCost: 11, kind: "magic", element: "dark", target: "all-enemy", power: 1.3, hits: 1, lifesteal: 0.3, desc: "触れた者の力を吸い取る。与ダメージの3割を吸収する" },
      { id: "grand_sickle", name: "葬魂の大鎌", reqLevel: 15, mpCost: 10, kind: "physical", target: "single", power: 3.0, hits: 1, lifesteal: 0.4, desc: "魂ごと刈り取る渾身の一撃。与ダメージの4割を吸収する" },
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
      { id: "m_scratch", name: "みだれづめ", reqLevel: 5, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "3回続けてひっかく" },
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
      { id: "m_crunch", name: "かみちぎる", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.2, hits: 1, desc: "鋭い牙で食いちぎる" },
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
// row/xはツリー図の表示位置（row: 上から何段目、x: 横位置0-100%）。reqLevel: 習得に必要なジョブのレベル（段が開くLv）。
// statPct: 能力値の割合ボーナス（装備のセット効果などの割合と同じ段で掛ける）。passiveAdd の pierce: 防御無視の割合。
// 全部取るのに必要なSPは、固有56＋汎用14×3枠＝98（Lv99のSP）。どのレベルでも「開いているマスの必要SP ≧ 持っているSP」
// になるように段を置いている（docs/skill-tree-design.md）。
//
// 1キャラは「固有ツリー（系統タグごとに1本、交換不可）」＋「汎用ツリー3枠（GENERAL_SLOTS、
// 枠ごとに決まった2択から交換可能）」の計4本を同時に持つ。SPは全4本で共有する1つのプールから
// 消費する（totalSp(c) - 4本ぶんの消費SP合計）。
const EXCLUSIVE_TREES = {
  warrior: {
    id: "warrior", tag: "warrior", name: "剛勇の心得",
    nodes: [
      { id: "w1", kind: "passive", name: "鍛えた腕", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "atk", value: 3 }], desc: "ATK+3", row: 0, reqLevel: 1 },
      { id: "w2", kind: "passive", name: "戦いの勘", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "w1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%", row: 1, reqLevel: 1 },
      { id: "w3", kind: "active", name: "剣撃突き", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_w3", name: "剣撃突き", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.8, hits: 1, desc: "剛勇の心得で会得した強撃" }, effects: [], desc: "新しい技「剣撃突き」を習得", row: 2, reqLevel: 1 },
      { id: "w4a", kind: "passive", name: "不動の構え", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: "w_style", x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4bと選択）", row: 3, reqLevel: 1 },
      { id: "w4b", kind: "passive", name: "猛攻の構え", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: "w_style", x: 66, effects: [{ type: "statAdd", stat: "atk", value: 6 }], desc: "ATK+6（4aと選択）", row: 3, reqLevel: 1 },
      { id: "w_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "w2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "w_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "w5", kind: "active", name: "鎧砕き", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "w3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, ability: { id: "tree_w5", name: "鎧砕き", reqLevel: 1, hits: 1, mpCost: 4, kind: "physical", target: "single", power: 1, debuff: { stat: "def", mult: 0.5, duration: 12 }, desc: "敵1体に攻撃。当たった敵のDEFを12秒間50%下げる" }, effects: [], desc: "新しい技「鎧砕き」を習得: 敵1体に攻撃。当たった敵のDEFを12秒間50%下げる" },
      { id: "w6", kind: "passive", name: "剛力", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "w5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.05 }], desc: "ATK+5%" },
      { id: "w7a", kind: "passive", name: "鉄壁の構え", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "w6", minRank: 1 }], exclusiveGroup: "w_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%（どちらか一方）" },
      { id: "w7b", kind: "passive", name: "豪腕", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "w6", minRank: 1 }], exclusiveGroup: "w_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.08 }], desc: "会心率+8%（どちらか一方）" },
      { id: "w8", kind: "active", name: "鬨の声", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "w6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_w8", name: "鬨の声", reqLevel: 1, hits: 1, mpCost: 10, kind: "buff", target: "all-ally", buff: { stat: "atk", mult: 1.25, duration: 15 }, power: 0, desc: "15秒間、味方全体のATKを25%上げる" }, effects: [], desc: "新しい技「鬨の声」を習得: 15秒間、味方全体のATKを25%上げる" },
      { id: "w9", kind: "passive", name: "歴戦の体", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "w8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.1 }], desc: "HP+10%" },
      { id: "w10a", kind: "passive", name: "闘志", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "w9", minRank: 1 }], exclusiveGroup: "w_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%（どちらか一方）" },
      { id: "w10b", kind: "passive", name: "覇気", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "w9", minRank: 1 }], exclusiveGroup: "w_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "statPct", stat: "atk", value: 0.06 }], desc: "ATK+6%（どちらか一方）" },
      { id: "w11", kind: "passive", name: "剣の頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "w9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.08 }], desc: "ATK+8%" },
      { id: "w12", kind: "active", name: "剛勇覇斬", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "w11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_w12", name: "剛勇覇斬", reqLevel: 1, hits: 1, mpCost: 14, kind: "physical", target: "all-enemy", power: 2, pierce: 0.3, desc: "敵全体に攻撃。防御を30%無視" }, effects: [], desc: "新しい技「剛勇覇斬」を習得: 敵全体に攻撃。防御を30%無視" },
    ],
  },
  magic: {
    id: "magic", tag: "magic", name: "魔導の探求",
    nodes: [
      { id: "m1", kind: "passive", name: "魔力の素地", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3", row: 0, reqLevel: 1 },
      { id: "m2", kind: "passive", name: "省魔の心得", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "m1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%", row: 1, reqLevel: 1 },
      { id: "m3", kind: "active", name: "深淵の矢", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_m3", name: "深淵の矢", reqLevel: 1, mpCost: 8, kind: "magic", element: "dark", target: "single", power: 2.2, hits: 1, desc: "魔導の探求で会得した深淵の魔法" }, effects: [], desc: "新しい技「深淵の矢」を習得", row: 2, reqLevel: 1 },
      { id: "m4a", kind: "passive", name: "魔力の深化", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: "m_style", x: 30, effects: [{ type: "statAdd", stat: "mag", value: 6 }], desc: "MAG+6（4bと選択）", row: 3, reqLevel: 1 },
      { id: "m4b", kind: "passive", name: "魔導障壁", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: "m_style", x: 66, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4aと選択）", row: 3, reqLevel: 1 },
      { id: "m_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "m2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "m_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "m5", kind: "active", name: "魔力の紋", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "m3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, ability: { id: "tree_m5", name: "魔力の紋", reqLevel: 1, hits: 1, mpCost: 10, kind: "buff", target: "all-ally", buff: { stat: "mag", mult: 1.25, duration: 15 }, power: 0, desc: "15秒間、味方全体のMAGを25%上げる" }, effects: [], desc: "新しい技「魔力の紋」を習得: 15秒間、味方全体のMAGを25%上げる" },
      { id: "m6", kind: "passive", name: "魔力の高まり", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "m5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.05 }], desc: "MAG+5%" },
      { id: "m7a", kind: "passive", name: "魔力集中", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "m6", minRank: 1 }], exclusiveGroup: "m_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "statPct", stat: "mag", value: 0.06 }], desc: "MAG+6%（どちらか一方）" },
      { id: "m7b", kind: "passive", name: "魔導の衣", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "m6", minRank: 1 }], exclusiveGroup: "m_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%（どちらか一方）" },
      { id: "m8", kind: "active", name: "雷紋嵐", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "m6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_m8", name: "雷紋嵐", reqLevel: 1, hits: 1, mpCost: 14, kind: "magic", target: "all-enemy", power: 1.4, element: "thunder", desc: "敵全体に雷属性の魔法攻撃" }, effects: [], desc: "新しい技「雷紋嵐」を習得: 敵全体に雷属性の魔法攻撃" },
      { id: "m9", kind: "passive", name: "魔力の泉", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "m8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "mp", value: 0.15 }], desc: "MP+15%" },
      { id: "m10a", kind: "passive", name: "省魔の極み", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "m9", minRank: 1 }], exclusiveGroup: "m_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP−10%（どちらか一方）" },
      { id: "m10b", kind: "passive", name: "深淵の魔力", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "m9", minRank: 1 }], exclusiveGroup: "m_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "statPct", stat: "mag", value: 0.06 }], desc: "MAG+6%（どちらか一方）" },
      { id: "m11", kind: "passive", name: "魔導の頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "m9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.08 }], desc: "MAG+8%" },
      { id: "m12", kind: "active", name: "原初の紋", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "m11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_m12", name: "原初の紋", reqLevel: 1, hits: 1, mpCost: 26, kind: "magic", target: "all-enemy", power: 2.2, desc: "敵全体に魔法攻撃" }, effects: [], desc: "新しい技「原初の紋」を習得: 敵全体に魔法攻撃" },
    ],
  },
  healer: {
    id: "healer", tag: "healer", name: "癒しの祈り",
    nodes: [
      { id: "h1", kind: "passive", name: "祈りの基礎", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3", row: 0, reqLevel: 1 },
      { id: "h2", kind: "passive", name: "癒しの心得", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "h1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.15 }], desc: "回復量+15%", row: 1, reqLevel: 1 },
      { id: "h3", kind: "active", name: "精霊の雫", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_h3", name: "精霊の雫", reqLevel: 1, mpCost: 6, kind: "heal", target: "single-ally", power: 2, hits: 1, desc: "癒しの祈りで会得した回復術" }, effects: [], desc: "新しい技「精霊の雫」を習得", row: 2, reqLevel: 1 },
      { id: "h4a", kind: "passive", name: "深い祈り", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: "h_style", x: 30, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.1 }], desc: "回復量さらに+10%（4bと選択）", row: 3, reqLevel: 1 },
      { id: "h4b", kind: "passive", name: "清貧の心", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: "h_style", x: 66, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（4aと選択）", row: 3, reqLevel: 1 },
      { id: "h_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "h2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "h_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "h5", kind: "active", name: "光の矢", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "h3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, ability: { id: "tree_h5", name: "光の矢", reqLevel: 1, hits: 1, mpCost: 6, kind: "magic", target: "single", power: 1.6, element: "holy", desc: "敵1体に聖属性の魔法攻撃" }, effects: [], desc: "新しい技「光の矢」を習得: 敵1体に聖属性の魔法攻撃" },
      { id: "h6", kind: "passive", name: "祈りの深まり", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "h5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.05 }], desc: "MAG+5%" },
      { id: "h7a", kind: "passive", name: "慈しみ", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "h6", minRank: 1 }], exclusiveGroup: "h_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.1 }], desc: "回復量+10%（どちらか一方）" },
      { id: "h7b", kind: "passive", name: "節制", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "h6", minRank: 1 }], exclusiveGroup: "h_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.92 }], desc: "消費MP−8%（どちらか一方）" },
      { id: "h8", kind: "active", name: "聖なる加護", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "h6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_h8", name: "聖なる加護", reqLevel: 1, hits: 1, mpCost: 14, kind: "buff", target: "all-ally", imbue: { element: "holy", duration: 15 }, power: 0, desc: "15秒間、味方全体の無属性の攻撃が聖属性になる" }, effects: [], desc: "新しい技「聖なる加護」を習得: 15秒間、味方全体の無属性の攻撃が聖属性になる" },
      { id: "h9", kind: "passive", name: "守りの祈り", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "h8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.1 }], desc: "HP+10%" },
      { id: "h10a", kind: "passive", name: "加護の祈り", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "h9", minRank: 1 }], exclusiveGroup: "h_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%（どちらか一方）" },
      { id: "h10b", kind: "passive", name: "慈愛", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "h9", minRank: 1 }], exclusiveGroup: "h_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.1 }], desc: "回復量+10%（どちらか一方）" },
      { id: "h11", kind: "passive", name: "聖なる頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "h9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.08 }], desc: "MAG+8%" },
      { id: "h12", kind: "active", name: "祝福の雨", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "h11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_h12", name: "祝福の雨", reqLevel: 1, hits: 1, mpCost: 24, kind: "heal", target: "all-ally", power: 3, desc: "味方全体に回復" }, effects: [], desc: "新しい技「祝福の雨」を習得: 味方全体に回復" },
    ],
  },
  rogue: {
    id: "rogue", tag: "rogue", name: "迅速の型",
    nodes: [
      { id: "r1", kind: "passive", name: "身のこなし", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2", row: 0, reqLevel: 1 },
      { id: "r2", kind: "passive", name: "急所の見極め", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "r1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%", row: 1, reqLevel: 1 },
      { id: "r3", kind: "active", name: "疾風三連", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_r3", name: "疾風三連", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 0.5, hits: 3, desc: "迅速の型で会得した3連撃" }, effects: [], desc: "新しい技「疾風三連」を習得", row: 2, reqLevel: 1 },
      { id: "r4a", kind: "passive", name: "疾風の足", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: "r_style", x: 30, effects: [{ type: "statAdd", stat: "spd", value: 3 }], desc: "SPD+3（4bと選択）", row: 3, reqLevel: 1 },
      { id: "r4b", kind: "passive", name: "必殺の視点", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: "r_style", x: 66, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.08 }], desc: "会心率さらに+8%（4aと選択）", row: 3, reqLevel: 1 },
      { id: "r_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "r2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "r_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "r5", kind: "active", name: "足止めの刃", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "r3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, ability: { id: "tree_r5", name: "足止めの刃", reqLevel: 1, hits: 1, mpCost: 3, kind: "physical", target: "single", power: 0.9, debuff: { stat: "spd", mult: 0.6, duration: 12 }, desc: "敵1体に攻撃。当たった敵のSPDを12秒間40%下げる" }, effects: [], desc: "新しい技「足止めの刃」を習得: 敵1体に攻撃。当たった敵のSPDを12秒間40%下げる" },
      { id: "r6", kind: "passive", name: "鋭い刃", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "r5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.05 }], desc: "ATK+5%" },
      { id: "r7a", kind: "passive", name: "急所狙い", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "r6", minRank: 1 }], exclusiveGroup: "r_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.08 }], desc: "会心率+8%（どちらか一方）" },
      { id: "r7b", kind: "passive", name: "俊足", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "r6", minRank: 1 }], exclusiveGroup: "r_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2（どちらか一方）" },
      { id: "r8", kind: "active", name: "弱点暴き", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "r6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_r8", name: "弱点暴き", reqLevel: 1, hits: 1, mpCost: 10, kind: "physical", target: "all-enemy", power: 0.5, debuff: { stat: "def", mult: 0.7, duration: 10 }, desc: "敵全体に攻撃。当たった敵のDEFを10秒間30%下げる" }, effects: [], desc: "新しい技「弱点暴き」を習得: 敵全体に攻撃。当たった敵のDEFを10秒間30%下げる" },
      { id: "r9", kind: "passive", name: "研ぎ澄ます", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "r8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.06 }], desc: "ATK+6%" },
      { id: "r10a", kind: "passive", name: "盗み取る刃", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "r9", minRank: 1 }], exclusiveGroup: "r_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%（どちらか一方）" },
      { id: "r10b", kind: "passive", name: "必殺", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "r9", minRank: 1 }], exclusiveGroup: "r_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.08 }], desc: "会心率+8%（どちらか一方）" },
      { id: "r11", kind: "passive", name: "疾風の頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "r9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2" },
      { id: "r12", kind: "active", name: "百花繚乱", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "r11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_r12", name: "百花繚乱", reqLevel: 1, hits: 8, mpCost: 14, kind: "physical", target: "single", power: 0.5, desc: "敵1体に攻撃（8回）" }, effects: [], desc: "新しい技「百花繚乱」を習得: 敵1体に攻撃（8回）" },
    ],
  },
  martial: {
    id: "martial", tag: "martial", name: "闘気の鍛錬",
    nodes: [
      { id: "k1", kind: "passive", name: "頑健な体", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "hp", value: 15 }], desc: "HP+15", row: 0, reqLevel: 1 },
      { id: "k2", kind: "passive", name: "気の巡り", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "k1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "与ダメージの5%を吸収", row: 1, reqLevel: 1 },
      { id: "k3", kind: "active", name: "気圧潰し", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_k3", name: "気圧潰し", reqLevel: 1, mpCost: 4, kind: "physical", target: "single", power: 1.6, hits: 1, desc: "闘気の鍛錬で会得した気の一撃" }, effects: [], desc: "新しい技「気圧潰し」を習得", row: 2, reqLevel: 1 },
      { id: "k4a", kind: "passive", name: "鉄壁の体", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: "k_style", x: 30, effects: [{ type: "statAdd", stat: "def", value: 6 }], desc: "DEF+6（4bと選択）", row: 3, reqLevel: 1 },
      { id: "k4b", kind: "passive", name: "気吸の極意", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: "k_style", x: 66, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "吸収さらに+5%（4aと選択）", row: 3, reqLevel: 1 },
      { id: "k_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "k2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "k_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "k5", kind: "passive", name: "徹し", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "k3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, effects: [{ type: "passiveAdd", key: "pierce", value: 0.25 }], desc: "防御無視+25%" },
      { id: "k6", kind: "passive", name: "鍛えた体", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "k5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.08 }], desc: "HP+8%" },
      { id: "k7a", kind: "passive", name: "金剛の体", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "k6", minRank: 1 }], exclusiveGroup: "k_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "statPct", stat: "def", value: 0.08 }], desc: "DEF+8%（どちらか一方）" },
      { id: "k7b", kind: "passive", name: "気吸", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "k6", minRank: 1 }], exclusiveGroup: "k_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%（どちらか一方）" },
      { id: "k8", kind: "active", name: "金剛の陣", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "k6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_k8", name: "金剛の陣", reqLevel: 1, hits: 1, mpCost: 10, kind: "buff", target: "all-ally", buff: { stat: "def", mult: 1.3, duration: 15 }, power: 0, desc: "15秒間、味方全体のDEFを30%上げる" }, effects: [], desc: "新しい技「金剛の陣」を習得: 15秒間、味方全体のDEFを30%上げる" },
      { id: "k9", kind: "passive", name: "剛拳", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "k8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.06 }], desc: "ATK+6%" },
      { id: "k10a", kind: "passive", name: "不動心", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "k9", minRank: 1 }], exclusiveGroup: "k_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%（どちらか一方）" },
      { id: "k10b", kind: "passive", name: "闘魂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "k9", minRank: 1 }], exclusiveGroup: "k_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "statPct", stat: "atk", value: 0.06 }], desc: "ATK+6%（どちらか一方）" },
      { id: "k11", kind: "passive", name: "闘気の頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "k9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.1 }], desc: "HP+10%" },
      { id: "k12", kind: "active", name: "不動豪拳", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "k11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_k12", name: "不動豪拳", reqLevel: 1, hits: 1, mpCost: 14, kind: "physical", target: "all-enemy", power: 2, element: "holy", desc: "敵全体に聖属性の攻撃" }, effects: [], desc: "新しい技「不動豪拳」を習得: 敵全体に聖属性の攻撃" },
    ],
  },
  dark: {
    id: "dark", tag: "dark", name: "深淵の契約",
    nodes: [
      { id: "d1", kind: "passive", name: "闇との親和", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "mag", value: 3 }], desc: "MAG+3", row: 0, reqLevel: 1 },
      { id: "d2", kind: "passive", name: "生気の収奪", maxRank: 1, costByRank: [1], prerequisites: [{ nodeId: "d1", minRank: 1 }], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "与ダメージの5%を吸収", row: 1, reqLevel: 1 },
      { id: "d3", kind: "active", name: "魂吸い", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d2", minRank: 1 }], exclusiveGroup: null, x: 50, ability: { id: "tree_d3", name: "魂吸い", reqLevel: 1, mpCost: 7, kind: "magic", element: "dark", target: "single", power: 1.8, hits: 1, lifesteal: 0.4, desc: "深淵の契約で会得した吸魂の魔法。与ダメージの4割を吸収する" }, effects: [], desc: "新しい技「魂吸い」を習得", row: 2, reqLevel: 1 },
      { id: "d4a", kind: "passive", name: "深淵の加護", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: "d_style", x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（4bと選択）", row: 3, reqLevel: 1 },
      { id: "d4b", kind: "passive", name: "渇望の契約", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: "d_style", x: 66, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.05 }], desc: "吸収さらに+5%（4aと選択）", row: 3, reqLevel: 1 },
      { id: "d_acc1", kind: "passive", name: "装備の心得", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "d2", minRank: 1 }], exclusiveGroup: null, x: 16, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 2, reqLevel: 1 },
      { id: "d_acc2", kind: "passive", name: "装備の極意", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: null, x: 90, effects: [{ type: "equipSlot", slot: "accessory", value: 1 }], desc: "装飾品の枠+1", row: 3, reqLevel: 1 },
      { id: "d5", kind: "active", name: "呪縛", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "d3", minRank: 1 }], exclusiveGroup: null, reqLevel: 20, row: 4, x: 50, ability: { id: "tree_d5", name: "呪縛", reqLevel: 1, hits: 1, mpCost: 6, kind: "magic", target: "single", power: 1, element: "dark", debuff: { stat: "atk", mult: 0.7, duration: 12 }, desc: "敵1体に闇属性の魔法攻撃。当たった敵のATKを12秒間30%下げる" }, effects: [], desc: "新しい技「呪縛」を習得: 敵1体に闇属性の魔法攻撃。当たった敵のATKを12秒間30%下げる" },
      { id: "d6", kind: "passive", name: "闇の膂力", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "d5", minRank: 1 }], exclusiveGroup: null, reqLevel: 30, row: 5, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.05 }], desc: "ATK+5%" },
      { id: "d7a", kind: "passive", name: "闇の衣", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "d6", minRank: 1 }], exclusiveGroup: "d_style2", reqLevel: 40, row: 6, x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%（どちらか一方）" },
      { id: "d7b", kind: "passive", name: "渇き", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "d6", minRank: 1 }], exclusiveGroup: "d_style2", reqLevel: 40, row: 6, x: 70, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%（どちらか一方）" },
      { id: "d8", kind: "active", name: "闇の帳", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "d6", minRank: 1 }], exclusiveGroup: null, reqLevel: 50, row: 7, x: 50, ability: { id: "tree_d8", name: "闇の帳", reqLevel: 1, hits: 1, mpCost: 12, kind: "magic", target: "all-enemy", power: 1, element: "dark", debuff: { stat: "atk", mult: 0.8, duration: 10 }, desc: "敵全体に闇属性の魔法攻撃。当たった敵のATKを10秒間20%下げる" }, effects: [], desc: "新しい技「闇の帳」を習得: 敵全体に闇属性の魔法攻撃。当たった敵のATKを10秒間20%下げる" },
      { id: "d9", kind: "passive", name: "深淵の魔力", maxRank: 1, costByRank: [5], prerequisites: [{ nodeId: "d8", minRank: 1 }], exclusiveGroup: null, reqLevel: 60, row: 8, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.06 }], desc: "MAG+6%" },
      { id: "d10a", kind: "passive", name: "不死の契約", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "d9", minRank: 1 }], exclusiveGroup: "d_style3", reqLevel: 70, row: 9, x: 30, effects: [{ type: "statPct", stat: "hp", value: 0.1 }], desc: "HP+10%（どちらか一方）" },
      { id: "d10b", kind: "passive", name: "狂気", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "d9", minRank: 1 }], exclusiveGroup: "d_style3", reqLevel: 70, row: 9, x: 70, effects: [{ type: "statPct", stat: "atk", value: 0.06 }], desc: "ATK+6%（どちらか一方）" },
      { id: "d11", kind: "passive", name: "深淵の頂", maxRank: 1, costByRank: [6], prerequisites: [{ nodeId: "d9", minRank: 1 }], exclusiveGroup: null, reqLevel: 80, row: 10, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%" },
      { id: "d12", kind: "active", name: "深淵の刃", maxRank: 1, costByRank: [9], prerequisites: [{ nodeId: "d11", minRank: 1 }], exclusiveGroup: null, reqLevel: 90, row: 11, x: 50, ability: { id: "tree_d12", name: "深淵の刃", reqLevel: 1, hits: 1, mpCost: 16, kind: "physical", target: "all-enemy", power: 1.9, element: "dark", lifesteal: 0.3, desc: "敵全体に闇属性の攻撃。与ダメージの3割を吸収" }, effects: [], desc: "新しい技「深淵の刃」を習得: 敵全体に闇属性の攻撃。与ダメージの3割を吸収" },
    ],
  },
};
// ツリーの振り直しの費用: 使ったSP1につき強化石この数（js/model/roster.js の resetTree）
const TREE_RESET_COST_PER_SP = 20;
function getExclusiveTreeByTag(tag) { return EXCLUSIVE_TREES[tag] || null; }

// ---------- 汎用ツリー（全ジョブ共通のプール。系統を問わず誰でも習得できる） ----------
// GENERAL_SLOTSの3枠それぞれに固定の交換候補2種が割り当てられており、枠の中でだけ
// 切り替えられる（枠をまたいだ自由選択はしない）。汎用ツリーはノードの効果を種族・ジョブに
// 依存しない汎用的なものに統一し、アクティブ技は持たない（パッシブのみ）。
const GENERAL_TREES = {
  offense: {
    id: "offense", name: "攻めの心得",
    nodes: [
      { id: "go1", kind: "passive", name: "会心の芽生え", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.04 }], desc: "会心率+4%", row: 0, reqLevel: 1 },
      { id: "go2a", kind: "passive", name: "会心の極み", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "go1", minRank: 1 }], exclusiveGroup: "offense_style", x: 30, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.06 }], desc: "会心率さらに+6%（右と選択）", row: 1, reqLevel: 1 },
      { id: "go2b", kind: "passive", name: "猛攻の型", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "go1", minRank: 1 }], exclusiveGroup: "offense_style", x: 70, effects: [{ type: "statAdd", stat: "atk", value: 4 }, { type: "statAdd", stat: "mag", value: 4 }], desc: "ATK+4・MAG+4（左と選択）", row: 1, reqLevel: 1 },
      { id: "go3", kind: "passive", name: "攻めの型", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "go1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.04 }, { type: "statPct", stat: "mag", value: 0.04 }], desc: "ATK+4%・MAG+4%" },
      { id: "go4", kind: "passive", name: "見切り", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "go3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%" },
      { id: "go5", kind: "passive", name: "攻めの極み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "go4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "statPct", stat: "atk", value: 0.05 }, { type: "statPct", stat: "mag", value: 0.05 }], desc: "ATK+5%・MAG+5%" },
    ],
  },
  speed: {
    id: "speed", name: "俊敏の心得",
    nodes: [
      { id: "gs1", kind: "passive", name: "軽い足取り", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "spd", value: 3 }], desc: "SPD+3", row: 0, reqLevel: 1 },
      { id: "gs2a", kind: "passive", name: "疾風", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gs1", minRank: 1 }], exclusiveGroup: "speed_style", x: 30, effects: [{ type: "statAdd", stat: "spd", value: 4 }], desc: "SPDさらに+4（右と選択）", row: 1, reqLevel: 1 },
      { id: "gs2b", kind: "passive", name: "先手必勝", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gs1", minRank: 1 }], exclusiveGroup: "speed_style", x: 70, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%（左と選択）", row: 1, reqLevel: 1 },
      { id: "gs3", kind: "passive", name: "身軽さ", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "gs1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2" },
      { id: "gs4", kind: "passive", name: "先読み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gs3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "passiveAdd", key: "critBonus", value: 0.05 }], desc: "会心率+5%" },
      { id: "gs5", kind: "passive", name: "神速", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gs4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "statAdd", stat: "spd", value: 2 }], desc: "SPD+2" },
    ],
  },
  defense: {
    id: "defense", name: "守りの心得",
    nodes: [
      { id: "gd1", kind: "passive", name: "鉄の肌", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "def", value: 4 }], desc: "DEF+4", row: 0, reqLevel: 1 },
      { id: "gd2a", kind: "passive", name: "不屈の盾", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gd1", minRank: 1 }], exclusiveGroup: "defense_style", x: 30, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.92 }], desc: "被ダメージ-8%（右と選択）", row: 1, reqLevel: 1 },
      { id: "gd2b", kind: "passive", name: "頑強", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gd1", minRank: 1 }], exclusiveGroup: "defense_style", x: 70, effects: [{ type: "statAdd", stat: "hp", value: 20 }], desc: "HP+20（左と選択）", row: 1, reqLevel: 1 },
      { id: "gd3", kind: "passive", name: "堅い守り", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "gd1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "statPct", stat: "def", value: 0.06 }], desc: "DEF+6%" },
      { id: "gd4", kind: "passive", name: "鍛えた命", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gd3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.08 }], desc: "HP+8%" },
      { id: "gd5", kind: "passive", name: "守りの極み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gd4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "passiveMult", key: "dmgTakenMult", value: 0.94 }], desc: "被ダメージ−6%" },
    ],
  },
  vampiric: {
    id: "vampiric", name: "吸魂の心得",
    nodes: [
      { id: "gv1", kind: "passive", name: "渇きの芽生え", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.03 }], desc: "与ダメージの3%を吸収", row: 0, reqLevel: 1 },
      { id: "gv2a", kind: "passive", name: "渇望", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gv1", minRank: 1 }], exclusiveGroup: "vampiric_style", x: 30, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収さらに+4%（右と選択）", row: 1, reqLevel: 1 },
      { id: "gv2b", kind: "passive", name: "頑強な渇き", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gv1", minRank: 1 }], exclusiveGroup: "vampiric_style", x: 70, effects: [{ type: "statAdd", stat: "hp", value: 15 }], desc: "HP+15（左と選択）", row: 1, reqLevel: 1 },
      { id: "gv3", kind: "passive", name: "血の渇き", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "gv1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.03 }], desc: "吸収+3%" },
      { id: "gv4", kind: "passive", name: "生命の器", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gv3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "statPct", stat: "hp", value: 0.06 }], desc: "HP+6%" },
      { id: "gv5", kind: "passive", name: "吸魂の極み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gv4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "passiveAdd", key: "lifesteal", value: 0.04 }], desc: "吸収+4%" },
    ],
  },
  support: {
    id: "support", name: "支援の心得",
    nodes: [
      { id: "gu1", kind: "passive", name: "癒しの手", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.08 }], desc: "回復量+8%", row: 0, reqLevel: 1 },
      { id: "gu2a", kind: "passive", name: "深い慈愛", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gu1", minRank: 1 }], exclusiveGroup: "support_style", x: 30, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.08 }], desc: "回復量さらに+8%（右と選択）", row: 1, reqLevel: 1 },
      { id: "gu2b", kind: "passive", name: "節約の心得", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "gu1", minRank: 1 }], exclusiveGroup: "support_style", x: 70, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（左と選択）", row: 1, reqLevel: 1 },
      { id: "gu3", kind: "passive", name: "癒しの技", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "gu1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "passiveAdd", key: "healBonus", value: 0.08 }], desc: "回復量+8%" },
      { id: "gu4", kind: "passive", name: "魔力の器", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gu3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "statPct", stat: "mp", value: 0.15 }], desc: "MP+15%" },
      { id: "gu5", kind: "passive", name: "節約の極み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "gu4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.92 }], desc: "消費MP−8%" },
    ],
  },
  arcane: {
    id: "arcane", name: "魔導の心得",
    nodes: [
      { id: "ga1", kind: "passive", name: "魔力の残滓", maxRank: 1, costByRank: [1], prerequisites: [], exclusiveGroup: null, x: 50, effects: [{ type: "statAdd", stat: "mag", value: 4 }], desc: "MAG+4", row: 0, reqLevel: 1 },
      { id: "ga2a", kind: "passive", name: "深奥の力", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "ga1", minRank: 1 }], exclusiveGroup: "arcane_style", x: 30, effects: [{ type: "statAdd", stat: "mag", value: 6 }], desc: "MAGさらに+6（右と選択）", row: 1, reqLevel: 1 },
      { id: "ga2b", kind: "passive", name: "省魔の極意", maxRank: 1, costByRank: [2], prerequisites: [{ nodeId: "ga1", minRank: 1 }], exclusiveGroup: "arcane_style", x: 70, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.9 }], desc: "消費MP-10%（左と選択）", row: 1, reqLevel: 1 },
      { id: "ga3", kind: "passive", name: "魔力の流れ", maxRank: 1, costByRank: [3], prerequisites: [{ nodeId: "ga1", minRank: 1 }], exclusiveGroup: null, reqLevel: 25, row: 2, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.05 }], desc: "MAG+5%" },
      { id: "ga4", kind: "passive", name: "省魔の技", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "ga3", minRank: 1 }], exclusiveGroup: null, reqLevel: 45, row: 3, x: 50, effects: [{ type: "passiveMult", key: "mpCostMult", value: 0.94 }], desc: "消費MP−6%" },
      { id: "ga5", kind: "passive", name: "魔導の極み", maxRank: 1, costByRank: [4], prerequisites: [{ nodeId: "ga4", minRank: 1 }], exclusiveGroup: null, reqLevel: 65, row: 4, x: 50, effects: [{ type: "statPct", stat: "mag", value: 0.06 }], desc: "MAG+6%" },
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

  // ---- グラシア地方 (Lv32〜45) ----
  { key: "ice_wisp", name: "アイスウィスプ", hp: 48, atk: 22, mag: 0, def: 8, spd: 15, exp: 35, color: "#cfefff", icon: "❄️", element: "氷", tamable: false, tameChance: 0, desc: "吹雪の中を漂う冷気の塊。触れたところから凍りついていく。" },
  { key: "snow_owl", name: "スノーオウル", hp: 52, atk: 23, mag: 0, def: 8, spd: 14, exp: 35, color: "#f4f4f4", icon: "🦉", element: "風", tamable: false, tameChance: 0, desc: "雪原の音もなく舞う白いフクロウ。気づいた時には爪が届いている。" },
  { key: "frost_spider", name: "フロストスパイダー", hp: 58, atk: 24, mag: 0, def: 10, spd: 11, exp: 36, color: "#9fc6e0", icon: "🕸️", element: "氷", tamable: false, tameChance: 0, desc: "凍った糸で巣を張る蜘蛛。糸に絡まると体温を奪われる。" },
  { key: "glacier_bear", name: "グレイシャーベア", hp: 92, atk: 26, mag: 0, def: 13, spd: 6, exp: 38, color: "#e8f2f8", icon: "🐻‍❄️", element: "氷", tamable: false, tameChance: 0, desc: "氷河に棲む巨大な白熊。一撃で岩も砕く。" },
  { key: "ice_imp", name: "アイスインプ", hp: 46, atk: 25, mag: 0, def: 7, spd: 15, exp: 36, color: "#7fb3e0", icon: "👿", element: "氷", tamable: false, tameChance: 0, desc: "いたずら好きの氷の小鬼。仲間を呼んでは雪玉を投げてくる。" },
  { key: "ice_serpent", name: "アイスサーペント", hp: 76, atk: 27, mag: 0, def: 12, spd: 10, exp: 38, color: "#5fa8c8", icon: "🐍", element: "水", tamable: false, tameChance: 0, desc: "氷の下を泳ぐ大蛇。割れ目から一気に飛び出して獲物を絡め取る。" },
  { key: "snow_harpy", name: "スノーハーピー", hp: 60, atk: 26, mag: 0, def: 9, spd: 16, exp: 37, color: "#d0e4f0", icon: "🪽", element: "風", tamable: false, tameChance: 0, desc: "吹雪とともに襲いかかる鳥人。甲高い歌声で旅人を惑わせる。" },
  { key: "mammoth", name: "マンモス", hp: 110, atk: 27, mag: 0, def: 15, spd: 4, exp: 40, color: "#8a6a4a", icon: "🦣", element: "無", tamable: false, tameChance: 0, desc: "長い牙と分厚い毛皮を持つ巨獣。群れで突進してくる。" },
  { key: "crystal_golem", name: "クリスタルゴーレム", hp: 96, atk: 25, mag: 0, def: 20, spd: 4, exp: 40, color: "#a8e0f0", icon: "💠", element: "氷", tamable: false, tameChance: 0, desc: "氷晶が寄り集まってできたゴーレム。光を受けると体が刃のように輝く。" },
  { key: "frost_witch", name: "フロストウィッチ", hp: 62, atk: 29, mag: 0, def: 9, spd: 12, exp: 40, color: "#6a8ad0", icon: "🧙", element: "氷", tamable: false, tameChance: 0, desc: "氷の魔女。凍らせた旅人を像にして飾るのが趣味だという。" },
  { key: "frozen_knight", name: "フローズンナイト", hp: 88, atk: 29, mag: 0, def: 17, spd: 7, exp: 42, color: "#9aa8b8", icon: "⚔️", element: "氷", tamable: false, tameChance: 0, desc: "砦と共に凍りついた騎士。主の命令を守り、今も戦い続けている。" },
  { key: "yeti", name: "イエティ", hp: 104, atk: 30, mag: 0, def: 14, spd: 8, exp: 42, color: "#e0e0e0", icon: "🦍", element: "氷", tamable: false, tameChance: 0, desc: "雪山の怪人。姿を見た者は少ないが、足跡だけは各地に残っている。" },
  { key: "frost_treant", name: "フロストトレント", hp: 168, atk: 33, mag: 0, def: 18, spd: 4, exp: 76, color: "#b8d8e8", icon: "🎄", element: "氷", tamable: false, tameChance: 0, desc: "樹海の中心に立つ凍った大樹の化身。枝の一振りが吹雪を呼ぶ。" },
  { key: "frozen_kraken", name: "フローズンクラーケン", hp: 176, atk: 35, mag: 0, def: 17, spd: 7, exp: 80, color: "#4a7aa0", icon: "🐙", element: "水", tamable: false, tameChance: 0, desc: "湖の底に潜む巨大なイカ。氷を突き破って足を伸ばしてくる。" },
  { key: "crystal_queen", name: "クリスタルクイーン", hp: 170, atk: 37, mag: 0, def: 20, spd: 10, exp: 85, color: "#c8a8f0", icon: "🔮", element: "氷", tamable: false, tameChance: 0, desc: "洞窟の結晶を統べる女王。結晶に映った者の心を読むという。" },
  { key: "frozen_general", name: "フローズンジェネラル", hp: 190, atk: 38, mag: 0, def: 21, spd: 8, exp: 90, color: "#7a8a9a", icon: "🪖", element: "氷", tamable: false, tameChance: 0, desc: "砦を守っていた将軍。凍りついた軍勢を今も率いている。" },
  { key: "frost_dragon", name: "フロストドラゴン", hp: 210, atk: 40, mag: 0, def: 22, spd: 10, exp: 96, color: "#9fd8ff", icon: "🐉", element: "氷", tamable: false, tameChance: 0, desc: "グラシア地方を氷に閉ざした古竜。その息は時さえ凍らせる。" },

  // ---- イグニス地方 (Lv47〜60) ----
  { key: "ash_wolf", name: "アッシュウルフ", hp: 60, atk: 27, mag: 0, def: 10, spd: 15, exp: 44, color: "#7a7470", icon: "🐺", element: "火", tamable: false, tameChance: 0, desc: "灰をかぶった灰色の狼。火の粉の中でも平然と獲物を追う。" },
  { key: "fire_bat", name: "ファイアバット", hp: 50, atk: 26, mag: 0, def: 8, spd: 18, exp: 44, color: "#e0602f", icon: "🦇", element: "火", tamable: false, tameChance: 0, desc: "翼に炎をまとったコウモリ。群れで飛ぶと空が赤く染まる。" },
  { key: "magma_slime", name: "マグマスライム", hp: 82, atk: 24, mag: 0, def: 14, spd: 5, exp: 45, color: "#ff6a2a", icon: "🔴", element: "火", tamable: false, tameChance: 0, desc: "溶岩でできたスライム。触れた武器が溶けることもある。" },
  { key: "cinder_imp", name: "シンダーインプ", hp: 54, atk: 29, mag: 0, def: 9, spd: 16, exp: 46, color: "#c8402a", icon: "😈", element: "火", tamable: false, tameChance: 0, desc: "燃えかすから生まれた小鬼。熱い石を投げつけてくる。" },
  { key: "lava_lizard", name: "ラーヴァリザード", hp: 76, atk: 28, mag: 0, def: 13, spd: 10, exp: 46, color: "#d04a1f", icon: "🦎", element: "火", tamable: false, tameChance: 0, desc: "溶岩の中を泳ぐ大トカゲ。背中の鱗は冷えた溶岩のように硬い。" },
  { key: "salamander_knight", name: "サラマンダーナイト", hp: 88, atk: 30, mag: 0, def: 16, spd: 9, exp: 48, color: "#b8402a", icon: "🛡️", element: "火", tamable: false, tameChance: 0, desc: "サラマンダーの一族の戦士。炎の槍で隊列を組んで戦う。" },
  { key: "fire_serpent", name: "ファイアサーペント", hp: 84, atk: 31, mag: 0, def: 12, spd: 12, exp: 48, color: "#ff8a3a", icon: "🐍", element: "火", tamable: false, tameChance: 0, desc: "溶岩の川に棲む炎の大蛇。鎌首をもたげると熱風が吹きつける。" },
  { key: "flame_spirit", name: "フレイムスピリット", hp: 58, atk: 32, mag: 0, def: 8, spd: 17, exp: 48, color: "#ffb03a", icon: "🔥", element: "火", tamable: false, tameChance: 0, desc: "炎そのものが意思を持った精霊。風に乗って燃え広がる。" },
  { key: "obsidian_golem", name: "オブシディアンゴーレム", hp: 108, atk: 28, mag: 0, def: 22, spd: 4, exp: 50, color: "#2a2a34", icon: "🪨", element: "土", tamable: false, tameChance: 0, desc: "黒曜石でできたゴーレム。割れた面は刃物のように鋭い。" },
  { key: "iron_drake", name: "アイアンドレイク", hp: 96, atk: 33, mag: 0, def: 18, spd: 11, exp: 52, color: "#6a6a78", icon: "🐲", element: "土", tamable: false, tameChance: 0, desc: "鉄の鱗を持つ小竜。鍛冶場の鉄を食べて育ったと言われる。" },
  { key: "fire_giant", name: "ファイアジャイアント", hp: 124, atk: 34, mag: 0, def: 17, spd: 6, exp: 54, color: "#a0402a", icon: "👹", element: "火", tamable: false, tameChance: 0, desc: "炎の巨人。かつてこの地で神々の武具を鍛えていたという。" },
  { key: "ash_behemoth", name: "アッシュベヒモス", hp: 210, atk: 38, mag: 0, def: 22, spd: 5, exp: 104, color: "#5a5048", icon: "🦏", element: "土", tamable: false, tameChance: 0, desc: "灰の平原を支配する巨獣。歩くたびに灰が舞い上がる。" },
  { key: "magma_leviathan", name: "マグマリヴァイアサン", hp: 220, atk: 40, mag: 0, def: 21, spd: 8, exp: 108, color: "#ff5a1f", icon: "🐋", element: "火", tamable: false, tameChance: 0, desc: "溶岩の大河の主。溶岩ごと旅人を飲み込む巨大な魔物。" },
  { key: "forge_master", name: "フォージマスター", hp: 230, atk: 42, mag: 0, def: 24, spd: 7, exp: 112, color: "#c86a2a", icon: "🔨", element: "火", tamable: false, tameChance: 0, desc: "鍛冶場を守る巨人の親方。自ら鍛えた大槌を振るう。" },
  { key: "ifrit", name: "イフリート", hp: 236, atk: 44, mag: 0, def: 22, spd: 10, exp: 118, color: "#ff4a1a", icon: "👺", element: "火", tamable: false, tameChance: 0, desc: "火口に棲む炎の魔神。怒ると周囲のすべてが燃え上がる。" },
  { key: "inferno_dragon", name: "インフェルノドラゴン", hp: 260, atk: 46, mag: 0, def: 25, spd: 11, exp: 126, color: "#d81f1f", icon: "🐉", element: "火", tamable: false, tameChance: 0, desc: "霊峰に棲む炎竜。その炎は山をも溶かすと恐れられている。" },

  // ---- マリナ地方 (Lv62〜75) ----
  { key: "reef_shark", name: "リーフシャーク", hp: 78, atk: 33, mag: 0, def: 12, spd: 17, exp: 55, color: "#5a7a9a", icon: "🦈", element: "水", tamable: false, tameChance: 0, desc: "珊瑚礁を回遊する鮫。血の匂いを嗅ぎつけると群れで集まる。" },
  { key: "giant_jellyfish", name: "ジャイアントクラゲ", hp: 70, atk: 30, mag: 0, def: 10, spd: 9, exp: 54, color: "#c8a8f0", icon: "🪼", element: "水", tamable: false, tameChance: 0, desc: "人より大きなクラゲ。触手に触れるとしびれて動けなくなる。" },
  { key: "coral_golem", name: "コーラルゴーレム", hp: 120, atk: 31, mag: 0, def: 24, spd: 4, exp: 58, color: "#ff8a8a", icon: "🪸", element: "水", tamable: false, tameChance: 0, desc: "珊瑚が寄り集まったゴーレム。砕いても珊瑚がすぐに伸びて元に戻る。" },
  { key: "sea_hornet", name: "シーホーネット", hp: 64, atk: 34, mag: 0, def: 10, spd: 19, exp: 55, color: "#e0c040", icon: "🐝", element: "風", tamable: false, tameChance: 0, desc: "海辺の岩場に巣を作る大蜂。潮風に乗って高速で襲いかかる。" },
  { key: "merfolk_soldier", name: "マーフォーク兵", hp: 92, atk: 34, mag: 0, def: 16, spd: 12, exp: 58, color: "#4a9ab0", icon: "🧜", element: "水", tamable: false, tameChance: 0, desc: "海の民の兵士。陸の者を海に入れまいと槍を構える。" },
  { key: "drowned_sailor", name: "ドラウンドセーラー", hp: 88, atk: 33, mag: 0, def: 14, spd: 10, exp: 57, color: "#6a8a8a", icon: "🧟", element: "闇", tamable: false, tameChance: 0, desc: "海で命を落とした船乗りの亡者。今も船の仕事を続けている。" },
  { key: "ghost_pirate", name: "ゴーストパイレーツ", hp: 82, atk: 37, mag: 0, def: 12, spd: 15, exp: 59, color: "#7a7aa0", icon: "🏴‍☠️", element: "闇", tamable: false, tameChance: 0, desc: "幽霊船の海賊。宝を奪われまいと剣を振り回す。" },
  { key: "kraken_spawn", name: "クラーケンの落とし子", hp: 104, atk: 36, mag: 0, def: 15, spd: 11, exp: 60, color: "#8a3a6a", icon: "🦑", element: "水", tamable: false, tameChance: 0, desc: "大海獣クラーケンの子。小さくても足の力は船を沈めるほど。" },
  { key: "abyss_angler", name: "アビスアングラー", hp: 96, atk: 39, mag: 0, def: 14, spd: 12, exp: 62, color: "#2a3a5a", icon: "🐡", element: "闇", tamable: false, tameChance: 0, desc: "深海で光る提灯をぶら下げた魚。光に誘われた獲物を丸呑みにする。" },
  { key: "siren", name: "セイレーン", hp: 80, atk: 40, mag: 0, def: 11, spd: 18, exp: 62, color: "#7fd0e0", icon: "🧜‍♀️", element: "水", tamable: false, tameChance: 0, desc: "美しい歌声で船乗りを惑わす海の魔物。耳を塞いでも心に響く。" },
  { key: "trident_guard", name: "トライデントガード", hp: 118, atk: 38, mag: 0, def: 21, spd: 10, exp: 64, color: "#3a7a9a", icon: "🔱", element: "水", tamable: false, tameChance: 0, desc: "古代都市を守る三叉槍の衛兵。都が沈んだ今も持ち場を離れない。" },
  { key: "reef_hydra", name: "リーフヒドラ", hp: 250, atk: 44, mag: 0, def: 24, spd: 8, exp: 134, color: "#3aa08a", icon: "🐍", element: "水", tamable: false, tameChance: 0, desc: "浅瀬を支配する多頭の海蛇。頭を落としてもすぐに生えてくる。" },
  { key: "phantom_captain", name: "ファントムキャプテン", hp: 240, atk: 47, mag: 0, def: 22, spd: 12, exp: 138, color: "#5a5a8a", icon: "☠️", element: "闇", tamable: false, tameChance: 0, desc: "幽霊船の船長。呪われた宝を守り、永遠に海をさまよっている。" },
  { key: "sea_serpent_king", name: "シーサーペントキング", hp: 262, atk: 48, mag: 0, def: 25, spd: 11, exp: 142, color: "#2a8ab0", icon: "🐉", element: "水", tamable: false, tameChance: 0, desc: "海洞の奥に棲む大海蛇の王。その体は洞窟をひと巻きにするほど長い。" },
  { key: "drowned_king", name: "ドラウンドキング", hp: 270, atk: 50, mag: 0, def: 27, spd: 10, exp: 148, color: "#4a6a8a", icon: "👑", element: "水", tamable: false, tameChance: 0, desc: "都と共に沈んだ古代の王。海の底から地上への復讐を誓っている。" },
  { key: "leviathan", name: "リヴァイアサン", hp: 300, atk: 52, mag: 0, def: 28, spd: 12, exp: 156, color: "#1a5a8a", icon: "🐋", element: "水", tamable: false, tameChance: 0, desc: "海の王と呼ばれる伝説の巨獣。海溝の底でひたすら眠り続けていた。" },

  // ---- セレスタ地方 (Lv77〜88) ----
  { key: "sky_wisp", name: "スカイウィスプ", hp: 76, atk: 38, mag: 0, def: 11, spd: 20, exp: 64, color: "#d8f0ff", icon: "☁️", element: "風", tamable: false, tameChance: 0, desc: "雲の切れ端が意思を持った精。ふわりと近づいて突風を浴びせる。" },
  { key: "thunder_bird", name: "サンダーバード", hp: 88, atk: 41, mag: 0, def: 12, spd: 21, exp: 66, color: "#f0e04a", icon: "⚡", element: "風", tamable: false, tameChance: 0, desc: "羽ばたくたびに雷を落とす巨鳥。嵐の前触れとして恐れられる。" },
  { key: "cloud_golem", name: "クラウドゴーレム", hp: 140, atk: 36, mag: 0, def: 24, spd: 5, exp: 68, color: "#e8eef4", icon: "🌥️", element: "風", tamable: false, tameChance: 0, desc: "雲を固めて作られたゴーレム。殴ってもふわりと受け止められる。" },
  { key: "wind_sylph", name: "ウィンドシルフ", hp: 80, atk: 40, mag: 0, def: 12, spd: 22, exp: 66, color: "#9fe0c8", icon: "🌬️", element: "風", tamable: false, tameChance: 0, desc: "風の精霊。いたずらに旅人を吹き飛ばして笑っている。" },
  { key: "griffon", name: "グリフォン", hp: 116, atk: 42, mag: 0, def: 17, spd: 17, exp: 70, color: "#c8a060", icon: "🦅", element: "風", tamable: false, tameChance: 0, desc: "鷲の頭と獅子の体を持つ空の獣。浮遊島の空を縄張りにしている。" },
  { key: "sky_knight", name: "スカイナイト", hp: 128, atk: 43, mag: 0, def: 22, spd: 13, exp: 72, color: "#a8c0e0", icon: "🪽", element: "光", tamable: false, tameChance: 0, desc: "天空の民の騎士。翼のある馬にまたがり、空から槍を突き下ろす。" },
  { key: "star_beast", name: "スタービースト", hp: 120, atk: 44, mag: 0, def: 18, spd: 16, exp: 72, color: "#6a5ab0", icon: "🌟", element: "光", tamable: false, tameChance: 0, desc: "星の光を浴びて生まれた獣。夜になると体が星のように瞬く。" },
  { key: "seraph_guard", name: "セラフガード", hp: 124, atk: 46, mag: 0, def: 20, spd: 15, exp: 74, color: "#fff0b0", icon: "😇", element: "光", tamable: false, tameChance: 0, desc: "天空宮殿を守る天使の衛兵。光の剣で侵入者を裁く。" },
  { key: "angel_statue", name: "エンジェルスタチュー", hp: 152, atk: 42, mag: 0, def: 28, spd: 6, exp: 74, color: "#e0e0e8", icon: "🗽", element: "光", tamable: false, tameChance: 0, desc: "庭園に並ぶ天使の像。近づく者がいると動き出して襲いかかる。" },
  { key: "storm_elemental", name: "ストームエレメンタル", hp: 112, atk: 48, mag: 0, def: 15, spd: 19, exp: 76, color: "#7a8ab0", icon: "🌩️", element: "風", tamable: false, tameChance: 0, desc: "嵐そのものの精霊。近づくだけで稲妻に打たれる。" },
  { key: "archon", name: "アルコン", hp: 134, atk: 50, mag: 0, def: 21, spd: 16, exp: 78, color: "#f0d080", icon: "🧝", element: "光", tamable: false, tameChance: 0, desc: "空の帝に仕える高位の天人。地上の者を試すように見下ろしている。" },
  { key: "storm_roc", name: "ストームロック", hp: 300, atk: 53, mag: 0, def: 27, spd: 15, exp: 162, color: "#5a6a8a", icon: "🦤", element: "風", tamable: false, tameChance: 0, desc: "嵐を呼ぶ伝説の巨鳥。翼を広げると雲の道が影に沈む。" },
  { key: "isle_guardian", name: "浮遊島の守護神", hp: 330, atk: 54, mag: 0, def: 32, spd: 9, exp: 168, color: "#8ab08a", icon: "🗿", element: "土", tamable: false, tameChance: 0, desc: "島を空に浮かべ続ける魔法の核を守る巨像。" },
  { key: "garden_warden", name: "庭園の番人", hp: 316, atk: 56, mag: 0, def: 29, spd: 13, exp: 172, color: "#7ac08a", icon: "🌺", element: "土", tamable: false, tameChance: 0, desc: "天空庭園を手入れする花の巨人。花を荒らす者には容赦しない。" },
  { key: "thunder_god_beast", name: "雷神獣", hp: 324, atk: 59, mag: 0, def: 28, spd: 16, exp: 178, color: "#f0d040", icon: "🐯", element: "風", tamable: false, tameChance: 0, desc: "雷を食らう神獣。尖塔の頂で雷とともに咆哮する。" },
  { key: "sky_emperor", name: "空の帝", hp: 350, atk: 61, mag: 0, def: 31, spd: 15, exp: 186, color: "#ffe08a", icon: "👑", element: "光", tamable: false, tameChance: 0, desc: "天空宮殿の主。地上を見下ろし、天と地の境を守り続けてきた。" },

  // ---- アビス地方 (Lv90〜100) ----
  { key: "void_wraith", name: "ヴォイドレイス", hp: 96, atk: 46, mag: 0, def: 13, spd: 21, exp: 80, color: "#3a2a5a", icon: "👻", element: "闇", tamable: false, tameChance: 0, desc: "虚無に呑まれた魂の成れの果て。触れられると心まで冷えていく。" },
  { key: "shadow_beast", name: "シャドウビースト", hp: 132, atk: 49, mag: 0, def: 18, spd: 18, exp: 82, color: "#1a1a2a", icon: "🐈‍⬛", element: "闇", tamable: false, tameChance: 0, desc: "影から生まれた獣。光の当たらない場所ならどこからでも現れる。" },
  { key: "abyss_knight", name: "アビスナイト", hp: 150, atk: 51, mag: 0, def: 26, spd: 14, exp: 86, color: "#2a2a4a", icon: "🗡️", element: "闇", tamable: false, tameChance: 0, desc: "深淵に忠誠を誓った黒騎士。かつては名のある英雄だったという。" },
  { key: "nightmare", name: "ナイトメア", hp: 120, atk: 50, mag: 0, def: 16, spd: 22, exp: 84, color: "#4a2a6a", icon: "🐴", element: "闇", tamable: false, tameChance: 0, desc: "悪夢を運ぶ黒馬。蹄の音を聞いた者は眠れなくなる。" },
  { key: "chaos_imp", name: "カオスインプ", hp: 104, atk: 52, mag: 0, def: 14, spd: 23, exp: 84, color: "#8a2a5a", icon: "👿", element: "闇", tamable: false, tameChance: 0, desc: "混沌から生まれた小鬼。気まぐれに味方の魔物すら襲う。" },
  { key: "doppelganger", name: "ドッペルゲンガー", hp: 128, atk: 53, mag: 0, def: 18, spd: 19, exp: 88, color: "#6a6a7a", icon: "👥", element: "闇", tamable: false, tameChance: 0, desc: "出会った者と同じ姿に化ける魔物。本物と見分けるのは難しい。" },
  { key: "bone_colossus", name: "ボーンコロッサス", hp: 186, atk: 50, mag: 0, def: 30, spd: 6, exp: 90, color: "#d8d0c0", icon: "☠️", element: "闇", tamable: false, tameChance: 0, desc: "無数の骨が寄り集まってできた巨人。崩れてもまた組み上がる。" },
  { key: "abyss_leech", name: "アビスリーチ", hp: 140, atk: 52, mag: 0, def: 20, spd: 12, exp: 88, color: "#4a1a2a", icon: "🪱", element: "闇", tamable: false, tameChance: 0, desc: "虚無の海に棲む巨大なヒル。吸いついた相手の力を奪う。" },
  { key: "eldritch_eye", name: "エルドリッチアイ", hp: 124, atk: 56, mag: 0, def: 17, spd: 17, exp: 92, color: "#6a1a8a", icon: "👁️", element: "闇", tamable: false, tameChance: 0, desc: "宙に浮かぶ巨大な目玉。見つめられると正気を失いそうになる。" },
  { key: "fallen_angel", name: "フォールンエンジェル", hp: 142, atk: 58, mag: 0, def: 22, spd: 19, exp: 96, color: "#5a4a7a", icon: "🪽", element: "闇", tamable: false, tameChance: 0, desc: "天から堕ちた天使。黒く染まった翼で深淵を飛び回る。" },
  { key: "nether_hound", name: "ネザーハウンド", hp: 118, atk: 50, mag: 0, def: 15, spd: 22, exp: 84, color: "#5a1a1a", icon: "🐕‍🦺", element: "闇", tamable: false, tameChance: 0, desc: "深淵の門の周りをうろつく黒い猟犬。迷い込んだ者のにおいを決して忘れない。" },
  { key: "abyss_mage", name: "アビスメイジ", hp: 116, atk: 57, mag: 0, def: 16, spd: 18, exp: 92, color: "#4a2a8a", icon: "🧙‍♂️", element: "闇", tamable: false, tameChance: 0, desc: "深淵の力を研究するうちに呑まれた魔術師。今は闇の呪文しか唱えられない。" },
  { key: "gate_keeper", name: "門番ケルベロス", hp: 360, atk: 62, mag: 0, def: 32, spd: 15, exp: 192, color: "#3a1a1a", icon: "🐕", element: "闇", tamable: false, tameChance: 0, desc: "深淵の門を守る三つ首の番犬。生きた者を決して通さない。" },
  { key: "labyrinth_lord", name: "迷宮の主", hp: 372, atk: 64, mag: 0, def: 33, spd: 14, exp: 198, color: "#2a2a3a", icon: "🐂", element: "闇", tamable: false, tameChance: 0, desc: "影の迷宮に棲む牛頭の巨人。迷い込んだ者を何千年も狩り続けている。" },
  { key: "void_kraken", name: "ヴォイドクラーケン", hp: 390, atk: 66, mag: 0, def: 32, spd: 13, exp: 204, color: "#1a1a4a", icon: "🦑", element: "闇", tamable: false, tameChance: 0, desc: "虚無の海の底から現れる大海魔。その足は闇そのものでできている。" },
  { key: "fallen_king", name: "堕ちた王", hp: 400, atk: 68, mag: 0, def: 35, spd: 14, exp: 212, color: "#5a3a6a", icon: "🤴", element: "闇", tamable: false, tameChance: 0, desc: "天空から堕ちた城の王。深淵の力に魅入られ、人の姿を捨てた。" },
  { key: "abyss_lord", name: "深淵の王", hp: 440, atk: 72, mag: 0, def: 37, spd: 16, exp: 230, color: "#2a0a2a", icon: "🌑", element: "闇", tamable: false, tameChance: 0, desc: "深淵の心臓に宿る、あらゆる災いの源。世界を闇に沈めようとしている。" },

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
  { key: "silver_fox", name: "シルバーフォックス", hp: 66, atk: 26, mag: 0, def: 10, spd: 18, exp: 44, color: "#dfe6ee", icon: "🦊", element: "光", rare: true, tamable: false, tameChance: 0, desc: "銀色の毛並みを持つキツネ。雪原で見かけると幸運が続くという。" },
  { key: "snow_rabbit_king", name: "スノーラビットキング", hp: 80, atk: 24, mag: 0, def: 12, spd: 16, exp: 44, color: "#ffffff", icon: "🐰", element: "氷", rare: true, tamable: false, tameChance: 0, desc: "雪うさぎたちを束ねる王。小さな王冠を大切にしている。" },
  { key: "ice_penguin", name: "アイスペンギン", hp: 84, atk: 25, mag: 0, def: 16, spd: 10, exp: 46, color: "#2f3a4a", icon: "🐧", element: "水", rare: true, tamable: false, tameChance: 0, desc: "氷の上を滑って移動するペンギン。湖の宝物を集めて巣に隠す。" },
  { key: "aurora_fish", name: "オーロラフィッシュ", hp: 70, atk: 27, mag: 0, def: 12, spd: 17, exp: 46, color: "#7ff0c8", icon: "🐟", element: "光", rare: true, tamable: false, tameChance: 0, desc: "オーロラの夜にだけ氷の穴から跳ねる魚。七色に光る鱗は高値で取引される。" },
  { key: "diamond_golem", name: "ダイヤモンドゴーレム", hp: 120, atk: 28, mag: 0, def: 28, spd: 4, exp: 48, color: "#e8f8ff", icon: "💍", element: "土", rare: true, tamable: false, tameChance: 0, desc: "全身がダイヤモンドでできたゴーレム。鉱夫たちの夢のような存在。" },
  { key: "ice_fairy", name: "アイスフェアリー", hp: 64, atk: 30, mag: 0, def: 10, spd: 19, exp: 48, color: "#bfefff", icon: "🧚", element: "氷", rare: true, tamable: false, tameChance: 0, desc: "氷晶の中で生まれた妖精。気に入った者には氷の花を贈る。" },
  { key: "ghost_commander", name: "ゴーストコマンダー", hp: 100, atk: 33, mag: 0, def: 16, spd: 11, exp: 50, color: "#8a9ab8", icon: "🎖️", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "砦の騎士団を率いた団長の亡霊。勲章だけが今も輝いている。" },
  { key: "frost_valkyrie", name: "フロストヴァルキリー", hp: 92, atk: 35, mag: 0, def: 14, spd: 15, exp: 50, color: "#c0d8f0", icon: "🛡️", element: "光", rare: true, tamable: false, tameChance: 0, desc: "勇敢な戦士の魂を迎えに来るという氷の戦乙女。" },
  { key: "silver_drake", name: "シルバードレイク", hp: 120, atk: 36, mag: 0, def: 18, spd: 13, exp: 54, color: "#c8d0d8", icon: "🐲", element: "氷", rare: true, tamable: false, tameChance: 0, desc: "フロストドラゴンに仕える白銀の竜。主の眠りを守っている。" },
  { key: "aurora_spirit", name: "オーロラスピリット", hp: 90, atk: 38, mag: 0, def: 12, spd: 18, exp: 54, color: "#9f7fff", icon: "🌌", element: "光", rare: true, tamable: false, tameChance: 0, desc: "空のオーロラが地上に降りてきた精霊。見た者は二度と忘れられない。" },
  { key: "ember_fox", name: "エンバーフォックス", hp: 76, atk: 30, mag: 0, def: 12, spd: 20, exp: 56, color: "#ff8a3a", icon: "🦊", element: "火", rare: true, tamable: false, tameChance: 0, desc: "尾の先に消えない火を灯したキツネ。灰の中を音もなく駆ける。" },
  { key: "coal_tortoise", name: "コールトータス", hp: 120, atk: 26, mag: 0, def: 28, spd: 4, exp: 56, color: "#3a3a3a", icon: "🐢", element: "土", rare: true, tamable: false, tameChance: 0, desc: "石炭の甲羅を背負ったカメ。甲羅の中には宝石が混じっているという。" },
  { key: "ruby_crab", name: "ルビークラブ", hp: 100, atk: 30, mag: 0, def: 24, spd: 8, exp: 58, color: "#d1203a", icon: "🦀", element: "火", rare: true, tamable: false, tameChance: 0, desc: "紅玉の甲殻を持つ溶岩ガニ。熱で甲殻がいっそう赤く輝く。" },
  { key: "fire_dancer", name: "ファイアダンサー", hp: 80, atk: 34, mag: 0, def: 12, spd: 20, exp: 58, color: "#ff6a8a", icon: "💃", element: "火", rare: true, tamable: false, tameChance: 0, desc: "溶岩の上で舞う炎の精。見とれていると焼かれてしまう。" },
  { key: "mithril_golem", name: "ミスリルゴーレム", hp: 140, atk: 32, mag: 0, def: 32, spd: 5, exp: 60, color: "#c8e0f0", icon: "🤖", element: "土", rare: true, tamable: false, tameChance: 0, desc: "伝説の金属ミスリルで鍛えられたゴーレム。巨人たちの最高傑作。" },
  { key: "anvil_spirit", name: "金床の精", hp: 104, atk: 36, mag: 0, def: 20, spd: 10, exp: 60, color: "#8a8a98", icon: "⚒️", element: "土", rare: true, tamable: false, tameChance: 0, desc: "千年使われた金床に宿った精霊。良い武具を見ると喜ぶ。" },
  { key: "phoenix_chick", name: "不死鳥の雛", hp: 92, atk: 38, mag: 0, def: 14, spd: 19, exp: 62, color: "#ffb04a", icon: "🐥", element: "火", rare: true, tamable: false, tameChance: 0, desc: "火口の炎から生まれた不死鳥の雛。小さくても炎は本物。" },
  { key: "molten_gem", name: "モルテンジェム", hp: 110, atk: 34, mag: 0, def: 26, spd: 12, exp: 62, color: "#ff3a6a", icon: "💎", element: "火", rare: true, tamable: false, tameChance: 0, desc: "溶けた宝石が固まらずに動き出した魔物。冷えると極上の宝石になる。" },
  { key: "sun_drake", name: "サンドレイク", hp: 140, atk: 42, mag: 0, def: 22, spd: 15, exp: 66, color: "#ffd04a", icon: "☀️", element: "光", rare: true, tamable: false, tameChance: 0, desc: "太陽の光を浴びて育った金色の竜。炎竜にも劣らない力を持つ。" },
  { key: "flame_seraph", name: "フレイムセラフ", hp: 112, atk: 44, mag: 0, def: 16, spd: 20, exp: 66, color: "#ffe08a", icon: "👼", element: "光", rare: true, tamable: false, tameChance: 0, desc: "霊峰の頂に降り立つ炎の天使。その姿を見た者は少ない。" },
  { key: "pearl_clam", name: "パールクラム", hp: 140, atk: 30, mag: 0, def: 34, spd: 5, exp: 68, color: "#f0f0f8", icon: "🦪", element: "水", rare: true, tamable: false, tameChance: 0, desc: "大粒の真珠を抱いた大貝。殻を開くと目がくらむほど輝く。" },
  { key: "rainbow_turtle", name: "レインボータートル", hp: 128, atk: 33, mag: 0, def: 28, spd: 9, exp: 68, color: "#7fe0c0", icon: "🐢", element: "光", rare: true, tamable: false, tameChance: 0, desc: "七色の甲羅を持つ海亀。百年に一度だけ浅瀬に姿を見せる。" },
  { key: "treasure_mimic", name: "宝箱ミミック", hp: 120, atk: 40, mag: 0, def: 24, spd: 11, exp: 70, color: "#c8a040", icon: "🧰", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "海賊の宝箱に化けた魔物。中身は本物の宝だという噂もある。" },
  { key: "ghost_parrot", name: "ゴーストパロット", hp: 92, atk: 38, mag: 0, def: 14, spd: 22, exp: 70, color: "#a0e0a0", icon: "🦜", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "船長の肩にいたオウムの霊。宝の隠し場所を繰り返しつぶやく。" },
  { key: "moonlight_seal", name: "ムーンライトシール", hp: 124, atk: 36, mag: 0, def: 20, spd: 14, exp: 72, color: "#c0d0f0", icon: "🦭", element: "光", rare: true, tamable: false, tameChance: 0, desc: "満月の夜にだけ海洞に現れるアザラシ。毛皮は月の光を帯びている。" },
  { key: "black_pearl_crab", name: "黒真珠ガニ", hp: 136, atk: 38, mag: 0, def: 32, spd: 8, exp: 72, color: "#2a2a3a", icon: "🦀", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "黒真珠を甲羅に埋め込んだカニ。気に入った真珠しか身に着けない。" },
  { key: "atlantis_golem", name: "古代都市の守護像", hp: 170, atk: 40, mag: 0, def: 36, spd: 6, exp: 74, color: "#8ab0c8", icon: "🗿", element: "水", rare: true, tamable: false, tameChance: 0, desc: "沈んだ都の宝物庫を守る石像。都の技術の粋を集めて作られた。" },
  { key: "sea_dragon_pup", name: "海竜の子", hp: 132, atk: 44, mag: 0, def: 22, spd: 16, exp: 74, color: "#4ac0e0", icon: "🐲", element: "水", rare: true, tamable: false, tameChance: 0, desc: "古代都市で生まれた海竜の子。人懐こいが、力は大人顔負け。" },
  { key: "deep_sea_whale", name: "深海の白鯨", hp: 200, atk: 44, mag: 0, def: 30, spd: 9, exp: 78, color: "#e8f0f8", icon: "🐳", element: "水", rare: true, tamable: false, tameChance: 0, desc: "海溝を泳ぐ白い鯨。見た船は必ず嵐に遭うと恐れられている。" },
  { key: "ocean_seraph", name: "オーシャンセラフ", hp: 140, atk: 50, mag: 0, def: 20, spd: 21, exp: 78, color: "#8ae0ff", icon: "👼", element: "光", rare: true, tamable: false, tameChance: 0, desc: "海の底に降り立った天使。リヴァイアサンの眠りを見守っている。" },
  { key: "cloud_sheep", name: "わたぐも羊", hp: 150, atk: 36, mag: 0, def: 26, spd: 12, exp: 82, color: "#ffffff", icon: "🐑", element: "風", rare: true, tamable: false, tameChance: 0, desc: "雲でできた毛を持つ羊。毛を刈ると極上の雲織物になる。" },
  { key: "rainbow_bird", name: "レインボーバード", hp: 108, atk: 44, mag: 0, def: 16, spd: 24, exp: 82, color: "#ff9fd0", icon: "🌈", element: "光", rare: true, tamable: false, tameChance: 0, desc: "虹をくぐって現れる鳥。通った後には小さな虹が残る。" },
  { key: "sky_whale_calf", name: "空クジラの子", hp: 190, atk: 42, mag: 0, def: 28, spd: 10, exp: 86, color: "#a8d0f0", icon: "🐋", element: "風", rare: true, tamable: false, tameChance: 0, desc: "雲の海を泳ぐ空クジラの子ども。母クジラの姿は見当たらない。" },
  { key: "pegasus", name: "ペガサス", hp: 136, atk: 48, mag: 0, def: 20, spd: 24, exp: 86, color: "#f8f8ff", icon: "🦄", element: "光", rare: true, tamable: false, tameChance: 0, desc: "翼を持つ白馬。心の清い者にしか近づかないと言われる。" },
  { key: "golden_hen", name: "黄金のめんどり", hp: 140, atk: 44, mag: 0, def: 30, spd: 16, exp: 88, color: "#f2c94c", icon: "🐔", element: "光", rare: true, tamable: false, tameChance: 0, desc: "金の卵を産むという庭園のめんどり。捕まえた者はいない。" },
  { key: "moon_rabbit", name: "月のうさぎ", hp: 128, atk: 46, mag: 0, def: 18, spd: 25, exp: 88, color: "#e0e0f8", icon: "🐇", element: "光", rare: true, tamable: false, tameChance: 0, desc: "月から降りてきたうさぎ。天空庭園で餅をついている。" },
  { key: "lightning_drake", name: "ライトニングドレイク", hp: 168, atk: 54, mag: 0, def: 24, spd: 20, exp: 92, color: "#f0e060", icon: "🐲", element: "風", rare: true, tamable: false, tameChance: 0, desc: "雷を浴びて育った竜。鱗は帯電し、触れる者を痺れさせる。" },
  { key: "storm_crystal", name: "ストームクリスタル", hp: 180, atk: 50, mag: 0, def: 34, spd: 14, exp: 92, color: "#8ac0ff", icon: "💎", element: "風", rare: true, tamable: false, tameChance: 0, desc: "雷が結晶になって動き出したもの。砕くと嵐の力が手に入るという。" },
  { key: "holy_kirin", name: "聖獣キリン", hp: 190, atk: 56, mag: 0, def: 28, spd: 21, exp: 96, color: "#f8e0a0", icon: "🦌", element: "光", rare: true, tamable: false, tameChance: 0, desc: "天空宮殿に住む聖なる獣。現れた年は豊作になると伝えられる。" },
  { key: "stardust_fairy", name: "星屑の妖精", hp: 140, atk: 60, mag: 0, def: 20, spd: 26, exp: 96, color: "#c8b0ff", icon: "✨", element: "光", rare: true, tamable: false, tameChance: 0, desc: "流れ星のかけらから生まれた妖精。きらきらと光の粉をまき散らす。" },
  { key: "void_cat", name: "虚空ネコ", hp: 150, atk: 50, mag: 0, def: 20, spd: 28, exp: 100, color: "#2a2a3a", icon: "🐈", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "門の隙間から現れる黒猫。どこから来てどこへ行くのか誰も知らない。" },
  { key: "lost_lantern", name: "迷いのランタン", hp: 160, atk: 52, mag: 0, def: 28, spd: 16, exp: 100, color: "#f0c060", icon: "🏮", element: "光", rare: true, tamable: false, tameChance: 0, desc: "深淵に落ちた冒険者のランタン。今も帰り道を照らそうと灯り続けている。" },
  { key: "mirror_slime", name: "ミラースライム", hp: 170, atk: 54, mag: 0, def: 34, spd: 20, exp: 104, color: "#c8d0e0", icon: "🪞", element: "光", rare: true, tamable: false, tameChance: 0, desc: "鏡のように磨かれたスライム。映った者の姿を写し取ってからかう。" },
  { key: "shadow_moth_queen", name: "影蛾の女王", hp: 156, atk: 58, mag: 0, def: 22, spd: 25, exp: 104, color: "#6a5a8a", icon: "🦋", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "迷宮の影蛾を統べる女王。羽ばたくと迷宮の壁が動き出す。" },
  { key: "void_jellyfish", name: "虚無クラゲ", hp: 180, atk: 54, mag: 0, def: 26, spd: 18, exp: 108, color: "#8a7ac8", icon: "🪼", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "虚無の海を漂う透明なクラゲ。体の中に小さな星空を抱えている。" },
  { key: "star_eater", name: "星喰らい", hp: 196, atk: 60, mag: 0, def: 28, spd: 17, exp: 108, color: "#1a1a3a", icon: "🌠", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "落ちてきた星を食べて生きる魔物。腹の中で星がまだ光っている。" },
  { key: "cursed_crown", name: "呪われた王冠", hp: 176, atk: 62, mag: 0, def: 32, spd: 18, exp: 112, color: "#c8a040", icon: "👑", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "堕ちた王が戴いていた王冠。かぶる頭を探して城をさまよっている。" },
  { key: "dark_unicorn", name: "ダークユニコーン", hp: 190, atk: 64, mag: 0, def: 26, spd: 24, exp: 112, color: "#3a2a4a", icon: "🦄", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "深淵に染まった一角獣。角には失われた聖なる力がわずかに残る。" },
  { key: "primordial_slime", name: "原初のスライム", hp: 240, atk: 60, mag: 0, def: 36, spd: 20, exp: 120, color: "#7fff9f", icon: "🟢", element: "無", rare: true, tamable: false, tameChance: 0, desc: "すべてのスライムの祖先とされる存在。世界の始まりから生きている。" },
  { key: "chaos_dragon", name: "カオスドラゴン", hp: 230, atk: 70, mag: 0, def: 32, spd: 22, exp: 120, color: "#8a1a4a", icon: "🐲", element: "闇", rare: true, tamable: false, tameChance: 0, desc: "混沌から生まれた竜。どの竜とも違う、あり得ない色の鱗を持つ。" },
  { key: "world_seed", name: "世界樹の種", hp: 220, atk: 62, mag: 0, def: 40, spd: 14, exp: 120, color: "#9fd08a", icon: "🌱", element: "光", rare: true, tamable: false, tameChance: 0, desc: "深淵の底に落ちた世界樹の種。芽吹けば新しい世界が生まれるという。" },
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

// ---------- テイムできるモンスター（スライム・ゴブリン・コウモリ・ウルフ以外） ----------
// 地方ごとに5〜6種類。型（archetype）ごとに種族の能力値の倍率・特性・基礎値・技の形を決め、名前と技の名前だけを種類ごとに付ける。
// ここで RACES・MONSTER_JOBS に足し、敵の定義（ENEMY_TEMPLATES）をテイム可能にする
const TAME_ARCHETYPES = {
  tank: { mult: { hp: 1.35, mp: 0.7, atk: 0.85, mag: 0.6, def: 1.3, spd: 0.65 }, passive: { dmgTakenMult: 0.92 },
    base: { hp: 36, mp: 6, atk: 9, mag: 3, def: 11, spd: 4 },
    skills: [{ kind: "physical", target: "single", power: 1.1, hits: 1, mpCost: 0, desc: "体ごとぶつかる" },
      { kind: "physical", target: "single", power: 1.8, hits: 1, mpCost: 0, desc: "重い一撃を叩きつける" },
      { kind: "physical", target: "all-enemy", power: 0.9, hits: 1, mpCost: 4, desc: "敵全体を押しつぶす" }] },
  brute: { mult: { hp: 1.15, mp: 0.6, atk: 1.25, mag: 0.5, def: 1.0, spd: 0.8 }, passive: { critBonus: 0.04 },
    base: { hp: 32, mp: 5, atk: 13, mag: 2, def: 8, spd: 5 },
    skills: [{ kind: "physical", target: "single", power: 1.3, hits: 1, mpCost: 0, desc: "力任せに殴りつける" },
      { kind: "physical", target: "single", power: 2.1, hits: 1, mpCost: 0, desc: "渾身の力で打ち砕く" },
      { kind: "physical", target: "all-enemy", power: 1.1, hits: 1, mpCost: 5, desc: "暴れまわって敵全体を薙ぎ払う" }] },
  speed: { mult: { hp: 0.85, mp: 0.8, atk: 1.05, mag: 0.7, def: 0.8, spd: 1.35 }, passive: { critBonus: 0.05 },
    base: { hp: 22, mp: 8, atk: 10, mag: 4, def: 5, spd: 11 },
    skills: [{ kind: "physical", target: "single", power: 0.55, hits: 2, mpCost: 0, desc: "素早く2回攻撃する" },
      { kind: "physical", target: "single", power: 0.5, hits: 3, mpCost: 0, desc: "目にも止まらぬ3連撃" },
      { kind: "physical", target: "all-enemy", power: 0.95, hits: 1, mpCost: 4, desc: "駆け抜けながら敵全体を裂く" }] },
  striker: { mult: { hp: 0.95, mp: 0.7, atk: 1.2, mag: 0.6, def: 0.9, spd: 1.1 }, passive: { critBonus: 0.07 },
    base: { hp: 26, mp: 6, atk: 12, mag: 3, def: 6, spd: 9 },
    skills: [{ kind: "physical", target: "single", power: 1.25, hits: 1, mpCost: 0, desc: "急所を狙って攻撃する" },
      { kind: "physical", target: "single", power: 0.55, hits: 3, mpCost: 0, desc: "鋭く3回切り裂く" },
      { kind: "physical", target: "single", power: 2.3, hits: 1, mpCost: 3, desc: "必殺の一撃を叩き込む" }] },
  drainer: { mult: { hp: 1.0, mp: 0.9, atk: 1.05, mag: 0.9, def: 0.9, spd: 1.05 }, passive: { lifesteal: 0.06 },
    base: { hp: 24, mp: 10, atk: 10, mag: 6, def: 6, spd: 8 },
    skills: [{ kind: "physical", target: "single", power: 1.0, hits: 1, mpCost: 0, lifesteal: 0.3, desc: "かみついて体力を奪う" },
      { kind: "magic", target: "single", power: 1.3, hits: 1, mpCost: 4, lifesteal: 0.4, desc: "生命力を吸い取る" },
      { kind: "magic", target: "all-enemy", power: 0.9, hits: 1, mpCost: 6, desc: "敵全体の力を奪う" }] },
  mage: { mult: { hp: 0.8, mp: 1.3, atk: 0.6, mag: 1.35, def: 0.75, spd: 1.0 }, passive: { mpCostMult: 0.9 },
    base: { hp: 20, mp: 20, atk: 4, mag: 12, def: 4, spd: 7 },
    skills: [{ kind: "magic", target: "single", power: 1.5, hits: 1, mpCost: 4, desc: "敵1体に魔法で攻撃する" },
      { kind: "magic", target: "all-enemy", power: 1.1, hits: 1, mpCost: 9, desc: "敵全体に魔法で攻撃する" },
      { kind: "magic", target: "single", power: 2.0, hits: 1, mpCost: 7, desc: "敵1体に強力な魔法を放つ" }] },
  healer: { mult: { hp: 0.9, mp: 1.3, atk: 0.6, mag: 1.2, def: 0.85, spd: 0.95 }, passive: { healBonus: 0.15 },
    base: { hp: 22, mp: 18, atk: 5, mag: 10, def: 5, spd: 6 },
    skills: [{ kind: "magic", target: "single", power: 1.2, hits: 1, mpCost: 3, desc: "敵1体に魔法で攻撃する" },
      { kind: "heal", target: "single-ally", power: 1.8, hits: 1, mpCost: 4, desc: "味方1体のHPを回復する" },
      { kind: "heal", target: "all-ally", power: 1.2, hits: 1, mpCost: 11, desc: "味方全体のHPを回復する" }] },
};
const TAME_ARCHETYPE_DESC = {
  tank: "打たれ強く、仲間の盾になる。", brute: "力が強く、重い一撃を得意とする。", speed: "素早く、手数で攻める。",
  striker: "急所を突くのが得意。", drainer: "相手の体力を吸い取って戦う。", mage: "魔法で攻撃する。消費MPが少ない。",
  healer: "回復の魔法で仲間を支える。",
};
// [敵のkey, 型, テイム率, 種族の説明, 技の名前3つ]
const TAME_SPECIES = [
  ["leaf_pixie", "healer", 0.25, "木の葉に隠れる妖精。", ["このはのやいば", "いやしのつゆ", "もりのめぐみ"]],
  ["stone_lizard", "tank", 0.22, "岩のような鱗を持つトカゲ。", ["しっぽうち", "らくせき", "だいちゆらし"]],
  ["desert_scorpion", "striker", 0.18, "毒の尾を持つ砂漠の狩人。", ["どくのとげ", "はさみぎり", "しのいっさし"]],
  ["dust_devil", "speed", 0.18, "砂を巻き上げて飛び回るつむじ風の精。", ["すなつぶて", "さじんらんぶ", "おおつむじ"]],
  ["cactus_man", "tank", 0.2, "トゲだらけのサボテンの魔物。", ["トゲのたいあたり", "ハリセンボン", "トゲのあらし"]],
  ["mummy", "drainer", 0.16, "王墓で眠っていた包帯の亡者。", ["ほうたいしめ", "のろいのいき", "しのささやき"]],
  ["mirage_spirit", "mage", 0.16, "蜃気楼が形を持った精霊。", ["まぼろしのひかり", "げんえいのうず", "しんきろうのほこ"]],
  ["snow_owl", "speed", 0.17, "吹雪の中を音もなく飛ぶフクロウ。", ["つばさうち", "こおりのつめ", "ふぶきのはばたき"]],
  ["glacier_bear", "brute", 0.15, "氷河に棲む巨大な白熊。", ["ひょうがのつめ", "べアハッグ", "ひょうざんくずし"]],
  ["ice_imp", "mage", 0.16, "いたずら好きな氷の小悪魔。", ["つららとばし", "こおりのきらめき", "ひょうけつのやり"]],
  ["frost_spider", "drainer", 0.15, "凍った糸を張るクモ。", ["いてつくきば", "いのちのいと", "ひょうけつのあみ"]],
  ["frost_witch", "healer", 0.14, "雪の森に住む魔女。", ["こおりのつぶて", "ゆきどけのいやし", "はるのいぶき"]],
  ["yeti", "brute", 0.14, "雪山の伝説の巨人。", ["ゆきだまなげ", "イエティパンチ", "なだれおこし"]],
  ["ash_wolf", "speed", 0.14, "灰の平原を駆ける狼。", ["はいのきば", "ほのおのれんげき", "はいじんのかぜ"]],
  ["fire_bat", "drainer", 0.14, "炎をまとうコウモリ。", ["やけつくきば", "ねっけつきゅうけつ", "ひのこのあらし"]],
  ["magma_slime", "tank", 0.15, "溶岩でできたスライム。", ["ようがんタックル", "マグマのみこみ", "ふんかのうねり"]],
  ["flame_spirit", "mage", 0.13, "炎そのものの精霊。", ["ファイアボール", "かえんのうず", "ごうかのつるぎ"]],
  ["iron_drake", "brute", 0.12, "鋼の鱗を持つ小竜。", ["てっこうのつめ", "りゅうびうち", "はがねのいぶき"]],
  ["reef_shark", "striker", 0.13, "珊瑚礁を荒らすサメ。", ["かみつき", "きりさくひれ", "ちのにおい"]],
  ["giant_jellyfish", "mage", 0.13, "毒の触手を持つ巨大クラゲ。", ["しびれしょくしゅ", "どくのうみ", "でんげきのうず"]],
  ["coral_golem", "tank", 0.12, "珊瑚が集まってできたゴーレム。", ["さんごのこぶし", "かたいさんごのうで", "うみなりのとどろき"]],
  ["siren", "healer", 0.11, "歌で船乗りを惑わす海の魔物。", ["まどいのうた", "いやしのうた", "うみのせいか"]],
  ["kraken_spawn", "brute", 0.11, "大海魔クラーケンの子ども。", ["しょくしゅうち", "まきつき", "おおうずしお"]],
  ["thunder_bird", "speed", 0.11, "雷を呼ぶ巨鳥。", ["いなずまのつめ", "らいめいのはばたき", "かみなりのあらし"]],
  ["wind_sylph", "healer", 0.11, "風の精霊シルフ。", ["かぜのやいば", "そよかぜのいやし", "てんくうのかぜ"]],
  ["griffon", "striker", 0.1, "天空を統べる神獣。", ["グリフォンクロー", "てんくうのつめ", "きゅうこうか"]],
  ["star_beast", "drainer", 0.1, "星の光を食べる獣。", ["ほしくらい", "せいこうきゅうしゅう", "ほしふりのあめ"]],
  ["cloud_golem", "tank", 0.1, "雲を固めたゴーレム。", ["くもパンチ", "らいうんのこぶし", "てんくうおとし"]],
  ["void_wraith", "drainer", 0.09, "虚無から生まれた怨霊。", ["きょむのてのひら", "たましいすい", "うつろのあらし"]],
  ["shadow_beast", "striker", 0.09, "影から生まれた獣。", ["かげのきば", "やみうちれんげき", "えいえんのやみ"]],
  ["nightmare", "speed", 0.08, "悪夢を運ぶ黒馬。", ["あくむのひづめ", "ゆめくらい", "ナイトメアラン"]],
  ["doppelganger", "brute", 0.08, "姿を写し取る影の魔物。", ["うつしみのこぶし", "かがみわり", "ふたりのいちげき"]],
  ["eldritch_eye", "mage", 0.08, "深淵を覗く巨大な眼。", ["しせんのやいば", "ぎょうしのうず", "しんえんのまなざし"]],
];
for (const [key, type, tameChance, flavor, skillNames] of TAME_SPECIES) {
  const tpl = ENEMY_TEMPLATES.find((t) => t.key === key);
  const arch = TAME_ARCHETYPES[type];
  if (!tpl || !arch) continue;
  tpl.tamable = true;
  tpl.tameChance = tameChance;
  RACES[key] = { name: `${tpl.name}族`, kind: "monster", mult: arch.mult, expMult: 1.0, passive: arch.passive,
    desc: `${flavor}${TAME_ARCHETYPE_DESC[type]}` };
  MONSTER_JOBS[key] = {
    id: key, name: tpl.name, base: arch.base,
    abilities: arch.skills.map((sk, i) => Object.assign({}, sk, { id: `m_${key}_${i + 1}`, name: skillNames[i], reqLevel: [1, 5, 10][i] })),
  };
}

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
  { id: "glacia", name: "グラシア地方", desc: "一年中雪と氷に閉ざされた北の地方。氷の奥深くに古い竜が眠るという。" },
  { id: "ignis", name: "イグニス地方", desc: "火山が連なる灼熱の地方。溶岩の川が流れ、炎の魔物が群れをなす。" },
  { id: "marina", name: "マリナ地方", desc: "大海原と群島からなる地方。海の底には沈んだ古代都市が眠っている。" },
  { id: "celesta", name: "セレスタ地方", desc: "雲の上に浮かぶ島々の地方。天空の民と神獣たちが暮らしている。" },
  { id: "abyss", name: "アビス地方", desc: "世界の果ての大穴の底に広がる深淵。あらゆる災いはここから生まれたという。" },
];

const DUNGEONS = [
  {
    id: "plains", region: "verde", name: "はじまりの草原", x: 20, y: 78, level: 1, battles: 3,
    pool: ["slime", "bat", "killer_moth", "field_rat", "mud_plant", "leaf_pixie"], boss: "horned_rabbit", rares: ["gold_slime", "lucky_hare"], unlocks: ["forest"],
    desc: "見晴らしのよい草原。弱い魔物しかいない。",
    benchmarkGear: { rarity: "n", plus: 0 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
    modePower: { hard: 2.77, extra: 6.435 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "forest", region: "verde", name: "ささやきの森", x: 44, y: 60, level: 4, battles: 3,
    pool: ["slime", "goblin", "bat", "forest_spider", "mandrake", "kobold", "hornet"], boss: "elder_treant", rares: ["gem_beetle", "white_stag"], unlocks: ["cave"],
    desc: "木々のざわめきに紛れて魔物が潜む。",
    power: 1.715, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "n", plus: 0 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
    modePower: { hard: 2.19, extra: 5.35 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "cave", region: "verde", name: "こだまの洞窟", x: 26, y: 40, level: 7, battles: 4,
    pool: ["goblin", "bat", "wolf", "cave_bat", "stone_lizard", "shadow_wolf", "mud_crab"], boss: "rock_golem", rares: ["crystal_lizard", "gold_crab"], unlocks: ["ruins"],
    desc: "暗く入り組んだ洞窟。素早い魔物が多い。",
    power: 1.505, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "n", plus: 1 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
    modePower: { hard: 2.07, extra: 4.225 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "ruins", region: "verde", name: "忘れられた遺跡", x: 60, y: 28, level: 11, battles: 4,
    pool: ["goblin", "wolf", "ogre", "skeleton", "living_armor", "wight", "necro_hound"], boss: "stone_gargoyle", rares: ["golden_guardian", "phantom_lord"], unlocks: ["peak"],
    desc: "崩れた石柱が並ぶ遺跡。強力な魔物が棲みついている。",
    power: 1.075, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "r", plus: 2 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
    modePower: { hard: 1.28, extra: 1.695 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "peak", region: "verde", name: "竜骨の山頂", x: 78, y: 12, level: 15, battles: 5,
    pool: ["wolf", "ogre", "frost_wolf", "ice_golem", "mountain_troll", "bone_drake"], boss: "ancient_wyvern", rares: ["frost_phoenix", "dragon_hatchling"], unlocks: ["dunes"],
    desc: "巨大な骨が眠る山頂。ヴェルデ地方で最も危険な領域。",
    power: 0.795, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "r", plus: 3 }, // 想定プレイヤーの適正装備（到着時の代表値。node tools/progression.js。難易度の調整用でゲーム内には影響しない）
    modePower: { hard: 0.995, extra: 1.405 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- サブル地方（推奨Lv17〜30） ----
  {
    id: "dunes", region: "sabul", name: "蜃気楼の砂丘", x: 18, y: 80, level: 17, battles: 5,
    pool: ["sand_worm", "desert_scorpion", "dust_devil", "cactus_man", "death_vulture", "ogre"], boss: "king_worm", rares: ["golden_worm", "gold_tortoise"], unlocks: ["canyon"],
    desc: "陽炎に揺れる果てしない砂丘。砂の下を何かが泳いでいる。",
    power: 0.845, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "r", plus: 4 },
    modePower: { hard: 1.11, extra: 1.15 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "canyon", region: "sabul", name: "サソリの谷", x: 42, y: 62, level: 20, battles: 5,
    pool: ["desert_scorpion", "death_vulture", "sand_bandit", "sand_golem", "jackal_warrior", "cactus_man"], boss: "emperor_scorpion", rares: ["ruby_scorpion", "roc_chick"], unlocks: ["oasis"],
    desc: "赤い岩壁に挟まれた谷。岩陰という岩陰にサソリが潜む。",
    power: 0.7, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 2 },
    modePower: { hard: 0.84, extra: 1.245 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "oasis", region: "sabul", name: "枯れたオアシス", x: 72, y: 66, level: 23, battles: 5,
    pool: ["sand_bandit", "mirage_spirit", "fire_salamander", "dust_devil", "sand_golem", "jackal_warrior"], boss: "cursed_naga", rares: ["oasis_spirit", "mirage_camel"], unlocks: ["tomb"],
    desc: "かつて旅人を潤した泉の跡。干上がった水底に呪いが澱んでいる。",
    power: 0.575, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 3 },
    modePower: { hard: 0.765, extra: 0.83 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "tomb", region: "sabul", name: "砂に沈んだ王墓", x: 56, y: 36, level: 26, battles: 5,
    pool: ["mummy", "scarab", "jackal_warrior", "mirage_spirit", "sand_golem", "sand_bandit"], boss: "mummy_king", rares: ["jackal_guardian", "golden_scarab"], unlocks: ["sun_temple"],
    desc: "砂に呑まれた古王の墓。眠りを妨げる者には容赦がない。",
    power: 0.645, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
    modePower: { hard: 0.795, extra: 0.97 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "sun_temple", region: "sabul", name: "灼熱の大神殿", x: 30, y: 14, level: 30, battles: 5,
    pool: ["mummy", "scarab", "fire_salamander", "sand_golem", "jackal_warrior", "mirage_spirit"], boss: "sphinx", rares: ["flame_phoenix", "temple_guardian"], unlocks: ["frost_forest"],
    desc: "太陽を祀る巨大な神殿。謎を解けぬ者は先へ進めない。",
    power: 0.585, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
    modePower: { hard: 0.735, extra: 0.835 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- グラシア地方（推奨Lv32〜45） ----
  {
    id: "frost_forest", region: "glacia", name: "白霜の樹海", x: 16, y: 78, level: 32, battles: 5,
    pool: ["ice_wisp", "snow_owl", "frost_spider", "glacier_bear", "ice_imp", "frost_wolf"], boss: "frost_treant", rares: ["silver_fox", "snow_rabbit_king"], unlocks: ["frozen_lake"],
    desc: "木々まで白く凍りついた森。吐く息さえ凍って落ちる。",
    power: 0.645, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 4 },
    modePower: { hard: 0.87, extra: 1.125 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "frozen_lake", region: "glacia", name: "凍てつく湖", x: 44, y: 66, level: 35, battles: 5,
    pool: ["ice_wisp", "ice_serpent", "snow_harpy", "glacier_bear", "mammoth", "snow_owl"], boss: "frozen_kraken", rares: ["ice_penguin", "aurora_fish"], unlocks: ["crystal_cave"],
    desc: "厚い氷に覆われた湖。氷の下で巨大な影が動いている。",
    power: 0.57, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 5 },
    modePower: { hard: 0.72, extra: 0.965 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "crystal_cave", region: "glacia", name: "氷晶の洞窟", x: 76, y: 60, level: 38, battles: 5,
    pool: ["crystal_golem", "ice_imp", "frost_spider", "frost_witch", "ice_serpent", "ice_wisp"], boss: "crystal_queen", rares: ["diamond_golem", "ice_fairy"], unlocks: ["snow_fort"],
    desc: "壁も天井も氷の結晶でできた洞窟。光が乱反射して方向を見失う。",
    power: 0.525, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 5 },
    modePower: { hard: 0.7, extra: 0.88 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "snow_fort", region: "glacia", name: "雪原の砦跡", x: 58, y: 34, level: 41, battles: 5,
    pool: ["frozen_knight", "yeti", "mammoth", "snow_harpy", "frost_witch", "crystal_golem"], boss: "frozen_general", rares: ["ghost_commander", "frost_valkyrie"], unlocks: ["ice_throne"],
    desc: "吹雪に埋もれた古い砦。凍りついた兵たちが今も持ち場を守っている。",
    power: 0.58, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 5 },
    modePower: { hard: 0.75, extra: 1.28 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "ice_throne", region: "glacia", name: "氷竜の玉座", x: 30, y: 14, level: 45, battles: 5,
    pool: ["frozen_knight", "yeti", "frost_witch", "crystal_golem", "glacier_bear", "ice_serpent"], boss: "frost_dragon", rares: ["silver_drake", "aurora_spirit"], unlocks: ["ash_plains"],
    desc: "氷河の頂にある氷の玉座。永い眠りから覚めた竜が待っている。",
    power: 0.545, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.69, extra: 1.17 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- イグニス地方（推奨Lv47〜60） ----
  {
    id: "ash_plains", region: "ignis", name: "灰降る平原", x: 18, y: 76, level: 47, battles: 5,
    pool: ["ash_wolf", "fire_bat", "magma_slime", "cinder_imp", "lava_lizard", "salamander_knight"], boss: "ash_behemoth", rares: ["ember_fox", "coal_tortoise"], unlocks: ["lava_river"],
    desc: "灰が雪のように降り積もる平原。足元の地面はほんのり温かい。",
    power: 0.51, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.68, extra: 1.68 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "lava_river", region: "ignis", name: "溶岩の大河", x: 46, y: 64, level: 50, battles: 5,
    pool: ["magma_slime", "lava_lizard", "fire_serpent", "flame_spirit", "fire_bat", "obsidian_golem"], boss: "magma_leviathan", rares: ["ruby_crab", "fire_dancer"], unlocks: ["forge_ruins"],
    desc: "煮えたぎる溶岩が川となって流れる谷。わずかな岩場だけが道になる。",
    power: 0.48, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.64, extra: 0.945 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "forge_ruins", region: "ignis", name: "炎の鍛冶場跡", x: 78, y: 54, level: 53, battles: 5,
    pool: ["obsidian_golem", "salamander_knight", "cinder_imp", "flame_spirit", "iron_drake", "fire_giant"], boss: "forge_master", rares: ["mithril_golem", "anvil_spirit"], unlocks: ["crater"],
    desc: "火の巨人たちが武具を鍛えたという鍛冶場の跡。今も炉の火が消えていない。",
    power: 0.485, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.61, extra: 0.95 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "crater", region: "ignis", name: "大火口", x: 56, y: 30, level: 56, battles: 5,
    pool: ["fire_giant", "iron_drake", "fire_serpent", "flame_spirit", "obsidian_golem", "ash_wolf"], boss: "ifrit", rares: ["phoenix_chick", "molten_gem"], unlocks: ["inferno_peak"],
    desc: "山頂に口を開けた巨大な火口。底からは絶えず炎が噴き上がる。",
    power: 0.445, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.63, extra: 0.79 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "inferno_peak", region: "ignis", name: "業火の霊峰", x: 26, y: 12, level: 60, battles: 5,
    pool: ["fire_giant", "iron_drake", "salamander_knight", "fire_serpent", "flame_spirit", "obsidian_golem"], boss: "inferno_dragon", rares: ["sun_drake", "flame_seraph"], unlocks: ["coral_reef"],
    desc: "業火に包まれた霊峰。火山の主たる炎竜が、挑む者を待っている。",
    power: 0.43, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.61, extra: 0.825 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- マリナ地方（推奨Lv62〜75） ----
  {
    id: "coral_reef", region: "marina", name: "珊瑚の浅瀬", x: 16, y: 74, level: 62, battles: 5,
    pool: ["reef_shark", "giant_jellyfish", "coral_golem", "sea_hornet", "merfolk_soldier", "fire_serpent"], boss: "reef_hydra", rares: ["pearl_clam", "rainbow_turtle"], unlocks: ["ghost_ship"],
    desc: "色とりどりの珊瑚が広がる浅瀬。美しさの陰に魔物が潜む。",
    power: 0.445, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.63, extra: 1.545 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "ghost_ship", region: "marina", name: "幽霊船", x: 44, y: 62, level: 65, battles: 5,
    pool: ["drowned_sailor", "ghost_pirate", "sea_hornet", "giant_jellyfish", "kraken_spawn", "merfolk_soldier"], boss: "phantom_captain", rares: ["treasure_mimic", "ghost_parrot"], unlocks: ["sea_cave"],
    desc: "霧の海をさまよう朽ちた帆船。乗組員は誰一人として生きていない。",
    power: 0.37, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 6 },
    modePower: { hard: 0.5, extra: 0.8 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "sea_cave", region: "marina", name: "潮騒の海洞", x: 78, y: 56, level: 68, battles: 5,
    pool: ["kraken_spawn", "coral_golem", "abyss_angler", "siren", "reef_shark", "drowned_sailor"], boss: "sea_serpent_king", rares: ["moonlight_seal", "black_pearl_crab"], unlocks: ["sunken_city"],
    desc: "満ち潮で閉ざされる海の洞窟。セイレーンの歌が奥から響く。",
    power: 0.395, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.545, extra: 1.235 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "sunken_city", region: "marina", name: "沈んだ古代都市", x: 58, y: 32, level: 71, battles: 5,
    pool: ["merfolk_soldier", "abyss_angler", "siren", "trident_guard", "ghost_pirate", "kraken_spawn"], boss: "drowned_king", rares: ["atlantis_golem", "sea_dragon_pup"], unlocks: ["leviathan_trench"],
    desc: "海の底に沈んだ古代の都。かつての住人が今も街を守っている。",
    power: 0.355, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.5, extra: 0.81 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "leviathan_trench", region: "marina", name: "大海溝", x: 30, y: 12, level: 75, battles: 5,
    pool: ["abyss_angler", "trident_guard", "siren", "kraken_spawn", "coral_golem", "reef_shark"], boss: "leviathan", rares: ["deep_sea_whale", "ocean_seraph"], unlocks: ["cloud_road"],
    desc: "光の届かない深い海溝。海の王リヴァイアサンの棲み処。",
    power: 0.365, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.53, extra: 1.015 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- セレスタ地方（推奨Lv77〜88） ----
  {
    id: "cloud_road", region: "celesta", name: "雲上の道", x: 50, y: 84, level: 77, battles: 5,
    pool: ["sky_wisp", "thunder_bird", "cloud_golem", "wind_sylph", "griffon", "siren"], boss: "storm_roc", rares: ["cloud_sheep", "rainbow_bird"], unlocks: ["floating_isle"],
    desc: "雲の上に続く白い道。踏み外せば地上まで真っ逆さま。",
    power: 0.32, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.49, extra: 0.635 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "floating_isle", region: "celesta", name: "浮遊島", x: 20, y: 58, level: 80, battles: 5,
    pool: ["griffon", "wind_sylph", "sky_knight", "thunder_bird", "star_beast", "cloud_golem"], boss: "isle_guardian", rares: ["sky_whale_calf", "pegasus"], unlocks: ["sky_garden"],
    desc: "空に浮かぶ岩の島。古い魔法の力で今も落ちずに浮かんでいる。",
    power: 0.32, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.49, extra: 0.99 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "sky_garden", region: "celesta", name: "天空庭園", x: 78, y: 48, level: 83, battles: 5,
    pool: ["star_beast", "seraph_guard", "wind_sylph", "angel_statue", "sky_wisp", "sky_knight"], boss: "garden_warden", rares: ["golden_hen", "moon_rabbit"], unlocks: ["thunder_spire"],
    desc: "天空の民が造った庭園。見たこともない花が咲き乱れている。",
    power: 0.3, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.45, extra: 0.68 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "thunder_spire", region: "celesta", name: "雷鳴の尖塔", x: 34, y: 26, level: 86, battles: 5,
    pool: ["thunder_bird", "storm_elemental", "sky_knight", "angel_statue", "seraph_guard", "griffon"], boss: "thunder_god_beast", rares: ["lightning_drake", "storm_crystal"], unlocks: ["celestial_palace"],
    desc: "雷雲を貫いてそびえる塔。絶えず稲妻が塔を打ちつけている。",
    power: 0.285, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.43, extra: 0.6 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "celestial_palace", region: "celesta", name: "天空宮殿", x: 66, y: 10, level: 88, battles: 5,
    pool: ["seraph_guard", "storm_elemental", "angel_statue", "star_beast", "sky_knight", "archon"], boss: "sky_emperor", rares: ["holy_kirin", "stardust_fairy"], unlocks: ["abyss_gate"],
    desc: "雲の頂に建つ天空の宮殿。空の帝がすべてを見下ろしている。",
    power: 0.28, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.435, extra: 0.565 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  // ---- アビス地方（推奨Lv90〜100。最後の地方） ----
  {
    id: "abyss_gate", region: "abyss", name: "深淵の門", x: 22, y: 82, level: 90, battles: 5,
    pool: ["void_wraith", "shadow_beast", "abyss_knight", "nightmare", "chaos_imp", "nether_hound"], boss: "gate_keeper", rares: ["void_cat", "lost_lantern"], unlocks: ["shadow_labyrinth"],
    desc: "大穴の縁に建つ巨大な門。門の向こうからは光が一切漏れてこない。",
    power: 0.23, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 7 },
    modePower: { hard: 0.335, extra: 0.475 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "shadow_labyrinth", region: "abyss", name: "影の迷宮", x: 70, y: 74, level: 93, battles: 5,
    pool: ["shadow_beast", "nightmare", "doppelganger", "chaos_imp", "abyss_knight", "bone_colossus"], boss: "labyrinth_lord", rares: ["mirror_slime", "shadow_moth_queen"], unlocks: ["abyss_sea"],
    desc: "壁が絶えず形を変える影の迷宮。自分の影にさえ道を惑わされる。",
    power: 0.25, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 8 },
    modePower: { hard: 0.36, extra: 0.605 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "abyss_sea", region: "abyss", name: "虚無の海", x: 40, y: 54, level: 95, battles: 5,
    pool: ["void_wraith", "abyss_leech", "doppelganger", "eldritch_eye", "nightmare", "abyss_mage"], boss: "void_kraken", rares: ["void_jellyfish", "star_eater"], unlocks: ["fallen_citadel"],
    desc: "底の見えない黒い水が広がる地底の海。水面に映るのは自分ではない何か。",
    power: 0.23, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 8 },
    modePower: { hard: 0.35, extra: 0.485 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "fallen_citadel", region: "abyss", name: "堕ちた城塞", x: 76, y: 32, level: 98, battles: 5,
    pool: ["abyss_knight", "bone_colossus", "fallen_angel", "eldritch_eye", "chaos_imp", "abyss_leech"], boss: "fallen_king", rares: ["cursed_crown", "dark_unicorn"], unlocks: ["abyss_heart"],
    desc: "天から堕ちた城の残骸。かつての主は深淵に呑まれ、姿を変えた。",
    power: 0.245, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 8 },
    modePower: { hard: 0.365, extra: 0.72 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
  {
    id: "abyss_heart", region: "abyss", name: "深淵の心臓", x: 30, y: 12, level: 100, battles: 5,
    pool: ["fallen_angel", "eldritch_eye", "bone_colossus", "abyss_mage", "nether_hound", "abyss_knight"], boss: "abyss_lord", rares: ["primordial_slime", "chaos_dragon", "world_seed"], unlocks: [],
    desc: "深淵の最奥で脈打つ巨大な心臓。すべての災いの源がここに眠る。",
    power: 0.235, // 敵の強さの倍率（node tools/simulate.js --calibrate の提案値）
    benchmarkGear: { rarity: "sr", plus: 8 },
    modePower: { hard: 0.335, extra: 0.67 }, // ハード・エクストラの敵の強さの倍率（node tools/simulate.js --calibrate-modes）
  },
];

function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id);
}

// ---------- モンスター合成の基本EXP ----------
// 素材1体の基本EXP＝その種族が出てくる一番早いダンジョンのLvで、1レベル上げるのに必要なEXP。
// テイムしたばかりのLv1でも素材として役に立ち、先の地方の種族ほど多い（js/model/inventory.js の fusionExpGain）
const FUSION_SAME_RACE_MULT = 1.5; // 合成先と同じ種族の素材はEXPが1.5倍
// テイムしたモンスターの個体値（js/core/stats.js）: 能力値ごとに 1±MONSTER_IV_RANGE 倍。平均は1.0倍なので難易度は変わらない。
// 同じ種族の素材を合成すると、素材の方が高い能力値を差の MONSTER_IV_INHERIT 倍ずつ引き継ぐ
const MONSTER_IV_RANGE = 0.1;
const MONSTER_IV_INHERIT = 0.3;
const tameHomeLevelCache = {};
function tameHomeLevel(key) {
  if (!(key in tameHomeLevelCache)) {
    const levels = DUNGEONS.filter((d) => d.pool.includes(key) || d.boss === key || (d.rares || []).includes(key)).map((d) => d.level);
    tameHomeLevelCache[key] = levels.length ? Math.min(...levels) : 1;
  }
  return tameHomeLevelCache[key];
}
function fusionBaseExp(key) {
  return expForLevel(tameHomeLevel(key));
}

// ---------- ダンジョンのモード（ノーマル・ハード・エクストラ） ----------
// ノーマルを踏破するとハード、ハードを踏破するとエクストラに挑める（ダンジョンごと）。
// 敵は推奨Lvが levelUp だけ上のダンジョン相当の強さになり、EXPは expMult 倍。
// 落ちる装備のレベルも同じだけ上がり（シリーズ・名のある装備はそのダンジョンの地方のまま）、
// オプション効果（js/options.js）が付く
const DUNGEON_MODES = [
  { key: "normal", name: "ノーマル", levelUp: 0, expMult: 1 },
  { key: "hard", name: "ハード", levelUp: 10, expMult: 1.5 },
  { key: "extra", name: "エクストラ", levelUp: 25, expMult: 2 },
];
function getDungeonMode(key) { return DUNGEON_MODES.find((m) => m.key === key) || DUNGEON_MODES[0]; }
// そのレベルのダンジョン相当の「敵の強さの倍率」（DUNGEONS[].power をレベルで補間。最後のダンジョンより上はその値）
function powerForLevel(level) {
  const pts = DUNGEONS.map((d) => [d.level, d.power || 1]);
  if (level <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [l1, p1] = pts[i];
    if (level <= l1) {
      const [l0, p0] = pts[i - 1];
      return p0 + (p1 - p0) * (level - l0) / (l1 - l0);
    }
  }
  return pts[pts.length - 1][1];
}
// モードを反映したダンジョン（ノーマルならそのまま）。level は敵と装備のレベル、baseLevel は元の推奨Lv。
// 敵の強さの倍率は、ダンジョンごとに合わせた DUNGEONS[].modePower（node tools/simulate.js --calibrate-modes）を使い、
// 無ければそのレベルのダンジョン相当（powerForLevel）
function getModeDungeon(id, mode) {
  const d = getDungeon(id);
  const m = getDungeonMode(mode);
  if (!d || m.key === "normal") return d;
  const level = d.level + m.levelUp;
  const power = (d.modePower && d.modePower[m.key]) || powerForLevel(level);
  return Object.assign({}, d, { mode: m.key, baseLevel: d.level, level, power, expMult: m.expMult });
}

// ---------- 敵の特性と属性（js/core/battle.js がダメージの倍率に使う） ----------
// 特性はモードで強くなる: ノーマルは装備を強くすれば押し切れる程度、エクストラは対策（聖属性・魔法・防御ダウンなど）が要る
const ENEMY_TRAITS = {
  undead: { name: "アンデッド", desc: "聖属性以外の攻撃が効きにくい（エクストラでは効かない）。聖属性が弱点" },
  spirit: { name: "霊体", desc: "物理攻撃が効きにくい（エクストラでは効かない）" },
  ward: { name: "魔法耐性", desc: "魔法が効きにくい（エクストラでは効かない）" },
  armored: { name: "堅牢", desc: "防御がとても高い。魔法や防御ダウン・防御無視が有効" },
};
// resist: 効きにくい攻撃のダメージ倍率／armor: 堅牢な敵の防御の倍率
const TRAIT_STRENGTH = {
  normal: { resist: 0.6, armor: 1.5 },
  hard: { resist: 0.3, armor: 2.5 },
  extra: { resist: 0, armor: 4 },
};
const ENEMY_TRAIT_LIST = {
  undead: ["skeleton", "wight", "necro_hound", "bone_drake", "mummy", "mummy_king", "drowned_sailor", "ghost_pirate", "phantom_captain",
    "drowned_king", "phantom_lord", "ghost_commander", "bone_colossus", "void_wraith", "ghost_parrot", "fallen_king", "cursed_crown"],
  spirit: ["mirage_spirit", "ice_wisp", "flame_spirit", "sky_wisp", "storm_elemental", "void_wraith", "wight", "ghost_pirate", "phantom_captain",
    "phantom_lord", "ghost_commander", "oasis_spirit", "aurora_spirit", "lost_lantern", "dust_devil", "anvil_spirit", "ghost_parrot", "nightmare"],
  ward: ["rock_golem", "ice_golem", "sand_golem", "crystal_golem", "obsidian_golem", "coral_golem", "cloud_golem", "atlantis_golem", "diamond_golem",
    "mithril_golem", "stone_gargoyle", "angel_statue", "mirror_slime", "storm_crystal", "sphinx", "isle_guardian", "garden_warden", "crystal_queen"],
  armored: ["mud_crab", "gold_crab", "scarab", "golden_scarab", "gold_tortoise", "coal_tortoise", "rainbow_turtle", "pearl_clam", "ruby_crab",
    "black_pearl_crab", "emperor_scorpion", "desert_scorpion", "iron_drake", "gem_beetle", "trident_guard", "living_armor", "frozen_knight",
    "abyss_knight", "sky_knight", "bone_colossus", "salamander_knight", "temple_guardian"],
};
function enemyTraits(key) { return Object.keys(ENEMY_TRAIT_LIST).filter((k) => ENEMY_TRAIT_LIST[k].includes(key)); }
// 技の属性（技の element）と表示名
const ELEMENTS = { fire: "炎", ice: "氷", thunder: "雷", holy: "聖", dark: "闇" };
// 敵の属性（ENEMY_TEMPLATES[].element）ごとの、技の属性の倍率（弱点1.5・耐性0.5）
const ENEMY_ELEMENT_AFFINITY = {
  火: { ice: 1.5, fire: 0.5 },
  氷: { fire: 1.5, ice: 0.5 },
  水: { thunder: 1.5, fire: 0.5 },
  風: { thunder: 1.5 },
  土: { thunder: 0.5 },
  闇: { holy: 1.5, dark: 0.5 },
  光: { dark: 1.5, holy: 0.5 },
};
// 敵のダメージ倍率（battle.js の res）。mode: ハード・エクストラ（省略時ノーマル）
function enemyResistances(t, mode) {
  const st = TRAIT_STRENGTH[mode] || TRAIT_STRENGTH.normal;
  const traits = enemyTraits(t.key);
  const res = { el: Object.assign({}, ENEMY_ELEMENT_AFFINITY[t.element] || {}) };
  if (traits.includes("undead")) { res.nonHoly = st.resist; res.el.holy = 1.5; }
  if (traits.includes("spirit")) res.physical = st.resist;
  if (traits.includes("ward")) res.magic = st.resist;
  return { traits, res, defMult: traits.includes("armored") ? st.armor : 1 };
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
    list.push(makeEnemy(getEnemyTemplate(key), mult, false, dungeon.power, false, dungeon.mode));
  }
  if (isBossBattle) {
    list.unshift(makeEnemy(getEnemyTemplate(dungeon.boss), mult * BOSS_MULT, true, dungeon.power, false, dungeon.mode));
  } else if (dungeon.rares && dungeon.rares.length && RNG.chance(RARE_ENCOUNTER_CHANCE)) {
    const i = Math.floor(RNG.float(0, list.length));
    list[i] = makeEnemy(getEnemyTemplate(RNG.pick(dungeon.rares)), mult, false, dungeon.power, true, dungeon.mode);
  }
  // ハード・エクストラはEXPが多い（getModeDungeon）
  if (dungeon.expMult && dungeon.expMult !== 1) for (const e of list) e.exp = Math.round(e.exp * dungeon.expMult);
  return list;
}

// power: ダンジョンごとの敵の強さの倍率（DUNGEONS[].power、省略時1）。HP・ATK・DEFだけに掛け、EXPには掛けない
// （難易度の調整でレベル上げのペースが変わらないようにするため）。mode: 特性の強さ（enemyResistances）
function makeEnemy(t, mult, isBoss, power, isRare, mode) {
  const p = mult * (power || 1) * (isRare ? RARE_STAT_MULT : 1);
  const r = enemyResistances(t, mode);
  return {
    key: t.key,
    name: isBoss ? `${t.name}の主` : isRare ? `★${t.name}` : t.name,
    color: t.color,
    isBoss: !!isBoss,
    isRare: !!isRare,
    hp: Math.round(t.hp * p), maxHp: Math.round(t.hp * p),
    atk: Math.round(t.atk * p), mag: t.mag, def: Math.round(t.def * p * r.defMult),
    spd: t.spd, exp: Math.round(t.exp * mult * (isRare ? RARE_EXP_MULT : 1)),
    element: t.element, traits: r.traits, res: r.res,
    atb: RNG.float(0, 30),
  };
}

// N/R/SR/UR/LRの5段階。上位ほど急激に出にくくなる（1戦闘平均1.4個・1ダンジョン平均約5個のドロップ換算で、
// LRはおおよそ100周に1個出るか出ないかのペース、URは10周やって出たら運がいいと感じるくらい
// （10周で遭遇率およそ15〜25%、30周でも半分弱程度）になるよう重みを設定している）
// material: 自動分解した時に得られる強化石の量
// color: 名前・枠の色（ノーマル白・レア水色・スーパーレア緑・ウルトラレア紫・レジェンドレア金）
const RARITIES = [
  { key: "n", name: "ノーマル", color: "#f2f2f2", mult: 1, weight: 7100, material: 5 },
  { key: "r", name: "レア", color: "#5ccbff", mult: 1.4, weight: 2200, material: 20 },
  { key: "sr", name: "スーパーレア", color: "#5fd480", mult: 2.0, weight: 650, material: 80 },
  { key: "ur", name: "ウルトラレア", color: "#b97dff", mult: 2.8, weight: 35, material: 350 },
  { key: "lr", name: "レジェンドレア", color: "#f2c14e", mult: 4.0, weight: 15, material: 1500 },
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

// 強化値込みの能力値（js/core/equipment.js）。装備の元の数値が小さいため率ではなくレア度に応じた
// 固定量をceilで積み上げる（+1でも必ず変化が見え、かつレア度が高いほど伸びが大きい＝+99で元の値の約4倍になる）
// レア度の色（アイテムに保存された rarityColor は古い色のことがあるので、表示は常にここから引く）
function rarityColor(key) {
  const rarity = RARITIES.find((r) => r.key === key);
  return rarity ? rarity.color : "#f2f2f2";
}
function rarityMult(key) {
  const rarity = RARITIES.find((r) => r.key === key);
  return rarity ? rarity.mult : 1;
}
function itemStats(item) { return QPCore.equipment.itemStats(item, rarityMult(item.rarity)); }
// 並べ替え用の代表値: 主能力（最初の能力値）の強化値込みの値
function itemEffectiveValue(item) {
  const k = QPCore.equipment.primaryStat(item);
  return k ? itemStats(item)[k] : 0;
}

// ---------- 装備 ----------
// アイテムの部位（item.slot）。キャラの装備の枠（右手・左手・頭・体・装飾品1〜3）は EQUIP_POSITIONS
const SLOTS = [
  { key: "weapon", name: "武器", icon: "⚔️" },
  { key: "shield", name: "盾", icon: "🛡️" },
  { key: "head", name: "頭", icon: "⛑️" },
  { key: "body", name: "体", icon: "🥋" },
  { key: "accessory", name: "装飾品", icon: "💍" },
];
const EQUIP_POSITIONS = [
  { key: "main", name: "右手" },
  { key: "off", name: "左手" },
  { key: "head", name: "頭" },
  { key: "body", name: "体" },
  { key: "acc1", name: "装飾品1" },
  { key: "acc2", name: "装飾品2" },
  { key: "acc3", name: "装飾品3" },
];

// 装備の種類（26種）。stats は能力値の重み（レア度の倍率と装備のレベルを掛けて実際の値にする）。
// 最初に書いた能力値が主能力（強化で伸びる基準）。hands: 2 は両手武器（左手が使えなくなる代わりに強い）
const ITEM_TYPES = [
  { key: "sword", name: "剣", kana: "ソード", slot: "weapon", hands: 1, stats: { atk: 3, def: 0.5 } },
  { key: "greatsword", name: "大剣", kana: "グレートソード", slot: "weapon", hands: 2, stats: { atk: 5.5 } },
  { key: "dagger", name: "短剣", kana: "ダガー", slot: "weapon", hands: 1, stats: { atk: 2, spd: 1.5 } },
  { key: "axe", name: "斧", kana: "アクス", slot: "weapon", hands: 1, stats: { atk: 3.6 } },
  { key: "spear", name: "槍", kana: "スピア", slot: "weapon", hands: 2, stats: { atk: 4.5, def: 1.5 } },
  { key: "katana", name: "刀", kana: "ブレード", slot: "weapon", hands: 1, stats: { atk: 3, spd: 1 } },
  { key: "bow", name: "弓", kana: "ボウ", slot: "weapon", hands: 2, stats: { atk: 4, spd: 2 } },
  { key: "claw", name: "かぎ爪", kana: "クロー", slot: "weapon", hands: 1, stats: { atk: 2.2, spd: 1.2 } },
  { key: "scythe", name: "大鎌", kana: "サイス", slot: "weapon", hands: 2, stats: { atk: 4.5, mag: 2 } },
  { key: "mace", name: "メイス", kana: "メイス", slot: "weapon", hands: 1, stats: { atk: 2, mag: 1.5 } },
  { key: "staff", name: "杖", kana: "ワンド", slot: "weapon", hands: 1, stats: { mag: 3 } },
  { key: "rod", name: "両手杖", kana: "ロッド", slot: "weapon", hands: 2, stats: { mag: 5, mp: 4 } },
  { key: "buckler", name: "小盾", kana: "バックラー", slot: "shield", stats: { def: 1.5, spd: 0.5 } },
  { key: "shield", name: "大盾", kana: "シールド", slot: "shield", stats: { def: 2.5, hp: 4 } },
  { key: "helm", name: "かぶと", kana: "ヘルム", slot: "head", stats: { def: 1.5, hp: 3 } },
  { key: "hat", name: "ぼうし", kana: "ハット", slot: "head", stats: { mag: 1, mp: 3 } },
  { key: "hood", name: "ずきん", kana: "フード", slot: "head", stats: { def: 1, spd: 0.8 } },
  { key: "plate", name: "よろい", kana: "アーマー", slot: "body", stats: { def: 3, hp: 4 } },
  { key: "garb", name: "軽よろい", kana: "メイル", slot: "body", stats: { def: 2, spd: 1 } },
  { key: "robe", name: "ローブ", kana: "ローブ", slot: "body", stats: { mp: 4, def: 1, mag: 1 } },
  { key: "amulet", name: "お守り", kana: "アミュレット", slot: "accessory", stats: { hp: 6 } },
  { key: "ring", name: "指輪", kana: "リング", slot: "accessory", stats: { mag: 2 } },
  { key: "boots", name: "くつ", kana: "ブーツ", slot: "accessory", stats: { spd: 2 } },
  { key: "bangle", name: "腕輪", kana: "バングル", slot: "accessory", stats: { atk: 2 } },
  { key: "earring", name: "耳飾り", kana: "イヤリング", slot: "accessory", stats: { mp: 5 } },
  { key: "brooch", name: "ブローチ", kana: "ブローチ", slot: "accessory", stats: { def: 2 } },
];
function getItemType(key) { return ITEM_TYPES.find((t) => t.key === key) || null; }

// 装備のシリーズ（8種）。ダンジョンの推奨Lvが minLevel 以上の地方から落ちる。
// 同じシリーズを2・4・6個そろえて付けるとセット効果（stats は能力値の割合、passives は会心率など）
const ITEM_SERIES = [
  { key: "bronze", name: "ブロンズ", minLevel: 1, setBonus: [
    { count: 2, stats: { hp: 0.04 }, desc: "HP+4%" },
    { count: 4, stats: { def: 0.04 }, desc: "DEF+4%" },
    { count: 6, stats: { atk: 0.04, mag: 0.04 }, desc: "ATK+4%・MAG+4%" },
  ] },
  { key: "iron", name: "アイアン", minLevel: 11, setBonus: [
    { count: 2, stats: { def: 0.05 }, desc: "DEF+5%" },
    { count: 4, stats: { hp: 0.06 }, desc: "HP+6%" },
    { count: 6, passives: { dmgTakenMult: 0.95 }, desc: "被ダメージ-5%" },
  ] },
  { key: "steel", name: "スチール", minLevel: 17, setBonus: [
    { count: 2, stats: { atk: 0.05 }, desc: "ATK+5%" },
    { count: 4, stats: { def: 0.05 }, desc: "DEF+5%" },
    { count: 6, passives: { critBonus: 0.05 }, desc: "会心率+5%" },
  ] },
  { key: "silver", name: "シルバー", minLevel: 32, setBonus: [
    { count: 2, stats: { mag: 0.05 }, desc: "MAG+5%" },
    { count: 4, stats: { mp: 0.1 }, desc: "MP+10%" },
    { count: 6, passives: { healBonus: 0.1 }, desc: "回復量+10%" },
  ] },
  { key: "mithril", name: "ミスリル", minLevel: 47, setBonus: [
    { count: 2, stats: { spd: 0.05 }, desc: "SPD+5%" },
    { count: 4, stats: { atk: 0.05, mag: 0.05 }, desc: "ATK+5%・MAG+5%" },
    { count: 6, passives: { mpCostMult: 0.9 }, desc: "消費MP-10%" },
  ] },
  { key: "dragon", name: "ドラゴン", minLevel: 62, setBonus: [
    { count: 2, stats: { hp: 0.06 }, desc: "HP+6%" },
    { count: 4, stats: { atk: 0.06 }, desc: "ATK+6%" },
    { count: 6, passives: { lifesteal: 0.05 }, desc: "与ダメージの5%を吸収" },
  ] },
  { key: "holy", name: "ホーリー", minLevel: 77, setBonus: [
    { count: 2, stats: { def: 0.06 }, desc: "DEF+6%" },
    { count: 4, stats: { mag: 0.06 }, desc: "MAG+6%" },
    { count: 6, passives: { dmgTakenMult: 0.92 }, desc: "被ダメージ-8%" },
  ] },
  { key: "abyss", name: "アビス", minLevel: 90, setBonus: [
    { count: 2, stats: { atk: 0.06, mag: 0.06 }, desc: "ATK+6%・MAG+6%" },
    { count: 4, stats: { spd: 0.06 }, desc: "SPD+6%" },
    { count: 6, passives: { critBonus: 0.06, lifesteal: 0.04 }, desc: "会心率+6%・吸収+4%" },
  ] },
];
function getItemSeries(key) { return ITEM_SERIES.find((s) => s.key === key) || null; }
// そのレベルのダンジョンで落ちるシリーズ（minLevel 以下で一番新しいもの）
function seriesForLevel(level) {
  let found = ITEM_SERIES[0];
  for (const s of ITEM_SERIES) if ((level || 1) >= s.minLevel) found = s;
  return found;
}

// 装備の一覧（シリーズ×種類＝208種）。key は「シリーズ_種類」、名前はシリーズ名＋種類のカナ（例: アイアンソード）
const ITEM_BASES = [];
for (const series of ITEM_SERIES) {
  for (const type of ITEM_TYPES) {
    ITEM_BASES.push({
      key: `${series.key}_${type.key}`, name: `${series.name}${type.kana}`, typeName: type.name,
      slot: type.slot, type: type.key, series: series.key, hands: type.hands || 1, stats: type.stats,
    });
  }
}
function getItemBase(key) { return ITEM_BASES.find((b) => b.key === key) || null; }
// 旧セーブの8種類（剣・杖・かぎ爪・よろい・ローブ・お守り・指輪・くつ）は、ブロンズの同じ種類に移す
const LEGACY_ITEM_BASES = {
  sword: Object.assign({ legacySlot: "weapon", legacyStat: "atk" }, getItemBase("bronze_sword")),
  staff: Object.assign({ legacySlot: "weapon", legacyStat: "mag" }, getItemBase("bronze_staff")),
  claw: Object.assign({ legacySlot: "weapon", legacyStat: "spd" }, getItemBase("bronze_claw")),
  armor: Object.assign({ legacySlot: "armor", legacyStat: "def" }, getItemBase("bronze_plate")),
  robe: Object.assign({ legacySlot: "armor", legacyStat: "mp" }, getItemBase("bronze_robe")),
  amulet: Object.assign({ legacySlot: "accessory", legacyStat: "hp" }, getItemBase("bronze_amulet")),
  ring: Object.assign({ legacySlot: "accessory", legacyStat: "mag" }, getItemBase("bronze_ring")),
  boots: Object.assign({ legacySlot: "accessory", legacyStat: "spd" }, getItemBase("bronze_boots")),
};

// ジョブごとに持てる装備の種類（weapons/shields/head/body）と二刀流（dualWield: 左手に片手武器を持てる）。
// 装飾品はだれでも付けられる。テイムしたモンスターは MONSTER_EQUIP（武器はかぎ爪だけ、盾は持てない）
const JOB_EQUIP = {
  warrior: { weapons: ["sword", "greatsword", "axe", "spear"], shields: ["buckler", "shield"], head: ["helm", "hood"], body: ["plate", "garb"], dualWield: false },
  swordmaster: { weapons: ["sword", "greatsword", "katana", "axe"], shields: ["buckler"], head: ["helm", "hood"], body: ["plate", "garb"], dualWield: true },
  mage: { weapons: ["staff", "rod", "dagger"], shields: [], head: ["hat"], body: ["robe"], dualWield: false },
  archmage: { weapons: ["staff", "rod", "dagger"], shields: [], head: ["hat", "hood"], body: ["robe"], dualWield: false },
  priest: { weapons: ["mace", "staff"], shields: ["buckler"], head: ["hat", "hood"], body: ["robe", "garb"], dualWield: false },
  archpriest: { weapons: ["mace", "staff", "rod"], shields: ["buckler", "shield"], head: ["hat", "hood", "helm"], body: ["robe", "garb"], dualWield: false },
  thief: { weapons: ["dagger", "sword", "bow"], shields: [], head: ["hood"], body: ["garb"], dualWield: true },
  ninja: { weapons: ["dagger", "katana", "claw", "bow"], shields: [], head: ["hood"], body: ["garb"], dualWield: true },
  monk: { weapons: ["claw"], shields: [], head: ["hood", "hat"], body: ["garb", "robe"], dualWield: true },
  saintfist: { weapons: ["claw", "mace"], shields: [], head: ["hood", "helm"], body: ["garb", "robe"], dualWield: true },
  darkknight: { weapons: ["sword", "greatsword", "scythe", "axe"], shields: ["buckler", "shield"], head: ["helm"], body: ["plate"], dualWield: false },
  reaper: { weapons: ["scythe", "greatsword", "sword"], shields: [], head: ["helm", "hood"], body: ["plate", "garb"], dualWield: false },
};
const MONSTER_EQUIP = { weapons: ["claw"], shields: [], head: ["helm", "hat", "hood"], body: ["plate", "garb", "robe"], dualWield: false };
// 装飾品の枠: 最初は1枠。スキルツリーの「装備の心得」「装備の極意」で1枠ずつ増える（最大3枠）。
// スキルツリーを持たないモンスターは、Lvで増える
const MONSTER_ACCESSORY_SLOT_LEVELS = [20, 40];

const STAT_LABELS = { hp: "HP", mp: "MP", atk: "ATK", mag: "MAG", def: "DEF", spd: "SPD" };

// 装備のレベル: 拾ったダンジョンの推奨Lvを装備のレベルにし、能力値は1Lvごとに基礎値の+12%伸びる
// （キャラの能力値の伸び js/core/stats.js と同じ割合。奥のダンジョンほど装備も強くなり、装備を集め直す意味が続く）
const ITEM_LEVEL_GROWTH = 0.12;

let itemSeq = 1;
// level: 装備のレベル（拾ったダンジョンの推奨Lv）。minRarity: このレア度以上だけから抽選する（レア敵のドロップ）
// 落ちる装備の部位の重み（装飾品は1人3枠まで付けるので多め、盾は持てるジョブが少ないので少なめ）
const ITEM_DROP_SLOT_WEIGHTS = { weapon: 22, shield: 10, head: 15, body: 15, accessory: 38 };
// 落ちるのは、そのダンジョンのレベルのシリーズ（地方ごと）の装備。部位を重みで選び、その部位の種類から等確率で選ぶ。
// opts: { regionLevel（シリーズ・名のある装備を決めるレベル。ハード・エクストラでは元の推奨Lv）, mode（オプション効果を付ける） }
function rollItemDrop(level, minRarity, opts) {
  opts = opts || {};
  // ふつうのドロップは、まれにその地方の名のある装備になる（js/uniques.js）
  if (!minRarity && RNG.chance(UNIQUE_DROP_CHANCE)) return rollUniqueDrop(level, opts);
  const from = minRarity ? RARITIES.findIndex((r) => r.key === minRarity) : 0;
  const series = seriesForLevel(opts.regionLevel || level);
  const slotKeys = Object.keys(ITEM_DROP_SLOT_WEIGHTS);
  let roll = RNG.float(0, slotKeys.reduce((n, k) => n + ITEM_DROP_SLOT_WEIGHTS[k], 0));
  let slot = slotKeys[slotKeys.length - 1];
  for (const k of slotKeys) {
    if (roll < ITEM_DROP_SLOT_WEIGHTS[k]) { slot = k; break; }
    roll -= ITEM_DROP_SLOT_WEIGHTS[k];
  }
  const bases = ITEM_BASES.filter((b) => b.series === series.key && b.slot === slot);
  const item = QPCore.rewards.rollItem(bases, RARITIES.slice(Math.max(0, from)), RNG, () => "item_" + itemSeq++,
    { level: level || 1, levelGrowth: ITEM_LEVEL_GROWTH });
  return addItemOptions(item, opts.mode);
}
// レア敵が落とす装備の下限のレア度（SR以上。重みの比でSR約93%・UR約5%・LR約2%）
const RARE_DROP_MIN_RARITY = "sr";

// ---------- 名のある装備（厨二病・ダークファンタジーの固有装備） ----------
// js/data.js の次に読み込む（ITEM_TYPES・RARITIES・DUNGEONS・RNG を使う）。
// 地方ごとに29種類（26種類の装備の種類を1つずつ＋呪いの装備3つ）、7地方で203種類。
//   - 能力値は同じレベルの通常装備の UNIQUE_STAT_MULT 倍。特殊効果が1つ付く（セット効果と同じ形で計算する）
//   - 呪いの装備は CURSED_STAT_MULT 倍で効果も大きいが、デメリット（被ダメージ増・最大HP減・SPD減・消費MP増）が付く。
//     おまかせ装備では選ばない（自分で付ける）
//   - 入手: ★レア敵が落とす装備の RARE_UNIQUE_CHANCE、ボスを倒すと BOSS_UNIQUE_CHANCE、
//     ふつうのドロップの UNIQUE_DROP_CHANCE が、そのダンジョンの地方の名のある装備になる（レア度はSR以上）
"use strict";

const UNIQUE_STAT_MULT = 1.2;
const CURSED_STAT_MULT = 1.45;
const UNIQUE_DROP_CHANCE = 0.003;
const RARE_UNIQUE_CHANCE = 0.25;
const BOSS_UNIQUE_CHANCE = 0.04;
const UNIQUE_MIN_RARITY = "sr";

// 特殊効果。tier は地方の順番（1〜7）。奥の地方ほど効果が大きい
const uniquePct = (x) => `${Math.round(x * 100)}%`;
const UNIQUE_EFFECTS = {
  crit: (t) => { const v = 0.03 + 0.01 * (t - 1); return { passives: { critBonus: v }, desc: `会心率+${uniquePct(v)}` }; },
  steal: (t) => { const v = 0.02 + 0.01 * (t - 1); return { passives: { lifesteal: v }, desc: `与ダメージの${uniquePct(v)}を吸収` }; },
  heal: (t) => { const v = 0.05 + 0.02 * (t - 1); return { passives: { healBonus: v }, desc: `回復量+${uniquePct(v)}` }; },
  guard: (t) => { const v = 0.03 + 0.01 * (t - 1); return { passives: { dmgTakenMult: 1 - v }, desc: `被ダメージ-${uniquePct(v)}` }; },
  thrift: (t) => { const v = 0.05 + 0.015 * (t - 1); return { passives: { mpCostMult: 1 - v }, desc: `消費MP-${uniquePct(v)}` }; },
  atk: (t) => { const v = 0.04 + 0.01 * (t - 1); return { stats: { atk: v }, desc: `ATK+${uniquePct(v)}` }; },
  mag: (t) => { const v = 0.04 + 0.01 * (t - 1); return { stats: { mag: v }, desc: `MAG+${uniquePct(v)}` }; },
  def: (t) => { const v = 0.04 + 0.01 * (t - 1); return { stats: { def: v }, desc: `DEF+${uniquePct(v)}` }; },
  spd: (t) => { const v = 0.04 + 0.01 * (t - 1); return { stats: { spd: v }, desc: `SPD+${uniquePct(v)}` }; },
  hp: (t) => { const v = 0.05 + 0.015 * (t - 1); return { stats: { hp: v }, desc: `HP+${uniquePct(v)}` }; },
  mp: (t) => { const v = 0.05 + 0.015 * (t - 1); return { stats: { mp: v }, desc: `MP+${uniquePct(v)}` }; },
};
// 呪いの装備の大きな効果（恩恵）と、デメリット（呪い）
const CURSE_BOONS = {
  atk: (t) => { const v = 0.15 + 0.03 * (t - 1); return { stats: { atk: v }, desc: `ATK+${uniquePct(v)}` }; },
  mag: (t) => { const v = 0.15 + 0.03 * (t - 1); return { stats: { mag: v }, desc: `MAG+${uniquePct(v)}` }; },
  def: (t) => { const v = 0.15 + 0.03 * (t - 1); return { stats: { def: v }, desc: `DEF+${uniquePct(v)}` }; },
  spd: (t) => { const v = 0.15 + 0.03 * (t - 1); return { stats: { spd: v }, desc: `SPD+${uniquePct(v)}` }; },
  crit: (t) => { const v = 0.08 + 0.015 * (t - 1); return { passives: { critBonus: v }, desc: `会心率+${uniquePct(v)}` }; },
  steal: (t) => { const v = 0.06 + 0.015 * (t - 1); return { passives: { lifesteal: v }, desc: `与ダメージの${uniquePct(v)}を吸収` }; },
};
const CURSES = {
  frail: (t) => { const v = 0.1 + 0.01 * (t - 1); return { passives: { dmgTakenMult: 1 + v }, desc: `被ダメージ+${uniquePct(v)}` }; },
  wither: (t) => { const v = 0.12 + 0.01 * (t - 1); return { stats: { hp: -v }, desc: `最大HP-${uniquePct(v)}` }; },
  sloth: (t) => { const v = 0.15 + 0.01 * (t - 1); return { stats: { spd: -v }, desc: `SPD-${uniquePct(v)}` }; },
  drain: (t) => { const v = 0.15 + 0.01 * (t - 1); return { passives: { mpCostMult: 1 + v }, desc: `消費MP+${uniquePct(v)}` }; },
};

// [key, 名前, 種類, 効果（呪いは "恩恵>呪い"）, 説明文]
const UNIQUE_DEFS = {
  verde: [
    ["v_sword", "黒き木刀《漆黒丸》", "sword", "crit", "修学旅行の土産屋で、運命的に出会った一振り。"],
    ["v_greatsword", "断罪の大剣", "greatsword", "atk", "罪人の首を落とし続けた刃。草原の風でさえ、これを避けて吹く。"],
    ["v_dagger", "影縫いの短刀", "dagger", "spd", "影を地面に縫いとめるという。試した者は、まだいない。"],
    ["v_axe", "樵の怨斧", "axe", "steal", "森を切り拓いた樵の無念が、刃こぼれに宿っている。"],
    ["v_spear", "黄昏の槍", "spear", "crit", "夕暮れにだけ鈍く光る槍。持ち主は、なぜか寡黙になる。"],
    ["v_katana", "妖刀・月下美人", "katana", "spd", "一夜だけ咲く花の名を持つ刀。抜けば、斬らずにはいられない。"],
    ["v_bow", "宵闇の弓", "bow", "crit", "放った矢は、星の見えない夜にだけ必ず当たる。"],
    ["v_claw", "獣王の爪痕", "claw", "steal", "森の王と呼ばれた獣の爪。今も獲物の匂いを覚えている。"],
    ["v_scythe", "草刈りの死神", "scythe", "atk", "元は草刈り鎌だった。何を刈ったのかは、誰も語らない。"],
    ["v_mace", "懺悔の鐘槌", "mace", "heal", "打つたびに鐘の音が鳴る。罪を数えているのだという。"],
    ["v_staff", "囁きの枝杖", "staff", "mag", "囁きの森の古木から削り出した杖。夜になると、誰かの名を呼ぶ。"],
    ["v_rod", "第零の魔導杖", "rod", "thrift", "存在しないはずの第零章を読んだ者だけが振るえる。"],
    ["v_buckler", "古傷の円盾", "buckler", "guard", "無数の古傷が刻まれた盾。持ち主の分まで痛みを引き受ける。"],
    ["v_shield", "盟約の黒盾", "shield", "def", "決して破られぬ盟約の証。代償が何だったかは、記されていない。"],
    ["v_helm", "鴉羽の兜", "helm", "hp", "鴉の羽で飾られた兜。かぶると、遠くの死の気配がわかる。"],
    ["v_hat", "見習い魔導士の三角帽", "hat", "mp", "かぶるだけで魔力が上がる気がする。たぶん、気のせいではない。"],
    ["v_hood", "名無しの頭巾", "hood", "spd", "名を捨てた者の頭巾。かぶれば、誰の記憶にも残らない。"],
    ["v_plate", "錆びた騎士の鎧", "plate", "def", "滅びた騎士団の鎧。錆の下には、まだ誇りが残っている。"],
    ["v_garb", "黒衣《ノクターン》", "garb", "spd", "夜想曲の名を持つ黒い外套。風もないのに、裾がなびく。"],
    ["v_robe", "星詠みの外套", "robe", "mag", "星の並びから明日を読む者の衣。読めるのは、悪い明日だけ。"],
    ["v_amulet", "封印の護符", "amulet", "hp", "何かを封じている。何を封じているのかは、知らない方がいい。"],
    ["v_ring", "契約の指輪", "ring", "mag", "はめた瞬間、どこかで何かと契約が結ばれた。"],
    ["v_boots", "疾風の黒靴", "boots", "spd", "履けば風になる。脱ぐのを忘れると、帰れなくなる。"],
    ["v_bangle", "封印されし右腕の包帯", "bangle", "atk", "右腕に巻く包帯。外すと、抑えきれない力が暴れ出す――らしい。"],
    ["v_earring", "魔眼の耳飾り", "earring", "thrift", "耳に着けているのに、なぜか右目が疼く。"],
    ["v_brooch", "黒薔薇のブローチ", "brooch", "guard", "黒い薔薇は枯れない。持ち主が先に枯れるからだ。"],
    ["v_curse_sword", "血啜りの魔剣", "sword", "atk>frail", "斬るたびに、持ち主の血も啜る。それでも手放せない。"],
    ["v_curse_ring", "堕落の指輪", "ring", "mag>wither", "魔力と引き換えに、少しずつ命を削る指輪。"],
    ["v_curse_hood", "邪眼の眼帯", "hood", "crit>sloth", "右目に封じた邪眼が敵の急所を映す。代わりに、足がすくむ。"],
  ],
  sabul: [
    ["s_sword", "冥王の宝剣アンク", "sword", "crit", "冥府の王が握っていた剣。生と死の境を斬り分ける。"],
    ["s_greatsword", "灼砂の断罪剣", "greatsword", "atk", "砂嵐ごと敵を断つ。刃には、まだ熱い砂がまとわりつく。"],
    ["s_dagger", "蠍の毒牙", "dagger", "steal", "サソリの谷の主の尾から作った短剣。かすっただけで、命が抜けていく。"],
    ["s_axe", "墓守の首狩り斧", "axe", "crit", "王墓を荒らす者の首を落としてきた斧。墓守は、今も眠らない。"],
    ["s_spear", "蜃気楼の槍", "spear", "spd", "確かにそこにあるのに、敵には三本に見えるという。"],
    ["s_katana", "渇刀・砂時雨", "katana", "atk", "水を一滴も寄せつけない刀。斬られた傷は、決して潤わない。"],
    ["s_bow", "日輪の弓", "bow", "crit", "真昼にしか引けない弓。放たれた矢は、太陽そのものの熱を帯びる。"],
    ["s_claw", "砂獅子の爪", "claw", "spd", "砂漠を統べた獅子の爪。踏みしめた足跡は、すぐに風が消す。"],
    ["s_scythe", "冥府の渡し鎌", "scythe", "steal", "死者を向こう岸へ渡す舟守の鎌。生者の魂も、ついでに運ぶ。"],
    ["s_mace", "聖骸の錫杖", "mace", "heal", "聖人の骨を納めた錫杖。打たれた者は、なぜか祈りたくなる。"],
    ["s_staff", "砂時計の杖", "staff", "thrift", "時の砂が尽きぬ限り、魔力もまた尽きない。"],
    ["s_rod", "太陽神の祭杖", "rod", "mag", "太陽神を祀る神官の杖。掲げれば、昼が少しだけ長くなる。"],
    ["s_buckler", "スカラベの小盾", "buckler", "guard", "黄金の甲虫を象った盾。持ち主が倒れても、甲虫は転がり続ける。"],
    ["s_shield", "王墓の石扉", "shield", "def", "王墓の入口を塞いでいた石扉を、そのまま盾にした。重い。"],
    ["s_helm", "黄金の死仮面", "helm", "hp", "死せる王の顔を写した黄金の仮面。かぶると、少しだけ偉そうになる。"],
    ["s_hat", "占星術師のターバン", "hat", "mag", "星と砂の流れを読むターバン。巻き方を間違えると、未来も間違える。"],
    ["s_hood", "砂塵の覆面", "hood", "spd", "砂嵐の中でも視界を失わない覆面。正体も失わない。"],
    ["s_plate", "ミイラ王の包帯鎧", "plate", "hp", "包帯を幾重にも巻いた鎧。中身がどうなっているかは、聞かない方がいい。"],
    ["s_garb", "盗賊王の外套", "garb", "crit", "四十の宝を盗んだ盗賊王の外套。ポケットが多い。"],
    ["s_robe", "神官の亜麻衣", "robe", "heal", "神殿に仕えた神官の衣。乾いた風の中でも、ほのかに香油が香る。"],
    ["s_amulet", "ウジャトの護符", "amulet", "guard", "すべてを見通す目の護符。見通したくないものまで見える。"],
    ["s_ring", "砂漠の王の印章", "ring", "mag", "王の命令はこの印で封じられた。今は、誰の命令も聞かない。"],
    ["s_boots", "砂渡りの靴", "boots", "spd", "砂の上を沈まず歩ける靴。代わりに、どこにも根を下ろせない。"],
    ["s_bangle", "奴隷王の腕輪", "bangle", "atk", "鎖を断ち切って王になった男の腕輪。断たれた鎖が、まだ揺れている。"],
    ["s_earring", "囁く砂の耳飾り", "earring", "mp", "耳元で砂がさらさらと鳴り続ける。たまに、言葉に聞こえる。"],
    ["s_brooch", "蠍の徽章", "brooch", "def", "蠍の紋章のブローチ。胸に着けると、なぜか背後が気にならなくなる。"],
    ["s_curse_greatsword", "呪王の大剣", "greatsword", "atk>wither", "王墓に眠っていた大剣。抜いた者は、王と同じ病に冒される。"],
    ["s_curse_amulet", "千年の渇き", "amulet", "steal>drain", "千年分の渇きを封じた首飾り。満たされることは、決してない。"],
    ["s_curse_garb", "呪われた王の衣", "garb", "spd>frail", "まとえば誰より速く走れる。ただ王と同じく、刺されやすい。"],
  ],
  glacia: [
    ["g_sword", "氷葬剣《コキュートス》", "sword", "crit", "斬った者を氷に閉じ込め、永遠に弔う剣。"],
    ["g_greatsword", "永久凍土の大剣", "greatsword", "atk", "一万年溶けなかった氷から削り出した。持つ手も、少し凍る。"],
    ["g_dagger", "雪華の短剣", "dagger", "spd", "刃に雪の結晶が咲く短剣。斬られた傷口にも、花が咲く。"],
    ["g_axe", "砦落としの戦斧", "axe", "atk", "雪原の砦を、たった一人で落とした戦士の斧。"],
    ["g_spear", "氷竜の牙槍", "spear", "crit", "氷竜の牙を穂先にした槍。今でも獲物の体温に飢えている。"],
    ["g_katana", "斬雪刀・白夜", "katana", "spd", "沈まぬ太陽の下で打たれた刀。刃の白さは、雪よりも眩しい。"],
    ["g_bow", "凍月の弓", "bow", "crit", "凍てつく月を弦に張ったという弓。夜にだけ、音もなく射抜く。"],
    ["g_claw", "霜狼の爪", "claw", "steal", "群れを率いた霜狼の爪。引き裂いた傷は、凍えて塞がらない。"],
    ["g_scythe", "静寂の大鎌", "scythe", "mag", "振るえば、周りの音がすべて消える。最後に消えるのは、悲鳴だ。"],
    ["g_mace", "氷晶の聖槌", "mace", "heal", "透きとおった氷晶の槌。打たれた傷は痛まず、ただ冷たい。"],
    ["g_staff", "吹雪の杖", "staff", "mag", "振れば吹雪が起きる。止め方は、まだ誰も知らない。"],
    ["g_rod", "氷獄の王笏", "rod", "thrift", "氷の牢獄を治める王の笏。凍りついた魔力が、いつまでも尽きない。"],
    ["g_buckler", "霜の鏡盾", "buckler", "guard", "磨き上げた氷の盾。映った敵は、自分の凍える姿を見る。"],
    ["g_shield", "氷竜の鱗盾", "shield", "hp", "氷竜の逆鱗をはめ込んだ大盾。触れると、竜の鼓動が聞こえる。"],
    ["g_helm", "凍てつく王の兜", "helm", "def", "玉座で凍りついた王の兜。王はまだ、かぶったままかもしれない。"],
    ["g_hat", "雪の魔女の帽子", "hat", "mp", "雪の魔女が置き忘れた帽子。かぶると、ほんの少し冷たい性格になる。"],
    ["g_hood", "白狐の頭巾", "hood", "spd", "白狐の毛皮の頭巾。雪原に立てば、誰にも見つからない。"],
    ["g_plate", "永久氷壁の鎧", "plate", "def", "溶けることのない氷の壁を、鎧に打ち直したもの。"],
    ["g_garb", "雪狼の毛皮", "garb", "hp", "雪狼の毛皮をまとった軽鎧。吹雪の夜でも、獣の温もりが残る。"],
    ["g_robe", "氷霧の法衣", "robe", "mag", "霧のように揺らめく法衣。着た者の吐く息は、白く凍る。"],
    ["g_amulet", "凍れる涙の護符", "amulet", "guard", "誰かが流した最後の涙が、凍って護符になった。"],
    ["g_ring", "氷結の指輪", "ring", "crit", "はめた指先から、相手の弱点が冷たく透けて見える。"],
    ["g_boots", "氷上の舞靴", "boots", "spd", "凍った湖の上で舞い続けた踊り子の靴。止まると、割れる。"],
    ["g_bangle", "霜巨人の腕輪", "bangle", "atk", "巨人の腕輪を縮めたもの。縮めた者は、まだ見つかっていない。"],
    ["g_earring", "雪鈴の耳飾り", "earring", "thrift", "小さな鈴の耳飾り。雪の降る夜だけ、ひとりでに鳴る。"],
    ["g_brooch", "結晶の徽章", "brooch", "heal", "洞窟の奥で育った結晶の徽章。持つ者の傷を、ゆっくり凍らせて塞ぐ。"],
    ["g_curse_sword", "凍魂の魔剣", "sword", "atk>sloth", "魂ごと凍らせる魔剣。持ち主の足も、少しずつ凍っていく。"],
    ["g_curse_ring", "氷の心臓", "ring", "mag>wither", "凍った心臓を収めた指輪。魔力は溢れるが、体温は戻らない。"],
    ["g_curse_plate", "氷棺の鎧", "plate", "def>drain", "棺のように閉じた氷の鎧。どんな刃も通さないが、魔力も外へ出ない。"],
  ],
  ignis: [
    ["i_sword", "黒炎剣レーヴァテイン", "sword", "crit", "世界を焼き尽くすと伝わる炎の剣。黒い炎は、水では消えない。"],
    ["i_greatsword", "煉獄の断頭剣", "greatsword", "atk", "罪人を煉獄の炎で清める処刑剣。清められた者は、灰しか残らない。"],
    ["i_dagger", "火蜥蜴の舌", "dagger", "spd", "サラマンダーの舌を鍛えた短剣。刃先が、ちろちろと揺れる。"],
    ["i_axe", "鍛冶神の戦斧", "axe", "crit", "炎の鍛冶場で神が振るった斧。打たれたものは、すべて鍛え直される。"],
    ["i_spear", "火口の灼槍", "spear", "atk", "火口から引き抜かれた槍。突けば、大地も噴き上がる。"],
    ["i_katana", "妖刀・紅蓮", "katana", "steal", "抜けば紅蓮の炎が刃を包む。斬った者の命を、炎ごと喰らう。"],
    ["i_bow", "不死鳥の弓", "bow", "hp", "不死鳥の羽で作った弓。放った矢は、燃え尽きても何度でも蘇る。"],
    ["i_claw", "炎獄の鉤爪", "claw", "steal", "煉獄の番犬の鉤爪。傷口は、いつまでも燻り続ける。"],
    ["i_scythe", "灰燼の死神鎌", "scythe", "crit", "刈り取ったものをすべて灰に変える鎌。収穫の後には、何も残らない。"],
    ["i_mace", "業火の審判槌", "mace", "mag", "炎の審判を下す槌。罪の重さだけ、炎が強くなる。"],
    ["i_staff", "火竜の心杖", "staff", "mag", "火竜の心臓を芯にした杖。握る手が、いつも少し熱い。"],
    ["i_rod", "終焉の焔杖《ラグナ》", "rod", "thrift", "世界の終わりに灯る炎を宿す杖。その炎は、魔力を燃料にしない。"],
    ["i_buckler", "溶岩の小盾", "buckler", "guard", "冷え固まった溶岩の盾。受けた刃は、溶けて流れ落ちる。"],
    ["i_shield", "炎鱗の大盾", "shield", "def", "炎竜の鱗を幾重にも重ねた大盾。炎も刃も、等しく弾く。"],
    ["i_helm", "角ある炎魔の兜", "helm", "hp", "炎の魔人の角を残した兜。かぶると、少しだけ怒りっぽくなる。"],
    ["i_hat", "灰かぶりの魔女帽", "hat", "mp", "灰の降る平原に住む魔女の帽子。払っても払っても、灰が積もる。"],
    ["i_hood", "火の粉の覆面", "hood", "spd", "火の粉を払って駆ける斥候の覆面。焦げ跡は、勲章だ。"],
    ["i_plate", "黒鉄の煉獄鎧", "plate", "def", "煉獄の炎で鍛えた黒鉄の鎧。中は、思ったより涼しい。"],
    ["i_garb", "焔纏いの外套", "garb", "crit", "炎を纏って戦う剣士の外套。燃えているのに、灰にならない。"],
    ["i_robe", "紅蓮の魔導衣", "robe", "mag", "紅蓮の炎の色をした魔導衣。着る者の魔力に呼応して、裾が燃え上がる。"],
    ["i_amulet", "不死鳥の羽根", "amulet", "hp", "燃えては蘇る不死鳥の羽根。持ち主にも、ほんの少しその力を分ける。"],
    ["i_ring", "炎精の契約輪", "ring", "thrift", "炎の精霊と契約した証の指輪。魔力の代わりに、炎が力を貸す。"],
    ["i_boots", "灼熱の疾走靴", "boots", "spd", "溶岩の上を駆け抜けるための靴。止まれば、靴底が溶ける。"],
    ["i_bangle", "鍛冶神の腕輪", "bangle", "atk", "神の鍛冶師が槌を握る時にはめていた腕輪。"],
    ["i_earring", "熾火の耳飾り", "earring", "mp", "消えない熾火を閉じ込めた耳飾り。寒い夜には、ありがたい。"],
    ["i_brooch", "火山石の徽章", "brooch", "guard", "大火口の底で見つかった石の徽章。どんな熱にも、びくともしない。"],
    ["i_curse_sword", "黒焔の呪剣", "sword", "atk>frail", "黒き炎に魂を焼かれる魔剣。焼かれるのは、敵だけではない。"],
    ["i_curse_bangle", "狂戦士の腕輪", "bangle", "crit>wither", "理性と引き換えに、すべての一撃を急所へ導く腕輪。"],
    ["i_curse_robe", "焚刑の魔女衣", "robe", "mag>wither", "火あぶりにされた魔女の衣。恨みの炎が、魔力に変わる。"],
  ],
  marina: [
    ["m_sword", "海賊王のカトラス", "sword", "crit", "七つの海を荒らした海賊王の剣。持ち主を、必ず宝の在り処へ導く。"],
    ["m_greatsword", "大渦の大剣", "greatsword", "atk", "振るえば大渦が生まれる。巻き込まれた者は、二度と浮かばない。"],
    ["m_dagger", "人魚の涙刃", "dagger", "steal", "人魚の涙を鍛えた短剣。斬られた者は、なぜか泣きたくなる。"],
    ["m_axe", "難破船の錨斧", "axe", "atk", "沈んだ船の錨を斧に打ち直した。重いが、決して流されない。"],
    ["m_spear", "海神の三叉槍", "spear", "crit", "海神が手放した三叉の槍。突いた場所から、潮が満ちてくる。"],
    ["m_katana", "濡れ刀・時雨", "katana", "spd", "刃がいつも濡れている刀。拭いても拭いても、雫が落ちる。"],
    ["m_bow", "幽霊船の砲弓", "bow", "atk", "幽霊船の甲板で見つかった弓。弦を引くと、遠くで大砲の音がする。"],
    ["m_claw", "深海魚の顎", "claw", "steal", "光の届かない深海に棲む魚の顎。噛んだら、離さない。"],
    ["m_scythe", "溺死者の大鎌", "scythe", "crit", "海に沈んだ者たちを刈り集める鎌。刃から、いつも海水が滴る。"],
    ["m_mace", "珊瑚の聖槌", "mace", "heal", "生きた珊瑚で作られた槌。打たれた傷は、珊瑚のように再生する。"],
    ["m_staff", "潮騒の杖", "staff", "thrift", "耳を当てると波の音がする杖。魔力は、潮のように満ちては引く。"],
    ["m_rod", "深淵を覗く杖", "rod", "mag", "海の底の底を覗くための杖。深淵もまた、こちらを覗いている。"],
    ["m_buckler", "巨大貝の盾", "buckler", "guard", "大海溝の巨大な貝の殻。開けると、中に真珠が残っていた。"],
    ["m_shield", "リヴァイアサンの鱗盾", "shield", "hp", "海の怪物の鱗で作った大盾。持ち主を、怪物ごと守っているようだ。"],
    ["m_helm", "潜水士の亡霊兜", "helm", "def", "古代都市に潜ったまま戻らなかった潜水士の兜。中から、まだ泡が出る。"],
    ["m_hat", "船長の三角帽", "hat", "mp", "海賊船長の帽子。かぶった者は、なぜか語尾が荒くなる。"],
    ["m_hood", "濡れ鴉の頭巾", "hood", "spd", "濡れた鴉のように黒い頭巾。雨の夜に、音もなく動ける。"],
    ["m_plate", "古代都市の守護鎧", "plate", "def", "沈んだ古代都市を守っていた番人の鎧。都市が沈んでも、役目は終わらない。"],
    ["m_garb", "海賊の黒コート", "garb", "crit", "黒く染めた海賊のコート。肩に止まる鸚鵡は、別売りだ。"],
    ["m_robe", "海魔の法衣", "robe", "mag", "海の魔物を従えた魔導士の衣。裾から、ときどき触手が覗く。"],
    ["m_amulet", "海神の涙", "amulet", "heal", "海神が流した涙の結晶。持つ者の傷を、波のように洗い流す。"],
    ["m_ring", "溺れた乙女の指輪", "ring", "mag", "海に身を投げた乙女の指輪。今も、誰かの指を探している。"],
    ["m_boots", "波乗りの靴", "boots", "spd", "波の上を歩ける靴。陸の上では、なぜか少し酔う。"],
    ["m_bangle", "錨鎖の腕輪", "bangle", "atk", "錨の鎖を巻きつけた腕輪。重さは、そのまま拳の重さになる。"],
    ["m_earring", "海鳴りの耳飾り", "earring", "mp", "遠い海鳴りが聞こえる耳飾り。嵐の前には、うるさくなる。"],
    ["m_brooch", "羅針盤のブローチ", "brooch", "guard", "針が北ではなく、危険を指す羅針盤。指す方へ行かなければいい。"],
    ["m_curse_dagger", "幽霊船長の呪刃", "dagger", "crit>wither", "幽霊船長の短剣。持ち主は強くなるが、少しずつ透けていく。"],
    ["m_curse_earring", "セイレーンの耳飾り", "earring", "mag>sloth", "セイレーンの歌が聞こえる耳飾り。魔力は満ちるが、足は海へ向かう。"],
    ["m_curse_helm", "溺死者の兜", "helm", "def>drain", "海底で見つかった兜。かぶると守りは固いが、息苦しい。"],
  ],
  celesta: [
    ["c_sword", "神殺しの聖剣", "sword", "crit", "神を斬るために鍛えられた剣。斬られた神の名は、どこにも残っていない。"],
    ["c_greatsword", "堕天使の大剣", "greatsword", "atk", "天を追われた天使が、最後まで手放さなかった剣。"],
    ["c_dagger", "天の羽の短剣", "dagger", "spd", "天使の羽根のように軽い短剣。振るうたび、白い羽が舞う。"],
    ["c_axe", "雷神の戦斧", "axe", "crit", "雷鳴の尖塔に突き立っていた斧。抜いた瞬間、空が鳴った。"],
    ["c_spear", "天穿つ聖槍", "spear", "atk", "天を穿つために投げられた槍。空にはまだ、その穴が残っている。"],
    ["c_katana", "天翔刀・雲切", "katana", "spd", "雲を斬って空を翔ける刀。斬った雲は、二度と雨を降らせない。"],
    ["c_bow", "熾天使の弓", "bow", "crit", "熾天使が地上を射るための弓。光の矢は、影の中まで追いかける。"],
    ["c_claw", "グリフォンの爪", "claw", "steal", "天空を統べた神獣の爪。掴んだものは、空へ連れ去る。"],
    ["c_scythe", "審判の大鎌", "scythe", "steal", "最後の審判で魂を刈るための鎌。刈られた魂は、天へも地へも行けない。"],
    ["c_mace", "天使長の錫杖", "mace", "heal", "天使長が祈りに使った錫杖。打たれた者の傷も、祈りも癒える。"],
    ["c_staff", "雲上の杖", "staff", "thrift", "雲の上で育つ樹の枝。魔力は、雲のように湧いてくる。"],
    ["c_rod", "天球儀の杖", "rod", "mag", "天球儀を戴いた杖。星々の運行を、ほんの少しだけ動かせる。"],
    ["c_buckler", "光輪の盾", "buckler", "guard", "天使の光輪を盾にしたもの。真ん中が、空いている。"],
    ["c_shield", "天空宮殿の門扉", "shield", "def", "天空宮殿の門を外して盾にした。宮殿の主は、まだ怒っている。"],
    ["c_helm", "堕天の冠兜", "helm", "hp", "堕ちた天使の冠を兜にしたもの。かぶると、少し後悔したくなる。"],
    ["c_hat", "星読みの尖帽", "hat", "mp", "星を読む賢者の帽子。先端に、小さな星がひとつ留まっている。"],
    ["c_hood", "風の精霊の頭巾", "hood", "spd", "風の精霊が編んだ頭巾。かぶれば、風と同じ速さで走れる。"],
    ["c_plate", "天騎士の聖鎧", "plate", "def", "天を守る騎士の鎧。地上の汚れは、ひとつも付かない。"],
    ["c_garb", "白翼の軽鎧", "garb", "hp", "背に白い翼の飾りがある軽鎧。飛べはしないが、落ちても平気だ。"],
    ["c_robe", "背徳の聖衣", "robe", "mag", "聖職者が禁忌を犯した夜に着ていた衣。白いのに、なぜか黒く見える。"],
    ["c_amulet", "天使の羽根飾り", "amulet", "heal", "天使が落とした一枚の羽根。持つ者を、そっと癒やす。"],
    ["c_ring", "神託の指輪", "ring", "crit", "神の声を聞くための指輪。聞こえるのは、だいたい敵の弱点だ。"],
    ["c_boots", "雲渡りの靴", "boots", "spd", "雲の上を歩ける靴。下を見なければ、落ちることはない。"],
    ["c_bangle", "雷帝の腕輪", "bangle", "atk", "雷を統べた帝王の腕輪。拳を握ると、小さな雷が走る。"],
    ["c_earring", "天上の鈴", "earring", "thrift", "天上の楽園で鳴る鈴の耳飾り。その音は、魔力を澄ませる。"],
    ["c_brooch", "聖印のブローチ", "brooch", "guard", "聖なる紋章のブローチ。邪なものは、近づくことすらできない。"],
    ["c_curse_sword", "堕天の魔剣《ルシフェル》", "sword", "atk>frail", "最も美しかった天使が堕ちる時に握っていた剣。光と引き換えに、闇を力に変える。"],
    ["c_curse_ring", "禁断の果実の指輪", "ring", "mag>wither", "禁断の果実をかたどった指輪。知恵を得る代わりに、楽園を失う。"],
    ["c_curse_garb", "黒き翼の外套", "garb", "spd>frail", "黒く染まった翼の外套。速さを得た代わりに、守りを失った。"],
  ],
  abyss: [
    ["a_sword", "終焉剣《ラグナロク》", "sword", "crit", "世界の終わりを告げる剣。抜かれた時、物語もまた終わる。"],
    ["a_greatsword", "虚無の大剣", "greatsword", "atk", "何も斬れない剣。斬られた者は、最初から存在しなかったことになる。"],
    ["a_dagger", "深淵の牙", "dagger", "steal", "深淵に棲むものの牙。刺されたことに、誰も気づかない。"],
    ["a_axe", "混沌の戦斧", "axe", "crit", "形の定まらない斧。見るたびに、刃の数が違う。"],
    ["a_spear", "奈落の槍", "spear", "atk", "奈落の底まで届くという槍。投げても、必ず手元に戻ってくる。"],
    ["a_katana", "冥刀・無明", "katana", "spd", "光を一切映さない刀。斬った瞬間すら、誰にも見えない。"],
    ["a_bow", "星喰いの弓", "bow", "crit", "夜空の星を射落とした弓。アビスの空に星がないのは、そのせいだ。"],
    ["a_claw", "混沌獣の爪", "claw", "steal", "形を持たない獣の爪。引き裂かれた傷は、形を失う。"],
    ["a_scythe", "死神の大鎌《タナトス》", "scythe", "atk", "死そのものが振るう鎌。持ち主の名を、いつか刈りに来る。"],
    ["a_mace", "虚ろな聖遺物", "mace", "heal", "中身を失った聖遺物の槌。空っぽなのに、祈りだけが詰まっている。"],
    ["a_staff", "終わりなき杖", "staff", "thrift", "終わりのない詠唱を続ける杖。持ち主が眠っても、杖は詠い続ける。"],
    ["a_rod", "深淵の王杖", "rod", "mag", "深淵を統べる王の杖。掲げれば、闇がひざまずく。"],
    ["a_buckler", "虚ろの小盾", "buckler", "guard", "中心に小さな虚無が開いた盾。攻撃は、そこへ吸い込まれて消える。"],
    ["a_shield", "堕ちた城塞の大門", "shield", "def", "堕ちた城塞の最後の門。城は堕ちても、この門だけは破られなかった。"],
    ["a_helm", "深淵の王冠兜", "helm", "hp", "深淵の王がかぶっていた冠。かぶった者を、次の王に選ぶ。"],
    ["a_hat", "混沌の魔導帽", "hat", "mp", "かぶるたびに形が変わる帽子。中身の魔導士の形も、少し変わる。"],
    ["a_hood", "虚無の頭巾", "hood", "spd", "顔の部分が真っ暗な頭巾。覗き込んでも、何も見えない。"],
    ["a_plate", "終焉の黒鎧", "plate", "def", "世界の終わりに、最後まで立っていた戦士の鎧。"],
    ["a_garb", "影の外套", "garb", "crit", "影でできた外套。脱いでも、足元にずっとついてくる。"],
    ["a_robe", "虚空の法衣", "robe", "mag", "虚空を織り上げた法衣。着た者の輪郭が、闇に溶ける。"],
    ["a_amulet", "深淵の心臓", "amulet", "hp", "深淵の心臓と呼ばれる宝石。今も、ゆっくりと脈を打っている。"],
    ["a_ring", "終わりの指輪", "ring", "mag", "すべての物語の、最後のページに描かれている指輪。"],
    ["a_boots", "奈落渡りの靴", "boots", "spd", "奈落の上を渡るための靴。一歩でも踏み外せば、終わりだ。"],
    ["a_bangle", "虚無を握る腕輪", "bangle", "atk", "虚無を握りしめた者の腕輪。握った拳には、何も残らない。"],
    ["a_earring", "囁く深淵の耳飾り", "earring", "thrift", "深淵の声が聞こえる耳飾り。声は、いつも優しい。それが怖い。"],
    ["a_brooch", "闇夜の紋章", "brooch", "guard", "光のない夜を象った紋章。闇の中でこそ、持ち主を守る。"],
    ["a_curse_scythe", "魂喰らいの大鎌", "scythe", "atk>wither", "魂を喰らうほど鋭くなる鎌。最後に喰らうのは、持ち主の魂だ。"],
    ["a_curse_amulet", "深淵の瞳", "amulet", "crit>frail", "深淵を覗き返す瞳の首飾り。すべての弱点が見えるが、自分の弱さも晒される。"],
    ["a_curse_plate", "呪縛の鎧", "plate", "def>sloth", "着た者を決して離さない鎧。守りは完璧だが、二度と自由には動けない。"],
  ],
};

// 定義から装備の一覧を作る。stats は種類の重み×倍率（ITEM_BASES と同じ形）、effect は { stats, passives, desc }
const UNIQUE_ITEMS = [];
REGIONS.forEach((region, index) => {
  const tier = index + 1;
  for (const [key, name, typeKey, effectKey, flavor] of UNIQUE_DEFS[region.id] || []) {
    const type = getItemType(typeKey);
    const cursed = effectKey.includes(">");
    let effect;
    if (cursed) {
      const [boonKey, curseKey] = effectKey.split(">");
      const boon = CURSE_BOONS[boonKey](tier), curse = CURSES[curseKey](tier);
      effect = {
        stats: Object.assign({}, boon.stats, curse.stats),
        passives: Object.assign({}, boon.passives, curse.passives),
        desc: `${boon.desc}／呪い: ${curse.desc}`,
      };
    } else {
      effect = UNIQUE_EFFECTS[effectKey](tier);
    }
    const mult = cursed ? CURSED_STAT_MULT : UNIQUE_STAT_MULT;
    const stats = {};
    for (const [k, w] of Object.entries(type.stats)) stats[k] = w * mult;
    UNIQUE_ITEMS.push({
      key, name, typeName: type.name, slot: type.slot, type: type.key, series: null, hands: type.hands || 1, stats,
      unique: true, cursed, region: region.id, effect, flavor,
    });
  }
});
const UNIQUE_BY_KEY = Object.fromEntries(UNIQUE_ITEMS.map((u) => [u.key, u]));
function getUniqueItem(key) { return UNIQUE_BY_KEY[key] || null; }

// そのレベルのダンジョンがある地方（推奨Lvがそのレベル以下で一番奥のダンジョンの地方）
function regionForLevel(level) {
  let found = DUNGEONS[0].region;
  for (const d of DUNGEONS) if (d.level <= (level || 1)) found = d.region;
  return found;
}

// 名のある装備を1個抽選する（その地方の29種類から等確率。レア度はSR以上）。opts は rollItemDrop と同じ
function rollUniqueDrop(level, opts) {
  opts = opts || {};
  const region = regionForLevel(opts.regionLevel || level);
  const pool = UNIQUE_ITEMS.filter((u) => u.region === region);
  const from = RARITIES.findIndex((r) => r.key === UNIQUE_MIN_RARITY);
  const item = QPCore.rewards.rollItem(pool, RARITIES.slice(from), RNG, () => "item_" + itemSeq++,
    { level: level || 1, levelGrowth: ITEM_LEVEL_GROWTH });
  return addItemOptions(item, opts.mode);
}

// レア敵・ボスが追加で落とす装備（js/core/rewards.js の rollRareDrops から敵ごとに呼ぶ。落とさなければ null）
function rollSpecialDrop(level, enemy, opts) {
  if (enemy && enemy.isBoss) return RNG.chance(BOSS_UNIQUE_CHANCE) ? rollUniqueDrop(level, opts) : null;
  return RNG.chance(RARE_UNIQUE_CHANCE) ? rollUniqueDrop(level, opts) : rollItemDrop(level, RARE_DROP_MIN_RARITY, opts);
}

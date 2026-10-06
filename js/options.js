// ---------- 装備のオプション効果 ----------
// js/data.js・js/uniques.js の次に読み込む。ハード・エクストラモードで落ちた装備にだけ、ランダムなオプション効果が付く
// （ハードは1〜2個のある程度強い効果、エクストラは2〜3個のかなり強い効果。同じ効果は重ならない）。
// 装備には { key, value } の形で保存し、効果は js/core/equipment.js の setBonusTotals でセット効果と一緒に合計する。
//   flat: 能力値に固定値を足す（装備のレベルで伸びる）／ stats: 能力値の割合ボーナス／ passives: 会心率など／
//   expBonus・materialBonus: そのキャラがいるパーティの獲得EXP・強化石が増える（周回向け）
"use strict";

const OPTION_COUNTS = { hard: [1, 2], extra: [2, 3] };
// range: { hard: [最小, 最大], extra: [最小, 最大] }。flat は「重み×装備のレベルの倍率」に掛ける倍率、それ以外は割合
const ITEM_OPTIONS = [
  { key: "atk_flat", kind: "flat", stat: "atk", weight: 1.5, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "mag_flat", kind: "flat", stat: "mag", weight: 1.5, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "def_flat", kind: "flat", stat: "def", weight: 1.5, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "spd_flat", kind: "flat", stat: "spd", weight: 1, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "hp_flat", kind: "flat", stat: "hp", weight: 5, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "mp_flat", kind: "flat", stat: "mp", weight: 4, range: { hard: [1, 2], extra: [2.5, 4] } },
  { key: "atk_pct", kind: "stats", stat: "atk", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "mag_pct", kind: "stats", stat: "mag", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "def_pct", kind: "stats", stat: "def", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "spd_pct", kind: "stats", stat: "spd", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "hp_pct", kind: "stats", stat: "hp", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "mp_pct", kind: "stats", stat: "mp", range: { hard: [0.03, 0.06], extra: [0.07, 0.12] } },
  { key: "crit", kind: "passive", passive: "critBonus", label: "会心率", range: { hard: [0.02, 0.04], extra: [0.05, 0.08] } },
  { key: "lifesteal", kind: "passive", passive: "lifesteal", label: "吸収", range: { hard: [0.02, 0.03], extra: [0.04, 0.06] } },
  { key: "heal", kind: "passive", passive: "healBonus", label: "回復量", range: { hard: [0.05, 0.1], extra: [0.12, 0.2] } },
  { key: "guard", kind: "mult", passive: "dmgTakenMult", label: "被ダメージ", range: { hard: [0.02, 0.04], extra: [0.05, 0.08] } },
  { key: "thrift", kind: "mult", passive: "mpCostMult", label: "消費MP", range: { hard: [0.04, 0.08], extra: [0.1, 0.15] } },
  { key: "exp", kind: "passive", passive: "expBonus", label: "パーティの獲得EXP", range: { hard: [0.05, 0.1], extra: [0.12, 0.2] } },
  { key: "material", kind: "passive", passive: "materialBonus", label: "パーティの強化石", range: { hard: [0.05, 0.1], extra: [0.12, 0.2] } },
];
const OPTION_BY_KEY = Object.fromEntries(ITEM_OPTIONS.map((o) => [o.key, o]));

// mode が "hard"・"extra" の時だけ、装備にオプション効果を付けて返す（それ以外はそのまま）
function addItemOptions(item, mode) {
  const counts = OPTION_COUNTS[mode];
  if (!item || !counts) return item;
  const n = counts[0] + (RNG.chance(0.5) ? counts[1] - counts[0] : 0);
  const pool = ITEM_OPTIONS.slice();
  const levelMult = QPCore.rewards.itemLevelMult(item.level, ITEM_LEVEL_GROWTH);
  item.options = [];
  for (let i = 0; i < n && pool.length; i++) {
    const def = pool.splice(Math.floor(RNG.float(0, pool.length)), 1)[0];
    const [lo, hi] = def.range[mode];
    const roll = RNG.float(lo, hi);
    // 割合は1%刻み（表示が読みやすいように）
    const value = def.kind === "flat" ? Math.max(1, Math.round(def.weight * levelMult * roll)) : Math.round(roll * 100) / 100;
    item.options.push({ key: def.key, value });
  }
  item.optionMode = mode;
  return item;
}

// オプション効果1つの中身（setBonusTotals に渡す形）: { flat, stats, passives }
function itemOptionEffect(opt) {
  const def = OPTION_BY_KEY[opt.key];
  if (!def) return {};
  if (def.kind === "flat") return { flat: { [def.stat]: opt.value } };
  if (def.kind === "stats") return { stats: { [def.stat]: opt.value } };
  if (def.kind === "mult") return { passives: { [def.passive]: 1 - opt.value } };
  return { passives: { [def.passive]: opt.value } };
}

// 「ATK+23」「会心率+3%」「被ダメージ-4%」の形の説明
function itemOptionText(opt) {
  const def = OPTION_BY_KEY[opt.key];
  if (!def) return "";
  const pctText = (v) => `${Math.round(v * 100)}%`;
  if (def.kind === "flat") return `${STAT_LABELS[def.stat]}+${opt.value}`;
  if (def.kind === "stats") return `${STAT_LABELS[def.stat]}+${pctText(opt.value)}`;
  if (def.kind === "mult") return `${def.label}-${pctText(opt.value)}`;
  return `${def.label}+${pctText(opt.value)}`;
}

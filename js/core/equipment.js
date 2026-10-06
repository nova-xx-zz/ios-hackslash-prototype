// ---------- 装備の計算（equipment） ----------
// 装備の能力値（強化値込み）・どの枠に付けられるか（ジョブの装備制限・両手武器・二刀流・装飾品の枠数）・
// シリーズのセット効果・旧セーブの装備の移し替えをまとめる。表（data.js の ITEM_TYPES など）は引数で受け取り、
// ゲームの状態は変更しない（normalizeEquip だけは渡された装備の枠を直接そろえる）。
//
// 装備の枠（キャラの equip のキー）: main（右手）・off（左手）・head（頭）・body（体）・acc1〜acc3（装飾品）
// 装備の部位（アイテムの slot）: weapon（武器）・shield（盾）・head・body・accessory
(function (root) {
  "use strict";

  const POSITIONS = ["main", "off", "head", "body", "acc1", "acc2", "acc3"];
  const ACC_POSITIONS = ["acc1", "acc2", "acc3"];
  const MAX_ACCESSORY_SLOTS = ACC_POSITIONS.length;

  function emptyEquip() {
    const e = {};
    for (const p of POSITIONS) e[p] = null;
    return e;
  }

  // アイテムの元の能力値 { atk: 5, spd: 2 }。旧形式（stat と value を1つだけ持つ）にも対応する
  function baseStatsOf(item) {
    if (item.stats) return item.stats;
    if (item.stat) return { [item.stat]: item.value || 0 };
    return {};
  }

  // 強化値込みの能力値。+1ごとにレア度に応じた固定量をceilで積み上げる（+1でも必ず変化が見える）。
  // 能力値が複数ある装備は、最初の能力値（主能力）を基準に、元の値の比率で他の能力値も伸ばす
  function itemStats(item, rarityMult) {
    const base = baseStatsOf(item);
    const keys = Object.keys(base);
    const out = {};
    if (keys.length === 0) return out;
    const primary = base[keys[0]] || 1;
    const plus = item.plus || 0;
    for (const k of keys) {
      const ratio = base[k] / primary;
      const bonus = plus > 0 ? Math.ceil(plus * (rarityMult || 1) * 0.08 * ratio) : 0;
      out[k] = Math.max(1, base[k] + bonus);
    }
    return out;
  }

  function primaryStat(item) {
    return Object.keys(baseStatsOf(item))[0] || null;
  }

  // ジョブの装備制限（profile: { weapons, shields, head, body, dualWield }）でこの部位・種類を持てるか
  function canUseItem(profile, item) {
    if (!profile || !item) return false;
    switch (item.slot) {
      case "weapon": return profile.weapons.includes(item.type);
      case "shield": return profile.shields.includes(item.type);
      case "head": return profile.head.includes(item.type);
      case "body": return profile.body.includes(item.type);
      case "accessory": return true;
      default: return false;
    }
  }

  // この枠にこのアイテムを付けられるか。equip: 今の装備（両手武器を持っているかを見る）、accSlots: 使える装飾品の枠数
  function canPlace(profile, item, position, equip, accSlots) {
    if (!canUseItem(profile, item)) return false;
    if (position === "main") return item.slot === "weapon";
    if (position === "off") {
      const main = equip && equip.main;
      if (main && main.hands === 2) return false; // 両手武器を持っている間は左手を使えない
      if (item.slot === "shield") return true;
      return item.slot === "weapon" && !!profile.dualWield && item.hands !== 2;
    }
    if (position === "head" || position === "body") return item.slot === position;
    const accIndex = ACC_POSITIONS.indexOf(position);
    if (accIndex >= 0) return item.slot === "accessory" && accIndex < (accSlots || 1);
    return false;
  }

  // このアイテムを付けられる枠の一覧（空いている枠を先に）
  function positionsFor(profile, item, equip, accSlots) {
    const all = POSITIONS.filter((p) => canPlace(profile, item, p, equip, accSlots));
    return all.sort((a, b) => (equip[a] ? 1 : 0) - (equip[b] ? 1 : 0));
  }

  // 付けられなくなった装備（転職・スキルの振り直し・両手武器との組み合わせ・旧セーブ）を外す。外したアイテムの配列を返す
  function normalizeEquip(equip, profile, accSlots) {
    const removed = [];
    for (const p of POSITIONS) {
      if (!(p in equip)) equip[p] = null;
      const item = equip[p];
      if (!item) continue;
      if (!canPlace(profile, item, p, equip, accSlots)) {
        removed.push(item);
        equip[p] = null;
      }
    }
    for (const k of Object.keys(equip)) {
      if (!POSITIONS.includes(k)) {
        if (equip[k]) removed.push(equip[k]);
        delete equip[k];
      }
    }
    return removed;
  }

  // シリーズごとの装備数（同じアイテムを2つ付けても枠ごとに数える）
  function seriesCounts(equip) {
    const counts = {};
    for (const p of POSITIONS) {
      const item = equip && equip[p];
      if (item && item.series) counts[item.series] = (counts[item.series] || 0) + 1;
    }
    return counts;
  }

  // セット効果の合計。seriesTable: data.js の ITEM_SERIES。
  // 戻り値: { stats: { atk: 0.05, ... }（能力値の割合ボーナス）, passives: { critBonus, lifesteal, healBonus, dmgTakenMult, mpCostMult },
  //          active: [{ series, count, bonuses: [{ count, desc, active }] }]（画面表示用。2個以上付けているシリーズ） }
  function setBonusTotals(equip, seriesTable) {
    const stats = {};
    const passives = { critBonus: 0, lifesteal: 0, healBonus: 0, dmgTakenMult: 1, mpCostMult: 1 };
    const active = [];
    const counts = seriesCounts(equip);
    for (const series of seriesTable || []) {
      const count = counts[series.key] || 0;
      if (count < 2) continue;
      const bonuses = [];
      for (const b of series.setBonus || []) {
        const on = count >= b.count;
        bonuses.push({ count: b.count, desc: b.desc, active: on });
        if (!on) continue;
        for (const [k, v] of Object.entries(b.stats || {})) stats[k] = (stats[k] || 0) + v;
        for (const [k, v] of Object.entries(b.passives || {})) {
          if (k === "dmgTakenMult" || k === "mpCostMult") passives[k] *= v;
          else passives[k] = (passives[k] || 0) + v;
        }
      }
      active.push({ series, count, bonuses });
    }
    return { stats, passives, active };
  }

  // ---------- 旧セーブの移し替え ----------
  // 旧形式の装備枠 { weapon, armor, accessory } を新しい枠に移す（すでに新しい形なら何もしない）
  function migrateEquip(equip) {
    if (!equip || typeof equip !== "object") return emptyEquip();
    const out = emptyEquip();
    for (const p of POSITIONS) if (equip[p]) out[p] = equip[p];
    if (equip.weapon) out.main = out.main || equip.weapon;
    if (equip.armor) out.body = out.body || equip.armor;
    if (equip.accessory) out.acc1 = out.acc1 || equip.accessory;
    return out;
  }

  // 旧形式のアイテム（stat・value を1つだけ持つ8種類）を、同じ種類の新しいアイテムに移す。
  // 能力値・レア度・強化値・天井ゲージはそのまま引き継ぎ、名前は新しい種類の名前にする。legacyBases: { 旧base: 新しいbaseの定義 }
  function migrateItem(item, legacyBases) {
    if (!item || item.stats) return item;
    const oldBase = item.base || null;
    const def = legacyBases[oldBase] || Object.values(legacyBases).find((b) => b.legacyStat === item.stat && b.legacySlot === item.slot);
    if (!def) return item;
    item.stats = { [item.stat]: item.value || 0 };
    item.name = def.name;
    item.base = def.key;
    item.type = def.type;
    item.series = def.series;
    item.slot = def.slot;
    item.hands = def.hands;
    delete item.stat;
    delete item.value;
    return item;
  }

  const exported = {
    POSITIONS, ACC_POSITIONS, MAX_ACCESSORY_SLOTS, emptyEquip, baseStatsOf, itemStats, primaryStat,
    canUseItem, canPlace, positionsFor, normalizeEquip, seriesCounts, setBonusTotals, migrateEquip, migrateItem,
  };
  root.QPCore = root.QPCore || {};
  root.QPCore.equipment = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

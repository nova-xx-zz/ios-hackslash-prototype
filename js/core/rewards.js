// ---------- 報酬の抽選と確定（rewards） ----------
// ドロップ・道中イベント・テイム・自動分解の計算を、通常プレイとオフライン精算の両方から共通で使う
// （以前は両者で計算が食い違っていたため、1か所にまとめている）。
// ゲームの状態は変更せず、結果だけを返す（反映はgame.js側）。rules は js/data.js の REWARD_RULES を渡す。
(function (root) {
  "use strict";

  // 重み付き抽選でレア度を1つ選ぶ
  function rollRarity(rarities, rng) {
    const total = rarities.reduce((s, r) => s + r.weight, 0);
    let roll = rng.float(0, total);
    for (const r of rarities) {
      if (roll < r.weight) return r;
      roll -= r.weight;
    }
    return rarities[0];
  }

  function createItem(base, rarity, id) {
    return {
      id,
      name: `${rarity.name}の${base.name}`,
      slot: base.slot,
      stat: base.stat,
      value: Math.round(base.base * rarity.mult),
      rarity: rarity.key,
      rarityColor: rarity.color,
      materialValue: rarity.material,
      plus: 0,
    };
  }

  // 装備を1個抽選する。nextId: 新しいアイテムIDを返す関数
  function rollItem(itemBases, rarities, rng, nextId) {
    const base = rng.pick(itemBases);
    const rarity = rollRarity(rarities, rng);
    return createItem(base, rarity, nextId());
  }

  // 1戦闘に勝ったときのドロップ（基本1個＋確率で追加1個）。rollOne: 装備を1個抽選する関数
  function rollBattleDrops(rules, rollOne, rng) {
    const drops = [rollOne()];
    if (rng.chance(rules.extraDropChance)) drops.push(rollOne());
    return drops;
  }

  // 戦闘と戦闘の間に起きる道中イベントの種類を抽選する（起きなければnull）
  function rollEventKind(rules, rng) {
    if (!rng.chance(rules.eventChance)) return null;
    const total = rules.events.reduce((s, e) => s + e.weight, 0);
    let roll = rng.float(0, total);
    for (const e of rules.events) {
      if (roll < e.weight) return e.kind;
      roll -= e.weight;
    }
    return rules.events[rules.events.length - 1].kind;
  }

  // 宝箱の中身（空っぽならnull）
  function rollTreasure(rules, rollOne, rng) {
    return rng.chance(rules.treasureEmptyChance) ? null : rollOne();
  }

  // 踏破後のテイム判定。倒したテイム可能な敵から1体を選んで成功判定する（候補が無ければnull）
  // tameChanceOf: 敵キーからテイム成功率を返す関数
  function rollTame(candidateKeys, tameChanceOf, rng) {
    if (candidateKeys.length === 0) return null;
    const key = rng.pick(candidateKeys);
    return { key, success: rng.chance(tameChanceOf(key)) };
  }

  // 踏破して持ち帰ったドロップを、自動分解の設定に従って所持品と強化石に振り分ける
  // disassemble: { enabled, rarities: Set<レア度キー> }
  function settleDrops(items, disassemble) {
    const kept = [];
    let materialGained = 0;
    let disassembled = 0;
    for (const item of items) {
      if (disassemble.enabled && disassemble.rarities.has(item.rarity)) {
        materialGained += item.materialValue;
        disassembled += 1;
      } else {
        kept.push(item);
      }
    }
    return { kept, materialGained, disassembled };
  }

  // 1戦闘で得るEXP（倒した敵のEXPの合計）と、種族補正をかけた各キャラの獲得量
  function battleExp(enemies) { return enemies.reduce((s, e) => s + e.exp, 0); }
  function expForMember(exp, expMult) { return Math.round(exp * expMult); }

  const exported = {
    rollRarity, createItem, rollItem, rollBattleDrops, rollEventKind, rollTreasure, rollTame,
    settleDrops, battleExp, expForMember,
  };
  root.QPCore = root.QPCore || {};
  root.QPCore.rewards = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

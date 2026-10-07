// ---------- 所持品まわり（model/inventory） ----------
// 装備の付け外し・おまかせ装備・強化石・装備強化（通常／確定強化石／天井）・ドロップの受け取り（自動分解）・
// モンスター合成など、所持品と強化石に関するルールをまとめる。画面には依存しない。
// 判定そのものは js/core/enhance.js・js/core/rewards.js で行い、ここでは結果を状態に反映する。
//   createInventory({ data, state, roster, rng, isFeatureEnabled, onMaterialChange })
//     data: { ENHANCE_RULES, ENHANCE_MAX_PLUS, RARITIES, fusionBaseExp, FUSION_SAME_RACE_MULT }、state: js/model/save.js の状態、
//     roster: js/model/roster.js の createRoster の戻り値（computeStats・itemScore・equipProfile・accessorySlots・gainExp・totalExpInvested を使う）、
//     onMaterialChange(material): 強化石が変わった時に呼ぶ（game.js が旧キーへの互換ミラーを書く）
(function (root) {
  "use strict";
  const enhance = (root.QPCore && root.QPCore.enhance) || (typeof require === "function" ? require("../core/enhance.js") : null);
  const rewards = (root.QPCore && root.QPCore.rewards) || (typeof require === "function" ? require("../core/rewards.js") : null);
  const equipment = (root.QPCore && root.QPCore.equipment) || (typeof require === "function" ? require("../core/equipment.js") : null);
  const stats = (root.QPCore && root.QPCore.stats) || (typeof require === "function" ? require("../core/stats.js") : null);

  // モンスター合成で、素材が積み上げてきたEXPのうち対象に還元する割合
  const FUSION_EXP_RATE = 0.5;

  function createInventory(deps) {
    const S = deps.state;
    const R = deps.roster;
    const { ENHANCE_RULES, ENHANCE_MAX_PLUS, fusionBaseExp } = deps.data;
    const sameRaceMult = deps.data.FUSION_SAME_RACE_MULT || 1;
    const isFeatureEnabled = deps.isFeatureEnabled || (() => false);
    const onMaterialChange = deps.onMaterialChange || (() => {});

    // ---------- 装備 ----------
    function clampVitals(c) {
      const s = R.computeStats(c);
      c.hp = Math.min(c.hp, s.maxHp);
      c.mp = Math.min(c.mp, s.maxMp);
    }

    // 所持品のアイテムを付ける。position（"main"・"off"・"head"・"body"・"acc1"〜"acc3"）を省略すると、
    // 付けられる枠のうち空いている枠（無ければ最初の枠）に付ける。付けられなければ false。
    // 元の装備は所持品に戻す。両手武器を右手に持つ時は左手の装備も外す
    function equipItem(c, item, position) {
      const profile = R.equipProfile(c);
      const acc = R.accessorySlots(c);
      const pos = position || equipment.positionsFor(profile, item, c.equip, acc)[0];
      if (!pos || !equipment.canPlace(profile, item, pos, c.equip, acc)) return false;
      const idx = S.inventory.indexOf(item);
      if (idx >= 0) S.inventory.splice(idx, 1);
      const old = c.equip[pos];
      if (old) S.inventory.push(old);
      c.equip[pos] = item;
      if (pos === "main" && item.hands === 2 && c.equip.off) {
        S.inventory.push(c.equip.off);
        c.equip.off = null;
      }
      clampVitals(c);
      return true;
    }

    function unequipSlot(c, position) {
      const item = c.equip[position];
      if (!item) return;
      S.inventory.push(item);
      c.equip[position] = null;
      clampVitals(c);
    }

    // 付けられなくなった装備（転職で装備制限や装飾品の枠数が変わった時など）を外して所持品に戻す。外した数を返す
    function normalizeCharEquip(c) {
      const removed = equipment.normalizeEquip(c.equip, R.equipProfile(c), R.accessorySlots(c));
      if (removed.length) {
        S.inventory.push(...removed);
        clampVitals(c);
      }
      return removed.length;
    }

    // おまかせ装備: 今の装備と所持品の中から、そのキャラにとって価値が最も高い組み合わせ（R.itemScore の合計）を付ける。
    // 両手武器1本と「片手武器＋左手（盾、二刀流なら片手武器）」は合計で比べる
    function autoEquip(c) {
      const profile = R.equipProfile(c);
      const acc = R.accessorySlots(c);
      const pool = S.inventory.slice();
      for (const p of equipment.POSITIONS) if (c.equip[p]) pool.push(c.equip[p]);
      // 呪いの装備はデメリットがあるので、おまかせでは選ばない（付けたままなら残す）
      const usable = pool.filter((it) => equipment.canUseItem(profile, it) && (!it.cursed || Object.values(c.equip).includes(it)));
      const score = (it) => (it ? R.itemScore(c, it) : 0);
      const best = (list) => list.reduce((a, b) => (score(b) > score(a) ? b : a), null);
      const chosen = equipment.emptyEquip();

      const weapons = usable.filter((it) => it.slot === "weapon");
      const oneHand = weapons.filter((it) => it.hands !== 2).sort((a, b) => score(b) - score(a));
      const twoHand = best(weapons.filter((it) => it.hands === 2));
      const mainOne = oneHand[0] || null;
      const offCandidates = usable.filter((it) => it.slot === "shield")
        .concat(profile.dualWield ? oneHand.slice(1) : []);
      const off = best(offCandidates);
      if (twoHand && score(twoHand) > score(mainOne) + score(off)) {
        chosen.main = twoHand;
      } else {
        chosen.main = mainOne;
        chosen.off = off;
      }
      chosen.head = best(usable.filter((it) => it.slot === "head"));
      chosen.body = best(usable.filter((it) => it.slot === "body"));
      const accessories = usable.filter((it) => it.slot === "accessory").sort((a, b) => score(b) - score(a));
      equipment.ACC_POSITIONS.forEach((p, i) => { chosen[p] = i < acc ? (accessories[i] || null) : null; });

      // 選ばなかった装備は所持品へ、選んだ装備は所持品から外す
      const picked = new Set(Object.values(chosen).filter(Boolean));
      const rest = pool.filter((it) => !picked.has(it));
      S.inventory.length = 0;
      S.inventory.push(...rest);
      for (const p of equipment.POSITIONS) c.equip[p] = chosen[p];
      clampVitals(c);
    }

    // ---------- 強化石・確定強化石 ----------
    function addMaterial(n) {
      S.material += n;
      onMaterialChange(S.material);
    }
    function guaranteedStoneTotal() { return S.guaranteedStones.free + S.guaranteedStones.paid; }

    // ---------- 装備強化 ----------
    function enhanceCost(item) { return enhance.cost(ENHANCE_RULES, item.rarity, item.plus); }
    function isMaxed(item) { return item.plus >= ENHANCE_MAX_PLUS; }
    function canEnhance(item) { return !!item && !isMaxed(item) && S.material >= enhanceCost(item); }
    function isPityReady(item) {
      return isFeatureEnabled("enhancePity") && (item.pity || 0) >= enhance.pityThreshold(ENHANCE_RULES, item.rarity, item.plus);
    }

    // 強化石で1回強化する。できなければnull。結果: { success, plus, pityHit, cost }
    function enhanceItem(item, rng) {
      if (!canEnhance(item)) return null;
      const result = enhance.attempt(ENHANCE_RULES, item, { rng: rng || deps.rng, pityEnabled: isFeatureEnabled("enhancePity") });
      addMaterial(-result.cost);
      item.plus = result.plus;
      item.pity = result.pity;
      return { success: result.success, plus: result.plus, pityHit: !!result.pityHit, cost: result.cost };
    }

    // 確定強化石で必ず+1する（通常の強化石は消費しない。消費は無償分から）。できなければnull。結果: { plus, required }
    function enhanceWithGuaranteed(item) {
      if (!isFeatureEnabled("guaranteedStone") || !item || isMaxed(item)) return null;
      const result = enhance.useGuaranteed(ENHANCE_RULES, item, S.guaranteedStones);
      if (!result.ok) return null;
      S.guaranteedStones = result.stones;
      item.plus = result.plus;
      item.pity = result.pity;
      return { plus: result.plus, required: result.required };
    }

    // ---------- ドロップの受け取り ----------
    // 持ち帰ったドロップを、自動分解の設定（filter: { enabled, rarities }）に従って所持品と強化石に振り分ける。
    // 結果: js/core/rewards.js の settleDrops と同じ { kept, disassembled, materialGained }
    // materialMult: 強化石の倍率（オプション効果「パーティの強化石」。省略時1）
    function receiveDrops(drops, filter, materialMult) {
      const settled = rewards.settleDrops(drops, filter);
      if (materialMult && materialMult !== 1) settled.materialGained = Math.round(settled.materialGained * materialMult);
      if (settled.materialGained > 0) addMaterial(settled.materialGained);
      S.inventory.push(...settled.kept);
      return settled;
    }

    // ---------- 手動の分解 ----------
    // 所持品（未装備）から選んだアイテムを強化石に変える。得られる量は自動分解と同じ（アイテムの materialValue。
    // 古いセーブで値が無ければレア度の既定値）。強化値（+）や天井ゲージは引き継がない。所持品に無いものは無視する。
    // 結果: { count, materialGained }
    function disassembleValue(item) {
      if (typeof item.materialValue === "number") return item.materialValue;
      const rarity = (deps.data.RARITIES || []).find((r) => r.key === item.rarity);
      return rarity ? rarity.material : 0;
    }
    function disassembleItems(items) {
      let count = 0, materialGained = 0;
      for (const item of items) {
        const idx = S.inventory.indexOf(item);
        if (idx < 0) continue;
        S.inventory.splice(idx, 1);
        count += 1;
        materialGained += disassembleValue(item);
      }
      if (materialGained > 0) addMaterial(materialGained);
      return { count, materialGained };
    }

    // ---------- モンスター合成 ----------
    // 合成できる素材: 対象以外の、どのチームにも編成していない、お気に入りにしていないモンスター
    function fusionCandidates(target) {
      return S.roster.filter((m) => m.isMonster && m.id !== target.id && m.team === null && !m.favorite);
    }
    // 素材1体のEXP＝種族の基本EXP（data.js の fusionBaseExp。テイム直後のLv1でも入る）＋積み上げたEXPの半分。
    // 合成先と同じ種族の素材は FUSION_SAME_RACE_MULT 倍
    function materialExp(target, m) {
      const base = fusionBaseExp ? fusionBaseExp(m.race) : 0;
      const exp = base + R.totalExpInvested(m) * FUSION_EXP_RATE;
      return Math.round(target && target.race === m.race ? exp * sameRaceMult : exp);
    }
    function fusionExpGain(target, materials) {
      return materials.reduce((s, m) => s + materialExp(target, m), 0);
    }
    // 素材を消して、積み上げてきたEXPの一部を対象に還元する。素材が装備していたアイテムは所持品に戻す。
    // 結果: { expGain, consumedNames, returnedItems, levelUps, abilityUnlocks }
    function fuse(target, materials) {
      const expGain = fusionExpGain(target, materials);
      // 同じ種族の素材からは、素材の方が高い個体値を少しずつ引き継ぐ（js/core/stats.js の inheritIvs）
      const ivRaised = new Set();
      if (deps.data.MONSTER_IV_RANGE) {
        for (const m of materials) {
          if (m.race !== target.race) continue;
          for (const k of stats.inheritIvs(target, m, deps.data.MONSTER_IV_INHERIT, deps.data.MONSTER_IV_RANGE)) ivRaised.add(k);
        }
      }
      const consumedNames = materials.map((m) => m.name);
      let returnedItems = 0;
      for (const m of materials) {
        for (const p of Object.keys(m.equip)) {
          if (m.equip[p]) { unequipSlot(m, p); returnedItems += 1; }
        }
        const idx = S.roster.findIndex((x) => x.id === m.id);
        if (idx !== -1) S.roster.splice(idx, 1);
      }
      const result = R.gainExp(target, expGain);
      return { expGain, consumedNames, returnedItems, levelUps: result.levelUps, abilityUnlocks: result.abilityUnlocks, ivRaised: [...ivRaised] };
    }

    // ---------- 仲間と別れる ----------
    // 別れられる仲間: どのチームにも編成していない、お気に入り（★）でない仲間（人間・モンスターとも）
    function releaseCandidates() {
      return S.roster.filter((c) => c.team === null && !c.favorite);
    }
    // 選んだ仲間をロスターから外す。装備していたアイテムは所持品に戻す。
    // 全員と別れるとセーブが読めなくなる（仲間0人のセーブは無効）ため、最低1人は残す。
    // 結果: { ok, reason（"none"・"lastMember"）, names, returnedItems }
    function releaseMembers(chars) {
      const targets = chars.filter((c) => S.roster.includes(c) && c.team === null && !c.favorite);
      if (targets.length === 0) return { ok: false, reason: "none" };
      if (S.roster.length - targets.length < 1) return { ok: false, reason: "lastMember" };
      let returnedItems = 0;
      for (const c of targets) {
        for (const p of Object.keys(c.equip)) {
          if (c.equip[p]) { unequipSlot(c, p); returnedItems += 1; }
        }
        S.roster.splice(S.roster.indexOf(c), 1);
      }
      return { ok: true, names: targets.map((c) => c.name), returnedItems };
    }

    return {
      releaseCandidates, releaseMembers,
      clampVitals, equipItem, unequipSlot, autoEquip, normalizeCharEquip,
      addMaterial, guaranteedStoneTotal,
      enhanceCost, isMaxed, canEnhance, isPityReady, enhanceItem, enhanceWithGuaranteed,
      receiveDrops, disassembleValue, disassembleItems,
      fusionCandidates, materialExp, fusionExpGain, fuse,
    };
  }

  const exported = { createInventory, FUSION_EXP_RATE };
  root.QPModel = root.QPModel || {};
  root.QPModel.inventory = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

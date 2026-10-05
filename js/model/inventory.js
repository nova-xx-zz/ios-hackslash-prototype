// ---------- 所持品まわり（model/inventory） ----------
// 装備の付け外し・おまかせ装備・強化石・装備強化（通常／確定強化石／天井）・ドロップの受け取り（自動分解）・
// モンスター合成など、所持品と強化石に関するルールをまとめる。画面には依存しない。
// 判定そのものは js/core/enhance.js・js/core/rewards.js で行い、ここでは結果を状態に反映する。
//   createInventory({ data, state, roster, rng, isFeatureEnabled, onMaterialChange })
//     data: { SLOTS, ENHANCE_RULES, ENHANCE_MAX_PLUS }、state: js/model/save.js の状態、
//     roster: js/model/roster.js の createRoster の戻り値（computeStats・itemScore・gainExp・totalExpInvested を使う）、
//     onMaterialChange(material): 強化石が変わった時に呼ぶ（game.js が旧キーへの互換ミラーを書く）
(function (root) {
  "use strict";
  const enhance = (root.QPCore && root.QPCore.enhance) || (typeof require === "function" ? require("../core/enhance.js") : null);
  const rewards = (root.QPCore && root.QPCore.rewards) || (typeof require === "function" ? require("../core/rewards.js") : null);

  // モンスター合成で、素材が積み上げてきたEXPのうち対象に還元する割合
  const FUSION_EXP_RATE = 0.5;

  function createInventory(deps) {
    const S = deps.state;
    const R = deps.roster;
    const { SLOTS, ENHANCE_RULES, ENHANCE_MAX_PLUS } = deps.data;
    const isFeatureEnabled = deps.isFeatureEnabled || (() => false);
    const onMaterialChange = deps.onMaterialChange || (() => {});

    // ---------- 装備 ----------
    function clampVitals(c) {
      const s = R.computeStats(c);
      c.hp = Math.min(c.hp, s.maxHp);
      c.mp = Math.min(c.mp, s.maxMp);
    }

    function equipItem(c, item) {
      const idx = S.inventory.indexOf(item);
      if (idx >= 0) S.inventory.splice(idx, 1);
      const old = c.equip[item.slot];
      if (old) S.inventory.push(old);
      c.equip[item.slot] = item;
      clampVitals(c);
    }

    function unequipSlot(c, slotKey) {
      const item = c.equip[slotKey];
      if (!item) return;
      S.inventory.push(item);
      c.equip[slotKey] = null;
      clampVitals(c);
    }

    // 部位ごとに、所持品の中でそのキャラにとって価値が最も高いもの（R.itemScore）を、今の装備より良ければ付ける
    function autoEquip(c) {
      for (const slot of SLOTS) {
        const candidates = S.inventory.filter((i) => i.slot === slot.key);
        const current = c.equip[slot.key];
        if (candidates.length === 0) continue;
        const best = candidates.reduce((a, b) => (R.itemScore(c, b) > R.itemScore(c, a) ? b : a));
        if (!current || R.itemScore(c, best) > R.itemScore(c, current)) equipItem(c, best);
      }
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
    function receiveDrops(drops, filter) {
      const settled = rewards.settleDrops(drops, filter);
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
    // 合成できる素材: 対象以外の、どのチームにも編成していないモンスター
    function fusionCandidates(target) {
      return S.roster.filter((m) => m.isMonster && m.id !== target.id && m.team === null);
    }
    function fusionExpGain(materials) {
      return materials.reduce((s, m) => s + Math.round(R.totalExpInvested(m) * FUSION_EXP_RATE), 0);
    }
    // 素材を消して、積み上げてきたEXPの一部を対象に還元する。素材が装備していたアイテムは所持品に戻す。
    // 結果: { expGain, consumedNames, returnedItems, levelUps, abilityUnlocks }
    function fuse(target, materials) {
      const expGain = fusionExpGain(materials);
      const consumedNames = materials.map((m) => m.name);
      let returnedItems = 0;
      for (const m of materials) {
        for (const slot of SLOTS) {
          if (m.equip[slot.key]) { unequipSlot(m, slot.key); returnedItems += 1; }
        }
        const idx = S.roster.findIndex((x) => x.id === m.id);
        if (idx !== -1) S.roster.splice(idx, 1);
      }
      const result = R.gainExp(target, expGain);
      return { expGain, consumedNames, returnedItems, levelUps: result.levelUps, abilityUnlocks: result.abilityUnlocks };
    }

    return {
      clampVitals, equipItem, unequipSlot, autoEquip,
      addMaterial, guaranteedStoneTotal,
      enhanceCost, isMaxed, canEnhance, isPityReady, enhanceItem, enhanceWithGuaranteed,
      receiveDrops, disassembleValue, disassembleItems,
      fusionCandidates, fusionExpGain, fuse,
    };
  }

  const exported = { createInventory, FUSION_EXP_RATE };
  root.QPModel = root.QPModel || {};
  root.QPModel.inventory = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

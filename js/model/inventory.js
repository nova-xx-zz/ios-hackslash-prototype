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
  const shopRules = (root.QPModel && root.QPModel.shop) || (typeof require === "function" ? require("./shop.js") : null);

  // モンスター合成で、素材が積み上げてきたEXPのうち対象に還元する割合
  const FUSION_EXP_RATE = 0.5;

  function createInventory(deps) {
    const S = deps.state;
    const R = deps.roster;
    const { ENHANCE_RULES, ENHANCE_MAX_PLUS, fusionBaseExp } = deps.data;
    const sameRaceMult = deps.data.FUSION_SAME_RACE_MULT || 1;
    const isFeatureEnabled = deps.isFeatureEnabled || (() => false);
    const onMaterialChange = deps.onMaterialChange || (() => {});
    const isTeamLocked = deps.isTeamLocked || (() => false);

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

    // ---------- 装備マイセット ----------
    // 現在着用している「実物のアイテムID」を利用可能な枠数まで保存。
    // 読込時に同一キャラの現在装備と所持品のみを対象とし、他のキャラから装備を奪わない。
    const equipmentSetCount = () => shopRules.presetSlotLimit(S.purchases);
    function savedSet(c, index) {
      if (!c || !Number.isInteger(index) || index < 0 || index >= equipmentSetCount()) return null;
      return (S.equipmentSets && S.equipmentSets[c.id] || [])[index] || null;
    }
    function saveEquipmentSet(c, index) {
      if (!c || !Number.isInteger(index) || index < 0 || index >= equipmentSetCount() ||
          (c.team !== null && isTeamLocked(c.team))) return { ok: false, reason: "locked" };
      const ids = Object.values(c.equip || {}).filter(Boolean).map((item) => item.id);
      if (!ids.length || ids.some((id) => typeof id !== "string" || !id)) return { ok: false, reason: "invalid" };
      if (new Set(ids).size !== ids.length) return { ok: false, reason: "duplicate" };
      if (!S.equipmentSets) S.equipmentSets = {};
      if (!Object.prototype.hasOwnProperty.call(S.equipmentSets, c.id)) {
        Object.defineProperty(S.equipmentSets, c.id, { value: [], enumerable: true, writable: true, configurable: true });
      }
      const previous = savedSet(c, index);
      const slots = {}, preview = {};
      for (const pos of equipment.POSITIONS) {
        const gear = c.equip[pos];
        slots[pos] = gear ? gear.id : null;
        if (gear) {
          preview[pos] = {
            name: String(gear.name || "名前不明の装備").slice(0, 80),
            rarity: String(gear.rarity || "").slice(0, 8),
            plus: Number.isSafeInteger(gear.plus) ? Math.max(0, Math.min(99, gear.plus)) : 0,
          };
        }
      }
      // 上書きしてもユーザーが付けたマイセット名は維持する。
      S.equipmentSets[c.id][index] = { slots, name: previous && previous.name || "", preview };
      return { ok: true };
    }
    function renameEquipmentSet(c, index, name) {
      if (!c || (c.team !== null && isTeamLocked(c.team))) return { ok: false, reason: "locked" };
      const set = savedSet(c, index);
      if (!set) return { ok: false, reason: "empty" };
      if (typeof name !== "string") return { ok: false, reason: "invalid" };
      const trimmed = name.replace(/[\x00-\x1f\x7f]/g, "").trim();
      if (!trimmed || Array.from(trimmed).length > 20) return { ok: false, reason: "invalid" };
      set.name = trimmed;
      return { ok: true };
    }
    function equipmentSetPreview(c, index) {
      const set = savedSet(c, index);
      if (!set) return [];
      const equipped = new Map();
      for (const owner of S.roster) {
        for (const gear of Object.values(owner.equip || {})) {
          if (gear && typeof gear.id === "string") equipped.set(gear.id, owner.id);
        }
      }
      const inventory = new Map(S.inventory.filter((gear) => gear && typeof gear.id === "string")
        .map((gear) => [gear.id, gear]));
      const equippedItems = new Map();
      for (const owner of S.roster) {
        for (const gear of Object.values(owner.equip || {})) {
          if (gear && typeof gear.id === "string") equippedItems.set(gear.id, gear);
        }
      }
      return equipment.POSITIONS.map((pos) => {
        const id = set.slots && set.slots[pos];
        if (!id) return { position: pos, empty: true, status: "empty" };
        const current = inventory.get(id) || equippedItems.get(id);
        const snapshot = set.preview && set.preview[pos];
        return {
          position: pos, empty: false,
          name: snapshot && snapshot.name || current && current.name || "装備名を確認できません",
          rarity: snapshot && snapshot.rarity || current && current.rarity || "",
          plus: snapshot && Number.isSafeInteger(snapshot.plus) ? snapshot.plus
            : current && Number.isSafeInteger(current.plus) ? current.plus : 0,
          status: inventory.has(id) ? "inventory" :
            equipped.get(id) === c.id ? "equipped" :
            equipped.has(id) ? "other" : "missing",
        };
      });
    }
    function deleteEquipmentSet(c, index) {
      if (c && c.team !== null && isTeamLocked(c.team)) return false;
      if (!savedSet(c, index)) return false;
      S.equipmentSets[c.id][index] = null;
      return true;
    }
    function applyEquipmentSet(c, index) {
      if (!c || (c.team !== null && isTeamLocked(c.team))) return { ok: false, reason: "locked" };
      const set = savedSet(c, index);
      if (!set) return { ok: false, reason: "empty" };
      const pool = S.inventory.concat(equipment.POSITIONS.map((p) => c.equip[p]).filter(Boolean));
      const byId = new Map();
      for (const item of pool) {
        if (typeof item.id !== "string" || !item.id) continue;
        // 同一IDが別アイテムに存在する場合、曖昧な装備を選ばず適用を拒否する。
        if (byId.has(item.id) && byId.get(item.id) !== item) byId.set(item.id, null);
        else if (!byId.has(item.id)) byId.set(item.id, item);
      }
      const next = equipment.emptyEquip();
      const chosen = new Set();
      for (const p of equipment.POSITIONS) {
        const id = set.slots[p];
        if (id == null) continue;
        const item = byId.get(id);
        if (!item || chosen.has(item)) {
          if (typeof id === "string" && id.startsWith("__ambiguous_equipment_set__")) {
            return { ok: false, reason: "ambiguous" };
          }
          if (byId.has(id) || chosen.has(item)) return { ok: false, reason: "duplicate" };
          const wornByOther = S.roster.some((other) => other !== c &&
            Object.values(other.equip || {}).some((gear) => gear && gear.id === id));
          return { ok: false, reason: wornByOther ? "taken" : "missing" };
        }
        next[p] = item;
        chosen.add(item);
      }
      const profile = R.equipProfile(c), acc = R.accessorySlots(c);
      for (const p of equipment.POSITIONS) {
        if (next[p] && !equipment.canPlace(profile, next[p], p, next, acc)) {
          return { ok: false, reason: "job" };
        }
      }
      // 全枠検証後に一括適用。途中で装備不可になっても所持品を失わない。
      S.inventory.length = 0;
      for (const item of pool) if (!chosen.has(item)) S.inventory.push(item);
      for (const p of equipment.POSITIONS) c.equip[p] = next[p];
      clampVitals(c);
      return { ok: true };
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

    // 一括強化は所持中の装備のみ。探索中チームの装備・セーブ外の偽アイテムは除外する。
    function canBatchEnhance(item) {
      if (!item || !Number.isSafeInteger(item.plus) || item.plus < 0 || item.plus >= ENHANCE_MAX_PLUS) return false;
      if (S.inventory.includes(item)) return true;
      for (const owner of S.roster) {
        if (!Object.values(owner.equip || {}).includes(item)) continue;
        return owner.team == null || !isTeamLocked(owner.team);
      }
      return false;
    }

    // 目標到達まで各+1の「天井まで失敗し続けた場合」の最大消費を計算する。
    // すでに貯めた天井ゲージは今の段だけに適用。成功後は毎段0から計算。
    // 天井OFFなら必ず成功する上限は無いためnull（実行は所持石がある間だけ）。
    function estimateEnhanceToTarget(item, targetPlus) {
      if (!item || !Number.isSafeInteger(item.plus) || item.plus < 0 ||
          !Number.isSafeInteger(targetPlus) || targetPlus <= item.plus || targetPlus > ENHANCE_MAX_PLUS) return null;
      if (!isFeatureEnabled("enhancePity")) return { targetPlus, maxStones: null };
      let maxStones = 0;
      for (let plus = item.plus; plus < targetPlus; plus++) {
        const perRoll = enhance.cost(ENHANCE_RULES, item.rarity, plus);
        const ceiling = enhance.pityThreshold(ENHANCE_RULES, item.rarity, plus);
        if (!Number.isSafeInteger(perRoll) || perRoll <= 0 || !Number.isSafeInteger(ceiling) || ceiling < 0) return null;
        const previousPity = plus === item.plus && Number.isFinite(item.pity)
          ? Math.max(0, item.pity) : 0;
        // 「天井ゲージに到達するまでの失敗」+「次の確定成功1回」が最悪ケース。
        const failRolls = Math.max(0, Math.ceil((ceiling - previousPity) / perRoll));
        maxStones += (failRolls + 1) * perRoll;
        if (!Number.isSafeInteger(maxStones)) return null;
      }
      return { targetPlus, maxStones };
    }

    // 上記の最大値を先払いしたり、天井分を無条件に消費したりはしない。
    // 通常の1回強化を反復し、成功したら即座に次の+段へ進む。
    // 目標に到達または所持石が次の抽選に足りない場合に止める。
    function enhanceToTarget(item, targetPlus) {
      if (!canBatchEnhance(item) || !estimateEnhanceToTarget(item, targetPlus)) return null;

      const fromPlus = item.plus;
      let attempts = 0, successes = 0, failures = 0, pityHits = 0, spent = 0;
      let reason = "material";
      while (item.plus < targetPlus) {
        if (!canBatchEnhance(item)) { reason = "invalid"; break; }
        const nextCost = enhanceCost(item);
        if (!Number.isSafeInteger(nextCost) || nextCost <= 0) { reason = "invalid"; break; }
        if (S.material < nextCost) { reason = "material"; break; }
        const result = enhanceItem(item);
        if (!result) { reason = "invalid"; break; }
        attempts++;
        spent += result.cost;
        if (result.success) {
          successes++;
          if (result.pityHit) pityHits++;
        } else failures++;
      }
      if (item.plus >= targetPlus) reason = "target";
      return { fromPlus, targetPlus, plus: item.plus, attempts, successes, failures,
        pityHits, spent, reason, remainingMaterial: S.material };
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

    // ロック（保護）: ロックした装備は手動の分解の候補に出さず、分解もしない。セーブには item.locked（真偽値）だけを足す
    function setLocked(item, locked) {
      if (!item) return;
      if (locked) item.locked = true; else delete item.locked;
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
    // 古いセーブで値が無ければレア度の既定値）。強化値（+）や天井ゲージは引き継がない。所持品に無いもの・ロックした装備は無視する。
    // 結果: { count, materialGained }
    function disassembleValue(item) {
      if (typeof item.materialValue === "number") return item.materialValue;
      const rarity = (deps.data.RARITIES || []).find((r) => r.key === item.rarity);
      return rarity ? rarity.material : 0;
    }
    function disassembleItems(items) {
      // 大量所持品の一括整理: 1件ずつindexOf→spliceするO(選択数×所持数)を避ける。
      // 選択と所持品が同じオブジェクトであること、配列の参照と残存順を維持する。
      // 万一同じオブジェクト参照が複数ある場合も、選ばれた件数だけ取り除く。
      const selected = new Map();
      for (const item of items) selected.set(item, (selected.get(item) || 0) + 1);
      let count = 0, materialGained = 0, write = 0;
      const inventory = S.inventory;
      for (let read = 0; read < inventory.length; read++) {
        const item = inventory[read];
        const remaining = selected.get(item) || 0;
        if (remaining > 0 && !item.locked) {
          selected.set(item, remaining - 1);
          count += 1;
          materialGained += disassembleValue(item);
        } else {
          inventory[write++] = item;
        }
      }
      inventory.length = write;
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
      savedSet, saveEquipmentSet, renameEquipmentSet, equipmentSetPreview, deleteEquipmentSet, applyEquipmentSet,
      addMaterial, guaranteedStoneTotal,
      enhanceCost, isMaxed, canEnhance, isPityReady, enhanceItem, enhanceWithGuaranteed,
      canBatchEnhance, estimateEnhanceToTarget, enhanceToTarget,
      setLocked, receiveDrops, disassembleValue, disassembleItems,
      fusionCandidates, materialExp, fusionExpGain, fuse,
    };
  }

  const exported = { createInventory, FUSION_EXP_RATE };
  root.QPModel = root.QPModel || {};
  root.QPModel.inventory = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

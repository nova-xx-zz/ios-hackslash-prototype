// js/data.js（ブラウザ用の<script>）をNode.jsで読み込み、テストやツールから数値の設定・データを参照できるようにする
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGameData() {
  const QPCore = {
    rng: require("../../js/core/rng.js"),
    enhance: require("../../js/core/enhance.js"),
    rewards: require("../../js/core/rewards.js"),
    offline: require("../../js/core/offline.js"),
    stats: require("../../js/core/stats.js"),
    battle: require("../../js/core/battle.js"),
    equipment: require("../../js/core/equipment.js"),
  };
  const context = vm.createContext({ QPCore, Math, console });
  // 名のある装備（js/uniques.js）は data.js の続きとして同じスクリプトで読む（ブラウザでも続けて読み込む）
  const code = fs.readFileSync(path.join(__dirname, "../../js/data.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "../../js/uniques.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "../../js/options.js"), "utf8");
  // data.js はトップレベルのconstで定義しているため、同じスクリプト内の最後の式で取り出す
  return vm.runInContext(code + `
;({ RNG, RARITIES, ITEM_BASES, DUNGEONS, ENHANCE_RULES, ENHANCE_MAX_PLUS, REWARD_RULES, FEATURE_FLAGS,
   JOBS, RACES, SLOTS, itemEffectiveValue, itemStats, rarityMult, EQUIP_POSITIONS, ITEM_TYPES, ITEM_SERIES, getItemType, getItemSeries, getItemBase, seriesForLevel,
   LEGACY_ITEM_BASES, ITEM_DROP_SLOT_WEIGHTS, UNIQUE_ITEMS, getUniqueItem, rollUniqueDrop, rollSpecialDrop, regionForLevel,
   UNIQUE_DROP_CHANCE, RARE_UNIQUE_CHANCE, DUNGEON_MODES, getDungeonMode, getModeDungeon, powerForLevel,
   ITEM_OPTIONS, OPTION_COUNTS, addItemOptions, itemOptionEffect, itemOptionText, rarityColor, BOSS_UNIQUE_CHANCE, UNIQUE_STAT_MULT, CURSED_STAT_MULT, JOB_EQUIP, MONSTER_EQUIP, MONSTER_ACCESSORY_SLOT_LEVELS, EXCLUSIVE_TREES, jobTag, getExclusiveTreeByTag, getGeneralTree, GENERAL_SLOTS,
   buildEncounter, getEnemyTemplate, getDungeon, rollItemDrop, RARE_DROP_MIN_RARITY, ITEM_LEVEL_GROWTH, REGIONS, enhanceSuccessRate, guaranteedStonesRequired, expForLevel, syncExpToNext, MONSTER_JOBS, getGeneralSlotDef, getAbilityById, isFeatureEnabled })`, context);
}

module.exports = { loadGameData };

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
  };
  const context = vm.createContext({ QPCore, Math, console });
  const code = fs.readFileSync(path.join(__dirname, "../../js/data.js"), "utf8");
  // data.js はトップレベルのconstで定義しているため、同じスクリプト内の最後の式で取り出す
  return vm.runInContext(code + `
;({ RNG, RARITIES, ITEM_BASES, DUNGEONS, ENHANCE_RULES, ENHANCE_MAX_PLUS, REWARD_RULES, FEATURE_FLAGS,
   JOBS, RACES, SLOTS, ITEM_BASES, itemEffectiveValue, jobTag, getExclusiveTreeByTag, getGeneralTree, GENERAL_SLOTS,
   buildEncounter, getEnemyTemplate, getDungeon, rollItemDrop, enhanceSuccessRate, guaranteedStonesRequired })`, context);
}

module.exports = { loadGameData };

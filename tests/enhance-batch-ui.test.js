"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/ui/inventory.js"), "utf8");
const start = source.indexOf("// ---------- 装備強化 ----------");
const end = source.indexOf('document.getElementById("btnJobsDone")', start);
assert.ok(start >= 0 && end > start, "装備強化のUI実装が見つかること");
const code = source.slice(start, end);

class Element {
  constructor() {
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.style = {};
    this.listeners = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(name, cb) { this.listeners[name] = cb; }
  click() { if (!this.disabled) this.listeners.click?.({ target: this }); }
}

function setup({ locked = false, plus = 0, material = 1000 } = {}) {
  const item = { id: "sword-1", name: "ミスリルソード", slot: "weapon", rarity: "n", plus };
  const S = { material, guaranteedStones: { free: 2, paid: 3 }, inventory: [item], roster: [] };
  const nodes = {};
  const document = { getElementById: (id) => nodes[id] || (nodes[id] = new Element()) };
  let saved = 0;
  const calls = [];
  const Inventory = {
    canBatchEnhance: (it) => !locked && S.inventory.includes(it) && it.plus < 99,
    estimateEnhanceToTarget: (it, target) => target <= it.plus ? null : ({ targetPlus: target, maxStones: (target - it.plus) * 9 }),
    isMaxed: (it) => it.plus >= 99,
    enhanceToTarget: (it, target) => {
      calls.push({ target });
      const fromPlus = it.plus;
      const successes = target - it.plus;
      it.plus = target;
      S.material -= successes * 3;
      return { fromPlus, targetPlus: target, plus: target, attempts: successes,
        successes, failures: 0, spent: successes * 3,
        remainingMaterial: S.material, reason: "target" };
    },
  };
  const ctx = vm.createContext({
    SLOTS: [{ key: "weapon", icon: "剣" }],
    RARITIES: [{ key: "n", name: "ノーマル" }],
    S, document, Inventory, ENHANCE_MAX_PLUS: 99,
    itemStatsText: () => "攻撃力10", itemMark: () => "", rarityColor: () => "#fff",
    itemOptionsText: () => "", getUniqueItem: () => null, itemEffectText: () => "",
    enhanceSuccessRate: () => 0.9, enhanceCost: () => 3,
    isFeatureEnabled: () => false, guaranteedStoneTotal: () => 5, guaranteedStonesRequired: () => 1,
    renderCharDetail: () => {}, scheduleSave: () => {},
    saveGame: () => { saved++; return true; },
    armConfirm: () => {}, confirmReady: () => true,
  });
  vm.runInContext(code, ctx, { filename: "enhance-ui.js" });
  return { ctx, S, nodes, calls, item, open: () => ctx.openEnhanceModal(item),
    get saved() { return saved; } };
}

test("強化UI: +10のステッパー・天井最大必要数・強化ボタンが表示され、実消費のみ反映される", () => {
  const env = setup();
  env.open();
  assert.equal(env.nodes.enBatchTarget.textContent, "+10");
  assert.match(env.nodes.enBatchEstimate.textContent, /90個/);
  assert.equal(env.nodes.enBatchBudget, undefined, "不要な500個の入力欄には依存しない");
  assert.equal(env.nodes.btnEnhanceBatch.disabled, false);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0, "確認段階では強化石を消費しない");
  assert.match(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 10 }]);
  assert.equal(env.saved, 1);
  assert.match(env.nodes.enBatchResult.textContent, /目標達成/);
  assert.match(env.nodes.enBatchResult.textContent, /30個消費/);
  assert.equal(env.S.material, 970, "天井90個を先払いしない");
  assert.equal(env.nodes.btnEnhanceBatch.disabled, true);
});

test("強化UI: − / ＋ で目標を1ずつ変更し、確認状態をクリアする", () => {
  const env = setup();
  env.open();
  env.nodes.enBatchMinus.click();
  assert.equal(env.nodes.enBatchTarget.textContent, "+9");
  env.nodes.enBatchPlus.click();
  assert.equal(env.nodes.enBatchTarget.textContent, "+10");
  env.nodes.btnEnhanceBatch.click();
  assert.match(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.enBatchPlus.click();
  assert.equal(env.nodes.enBatchTarget.textContent, "+11");
  assert.doesNotMatch(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0, "目標変更後に再確認が必要");
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 11 }]);
});

test("強化UI: 目標は現在より上で最大+99、+10以上なら最低現在+1", () => {
  const env = setup({ plus: 9 });
  env.open();
  assert.equal(env.nodes.enBatchTarget.textContent, "+10");
  assert.equal(env.nodes.enBatchMinus.disabled, true);
  for (let n = 10; n < 99; n++) env.nodes.enBatchPlus.click();
  assert.equal(env.nodes.enBatchTarget.textContent, "+99");
  assert.equal(env.nodes.enBatchPlus.disabled, true);
  env.nodes.enBatchMinus.click();
  assert.equal(env.nodes.enBatchTarget.textContent, "+98");

  const high = setup({ plus: 98 });
  high.open();
  assert.equal(high.nodes.enBatchTarget.textContent, "+99");
  assert.equal(high.nodes.enBatchMinus.disabled, true);
  assert.equal(high.nodes.enBatchPlus.disabled, true);
});

test("強化UI: 天井までの必要石が足りなくても、実際に挑戦できる石があれば強化できる", () => {
  const env = setup({ material: 5 });
  env.open();
  assert.equal(env.nodes.btnEnhanceBatch.disabled, false);
  assert.match(env.nodes.enBatchHint.textContent, /不足/);
});

test("強化UI: 探索ロック中の装備は目標まで強化できない", () => {
  const env = setup({ locked: true });
  env.open();
  assert.equal(env.nodes.btnEnhanceBatch.disabled, true);
  assert.match(env.nodes.enBatchHint.textContent, /探索中/);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0);
});

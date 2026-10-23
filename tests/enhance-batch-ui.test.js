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
  constructor(attrs = {}) {
    this.attrs = attrs;
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.value = "";
    this.style = {};
    this.listeners = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(name, cb) { this.listeners[name] = cb; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  click() { if (!this.disabled) this.listeners.click?.({ target: this }); }
  change(value) { this.value = value; this.listeners.change?.({ target: this }); }
}

function setup({ locked = false } = {}) {
  const item = { id: "sword-1", name: "ミスリルソード", slot: "weapon", rarity: "n", plus: 0 };
  const S = { material: 1000, guaranteedStones: { free: 2, paid: 3 }, inventory: [item], roster: [] };
  const nodes = {};
  const presets = [5, 10, 14, 20].map((v) => {
    const element = new Element({ "data-enhance-target": String(v) });
    nodes["enBatchPreset" + v] = element;
    return element;
  });
  const document = {
    getElementById: (id) => nodes[id] || (nodes[id] = new Element()),
  };
  let saved = 0;
  const calls = [];
  const Inventory = {
    ENHANCE_BATCH_BUDGET_MAX: 500,
    canBatchEnhance: (it) => !locked && S.inventory.includes(it),
    isMaxed: (it) => it.plus >= 99,
    enhanceToTarget: (it, target, budget) => {
      calls.push({ target, budget });
      const fromPlus = it.plus;
      it.plus = target;
      S.material -= 42;
      return { fromPlus, targetPlus: target, plus: target, attempts: target,
        successes: target, failures: 0, spent: 42, remainingMaterial: S.material, reason: "target" };
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
  return { ctx, S, nodes, presets, calls, item, open: () => ctx.openEnhanceModal(item),
    get saved() { return saved; } };
}

test("一括強化UI: +14・上限500で開き、2段階確認後に一度だけ実行する", () => {
  const env = setup();
  env.open();
  assert.equal(env.nodes.enBatchTarget.value, "14");
  assert.equal(env.nodes.enBatchBudget.value, "500");
  assert.equal(env.nodes.btnEnhanceBatch.disabled, false);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0, "確認だけでは強化石を消費しない");
  assert.match(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 14, budget: 500 }]);
  assert.equal(env.saved, 1);
  assert.match(env.nodes.enBatchResult.textContent, /目標達成/);
  assert.match(env.nodes.enBatchResult.textContent, /42個消費/);
  assert.equal(env.nodes.btnEnhanceBatch.disabled, true, "目標到達後は再実行不可");
});

test("一括強化UI: 目標プリセットと上限入力の検証により不正な大口消費を防ぐ", () => {
  const env = setup();
  env.open();
  env.presets[1].click();
  assert.equal(env.nodes.enBatchTarget.value, "10");
  env.nodes.enBatchBudget.change("501");
  assert.equal(env.nodes.enBatchBudget.value, "500", "上限500を超える値は拒否して元に戻す");
  env.nodes.enBatchBudget.change("120");
  env.nodes.btnEnhanceBatch.click();
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 10, budget: 120 }]);
});

test("一括強化UI: 探索ロック中の装備を強化させない", () => {
  const env = setup({ locked: true });
  env.open();
  assert.equal(env.nodes.btnEnhanceBatch.disabled, true);
  assert.match(env.nodes.enBatchHint.textContent, /探索中/);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0);
});

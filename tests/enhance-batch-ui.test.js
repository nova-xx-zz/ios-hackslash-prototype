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
    this.value = "";
    this.innerHTML = "";
    this.style = {};
    this.listeners = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(name, cb) { this.listeners[name] = cb; }
  click() { if (!this.disabled) this.listeners.click?.({ target: this }); }
  change(value) { this.value = value; if (!this.disabled) this.listeners.change?.({ target: this }); }
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

test("強化UI: +10のプルダウンと天井最大必要数を表示、成功した分だけ消費する", () => {
  const env = setup();
  env.open();
  assert.equal(env.nodes.enBatchTarget.value, "10");
  assert.match(env.nodes.enBatchTarget.innerHTML, /<option value="1">\+1<\/option>/);
  assert.match(env.nodes.enBatchTarget.innerHTML, /<option value="99">\+99<\/option>/);
  assert.doesNotMatch(env.nodes.enBatchTarget.innerHTML, /value="0"/);
  assert.match(env.nodes.enBatchEstimate.textContent, /90個/);
  assert.equal(env.nodes.enBatchBudget, undefined, "500個固定上限の入力欄はない");
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0, "確認段階では抽選しない");
  assert.match(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 10 }]);
  assert.equal(env.saved, 1);
  assert.equal(env.S.material, 970, "天井90個を先払いせず、実消費30個のみ");
  assert.match(env.nodes.enBatchResult.textContent, /30個消費/);
  assert.equal(env.nodes.enBatchTarget.value, "11", "目標到達後は現在の強化値より上の選択に更新");
  assert.doesNotMatch(env.nodes.enBatchTarget.innerHTML, /value="10"/);
  assert.equal(env.calls.length, 1, "目標更新で追加抽選は行わない");
});

test("強化UI: プルダウン選択を変更すると見積もりを再計算し、確認状態を解除する", () => {
  const env = setup();
  env.open();
  env.nodes.enBatchTarget.change("20");
  assert.equal(env.nodes.enBatchTarget.value, "20");
  assert.match(env.nodes.enBatchEstimate.textContent, /180個/);
  env.nodes.btnEnhanceBatch.click();
  assert.match(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.enBatchTarget.change("14");
  assert.equal(env.nodes.enBatchTarget.value, "14");
  assert.match(env.nodes.enBatchEstimate.textContent, /126個/);
  assert.doesNotMatch(env.nodes.btnEnhanceBatch.textContent, /本当に/);
  env.nodes.btnEnhanceBatch.click();
  assert.equal(env.calls.length, 0, "選択変更直後の押下は確認のみ");
  env.nodes.btnEnhanceBatch.click();
  assert.deepEqual(env.calls, [{ target: 14 }]);
});

test("強化UI: 現在の+値を超える選択肢だけ表示し、最大+99まで選択できる", () => {
  const env = setup({ plus: 9 });
  env.open();
  assert.equal(env.nodes.enBatchTarget.value, "10");
  assert.doesNotMatch(env.nodes.enBatchTarget.innerHTML, /value="9"/);
  assert.match(env.nodes.enBatchTarget.innerHTML, /<option value="10">\+10<\/option>/);
  env.nodes.enBatchTarget.change("99");
  assert.equal(env.nodes.enBatchTarget.value, "99");

  const high = setup({ plus: 98 });
  high.open();
  assert.equal(high.nodes.enBatchTarget.value, "99");
  assert.equal(high.nodes.enBatchTarget.innerHTML, '<option value="99">+99</option>');
  assert.equal(high.nodes.enBatchTarget.disabled, false);

  const max = setup({ plus: 99 });
  max.open();
  assert.equal(max.nodes.enBatchTarget.value, "99");
  assert.equal(max.nodes.enBatchTarget.disabled, true);
  assert.equal(max.nodes.btnEnhanceBatch.disabled, true);
});

test("強化UI: 不正または既に到達済みの目標値を変更イベントから注入しても採用しない", () => {
  const env = setup({ plus: 9 });
  env.open();
  for (const invalid of ["9", "0", "100", "10.5", "NaN", ""]) {
    env.nodes.enBatchTarget.change(invalid);
    assert.equal(env.nodes.enBatchTarget.value, "10");
    assert.equal(env.calls.length, 0);
  }
});

test("強化UI: 1回だけ強化して現在値が選択値に追いついたら次の目標に更新する", () => {
  const env = setup({ plus: 9 });
  env.open();
  env.ctx.Inventory.enhanceItem = (it) => {
    it.plus++;
    env.S.material -= 3;
    return { success: true, plus: it.plus, pityHit: false, cost: 3 };
  };
  env.nodes.btnEnhanceGo.click();
  assert.equal(env.item.plus, 10);
  assert.equal(env.nodes.enBatchTarget.value, "11");
  assert.doesNotMatch(env.nodes.enBatchTarget.innerHTML, /value="10"/);
});

test("強化UI: 天井分の最大必要数に所持石が満たなくても1回分の石があれば強化できる", () => {
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

"use strict";
// 既存のガンビット行をタップすると直下に条件編集が現れることを検証する。
// 編集欄が一覧の最下部に追加され見えない状態になる回帰を防ぐ。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tactics = require("../js/core/tactics.js");

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.attrs = {};
    this.textContent = "";
    this.className = "";
    this.id = "";
    this.value = "";
    this.disabled = false;
    this.title = "";
  }
  appendChild(el) { this.children.push(el); el.parent = this; return el; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
  change(value) { this.value = value; if (this.listeners.change) this.listeners.change(); }
  scrollIntoView() { Element.scrollCount += 1; }
}
Element.scrollCount = 0;
function all(el, pred, out = []) {
  if (pred(el)) out.push(el);
  for (const c of el.children) all(c, pred, out);
  return out;
}
const cls = (el, name) => all(el, n => n.className.split(" ").includes(name));
const txt = (el) => (el.textContent || "") + el.children.map(txt).join("");

function setup() {
  const abilities = [
    { id: "heal", name: "癒しの灯", reqLevel: 1, kind: "heal", target: "single-ally" },
    { id: "fire", name: "炎紋弾", reqLevel: 1, kind: "magic", target: "single" },
  ];
  const character = {
    id: "c1", race: "human", job: "priest", level: 20, isMonster: false, team: null,
    targetPriority: "weakest", tacticsRules: [
      { id: "rule-1", abilityId: "heal", condition: "auto", value: 0, enabled: true, targetMode: "weakest" },
      { id: "rule-2", abilityId: "fire", condition: "always", value: 0, enabled: true, targetMode: "weakest" },
    ],
  };
  const ctx = vm.createContext({
    document: {
      createElement: tag => new Element(tag),
      getElementById: id => current && all(current, n => n.id === id)[0] || null,
    },
    QPCore: { tactics, stats: { ivRank: () => null } },
    escapeHtml: (x) => String(x),
    computeStats: () => ({ maxHp: 100, maxMp: 40, atk: 20, mag: 20, def: 10, spd: 8 }),
    MAX_ACTIVE: 5, TEAM_LABELS: ["I", "II", "III", "IV"],
    teamMembers: () => [], isTeamLocked: () => false,
    JOBS: { priest: {} },
    learnedTreePassives: (c) => c._treePassives || [],
    jobDef: () => ({ abilities, explorationSkills: [], name: "そうりょ" }),
    availableAbilities: () => abilities,
    getAbilityTier: () => 2,
    getExclusiveTree: () => null,
    getTreeState: () => null,
    subAbilityCandidates: () => [],
    TARGET_MODES: [{ value: "weakest", label: "弱い敵" }, { value: "strongest", label: "強い敵" }, { value: "random", label: "ランダム" }],
    RACES: { human: { name: "にんげん", desc: "人間", passive: { critBonus: 0.08 }, expMult: 1 } },
    PASSIVE_LABELS: { critBonus: (value) => "会心率 +" + Math.round(value * 100) + "%" },
  });
  let current = null;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/ui/detail-tabs.js"), "utf8"), ctx, { filename: "detail-tabs.js" });
  ctx.renderCharDetail = () => { current = ctx.buildSkillTab(character); };
  ctx.renderCharDetail();
  return { ctx, character, get root() { return current; } };
}
test("既存ルールの条件タップで該当行の直後に編集欄を展開し、見える位置へ移動する", () => {
  const ui = setup();
  const rows = cls(ui.root, "gambit-rule");
  assert.equal(rows.length, 2);
  assert.equal(cls(ui.root, "gambit-editor").length, 0);
  const trigger = cls(rows[0], "gambit-trigger")[0];
  assert.match(trigger.attrs["aria-label"], /発動条件を編集/);
  trigger.click();
  const newRows = cls(ui.root, "gambit-rule");
  const editor = cls(ui.root, "gambit-editor")[0];
  assert.ok(editor);
  assert.equal(editor.id, "gambitRuleEditor");
  assert.ok(Element.scrollCount > 0, "押した編集欄をスクロール領域に表示");
  assert.equal(editor.parent.children.indexOf(editor), editor.parent.children.indexOf(newRows[0]) + 1);
  assert.equal(cls(ui.root, "gambit-rule").length, 2, "既存ルールは削除されない");
});
test("既存ルールの発動条件とHP割合を変更しても設定が保存され、編集欄を維持", () => {
  const ui = setup();
  cls(ui.root, "gambit-trigger")[0].click();
  let editor = cls(ui.root, "gambit-editor")[0];
  const selectors = cls(editor, "gambit-select");
  assert.equal(selectors.length >= 2, true);
  selectors[1].change("allyHpLte");
  assert.equal(ui.character.tacticsRules[0].condition, "allyHpLte");
  editor = cls(ui.root, "gambit-editor")[0];
  const hp = cls(editor, "gambit-number")[0];
  assert.equal(hp.value, "20");
  hp.change("35");
  assert.equal(ui.character.tacticsRules[0].value, 35);
  assert.match(txt(cls(ui.root, "gambit-trigger")[0]), /35%/);
  assert.ok(cls(ui.root, "gambit-editor")[0], "編集の途中でパネルは消えない");
});
test("スキル名タップでも編集可能、番号でON/OFF、上下順序は以前どおり操作できる", () => {
  const ui = setup();
  cls(ui.root, "gambit-skill")[1].click();
  assert.ok(cls(ui.root, "gambit-editor")[0], "既存2行目の編集欄を表示");
  assert.equal(cls(ui.root, "gambit-editor")[0].parent.children.indexOf(cls(ui.root, "gambit-rule")[1]) + 1,
    cls(ui.root, "gambit-editor")[0].parent.children.indexOf(cls(ui.root, "gambit-editor")[0]));
  cls(ui.root, "gambit-index")[0].click();
  assert.equal(ui.character.tacticsRules[0].enabled, false);
  cls(ui.root, "gambit-move")[2].click();
  assert.equal(ui.character.tacticsRules[0].abilityId, "fire");
});
test("省スペース版のスタイルが存在し、旧独立ONボタンは廃止", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(css, /\.gambit-rule\s*\{[\s\S]*?grid-template-columns:\s*29px/);
  assert.match(css, /\.gambit-index\.on:after/);
  assert.match(html, /css\/style\.css\?v=86/);
  assert.match(html, /js\/ui\/detail-tabs\.js\?v=19/);
  const ui = setup();
  assert.equal(cls(ui.root, "gambit-enabled").length, 0);
  assert.equal(cls(ui.root, "gambit-move").length, 4);
});

test("パッシブスキルは能力値の下に表示され、スキルタブはガンビット専用になる", () => {
  const ui = setup();
  ui.character._treePassives = [{ id: "priest:mp8", name: "魔力の泉", desc: "MP+8%", treeName: "癒しの心得" }];
  const stats = ui.ctx.buildStatsTab(ui.character);
  const statBox = cls(stats, "detail-stat-box")[0];
  const passive = cls(stats, "stats-passive-section")[0];
  assert.ok(statBox, "能力値が残る");
  assert.ok(passive, "パッシブ表示が能力値内に存在する");
  assert.ok(stats.children.indexOf(passive) > stats.children.indexOf(statBox), "能力値の下にある");
  assert.match(txt(passive), /パッシブスキル/);
  assert.match(txt(passive), /魔力の泉/);
  assert.match(txt(passive), /MP\+8%/);
  assert.match(txt(passive), /会心率 \+8%/, "種族特性も移動する");
  assert.equal(cls(ui.root, "gambit-passive-list").length, 0, "スキルタブにパッシブは表示しない");
  assert.equal(cls(ui.root, "gambit-tab").length, 0, "アクティブとパッシブの切替ボタンを撤去");
  assert.equal(cls(ui.root, "gambit-rule").length, 2, "既存ガンビットは保持する");
});
test("スキルツリーをリセットしたら能力値タブのパッシブ一覧から消える", () => {
  const ui = setup();
  ui.character._treePassives = [{ id: "priest:mp8", name: "魔力の泉", desc: "MP+8%", treeName: "癒しの心得" }];
  assert.match(txt(ui.ctx.buildStatsTab(ui.character)), /魔力の泉/);
  ui.character._treePassives = [];
  const statView = ui.ctx.buildStatsTab(ui.character);
  assert.doesNotMatch(txt(statView), /魔力の泉/, "未習得スキルは再表示しない");
  assert.match(txt(statView), /会心率 \+8%/, "種族特性は残る");
  assert.equal(cls(statView, "gambit-enabled").length, 0, "パッシブにON/OFFを付けない");
});

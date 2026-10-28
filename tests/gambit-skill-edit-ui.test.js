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
    this.style = { transform: "" };
    this.scrollTop = 0;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(" ").filter(x => x && !names.includes(x)).join(" "); },
      contains: (name) => this.className.split(" ").includes(name),
    };
  }
  appendChild(el) { this.children.push(el); el.parent = this; return el; }
  replaceChildren(...children) { this.children = []; children.forEach(el => this.appendChild(el)); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
  change(value) { this.value = value; if (this.listeners.change) this.listeners.change(); }
  dispatch(name, evt) { if (this.listeners[name]) this.listeners[name](evt); }
  setPointerCapture(id) { this.captureId = id; }
  querySelectorAll(selector) { return all(this, el => el !== this && selector.startsWith(".") && el.className.split(" ").includes(selector.slice(1))); }
  closest(selector) { let x = this; while (x) { if (selector.startsWith(".") && x.className.split(" ").includes(selector.slice(1))) return x; x = x.parent; } return null; }
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
    { id: "heal", name: "癒しの灯", reqLevel: 1, kind: "heal", target: "single-ally", mpCost: 4, power: 1.8, hits: 1, desc: "味方1体のHPを回復" },
    { id: "fire", name: "炎紋弾", reqLevel: 1, kind: "magic", element: "fire", target: "single", mpCost: 4, power: 1.5, hits: 1, desc: "敵1体に炎属性の魔法攻撃" },
  ];
  const character = {
    id: "c1", race: "human", job: "priest", level: 20, isMonster: false, team: null,
    targetPriority: "weakest", tacticsRules: [
      { id: "rule-1", abilityId: "heal", condition: "auto", value: 0, enabled: true, targetMode: "weakest" },
      { id: "rule-2", abilityId: "fire", condition: "always", value: 0, enabled: true, targetMode: "weakest" },
    ],
  };
  const sheet = new Element("div");
  sheet.id = "detailSheet"; sheet.className = "detail-sheet hidden";
  let hovered = null;
  const timers = [];
  const ctx = vm.createContext({
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, active: true }); return id; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].active = false; },
    document: {
      createElement: tag => new Element(tag),
      getElementById: id => id === "detailSheet" ? sheet : current && all(current, n => n.id === id)[0] || null,
      elementFromPoint: () => hovered,
    },
    QPCore: { tactics, stats: { ivRank: () => null } },
    escapeHtml: (x) => String(x),
    computeStats: () => ({ maxHp: 100, maxMp: 40, atk: 20, mag: 20, def: 10, spd: 8 }),
    mpCostFor: (c, a) => a.id === "fire" ? 3 : a.mpCost,
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
  ctx.renderCharDetail = () => {
    sheet.replaceChildren();
    sheet.className = "detail-sheet hidden";
    current = ctx.buildSkillTab(character);
  };
  ctx.renderCharDetail();
  return {
    ctx, character, sheet, get root() { return current; },
    hover: el => { hovered = el; },
    fireLongPress: () => {
      for (const timer of timers) if (timer.active) { timer.active = false; timer.fn(); }
    },
  };
}
test("ルールの条件をタップすると一覧を動かさず下部固定シートに編集欄を表示", () => {
  const ui = setup();
  assert.equal(cls(ui.root, "gambit-rule").length, 2);
  assert.equal(cls(ui.sheet, "gambit-editor").length, 0);
  const trigger = cls(ui.root, "gambit-trigger")[0];
  assert.match(trigger.attrs["aria-label"], /発動条件を編集/);
  trigger.click();
  const editor = cls(ui.sheet, "gambit-editor")[0];
  assert.ok(editor);
  assert.equal(editor.id, "gambitRuleEditor");
  assert.ok(ui.sheet.classList.contains("gambit-sheet"), "タブの上に固定する既存detailSheetを使用");
  assert.equal(ui.sheet.classList.contains("hidden"), false);
  assert.equal(ui.sheet.children[0], editor);
  assert.equal(cls(ui.root, "gambit-editor").length, 0, "一覧内部に編集フォームを差し込まない");
  assert.equal(cls(ui.root, "gambit-rule").length, 2);
});
test("既存ルールの発動条件とHP割合を変更しても設定が保存され、編集欄を維持", () => {
  const ui = setup();
  cls(ui.root, "gambit-trigger")[0].click();
  let editor = cls(ui.sheet, "gambit-editor")[0];
  const selectors = cls(editor, "gambit-select");
  assert.equal(selectors.length >= 2, true);
  selectors[1].change("allyHpLte");
  assert.equal(ui.character.tacticsRules[0].condition, "allyHpLte");
  editor = cls(ui.sheet, "gambit-editor")[0];
  const hp = cls(editor, "gambit-number")[0];
  assert.equal(hp.value, "20");
  hp.change("35");
  assert.equal(ui.character.tacticsRules[0].value, 35);
  assert.match(txt(cls(ui.root, "gambit-trigger")[0]), /35%/);
  assert.ok(cls(ui.sheet, "gambit-editor")[0], "編集の途中でパネルは消えない");
});
test("スキル名タップでも編集可能、番号でON/OFF、上下順序は以前どおり操作できる", () => {
  const ui = setup();
  cls(ui.root, "gambit-skill")[1].click();
  assert.ok(cls(ui.sheet, "gambit-editor")[0], "既存2行目の編集欄を表示");
  assert.equal(ui.sheet.children[0], cls(ui.sheet, "gambit-editor")[0]);
  cls(ui.root, "gambit-index")[0].click();
  assert.equal(ui.character.tacticsRules[0].enabled, false);
  const grip = cls(ui.root, "gambit-grip")[1];
  let prevented = false;
  grip.dispatch("keydown", { key: "ArrowUp", preventDefault() { prevented = true; } });
  assert.ok(prevented, "キーボードでも移動できる");
  assert.equal(ui.character.tacticsRules[0].abilityId, "fire");
});
test("省スペース版のスタイルが存在し、旧独立ONボタンは廃止", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(css, /\.gambit-rule\s*\{[\s\S]*?grid-template-columns:\s*29px/);
  assert.match(css, /\.gambit-index\.on:after/);
  assert.match(html, /css\/style\.css\?v=91/);
  assert.match(html, /js\/ui\/detail-tabs\.js\?v=21/);
  assert.match(html, /js\/ui\/detail\.js\?v=12/);
  assert.match(css, /#screen-chardetail #detailSheet\.gambit-sheet/);
  const ui = setup();
  assert.equal(cls(ui.root, "gambit-enabled").length, 0);
  assert.equal(cls(ui.root, "gambit-move").length, 0);
  assert.equal(cls(ui.root, "gambit-grip").length, 2);
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

test("ガンビットの編集中は選択スキルの説明・対象・威力・消費MPをマスターから表示", () => {
  const ui = setup();
  assert.equal(cls(ui.sheet, "gambit-ability-detail").length, 0, "一覧は省スペースのまま");
  cls(ui.root, "gambit-trigger")[0].click();
  const details = cls(ui.sheet, "gambit-ability-detail");
  assert.equal(details.length, 1);
  const detail = details[0];
  assert.match(txt(detail), /癒しの灯/);
  assert.match(txt(detail), /味方1体のHPを回復/);
  assert.match(txt(detail), /回復/);
  assert.match(txt(detail), /味方単体/);
  assert.match(txt(detail), /消費MP4/);
  assert.match(txt(detail), /1\.8/);
  assert.match(txt(detail), /1回/);
  assert.equal(detail.attrs["aria-label"], "選択中のスキル詳細");
});
test("選択スキルを切り替えると説明と消費MP補正が連動し、他のルールは変更されない", () => {
  const ui = setup();
  cls(ui.root, "gambit-skill")[0].click();
  const abilitySelect = cls(ui.sheet, "gambit-editor")[0] && cls(ui.sheet, "gambit-select")[0];
  assert.equal(abilitySelect.value, "heal");
  abilitySelect.change("fire");
  assert.equal(ui.character.tacticsRules[0].abilityId, "fire");
  assert.equal(ui.character.tacticsRules[1].abilityId, "fire");
  const details = cls(ui.sheet, "gambit-ability-detail");
  assert.equal(details.length, 1);
  assert.match(txt(details[0]), /炎紋弾/);
  assert.match(txt(details[0]), /敵1体に炎属性の魔法攻撃/);
  assert.match(txt(details[0]), /魔法攻撃/);
  assert.match(txt(details[0]), /火/);
  assert.match(txt(details[0]), /消費MP3（基本4）/);
  assert.match(txt(details[0]), /威力係数×1\.5/);
  assert.doesNotMatch(txt(details[0]), /味方1体のHPを回復/);
  assert.equal(cls(ui.root, "gambit-rule").length, 2);
  assert.equal(ui.character.tacticsRules[0].condition, "auto");
  assert.equal(ui.character.tacticsRules[1].condition, "always");
});
test("未習得・存在しない技のルールは説明を捏造せず使用不可を示す", () => {
  const ui = setup();
  ui.character.tacticsRules[0].abilityId = "unknown_ability";
  ui.ctx.renderCharDetail();
  cls(ui.root, "gambit-trigger")[0].click();
  assert.match(txt(cls(ui.sheet, "gambit-ability-detail")[0]), /現在習得していないか、使用できません/);
  assert.equal(ui.character.tacticsRules[0].abilityId, "unknown_ability");
  assert.equal(cls(ui.root, "gambit-rule").length, 2);
});

test("≡を300ms長押しし別のルールへドロップすると並び順と技情報を維持", () => {
  const ui = setup();
  const grip = cls(ui.root, "gambit-grip")[0];
  const target = cls(ui.root, "gambit-rule")[1];
  grip.dispatch("pointerdown", { pointerId: 7, pointerType: "touch", button: 0, clientY: 100 });
  assert.equal(ui.character.tacticsRules[0].abilityId, "heal", "長押し前は並べ替えない");
  ui.fireLongPress();
  ui.hover(target);
  grip.dispatch("pointermove", { pointerId: 7, clientX: 230, clientY: 170, cancelable: true, preventDefault() {} });
  assert.equal(target.classList.contains("gambit-drop-target"), true, "ドロップ位置を強調");
  grip.dispatch("pointerup", { pointerId: 7 });
  assert.deepEqual(ui.character.tacticsRules.map(r => r.abilityId), ["fire", "heal"]);
  assert.deepEqual(ui.character.tacticsRules.map(r => r.id), ["rule-2", "rule-1"]);
  assert.equal(target.classList.contains("gambit-drop-target"), false, "ドロップ後は強調を解除");
});
test("短いタップ・長押し前の指の移動・ドラッグ中断ではルールの順序を変えない", () => {
  const ui = setup();
  let grip = cls(ui.root, "gambit-grip")[0];
  grip.dispatch("pointerdown", { pointerId: 11, pointerType: "touch", button: 0, clientY: 100 });
  grip.dispatch("pointerup", { pointerId: 11 });
  ui.fireLongPress();
  assert.equal(ui.character.tacticsRules[0].abilityId, "heal");
  grip.dispatch("pointerdown", { pointerId: 12, pointerType: "touch", button: 0, clientY: 100 });
  grip.dispatch("pointermove", { pointerId: 12, clientX: 200, clientY: 120, cancelable: true, preventDefault() {} });
  ui.fireLongPress();
  assert.equal(ui.character.tacticsRules[0].abilityId, "heal");
  grip.dispatch("pointerdown", { pointerId: 13, pointerType: "touch", button: 0, clientY: 100 });
  ui.fireLongPress();
  ui.hover(cls(ui.root, "gambit-rule")[1]);
  grip.dispatch("pointermove", { pointerId: 13, clientX: 230, clientY: 160, cancelable: true, preventDefault() {} });
  grip.dispatch("pointercancel", { pointerId: 13 });
  assert.equal(ui.character.tacticsRules[0].abilityId, "heal");
});
test("ルールを編集しても固定シートの位置・内容を維持し、閉じれば一覧だけに戻る", () => {
  const ui = setup();
  cls(ui.root, "gambit-skill")[0].click();
  assert.ok(ui.sheet.classList.contains("gambit-sheet"));
  ui.sheet.scrollTop = 42;
  const selects = cls(ui.sheet, "gambit-select");
  selects[1].change("selfHpLte");
  assert.equal(ui.character.tacticsRules[0].condition, "selfHpLte");
  assert.equal(ui.sheet.scrollTop, 42, "再描画しても固定シートのスクロール位置を保存");
  assert.ok(cls(ui.sheet, "gambit-ability-detail")[0], "技詳細も残る");
  cls(ui.sheet, "gambit-editor-close")[0].click();
  assert.equal(cls(ui.sheet, "gambit-editor").length, 0);
  assert.equal(ui.sheet.classList.contains("hidden"), true);
});

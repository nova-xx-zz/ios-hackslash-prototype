// node --test tests/dungeon-preview.test.js
// モバイルプレビューはセーブに触れない独立HTML。インラインJSの構文と簡易完走を確認。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require("node:path").join(__dirname, "../dungeon-preview.html"), "utf8");
const scriptContents = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]);

test("プレビューは単独HTMLで開ける構成、セーブ/通信へ接続しない", () => {
  assert.equal(scriptContents.length, 2, "inline scripts must be bundled");
  assert.ok(html.includes("Dungeon Trial"));
  assert.ok(html.includes("不思議な泉"));
  assert.ok(html.includes("鍵付き宝箱"));
  assert.ok(html.includes("全アイテムロスト"));
  assert.equal(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bfetch\s*\(/i.test(html), false);
  scriptContents.forEach((source, i) => assert.doesNotThrow(() => new vm.Script(source, {filename: "inline" + i + ".js"})));
});

class Element {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.scrollHeight = 10;
    this.scrollTop = 0;
    this.className = "";
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
  replaceChildren(...children) { this.children = children; }
  get firstChild() { return this.children[0]; }
  addEventListener(name, fn) { this["on" + name] = fn; }
  scrollIntoView() {}
}

async function executePreview({selected="plains", strong=true, rare=false, thief=true}={}) {
  const map = new Map();
  const byId = id => { if (!map.has(id)) map.set(id, new Element(id)); return map.get(id); };
  byId("dungeon").value = selected;
  byId("equipment").value = strong ? "strong" : "basic";
  byId("rare").checked = rare;
  byId("thief").checked = thief;
  const context = vm.createContext({
    document: { getElementById: byId, createElement: () => new Element() },
    window: {}, console, Date, Math,
    setTimeout: fn => { fn(); return 1; },
    clearTimeout: () => {},
  });
  // ブラウザと同じグローバルにする
  context.window = context;
  for (const source of scriptContents) vm.runInContext(source, context);
  byId("start").onclick();
  // 即時タイマーを使い全await処理を完了
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (!byId("start").disabled) break;
  }
  return { byId };
}

test("3階層をiPhone想定のDOMで自動完走し、最終ボス撃破で報酬が確定", async () => {
  const {byId} = await executePreview({ selected:"plains", strong:true });
  assert.equal(byId("start").disabled, false);
  assert.match(byId("status").textContent, /攻略成功/);
  assert.equal(byId("currentFloor").textContent, "3F");
  assert.equal(byId("floorgrid").children.length, 3);
  assert.match(byId("summary").textContent, /未確定装備/);
  assert.ok(byId("log").children.some(x => x.textContent.includes("最終ボス")));
});

test("5階層で60%ボスフェーズとログ、自動で進行", async () => {
  const {byId} = await executePreview({ selected:"cave", strong:true, rare:true, thief:false });
  assert.equal(byId("start").disabled, false);
  assert.equal(byId("floorgrid").children.length, 5);
  assert.equal(byId("currentFloor").textContent, "5F");
  assert.ok(byId("log").children.some(x => x.textContent.includes("ロックゴーレム")));
  assert.ok(byId("log").children.some(x => x.textContent.includes("岩の鎧")), "phase logs");
  assert.ok(byId("log").children.some(x => x.textContent.includes("検証用UR")));
});

test("失敗しても途中取得報酬を所持品へ移さず、操作待ちがない", async () => {
  const {byId} = await executePreview({ selected:"cave", strong:false, rare:true });
  assert.equal(byId("start").disabled, false);
  assert.match(byId("status").textContent, /攻略(成功|失敗)/);
  assert.ok(!byId("log").children.some(x => x.textContent.includes("選択肢を選ぶ")));
  if (byId("status").textContent.includes("攻略失敗")) {
    assert.match(byId("summary").textContent, /全消失/);
  }
});

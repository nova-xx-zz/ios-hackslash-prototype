// ---------- 確認用モード ----------
// 設定画面の「開発者用」に合言葉（js/debug-gate.js）を入れるか、URLに ?debug を付けて開き合言葉を入れた端末でだけ使える、
// 開発者向けの確認用の機能。「開発者用」から入った時は、開いた直後にコンプリート（すべてを終えた状態）にする。
// 保存場所は本番と別（js/core/storage.js の DEBUG_PREFIX）で、クラウドセーブも使わないので、ふだんのデータには影響しない。
// 設定画面の「確認用モード」から、地方の入口（またはLv100の最後のダンジョンの前）まで一気に進める:
//   - それより前のダンジョンをすべて踏破済みにする
//   - 第一のパーティの全員を、そのダンジョンの推奨Lvにする（今のジョブのレベル）
//   - 全員に、そのダンジョンの適正装備（レア度・+値・装備のレベル。難易度の基準と同じもの）を付ける
//   - スキルツリーのSPを、難易度の基準と同じ「素直な振り方」で振る（固有ツリー→汎用①②③の順に、
//     上のノードから振れるものを1ランクずつ。二択は先に並んでいる方。tools/lib/sim.js の standardTreeRanks と同じ）
"use strict";

const DEBUG_MODE = QPCore.storage.isDebugMode();
let debugItemSeq = 1;

function showDebugMessage(text, isError) {
  const el = document.getElementById("debugMessage");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("error", !!isError);
}

// 今の振り分けを消してから、素直な振り方でSPを振り直す（今のジョブの分だけ）
function debugSpendSkillPoints(c) {
  const st = getTreeState(c);
  if (!st || !getExclusiveTree(c)) return;
  st.exclusiveRanks = {};
  for (const slot of GENERAL_SLOTS) st.general[slot.key].ranks = {};
  const trees = [[getExclusiveTree(c), st.exclusiveRanks]]
    .concat(GENERAL_SLOTS.map((slot) => [generalSlotTreeDef(c, slot.key), st.general[slot.key].ranks]));
  for (const [treeDef, ranks] of trees) {
    if (!treeDef) continue;
    for (const node of treeDef.nodes) {
      if ((ranks[node.id] || 0) === 0 && canAcquireNode(c, treeDef, ranks, node)) acquireNode(c, treeDef, ranks, node);
    }
  }
}

function debugJumpTo(target) {
  if ([0, 1, 2, 3].some((i) => isTeamLocked(i))) {
    showDebugMessage("探索中・自動周回中のパーティがある間は使えません（止めてから押してください）", true);
    return;
  }
  const members = teamMembers(0);
  if (!members.length) { showDebugMessage("第一のパーティに仲間がいません", true); return; }
  const index = DUNGEONS.indexOf(target);
  // それより前のダンジョンは踏破済みにし、ハードも踏破済みにする（ハード・エクストラをすぐ試せるように）
  for (const d of DUNGEONS.slice(0, index)) { S.clearedDungeons.add(d.id); S.clearedHard.add(d.id); }
  setBestStage(S.clearedDungeons.size);

  const level = target.level;
  const gear = target.benchmarkGear || { rarity: "n", plus: 0 };
  const rarity = RARITIES.find((r) => r.key === gear.rarity) || RARITIES[0];
  const gearLevel = index > 0 ? DUNGEONS[index - 1].level : 1; // 適正装備の装備のレベル（難易度の基準と同じ）
  for (const c of members) {
    c.level = Math.min(level, levelCap(c)); c.exp = 0; c.expToNext = expForLevel(c.level); // 人間はLv99が上限
    if (!c.isMonster && c.job) c.jobLevels[c.job] = Object.assign({}, c.jobLevels[c.job], { level: c.level, exp: 0, expToNext: c.expToNext });
    if (!c.isMonster) debugSpendSkillPoints(c); // 先に振って装飾品の枠を増やしておく
    // その地方のシリーズの全種類を適正装備のレア度・+値で用意し、おまかせ装備で付ける（残りは捨てる）
    const series = seriesForLevel(gearLevel);
    const pool = ITEM_BASES.filter((b) => b.series === series.key).map((b) => {
      const item = QPCore.rewards.createItem(b, rarity, "dbg_" + debugItemSeq++, { level: gearLevel, levelGrowth: ITEM_LEVEL_GROWTH });
      item.plus = gear.plus;
      return item;
    });
    c.equip = QPCore.equipment.emptyEquip();
    const kept = S.inventory.slice();
    S.inventory.push(...pool);
    autoEquip(c);
    S.inventory.length = 0;
    S.inventory.push(...kept);
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
  }
  selectedDungeonId = target.id;
  saveGame();
  showDebugMessage(`${target.name}（推奨Lv${level}）の手前まで進めました。第一のパーティ: Lv${level}・${rarity.key.toUpperCase()}+${gear.plus}（装備のLv.${gearLevel}）・スキルツリーは自動で振り済み`);
}

// ---------- コンプリート（開発者用: すべてを終えた状態にする） ----------
// 全ダンジョンを全モード踏破・第一〜第四のパーティを最強の状態（Lv上限・アビスのLR+99・スキル全振り・全ジョブLv99）・
// テイムできる37種を1体ずつ（Lv100・個体値最大）・図鑑と辞典を全部・ショップの解放と資源を全部。
// 確認用のデータだけを書き換える（今の仲間・所持品は置き換える）
const DEBUG_TEAM_JOBS = [
  ["swordmaster", "reaper", "archmage", "archpriest", "ninja"],
  ["saintfist", "darkknight", "archmage", "archpriest", "swordmaster"],
  ["warrior", "thief", "mage", "priest", "monk"],
  ["reaper", "ninja", "saintfist", "archpriest", "archmage"],
];
function debugEquipBest(c, seriesKey, rarityKey, plus, level) {
  const rarity = RARITIES.find((r) => r.key === rarityKey) || RARITIES[0];
  const pool = ITEM_BASES.filter((b) => b.series === seriesKey).map((b) => {
    const item = QPCore.rewards.createItem(b, rarity, "dbg_" + debugItemSeq++, { level, levelGrowth: ITEM_LEVEL_GROWTH });
    item.plus = plus;
    return item;
  });
  c.equip = QPCore.equipment.emptyEquip();
  const kept = S.inventory.slice();
  S.inventory.length = 0;
  S.inventory.push(...pool);
  autoEquip(c);
  S.inventory.length = 0;
  S.inventory.push(...kept);
  const s = computeStats(c);
  c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
}
function debugComplete() {
  if ([0, 1, 2, 3].some((i) => isTeamLocked(i))) {
    showDebugMessage("探索中・自動周回中のパーティがある間は使えません（止めてから押してください）", true);
    return;
  }
  const last = DUNGEONS[DUNGEONS.length - 1];
  const series = seriesForLevel(last.level).key;
  const maxLv = levelCap({ isMonster: false });
  // ダンジョン: 全部・全モード踏破
  for (const d of DUNGEONS) { S.clearedDungeons.add(d.id); S.clearedHard.add(d.id); S.clearedExtra.add(d.id); }
  setBestStage(DUNGEONS.length);
  // ショップ: 買い切りを全部・仲間のBOXを最大。資源
  for (const p of SHOP_PRODUCTS) if (p.kind === "unlock") S.purchases.unlocks[p.unlock] = true;
  for (const id of SPECIAL_JOB_IDS) S.jobGrants[id] = { at: Date.now(), window: "debug" }; // 特殊職も無料キャンペーンで解放済みにする
  S.purchases.rosterBoxes = Shop.maxRosterBoxes();
  S.material = 99999999;
  S.guaranteedStones.free = 999;
  // 仲間: 第一〜第四のパーティ（20人）と、テイムできる37種を1体ずつ
  S.roster = [];
  S.inventory = [];
  const races = PLAYER_RACE_IDS;
  let n = 0;
  DEBUG_TEAM_JOBS.forEach((jobs, team) => {
    for (const job of jobs) {
      const c = newCharacter(`${RECRUIT_NAME_POOL[n % RECRUIT_NAME_POOL.length]}${Math.floor(n / RECRUIT_NAME_POOL.length) + 1}`, job, races[n % races.length], { team, level: maxLv });
      n += 1;
      for (const id of Object.keys(JOBS)) c.jobLevels[id] = Object.assign({}, c.jobLevels[id], { level: maxLv, exp: 0, expToNext: expForLevel(maxLv) });
      debugSpendSkillPoints(c);
      debugEquipBest(c, series, "lr", ENHANCE_MAX_PLUS, last.level);
      S.roster.push(c);
    }
  });
  for (const t of ENEMY_TEMPLATES.filter((x) => x.tamable)) {
    const mon = newCharacter(t.name, null, t.key, { isMonster: true, level: levelCap({ isMonster: true }) });
    mon.ivs = Object.fromEntries(QPCore.stats.IV_KEYS.map((k) => [k, 1 + MONSTER_IV_RANGE]));
    debugEquipBest(mon, series, "lr", ENHANCE_MAX_PLUS, last.level);
    S.roster.push(mon);
  }
  // 図鑑・辞典: 敵200種（ダンジョン別の記録も）とアイテム辞典を全部
  for (const t of ENEMY_TEMPLATES) markDexSeen(t.key);
  for (const d of DUNGEONS) S.records.dungeonEncounters[d.id] = [...new Set([...d.pool, d.boss, ...(d.rares || [])])];
  S.records.itemsFound = [];
  for (const b of ITEM_BASES.concat(UNIQUE_ITEMS)) for (const r of RARITIES) S.records.itemsFound.push(`${b.key}:${r.key}`);
  S.activeTeam = 0;
  selectedDungeonId = last.id;
  saveGame();
  showDebugMessage(`コンプリートしました: 全${DUNGEONS.length}ダンジョンを全モード踏破、パーティ4つ（Lv${maxLv}・LR+${ENHANCE_MAX_PLUS}）、テイム${S.roster.length - 20}種、図鑑・辞典・ショップを全部`);
}

function debugResetData() {
  // 確認用モードの保存場所だけを消して、最初からにする（本番のデータは別の場所なので消えない）
  try {
    for (const key of Object.values(KEYS)) localStorage.removeItem(QPCore.storage.DEBUG_PREFIX + key);
  } catch (e) { /* 保存場所に触れない環境では何もしない */ }
  location.reload();
}

function renderDebugTools() {
  document.getElementById("settingsDebug").classList.remove("hidden");
  const list = document.getElementById("debugJumpButtons");
  list.innerHTML = "";
  const targets = [];
  for (const region of REGIONS.slice(1)) {
    const first = DUNGEONS.find((d) => d.region === region.id);
    if (first) targets.push({ label: `${region.name}の入口へ（Lv${first.level}）`, dungeon: first });
  }
  const last = DUNGEONS[DUNGEONS.length - 1];
  targets.push({ label: `${last.name}の手前へ（Lv${last.level}）`, dungeon: last });
  for (const t of targets) {
    const btn = document.createElement("button");
    btn.className = "btn small ghost";
    btn.textContent = t.label;
    btn.addEventListener("click", () => debugJumpTo(t.dungeon));
    list.appendChild(btn);
  }
}

if (DEBUG_MODE) {
  document.body.classList.add("debug-mode");
  const badge = document.createElement("div");
  badge.className = "debug-badge";
  badge.textContent = "確認用モード";
  document.body.appendChild(badge);
  renderDebugTools();
  document.getElementById("btnDebugComplete").addEventListener("click", () => {
    const btn = document.getElementById("btnDebugComplete");
    if (btn.dataset.confirm) {
      if (!confirmReady()) return;
      delete btn.dataset.confirm; btn.textContent = "コンプリート（すべてを終えた状態にする）"; debugComplete(); return;
    }
    btn.dataset.confirm = "1";
    armConfirm();
    btn.textContent = "本当にコンプリートする（確認用の仲間・所持品は置き換わります）";
  });
  // ふつうのモードに戻る。この端末の合言葉も忘れる（次に入る時は、また合言葉を聞く）
  document.getElementById("btnDebugLock").addEventListener("click", () => {
    QPDebugGate.leave();
    location.href = location.pathname;
  });
  document.getElementById("btnDebugReset").addEventListener("click", () => {
    const btn = document.getElementById("btnDebugReset");
    if (btn.dataset.confirm) { if (confirmReady()) debugResetData(); return; }
    btn.dataset.confirm = "1";
    armConfirm();
    btn.textContent = "本当に最初からにする（確認用のデータだけ消えます）";
  });
}
// 設定画面の「開発者用」: 合言葉が合えば、確認用モードで開き直してコンプリートにする（テストプレイヤーには合言葉が分からない）
// 確認用モードの間はボタンを隠す（「ふつうのモードに戻る」で抜ける）
document.getElementById("btnDevEnter").classList.toggle("hidden", DEBUG_MODE || (globalThis.QPRuntime && globalThis.QPRuntime.channel === "production"));
document.getElementById("btnDevEnter").addEventListener("click", () => {
  if (globalThis.QPRuntime && globalThis.QPRuntime.channel === "production") return;
  const input = window.prompt("開発者用の合言葉を入力してください");
  if (input === null) return;
  if (!QPDebugGate.enter(input)) { window.alert("合言葉が違います"); return; }
  location.href = location.pathname;
});
// 「開発者用」から入った直後の1回だけ、コンプリートにする（ゲームの読み込みが終わってから）
if (DEBUG_MODE && QPDebugGate.takeAutoComplete()) {
  window.addEventListener("load", () => {
    debugComplete();
    window.alert("確認用モードに入り、コンプリート状態にしました（ふだんのデータとは別です）。設定画面の「ふつうのモードに戻る」で戻れます");
  });
}

// ---------- 確認用モード（?debug） ----------
// URLに ?debug を付けて開いた時だけ使える、後半のダンジョンを先に確かめるための機能。
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
  for (const d of DUNGEONS.slice(0, index)) S.clearedDungeons.add(d.id);
  setBestStage(S.clearedDungeons.size);

  const level = target.level;
  const gear = target.benchmarkGear || { rarity: "n", plus: 0 };
  const rarity = RARITIES.find((r) => r.key === gear.rarity) || RARITIES[0];
  const gearLevel = index > 0 ? DUNGEONS[index - 1].level : 1; // 適正装備の装備のレベル（難易度の基準と同じ）
  for (const c of members) {
    c.level = level; c.exp = 0; c.expToNext = expForLevel(level);
    if (!c.isMonster && c.job) c.jobLevels[c.job] = Object.assign({}, c.jobLevels[c.job], { level, exp: 0, expToNext: c.expToNext });
    for (const slot of SLOTS) {
      const options = ITEM_BASES.filter((b) => b.slot === slot.key).map((b) => {
        const item = QPCore.rewards.createItem(b, rarity, "dbg_" + debugItemSeq++, { level: gearLevel, levelGrowth: ITEM_LEVEL_GROWTH });
        item.plus = gear.plus;
        return item;
      });
      c.equip[slot.key] = options.reduce((best, it) => (itemScore(c, it) > itemScore(c, best) ? it : best));
    }
    if (!c.isMonster) debugSpendSkillPoints(c);
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
  }
  selectedDungeonId = target.id;
  saveGame();
  showDebugMessage(`${target.name}（推奨Lv${level}）の手前まで進めました。第一のパーティ: Lv${level}・${rarity.key.toUpperCase()}+${gear.plus}（装備のLv.${gearLevel}）・スキルツリーは自動で振り済み`);
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
  document.getElementById("btnDebugReset").addEventListener("click", () => {
    const btn = document.getElementById("btnDebugReset");
    if (btn.dataset.confirm) { debugResetData(); return; }
    btn.dataset.confirm = "1";
    btn.textContent = "本当に最初からにする（確認用のデータだけ消えます）";
  });
}

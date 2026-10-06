// ---------- 画面: セーブ/ロードと、ゲームのルール（js/model/）の組み立て（Roster・Inventory・Runner） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- セーブ/ロード ----------
// ゲームの状態(S)を端末に保存する。セーブデータの形と旧形式からの移行は js/model/save.js。
// 旧jobquest_materialキーは互換ミラーとして更新するのみ（正本はメインセーブのmaterial）
let lastSavedAt = null; // 端末に保存できた最新セーブのsavedAt（バックグラウンド復帰時の精算に使う）
// クラウドから復元して再読み込みするまでの間は、端末に保存しない（離れる時の保存で復元した内容を上書きしないため）
let saveSuspended = false;
function saveGame() {
  if (saveSuspended) return false;
  let json;
  const now = Date.now();
  try {
    const data = QPModel.save.serialize(S, {
      now,
      runDungeonIds: teamRuns.map((r) => (r && r.dungeon) ? r.dungeon.id : null),
      runModes: teamRuns.map((r) => (r && r.dungeon && r.dungeon.mode) || "normal"),
      enabledFeatures: Object.keys(FEATURE_FLAGS).filter((k) => FEATURE_FLAGS[k]),
    });
    json = JSON.stringify(data);
  } catch (e) { return false; }
  // 容量超過などで失敗した場合はstoreが警告を出す。成功したら以前の警告は消す
  if (!store.set(KEYS.save, json)) return false;
  lastSavedAt = now;
  store.set(KEYS.material, S.material); // 旧キーは互換ミラー
  hideSaveFailureBanner();
  // クラウドセーブ（js/cloud.js）に知らせる。送る間隔や送れるかどうかは cloud.js が決める
  window.dispatchEvent(new CustomEvent("qp:saved", { detail: { json, savedAt: now } }));
  return true;
}

// クラウドのセーブ（JSON文字列）で端末のセーブを置き換えて、読み込み直す。使えないデータなら false
function restoreSaveFromCloud(json) {
  const prepared = QPModel.save.prepareRestore(json);
  if (!prepared) return false;
  if (!store.set(KEYS.save, prepared.json)) return false;
  saveSuspended = true;
  location.reload();
  return true;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveGame, 400);
}

// 起動時に保存データがあれば復元する。無ければ既定のスターターロスターのまま。
// 自動周回が稼働中のまま離れていたチームがあれば、離れていた時間分の周回をまとめて計算する
// （チームごとに独立して計算するため、複数チームが同時にオフライン進行することもある）
let pendingOfflineSummaries = null;
let offlineSettleFailed = false;
// 精算前に「このsavedAtは精算済み」と記録する。記録できない（容量不足など）なら精算しない
function claimOfflineSettlement(savedAt) {
  return store.set(KEYS.offlineSettled, savedAt);
}
function loadGame() {
  try {
    const raw = store.getString(KEYS.save);
    if (!raw) return false;
    const loaded = QPModel.save.deserialize(JSON.parse(raw), {
      legacyMaterial: store.getInt(KEYS.material, 0),
      syncExpToNext,
      itemBases: ITEM_BASES,
      legacyItemBases: LEGACY_ITEM_BASES,
    });
    if (!loaded) return false;
    Object.assign(S, loaded.state);
    store.set(KEYS.material, S.material);
    // 保存時に戦闘中だった場合に備え、HP/MP/行動ゲージは全員リセットしておく。
    // ジョブの装備制限・装飾品の枠数に合わない装備（旧セーブから移した装備など）は所持品に戻す
    for (const c of S.roster) {
      normalizeCharEquip(c);
      const s = computeStats(c);
      c.hp = s.maxHp; c.mp = s.maxMp;
      c.alive = true; c.atb = 0; c.defending = false; c.actedFlash = 0;
    }
    const savedAutoRepeat = loaded.savedAutoRepeat;
    const savedAt = loaded.savedAt;
    lastSavedAt = typeof savedAt === "number" ? savedAt : null;
    if (savedAutoRepeat.some((ar) => ar && ar.active)) {
      if (store.getString(KEYS.offlineSettled) === String(savedAt)) {
        // このセーブの離脱期間は精算済み（精算後の保存に失敗していた）。二重付与を避けて自動周回を止めたまま再開する
      } else if (claimOfflineSettlement(savedAt)) {
        pendingOfflineSummaries = runOfflineProgress(savedAutoRepeat, savedAt);
      } else {
        offlineSettleFailed = true; // 保存できない状態で付与すると失われる/二重になるため、精算を見送る
      }
    }
    // 旧形式からの移行はその場で保存し直し、schemaVersion付きの内容が次回起動を待たず反映されるようにする
    if (pendingOfflineSummaries || loaded.isLegacy) saveGame();
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- Roster ----------
// 必要EXPの曲線(expForLevel)とセーブ読み込み時の再計算(syncExpToNext)は data.js で定義

// キャラまわりのルール（作成・EXP・転職・スキルツリー・能力値など）は js/model/roster.js
const Roster = QPModel.roster.createRoster({
  data: {
    JOBS, MONSTER_JOBS, RACES, GENERAL_SLOTS, expForLevel, isFeatureEnabled, jobTag,
    getExclusiveTreeByTag, getGeneralTree, getGeneralSlotDef, getAbilityById, itemStats,
    JOB_EQUIP, MONSTER_EQUIP, MONSTER_ACCESSORY_SLOT_LEVELS, ITEM_SERIES, getUniqueItem, itemOptionEffect,
  },
  state: S,
  runBuffs: (team) => Runner.runBuffs(team), // 石碑の加護（js/model/run.js）
  isTeamLocked: (team) => isTeamLocked(team),
});
const {
  gainExp, totalExpInvested, newCharacter, switchJob, jobUnlocked, jobDef, getExclusiveTree, getTreeState, generalSlotTreeDef, totalSp, spentSpFor, totalSpentSp, availableSp, canAcquireNode, acquireNode, canSwapGeneralSlot, swapGeneralSlot, treePassiveTotals, treePassive, computeStats, itemScore, racePassive,
  equipProfile, accessorySlots, canPlaceItem, setBonuses, gearPassive, partyBonus, availableAbilities, isSkillActive, subAbilityCandidates, teamMembers, activeParty, currentMaxLevel,
} = Roster;

const TEAM_NAMES = ["第一のパーティ", "第二のパーティ", "第三のパーティ", "第四のパーティ"];
const TEAM_LABELS = ["I", "II", "III", "IV"];


// ---------- Inventory ----------
// 所持品まわりのルール（装備・強化石・装備強化・ドロップの受け取り・モンスター合成）は js/model/inventory.js
const Inventory = QPModel.inventory.createInventory({
  data: { ENHANCE_RULES, ENHANCE_MAX_PLUS, RARITIES, fusionBaseExp, FUSION_SAME_RACE_MULT },
  state: S,
  roster: Roster,
  rng: RNG,
  isFeatureEnabled,
  onMaterialChange: (material) => store.set(KEYS.material, material), // 旧キーは互換ミラー
});
const {
  clampVitals, equipItem, unequipSlot, autoEquip, guaranteedStoneTotal, isPityReady, normalizeCharEquip,
} = Inventory;

// ---------- ダンジョン1周の進行 ----------
// チームごとの探索の状態(teamRuns / teamBattles)と、出発・戦闘・勝利・道中イベント・周回の終了・オフライン精算は
// js/model/run.js。ここではログの文章・画面の更新・次の処理までの待ち時間を受け持つ。
// computeStats が石碑の加護(teamRuns[].buffs)を参照するため、roster を組み立てる前に用意しておく
const Runner = QPModel.run.createRunner({
  data: { DUNGEONS, RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, rollItemDrop, rollSpecialDrop, getModeDungeon, ITEM_BASES },
  state: S,
  roster: Roster,
  inventory: Inventory,
  rng: RNG,
  teamCount: TEAM_COUNT,
  battleEnv: () => battleEnv(),
  autoDisassemble: () => ({ enabled: autoDisassemble, rarities: autoDisassembleRarities }),
  markDexSeen,
  setBestStage,
});
const { teamRuns, teamBattles, isTeamRunActive, isTeamLocked, runOfflineProgress } = Runner;
// 4チームがそれぞれ独立にダンジョンへ出撃できるよう、進行状態(run)・戦闘状態(battle)・
// 自動周回状態はすべてチームごとの配列で管理し、全チームが常に並行して進行する
let selectedDungeonId = null;
let jobsReturnScreen = "screen-battle"; // タイトルは常設ナビを持たないスプラッシュのため、既定の戻り先は探索画面にする
let speedMult = 1;

// 自動周回（チームごとに独立して設定・進行する）
const defaultAutoRepeatTarget = clampAutoRepeatTarget(store.getInt(KEYS.autoRepeatTarget, 5));
for (const ar of S.autoRepeat) ar.target = defaultAutoRepeatTarget;
function clampAutoRepeatTarget(n) { return AUTO_REPEAT_OPTIONS.includes(n) ? n : 5; }

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
// オフライン精算の保存保証（docs/reviews/design-review-2026-10-06.md RV-01）:
// 精算は「報酬の反映」と「自動周回の停止（S.autoRepeat[].active = false）」を同じメモリ上の状態に行い、
// それを1つのメインセーブとして1回で書き込んだ時点で確定する。精算済みかどうかは別キーの印ではなく、
// セーブの中の自動周回が止まっていることで分かる（止まったセーブからは二度と精算されない）。
// 保存に失敗した場合は端末には精算前のセーブが残るため、報酬は二重にも消失にもならず、
// アプリ内では定期保存で再試行し、保存されないまま終了した場合は次回起動時に同じ期間をもう一度精算する。
// 精算後のセーブを保存する。失敗したら、保存されるまで再試行することをモーダルで伝える
function saveAfterOfflineSettlement() {
  if (saveGame()) return true;
  offlineSettleFailed = true;
  return false;
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
      teamCount: TEAM_COUNT, maxPlus: ENHANCE_MAX_PLUS, ivRange: MONSTER_IV_RANGE,
    });
    if (!loaded) return false;
    Object.assign(S, loaded.state);
    store.set(KEYS.material, S.material);
    // 保存時に戦闘中だった場合に備え、HP/MP/行動ゲージは全員リセットしておく。
    // ジョブの装備制限・装飾品の枠数に合わない装備（旧セーブから移した装備など）は所持品に戻す
    for (const c of S.roster) {
      clampLevel(c); // 上限を超えたレベル（上限を入れる前のセーブ）は上限に戻す
      normalizeJob(c); // 機能フラグが無効な特殊職のキャラはほかのジョブへ戻す（docs/special-job-design.md §2.3）
      normalizeCharEquip(c);
      const s = computeStats(c);
      c.hp = s.maxHp; c.mp = s.maxMp;
      c.alive = true; c.atb = 0; c.defending = false; c.actedFlash = 0;
    }
    const savedAutoRepeat = loaded.savedAutoRepeat;
    const savedAt = loaded.savedAt;
    lastSavedAt = typeof savedAt === "number" ? savedAt : null;
    // 旧版の「精算済み」の印（精算前に書いていた別キー）は使わない。印だけ残って報酬が保存されていなかった
    // セーブも、自動周回が動いたままなので、ここでもう一度精算される
    store.remove(KEYS.offlineSettled);
    if (savedAutoRepeat.some((ar) => ar && ar.active)) {
      pendingOfflineSummaries = runOfflineProgress(savedAutoRepeat, savedAt);
    }
    if (pendingOfflineSummaries) saveAfterOfflineSettlement();
    // 旧形式からの移行はその場で保存し直し、schemaVersion付きの内容が次回起動を待たず反映されるようにする
    else if (loaded.isLegacy) saveGame();
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
    JOBS, MONSTER_JOBS, MONSTER_MAX_LEVEL, CHAR_MAX_LEVEL, RACES, GENERAL_SLOTS, expForLevel, isFeatureEnabled, jobTag,
    getExclusiveTreeByTag, getGeneralTree, getGeneralSlotDef, getAbilityById, itemStats,
    JOB_EQUIP, MONSTER_EQUIP, MONSTER_ACCESSORY_SLOT_LEVELS, ITEM_SERIES, getUniqueItem, itemOptionEffect, TREE_RESET_COST_PER_SP,
  },
  state: S,
  runBuffs: (team) => Runner.runBuffs(team), // 石碑の加護（js/model/run.js）
  isTeamLocked: (team) => isTeamLocked(team),
  onMaterialChange: (material) => store.set(KEYS.material, material), // ツリーの振り直しの費用（旧キーは互換ミラー）
});
const {
  gainExp, levelCap, isMaxLevel, clampLevel, totalExpInvested, newCharacter, switchJob, jobUnlocked, specialJobUnlocked, jobUsable, normalizeJob, soloBonus, jobDef, getExclusiveTree, getTreeState, generalSlotTreeDef, totalSp, spentSpFor, totalSpentSp, availableSp, canAcquireNode, acquireNode, canSwapGeneralSlot, swapGeneralSlot, treeResetCost, canResetTree, resetTree, treePassiveTotals, treePassive, computeStats, itemScore, racePassive,
  equipProfile, accessorySlots, canPlaceItem, setBonuses, gearPassive, partyBonus, availableAbilities, isSkillActive, subAbilityCandidates, teamMembers, activeParty, currentMaxLevel,
} = Roster;

const TEAM_NAMES = ["第一のパーティ", "第二のパーティ", "第三のパーティ", "第四のパーティ"];
const TEAM_LABELS = ["I", "II", "III", "IV"];


// ---------- Inventory ----------
// 所持品まわりのルール（装備・強化石・装備強化・ドロップの受け取り・モンスター合成）は js/model/inventory.js
const Inventory = QPModel.inventory.createInventory({
  data: { ENHANCE_RULES, ENHANCE_MAX_PLUS, RARITIES, fusionBaseExp, FUSION_SAME_RACE_MULT, MONSTER_IV_RANGE, MONSTER_IV_INHERIT },
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
// ---------- Shop ----------
// ショップ（買い切りの解放・確定強化石・仲間のBOX）と、仲間の上限の判定は js/model/shop.js
const Shop = QPModel.shop.createShop({
  data: { SHOP_PRODUCTS, ROSTER_CAPACITY, AUTO_REPEAT_CHOICES, BATTLE_SPEEDS, getDungeon, isFeatureEnabled },
  state: S,
});

const Runner = QPModel.run.createRunner({
  data: { DUNGEONS, RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, rollItemDrop, rollSpecialDrop, getModeDungeon, ITEM_BASES, MONSTER_IV_RANGE },
  state: S,
  roster: Roster,
  inventory: Inventory,
  rng: RNG,
  teamCount: TEAM_COUNT,
  battleEnv: () => battleEnv(),
  autoDisassemble: () => ({ enabled: autoDisassemble, rarities: autoDisassembleRarities }),
  markDexSeen,
  setBestStage,
  canAddMonster: () => Shop.canAddToRoster(1), // 仲間のBOXが満員の間はテイムしない
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

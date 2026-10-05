// ---------- 冒険の記録（model/records） ----------
// 書物（冒険者の書）に載せるための記録をまとめる。ゲームの状態（js/model/save.js の state.records）として
// メインセーブに入れるので、クラウドセーブにも一緒に保存される。画面には依存しない。
//   dungeonEncounters: { ダンジョンid: [そのダンジョンで出会った敵のキー, ...] }（モンスター辞典のダンジョン別の記録）
//   itemsFound: ["sword:n", ...]（手に入れた装備の種類とレア度。自動分解した物も含む。アイテム辞典）
//   runHistory: [{ at, team, dungeonId, cleared, ... }, ...]（ダンジョンに潜った履歴。新しい順に最大 RUN_HISTORY_MAX 件）
(function (root) {
  "use strict";

  const RUN_HISTORY_MAX = 50;

  function createRecords() {
    return { dungeonEncounters: {}, itemsFound: [], runHistory: [] };
  }

  // 装備の種類のキー（data.js の ITEM_BASES の key）。新しいアイテムは base を持つ。
  // 古いアイテムは部位と能力値の組み合わせ（ITEM_BASES の中で一意）から求める
  function itemBaseKey(item, itemBases) {
    if (item.base) return item.base;
    const base = (itemBases || []).find((b) => b.slot === item.slot && b.stat === item.stat);
    return base ? base.key : null;
  }
  function itemFoundKey(item, itemBases) {
    const base = itemBaseKey(item, itemBases);
    return base && item.rarity ? `${base}:${item.rarity}` : null;
  }

  function recordEncounter(records, dungeonId, enemyKey) {
    if (!dungeonId || !enemyKey) return false;
    const list = records.dungeonEncounters[dungeonId] || (records.dungeonEncounters[dungeonId] = []);
    if (list.includes(enemyKey)) return false;
    list.push(enemyKey);
    return true;
  }

  function recordItemsFound(records, items, itemBases) {
    let added = 0;
    for (const item of items) {
      const key = itemFoundKey(item, itemBases);
      if (key && !records.itemsFound.includes(key)) { records.itemsFound.push(key); added += 1; }
    }
    return added;
  }

  // 履歴の1件: { at, team, dungeonId, cleared, battlesWon, battles, exp, items, disassembled, material, tamed,
  //   offline（離れていた間の自動周回をまとめた記録なら true。その時は runs・clears も持つ） }
  function addRunHistory(records, entry) {
    records.runHistory.unshift(entry);
    if (records.runHistory.length > RUN_HISTORY_MAX) records.runHistory.length = RUN_HISTORY_MAX;
  }

  // セーブから読んだ値を使える形にそろえる（無い・壊れている項目は空にする）
  function normalizeRecords(data) {
    const r = createRecords();
    if (!data || typeof data !== "object") return r;
    if (data.dungeonEncounters && typeof data.dungeonEncounters === "object") {
      for (const [id, keys] of Object.entries(data.dungeonEncounters)) {
        if (Array.isArray(keys)) r.dungeonEncounters[id] = keys.filter((k) => typeof k === "string");
      }
    }
    if (Array.isArray(data.itemsFound)) r.itemsFound = data.itemsFound.filter((k) => typeof k === "string");
    if (Array.isArray(data.runHistory)) {
      r.runHistory = data.runHistory.filter((e) => e && typeof e === "object" && typeof e.dungeonId === "string").slice(0, RUN_HISTORY_MAX);
    }
    return r;
  }

  const exported = {
    RUN_HISTORY_MAX, createRecords, itemBaseKey, itemFoundKey,
    recordEncounter, recordItemsFound, addRunHistory, normalizeRecords,
  };
  root.QPModel = root.QPModel || {};
  root.QPModel.records = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

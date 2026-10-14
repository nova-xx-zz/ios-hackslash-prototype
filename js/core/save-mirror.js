// IndexedDBへの検証用コピー（正本は従来のlocalStorage）。
// 自動保存・自動復元・移行・削除は一切しない。コピーはユーザー操作時のみ。
(function(root) {
  "use strict";
  const STORE_NAME = "snapshots";
  const ACTIVE_ID = "active";
  function databaseName() {
    const channel = root.QPRuntime && root.QPRuntime.channel === "production" ? "production" : "preview";
    const debug = root.QPCore && root.QPCore.storage && root.QPCore.storage.isDebugMode();
    return "swordcrest-save-shadow-v1-" + channel + (debug ? "-debug" : "-normal");
  }
  function inspect(json, maxVersion) {
    if (typeof json !== "string" || !json) throw new Error("保存済みセーブがありません");
    let data;
    try { data = JSON.parse(json); } catch (_) { throw new Error("セーブのJSONが壊れています"); }
    if (!data || !Array.isArray(data.roster) || !data.roster.length ||
        (data.inventory !== undefined && !Array.isArray(data.inventory))) {
      throw new Error("セーブの内容を検証できません");
    }
    const version = data.schemaVersion;
    if (version !== undefined && (!Number.isInteger(version) || version < 1 ||
        version > maxVersion)) throw new Error("未対応のセーブ形式です");
    return {
      schemaVersion: version === undefined ? null : version,
      rosterCount: data.roster.length,
      inventoryCount: Array.isArray(data.inventory) ? data.inventory.length : 0,
      savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null
    };
  }
  async function hash(json, cryptoImpl) {
    if (!cryptoImpl || !cryptoImpl.subtle || typeof root.TextEncoder !== "function") {
      throw new Error("安全な照合に必要な暗号化APIを利用できません");
    }
    const bytes = new root.TextEncoder().encode(json);
    const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
    return {
      utf8Bytes: bytes.byteLength,
      sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
    };
  }
  function createIndexedDBBackend(indexedDB, name) {
    if (!indexedDB || typeof indexedDB.open !== "function") {
      throw new Error("この端末ではIndexedDBを利用できません");
    }
    let opening = null;
    function open() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(name || databaseName(), 1); }
        catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDBを開けません"));
        req.onblocked = () => reject(new Error("他の画面がIndexedDBの更新を妨げています"));
      });
      opening = opening.catch((e) => { opening = null; throw e; });
      return opening;
    }
    async function read(id) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        let value = null;
        req.onsuccess = () => { value = req.result || null; };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error("IndexedDBの読み込みに失敗しました"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDBの読み込みが中断されました"));
      });
    }
    async function write(record) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("IndexedDBへの書き込みに失敗しました"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDBへの書き込みが中断されました"));
      });
    }
    return { read, write };
  }
  // 既存の有効スロットを残したまま、反対側へ書く。検証してから有効ポインタを更新する。
  // このポインタは将来の移行検証用であり、ゲーム起動時には参照しない。
  async function copyVerified(opts) {
    opts = opts || {};
    const db = opts.backend;
    if (!db || typeof db.read !== "function" || typeof db.write !== "function") {
      throw new Error("検証用ストレージを利用できません");
    }
    const json = opts.json;
    const maxVersion = opts.maxSchemaVersion === undefined ? 2 : opts.maxSchemaVersion;
    const summary = inspect(json, maxVersion);
    const digest = await hash(json, opts.crypto || root.crypto);
    const prior = await db.read(ACTIVE_ID);
    if (prior && prior.slot !== "a" && prior.slot !== "b") {
      throw new Error("検証用コピーの管理情報が不正です");
    }
    const slot = prior && prior.slot === "a" ? "b" : "a";
    const meta = Object.assign({
      characters: json.length, utf8Bytes: digest.utf8Bytes, sha256: digest.sha256
    }, summary);
    // 2つのスロットを交互に使い、旧コピーは新コピーの照合完了まで保持する。
    await db.write({ id: slot, json, meta });
    const copied = await db.read(slot);
    if (!copied || copied.json !== json || !copied.meta ||
        copied.meta.sha256 !== meta.sha256 ||
        copied.meta.characters !== meta.characters ||
        copied.meta.utf8Bytes !== meta.utf8Bytes) {
      throw new Error("コピーの読み戻し結果が一致しません");
    }
    const copiedSummary = inspect(copied.json, maxVersion);
    const copiedDigest = await hash(copied.json, opts.crypto || root.crypto);
    if (copiedDigest.sha256 !== meta.sha256 || copiedDigest.utf8Bytes !== meta.utf8Bytes ||
        copiedSummary.schemaVersion !== meta.schemaVersion ||
        copiedSummary.inventoryCount !== meta.inventoryCount ||
        copiedSummary.rosterCount !== meta.rosterCount ||
        copiedSummary.savedAt !== meta.savedAt) {
      throw new Error("コピーの整合性検証に失敗しました");
    }
    await db.write({ id: ACTIVE_ID, slot });
    const active = await db.read(ACTIVE_ID);
    if (!active || active.slot !== slot) throw new Error("コピーの確定結果を確認できません");
    return Object.assign({ slot }, meta);
  }
  const api = { databaseName, inspect, createIndexedDBBackend, copyVerified };
  root.QPCore = root.QPCore || {};
  root.QPCore.saveMirror = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

// 数万件向けの分割スナップショット形式。現行localStorageは変更しない。
// 装備を含むJSONをUTF-8境界で分割し、全体/各片のSHA-256を検証する。
// 正本の切替・JSONの自動復元は行わない。
(function(root) {
  "use strict";
  const FORMAT_VERSION = 1;
  const DEFAULT_CHUNK_BYTES = 192 * 1024;
  const MAX_CHUNK_BYTES = 256 * 1024;
  const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
  const MAX_PARTS = 256;
  const POINTER = "scseg:active";

  function cryptoApi(override) {
    const c = override || root.crypto;
    if (!c || !c.subtle || typeof root.TextEncoder !== "function") {
      throw new Error("この環境ではSHA-256を利用できません");
    }
    return c;
  }
  function textBytes(value) { return new root.TextEncoder().encode(value); }
  async function sha256(value, crypto) {
    const bytes = textBytes(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  }
  function describe(json, maxVersion) {
    const checker = root.QPCore && root.QPCore.saveMirror;
    if (checker && checker.inspect) return checker.inspect(json, maxVersion);
    if (typeof json !== "string") throw new Error("セーブがありません");
    let d;
    try { d = JSON.parse(json); } catch (_) { throw new Error("JSONが不正です"); }
    if (!d || !Array.isArray(d.roster) || d.roster.length === 0 ||
        (d.inventory !== undefined && !Array.isArray(d.inventory)) ||
        (d.schemaVersion !== undefined && (!Number.isInteger(d.schemaVersion) ||
           d.schemaVersion < 1 || d.schemaVersion > maxVersion))) {
      throw new Error("未対応または不正なセーブです");
    }
    return {
      schemaVersion: d.schemaVersion === undefined ? null : d.schemaVersion,
      rosterCount: d.roster.length,
      inventoryCount: Array.isArray(d.inventory) ? d.inventory.length : 0,
      savedAt: Number.isFinite(d.savedAt) ? d.savedAt : null
    };
  }
  function splitUnicode(json, limit) {
    const parts = [];
    let start = 0, bytes = 0;
    for (let i = 0; i < json.length;) {
      const cp = json.codePointAt(i);
      const n = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      if (bytes + n > limit) {
        if (i === start) throw new Error("分割上限が小さすぎます");
        parts.push(json.slice(start, i));
        if (parts.length >= MAX_PARTS) throw new Error("分割数上限を超えています");
        start = i;
        bytes = 0;
      }
      bytes += n;
      i += cp > 0xffff ? 2 : 1;
    }
    if (start < json.length) parts.push(json.slice(start));
    return parts;
  }
  function validManifest(m) {
    return m && m.formatVersion === FORMAT_VERSION &&
      Number.isInteger(m.chunkBytes) && m.chunkBytes >= 4096 && m.chunkBytes <= MAX_CHUNK_BYTES &&
      Number.isInteger(m.totalBytes) && m.totalBytes > 0 && m.totalBytes <= MAX_TOTAL_BYTES &&
      Number.isInteger(m.totalCharacters) && m.totalCharacters > 0 &&
      typeof m.sha256 === "string" && /^[a-f0-9]{64}$/.test(m.sha256) &&
      Array.isArray(m.parts) && m.parts.length >= 1 && m.parts.length <= MAX_PARTS &&
      m.parts.every((p, i) => p && p.index === i &&
        Number.isInteger(p.bytes) && p.bytes > 0 && p.bytes <= m.chunkBytes &&
        Number.isInteger(p.characters) && p.characters > 0 &&
        typeof p.sha256 === "string" && /^[a-f0-9]{64}$/.test(p.sha256));
  }
  async function pack(json, options) {
    options = options || {};
    const crypto = cryptoApi(options.crypto);
    const maxVersion = options.maxSchemaVersion === undefined ? 2 : options.maxSchemaVersion;
    const meta = describe(json, maxVersion);
    const limit = options.chunkBytes === undefined ? DEFAULT_CHUNK_BYTES : options.chunkBytes;
    if (!Number.isInteger(limit) || limit < 4096 || limit > MAX_CHUNK_BYTES) {
      throw new Error("無効な分割サイズです");
    }
    if (json.length > MAX_TOTAL_BYTES) throw new Error("セーブが分割上限を超えています");
    const totalBytes = textBytes(json).length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("セーブが分割上限を超えています");
    const parts = splitUnicode(json, limit);
    const list = [];
    for (let i = 0; i < parts.length; i++) {
      list.push({ index: i, bytes: textBytes(parts[i]).length, characters: parts[i].length,
        sha256: await sha256(parts[i], crypto) });
    }
    return { manifest: Object.assign({
      formatVersion: FORMAT_VERSION, chunkBytes: limit,
      totalBytes, totalCharacters: json.length, sha256: await sha256(json, crypto),
      parts: list
    }, meta), chunks: parts };
  }
  async function unpack(manifest, chunks, options) {
    options = options || {};
    const crypto = cryptoApi(options.crypto);
    if (!validManifest(manifest) || !Array.isArray(chunks) || chunks.length !== manifest.parts.length) {
      throw new Error("分割セーブの一覧が不正です");
    }
    let bytes = 0, chars = 0;
    for (let i = 0; i < chunks.length; i++) {
      const item = chunks[i], part = manifest.parts[i];
      if (typeof item !== "string") throw new Error("分割セーブが欠落しています");
      const actualBytes = textBytes(item).length;
      if (actualBytes !== part.bytes || item.length !== part.characters ||
          await sha256(item, crypto) !== part.sha256) {
        throw new Error("分割セーブの破損を検出しました");
      }
      bytes += actualBytes; chars += item.length;
    }
    if (bytes !== manifest.totalBytes || chars !== manifest.totalCharacters) {
      throw new Error("セーブサイズが一致しません");
    }
    const json = chunks.join("");
    if (await sha256(json, crypto) !== manifest.sha256) throw new Error("セーブ全体の照合に失敗しました");
    const maxVersion = options.maxSchemaVersion === undefined ? 2 : options.maxSchemaVersion;
    const meta = describe(json, maxVersion);
    for (const k of ["schemaVersion", "rosterCount", "inventoryCount", "savedAt"]) {
      if (meta[k] !== manifest[k]) throw new Error("セーブの内容が一致しません");
    }
    return json;
  }
  function generationId(crypto) {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues !== "function") throw new Error("識別子を生成できません");
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  // 設定ボタンで明示操作したときだけ実行する。旧localStorageと既存save-mirrorは操作しない。
  // 記録は不変のgeneration IDで保存。途中失敗ならactiveポインタは従来のまま。
  async function copyToIndexedDB(backend, json, options) {
    options = options || {};
    if (!backend || typeof backend.read !== "function" || typeof backend.write !== "function") {
      throw new Error("検証用保存先がありません");
    }
    const crypto = cryptoApi(options.crypto);
    const { manifest, chunks } = await pack(json, options);
    const id = generationId(crypto);
    const base = "scseg:" + id + ":";
    for (let i = 0; i < chunks.length; i++) {
      await backend.write({ id: base + i, value: chunks[i] });
    }
    await backend.write({ id: base + "manifest", value: manifest });
    const readManifest = await backend.read(base + "manifest");
    const readChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const record = await backend.read(base + i);
      readChunks.push(record && record.value);
    }
    if (!readManifest || await unpack(readManifest.value, readChunks, options) !== json) {
      throw new Error("読み戻したセーブが元データと一致しません");
    }
    await backend.write({ id: POINTER, generation: id });
    const active = await backend.read(POINTER);
    if (!active || active.generation !== id) throw new Error("分割コピーの確定を確認できません");
    return { generation: id, manifest };
  }
  async function readIndexedDBCopy(backend, options) {
    options = options || {};
    const active = await backend.read(POINTER);
    if (!active || typeof active.generation !== "string" || !/^[a-f0-9-]{32,36}$/.test(active.generation)) {
      return null;
    }
    const base = "scseg:" + active.generation + ":";
    const rec = await backend.read(base + "manifest");
    if (!rec) throw new Error("検証コピーの管理データが欠落しています");
    const chunks = [];
    if (!validManifest(rec.value)) throw new Error("検証コピーの分割情報が不正です");
    for (let i = 0; i < rec.value.parts.length; i++) {
      const p = await backend.read(base + i);
      chunks.push(p && p.value);
    }
    return unpack(rec.value, chunks, options);
  }

  const exported = { FORMAT_VERSION, DEFAULT_CHUNK_BYTES, MAX_TOTAL_BYTES,
    pack, unpack, copyToIndexedDB, readIndexedDBCopy };
  root.QPCore = root.QPCore || {};
  root.QPCore.saveSegments = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

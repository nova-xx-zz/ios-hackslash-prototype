// 大容量クラウドバックアップV2: 転送先に依存しない整合性検証層。
// Firestore/Cloud Storageへの実ネットワーク接続や権限解放は別工程。現行cloud.jsからは呼ばない。
// adapterのcommitPointerはサーバー側の所有者認可・revision CASが必須（クライアント判定不可）。
(function(root){
  "use strict";
  const segments = (root.QPCore && root.QPCore.saveSegments) ||
    (typeof require === "function" ? require("./save-segments.js") : null);
  function requireAdapter(a) {
    if (!a || !["getPointer","putPart","getPart","commitPointer"].every(k => typeof a[k] === "function")) {
      throw new Error("クラウドV2転送アダプタが未設定です");
    }
  }
  function randomGeneration(crypto) {
    if (!crypto) throw new Error("暗号化APIがありません");
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues !== "function") throw new Error("安全なIDを作成できません");
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function version(pointer) {
    if (pointer === null || pointer === undefined) return 0;
    if (!pointer || !Number.isSafeInteger(pointer.revision) || pointer.revision < 1) {
      throw new Error("クラウドのリビジョンが不正です");
    }
    return pointer.revision;
  }
  function validPointer(pointer) {
    return pointer && pointer.formatVersion === 1 &&
      typeof pointer.generation === "string" && /^[a-f0-9-]{32,36}$/.test(pointer.generation) &&
      Number.isSafeInteger(pointer.revision) && pointer.revision >= 1 &&
      pointer.manifest && pointer.manifest.formatVersion === 1;
  }
  // 不変generationへのアップロード→全チャンク読み戻し→整合性検証→最後にmanifestのCAS。
  // CAS拒否時や一部アップロード失敗時は旧manifestを残し、自動削除・自動リトライしない。
  async function upload(adapter, json, options) {
    options = options || {};
    requireAdapter(adapter);
    const crypto = options.crypto || root.crypto;
    const before = await adapter.getPointer();
    const baseRevision = version(before);
    const packed = await segments.pack(json, options);
    const generation = randomGeneration(crypto);
    for (let i = 0; i < packed.chunks.length; i++) {
      await adapter.putPart(generation, i, packed.chunks[i]);
    }
    const roundTrip = [];
    for (let i = 0; i < packed.chunks.length; i++) {
      roundTrip.push(await adapter.getPart(generation, i));
    }
    if (await segments.unpack(packed.manifest, roundTrip, options) !== json) {
      throw new Error("アップロード後の読み戻しが一致しません");
    }
    const next = {
      formatVersion: 1, revision: baseRevision + 1, generation,
      manifest: packed.manifest
    };
    // CASは必ずバックエンドのトランザクション/ETag等で原子的に行う。
    const committed = await adapter.commitPointer(baseRevision, next);
    if (committed !== true) throw new Error("別の端末が先に保存しました。クラウドのデータは上書きしていません");
    return { revision: next.revision, generation, totalBytes: packed.manifest.totalBytes,
      partCount: packed.manifest.parts.length, inventoryCount: packed.manifest.inventoryCount };
  }
  // バックアップ候補を検証して返すだけ。端末セーブの上書きや有償権利の付与はしない。
  async function download(adapter, options) {
    options = options || {};
    requireAdapter(adapter);
    const p = await adapter.getPointer();
    if (p === null || p === undefined) return null;
    if (!validPointer(p)) throw new Error("クラウドの保存情報が不正です");
    const parts = [];
    if (!Array.isArray(p.manifest.parts) || p.manifest.parts.length > 256) {
      throw new Error("不正な分割数です");
    }
    for (let i = 0; i < p.manifest.parts.length; i++) {
      parts.push(await adapter.getPart(p.generation, i));
    }
    const json = await segments.unpack(p.manifest, parts, options);
    return { json, revision: p.revision, savedAt: p.manifest.savedAt };
  }
  const api = { upload, download };
  root.QPCore = root.QPCore || {};
  root.QPCore.cloudLargeBackup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

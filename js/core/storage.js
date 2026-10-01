// ---------- 永続化の窓口（storage） ----------
// ゲーム本体はlocalStorageを直接触らず、必ずここを通す。
// 本番化（docs/production-plan.md §3）では、backendをCapacitorのPreferences/SQLiteや
// サーバー同期に差し替えるだけで済むようにするための層。
// ブラウザでは<script>で読み込んで globalThis.QPCore.storage として、Node.js（テスト）では require で使う。
(function (root) {
  "use strict";

  // 端末に保存するキーの一覧（キー名は既存セーブとの互換のため変更しない）
  const KEYS = {
    save: "jobquest_save_v1", // メインセーブ（schemaVersionで拡張フィールドを管理）
    bestCleared: "jobquest_best_cleared",
    material: "jobquest_material", // schemaVersion 2以降は互換ミラー（正本はメインセーブ）
    autoDisassemble: "jobquest_autodisassemble",
    autoDisassembleFilter: "jobquest_autodisassemble_filter",
    autoRepeatTarget: "jobquest_autorepeat_target",
    dexSeen: "jobquest_dex_seen",
    readAnnouncements: "jobquest_read_announcements",
    // オフライン進行を精算済みのセーブのsavedAt（同じ離脱期間の二重精算を防ぐ）
    offlineSettled: "jobquest_offline_settled",
  };

  // backend は getItem/setItem/removeItem を持つオブジェクト（localStorage互換）。
  // 書き込みは容量超過（QuotaExceededError）などで例外になり得るため、例外を外へ出さずに
  // falseを返し、onWriteErrorで呼び出し側へ知らせる（ゲーム進行を止めないため）
  function createStorage(backend, opts) {
    opts = opts || {};
    const onWriteError = opts.onWriteError || function () {};

    function getRaw(key) {
      if (!backend) return null;
      try { return backend.getItem(key); } catch (e) { return null; }
    }

    const api = {
      getString(key, fallback) {
        const raw = getRaw(key);
        return raw === null || raw === undefined ? (fallback === undefined ? null : fallback) : raw;
      },
      getInt(key, fallback) {
        const n = parseInt(getRaw(key), 10);
        return Number.isFinite(n) ? n : fallback;
      },
      // 壊れた値・未保存はfallbackを返す
      getJSON(key, fallback) {
        const raw = getRaw(key);
        if (raw === null || raw === undefined) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
      },
      set(key, value) {
        if (!backend) { onWriteError(new Error("storage unavailable"), key); return false; }
        try {
          backend.setItem(key, String(value));
          return true;
        } catch (e) {
          onWriteError(e, key);
          return false;
        }
      },
      setJSON(key, value) {
        let json;
        try { json = JSON.stringify(value); } catch (e) { return false; }
        return api.set(key, json);
      },
      remove(key) {
        if (!backend) return;
        try { backend.removeItem(key); } catch (e) { /* 削除の失敗は無視してよい */ }
      },
    };
    return api;
  }

  // テスト・検証用のメモリ上のbackend。maxChars を指定すると、保存済みの合計文字数が
  // それを超える書き込みで QuotaExceededError 相当の例外を投げる（容量超過の再現用）
  function createMemoryBackend(initial, maxChars) {
    const data = new Map(Object.entries(initial || {}));
    const size = () => [...data].reduce((s, [k, v]) => s + k.length + v.length, 0);
    return {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem(k, v) {
        const prev = data.has(k) ? k.length + data.get(k).length : 0;
        if (maxChars !== undefined && size() - prev + k.length + String(v).length > maxChars) {
          const err = new Error("quota exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
        data.set(k, String(v));
      },
      removeItem: (k) => { data.delete(k); },
      dump: () => Object.fromEntries(data),
    };
  }

  // ブラウザのlocalStorage（プライベートモード等で触れない場合はnull）
  function defaultBackend() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  const exported = { KEYS, createStorage, createMemoryBackend, defaultBackend };
  root.QPCore = root.QPCore || {};
  root.QPCore.storage = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ---------- 乱数（rng） ----------
// ゲーム内の抽選はMath.randomを直接呼ばず、すべてここを通す。
// - テストではシード付きの乱数に差し替えて、結果を再現できるようにする
// - 本番化（docs/production-plan.md §3.2）でドロップ・強化などの抽選をサーバーへ移す際、
//   同じ関数をサーバー側の乱数で動かせるようにする
// ブラウザでは<script>で読み込んで globalThis.QPCore.rng として、Node.js（テスト）では require で使う。
(function (root) {
  "use strict";

  // 0以上1未満を返す関数（source）から、ゲームで使う抽選関数一式を作る
  function fromSource(source) {
    const api = {
      next: () => source(),
      float: (a, b) => a + source() * (b - a), // a以上b未満
      int: (n) => Math.floor(source() * n), // 0以上n未満の整数
      chance: (p) => source() < p, // 確率pでtrue
      pick: (arr) => arr[Math.floor(source() * arr.length)],
    };
    return api;
  }

  // シード付きの乱数（mulberry32）。同じシードなら同じ並びになる
  function seededSource(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    return fromSource(seed === undefined ? Math.random : seededSource(seed));
  }

  // ゲーム全体で共有する乱数。sourceは差し替え可能（テスト・検証用）
  let sharedSource = Math.random;
  const shared = fromSource(() => sharedSource());
  function setSharedSource(source) { sharedSource = source || Math.random; }
  function setSharedSeed(seed) { setSharedSource(seed === undefined ? null : seededSource(seed)); }

  const exported = { createRng, fromSource, seededSource, shared, setSharedSource, setSharedSeed };
  root.QPCore = root.QPCore || {};
  root.QPCore.rng = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

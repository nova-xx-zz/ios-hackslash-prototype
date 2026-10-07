// ---------- 確認用モード（?debug）の合言葉 ----------
// storage.js より前に読み込む。URLに ?debug を付けて開いた時、この端末でまだ合言葉を入れていなければ聞く。
// 合っていれば端末に覚え（UNLOCK_KEY）、確認用モードで開く。違っていれば、ふつうのモードで開く。
// 合言葉そのものはコードに書かず、SHA-256のハッシュだけを持つ（公開リポジトリのため）。
// プロトタイプ用の簡単な守りで、テストプレイヤーがうっかり入るのを防ぐためのもの（強い守りではない）
(function (root) {
  "use strict";
  const UNLOCK_KEY = "qp_debug_unlocked";
  const PASS_HASH = "dbf31640c0ee04b6a4924526d07be96a6ee19dd60fd7233a83bb0556f753a7fc";

  // SHA-256（UTF-8の文字列 → 16進数）。起動の前に同期で確かめたいので、crypto.subtle（非同期）は使わない
  function sha256(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const K = [];
    const isPrime = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    const H = [];
    for (let n = 2, i = 0; i < 64; n++) {
      if (!isPrime(n)) continue;
      if (i < 8) H.push(frac(Math.pow(n, 1 / 2)));
      K.push(frac(Math.pow(n, 1 / 3)));
      i++;
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      const w = new Array(64);
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function requested() {
    try { return /[?&]debug(?:[=&]|$)/.test((root.location && root.location.search) || ""); } catch (e) { return false; }
  }
  function unlocked() {
    try { return root.localStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; }
  }

  const exported = { UNLOCK_KEY, PASS_HASH, sha256, requested, unlocked };
  root.QPDebugGate = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;

  // ブラウザで ?debug を付けて開いた時だけ、合言葉を聞く
  if (typeof document !== "undefined" && requested() && !unlocked()) {
    const input = root.prompt ? root.prompt("確認用モードの合言葉を入力してください") : null;
    if (input !== null && sha256(input.trim()) === PASS_HASH) {
      try { root.localStorage.setItem(UNLOCK_KEY, "1"); } catch (e) { /* 覚えられない時は、次回また聞く */ }
    } else if (input !== null) {
      root.alert && root.alert("合言葉が違います。ふつうのモードで開きます");
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

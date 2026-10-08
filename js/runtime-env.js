// ソース直配信と通常の cap:sync は検証環境。正式配布は build:release:* を使用する。
// このフラグはユーザーのブラウザ上で変更可能な UI ガードであり、購入の認可には使わない。
(function (root) {
  "use strict";
  root.QPRuntime = Object.freeze({ channel: "preview", platform: "web", allowDebug: true, allowTestPurchases: true });
})(typeof globalThis !== "undefined" ? globalThis : this);

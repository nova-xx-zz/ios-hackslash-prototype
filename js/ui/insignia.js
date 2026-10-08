// ---------- 職業紋章（金色の線画アイコン） ----------
// ジョブのアイコンは絵文字（data.js の icon）ではなく、この線画のSVGで描く（探索画面の仲間カード・
// キャラ詳細のジョブタブ・キャラ作成のジョブ選択で共通）。色は親要素の color（currentColor）に従う。
// 基本職: 剣（せんし）・杖（まほうつかい）・十字（そうりょ）・短剣（とうぞく）・拳（ぶとうか）・月（あんこくし）。
// 上級職は対応する基本職を発展させた形にする（剣→二刀、杖→炎の宝珠の杖、十字→光輪の十字、短剣→手裏剣、
// 拳→蓮と光、月→大鎌）。特殊職の巡礼剣士は巡礼の杖と剣。モンスター・未定義の職業には共通の盾を表示する
"use strict";

const JOB_INSIGNIA_PATHS = {
  warrior: '<path d="m5 19 12-12 2-4-4 2L3 17m1-4 7 7m-5-2-3 3"/>',
  mage: '<path d="m6 21 9-14M15 2v3m-5 2h3m5 0h3m-6 3v3m0-8 2 2-2 2-2-2Z"/>',
  priest: '<path d="M12 2v20M4 9h16m-8-7 3 4-3 3-3-3Z"/>',
  thief: '<path d="M12 2.5 14.5 8v6.5h-5V8ZM12 8v6.5M7.5 14.5h9M12 14.5v4.5"/><circle cx="12" cy="20.5" r="1.5"/>',
  monk: '<path d="M7 11V7a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7l-3 6H8l-5-7a2 2 0 0 1 3-2l3 3"/>',
  darkknight: '<path d="M17 3a9 9 0 1 0 4 13A8 8 0 0 1 17 3Z"/>',
  swordmaster: '<path d="M3 3l12.5 12.5M13 17.5l4.5-4.5M16.5 16.5 21 21M21 3 8.5 15.5M6.5 13l4.5 4.5M7.5 16.5 3 21"/>',
  archmage: '<path d="M5 22 13.5 10"/><circle cx="16" cy="7.5" r="3"/><path d="M16 1.5c-1.6 1.6-1.2 2.6 0 3.5 1.2-.9 1.6-1.9 0-3.5ZM11 14l-2.5-.5M14 17l.5 2.5"/>',
  archpriest: '<circle cx="12" cy="9" r="4.5"/><path d="M12 2v20M4.5 9h15M9 19h6"/>',
  ninja: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z"/><circle cx="12" cy="12" r="2"/>',
  saintfist: '<path d="M12 21c-4.5 0-8-3-9-7 3.5 0 6.5 1.3 9 4 2.5-2.7 5.5-4 9-4-1 4-4.5 7-9 7Z"/><path d="M12 18c-2-2.2-3-5.2-2-9 1 .8 2 2 2 2s1-1.2 2-2c1 3.8 0 6.8-2 9ZM12 2v3M4.5 5.5 6.5 7.5M19.5 5.5l-2 2"/>',
  reaper: '<path d="M7 22 16.5 3"/><path d="M16 4C11.5 2.5 6 4.5 3.5 9c3.5-2 8-2.3 11.4-.8"/>',
  pilgrim: '<path d="M6 22V7.5a3 3 0 1 1 5 2.2"/><path d="M17 2.5V15m-3 0h6m-3 0v6"/><circle cx="8.5" cy="13.5" r="1.3"/>',
};
const JOB_INSIGNIA_DEFAULT = '<path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Z"/><path d="m9 12 3-3 3 3-3 3Z"/>';

function jobInsignia(jobId) {
  const shape = JOB_INSIGNIA_PATHS[jobId] || JOB_INSIGNIA_DEFAULT;
  return `<svg class="job-insignia" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

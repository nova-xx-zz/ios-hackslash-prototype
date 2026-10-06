// 実行: node --test（リポジトリ直下で）
// 自動周回の完了通知の予定（js/core/notices.js）
const test = require("node:test");
const assert = require("node:assert/strict");
const notices = require("../js/core/notices.js");

const H = 3600 * 1000;
const team = (over) => Object.assign({ team: 0, teamName: "第一のパーティ", dungeonName: "忘れられた遺跡", target: 20, done: 5, runSeconds: 60 }, over);

test("残りの周回×1周の時間で、終わる頃の時刻に通知する（チームごとにid）", () => {
  const plan = notices.planAutoRepeatNotices([team(), team({ team: 2, teamName: "第三のパーティ", done: 18 })], 1000, 8 * H);
  assert.equal(plan.length, 2);
  assert.deepEqual([plan[0].id, plan[0].at], [notices.NOTICE_ID_BASE, 1000 + 15 * 60 * 1000]);
  assert.match(plan[0].body, /第一のパーティ.*忘れられた遺跡.*残り15周/);
  assert.deepEqual([plan[1].id, plan[1].at], [notices.NOTICE_ID_BASE + 2, 1000 + 2 * 60 * 1000]);
});

test("精算できる上限（8時間）より長くかかる時は、上限の時刻に知らせる", () => {
  const [n] = notices.planAutoRepeatNotices([team({ target: 1000, done: 0, runSeconds: 120 })], 0, 8 * H);
  assert.equal(n.at, 8 * H);
  assert.match(n.body, /上限（8時間）/);
});

test("残りが無い・1周の時間が分からないチームは通知しない。idの一覧はチーム数ぶん", () => {
  assert.deepEqual(notices.planAutoRepeatNotices([team({ done: 20 }), team({ runSeconds: 0 })], 0, 8 * H), []);
  assert.deepEqual(notices.noticeIds(4), [7100, 7101, 7102, 7103]);
});

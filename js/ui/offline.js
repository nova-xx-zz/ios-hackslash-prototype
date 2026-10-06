// ---------- 画面: オフライン精算の結果表示・スターターロスター ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- 自動周回のオフライン進行 ----------
// 離れていた間の周回の計算と反映は js/model/run.js（runOfflineProgress）。ここは結果の表示
function showOfflineModal(summaries) {
  const blocks = summaries.map((summary) => {
    if (summary.tooShort) {
      return `【${TEAM_LABELS[summary.team]}】「${summary.dungeonName}」: 離れていた時間が1周ぶんに満たなかったため、オフライン中の周回はありませんでした`;
    }
    const lines = [`【${TEAM_LABELS[summary.team]}】「${summary.dungeonName}」を ${summary.cleared}周 クリアしました`];
    if (summary.cleared > 0 || summary.expGained > 0) {
      lines.push(`獲得EXP: +${summary.expGained}　獲得アイテム: ${summary.itemsGained}個`);
    }
    if (summary.tamedNames.length) lines.push(`テイム: ${summary.tamedNames.join("・")}`);
    if (summary.wipedOut) lines.push("パーティが全滅したため、途中で自動周回が停止しました");
    return lines.join("<br>");
  });
  blocks.push("自動周回は停止中です。続けるには各チームで「自動周回開始」を押してください");
  document.getElementById("offlineDesc").innerHTML = blocks.join("<br><br>");
  document.getElementById("offlineModal").classList.remove("hidden");
}
function showOfflineSettleFailedModal() {
  document.getElementById("offlineDesc").innerHTML =
    "端末の保存容量が不足しているため、離れていた間の自動周回の結果をまだ保存できていません。<br><br>" +
    "保存できるようになると自動で保存されます（自動分解の対象レア度を増やすと所持品を減らせます）。" +
    "保存される前にアプリを閉じた場合は、次回起動時にもう一度精算されるので、報酬が失われたり二重にもらえたりすることはありません";
  document.getElementById("offlineModal").classList.remove("hidden");
}
document.getElementById("btnOfflineClose").addEventListener("click", () => {
  document.getElementById("offlineModal").classList.add("hidden");
  processModalQueue();
});

S.roster = [
  newCharacter("アレン", "warrior", "human", { team: 0 }),
  newCharacter("ガイ", "warrior", "beastkin", { team: 0 }),
  newCharacter("ミナ", "mage", "sylvan", { team: 0 }),
  newCharacter("ノア", "mage", "nocturne", { team: 0 }),
  newCharacter("ルカ", "priest", "stonekin", { team: 0 }),
];

function isDungeonOpen(d) {
  if (S.clearedDungeons.has(d.id)) return true;
  if (d.id === DUNGEONS[0].id) return true;
  return DUNGEONS.some((src) => S.clearedDungeons.has(src.id) && src.unlocks.includes(d.id));
}

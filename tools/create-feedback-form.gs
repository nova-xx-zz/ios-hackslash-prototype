/**
 * ソードクレスト｜プレリリースお問い合わせフォームを1回だけ作成する。
 *
 * 使い方: https://script.google.com/ で新規プロジェクトを作り、
 * この内容を貼って createSwordcrestFeedbackForm() を実行し、権限を承認する。
 * 実行ログの「回答URL」を js/contact-config.js に設定する。
 * 注意: 再実行すると別のフォーム/スプレッドシートが作られる。
 */
function createSwordcrestFeedbackForm() {
  const form = FormApp.create("ソードクレスト｜お問い合わせ・不具合報告", true);
  form.setDescription(
    "ソードクレストのプレリリースにご協力ありがとうございます。\n" +
    "不具合・改善要望・ご質問をお送りください。\n" +
    "回答は改善および必要に応じた返信のために利用します。\n" +
    "パスワード、セーブデータ、決済情報、他人の個人情報は送信しないでください。"
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false); // 何度でも不具合を報告できる
  form.setPublishingSummary(false);
  form.setShowLinkToRespondAgain(true);
  form.setConfirmationMessage("ご報告ありがとうございます。今後の改善に活用します。");

  form.addMultipleChoiceItem().setTitle("お問い合わせ種別")
    .setChoiceValues(["不具合報告", "改善要望", "質問", "その他"]).setRequired(true);
  form.addMultipleChoiceItem().setTitle("発生した画面")
    .setChoiceValues(["探索・戦闘", "ジョブ・スキル", "装備・鍛冶屋", "編成・仲間", "ショップ", "セーブ・ログイン", "その他"])
    .setRequired(true);
  form.addParagraphTextItem().setTitle("内容").setRequired(true)
    .setHelpText("何が起こったか、期待した動作と実際の動作など");
  form.addParagraphTextItem().setTitle("再現手順（任意）")
    .setHelpText("例: 探索→〇〇ダンジョン→周回開始→エラー");
  form.addMultipleChoiceItem().setTitle("利用環境（任意）")
    .setChoiceValues(["iPhone Safari", "iPhone Chrome", "Android Chrome", "PC Chrome", "PC Safari", "その他"]);
  form.addTextItem().setTitle("ゲームバージョン（任意）");
  form.addTextItem().setTitle("返信先メールアドレス（任意）")
    .setHelpText("返信が必要な場合だけ入力。メールアドレスがなくても送信できます");

  const sheet = SpreadsheetApp.create("ソードクレスト｜プレリリース問い合わせ一覧");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  form.setAcceptingResponses(true);

  Logger.log("回答URL: " + form.getPublishedUrl());
  Logger.log("編集URL（公開しない）: " + form.getEditUrl());
  Logger.log("回答一覧（公開しない）: " + sheet.getUrl());
}

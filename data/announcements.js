// 冒険者ギルドからのお知らせ（配信データ）
// フィールドの意味は docs/detailed-design.md §6.4 を参照。
// id は安定ID。本文を重要に改訂するときだけrevisionを上げる（既読はrevision単位で判定）。
// publishedAt/expiresAtはISO 8601（タイムゾーン付き）。UIの日付表示はAsia/Tokyo。
const ANNOUNCEMENTS = [
  {
    id: "update_taming",
    revision: 1,
    publishedAt: "2026-10-06T21:00:00+09:00",
    expiresAt: null,
    category: "update",
    title: "テイムできるモンスターが37種類に",
    body: [
      "テイムできるモンスターを、地方ごとに5〜6種類（全37種類）に増やしました。種類ごとに得意なこと（打たれ強い・素早い・魔法・回復など）と専用の技があります。",
      "モンスター合成で「まとめて選ぶ」が使えるようになりました（すべて・種族ごと）。",
      "テイムしたモンスターは、能力値タブの「お気に入りにする」で★を付けられます。★のモンスターは合成の素材に選ばれません。",
      "モンスター辞典は魔物の絵を外して、名前と属性（テイムできる魔物は「テイム可」）だけの表示にしました。",
    ],
    showOnStartup: true,
    priority: "normal",
    forceDisplay: false,
    visible: true,
  },
  {
    id: "skill_tree_release",
    revision: 1,
    publishedAt: "2026-09-30T01:00:00+09:00",
    expiresAt: null,
    category: "update", // notice / update / balance / preview
    title: "スキルツリーを追加しました",
    body: [
      "レベルアップで獲得するSPを使って、ジョブごとの系統ツリーからパッシブ効果や専用の技を習得できるようになりました。",
      "キャラ詳細画面の「ツリー」タブから確認・習得できます。",
    ],
    showOnStartup: true,
    priority: "normal",
    forceDisplay: false,
    visible: true,
  },
  {
    id: "job_mastery_teaser",
    revision: 1,
    publishedAt: "2026-09-30T00:00:00+09:00",
    expiresAt: null,
    category: "preview", // notice / update / balance / preview
    title: "？？？",
    body: [
      "極めし者に、新たな道が開かれる。",
      "詳細は後日公開します。",
    ],
    showOnStartup: true,
    priority: "normal", // normal / important
    forceDisplay: false,
    visible: true,
  },
];

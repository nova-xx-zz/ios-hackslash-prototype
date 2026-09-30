// 今後の予定（配信データ）。現時点で公表できる情報だけを載せる。
// status: released(公開済み) / development(開発中) / planned(公開予定)
// disclosureStage: teaser(伏せ字) / named(名称・対象) / conditions(解放条件・一部能力) / released(全仕様)
// 未解禁の対象・条件・性能はここに含めない（隠すのではなく、まだ書かない）。
const ROADMAP = [
  {
    id: "guild_announcements",
    status: "released",
    timingLabel: "公開済み",
    disclosureStage: "released",
    title: "冒険者ギルドからのお知らせ",
    summary: "お知らせ・今後の予定をこの画面で確認できます。",
  },
  {
    id: "skill_tree",
    status: "released",
    timingLabel: "公開済み",
    disclosureStage: "released",
    title: "スキルツリー",
    summary: "キャラ詳細の「ツリー」タブで確認できます。レベルアップで得るSPを消費して、ジョブの系統ごとに用意されたツリーのパッシブ・専用技を習得できます。",
  },
  {
    id: "skill_book",
    status: "planned",
    timingLabel: "公開時期未定",
    disclosureStage: "teaser",
    title: "？？？",
    summary: "新たな育成要素を準備中です。",
  },
  {
    id: "job_mastery",
    status: "planned",
    timingLabel: "公開時期未定",
    disclosureStage: "teaser",
    title: "？？？",
    summary: "極めし者に、新たな道が開かれる。",
  },
];

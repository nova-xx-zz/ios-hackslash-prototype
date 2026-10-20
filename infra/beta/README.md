# β限定公開：Firebase招待者の認可基盤

**状態：コード/Rules案のみ。Firebase Emulator検証・実Firebase設定・デプロイ未実施。公開不可。**

## 分離と保証範囲

- 対象は旧Preview `sword-crest-jp` や正式 `swordcrest` とは別の **β専用Firebaseプロジェクト**。
- `firestore.beta.rules`：Google認証本人の `betaMembers/{uid}` の閲覧、**招待が有効かつ期限内の本人 `saves/{uid}` への限定アクセス**のみ許可。招待メンバー/管理台帳はクライアントから変更できない。
- `betaControl/state` に上限30と現在の有効招待枠数を保存。`infra/beta/invites.js` が Admin SDK トランザクションで原子的に登録・失効を行う。
- UIDはGoogle認証したFirebaseユーザーのもの。Xアカウント名やメールアドレスを本人と偽ってクライアントから送るだけでは招待権限にならない。
- セーブ本文は従来どおりクライアント正本のβデータ。権利・課金のセキュリティは別途必要で、本番購入に接続しない。
- **GitHub Pagesの公開JS/HTMLや既存ローカルセーブの実行はFirestore Rulesでは禁止できない**。β用Web配信自体の制限には別途認証付きHosting/プロキシが必要。現段階では招待者しか「公式クラウドセーブを利用できない」という強さの制限。

## 運営者のみの初期化・登録（未実施）

1. Firebaseコンソールで **新規のβ専用** プロジェクト、Firestore、Google認証、許可ドメインを作る。プロジェクト名、課金設定、バックアップの保持、費用アラートを二重確認。
2. 現行の匿名Preview認証・保存とは混ぜない。App Checkは実地で設定し、既存ルールを**別プロジェクトへ流用しない**。
3. ローカル端末上のみでADC認証し、`infra/beta` で `npm install`。秘密鍵やGCP資格情報はGitHubに置かない。
4. `BETA_FIREBASE_PROJECT_ID` と `BETA_PROJECT_CONFIRM` を両方β専用projectIdに設定し、誤プロジェクトを拒否する。
5. 空のβメンバー台帳で `node infra/beta/invites.js init` → `status`、出力が `0/30` であることを確認する。
6. 当選者がGoogleログインした際のFirebase UIDを運営者へ伝えてもらい、本人を照合する。UIDだけをユーザー認証の証拠として扱わない（Firebaseログイン自体の検証が必要）。
7. `node infra/beta/invites.js add <Firebase-UID> 2026-11-15T23:59:00+09:00` で招待。最初は10枠程度、必ず `status` を確認してから追加。
8. 取り消しは `node infra/beta/invites.js revoke <Firebase-UID>`。Rulesは次のサーバー通信から拒否（既に取得したJSや端末内データは消去できない）。
9. 募集ポストにURLを載せる前に必ずFirebase Emulatorによる認可試験、実Firebaseの許可/拒否、GoogleログインUI、モバイル実機、保存/復元試験を行う。

## 重要な注意

- 初期化はメンバー台帳が空の時のみ。コンソールで勝手に台帳を編集すると30人カウンタが壊れるので、通常操作は**必ず運営者CLI経由**。
- `betaMembers`へクライアントからの書き込みは一切許可しない。Admin SDKはRulesを迂回できるため、ADC/IAMを最小権限にし、運営者コマンドをウェブに露出させない。
- 登録期限が過ぎたメンバーも `enabled` がtrueなら予約枠としてカウントされる。枠を空けたい時は `revoke` する。
- Firestoreトランザクションで同時登録による31人目の有効化を抑止。運営者以外にAdmin権限を配布しない。
- Firestore Rulesの文字列 `size()` はUTF-8のバイト数と完全一致する保証ではない。クライアントの900KiB送信制限、Firestore実ドキュメント制限、実容量試験を併用する。
- 各実行結果、Firebaseの画面/ルール公開状態、採用したβ専用オリジンを運用記録に残す。

## 必須Emulator/実機ケース

| テスト | 期待 |
|---|---|
| 未ログイン、匿名ログイン、非Google認証 | 全API拒否 |
| Googleログイン済み・未招待 | メンバー不存在/無効、保存拒否 |
| 招待Google UID・期限内 | 本人の読み書きのみ許可 |
| 別人UIDの保存/閲覧 | 拒否 |
| 31人目のAdmin登録 | 拒否、30名維持 |
| 期限切れ/失効直後の保存 | 拒否 |
| 招待/台帳のクライアント書き換え | 拒否 |
| サイズ超過/不正schema/不正キー | 拒否 |
| iOS Safari/Chrome・PCでGoogleログイン | 要手動・未実施 |
| 保存→更新→復元/2端末競合 | 別途実地試験。競合制御は未実装 |

依存：β用Webビルド、実Firebaseプロジェクト、公式アカウント連携、フォーム、費用監視、ゲームUI側ゲートは別PR。

# Firebase Preview / Production 環境境界

> 初期整備（#66）。**設定例とルールファイルをGitHubに追加するだけ**。実Firebaseプロジェクト・ホスティング・IAM・App Checkへの設定変更、Rulesのデプロイは実施していない。

## 分離するもの

- Preview: 現行`/saves/{firebaseUid}`への匿名ログイン・端末直送信（`js/cloud.js`）。現行`main`は引き続きPreviewとして扱い、テスト購入は本番台帳へ昇格させない。
- Production: 専用Firebaseプロジェクト、別配信オリジン、Authの許可ドメイン、Firestore Rules、App Check、最低権限のAPIサービスアカウント、費用アラート、運営用ログ。
- 公開識別子をCIビルドに注入するだけでは、クラウドが安全に動く保証にはならない。Preview側の`js/cloud.js`はFirestoreへ直接読み書きする。**Productionでは`js/cloud-production.js`のAPIだけを利用し、Firestoreのdeny-allルールは維持する**。現段階はコード整備のみで、Auth/App Check/Functionsの実環境検証が完了するまで正式公開しない。
- `js/core/storage.js`の`scprod:`プレフィックスはPreviewの無料商品・セーブの混入防止策であり、認可の代わりではない。同じサイトへ本番/検証を共存させない。

## ルール案

- `firestore.preview.rules`: 本人の`saves/{uid}`の取得・作成/更新のみ。フィールド・型・文字数の上限、serverTimestampの検証。`list`や台帳コレクションへのクライアントアクセスは禁止。既存セーブの実サイズ確認・Emulator検証後にのみ適用。
- `firestore.production.rules`: すべてのブラウザ/アプリ直結Firestoreアクセスを拒否。購入/残高を守るための安全な初期状態。将来のCloud Functions等は**認証と所有者を自ら照合**してAdmin SDKを利用する（Rulesの迂回に注意）。
- 未実装の`accountId`/`billingId`・有償残高・バックアップrevisionは、クライアントから直接書けるRulesへ追加しない。

## 適用前のチェック（実FirebaseとEmulator必須）

1. PreviewとProductionのFirebase projectIdが異なり、Webの配信URLも異なること。アプリのAuth許可ドメインが正しいこと。
2. Firebase Emulatorで: 本人の`saves/{uid}`の合法データはPreviewで成功し、別人・未ログイン・list・不正キー・大きすぎるデータ・誤ったtimestamp・任意の購入/残高コレクションは拒否されること。
3. Productionのルールで、ログイン済みユーザーを含む全てのSDK直結読書きが拒否されること。バックアップAPI経路は所有者検証/リビジョン/サイズ・スキーマ検証を別途統合試験すること。
4. Auth UIDから将来の不変accountIdへの所有者割当、アカウント復帰、Firebase App Check、API IAM最小権限、Webhook署名を検証すること。
5. Firestoreの容量、インデックス、バックアップ費用、予算通知、障害復旧、データ削除、監査ログを設置すること。予算アラートは支出上限ではない。
6. Rulesの公開前に対象Firebaseプロジェクトを二者確認すること。**誤ってProductionのdeny-allをPreviewへ適用すると既存クラウド保存を停止する**。

## 現在の到達点

このPRはRulesのリポジトリ上での準備と静的テストのみ。Emulatorの許可/拒否実行試験、コンソール反映、API経由クラウドセーブ、本番ルーティングは未完了。正式公開可能と判定しない。


## 実装差分（2026-10-09）

PR #77に本番認証/WebバックアップAPIとGoogle連携コード、revisionの原子的保存処理を追加。ルールの5フィールド整合も修正。ただし実Firebase/Emulatorへのデプロイ・認証・通信の実地検証は未実施。`docs/production-backup-api.md`参照。

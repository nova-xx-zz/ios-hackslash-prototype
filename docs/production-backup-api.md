# ProductionバックアップAPI 実装ノート

今回の変更はコードと単体テストのみ。Firebase実プロジェクトへのデプロイなし。

## 追加したAPI
- GET /v1/account: Firebase ID tokenを検証し、UIDとサーバー発行の不変accountId / billingIdを結ぶ。
- GET /v1/progress/backup: ログイン本人のバックアップ・revisionを取得。
- POST /v1/progress/backup: expectedRevision・operationIdを原子的に検証。再送は冪等に処理し、他端末の更新は409で拒否。
- アカウント未連携の匿名UIDは禁止。Google/Apple等の永続アカウントへの連携が必要。
- 購入・有償確定石・特殊職付与等は進行バックアップへ持たせず、本番サーバー台帳との分離を維持。
- Firebase AuthのID TokenとFirebase App Checkの両方を検証し、CORS・アプリIDをAllowlist制御。
- Node.js 22、第2世代Cloud Functions（asia-northeast1）想定。最大5インスタンス。ただしこれは利用料金やアクセス数の上限ではない。

## 実環境へ適用する前に
1. Previewとは別のFirebaseプロジェクトを作成し、AuthプロバイダーとApp Checkを設定。
2. 本番のSWORD_CREST_ALLOWED_ORIGINSにゲームのWebオリジン、SWORD_CREST_APP_CHECK_APP_IDSにApp CheckのFirebase App IDを登録。未登録ならAPIを利用不可にする。
3. 実プロジェクトIDと専用ドメインを確認し、firebase.production.jsonを使って明示デプロイ。ルールは本番deny-all（管理者SDKはバイパスするためAPI側の本人確認必須）。
4. Authentication/Firestore Emulator、実Firebaseで署名・UID所有権・同時保存・再送・409・容量制限・復元を検証する。
5. functionsディレクトリの独立npm依存関係を固定したlockfileを用意して依存パッケージのCIも行う。現状のルートCIは純粋な契約テストのみ。
6. Web/PWAの共通ログインとセーブ復元UIを実装してから、本番クラウド同期をONにする。旧プロトタイプは移行しない。

## Preview Rulesの不整合
既存クライアントjs/cloud.jsが書き込む5フィールド（data, savedAt, schemaVersion, chars, updatedAt）に合わせ、以前のPreview Rules案（3フィールドのみ許可）を修正。適用前のEmulator検証は未実施。

Cloud Functionsの実運用・App Checkや課金とは独立して監査し、正式公開条件は別途満たす必要がある。
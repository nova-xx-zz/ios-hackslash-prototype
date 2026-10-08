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
## Webクライアントとの接続（今回追加した範囲）

- Release配布物だけでGoogle Authのポップアップ認証とFirebase Web App Checkを使用する。SDKは本番出力へビルド時にバンドル、Preview用の同梱SDKは変更しない。
- `js/cloud-production.js`はAPIを呼び、`js/cloud.js`はProductionで動作しない。Previewの匿名ログイン/直接Firestore保存は従来どおり。
- APIがバックアップを保持している別端末では、ローカル所有者/バックアップrevisionの記録が一致しない限り、自動で上書きしない。設定画面から復元するか、二重確認した上で端末の進行を採用する。
- Cloudのバックアップ成功時にはUID/revisionを端末のProduction保存領域へ記録。旧プロトタイプの購入権利は送信しない。
- Web版のGoogle OAuthプロバイダーはFirebase Console側で有効化が必要。Safari/PWAのポップアップ挙動は実機で確認する。iOS/Capacitorのネイティブ認証とアカウント復元は未実装。
- Releaseビルドには追加で SWORD_CREST_API_BASE_URL（HTTPSのswordcrestApi関数までのURL）と SWORD_CREST_RECAPTCHA_SITE_KEY（Web App Check公開サイトキー）が必須。CIは `.invalid` の無効なテスト識別子でのみ検証し配布しない。

## 未完了の重大な受入条件

- 本番Firebaseプロジェクトそのものの作成、AuthとApp Checkの管理画面設定、Firebase Emulator試験、実ブラウザGoogle認証、Cloud Functions本番デプロイと運用監視。
- モバイルSafari/PWAとiOSのクロスデバイス保存・復元、アカウント削除/回復、匿名リンク/既存アカウント統合の境界、複数タブのローカル排他とセーブ容量・復旧試験。
- Functions依存パッケージのlockfile、最小権限IAMとレート制限、実購入権利・消耗品のサーバー台帳（#70/#71）。

**本PRはDraftを継続し、本番公開も新しい課金も開始しない。**
## 追補：Firestore費用と再送の保持（2026-10-09）

進行バックアップのoperationId/hashはバックアップ本体ドキュメントの直近1操作のみ保持する。5分間隔の保存を利用者数分だけ行っても、操作ログの新規ドキュメントを無期限に増やさないための選択。
同一操作の直後の再送は同じrevisionを返す。より新しい別操作が保存された後で古い操作を再送すると409となり、利用者へクラウド/端末の選択を求める。**課金の取引台帳は別で、こちらは長期保管と厳密な永続冪等性が必要**。
サーバーに保存するのは元のリクエスト全体（expectedRevision、savedAt、進行JSON）から作成したhashであり、operationIdの異なる内容・メタデータの再利用を拒否する。

同時アクセスの完全な保護はFirestoreのtransaction側のrevisionで行う。端末localStorageの保存時刻チェックは競合の早期検知であり、原子的なタブロックの代わりにはならない。

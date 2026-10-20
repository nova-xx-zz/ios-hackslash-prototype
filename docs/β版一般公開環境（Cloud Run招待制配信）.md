# ソードクレストβ版：当選者専用 Cloud Run 配信手順

> **状態：実装候補・本番未デプロイ。必ず事前レビュー、CI、実地の正負認可試験を実施すること。**
> ゲーム正式版の `swordcrest` リポジトリ、既存Previewの `sword-crest-jp` Firebaseプロジェクトには触れない。
> 対象は **`sword-crest-beta` のみ**。初期テストは運営者本人の1/30から。

## 既存の Tailscale Serve と何が違うか

- Tailscale Serve: tailnet参加端末限定の開発者用検証URL。配布には不向き。
- Cloud Run: 一般のiPhone/PCブラウザがアクセスできるHTTPS URL。**公開されるのはログイン画面とFirebase Web SDK/Web configだけ**。
- Googleログイン後、**サーバー側**でFirebase IDトークンの本人確認、Googleプロバイダー、招待台帳の `enabled` と `expiresAt` を照合してから12時間のHttpOnly Secure Cookieを発行。
- HTML/CSS/JS/画像などゲームの全静的ファイルを配信するたびにセッションを検証し、**Firestoreの招待情報を毎回再取得**。失効・期限切れを次回の保護リソース要求から拒否。Firestore障害時も配信しない。
- 招待者のクラウドセーブは引き続きクライアントFirebase SDK＋Firestore Rulesで検証。Cloud RunのCookieはFirestore Rulesの代替ではない。
- ログアウトはサーバーCookieとブラウザFirebase認証の両方を終了させる。
- CSRF対策・オリジンチェック、セキュアCookie、無キャッシュ応答、リクエスト量制限を適用。

**限界**: 既にダウンロードされたゲーム資産を取り消すことはできない。公開GitHubソースや別の旧Preview配信のアクセスまでは止められない。Cloud Run公開入口への攻撃的な大量アクセスは請求・負荷リスクが残る。追加のWAF/負荷制御は別途検討する。

## 検証済みの前提

- Firebase `sword-crest-beta` / Google認証 / Firestore / `betaMembers/{uid}` 招待許可 / 認可Rules が稼働。
- 運営者本人のUIDは `infra/beta/invites.js` により登録済み。自分以外は未登録。
- βWebビルド `feat/beta-google-login-ui-20261020` と、本PRのビルドコードが揃っている。
- Google Cloud CLIの `gcloud auth login` が利用可能。
- **請求先アカウントを確定し、課金・予算上限を理解していること。運営者の許可なく実デプロイしない。**

## 1. 運営者PCでビルド（GitHubのmainにはまだ混ぜない）

この専用ブランチを別ディレクトリへ取得するか、既存 `swordcrest-beta-ui` の未コミット作業を保存してから切り替える。

```powershell
git clone --branch feat/beta-protected-cloud-run-20261020 https://github.com/nova-xx-zz/ios-hackslash-prototype.git swordcrest-beta-public
cd swordcrest-beta-public
npm ci
$env:BETA_PROJECT_CONFIRM = "sword-crest-beta"
```

Firebaseの公開Web configを既存の`SWORD_CREST_BETA_FIREBASE_CONFIG_JSON`環境変数へ指定（**サービスアカウント鍵を含めない**）。この値は既にローカルβビルドで使用したもの。**運用に必要な値をGitHubへ直接コミットしない**。

```powershell
npm run build:beta:cloud-run
node --test infra/beta-web/server.test.js
```

`dist/beta-cloud-run` が生成され、`game/` はサーバー認証の内側に格納される。開発用 localhost や Tailscale Serve の公開先は変更しない。

## 2. Google Cloud・請求設定を確認

コンソール https://console.cloud.google.com/ で **`sword-crest-beta`** を選択し、請求先アカウントと予算の状態を確認。

- Google Cloud Billing → 予算とアラート: 少額の月額上限目安（例：1,000円）とメール通知を設定。**通常の予算アラートだけでは支出は自動停止しない**。
- Cloud Runの支出上限（使える場合）はサービス範囲の制限として別途有効にする。Firestore、Cloud Build、Artifact Registry、ネットワーク転送などの請求は別途確認。
- Cloud Run、Cloud Build、Artifact Registryを使う。ソースデプロイはビルド/コンテナ保存が発生する。無料枠は無制限の無料保証ではない。
- 秘密鍵JSONは作成・貼付・アップロードしない。Cloud Runのサービスアカウントを使用。

## 3. 初回だけ行うGoogle Cloud設定

以降のコマンドを実行する**前に**課金先・予算・サービス名が合っていることを再確認する。

```powershell
# Firebaseプロジェクトを管理している「開発用Gmail」でログイン。
# 請求用Gmailが別でも、請求先アカウントとの関連付けが済んでいれば構わない。
gcloud auth login
gcloud auth list
gcloud config set project sword-crest-beta
gcloud projects describe sword-crest-beta --format="value(projectId)"

# ここまでは対象を確認するだけ。以下は本人確認後に実施。
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project sword-crest-beta

gcloud iam service-accounts create swordcrest-beta-web --display-name="Sword Crest Beta Protected Web" --project sword-crest-beta
```

サーバーには招待台帳の**読み取り権限のみ**付与する。

```powershell
$sa = "swordcrest-beta-web@sword-crest-beta.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding sword-crest-beta --member="serviceAccount:$sa" --role="roles/datastore.viewer"

# Cloud RunソースデプロイのCloud Build用権限。
# デフォルトのCompute Engineサービスアカウントをビルドに使う場合はCloud Run Builderが必要。
# 組織設定や実際のビルドサービスアカウントが異なる場合は、そのアカウントへ付与する。
$projectNumber = gcloud projects describe sword-crest-beta --format="value(projectNumber)"
$builder = "$projectNumber-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding sword-crest-beta --member="serviceAccount:$builder" --role="roles/run.builder"
```

Firebase Admin SDKのIDトークン失効チェック・セッション作成用のIAM権限を限定して付与する。

```powershell
gcloud iam roles create swordcrestBetaWebAuth --project=sword-crest-beta --title="Sword Crest beta web auth" --description="Read Firebase auth users and mint short-lived beta web sessions only" --permissions="firebaseauth.users.get,firebaseauth.users.createSession" --stage=GA

gcloud projects add-iam-policy-binding sword-crest-beta --member="serviceAccount:$sa" --role="projects/sword-crest-beta/roles/swordcrestBetaWebAuth"
```

Cloud Runのソースデプロイ時には、実行者側にも `roles/run.sourceDeveloper`、`roles/serviceusage.serviceUsageConsumer`、ランタイムサービスアカウントに対する `roles/iam.serviceAccountUser` が必要。権限不足はデプロイエラーの内容を確認して最小権限だけを付与する。Google Cloudの仕様・実際のビルド用サービスアカウントを確認すること。

*権限が不足する場合に、サービスアカウントへOwner/Editorを付与して解決しない。必要な権限を確認して改めてレビューする。*

## 4. Cloud Run配信（事前チェック完了後にだけ実行）

```powershell
gcloud run deploy swordcrest-beta-web `
  --source dist/beta-cloud-run `
  --project sword-crest-beta `
  --region asia-northeast1 `
  --service-account swordcrest-beta-web@sword-crest-beta.iam.gserviceaccount.com `
  --allow-unauthenticated `
  --min-instances 0 `
  --max-instances 2 `
  --concurrency 20 `
  --memory 512Mi `
  --cpu 1 `
  --set-env-vars BETA_FIREBASE_PROJECT_ID=sword-crest-beta,BETA_PROJECT_CONFIRM=sword-crest-beta
```

`--allow-unauthenticated`は**最初のログインページを一般のブラウザから開くため**に必要。ゲームHTML/JS/画像の配信許可はCloud Runサービス内部のFirebase Admin SDKによって判定する。

Cloud Runコンソールに表示された `https://...run.app` URLを取得し、**Firebase Authentication → 設定 → 承認済みドメイン**へ、URLのホスト部分だけを追加する。Firebase Web configの `authDomain` は既存のまま。

## 5. Xへ募集URLを公開する前の手動テスト（必須）

| 試験 | 期待 |
| --- | --- |
| 1. シークレットブラウザでURLを開く | 公開ログイン画面のみ |
| 2. 未ログインで `/index.html` を直アクセス | ログインへ誘導、ゲームHTML非公開 |
| 3. 未ログインで `/js/game.js` を直アクセス | HTTP 401、ゲームJS非公開 |
| 4. 未招待Googleアカウントでログイン | 403/未招待、ゲームファイルを取得不可 |
| 5. 招待済み運営者本人 | ゲーム起動、保存、復元成功 |
| 6. iPhone Safari/Chromeの別回線 | 両方でログイン/復元可能 |
| 7. 認証済みセッションのCookie消去 | 401に戻る |
| 8. 招待失効のサーバー拒否 | 有効なCloud Run Cookieでも次回静的ファイルリクエストは403（要テスト用UIDで検証） |
| 9. Firestore一時障害時 | 静的ファイルは配信されない |
| 10. 問い合わせフォーム・運用費アラート | 別Issue #128 / #129で確認 |

**本番配布直前まで、運営者1名以外を招待しない。** このURLは動作試験に成功するまでXで共有しない。

## 6. 緊急停止・ロールバック

緊急公開停止はCloud Runコンソールから該当サービスのIngress/IAMを閉じるか、専用サービス自体を削除する。これはβWebの配信を停止するもので、Firestoreに既に保存済みのデータを消す操作ではない。

一時的に誰かのクラウド権限を止める場合：

```powershell
# 管理CLIの別クローン（feat/beta-uid-admission-20261020 ブランチ）で実行
node infra/beta/invites.js revoke "対象Firebase-UID"
```

既存Tailscale検証URLは一般公開用へ転用しない。正式版リポジトリにはこの設定を反映しない。

## 参照

- https://firebase.google.com/docs/auth/admin/manage-cookies
- https://docs.cloud.google.com/run/docs/deploying-source-code
- https://docs.cloud.google.com/run/docs/securing/service-identity
- https://docs.cloud.google.com/billing/docs/how-to/budgets
- https://cloud.google.com/run/pricing

# Firebase 本番環境セットアップ・復旧手順（未実施）

> 目的: プロトタイプ `sword-crest-jp` と正式版を完全分離する。**この文書は作業手順のみ。本番Firebase Consoleはまだ操作していない。**

## 本番専用プロジェクトとドメイン

1. [Firebase Console](https://console.firebase.google.com/)で**新しいプロジェクト**を作成。Previewの`sword-crest-jp`は選ばない。例 `sword-crest-production`（存在/使用可能かは未確認）。
2. Production用Webアプリを登録して`apiKey,authDomain,projectId,appId`を取得。Firebase Web apiKeyは公開識別子だが、Admin秘密鍵はブラウザにもGitにも配置しない。
3. Google認証を有効化し、公式配信ドメインをAuthの許可ドメインに登録する。匿名ログインの端末UIDは恒久復旧に使わず、連携を完了したUIDのみバックアップAPIを許可する。
4. Web版のApp CheckにreCAPTCHA v3を登録してサイトキーを取得。API側で受け付ける**Firebase App IDを限定**する。App Checkは本人認証の代替ではない。
5. Firestoreを東京リージョン等で有効化。Productionの`infra/firebase/firestore.production.rules`はクライアントの全直結アクセスを拒否。Cloud FunctionsのAdmin SDKはRulesを迂回するため、API側のID Token/所有権検証とIAMも必須。
6. Cloud Functions v2（asia-northeast1）の利用に必要な請求アカウント設定、最小権限サービスアカウント、予算通知、ログ監視を設定。費用アラートは予算の自動的な利用停止を保証しない。
7. Webホスティングの本番ドメインとFirebase Auth許可ドメイン/CORSの値を統一。Previewとオリジン・Firebaseプロジェクト・環境変数を共有しない。

## 環境設定（サーバーとWebビルド）

本番関数には `functions/.env.example` を元に次の**実値**を設定する（`.env`等はGitにコミットしない）。

```text
SWORD_CREST_ALLOWED_ORIGINS=https://<production-web-domain>
SWORD_CREST_APP_CHECK_APP_IDS=<production-firebase-app-id>
```

正式Webビルドを実行する際は次が必須。

```text
SWORD_CREST_FIREBASE_CONFIG_JSON={...本番専用Webアプリの公開識別子...}
SWORD_CREST_API_BASE_URL=https://<production-functions-host>/swordcrestApi
SWORD_CREST_RECAPTCHA_SITE_KEY=<production-web-app-check-site-key>
```

**重要**: CIで使用している`api-ci.invalid`や`CI_APP_CHECK_SITE_KEY`は動作しないダミー値で、本番配布には絶対に使用しない。

## 公開前の自動テスト

- GitHub PR #77の`Game quality gate`と`Firebase Emulator security tests`の両方が緑であること。
- Emulatorで、Previewは本人のみ保存可・他人/未認証/list/不正データは拒否。ProductionはすべてのFirestoreクライアント直結を拒否。
- Emulatorで、サーバー発行accountIdの同一UID再ログイン、別UIDの分離、バックアップ`revision`・重複再送・同時書込みの409・保存後復元を検証。
- `functions`のnpm依存lockfileを生成・Git管理してから、`npm ci --prefix functions`で再現性を確認。Firebase Emulatorのテスト用依存も本番デプロイの依存とは別管理。

## 実環境の手動テスト（本番公開条件）

1. 本番とPreviewで異なるFirebase projectId、URL、Auth・App Check App IDが使われていることを管理画面とブラウザのNetworkで確認。
2. Web/ChromeでGoogle連携→新規セーブ→一度閉じる→復元。次にSafari、iOSのホーム画面PWAで同じアカウントに入り、別端末側でクラウド復元を確認。
3. 同じURLを2タブで開き、1つだけ操作・保存できること。ロック済みタブを閉じた後の再読込で操作できること。BFCache復帰・ページ離脱直前の保存も確認。
4. オフライン中に探索→セーブ→オンライン復旧。サーバーが保存成功直後に応答を失った想定で同じoperationIdを再送し二重更新されないこと。
5. 別端末A/Bから同時に同じrevisionを更新し、片方のみ成功、もう片方は409で停止。新しい方の進行を自動で消さず、選択画面が表示されること。
6. ブラウザのストレージ削除後、同じGoogleアカウントで復元可能であること。未来schema・不正JSON・容量超過・匿名IDの利用・不正App Checkの拒否を確認。
7. Googleログアウト/再ログイン、別アカウントへの切替、ログイン失敗、退会・権利/バックアップ削除の方針を確認。
8. 安全にバックアップを取得し、検証用プロジェクトのエクスポートを使ったデータ復旧訓練を実施。Productionの進行保管を実際に上書きして訓練しない。

## 問題が発生したときの扱い

- 認証や同期APIが停止: 買い切り・有償付与は開始しない。端末の進行は保持し、クラウド書込み/復元は停止。再送で勝手に旧revisionを上書きしない。
- Firestore更新で409: ローカル側の保存を維持し、最新クラウドセーブを取得して復元または明示的な端末進行採用を選択。
- Emulator・CI・費用・IAMに問題: デプロイ停止。PreviewプロジェクトへProduction RulesやAPIを流用しない。
- Googleアカウントが失われた際の復旧: 現時点で自動統合しない。本人確認と復旧手段の設計/実装が公開前に必要。
- 課金権利は進行セーブとは別の取引台帳で保護する。#70/#71未完の段階では有料販売を開始しない。

## 判定

本番プロジェクト作成・決済設定・デプロイはすべて未実施。Emulatorのテスト成功は正式公開承認ではない。

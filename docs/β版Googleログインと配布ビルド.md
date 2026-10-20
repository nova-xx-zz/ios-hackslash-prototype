# β限定版：Googleログインと配布ビルド

- 状態：**β専用ビルド生成・Googleログイン/招待判定のコードのみ。デプロイ・実機試験未実施**
- 設計：既存 `main` Previewと正式Web `swordcrest` を変更・移行しない。β専用のオリジン/Firebaseプロジェクトを利用する
- 本PRは実Firebase環境を作らず、X当選者を登録しない

## ビルド手順（CIでは偽の識別子のみ）

1. 運営者管理の**別のβ専用Firebaseプロジェクト**を用意する（現行Preview `sword-crest-jp` を再利用しない）。
2. Google Authenticationを有効にし、β用配信オリジンを許可ドメインとして追加する。
3. Firebase公開Web設定値 `apiKey/authDomain/projectId/appId` を `SWORD_CREST_BETA_FIREBASE_CONFIG_JSON` へ設定し、`BETA_PROJECT_CONFIRM` へ同じprojectIdを設定する。**秘密鍵/サービスアカウントは入れない。**
4. `npm ci && npm run build:beta:web` を実行する。`dist/beta/` に独立したWeb配布候補が生成される。**生成しただけでは公開許可にならない。**
5. `dist/beta/` は**専用オリジン**で配信し、運営者が`infra/firebase/firestore.beta.rules`を対象プロジェクトで安全確認して適用する。非公開Hosting/保護されたリバースプロキシなど、**静的アセットを当選者限定にしたい場合はサーバー側の配信保護が別途必要**。
6. `infra/beta/invites.js` によるアクティブ招待30人制御、Firestore Emulatorの拒否/許可試験、実Firebaseの実操作・費用アラート・iPhone Safari/Chrome動作を完了してから配布。

## UIとデータの境界

- `js/beta-access.js` はβビルド内だけで読み込まれる。Firebase Google Popupサインイン→自身の`betaMembers/{uid}`に招待があるか確認してから `js/game.js` を動的ロードする。未招待/期限切れ/認証・通信障害はゲームを**起動しない**。
- 未招待ユーザーには自身のFirebase UIDを表示し、当選者は運営者へ連絡できる。招待判断は運営者の責任で行い、XハンドルやUIDの申告のみを信用しない。
- `js/cloud.js` はβビルドで承認済みのFirebaseセッションを使い、匿名サインインへフォールバックしない。ストレージは`scbeta:<UID>:`を使い、Preview/Productionだけでなく同一端末で別のβアカウントに切り替えた場合も保存領域を分離する（ログアウト後も端末内セーブは消さない）。設定画面にβアカウントからのログアウトボタンを追加。
- Betaは通常のショップテスト購入を**無料として扱い、実決済は行わない**。デバッグ/管理者UIはβ出力から除外する（サーバー側の購入権利はこのPRでは実装しない）。
- PWA/service worker自動登録はβビルドで停止する。異なるオリジンを推奨。既存Previewページは従来どおり起動する。
- Firebase Authのポップアップ方式はブラウザ環境によって阻害される場合がある。実機Safari/Chromeで必ず試験し、必要ならFirebase公式のredirectベストプラクティスに従う（クロスオリジンauthDomainでは単純なredirectが失敗しうる）。
- 招待を失効させた場合、Rulesは**以降のFireStoreアクセス**を拒否するが、開いているブラウザの既存ゲームやローカルセーブまでは強制停止できない。継続的なアクセス確認や配信保護は別課題。
- 2端末の同時保存による上書き競合制御は未実装であるため、当選者には複数端末同時プレイを避けてもらい、別途ロック/復元対策を完了する。

## 受入テスト

- [ ] `npm test` + `npm run build:beta:web`
- [ ] 通常Previewの匿名認証・セーブ・自動周回に影響がない
- [ ] 未ログイン/Google以外/未招待/期限切れでゲーム起動を拒否
- [ ] 許可GoogleアカウントだけUI起動・本人セーブ操作
- [ ] Firebase Emulatorで認可判定、30→31人目拒否、招待失効直後の書き込み拒否
- [ ] β専用Firebaseの設定とオリジンの分離、クライアントに管理認証情報がない
- [ ] iPhone Safari/Chrome、PCでサインイン、データ保存・復元、再起動を検証
- [ ] Googleフォーム実URL・問い合わせ、費用アラート、緊急停止、募集要項を完成

**残課題：β版静的ファイル自体の配信保護は未実装。GoogleログインUI/Firestore RulesだけではGitHub PagesのHTML/JS取得は止められないため、「アプリ全体が30人限定で非公開」と説明しないこと。**

# β版 Firestore Emulator のテスト方法

**本書はPCで操作する手順です。Firebaseコンソールの「公開」を押す必要はありません。**
テストに使うのは `demo-swordcrest-beta` という架空のローカル専用IDです。
実Firebase `sword-crest-beta`・旧Preview `sword-crest-jp` のデータ・ルールを変更しません。

## 必要なもの

- Windows / macOS / Linux のPC
- Node.js 22以上（`node -v`）
- Java 21以上（`java -version`）
- インターネット接続（初回のnpm依存・Firestore Emulatorダウンロード）

Firebaseアカウントでのログインや本番用認証キーは **不要** です。

## 操作手順

GitHubで [PR #131](https://github.com/nova-xx-zz/ios-hackslash-prototype/pull/131) のブランチ `feat/beta-uid-admission-20261020` をチェックアウトする
（PRがmainにマージされた後ならmainでOK）。以下をリポジトリのルートから実行。

```bash
npm install --prefix infra/beta --no-audit --no-fund
npm run test:firestore --prefix infra/beta
```

これだけで自動的に Firestore Emulator が起動→権限テスト→終了します。
Firebase CLI・Javaの実行ファイルは自動実行され、**Firebaseへdeployは行いません**。

### 期待する結果

```text
PASS 未ログインはメンバーと保存にアクセス不可
PASS 匿名認証でも招待権限なし
PASS Google認証でも未招待なら保存不可
PASS 招待Google認証は自分のセーブ保存と読取が可能
PASS 他人のメンバーとセーブの読み書きは禁止
PASS 無効化・期限切れ招待は書込と読取が不可
PASS 招待失効後は既存セーブも読取・更新不可
PASS プレイヤーによる招待改竄・一覧・台帳閲覧は禁止
PASS 不正フィールド・古い時刻・schema値を拒否
PASS 削除とリスト操作は招待者でも拒否
Firestore Emulator: 10 / 10 permission scenarios passed
```

`npm run test:firestore --prefix infra/beta` が **終了コード0**で完了すればローカル権限テスト通過です。
失敗した場合はエラーログを確認し、ルールを勝手に緩めずに修正用PRを作成します。

## 何をテストしているか

- Firebaseの「Googleログイン」を **模擬したトークン** （実Googleアカウント不要）
- 本人の招待情報だけ見えること・招待無し/無効/期限切れのセーブ利用禁止
- 別ユーザーのセーブ取得/変更禁止
- 招待一覧・30人管理用台帳・課金台帳のブラウザ操作禁止
- 正常なセーブ作成/更新と、不正キー/不正データサイズ/不正日時の拒否
- 招待が失効した後にセーブ取得/変更が拒否されること

**注意**: 30人枠のトランザクション自体は `npm test` の純粋関数テストで検証します。
このEmulatorテストはFirestore Rulesの認可をテストするもので、管理CLIを同時実行する実結合テストではありません。

## 事故防止

- `infra/beta/prepare-emulator-rules.cjs` が正本の `infra/firebase/firestore.beta.rules` をローカル生成物 `infra/beta/firestore.beta.rules` へコピーします。Emulatorは同じディレクトリ内のこの生成物を読み込みます（Git管理対象外）。
- `demo-swordcrest-beta` のみを使う。テストスクリプトは `FIRESTORE_EMULATOR_HOST` が `127.0.0.1:8098` か `localhost:8098` でなければ異常終了する。
- `firebase deploy` はこの手順に含めない。
- 現在Firebaseコンソールに貼ったルールは**まだ公開しない**。公開するのはエミュレータの正常終了、PRレビュー、対象プロジェクトの再確認後。
- Emulatorで許可/拒否が成功しても、iPhoneのGoogleログイン・ブラウザ挙動・実Firebaseへのデプロイを検証したことにはならない。

## よくあるエラー

- `java is not recognized` またはJavaのバージョンエラー: Java 21以上をインストールし、ターミナルを開き直す。
- `EADDRINUSE` / `Address already in use: 8098`: 別のEmulatorが使用中。起動中のものを止めて再実行。
- `ECONNREFUSED`: Firestore Emulatorが正常起動できていない。起動ログを確認する。
- ネットワーク・npmエラー: 回線を確認して `npm install --prefix infra/beta` を再実行。

GitHub ActionsもこのテストをローカルFirebase Emulatorで実行するので、PR画面の `Beta Firestore permission tests` でも結果を確認できます。

# ソードクレストβ版：iPhone Safari/Chrome 実機検証（Tailscale Serve）

> **対象：開発者本人のiPhoneだけ。X抽選ユーザー20～30人へ配る本番β公開URLの設計ではありません。**
> Firebase `sword-crest-beta` の既存認証・招待者ルールを維持。Firebase Hostingにはデプロイしない。

## 目的・安全性

Windows PCで既に動作確認済みの `dist/beta` を、同じ開発者が所有するiPhoneからHTTPSで開き、Google認証、ゲーム進行、クラウドセーブ/復元を確認する。

- Tailscale **Serve** は、同じtailnetに加入しアクセス権がある端末にのみローカルHTTPサーバーをHTTPSで公開する。**Funnelはインターネット公開になるので使わない**。
- `localhost` はPC内だけを指す。iPhoneで `http://localhost:8080` を入力してもPCのゲームへはつながらない。
- tailnetに別のユーザー/端末が参加していればアクセスできる可能性がある。管理画面でデバイス/アクセス権を確認。TailscaleはFirestore Rulesの代替ではない。
- TailscaleのHTTPS用端末DNS名はCertificate Transparencyログに記録される場合がある。デバイス名に氏名や秘密情報を含めない。
- `betaMembers/{uid}`、`saves/{uid}`への操作は従来どおりFirebase側Rulesが判断する。HTML/JSはtailnet内で閲覧可能。
- 30人抽選用には、配信側も含めて招待制を強制できる独立HTTPS環境を別途選定する。

## PCの準備（Windows）

1. 公式 https://tailscale.com/download/windows からTailscaleをインストール。インストーラやブラウザの指示に従いログイン。
2. 公式 https://tailscale.com/download/ios からiPhoneアプリをインストールし、**PCと同じTailscaleアカウント/ネットワーク**にログイン。VPN構成の許可を行って接続。
3. PCのPowerShellで`tailscale status`を実行し、両端末がtailnetに存在することを確認。
4. 必要なら https://login.tailscale.com/admin/dns でMagicDNSとHTTPSを有効にする。Serveの初回起動時に操作案内が出る場合もある。
5. PC側のPowerShell（リポジトリ `swordcrest-beta-ui` 直下）で、ローカル配信を起動したままにする。

```powershell
npx --yes http-server dist/beta -a 127.0.0.1 -p 8080 -c-1
```

6. **別の**PowerShellでServeを起動する。

```powershell
tailscale serve 8080
```

「Available within your tailnet」と `https://<PC名>.<tailnet名>.ts.net` 形式のURLが表示される。HTTPS有効化への確認が出た場合はTailscaleの正規画面で対応する。**`tailscale funnel` は実行しない**。

7. https://console.firebase.google.com/ で `sword-crest-beta` → Authentication → 設定 → 承認済みドメイン → ドメインを追加。
   ServeのURLから **`https://` と末尾の `/` を除いたホスト名だけ**を登録する。例：`development-pc.example-tailnet.ts.net`。Firebase configの `authDomain` を変更する必要はない。
8. iPhoneでTailscaleが接続状態になっていることを確認して、Safariで表示されたHTTPS URLを開く。Chromeでも同様に開く。

## 実機検証手順

| 試験 | Safari | Chrome |
|---|---|---|
| HTTPS URL接続、ログインUI表示 | 未実施 | 未実施 |
| 招待済みGoogleアカウントでログイン成功 | 未実施 | 未実施 |
| 招待者だけゲーム起動 | 未実施 | 未実施 |
| キャラ作成→PT編成→探索→戦闘→報酬 | 未実施 | 未実施 |
| アプリ再表示・ページ再読み込み後の端末セーブ | 未実施 | 未実施 |
| 設定 → 今すぐバックアップ成功 | 未実施 | 未実施 |
| 設定 → クラウドから復元の確認/実行 | 未実施 | 未実施 |
| ログアウト→再ログイン→セーブ継続 | 未実施 | 未実施 |

SafariとChromeのブラウザ保存領域は別。Google UIDとFirestore `saves/{uid}` は同じでも、**初回起動時にクラウドから自動復元する仕様とは限らない**。ChromeでSafariの進行を使いたい場合は、Chromeでログイン後にゲーム内「クラウドから復元」を使い、対象セーブ/日時を確認してから確定する。復元操作はローカル進行を上書きするので注意。

Googleログインに失敗する場合は、まずFirebase Authの承認済みホスト名、iOSのポップアップブロック、Tailscale接続を確認し、β版に表示されたFirebaseエラーコードを記録する。iOSブラウザ固有のログイン問題はPRで修正し、認証を迂回しない。

## 停止手順

Serveのターミナルで `Ctrl+C`、ローカルHTTPサーバーのターミナルでも `Ctrl+C`。設定状態は `tailscale serve status` で確認。
既にバックグラウンド化していた場合は `tailscale serve off` を実行する。TailscaleのVPNを切ってもFirebaseの既存招待権限そのものは失効しない。

## 参考（公式）

- https://tailscale.com/docs/reference/examples/serve
- https://tailscale.com/docs/how-to/set-up-https-certificates
- https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-team
- https://firebase.google.com/docs/auth/web/google-signin?hl=ja

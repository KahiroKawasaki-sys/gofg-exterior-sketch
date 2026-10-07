# Codex への指示：外構スケッチ v0.3 を iOS アプリ化する

作成 2026-10-07。このファイルが今回の作業の正本。作業中に決めたことは末尾の「作業記録」に追記すること。

## 1. 目的

外構スケッチ（v0.3 エディタ `src/v3/`）を、iPad / iPhone にインストールして使えるネイティブアプリとして配布する（TestFlight）。

ブラウザ版の不満は「アドレスバーやSafariの操作（スクロール・拡大・戻るスワイプ）が描画のじゃまをする」こと。アプリ版では次の状態にする。

- 全画面で起動し、Safari の UI やジェスチャーが一切出ない
- Apple Pencil で描いたときに画面がスクロール・拡大・バウンドしない
- 下絵の読み込み・書き出し・保存が、ネットにつながっていなくても使える

**実際に使う端末は iPad が中心**。iPad と iPhone の両対応（Universal）にし、操作感の確認は iPad を優先する。

## 2. 方針（決定事項）

- **Capacitor（最新の安定版）で、既存の Web 版（React + Vite）を WKWebView に同梱する。** Swift でエディタを作り直すことはしない。描画・部品・テクスチャ・保存はすべて既存コードを使い回す。
- アプリが読むのはローカルに同梱した `dist` だけ。Cloudflare の Worker やサーバーには接続しない（v3 は外部と通信しない。この状態を保つ）。
- Web 版（Cloudflare 本番）はこれまでどおり残す。**Web 版の挙動を変えないこと。** アプリ専用の処理は「アプリで動いているときだけ」効くように分ける。
- 旧版（`?v=2`、`src/App.tsx` / `src/Stage.tsx` ほか）はアプリに入れない。触らない。

## 3. 前提と現状

- リポジトリ：`C:\Users\kawak\dev\gofg-exterior-sketch`（**git 管理されていない**）
- 作業 PC は Windows。Xcode が使えないため、iOS のビルド・署名・TestFlight アップロードは GitHub Actions の macOS ランナーで行う。
- お手本：`C:\Users\kawak\dev\rhythm-health`（SwiftUI アプリ）の `.github/workflows/verify-ios.yml` / `testflight.yml` と `scripts/distribute.py`。App Store Connect API キーで署名・アップロードする仕組みが動いている。同じ Apple Developer アカウント・同じ GitHub アカウント（`KahiroKawasaki-sys`）を使う。
- 既存テスト：`npm test` で 69 件通過。`npm run build` も通る。2026-10-07 に iPad のスクロール対策（`src/v3/Canvas.tsx` のタッチ処理、指モード 自動／描く／画面移動、手のひら除外）を入れて本番デプロイ済み。この挙動を壊さないこと（`tests/v3-touch.test.tsx`）。

## 4. 作業内容

### Phase 0：git 化（最初に必ず行う）

1. 現在の状態のバックアップ（`node_modules` と `dist` を除いた tgz）を作る。保存先はリポジトリの外。
2. `git init`。`.gitignore` に以下を追加する：`ios/App/Pods/`、`ios/App/build/`、`DerivedData/`、`*.xcuserstate`、`xcuserdata/`、`ios/App/App/public/`（`cap sync` で毎回作られるため）。
3. **最初のコミットの前に**、秘密情報が入っていないことを確認する。`.wrangler/`・`.env*`・`.dev.vars*` は ignore 済み。`wrangler.jsonc` に載っているのは公開してよい値だけか確認し、結果を作業記録に書く。
4. GitHub に**非公開**リポジトリ `gofg-exterior-sketch` を作って push する。**作成と push の前に本人の承認を取ること。**

### Phase 1：アプリ用ビルドを分ける

- `npm run build:app` を追加する。生成先は `dist-app/`。
  - 入口は v3 だけにする（`src/main.tsx` で `?v=2` の分岐をアプリ用ビルドでは無効にする。`import.meta.env` の判定か、アプリ用の入口ファイルを別に作る）。
  - `base: './'`。アセット・pdf.js のワーカーを含めて、すべてローカルから読めること。
  - Service Worker やマニフェストに依存する処理が入っていれば、アプリ版では外す。
- 「アプリで動いているか」の判定は `Capacitor.isNativePlatform()` に一本化し、`src/v3/platform.ts` に集める。

### Phase 2：Capacitor iOS プロジェクト

- `@capacitor/core` `@capacitor/cli` `@capacitor/ios` を導入する。依存の管理は Swift Package Manager を使う（CocoaPods は使わない）。
- `capacitor.config.ts`
  - `appId: 'com.kawakahi.gofgsketch'`、`appName: '外構スケッチ'`、`webDir: 'dist-app'`
  - `ios.scrollEnabled: false`（WKWebView 自体をスクロールさせない）、`ios.contentInset: 'never'`、`ios.allowsLinkPreview: false`、`backgroundColor` はアプリの背景色 `#f5f5f3`
  - `server.url` は**設定しない**（同梱ファイルだけで動かす）
- Xcode 側の設定
  - `TARGETED_DEVICE_FAMILY = "1,2"`、iOS 17.0 以上。iPad は全方向の回転、iPhone は縦向き優先でよい。
  - iPad の Split View / Slide Over に対応する（`UIRequiresFullScreen` は付けない）。
  - Info.plist の利用目的の文言（日本語）：
    - `NSCameraUsageDescription`：「現場の写真を撮って図面に貼り付けるために使います」
    - `NSPhotoLibraryUsageDescription`：「写真を図面に貼り付けるために使います」
    - `NSPhotoLibraryAddUsageDescription`：「書き出した図面を写真に保存するために使います」
  - WKWebView のピンチによるページ拡大は無効にする（キャンバス自体の 2 本指拡大・回転は Web 側で処理しているので残す）。戻る／進むのスワイプは無効のまま。
- アプリアイコン：`public/icon.svg` から 1024×1024 の PNG を作り、`@capacitor/assets` で生成する。起動画面は背景色だけの無地でよい。

### Phase 3：WKWebView で動かない部分を直す（必須）

1. **書き出し（PNG / PDF / 編集データ .json）**
   今は `src/v3/Editor.tsx` の `download()` が `<a download>` を使っている。WKWebView ではこれが動かない。
   `platform.ts` に `saveFile(blob, fileName)` を作り、アプリでは `@capacitor/filesystem` で一時保存してから `@capacitor/share` の共有シートを開く（「"ファイル"に保存」・AirDrop・LINE などを選べるようにする）。Web 版はこれまでの `<a download>` のまま。
2. **ファイルの読み込み（下絵 PDF・画像、編集データ .json、写真ライブラリ、カメラ）**
   `<input type="file">` は WKWebView でも動くはず。実機（シミュレータ）で、5 つの入口（`App3.tsx` の 2 つ、`Editor.tsx` の 3 つ）がすべて動くか確かめる。動かないものだけネイティブのプラグインに置き換える。
3. **セーフエリア**
   `viewport-fit=cover` を前提に、上部ツールバー（`.v3-top`）・左の縦ボタン・右パネルが、ステータスバーやホームインジケーター、iPhone の切り欠きに隠れないよう `env(safe-area-inset-*)` で余白を取る。Web 版の見た目は変えない。
4. **キーボード**
   テキストや寸法の入力でキーボードが出たときに、キャンバスが押し上げられて崩れないこと（`@capacitor/keyboard` の resize は `none` などで調整する）。
5. **保存データ**
   アプリ版は IndexedDB（DB 名 `gofg-sketch-v3`）にそのまま保存する。ただし、アプリでは保存先のオリジンが Web 版と違うため、**ブラウザ版のデータは自動では引き継がれない**。ホーム画面の「編集データを開く」から .json を読み込めば引き継げることを確かめ、手順を README に書く。

### Phase 4：Apple Pencil まわり（必須は 1 と 2）

1. 筆圧（`pointerType === 'pen'` と `pressure`）が WKWebView でも届き、線の太さが変わることを確かめる。
2. Pencil で描いているときに、拡大鏡・文字選択・コールアウト・スクリブル（手書き入力の変換）が出ないこと。
3. （任意・時間があれば）Pencil のダブルタップでペンと消しゴムを切り替える。`UIPencilInteraction` を使う小さな自作プラグインで、Web 側にイベントを渡す。

### Phase 5：CI と TestFlight

rhythm-health を参考に、次の 2 つを作る。

- `.github/workflows/verify-ios.yml`（手動実行）：`npm ci` → `npm test` → `npm run build:app` → `npx cap sync ios` → 署名なしでシミュレータ向けに `xcodebuild` でビルド。
- `.github/workflows/testflight.yml`（手動実行。入力 `upload` の初期値は `false`）：署名済みの IPA を作って検査する。`upload=true` のときだけ App Store Connect にアップロードする。シークレットの名前は rhythm と同じ（`ASC_PRIVATE_KEY` / `ASC_KEY_ID` / `ASC_ISSUER_ID` / `APPLE_TEAM_ID`）。ビルド番号は `github.run_number` から自動で増やす。

実行は `gh workflow run <file> --ref <branch>`、結果の確認は `gh run list` / `gh run view --log-failed`。

**本人が行うこと（Codex は手順を書いて止まる）：**

- Apple Developer で App ID `com.kawakahi.gofgsketch` を登録し、App Store Connect にアプリを作成する
- GitHub リポジトリにシークレットを登録する（値をチャット・コマンドライン引数・ログに出さない）
- `upload=true` でのアップロードと、TestFlight のテスター追加

## 5. 守ること

- Web 版のテスト 69 件と `npm run build` は常に通すこと。アプリ用のテストを追加したら件数を作業記録に書く。
- Cloudflare への `cf:deploy` はしない（Web 版の公開は今回の範囲外）。
- 秘密情報（API キー・p8 ファイル・証明書）は読まない・コミットしない・コマンドライン引数に直接書かない。CI ではシークレット経由でだけ扱う。
- 画面の文言は日本語。既存の UI の配置や見た目は変えない（セーフエリアの余白を除く）。
- 新しいフォルダの名前は英語（コードのため）。
- 大きな方針変更（Capacitor をやめる、ネイティブで作り直す、など）が必要だと判断したら、作業を止めて理由を報告する。

## 6. 完了条件

- [ ] git 化と非公開リポジトリへの push ができている（本人承認済み）
- [ ] `verify-ios.yml` が成功する（Web テスト・アプリ用ビルド・シミュレータビルド）
- [ ] `testflight.yml`（`upload=false`）で署名済み IPA の検査が成功する
- [ ] iPad シミュレータで、全画面起動・Pencil を想定したドラッグでスクロールしない・PDF 下絵の読み込み・PNG と PDF の書き出し（共有シート）・.json の読み書き・再起動後もデータが残る、を確認した（スクリーンショットか録画を残す）
- [ ] iPhone シミュレータで、セーフエリアに UI が隠れず、主要な操作ができる
- [ ] README に「アプリ版のビルド・配布手順」と「ブラウザ版からのデータ引き継ぎ手順」を追記した
- [ ] `HANDOFF-ios.md` に、実機で確かめること（筆圧・手のひら除外・Split View・カメラ）と残った課題を書いた

## 7. 作業記録

（Codex が追記する：日付・やったこと・判断したこと・テスト結果・残課題）

### 2026-10-07 Phase 0（ローカル）

- 本人の「承認するので進めてください」を、非公開リポジトリ作成・pushの事前承認として引き継ぐ。
- バックアップ：`C:\tmp\gofg-ios-backups\gofg-exterior-sketch-before-ios-20261007-232726.tgz`（64ファイル）。node_modules・distに加え、認証ファイル／.wranglerを除外し、認証情報を複製しない。復元用ソースの存在を確認済み。
- git init（main）。iOSの生成物・ビルド成果物・署名情報をignoreへ追加。
- 初回コミット候補を検査し、秘密鍵・トークン・長い秘密値の直書き候補は0件。認証ファイルの中身は読んでいない。
- wrangler.jsoncはアプリ名・Worker経路・配信設定・空の認証設定とPUBLIC_APP=falseのみ。APIキー・アカウントID・個人メールは含まず、コミット可能と判断。
- GitHub CLIは未ログイン。本人のブラウザ認証後に非公開リポジトリを作成してpushする。Cloudflareのデプロイは今回実行しない。

### 2026-10-07 Phase 1〜4 実装方針

- 改修前のWeb版：69テスト通過・npm run build成功。旧版のソースは変更しない。
- Capacitorの公式npmで安定版8.5.3を確認。SPMを使用。iOS 17以上・Universal。
- 別エントリーmain-app.tsxとViteのappモードで、v3のみ・相対パス・PWA非依存のdist-appを生成する。
- appモードだけ下絵読込をv3/source.tsに解決し、旧版io.tsとその保存・クラウド処理を同梱から外す。Webの入口と解決先は維持する。
- native判定をplatform.tsへ集約。書出しはCache保存→共有シート、キャンセルと失敗時も一時ファイルを片付ける。
- native専用CSSでセーフエリアとキーボードを扱う。WKWebViewのページ拡大・スクロール・手書き変換を無効化し、キャンバス内の2本指操作は維持する。
- シミュレータとApple Pencil実機の確認結果は区別して記録する。Windows単体でiOS検証済みとは扱わない。

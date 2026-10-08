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

## 3. 着手時の前提と現状（2026-10-07）

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

- [x] git 化と非公開リポジトリへの push ができている（本人承認済み）
- [x] `verify-ios.yml` が成功する（Web テスト・アプリ用ビルド・シミュレータビルド）
- [x] `testflight.yml`（`upload=false`）で署名済み IPA の検査が成功する
- [x] iPad シミュレータで、全画面起動・Pencil を想定したドラッグでスクロールしない・PDF 下絵の読み込み・PNG と PDF の書き出し（共有シート）・.json の読み書き・再起動後もデータが残る、を確認した（スクリーンショットか録画を残す）
- [x] iPhone シミュレータで、セーフエリアに UI が隠れず、主要な操作ができる
- [x] README に「アプリ版のビルド・配布手順」と「ブラウザ版からのデータ引き継ぎ手順」を追記した
- [x] `HANDOFF-ios.md` に、実機で確かめること（筆圧・手のひら除外・Split View・カメラ）と残った課題を書いた

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

### 2026-10-07 CI初回の修正と本人作業の更新

- 非公開リポジトリ作成とpush完了：https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch （PRIVATEをAPIで確認）。
- 79単体テスト成功。テスト側の型注記を修正し、Webとアプリ用ビルドを成功確認。
- Mac CIの最初のビルドは、PrivacyInfo.xcprivacyへの参照が実際の保存先と違って停止した。SOURCE_ROOTからの正しい相対パスへ修正。不要な生成画像とセットアップ用スクリプトを整理。
- Xcode生成補助ライブラリがテスト製品に誤った拡張子を付けたため、NativeTests.xctestへ修正。アプリ実装の動作とは別のビルド構成の問題。
- 本人が「おまえがやってくんない？」と指示。AppleのApp ID／アプリ作成とGitHubの設定操作はCodexが行う範囲に更新。Appleログインは本人入力待ち。秘密情報を読み取らないルールは維持。
- 初回testflight（upload=false）は未設定シークレット4項目のチェックで停止。IPA生成・Appleアップロードなし。

### 2026-10-08 Apple登録とシミュレータの検証

- 本人のAppleログイン後、App ID com.kawakahi.gofgsketchを登録。Developer上の説明は英数字制約があるためGofg Exterior Sketch。
- App Store Connectに外構スケッチ／日本語／SKU gofg-exterior-sketchを作成。https://appstoreconnect.apple.com/apps/6820144141/distribution/info
- 利用者一覧は本人のAccount Holder兼管理者1名だけ。アプリ作成によって他者への共有は増えていない。
- Mac上でnpm ci、79テスト、Webビルド、アプリビルド、cap sync、署名なしiOSシミュレータビルド成功。
- シミュレータ操作テストの93行目が停止。ページ拡大用の認識器が存在しない場合まで「有効」と扱っていた検証を修正。存在する場合は引き続き無効を要求する。
- 操作テスト失敗時にも診断JSON・画面証拠を保存するよう検証スクリプトを更新。次回からCIのログで失敗理由を確認できる。

- GitHub署名設定の3つの識別情報をAppleの画面で確認し、APPLE_TEAM_ID／ASC_KEY_ID／ASC_ISSUER_IDを登録。秘密キー本体は読み取らず本人がGitHub画面で入力する。
- 00:14〜00:20（日本時間）にGitHubのpush／workflow開始が500エラーで失敗。更新済みと誤認せずリモートのSHAを照合。HTTP/1.1指定での再試行が成功し、検証run 37643042326を開始。接続方式変更が根本原因だったかは未確定。アプリ・Web公開版への影響はなく、CI開始が数分遅れた。

### 2026-10-08 操作検証の同期修正

- シミュレータ上でPDF下絵の読込、合成ペン描画、筆圧データ、PNG/PDF/JSONの共有シートを確認し、実画面の証拠を取得。
- 共有テストは前回のキャンセルトーストを見て次へ進んでおり、iPhoneで前の共有画面を次の画面と誤認した。画面の終了と各共有の一時ファイル削除を待つよう修正。
- 再読込テストは古いホーム画面の存在だけで次へ進んでいた。新しいページが実際に読み込まれるまで待つよう修正し、JSON取込の途中で画面が再読込される問題を防ぐ。
- これらは自動操作の待機不足。Webやアプリの利用者向けコードの変更は不要。画面証拠／診断JSONを小さいartifactへ分け、Windowsで取得しやすくする。
- 本人からキー入力完了の連絡。GitHubの4つのSecret名がすべて存在することを確認し、upload=falseの署名検査run 37644295472を開始。値は取得していない。

- upload=falseの署名済みIPA検査成功：https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37644295472 。Appleへのアップロードは未実行。
- 読込入口は実コード上では6つ。ホーム2つとエディタ4つについて、Fileを渡す検証を追加。写真／カメラ入力後の生成テクスチャもJSON内で検査する。実際のiOS選択画面・実撮影は別途実機確認が必要。

- 読込6入口の検証は、2ページのPDFでページ選択を省略して停止していた。自動操作にページ選択と実際の選択範囲の準備を加える。待機失敗時には画面と表示文言も診断に残し、次回の原因切り分けを可能にする。利用者向けコードへの変更はない。


### 2026-10-08 最終の表示確認

- verify-ios run 37647023841成功。iPad Pro 13-inch (M5)／iPhone 17 Proの読込・描画・共有・JSON復元と、別プロセス再起動の計4テストすべて通過。
- 実画面でiPhoneホームのアプリ名が1文字ずつ折り返す問題を発見。固定幅のバージョン表示が見出しの幅を圧迫していた。native専用CSSでアプリ名と保存状態の幅を確保し、長いバージョン表示だけ省略する。WebのCSSは変更しない。
- 画面証拠の一部はDOM更新直後に撮られており、更新前の画面が写っていた。撮影前に描画フレームを待ち、証拠と操作結果を一致させる。
- 影響範囲は配布前のiPhoneアプリと検証用画面証拠。公開Web版と利用者の保存データへの影響はない。


### 2026-10-08 Codex担当範囲の完了

- 最終verify-ios成功：https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706029379（f4d5de5）。79単体テスト・Web／アプリビルド・同期・署名なしMacビルドに加え、iPad／iPhoneの操作一巡と別プロセスでの再起動の計4テストすべて通過。
- 最終upload=false署名検査成功：https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706036980（同じアプリ）。App Store配布形式の署名・プロファイル・利用目的・Universalを確認。Appleアップロードは未実行。
- 6つのFile入口、2ページPDFの選択、PNG/PDF/JSON共有、一時ファイル削除、合成ペンの筆圧、JSON復元、再起動後の保存を確認。写真選択画面・カメラ実撮影・Apple Pencil実機はHANDOFFの実機チェックに残す。
- iPad／iPhoneの全画面・上部道具・左ボタン・パネル・共有シートを実表示で確認。iPhoneホームのアプリ名の縦折返しは復旧。長いバージョン表示が幅を圧迫したため、native専用の幅配分と省略表示で防止。配布前のアプリにのみ影響。
- 8枚の元解像度PNGをdocs/ios/evidenceへ保存。README／HANDOFFの設定完了状況・ビルド・配布・引継ぎ・実機の残項目を整合。
- 次は指示書で本人担当のupload=trueとTestFlight内部テスター追加、iPad実機チェック。Pencilダブルタップは任意として未実装。Cloudflareデプロイは実行していない。

### 2026-10-08 本人によるTestFlightアップロード

- 2026-10-08 11:33 JST、本人が実行した[upload=true](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37718163594)が成功。0.3.0（1.4.1）の署名検査、Appleのアップロード前検証、アップロードがエラーなしで完了。TestFlightでの処理完了とテスター追加は別途確認する。
- 対象コミット3804d61。Appleへのアップロードと、TestFlightで利用可能になること・実機へのインストールは区別する。

### 2026-10-08 TestFlightでの処理完了確認

- 2026-10-08、App Store ConnectのTestFlightで0.3.0（1.4.1）が「テスト準備完了」であることを確認。内部テスター登録と実機インストールは未実行。
- 本人用グループの入力を準備し、自動配信は無効。指示書ではテスター追加が本人担当のため、本人1名の登録・招待をCodexが担当するか確認中。

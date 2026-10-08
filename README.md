# 外構スケッチ v0.2

下絵に手描き・清書・素材・部品・寸法・注記を重ねる、iPad向けの外構打ち合わせアプリです。同じCloudflare URLで利用できます。2026-10-06現在、開発中はメール確認なしの端末保存モードです。既存クラウドデータの読み書きは停止し、完成後に本人認証と同期を戻します。以下は2026-10-04時点の接続記録です。端末内保存・原本付きバックアップは利用可能。D1端末間保存は実装・ローカル検証済みで、同日、本番の専用D1接続も完了しました。本番で下絵PDF・手描き・原本の保存、履歴の別案復元、復元原本PDFの一致を確認済みです。

## 開発と検証

```powershell
npm ci
npm run dev
npm test
npm run build
npm run check:worker
npm run cf:check
```

開発: http://127.0.0.1:4173/ 。同じPCからだけ接続できます。
画面検証: http://127.0.0.1:4173/qa.html 。iPad 1024×768・768×1024、スマホ375×812のiframeを使用します。qa.htmlはViteの公開ビルドに入りません。

自動テスト62件通過（2026-10-06）: 旧データ移行、形状・寸法、原本参照、端末保存CAS、D1の競合・再送・履歴・容量、端末間同期、指とペンの入力イベントを検証。実機のPencil感触やiPadOSを再現するテストではありません。認証の署名検証は単体テストでモック、公開時に匿名・不正セッションの遮断を別途確認します。

## 操作

1. 「下絵から始める」でPDF・PNG・JPEG・WebPを選びます。20MB以下、PDFはページ選択、最大長辺3072pxへ変換。
2. プレビューで回転・余白切り抜き。「この下絵で描き始める」で先に手描きできます。元のPDF・画像も端末へ保存します。
3. 「基準寸法」で2点の実寸をmm入力。既に校正済みの案件を再校正する場合は別案を作ります。
4. 下絵差し替えでは線や部品を保持。設定の「下絵だけの基準寸法」で既存図形の実寸を変えずに新しい下絵を補正できます。
5. 清書の直線・折れ線・長方形・楕円・面、6種類の素材、8種類の部品、寸法、複数行注記を使います。
6. 手描き線の終わりで少し止めると形を整えます。選択後の「手描きを残して清書を作る」でも複製して整えられます。AIによる認識ではありません。
7. 「出力」→A4/A3・PDF/PNG→プレビュー→保存。表示中の手描きを初期設定で含めます。
8. 区切りで「原本付き編集データをバックアップ」。.garden.zipを「編集データを開く」へ戻すと別案件として復元。旧.garden.jsonも読めます。

Apple Pencilは手描き、選択モードの指は選択・移動、2本指は移動・拡大縮小。「指で描く」で指による描画も可能。部品・寸法には先に基準寸法が必要です。数値はEnterかフォーカス移動で確定。

## 保存と互換性

- IndexedDBの同じ名前を維持し、バージョン2へ追加移行。v1案件は初回保存前にlegacyへ退避。
- 編集を約800ms後に端末保存。失敗時は別案保存・再試行・バックアップを案内します。
- CAS（版番号の照合）で別タブ・別端末の古い版による上書きを防止。
- 下絵のdata URLは端末内でバイト列へ変換して同期。外部通信を使わず、本番の同一サイト通信制限を維持します。
- D1接続後は待機5秒・最長30秒の目安で同期。通信失敗後は30秒〜5分間隔で再試行。衝突した案件は「両方を残して解決」で端末版を別案として保存。
- 取得したクラウド版と同期情報は同一の端末保存処理で確定。解決中に別タブが更新した場合は全体を取り消します。
- データは同じURL・同じブラウザーごとに分かれます。localhostの案件を公開URLへ移す際もバックアップを使います。

## Cloudflare配信とD1の接続

専用プロファイル gofg-kawakahi を使用。scripts/cloudflare-account.mjs は別案件のPC共通認証を子プロセスから除外します。資格情報は読まず、CLI自身に扱わせます。本人用設定はGit対象外の.wrangler/deploy.wrangler.jsoncです。

```powershell
npm run cf:whoami
npm run cf:check
npm run cf:deploy
npm run cf:verify -- https://gofg-exterior-sketch.kawakahi135.workers.dev
```

2026-10-04: 本人ログイン済み管理画面でWorkers Freeを確認し、同名D1を新規作成。D1コンソールでmigrations/0001_cloud.sqlを実行し、5テーブル・2索引を確認。DBバインディングを配信済みです。版ID: 1003fd9f-2207-4ae2-aeb4-3e1d9564e26c。DBのIDは本人用設定に保持。CLIのD1 OAuth権限は追加していません。コンソール実行のためWrangler移行履歴には未登録です。

以下は今後CLIで初期接続を行う場合の手順です。既に本番接続済みなので、新しいDBを重複作成しないでください。本人の承認・ログイン完了後に実施します。課金プランへ変更せず、対象アカウントのWorkers/D1無料枠を管理画面で確認します。

```powershell
npm run cf:login-storage
npm run cf:whoami
npm run cf:storage:list
# 同名の既存DBがないことを確認してから一度だけ作成
npm run cf:storage:create
npm run cf:storage:bind -- 作成結果のdatabase_id
npm run cf:storage:migrate
npm run cf:check
npm run cf:deploy
```

login-storageで追加する権限はd1:writeのみ。認証の既存権限はaccount:read・user:read・workers_scripts:writeを維持します。別アカウントの認証やDBを流用しません。

DBは1MB単位のファイル分割、SHA-256照合、原本・プレビューの重複排除、直近10版の履歴を保持。base64保存の増量を見込み、約400MiBの計算上限で新規予約を拒否します。D1自体の容量・クエリー上限でも保存は失敗扱いとなり、端末版を残します。上限は無課金を保証する課金設定ではないため、無料プラン確認は省略しません。R2・有料サービスは追加していません。

通常モードではAPI全経路でAccess署名・発行元・対象・本人メールを検証。開発モードでは状態案内以外の全APIを拒否し、DBへ接続しません。更新は同一Originと専用ヘッダーを要求。DB未接続時は端末保存だけを提供し、同期済みと表示しません。認証設定がない場合は配信を拒否します。

## 現在の境界

- iPad向けWeb/PWAです。Safari共有→ホーム画面に追加。App Store版は別工程です。
- 新しく起動するときは通信が必要。開発中はメール確認なし、通常モードでは本人認証が必要。既に開いている案件は通信が切れても編集・端末保存を継続できます。
- Apple Pencil実機での描き心地、手のひら接触、30分連続操作は未検証。
- D1接続・公開URLでの下絵付き保存と履歴復元は確認済み。独立した実機2端末での同期・競合の確認は残っています。
- PDFは打ち合わせ用の画像PDF。固定印刷縮尺・CAD・3D・勾配・製品固有の形状には未対応。
- 素材の面積は単純な閉じた形状の平面計算です。交差する多角形や施工数量の積算には別の確認が必要です。
- 図形3000個、合計20万点、1本2万点まで。大きい案件は別案や別図面に分けて保管します。

## 参考と検証用素材

参考投稿: https://www.instagram.com/p/DYB5uQ8z0su/
公開PDF: public/samples/SOURCE.txt に取得元を記録。社内検証用。開発モードではメール確認なしで取得でき、通常モードでは本人認証後のみ取得できます。
観測した「下描き→清書→素材→部品→寸法」の流れを反映しました。参考製品の全機能一致・同じ画面・3D機能の実装を主張するものではありません。

### 2026-10-04 本番接続時の修正

下絵のdata URLをfetchする実装が本番の同一サイト通信制限に遮断され、下絵付き同期が失敗していました。端末内のバイト変換へ修正し、通信制限は維持。原本付き同期の回帰テストを追加しました。本番で689,222バイトの公開PDFを取り込み、手描き1要素を保存、版2を別案へ復元。復元原本と元PDFのSHA-256一致を確認。元案件と復元案の2件を検証用として残しています。端末データの消失はありません。最終配信後も本人認証20項目通過。

## 開発中のメール確認省略（2026-10-06）

PUBLIC_APP=trueでは画面だけを認証なしで開き、全クラウド図面APIの読み書きを停止します。作業は同じ端末・ブラウザーへ保存し、端末間は原本付きZIPで引き継ぎます。既存DBの内容は変更しません。

本人の実行直前承認後、このWorkerのAccess保護範囲を「WorkerのプレビューURL」だけへ変更済み。本番URLはメール確認なしで起動します。25項目の本番匿名検証と、見本16要素の端末保存・再読み込みを確認しました。

完成後はPUBLIC_APP=falseで再配信し、このWorkerのCloudflare Accessを「すべてのTraffic」（本番URLとプレビューURL）へ戻します。その後cf:verifyと本人ログイン後のクラウド保存・同期を確認します。既存の許可ポリシー・AUD・署名・本人メール確認・D1の紐付けは保持してあります。

## v0.3 iOSアプリ（2026-10-07）

アプリはCapacitor 8.5.3／Swift Package Managerでv3エディタだけを同梱します。iOS 17以降のiPad・iPhoneに対応し、起動・下絵PDF／画像・編集・端末保存・書出しをオフラインで使います。Cloudflare Workerへの接続はありません。Web版の公開は今回の作業に含みません。

### Windowsでの準備

```powershell
npm ci
npm test
npm run build
npm run build:app
npx cap sync ios
# アイコンを更新する場合のみ
npm run ios:assets
```

`build`は従来のWeb版（?v=2も維持）、`build:app`はv3だけをdist-appへ生成します。アプリ入口の?v=2は無効です。アセットとpdf.jsワーカーは相対URLで同梱し、PWAやService Workerへ依存しません。cap syncがios/App/App/publicへコピーする生成物はgit対象外です。server.urlは設定しません。

### Macがない場合の検証

非公開リポジトリ：[gofg-exterior-sketch](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch)

```powershell
gh workflow run verify-ios.yml --ref main
gh run list --workflow verify-ios.yml
gh run view <run-id> --log-failed
gh run download <run-id> --name ios-simulator-evidence --dir C:\tmp\gofg-ios-evidence
```

verify-iosはWebテスト・Webビルド・アプリビルド・SPM同期・署名なしシミュレータビルドを実行します。その後iPad／iPhoneの実際のWKWebViewで、下絵PDF、合成ペン入力、PNG/PDF/JSONの共有シート、JSON復元、アプリのプロセス再起動後のIndexedDBを検証します。画面と共有シートのスクリーンショットはios-simulator-evidenceへ14日間保存します。合成入力はApple Pencilの実機筆圧・手のひら除外・Scribbleの確認ではありません。

### 配布の初期設定と手動実行

1. [Apple DeveloperのIdentifiers](https://developer.apple.com/account/resources/identifiers/list)でApp ID `com.kawakahi.gofgsketch`を登録します。rhythmと同じチームを選びます。
2. [App Store Connect](https://appstoreconnect.apple.com/apps)で「外構スケッチ」を作成します。iOS、日本語、上記Bundle ID、SKUは例 `gofg-exterior-sketch`。
3. [GitHub Actions Secrets](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/settings/secrets/actions)へASC_PRIVATE_KEY / ASC_KEY_ID / ASC_ISSUER_ID / APPLE_TEAM_IDを登録します。rhythmと同じAPIキーとチームを使います。値をチャット・コマンドラインへ貼りません。既存GitHub Secretsの値は取得できません。

2026-10-08、App ID／App Store Connectアプリの登録と4つのGitHub Secretsの設定は完了しています。App ID／アプリ登録と識別情報の設定はCodexが実施し、Appleログインと秘密キーの入力は本人が実施。秘密キーの内容を取得しないルールは維持しています。

4. upload=falseの署名済みIPA検査は成功済みです。再検査する場合は次を実行します。

```powershell
gh workflow run testflight.yml --ref main -f upload=false
gh run list --workflow testflight.yml
gh run view <run-id> --log-failed
```

検査対象はBundle ID、iPad/iPhone両対応、最低iOS版、日本語の権限利用目的、署名、チーム、有効期限、App Store向け配布形式です。ビルド番号は1.実行番号.再実行番号。署名情報とIPAは一時ディレクトリのみで扱い、Artifactsには残しません。upload=falseではAppleへのアップロードは発生しません。

5. 本人がGitHubのActions → Sign and prepare TestFlight → Run workflowでuploadをtrueにして実行します。Appleの処理完了後、App Store Connect → TestFlightで内部テスターを追加し、iPadのTestFlightからインストールします。設定は内部テスト向けです。

2026-10-08 11:33 JST、本人が実行した[upload=true](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37718163594)が成功。0.3.0（1.4.1）の署名検査、Appleのアップロード前検証、アップロードがエラーなしで完了。TestFlightでの処理完了とテスター追加は別途確認する。

### ブラウザ版からのデータ引継ぎ

1. Web版v0.3で、移したいキャンバスを開きます。
2. 「編集データを書き出す」、または「設定」→「編集データ」で `.garden3.json` を保存します。下絵と図形を含みます。
3. iPad／iPhoneの「ファイル」に置きます。AirDropやiCloud Driveでもかまいません。事前に端末へダウンロードすればオフラインでも開けます。
4. アプリのホーム「編集データを開く」からそのファイルを選びます。別のキャンバスとして端末に保存します。
5. 下絵・線・寸法を確認します。v2の.garden.zip／.garden.jsonは形式が異なり、v3へ直接は取り込めません。

DB名は同じgofg-sketch-v3ですが、Webとアプリは別の保存領域です。自動同期・自動移行はありません。独自登録オブジェクトのライブラリは既存のキャンバスJSONに含まれないため、使用した図面では再登録と見え方の確認が必要です。アプリ削除で端末データも消えるため、区切りごとに編集データを「ファイル」へ保存してください。

### ファイル入口と実機確認

実コードはホーム2入口とエディタ4入口の計6入口です（指示書の「5」は数え違い）。ホームの下絵／JSON、エディタの下絵差替え／写真ライブラリ／カメラ／JSONを確認対象とします。既存input type=fileを維持します。カメラ実撮影とHEIC等の写真形式は実機で確認します。PNG/PDF/JSONに加え、テクスチャPNGもネイティブ共有シートで「ファイルに保存」等を選択します。

最終[シミュレータ検証](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706029379)と[署名検査（upload=false）](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706036980)は成功しています。確認画面、実機確認と残項目は[HANDOFF-ios.md](HANDOFF-ios.md)。

参考：[Capacitor 8とSPM](https://capacitorjs.com/docs/updating/8-0)、[Share API](https://capacitorjs.com/docs/apis/share)、[Scribble制御](https://developer.apple.com/documentation/uikit/uiscribbleinteractiondelegate)。


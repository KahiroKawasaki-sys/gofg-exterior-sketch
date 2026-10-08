# 外構スケッチ iOS 引継ぎ

更新：2026-10-08。正本はCODEX-IOS-APP.md。
リポジトリ：https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch （非公開）

## 実装済み

- 外部バックアップ、git化、秘密情報検査、非公開リポジトリ作成とpush。
- v3専用オフラインビルド、Capacitor 8.5.3／SPM、iOS 17以上、iPad／iPhone。
- WKWebViewのページスクロール・バウンド・ページ拡大・履歴スワイプの抑止。既存のキャンバス2本指処理を維持。
- PNG/PDF/JSON/テクスチャPNGの一時保存→共有シート。キャンセル・失敗時も一時ファイルを整理。
- native専用セーフエリア、キーボードでキャンバスをresizeしない設定、Scribble制御。
- 日本語の権限利用目的、1024pxアイコン、無地起動画面、プライバシー宣言。
- 手動verify-iosと手動testflight（upload初期値false）。READMEへ配布・引継ぎ手順を追記。

## 検証結果

- 改修前Web：69テスト・ビルド成功。
- 改修後：79テスト成功。Webとアプリ用の型検査・ビルド成功。署名検査のPythonテスト7件成功。
- 開発依存の警告を修正。npm auditは0件。
- Macシミュレータ：[最終verify-ios](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706029379)成功。iPad Pro 13-inch (M5)／iPhone 17 Pro、iOS 26.4.1。操作一巡と別プロセスでの再起動の計4テスト通過。
- 署名済みIPA：upload=falseの[署名検査](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706036980)成功。署名／配布プロファイル／権限／Universalを検査。
- 2026-10-08 11:33 JST、本人が実行した[upload=true](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37718163594)が成功。0.3.0（1.4.1）の署名検査、Appleのアップロード前検証、アップロードがエラーなしで完了。2026-10-08、App Store ConnectのTestFlightで0.3.0（1.4.1）が「テスト準備完了」であることを確認。内部テスター登録と実機インストールは未実行。

## 画面証拠と確認範囲

最終検証：2026-10-08。元のPNGを`docs/ios/evidence/`へ保存。全画面と上下の余白、iPhoneホームのアプリ名、道具とパネル、共有シートを実表示で確認。

| 端末 | ホーム | 描画 | PDF共有 | プロセス再起動後 |
| --- | --- | --- | --- | --- |
| iPad | [画面](docs/ios/evidence/ipad-home.png) | [画面](docs/ios/evidence/ipad-drawing.png) | [画面](docs/ios/evidence/ipad-share-pdf.png) | [画面](docs/ios/evidence/ipad-relaunch.png) |
| iPhone | [画面](docs/ios/evidence/iphone-home.png) | [画面](docs/ios/evidence/iphone-drawing.png) | [画面](docs/ios/evidence/iphone-share-pdf.png) | [画面](docs/ios/evidence/iphone-relaunch.png) |

- 同梱されたPDFとpdf.jsで読込、2ページPDFのページ選択、合成ペン描画と筆圧値の保存、ページスクロール抑止を確認。
- ホーム2入口とエディタ4入口の計6入口にFileを渡し、差替え下絵名と写真／カメラ入力からのテクスチャ2件をJSONで確認。
- 実際のiOS共有シートをPNG/PDF/JSONで開き、生成ファイルの形式を検査。キャンセル後の一時ファイル削除と編集継続を確認。
- エディタ／ホームのJSON復元、ページ再読込、アプリを終了して別プロセスで起動した後のIndexedDBを確認。
- 全操作の画面・JSONは[CI実行結果](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37706029379)の`ios-simulator-evidence`にも14日間保存。詳しいXcode診断は7日間。
- 操作検証の待機／ページ選択不足を修正済み。失敗時には表示文言と画面を保存し、失敗を完了として扱わない。配布前の自動検証だけに影響し、公開Webと利用者データへの影響はない。

## Apple登録・署名設定の現状

- App ID登録済み：com.kawakahi.gofgsketch（Developerの説明：Gofg Exterior Sketch）。
- App Store Connect作成済み：[外構スケッチ](https://appstoreconnect.apple.com/apps/6820144141/distribution/info)。日本語、SKU gofg-exterior-sketch。
- GitHub SecretsのAPPLE_TEAM_ID／ASC_KEY_ID／ASC_ISSUER_IDは登録済み。値を文書へ複製しない。
- ASC_PRIVATE_KEYも本人が入力済み。4つのSecret名の存在を確認。値は取得していない。
- 設定確認先：[GitHub Actions Secrets](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/settings/secrets/actions)。値をチャットへ送らない。

## 設定の担当

1. 本人のAppleログイン完了。パスワード・確認コードはチャットへ送らない。
2. CodexがApp IDとApp Store Connectのアプリ登録を完了（2026-10-07本人指定／2026-10-08完了）。
3. CodexがGitHub設定を準備。秘密キーの値が必要な入力は本人がGitHub画面で行う。登録済みSecretからの取得は不可。
4. Codexのupload=false署名検査は成功済み。
5. 本人のupload=trueは成功済み（0.3.0／1.4.1）。Apple処理後に本人がTestFlightの内部テスターを追加する。

## iPad実機チェック

1. Pencilの軽い／強い筆圧で線が変わる。
2. Pencil描画中・直前の手のひら接触で線が途切れず、ページが動かない。
3. 描画中に拡大鏡・文字選択・コールアウト・Scribbleが出ない。文字はキーボードで入力できる。
4. 指1本の自動／描く／画面移動、2本指の移動・拡大・回転が動く。
5. Split View／Slide Over／縦横回転で道具が隠れない。
6. ホームのPDF／画像／JSON、エディタの下絵差替え／写真／カメラ／JSONを実際の選択画面で開ける。
7. PNG/PDF/JSONを「ファイルに保存」し、JSONを戻せる。共有キャンセル後も編集できる。
8. キーボード表示中もキャンバスが押し上がらず、フォームの確定ボタンへ到達できる。
9. 通信を切って起動・読込・編集・書出し・保存を行い、終了して開き直しても残る。
10. 30分連続操作、重い下絵、AirDrop／LINE等の共有先を確認する。

## 境界・残課題

- シミュレータの合成ペン入力はApple Pencil実機の確認ではない。
- inputへFileを渡す検証と、iOSのファイル選択画面から選ぶ操作は区別する。未確認の選択画面は実機で確認。
- 共有シートを開く確認と、外部共有先へ実送信する操作は別。実送信は本人が行う。
- カメラ実撮影とHEIC等は実機確認が必要。既存読込仕様を維持。
- Pencilダブルタップによる道具切替は任意項目として未実装。
- Web／アプリ間はv3 JSONで引継ぎ。v2と独自登録ライブラリの自動移行は対象外。
- Web版のCloudflareデプロイは実行していない。

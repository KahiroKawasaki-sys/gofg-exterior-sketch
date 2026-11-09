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
- 2026-10-08 11:33 JST、本人が実行した[upload=true](https://github.com/KahiroKawasaki-sys/gofg-exterior-sketch/actions/runs/37718163594)が成功。0.3.0（1.4.1）の署名検査、Appleのアップロード前検証、アップロードがエラーなしで完了。2026-10-08、App Store ConnectのTestFlightで0.3.0（1.4.1）が「テスト準備完了」であることを確認。本人の追加承認後、Codexが「本人テスト」を作成し、本人1名とビルド1.4.1を登録。「招待済み」を確認。自動配信は無効。実機インストールとPencil等の実機確認は未実施。

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
5. 本人のupload=trueは成功済み（0.3.0／1.4.1）。最新の本人承認によりCodexが内部テスター1名の登録・招待を完了。次はiPad／iPhoneから招待を受け取りインストールする。

## iPad／iPhoneへのインストール

1. 使用する端末に[TestFlight](https://testflight.apple.com/)を入れる。外構スケッチはiOS／iPadOS 17以上。
2. その端末でAppleから届いた「外構スケッチ」の招待メールを開き、「View in TestFlight」を押す。招待先は本人のApple登録メール。
3. TestFlightで「承諾」→「インストール」。外構スケッチ0.3.0（1.4.1）を開く。
4. まずPDFを開く→Pencilで描く→編集データJSONを「ファイルに保存」→アプリを終了して開き直す、の順に確認する。詳しい実機チェックは次節。

公式手順：[TestFlightのインストール方法](https://testflight.apple.com/#installation)。管理画面での「招待済み」はメール到着・招待承諾・実機インストール完了の確認とは区別する。

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

## アプリ2本の作り分け（2026-10-17）

- 同じソースから2本を作る。TestFlightワークフローの「edition」で選ぶ。
  - `sketch`：外構スケッチ（com.kawakahi.gofgsketch）。2Dの図面描きだけ。3D・DXF・集計・見積・打ち合わせAIのボタンを出さない。
  - `pro`：外構スケッチ Pro（com.kawakahi.gofgsketch.pro）。全部入り。アイコンに「PRO」の帯（`scripts/make-pro-icon.mjs`）。
- 画面側の切替は `VITE_EDITION`（`src/v3/edition.ts`）。Web版は指定なし＝全部入り。
- Pro の打ち合わせAI（2026-11-08 から「録音→文字→AI」方式）：
  - 録音は端末の `ios/App/App/RecorderPlugin.swift`（JSからは `GofgRecorder`）。AAC 16kHz 32kbps、3分ごとに区切ってファイルにし、区切りごとに base64 で JS へ渡す。`UIBackgroundModes: audio` で画面ロック・他アプリ切替中も録音が続く（橙のマイク表示）。着信などの中断は自動で再開。文字にし終えた区切りは JS から `discard` で消す。
  - 文字起こしは本番Workerの `/api/ai/transcribe`（Cloudflare Workers AI の Whisper large-v3-turbo。日本語＋外構用語の前置き）。本番の配信設定 `.wrangler/deploy.wrangler.jsonc`（git管理外）にも `"ai": {"binding": "AI"}` が要る（2026-11-08 に追加済み）。要望の読み取りは `/api/ai/meeting`（Claude Opus 5.5。ツール強制が使えないので auto＋言い直し）。どちらも端末の通信（CapacitorHttp）で呼ぶ。
  - その場の音声認識（`SpeechPlugin.swift`、`GofgSpeech`）はコードを残しているが画面からは使っていない（将来のリアルタイム用）。
  - 通行証は当面 Cloudflare Access のサービストークン。GitHub Secrets `AI_ACCESS_CLIENT_ID`／`AI_ACCESS_CLIENT_SECRET` をProのビルドに埋め込み、Accessのポリシーで通したサービストークンには打ち合わせAIだけを通す（Worker の変数 `APP_SERVICE_TOKEN_ID` にClient IDを入れれば、そのトークンに限定できる）（クラウド図面には入れない）。Accessのポリシーにこのトークンの「Service Auth」ルールが必要。
  - 個別ライセンスキー方式へ切り替えるときは `src/v3/appAuth.ts` と Worker の判定だけを差し替える。
- Pro の初回配信前に、App Store Connect で「外構スケッチ Pro」（バンドルID com.kawakahi.gofgsketch.pro）のアプリ枠を作る必要がある。内部テスターのグループ「本人テスト」は初回配信時に外構スケッチと同じテスターで自動作成する。

## 打ち合わせ（録音）の実機確認（2026-11-08）

TestFlight の Pro ビルドで、次を順に確認する。Web版（iPad Safari）も同じ流れで動く（ログイン必須）。

1. 初回：「録音を始める」でマイクの許可文言（録音して文字にする・文字にし終えた音声は削除）が出て、許可すると赤い「録音中 0:00」が進む。
2. 3〜4分話す（外構用語：カーポート・インターロッキング・乱形石・立水栓・目隠しフェンス・防草シート・化粧ブロック・門柱・擁壁 を混ぜる）→ 3分で最初の区切りが自動で送られ、「文字起こし済み 3:00／3:40」のように進む。
3. たたむ（∨）→ 右下に「録音中 m:ss」のピルが残り、図面を描いても録音が続く。ピルを押すと戻る。
4. 画面を消す（電源ボタン）→ 30秒後に戻すと録音が続いている（上部に橙のマイク表示）。Safari に切り替えて1分話しても同じ。
5. 着信（別の電話から）を受けて切る → 「録音を中断しています」→ 自動で「録音中」に戻る。
6. 「録音を止める」→ 残りの区切りを文字にし、自動でAIが要望カードを出す。カードの「反映」で塀の高さ・見積の追加項目・予算が入る。「まとめをコピー・共有」で共有シートが開く。
7. 「会話の記録を見る」で時刻（録音開始からの m:ss）付きの行が並び、鉛筆で直せる。専門用語の誤りがあれば、AIのカードで読み替えられているか見る（例：卵形石→乱形石）。
8. 機内モードで録音を止める → 「送り直す」が出る。機内モードを切って押すと文字になる。
9. 60分録音：バッテリーの減り（目標 25%/時以下）、終了後に「保存済み」に戻ること、設定＞一般＞iPhoneストレージでアプリの書類とデータが増えっぱなしでないこと（区切りは文字にし終えると消える）。
10. 2D版（sketch）には「打ち合わせ」ボタンと使い方の動画が出ないこと。

既知の制限：録音中にアプリを強制終了すると、文字にしていない区切りは送られない（ファイルは Caches に残るが次回の取り込みは未実装）。

## 3D：立面図から家を立てる（2026-11-09 版）

入口は3つ：ホーム「下絵から始める」で配置図を読み込んだ直後の「立面図はありますか？」／設定パネルの「立面図（3D）」／3Dビューの「立面図を読み込む」。

- **配置図（下絵）の実寸**：PDF の文字から「配置図 S=1/150」などの縮尺を読み、用紙サイズ（縦横比から A3/A4）と合わせて下絵の大きさを実寸にする（`src/v3/elevLabels.ts` の `drawingScale` / `underlayWidthPx`）。縮尺が無い PDF・画像は従来どおり 1200px → 「縮尺合わせ（2点）」。
- **立面図の読み取り**（`ElevationDialog.tsx` → `elevation.ts`）：用紙を4等分して濃い範囲に縮めた枠を初期値にし、面は PDF の「東側立面図」などのラベルで割り当て（`faceForCrop`）。高さは「▽最高高 (7,807)」「▽最高軒高 (5,994)」「▽GL±0」の文字の位置から決める（`levelsForCrop`。用紙サイズの推定には頼らない）。壁の端は軒〜GLの縦線のうち、縦書きの寸法の数字のそば・屋根の中まで通る線を除いた外側2本（`bodyFromLevels`）。屋根の輪郭は棟〜軒の各列の上端。文字が無い画像は従来の画素だけの推定（`findBody`）に落ちる。
- **3D**（`View3D.tsx` の `buildingWithElevations` / `roofSolid`）：壁は軒の高さまで、各辺の向き（東西南北）の絵の「壁の範囲」を外から見た向きで貼る。屋根は妻側（輪郭の山が大きい面）の輪郭を断面にして、直交方向へ建物＋軒の出 0.45m ぶん押し出した立体。
- **建物の自動配置**（`scene3d.ts` の `withElevations` / `footprint.ts`）：建物の囲みが無ければ、南北面の壁の幅＝東西の長さ、東西面＝南北の長さの四角を作り、配置図の中で線がいちばん重なる位置（`locateFootprint`、点数 0.55 以上）に置く。見つからなければ下絵の中央。「動かす」で手直しできる。
- 確認用サンプル（滝本様から 11/2・11/6 受領の 立面図・配置図 ①②③）：`手書き図面アプリ/立面図サンプル_20261106/`。3邸とも面・高さ・壁幅の読み取りを確認済み（②＝6.8×8.5m、①＝8.0×11.2m の平屋、③＝9.9×10.8m）。
- **見た目（2026-11-09 昼）**：壁の線画は薄いグレーにし、外壁色（7色）・屋根色（5色）を3D画面の色玉で選ぶ（`doc.elevStyle`）。立面図の壁の中で線に囲まれた穴を窓として検出し（`detectWindows`、格子はまとめる）、ガラス＋サッシの立体を壁に置く（`windows3d`）。屋根は厚み0.15m・段模様（`roofMaterial`）・棟包み。地面は配置図から「建物に重なる大きな線画」だけを薄いグレーで残す（`siteGround.ts`。文字・表題欄・求積図・用紙の枠は消える）。敷地の外は芝。
- **外構部品の3D（2026-11-09 昼）**：建物以外の部品は `src/v3/solids3d.ts`（樹木＝幹・枝・重ねた球、コニファー、低木、生垣、門柱＝笠木・表札・ポスト口・インターホン、機能門柱＝照明付き、カーポート＝片側柱＋半透明屋根、物置、車＝側面輪郭の押し出し、照明）。`scene3d.ts objSolid` が部品ID→形（kind）を決める。ウッドデッキの塗りは 0.4m の立体（`deckObjects`、`textureContours` の輪郭から）。
- 既知の限界：L字の建物は外形の矩形に屋根を掛ける。下屋（1階の低い屋根）は妻側の輪郭に含まれる範囲でだけ表れる。立面図が画像（文字なし）のときは精度が落ちる。

## AIパース：3D → 写真調（2026-11-09 夕）

- **使い方**：3D画面右上の「AIパース」→ 今の視点の写しが左上に出る → 時間帯（昼・夕方・夜）と「お客様の希望」（例：塀は黒いタイル）を選んで「パースを作る」。30秒〜1分で右に写真調の絵が出る。「保存・共有」で iPad の共有シート（Web はダウンロード）。何枚か作ると下に帯で並び、左上の「元の3D」をタップすると見比べられる。できた絵は端末（IndexedDB `renders`、図面IDつき）に残り、同じ図面の3Dから開き直すとまた見られる。図面データ本体には入れない（容量のため。クラウド同期・バックアップZIPにも入らない）。
- **仕組み**：`src/v3/RenderDialog.tsx`（画面）、`src/v3/render.ts`（写しを長辺1536pxのJPEGにして `/api/ai/render` へ）、`worker/render.ts`（Google の画像モデル **Nano Banana 2.1 `gemini-nano-banana-2.1`** を Interactions API で呼ぶ。視点・時間帯・希望を英語の指示にし「形・配置・視点は変えず材質と光だけ」と念を押す。出力は 2K の JPEG、1枚 約$0.05≒8円）。画像は変換するだけで保存しない。アプリ（サービストークン）からも使える。利用記録は `provider:'google'` で複業マネージャーへ。
- **設定（本人作業・未完了）**：Worker に `GEMINI_API_KEY` が必要。未設定だと「AIパースの準備がまだできていません」と出る（他の機能は影響なし）。リポジトリ直下で `npx wrangler secret put GEMINI_API_KEY` を実行し、Google AI Studio で **この用途専用に発行した鍵**を貼る（台帳に記録）。モデルを替えるときは `RENDER_MODEL`、思考量を指定するときは `RENDER_THINKING`（minimal/medium/high。未設定ならモデル既定）。
- **実機で見るところ**：①鍵設定後、サンプル邸の3Dで昼→30秒〜1分で絵が出るか ②立面図を入れた邸で家の形・色・窓が保たれるか（崩れるなら指示文を調整） ③夕方・夜で灯りがつくか ④「保存・共有」で写真に保存できるか ⑤生成中に「3Dへ戻る」→ 開き直すと絵が残っているか。
- **限界**：AIの想像で細部が変わる（植栽の種類・塀の模様など）。同じ設定でも毎回少し違う。真上視点は航空写真風になるだけで図面としては使えない。

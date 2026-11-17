# 「App のプライバシー」質問票の回答案 — 外構スケッチ Pro

App Store Connect ＞ アプリ ＞ 外構スケッチ Pro ＞ 左メニュー「App のプライバシー」で入力する（API では入力できない。手作業）。
Apple の定義：「収集」＝端末の外へ送り、**リアルタイム処理に必要な時間を超えて**保持できる状態にすること。送ってすぐ処理して捨てるだけなら「収集しない」でよい（Apple「App privacy details」の Optional disclosure の条件）。

## 前提にした事実（コードで確認）
| 事実 | 根拠 |
|---|---|
| 図面・議事録・AIパースは端末内保存（IndexedDB 等） | `src/v3/store.ts`（saveDoc / saveRender）、`src/v3/RenderDialog.tsx:2` |
| 図面・議事録・AIパースの保存先は端末の IndexedDB | `src/v3/store.ts:8,30,40` |
| アプリから送る先は自社 Worker だけ（`API_ORIGIN`） | `src/v3/platform.ts:60-72` |
| Web 版のクラウド保存（D1）はアプリからは使えない（アプリは AI の3つの口だけ通す） | `worker/index.ts:33-36` |
| 音声は Workers AI で文字にするだけで保存しない | `worker/transcribe.ts:1-2,103-106` |
| 画像は Gemini へ転送するだけで Worker は保存しない | `worker/render.ts:2,92-99,122` |
| 議事録用の文章は Anthropic へ転送するだけで保存しない | `worker/ai.ts:4,124-133` |
| 利用記録は内容を含まない（provider/model/feature/status/latency/tokens/audioSeconds/images/日時） | `worker/usage.ts:1-18`、呼び出し `worker/transcribe.ts:105`、`worker/render.ts:104,111`、`worker/ai.ts:108,113,127,129` |
| 利用記録の送り先は自社の管理システム（fukugyo-manager。Vercel 上） | `worker/usage.ts:4` |
| 利用記録に利用者・端末の識別子は入っていない（現行コード） | `worker/usage.ts:17` の body は event＋occurredAt のみ |
| Worker のログ（Workers Observability）が有効 | `wrangler.jsonc` の `observability.enabled: true` |
| ライセンスキー・端末識別子 | **現行コードには未実装**（`src/v3/appAuth.ts:3` に「ライセンスキー方式に切り替えるときはここを差し替える」）。別担当の実装後に送る項目を再確認すること |

## 回答案

**データ収集の有無：「はい、このAppからデータを収集します」**（ライセンス確認のための識別子と、利用記録を保持するため）

| データの種類（Apple の分類） | 収集 | 用途 | ユーザーに紐付け | トラッキング | 根拠・メモ |
|---|---|---|---|---|---|
| ID ＞ **ユーザ ID** | する | App の機能 | **はい** | いいえ | ライセンスキーは契約企業・利用者に紐付く識別子。キー実装後に確定（キーを端末識別子と一緒に保存する前提） |
| ID ＞ **デバイス ID** | する | App の機能 | **はい** | いいえ | 「1キー＝同時1端末」のためアプリが作る端末識別子を送って保存する前提（IDFV／アプリ内 UUID。IDFA は使わない） |
| 使用状況データ ＞ **製品の操作** | する | 分析（費用管理）、App の機能（不具合対応） | いいえ（現行） | いいえ | 機能名・成否・処理量。現行は識別子を付けていない。**キー実装で利用記録にキーや端末IDを付けるなら「はい」に変える** |
| 診断 ＞ その他の診断データ | しない | — | — | — | クラッシュ収集 SDK なし。Workers のログは通信の記録のみ（下記注） |
| ユーザコンテンツ ＞ **オーディオデータ** | しない | — | — | — | 文字起こしのためだけに送り、Worker は保存しない（リアルタイム処理）。※注1 |
| ユーザコンテンツ ＞ **写真またはビデオ** | しない | — | — | — | AIパースの3D画像も同様に処理のみ。※注1 |
| ユーザコンテンツ ＞ その他のユーザコンテンツ | しない | — | — | — | 議事録用の文字・希望文も処理のみ。※注1 |
| 連絡先情報（名前・メール・電話・住所） | しない | — | — | — | アプリ内で集めない（契約はアプリ外） |
| 位置情報・健康・財務・連絡先・閲覧履歴・検索履歴・購入 | しない | — | — | — | 該当なし |

**トラッキング：使用しない**（ATT のダイアログも不要）。

### 注1：音声・画像・文章を「しない」にできる条件と、今の弱点
- 自社 Worker は保存していない（上の根拠）。Apple の Optional disclosure の条件「リアルタイムで処理し、その目的に必要な時間を超えて保持しない」を満たすのは**自社部分だけ**。
- **Google Gemini の Interactions API は既定で入出力を保存する**（`store` の既定値は true。有料枠 55 日・無料枠 1 日保持。出典: https://aistudio.google.com/docs/interactions-overview ）。`worker/render.ts:92-93` のリクエストに `store:false` が無いので、今のままだと Google 側に 3D 画像と希望文が 55 日残る。
  - **推奨（別担当へ依頼）**：`worker/render.ts` の body に `store: false` を足す。足せば「写真またはビデオ：収集しない」のまま説明がつく。
  - 足さずに出すなら、より安全側に倒して「写真またはビデオ：収集する／App の機能／紐付けなし」と答える。
- Anthropic API は既定で学習に使わず、一定期間（不正利用監視のため）保持する規約。Cloudflare Workers AI は入力を保存・学習しない方針。いずれも「処理委託」扱いで「収集しない」とするのが一般的（要確認：最終判断は依頼主）。

### 注2：Workers のログ
`wrangler.jsonc` で Observability が有効（head_sampling_rate 1）。リクエストの URL・メソッド・結果などの記録が Cloudflare に短期間残る（保持期間はプラン依存、要確認）。本文（音声・画像）は記録しない。IP アドレスは Apple の分類で「収集」に当たらない扱いが一般的だが、プライバシーポリシーには「通信の記録」として書いた。

## `ios/App/App/PrivacyInfo.xcprivacy` の現状と差分（ファイルは変更していない）

現状：
- `NSPrivacyAccessedAPITypes`: FileTimestamp（C617.1）のみ
- `NSPrivacyCollectedDataTypes`: **空**
- `NSPrivacyTracking`: false

直すべき内容（提案。ライセンス実装と同じ担当が入れるのが安全）：
1. `NSPrivacyCollectedDataTypes` に、上の「収集する」と一致する3件を足す（質問票とマニフェストの食い違いは審査で指摘されやすい）。
   ```xml
   <key>NSPrivacyCollectedDataTypes</key>
   <array>
     <dict>
       <key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypeUserID</string>
       <key>NSPrivacyCollectedDataTypeLinked</key><true/>
       <key>NSPrivacyCollectedDataTypeTracking</key><false/>
       <key>NSPrivacyCollectedDataTypePurposes</key>
       <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
     </dict>
     <dict>
       <key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypeDeviceID</string>
       <key>NSPrivacyCollectedDataTypeLinked</key><true/>
       <key>NSPrivacyCollectedDataTypeTracking</key><false/>
       <key>NSPrivacyCollectedDataTypePurposes</key>
       <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
     </dict>
     <dict>
       <key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypeProductInteraction</string>
       <key>NSPrivacyCollectedDataTypeLinked</key><false/>
       <key>NSPrivacyCollectedDataTypeTracking</key><false/>
       <key>NSPrivacyCollectedDataTypePurposes</key>
       <array>
         <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
         <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
       </array>
     </dict>
   </array>
   ```
2. **UserDefaults を使うなら** `NSPrivacyAccessedAPICategoryUserDefaults`（理由 `CA92.1`）を足す。ライセンスキーや端末IDを Capacitor Preferences（内部で UserDefaults）に保存する実装なら必須。Keychain なら不要。
3. Capacitor 本体・プラグイン（Filesystem 等）のマニフェストは各 Pod/SPM 側に同梱されているかをアーカイブ後に確認（Xcode ＞ Organizer ＞ アーカイブを右クリック ＞ Generate Privacy Report）。
4. Info.plist の `NSSpeechRecognitionUsageDescription`（`ios/App/App/Info.plist:74`）が「要望をまとめるために」になっている。今の画面は議事録づくりなので「打ち合わせの会話を画面に文字で表示し、議事録をまとめるために使います」に揃えると審査の説明と食い違わない（任意）。

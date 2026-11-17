# 審査メモ（App Review Information）— 外構スケッチ Pro 1.0.0

- `scripts/appstore_submit.py` は、下の「## Notes for App Review」直下のコードブロックを審査メモ欄（notes）へ入れます。`<<REVIEW_KEY>>` は GitHub Secrets `REVIEW_LICENSE_KEY` の値で置き換えて送り、ファイルには書きません。
- 連絡先（氏名・電話・メール）は Secrets から入れます（`REVIEW_CONTACT_*`）。電話番号はこのファイルに書かない。
- 審査用キーは**審査専用に1本発行**し、審査中は失効させない。1キー＝同時1端末なので、審査担当が複数台で試すと弾かれる恐れがある → 審査用キーだけ同時台数を緩める（例: 5台）ことを推奨。
- 審査メモ欄の上限は 4,000 字（要確認：App Store Connect 画面の表示）。下の英日併記で約3,600字（スクリプトが毎回数える）。

## サインイン情報（App Store Connect の欄）
- 「サインインが必要」: **オン**
- ユーザー名: `license-key`（ライセンスキー方式でユーザー名は無いため、欄の必須を満たす固定値。要確認：別担当のキー入力画面がキー1欄だけかどうか）
- パスワード: `<<REVIEW_KEY>>`（Secrets `REVIEW_LICENSE_KEY`）

## 連絡先
- 姓: 川﨑 / 名: 嘉皓
- 電話: `<<REVIEW_CONTACT_PHONE>>`（Secrets）
- メール: `<<REVIEW_CONTACT_EMAIL>>`（Secrets）

## Notes for App Review
```
[English]
Gaiko Sketch Pro is a B2B tool for exterior / landscaping construction companies in Japan (driveways, walls, fences, gates, planting). It is provided only to companies that sign a contract with us (B-BUDDY) directly. There is no account sign-up, no purchase and no price inside the app.

1. License key (sign-in)
The app asks for a license key on first launch. Please enter this review key:
  License key: <<REVIEW_KEY>>
(The "User name" field above is a fixed placeholder; only the key is used.) One key works on one iPad at a time. This review key is active for the whole review.

2. What to try (about 5 minutes)
 a. On the home screen tap "サンプル邸で試す" (Try the sample house). A finished sample drawing opens.
 b. Bottom tabs: 描く (draw) / 部品 (place parts) / 塗る (tap an enclosed area, then pick a material) / 出力 (export PDF).
 c. Tap "3D" (top right). The drawing becomes a 3D model. Switch views with 斜め上 / 人の目線 / 真上.
 d. In 3D, tap "AIパース" then "パースを作る". The current 3D view is sent to an image AI and comes back as a photo-like image in 30-60 seconds. The screen explains that the result is only an image (illustration) and details are imagined by the AI.
 e. Back in the drawing, tap "打ち合わせ" (meeting) and "録音を始める" (start recording). Speak for 1-2 minutes, then "録音を止める". Lines of text appear. Tap "議事録を作る" to get draft minutes.

3. Background audio (UIBackgroundModes: audio)
Meetings with a customer often last 30-90 minutes, and the iPad screen is locked or the user switches to other apps (photos, catalogs) during the meeting. The audio background mode is used only to keep recording the meeting that the user started with the record button. The app shows a recording indicator and the system shows the microphone indicator. Recording stops when the user taps stop. No audio is played in the background and nothing is recorded without the user starting it.

4. Business model (Guideline 3.1.3(c) Enterprise Services)
The app is sold to companies, not to consumers. Contracts and billing are handled outside the app between B-BUDDY and each company, per company and per device. The app contains no prices, no purchase buttons, and no links to buy. Individual consumers cannot buy or use it. This app is intended for unlisted distribution (we will submit the Unlisted App Distribution request after this submission).

5. Data sent to AI services and consent
Drawings, estimates and minutes are saved only on the iPad. Data leaves the device only when the user uses these features:
 - AI image (AIパース): a JPEG of the current 3D view and the optional text request -> our server (Cloudflare Workers) -> Google Gemini API.
 - Meeting transcription: audio in short segments -> our server -> Cloudflare Workers AI (Whisper).
 - Meeting minutes: the transcript text -> our server -> Anthropic Claude API.
Our server does not store images, audio or text; it only forwards them and returns the result. It keeps license information and simple usage counts (feature, success/failure, time, tokens) without content. Before recording, the meeting screen says that audio and text are sent to an external AI service and asks the user to tell the customer first. Microphone and speech permission texts explain the purpose. The privacy policy URL lists the services.

Contact: see the contact fields. Thank you for reviewing.

[日本語・要約]
外構会社向け B2B アプリ。B-BUDDY との直接契約のみで、アプリ内に会員登録・購入・価格表示なし（3.1.3(c)）。Unlisted 配布を申請予定。
・審査用キー：<<REVIEW_KEY>>（初回起動時に入力）
・手順：「サンプル邸で試す」→ 3D →「AIパース」→「打ち合わせ」で録音 →「議事録を作る」
・背景の音声：利用者が始めた打ち合わせ録音を、画面ロック中も続けるためだけに使用
・AIへの送信：3D画像と希望文→Google、音声→Cloudflare Workers AI、文字→Anthropic（当社サーバー経由・内容は保存しない）。録音前に画面で案内
```

## 提出前に指揮側が確かめること
1. 審査用キーで、**TestFlight の同じビルド**が起動〜AIパース〜議事録まで通ること（キー実装は別担当。キー入力画面の文言「ライセンスキー」が上の英語説明と合っているか）。
2. 「サンプル邸で試す」のボタン文言が提出ビルドでも同じこと（`src/v3/App3.tsx:58`）。
3. 審査用キーが審査期間中（数日〜1週間）失効しないこと。承認後に無効化してよい。
4. AIパース画面の注意書き（`src/v3/RenderDialog.tsx:85`）と、打ち合わせの注意書き（`src/v3/MeetingPanel.tsx:151`）が提出ビルドに残っていること。

# 手作業リスト（API でできない／やらないもの）— 外構スケッチ Pro 1.0.0

上から順に。「誰」：**依頼主**＝川﨑さん本人がブラウザで操作、**指揮側**＝Claude（依頼主の OK を取ってから実行）。
App Store Connect の画面名は 2026-11 時点の日本語表示の想定。表示が違うときは英語名（括弧内）で探す。

## A. 提出の前（ワークフローを本番で回す前）

1. **iPad 専用ビルドになっているか確認**（指揮側）
   - 別担当が `TARGETED_DEVICE_FAMILY=2` に変更中。`scripts/distribute.py:62` の配布前チェックは既に「Pro は iPad のみ」に更新済み（作業時点の作業ツリーで確認）。**その変更後に作った新しいビルド**を提出に使うこと（1.25.1 など以前のビルドは iPhone 対応のまま）。
   - iPhone 対応が残ったビルドを出すと **iPhone 6.9インチのスクリーンショットも必須**になり、提出できない。
2. **プライバシーポリシーとサポートページを公開**（指揮側：依頼主の OK 後に Cloudflare Pages へ）
   - `appstore/privacy-policy.html` と `appstore/support.html`。公開前に `<<連絡先メール>>` `<<制定日>>` `<<保存期間>>` `<<ログ保存期間>>` を埋める（メール未定なら公開できない＝提出もできない）。
   - 公開した URL を GitHub ＞ Settings ＞ Secrets and variables ＞ Actions ＞ **Variables** に `APPSTORE_SUPPORT_URL` / `APPSTORE_PRIVACY_URL` として登録。
3. **審査用ライセンスキーを発行**（指揮側／ライセンス担当）— 審査専用。同時台数を緩めた（例: 5台）キーにする。
4. **GitHub Secrets を登録**（依頼主：Settings ＞ Secrets and variables ＞ Actions ＞ Secrets）
   - `REVIEW_LICENSE_KEY`（審査用キー）、`REVIEW_CONTACT_PHONE`（審査担当が電話できる番号。+81 から）、`REVIEW_CONTACT_EMAIL`
   - `ASC_PRIVATE_KEY` / `ASC_KEY_ID` / `ASC_ISSUER_ID` は既存（TestFlight と共通）。**キーの権限が「App Manager」以上か**確認（Developer 権限だとメタデータ・提出が 403）。要確認。
5. **提出するビルドを TestFlight で通し確認**（依頼主＋指揮側）：審査用キーで起動 → サンプル邸 → 3D → AIパース → 録音 → 議事録。iPad 実機で。
6. **Google の画像 AI に入出力を残さない設定**（推奨・別担当）：`worker/render.ts` のリクエストに `store: false` を足してデプロイ（理由は `privacy-answers.md` 注1）。

## B. App Store Connect（ワークフローを dry run → 本番で回したあと）

7. **App のプライバシー**（App Privacy）（依頼主）
   - 場所：App Store Connect ＞ アプリ ＞ 外構スケッチ Pro ＞ 左メニュー「App のプライバシー」＞「はじめに」/「編集」
   - 回答は `appstore/privacy-answers.md` のとおり。最後に右上の **「公開」** を押す（押さないと提出時にエラー）。
   - プライバシーポリシー URL も同じ画面に出る。ワークフローが App 情報に入れているが、入っていなければここで入力。
8. **年齢制限**（Age Rating）（依頼主）
   - 場所：左メニュー「App 情報」＞「年齢制限」＞「編集」
   - ワークフローが API で入れる。新しい質問が増えて未回答があると提出できないので、画面で全項目が埋まり **4+** になっているか確認。
9. **配信状況**（Availability）（依頼主）
   - 場所：左メニュー「価格および配信状況」（Pricing and Availability）
   - 「日本」だけがオン、**「新しい国や地域で自動的に配信」をオフ**。（既に配信状況が作られているアプリでは、この自動配信のスイッチは API で変えられないため画面で。）
   - 価格：無料（ワークフローが未設定時のみ API で設定）。
10. **App Review に関する情報**（依頼主：目視確認のみ）
    - 場所：左メニュー「iOS App」＞「1.0.0 提出準備中」＞ 下の「App Review に関する情報」
    - サインイン情報（ユーザー名 `license-key`／パスワード＝審査用キー）、連絡先、メモが入っているか。
11. **バージョン情報の目視確認**（依頼主）：同じ画面で、スクリーンショット（13インチ iPad の枠に7枚）、説明文、キーワード、サポート URL、ビルド、著作権、**「バージョンのリリース」が「このバージョンを手動でリリースする」**。
12. **契約・税務**（依頼主）：トップ ＞「ビジネス」（Business）で契約に未対応の警告がないか。無料アプリなので有料 App 契約は不要。
13. **EU デジタルサービス法（DSA）の事業者情報**：日本のみ配信なら不要。画面で求められたら「EU で配信しない」を選ぶ。要確認。

## C. 提出と非表示（Unlisted）

14. **審査へ提出**（指揮側：依頼主の OK 後に `submit=true` でワークフロー実行）。または画面右上「審査用に追加」→「審査へ提出」。
15. **非表示アプリ（Unlisted）の申請**（依頼主）
    - 場所：Apple Developer サイトの「Unlisted App Distribution」申請フォーム（https://developer.apple.com/contact/request/unlisted-app/ ）。App Store Connect の外。
    - 記入：アプリ名・Apple ID（App Store Connect の「App 情報」にある数字）・用途（「外構会社と直接契約して配布する業務アプリ。一般向けではない」）・配布先の想定（契約企業数）。
    - **審査へ提出した後に**申請する（未提出・ベータ段階の申請は却下される。審査メモに「Unlisted で配布予定」と書いてある＝Apple の案内どおり。出典: https://developer.apple.com/support/unlisted-app-distribution/ ）。
    - **手動リリースなので、承認されても「デベロッパによるリリース待ち」で止まり、勝手に公開されない。** Unlisted が承認されると「価格および配信状況」の配信方法が「Unlisted App」に変わる。それを確認してからリリースする。
    - リンクを知っていれば誰でも入手できるので、ライセンスキー必須であることが前提（Apple も同じ注意を書いている）。
    - Unlisted が却下された場合の代替：一般公開（検索に出るがキーがないと使えない）か、Apple Business Manager のカスタム App。どちらにするかは依頼主が判断。
16. **リリース**（依頼主）：Unlisted 承認後、「iOS App」＞ 1.0.0 ＞「このバージョンをリリース」。配布用リンク（apps.apple.com/…）を契約企業へ渡す。

## D. 審査用キーの後始末
17. 承認・リリース後、審査用キーを無効化するか同時台数を1に戻す。次の版の審査前にまた有効にする。

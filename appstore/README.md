# App Store 提出（外構スケッチ Pro 1.0.0・iPad 専用）

一般公開ではなく、外構会社と直接契約して配る B2B アプリとして出す。ライセンスキーがないと使えない。アプリ内に価格・購入導線なし（ガイドライン 3.1.3(c)）。配布は**非表示アプリ（Unlisted）**、承認後に勝手に公開されないよう**手動リリース**。

## このフォルダ
| ファイル | 中身 |
|---|---|
| `metadata.ja.md` | 名前・サブタイトル・説明文・キーワード・カテゴリ・年齢区分の回答案（`## 見出し` 直下のコードブロックを提出スクリプトが読む） |
| `review-notes.md` | 審査メモ（英日）。審査用キーは `<<REVIEW_KEY>>` のまま。実値は Secrets から |
| `privacy-policy.html` / `support.html` | 公開用の静的ページ（Cloudflare Pages に置く予定） |
| `privacy-answers.md` | 「App のプライバシー」質問票の回答案と根拠、`PrivacyInfo.xcprivacy` の直し案 |
| `screenshots/ipad13/*.png` | 13インチ iPad 用 2752×2064（横）。ファイル名の順に並ぶ |
| `manual-steps.md` | API でできない手作業（画面の場所つき） |

関連：`scripts/appstore_submit.py`（API で反映・提出）、`.github/workflows/appstore-submit.yml`（手動実行）、`scripts/appstore_screenshots.py`（スクリーンショットの撮り直し）。

## 提出までの手順（自動＝ワークフロー／指揮側＝Claude が依頼主の OK 後に実行／依頼主＝川﨑さん）

1. **依頼主**：残りの空欄を決める — 連絡先メール（`<<連絡先メール>>`）、制定日、ライセンス情報の保存期間。電話番号はファイルに書かず Secrets へ。
2. **別担当（完了待ち）**：iPad 専用化・ライセンスキー画面を入れたビルドを TestFlight へ。`worker/render.ts` に `store:false`（推奨）。`PrivacyInfo.xcprivacy` の更新（`privacy-answers.md` の案）。
3. **指揮側**：`privacy-policy.html` / `support.html` を Cloudflare Pages に公開（依頼主 OK 後）→ URL を GitHub Variables `APPSTORE_SUPPORT_URL` / `APPSTORE_PRIVACY_URL` に登録。
4. **依頼主**：GitHub Secrets に `REVIEW_LICENSE_KEY` / `REVIEW_CONTACT_PHONE` / `REVIEW_CONTACT_EMAIL` を登録（審査用キーはライセンス担当が発行）。
5. **依頼主＋指揮側**：提出するビルドを iPad 実機で、審査用キーで通し確認（サンプル邸 → 3D → AIパース → 録音 → 議事録）。
6. **自動（dry run）**：Actions ＞ *App Store submission (Pro)* ＞ Run workflow（`dry_run=true`、`build`=ビルド番号、`submit=false`）。ログ末尾の「書き込む予定」を依頼主が確認。
   - 手元で通信なしの確認だけするなら：`python scripts/appstore_submit.py --check-only`
7. **自動（書き込み）**：同じワークフローを `dry_run=false`・`submit=false` で。メタデータ・スクリーンショット・ビルド・審査情報・カテゴリ・年齢区分・価格・配信地域が入る。
8. **依頼主**：`manual-steps.md` の B（App のプライバシー公開・年齢区分と配信地域の確認・画面の目視確認）。
9. **自動（提出）**：依頼主の OK 後、`dry_run=false`・`submit=true` で実行 → 審査待ちになる。
10. **依頼主**：Unlisted を申請（`manual-steps.md` の 15）。承認と Unlisted 承認がそろったら「このバージョンをリリース」。

## スクリーンショットの撮り直し
開発サーバー（`npm run dev`）を起動して：
```
python scripts/appstore_screenshots.py --url http://127.0.0.1:4173/ --render <AIパースの見本画像.jpg>
```
AIパースは実際の API を呼ばず、見本画像を返すように差し替えて撮る。打ち合わせの議事録も同様（固定の文面）。撮ったら全部目で見て、開発用の表記・個人名・実在の顧客情報が写っていないか確認する。

"""打ち合わせ（録音→文字起こし→議事録）の解説動画の場面。guide_full_scenes.py から FULL_SCENES に登録する。

音声認識・AIはサーバーが要るので、ここでは API の返事を差し替える（page.route）。
録音は Chromium の偽マイク（--use-fake-device-for-media-stream）で実際に動かす。
"""
import json


def top(r, label):
    return r.p.locator(f'.v3-top [aria-label="{label}"]').first


TRANSCRIPT = [
    {'from': 1.0, 'to': 4.0, 'text': '駐車場は2台停めたいです。できれば並列で。'},
    {'from': 4.5, 'to': 8.0, 'text': '道路側は目隠しフェンスにして、高さは1.8mくらいほしいです。'},
    {'from': 8.5, 'to': 11.0, 'text': '宅配ボックスも付けたいですね。'},
    {'from': 11.5, 'to': 14.0, 'text': '予算は全部で300万円くらいで考えています。'},
    {'from': 14.5, 'to': 17.0, 'text': '次回までに概算の見積をお持ちしますね。'},
]
MINUTES = """【打ち合わせ議事録】
日時：2026/11/17 10:30
【決まったこと】
・駐車場は2台、並列で停める
【宿題・次回までにやること】
・営業：概算見積を出す
【話題ごとの要点】
・駐車場：2台を並列で
・フェンス：道路側に目隠しフェンス、高さ1.8mくらい
・設備：宅配ボックスを付けたい
・予算：全部で300万円くらい
【確認が必要なこと】
・フェンスを付ける長さ"""


def mock_api(page):
    def transcribe(route):
        body = json.loads(route.request.post_data or '{}')
        start = (body.get('startMs') or 0) / 1000
        lines = [{**l, 'from': l['from'] + start, 'to': l['to'] + start} for l in TRANSCRIPT]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'index': body.get('index', 0), 'lines': lines, 'duration': 15}))

    def meeting(route):
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'minutes': MINUTES, 'usage': {'input': 1800, 'output': 400}}))

    page.route('**/api/ai/transcribe', transcribe)
    page.route('**/api/ai/meeting', meeting)


def meeting(r):
    mock_api(r.p)
    r.cap('打ち合わせ：録音 → 文字起こし → 議事録', 1.4)
    r.uncap()
    r.mark(top(r, '打ち合わせ'), '上の「打ち合わせ」を押す', 1.6)
    r.unmark()
    r.tap_el(top(r, '打ち合わせ'), .8)
    panel = r.p.locator('.v3-meet')
    panel.wait_for()
    r.mark(panel.locator('.v3-meet-steps'), '流れは3つ。① 録音 ② 文字にする（自動） ③ 議事録にする', 2.2)
    r.mark(panel.locator('.v3-meet-consent'), 'お客様に録音すると一言伝えてから始める', 2.0)
    r.unmark()
    r.cap('①「録音を始める」', .3, 'top')
    r.tap_el(panel.locator('.v3-meet-mic'), 1.0)
    r.p.locator('.v3-meet-mic.on').wait_for()
    r.cap('録音中。たたんで図面を描きながらでも続く', .3, 'top')
    r.tap_el(panel.locator('[aria-label^="たたむ"]'), .8)
    r.mark(r.p.locator('.v3-meet-pill'), '右下に録音中の表示が残る', 1.8)
    r.unmark()
    r.tap_el(r.p.locator('.v3-meet-pill'), .8)
    r.cap('② 話し終えたら「録音を止める」→ 全部を文字にする', .3, 'top')
    r.tap_el(r.p.locator('.v3-meet-mic.on'), 1.0)
    doc = r.p.locator('.v3-meet-doc')
    doc.wait_for(timeout=20000)
    r.p.wait_for_timeout(600)
    r.cap('③ AIが議事録にまとめる', .3, 'top')
    r.mark(doc, '決まったこと・宿題・話題ごとの要点', 2.4)
    r.unmark()
    r.cap('「議事録をコピー・共有」でLINE・メールに貼れる', .3, 'top')
    r.tap_el(panel.get_by_role('button', name='議事録をコピー・共有'), 1.6)
    log = panel.locator('.v3-meet-log')
    log.scroll_into_view_if_needed()
    r.p.wait_for_timeout(400)
    r.cap('文字起こしの全文は時刻つき。間違いはえんぴつで直せる', .3, 'top')
    r.mark(log, '話した言葉が全部残る', 2.2)
    r.unmark()
    r.cap('全文もコピー・共有、ファイルで保存できる', .3, 'top')
    r.tap_el(panel.get_by_role('button', name='全文をコピー・共有'), 1.6)
    r.uncap()

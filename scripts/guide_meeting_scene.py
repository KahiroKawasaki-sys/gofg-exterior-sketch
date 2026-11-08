"""打ち合わせ（録音→文字→AI）の解説動画の場面。guide_full_scenes.py から FULL_SCENES に登録する。

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
]
REQUESTS = [
    {'id': '', 'kind': '駐車場', 'text': '車2台を並列で停めたい', 'quote': '駐車場は2台停めたいです。できれば並列で', 'status': '決定'},
    {'id': '', 'kind': '塀・フェンス', 'text': '道路側は目隠しフェンス 1.8m', 'quote': '目隠しフェンスにして、高さは1.8mくらい', 'status': '要望',
     'action': {'type': 'height', 'role': 'fence', 'mm': 1800}},
    {'id': '', 'kind': '設備', 'text': '宅配ボックスを付けたい', 'quote': '宅配ボックスも付けたい', 'status': '要望',
     'action': {'type': 'extra', 'name': '宅配ボックス', 'qty': 1, 'unit': '台'}},
    {'id': '', 'kind': '予算', 'text': '予算は総額300万円', 'quote': '予算は全部で300万円くらい', 'status': '決定',
     'action': {'type': 'budget', 'yen': 3000000}},
]


def mock_api(page):
    def transcribe(route):
        body = json.loads(route.request.post_data or '{}')
        start = (body.get('startMs') or 0) / 1000
        lines = [{**l, 'from': l['from'] + start, 'to': l['to'] + start} for l in TRANSCRIPT]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'index': body.get('index', 0), 'lines': lines, 'duration': 15}))

    def meeting(route):
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'requests': REQUESTS, 'usage': {'input': 1800, 'output': 400}}))

    page.route('**/api/ai/transcribe', transcribe)
    page.route('**/api/ai/meeting', meeting)


def meeting(r):
    mock_api(r.p)
    r.cap('打ち合わせ：録音 → 文字 → AIが要望に', 1.4)
    r.uncap()
    r.mark(top(r, '打ち合わせ'), '上の「打ち合わせ」を押す', 1.6)
    r.unmark()
    r.tap_el(top(r, '打ち合わせ'), .8)
    panel = r.p.locator('.v3-meet')
    panel.wait_for()
    r.mark(panel.locator('.v3-meet-steps'), '流れは3つ。① 録音 ② 文字にする（自動） ③ AIがまとめる', 2.2)
    r.unmark()
    r.cap('① お客様に伝えてから「録音を始める」', .3, 'top')
    r.tap_el(panel.locator('.v3-meet-mic'), 1.0)
    r.p.locator('.v3-meet-mic.on').wait_for()
    r.cap('録音中。たたんで図面を描きながらでも続く', .3, 'top')
    r.tap_el(panel.locator('[aria-label^="たたむ"]'), .8)
    r.mark(r.p.locator('.v3-meet-pill'), '右下に録音中の表示が残る', 1.8)
    r.unmark()
    r.tap_el(r.p.locator('.v3-meet-pill'), .8)
    r.cap('② 話し終えたら「録音を止める」→ 自動で文字にする', .3, 'top')
    r.tap_el(r.p.locator('.v3-meet-mic.on'), 1.0)
    r.p.locator('.v3-meet-card').first.wait_for(timeout=20000)
    r.p.wait_for_timeout(600)
    r.cap('③ AIがお客様の要望をカードにまとめる', .3, 'top')
    r.mark(r.p.locator('.v3-meet-card').first, '決定・要望・検討中に分かれる。根拠の発言も残る', 2.2)
    r.unmark()
    r.cap('「反映」を押すと図面・見積に入る', .3, 'top')
    btn = r.p.locator('.v3-meet-card .v3-btn.primary', has_text='見積に').first
    r.tap_el(btn, 1.4)
    btn2 = r.p.locator('.v3-meet-card .v3-btn.primary', has_text='予算').first
    r.tap_el(btn2, 1.4)
    r.mark(r.p.locator('.v3-meet-budget'), '予算と概算見積をその場で比べられる', 2.0)
    r.unmark()
    r.cap('「まとめをコピー」でLINE・メールに貼れる', .3, 'top')
    r.tap_el(r.p.locator('.v3-meet-share .v3-btn'), 1.6)
    r.cap('会話の記録は時刻つき。間違いはその場で直せる', .3, 'top')
    r.tap_el(r.p.locator('.v3-meet .v3-link', has_text='会話の記録を見る'), 1.0)
    r.mark(r.p.locator('.v3-meet-log'), '録音は文字にし終えると端末から消える', 2.2)
    r.unmark()
    r.uncap()

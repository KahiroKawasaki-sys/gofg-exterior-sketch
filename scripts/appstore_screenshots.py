"""App Store 用のスクリーンショット（13インチ iPad・2752x2064 横）を撮る。

開発サーバー（npm run dev）を起動した状態で:
    python scripts/appstore_screenshots.py --render <AIパースの見本画像.jpg>
    python scripts/appstore_screenshots.py --only 01,04          # 一部だけ撮り直す

iPad と同じ WebKit で、サンプル邸を 1376x1032（13インチ iPad の横向きの論理サイズ）×2倍で撮り、
透明なしの PNG にして appstore/screenshots/ipad13/ に保存する。
AIパースと議事録は本物の API を呼ばず、見本の画像・固定の文面を返すように差し替える（費用をかけない・毎回同じ絵にする）。
撮ったあとは必ず全部を目で見て、開発用の表記・個人名・実在の顧客情報が写っていないか確かめる。
"""
import argparse
import base64
import json
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 1376, 1032
# 議事録の見本（worker/ai.ts の MINUTES_SYSTEM と同じ形。中身は架空）
MINUTES = '\n'.join([
    '【打ち合わせ議事録】', '日時：（サンプル）',
    '【決まったこと】', '・駐車場は2台分。土間コンクリート（刷毛引き）', '・アプローチは乱形石',
    '【宿題・次回までにやること】', '・フェンスの色見本を用意する（担当）', '・概算見積を2案で出す（担当）',
    '【話題ごとの要点】', '・駐車場：2台分ほしい', '・目隠しフェンス：高さ1.2mか1.6mで迷っている', '・植栽：シンボルツリーを1本',
    '【確認が必要なこと】', '・フェンスの高さ', '・シンボルツリーの種類'])
MEMOS = ['駐車場は2台分ほしい。土間コンクリートで', 'アプローチは乱形石が気になっている',
         '目隠しフェンスは1.2mか1.6mで迷っている', 'シンボルツリーを1本植えたい']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4173/')
    ap.add_argument('--out', default=str(ROOT / 'appstore' / 'screenshots' / 'ipad13'))
    ap.add_argument('--render', default='', help='AIパースの見本画像（サンプル邸から作ったもの）。無ければ 05 を撮らない')
    ap.add_argument('--only', default='', help='撮る番号（例 01,04）')
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, a.only.split(',')))
    want = lambda n: not only or n in only

    def shot(p, name):
        p.wait_for_timeout(700)
        path = out / f'{name}.png'
        p.screenshot(path=str(path))
        Image.open(path).convert('RGB').save(path, optimize=True)  # App Store は透明（アルファ）付き PNG を受け付けない
        print('saved', path.name, flush=True)

    def open_sample(p, detail=False):
        p.goto(a.url)
        p.get_by_text('サンプル邸で試す').click()
        p.locator('.v3-stage').wait_for()
        p.wait_for_timeout(1200)
        p.keyboard.press('Escape')
        # かんたん／詳細モードは前回の選択を覚えているので、今の画面を見て切り替える
        to_detail, to_simple = p.get_by_text('詳細', exact=True), p.locator('.v3-top .sx-modebtn', has_text='かんたんモード')
        if detail and to_detail.count():
            to_detail.first.click()
            p.wait_for_timeout(1000)
        elif not detail and to_simple.count():
            to_simple.first.click()
            p.wait_for_timeout(1000)

    def open_3d(p):
        open_sample(p)
        p.locator('button', has_text='3D').first.click()
        p.locator('.v3-3d-stage canvas').wait_for()
        p.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000)
        p.wait_for_timeout(1500)
        p.locator('.v3-3d-seg button', has_text='斜め上').click()
        p.wait_for_timeout(1500)

    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2)
        ctx.add_init_script("try { localStorage.setItem('gofg-v3-tour', 'done'); } catch {}")
        # Playwright の WebKit には録音の仕組みが無いので「録音できません」と出る。アプリでは録音できるため、
        # 有る扱いにだけする（実際には録音しない。ボタンも押さない）
        ctx.add_init_script("""
          if (!window.MediaRecorder) window.MediaRecorder = class { static isTypeSupported() { return true; } };
          if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
          if (!navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('screenshot'));
        """)
        p = ctx.new_page()
        errors: list[str] = []
        p.on('pageerror', lambda e: errors.append(str(e)))
        if a.render:
            data = 'data:image/jpeg;base64,' + base64.b64encode(pathlib.Path(a.render).read_bytes()).decode()
            p.route('**/api/ai/render', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(
                {'image': data, 'model': 'sample', 'size': '2K', 'aspect': '16:9', 'ms': 1000})))
        p.route('**/api/ai/meeting', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(
            {'minutes': MINUTES, 'usage': {'input': 0, 'output': 0}})))

        if want('01'):  # スケッチ全体（かんたんモード）
            open_sample(p)
            shot(p, '01_sketch')
        if want('02'):  # 部品を置く
            open_sample(p)
            p.get_by_text('部品', exact=True).last.click()
            p.locator('button', has_text='植栽').first.click()
            p.locator('.sx-part').nth(2).click()
            for x, y in [(818, 170), (818, 250), (818, 330)]:
                p.mouse.click(x, y)
                p.wait_for_timeout(300)
            shot(p, '02_parts')
        if want('03'):  # 素材を塗る（素材の一覧を見せる）
            open_sample(p)
            p.get_by_text('塗る', exact=True).last.click()
            shot(p, '03_paint')
        if want('04'):  # 3D
            open_3d(p)
            shot(p, '04_3d')
        if want('05') and a.render:  # AIパース
            open_3d(p)
            p.get_by_role('button', name='AIパースを作る').click()
            p.wait_for_timeout(1500)
            p.locator('.v3-render-opt input').fill('門柱は木目調に')
            p.locator('.v3-render-go').click()
            p.locator('.v3-render-main figure img').first.wait_for()
            p.wait_for_timeout(1500)
            shot(p, '05_ai_render')
        if want('06'):  # 集計・見積
            open_sample(p, detail=True)
            p.get_by_text('集計・見積', exact=True).first.click()
            p.get_by_role('tab', name='概算見積').click()
            shot(p, '06_estimate')
        if want('07'):  # 打ち合わせ（文字起こし→議事録）
            open_sample(p, detail=True)
            p.locator('.v3-side').get_by_role('button', name='閉じる').first.click()  # 右の部品パネルをたたむ
            p.wait_for_timeout(400)
            p.get_by_text('打ち合わせ', exact=True).first.click()
            p.wait_for_timeout(800)
            for t in MEMOS:
                p.get_by_role('textbox', name='メモを足す').fill(t)
                p.get_by_role('button', name='メモを足す').click()
                p.wait_for_timeout(200)
            p.get_by_role('button', name='議事録を作る').click()
            p.locator('[aria-label="議事録"]').wait_for()
            shot(p, '07_meeting')
        browser.close()
    if errors:
        print('page errors:', *errors[:5], sep='\n  ')


if __name__ == '__main__':
    main()

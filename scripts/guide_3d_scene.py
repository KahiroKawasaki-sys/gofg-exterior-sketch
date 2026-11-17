"""3D・AIパースの解説動画の場面（f-3d / f-render）。guide_full_scenes.py から FULL_SCENES に登録する。

立面図の家は、滝本様から受領した立面図サンプル①（配置図.pdf・立面図.pdf）を使う。
動画はアプリと一緒に配るので、表題欄（施主名・設計事務所・住所・電話）と道路名を消したコピーを
一時フォルダに作ってから読み込む（PyMuPDF）。リポジトリには入れない。
AIパースは本物のAPIを叩かず、/api/ai/render の返事を差し替える（page.route）。返す絵は、同じ①の家で
本番の画像AIが実際に作ったパース（AIパース検証_20261109）。
サンプルの置き場は環境変数 GOFG_GUIDE_SAMPLES で変えられる（中に 立面図サンプル_20261106/01 と AIパース検証_20261109）。
"""
import base64
import io
import os
import pathlib
import tempfile

SAMPLES = pathlib.Path(os.environ.get('GOFG_GUIDE_SAMPLES') or (
    pathlib.Path.home() / 'OneDrive' / 'ドキュメント' / 'Claudecodeデモ' / '.company' / '顧客支援部' / 'クライアント' / 'G of the G様' / '手書き図面アプリ'))
ELEV = SAMPLES / '立面図サンプル_20261106' / '01'
RENDER_IMG = SAMPLES / 'AIパース検証_20261109' / '01_平屋_昼_AIパース_周囲を住宅街に_1110.png'
# 表題欄に出る言葉（施主名・事務所・住所・電話・道路名）。これを含む文字の塊は消す
SECRET = ['道路名称', '位置指定道路', '工事', '様', 'TEL', '建築士', '県', '市道']
_tmp = None


def sample_pdfs():
    """表題欄を消した 配置図.pdf・立面図.pdf（一時フォルダ）を返す"""
    global _tmp
    import fitz  # PyMuPDF
    if _tmp is None:
        _tmp = pathlib.Path(tempfile.mkdtemp(prefix='gofg-guide-'))
        for name, add_scale in (('配置図.pdf', True), ('立面図.pdf', False)):
            src = ELEV / name
            assert src.exists(), f'立面図サンプルが見つからない: {src}（GOFG_GUIDE_SAMPLES で場所を指定）'
            d = fitz.open(src)
            p = d[0]
            rot = p.rotation
            p.set_rotation(0)
            # 用紙の下端（回転前の右端 x≥780）が表題欄
            p.add_redact_annot(fitz.Rect(780, 0, p.rect.width, p.rect.height), fill=(1, 1, 1))
            for b in p.get_text('blocks'):
                if any(k in b[4] for k in SECRET):
                    p.add_redact_annot(fitz.Rect(b[:4]) + (-2, -2, 2, 2), fill=(1, 1, 1))
            p.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
            if add_scale:  # 表題欄の縮尺も消えるので、配置図の縮尺だけ書き戻す（下絵を実寸にするため）
                p.insert_text((795, 200), '配置図 S=1/100', fontname='japan', fontsize=9, rotate=90)
            p.set_rotation(rot)
            d.set_metadata({})
            d.save(_tmp / name, garbage=4, deflate=True)
            left = [b[4] for b in fitz.open(_tmp / name)[0].get_text('blocks') if any(k in b[4] for k in SECRET)]
            assert not left, f'表題欄の文字が残っている: {left}'
    return _tmp / '配置図.pdf', _tmp / '立面図.pdf'


def render_image() -> str:
    """差し替えで返すパース（data URL）。画面写しなので、縁の余白と写り込んだマウスの矢印を消す"""
    from PIL import Image, ImageChops
    im = Image.open(RENDER_IMG).convert('RGB')
    if RENDER_IMG.name.endswith('_1110.png'):
        # 矢印（x484〜512, y356〜398）の上に、塀に沿って右下の砂利と塀を写して重ねる
        im.paste(im.crop((534, 377, 564, 421)), (482, 355))
    bg = Image.new('RGB', im.size, im.getpixel((0, 0)))
    box = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        im = im.crop(box)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=86)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def top(r, label):
    return r.p.locator(f'.v3-top [aria-label="{label}"]').first


def wait3d(r, extra=1.2):
    r.p.locator('.v3-3d-stage canvas').wait_for()
    r.p.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000)
    r.p.wait_for_timeout(int(extra * 1000))


def wheel(r, dy, n=8, ms=60):
    """マウスのホイールで寄る／引く（iPadの2本指で広げる・つまむ）"""
    r.move(*center3d(r))
    for _ in range(n):
        r.p.mouse.wheel(0, dy / n)
        r.p.wait_for_timeout(ms)


def center3d(r):
    b = r.p.locator('.v3-3d-stage').bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def view3d(r):
    r.cap('3Dで見る', 1.3)
    r.uncap()
    r.mark(top(r, '3Dで見る'), '上の「3D」を押す（描いた図面がそのまま立体に）', 1.6)
    r.unmark()
    r.tap_el(top(r, '3Dで見る'), .3)
    wait3d(r, 1.0)
    cx, cy = center3d(r)
    r.cap('1本指でドラッグすると回る', .3, 'top')
    r.drag([(cx + 160, cy + 60), (cx - 40, cy + 40), (cx - 220, cy + 20)], 1600, .6)
    r.cap('2本指で広げると寄る・つまむと引く', .3, 'top')
    wheel(r, -900, 12)
    r.p.wait_for_timeout(700)
    wheel(r, 500, 8)
    r.p.wait_for_timeout(400)
    r.cap('視点は「斜め上・真上・人の目線」から選べる', .3, 'top')
    seg = r.p.locator('.v3-3d-seg button')
    r.tap_el(seg.filter(has_text='真上'), 1.3)
    r.tap_el(seg.filter(has_text='人の目線'), 1.3)
    r.tap_el(seg.filter(has_text='斜め上'), 1.0)
    r.cap('線をタップすると、塀・フェンス・門扉などを選べる', .3, 'top')
    # サンプル邸の右奥のフェンス（メッシュ）
    r.tap(775, 372, 1.0)
    panel = r.p.locator('.v3-3d-panel[aria-label="選んだ線の3D設定"]')
    panel.wait_for(timeout=5000)
    r.cap('種類・見た目・高さを変えられる（図面の線にも残る）', .3, 'top')
    r.tap_el(panel.locator('.v3-3d-roles.mats button').nth(1), 1.0)
    from guide_full_scenes import slide
    slide(r, panel.locator('input[type=range]'), 1.8, 800, 1.0)
    r.tap_el(panel.locator('[aria-label="選択をやめる"]'), .6)
    r.cap('「画像で保存」で今の見た目を画像に', .3, 'top')
    r.mark(r.p.locator('.v3-3d-top [aria-label="画像で保存"]'), '', 1.0)
    r.unmark()
    # 立面図：配置図から始めた図面に、立面図を読み込むと家が立つ
    r.cap('立面図があれば、実寸の家が立つ', 1.4)
    r.uncap()
    r.tap_el(r.p.locator('.v3-3d-top [aria-label="3Dを閉じる"]'), .5)
    r.cap('一覧の「下絵から始める」で配置図を読み込む', .3, 'top')
    r.tap_el(top(r, '案件一覧'), .8)
    r.p.locator('.v3-home').wait_for()
    r.p.wait_for_timeout(500)
    site, elev = sample_pdfs()
    with r.p.expect_file_chooser() as fc:
        r.tap_el(r.p.locator('.v3-new', has_text='下絵から始める'), .2)
    fc.value.set_files(str(site))
    r.p.locator('.v3-stage').wait_for(timeout=60000)
    ask = r.p.locator('.v3-modal', has_text='立面図はありますか')
    ask.wait_for(timeout=15000)
    r.p.wait_for_timeout(500)
    r.cap('「立面図を読み込む」→ 東西南北の立面図（PDF）を選ぶ', .3, 'top')
    with r.p.expect_file_chooser() as fc:
        r.tap_el(ask.locator('button', has_text='立面図を読み込む'), .2)
    fc.value.set_files(str(elev))
    dlg = r.p.locator('.v3-elev')
    dlg.wait_for(timeout=30000)
    r.p.get_by_role('button', name='3Dに貼る').wait_for()
    r.p.wait_for_function("() => { const b = [...document.querySelectorAll('.v3-elev button')].find(x => x.textContent.includes('3Dに貼る')); return b && !b.disabled; }", timeout=30000)
    r.p.wait_for_timeout(600)
    r.cap('東・南・西・北の絵が枠で囲まれる（ずれていたら枠を動かす）', 1.8, 'top')
    r.cap('「3Dに貼る」', .3, 'top')
    r.tap_el(r.p.get_by_role('button', name='3Dに貼る'), .5)
    dlg.wait_for(state='detached', timeout=60000)
    wait3d(r, 3.0)  # 配置図の線に建物を重ねる位置合わせを待つ
    r.cap('家が立ち上がり、配置図の上の位置に置かれる', 2.2, 'top')
    cx, cy = center3d(r)
    r.drag([(cx + 140, cy + 40), (cx - 120, cy + 20)], 1400, .5)
    r.cap('外壁・屋根の色は下の色玉で選ぶ', .3, 'top')
    r.tap_el(r.p.get_by_role('button', name='外壁 ベージュ'), 1.0)
    r.tap_el(r.p.get_by_role('button', name='屋根 ブラウン'), 1.6)
    r.uncap()


def open_house(r):
    """立面図サンプル①の家を、配置図→立面図の順に読み込んで3Dを開いたところから始める（録画の前なので映らない）"""
    site, elev = sample_pdfs()
    r.p.goto(r.url)
    r.p.locator('.v3-home').wait_for()
    r.p.locator('input[type=file]').first.set_input_files(str(site))
    r.p.locator('.v3-stage').wait_for(timeout=60000)
    r.p.get_by_role('button', name='あとで').click(timeout=15000)
    r.p.locator('.v3-top [aria-label="3Dで見る"]').first.click()
    r.p.locator('.v3-3d-stage canvas').wait_for()
    r.p.locator('.v3-3d input[type=file]').set_input_files(str(elev))
    r.p.get_by_role('button', name='3Dに貼る').click(timeout=60000)
    r.p.locator('.v3-elev').wait_for(state='detached', timeout=60000)
    r.p.wait_for_timeout(4000)
    r.p.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000)
    r.p.locator('.v3-3d-seg button', has_text='斜め上').click()
    r.p.wait_for_timeout(1200)


def render(r):
    img = render_image()
    pending = []
    # 本物の画像AIは30秒〜1分かかる。動画では数秒で返す（台本の側で返すタイミングを決める）
    r.p.route('**/api/ai/render', lambda route: pending.append(route))
    r.cap('AIパース：3Dを写真のような絵に', 1.4)
    r.uncap()
    ai = r.p.locator('.v3-3d-top [aria-label="AIパースを作る"]')
    r.mark(ai, '見せたい向きに回してから、右上の「AIパース」', 1.8)
    r.unmark()
    r.tap_el(ai, .8)
    dlg = r.p.locator('.v3-render')
    dlg.wait_for()
    r.p.wait_for_timeout(500)
    r.mark(dlg.locator('.v3-render-src'), '今の3Dの見た目が、左上に写る', 1.8)
    r.mark(dlg.locator('[aria-label="時間帯"]'), '時間帯は 昼・夕方・夜 から選ぶ', .4)
    g = dlg.locator('[aria-label="時間帯"] button')
    r.tap_el(g.filter(has_text='夕方'), .7)
    r.tap_el(g.filter(has_text='夜'), .7)
    r.tap_el(g.filter(has_text='昼'), .8)
    r.unmark()
    r.cap('お客様の希望を書くと、材質に反映される（なくてもよい）', .3, 'top')
    note = dlg.locator('.v3-render-opt input')
    r.tap_el(note, .3)
    note.type('駐車場はコンクリート、庭は砂利', delay=110)
    r.p.wait_for_timeout(500)
    r.cap('「パースを作る」', .3, 'top')
    r.tap_el(dlg.locator('[aria-label="パースを作る"]'), .5)
    r.cap('30秒〜1分ほど待つ（3Dへ戻って続きをしてもよい）', 2.6, 'top')
    deadline = 50
    while not pending and deadline:
        r.p.wait_for_timeout(100)
        deadline -= 1
    assert pending, 'AIパースの問い合わせが来ていない'
    pending[0].fulfill(status=200, content_type='application/json', body='{"image": "%s", "ms": 41000}' % img)
    dlg.locator('.v3-render-main figure img[alt^="AIパース"]').wait_for(timeout=15000)
    r.p.wait_for_timeout(400)
    r.cap('写真のようなパースができた', 2.4, 'top')
    r.cap('左上の「元の3D」をタップすると見比べられる', .3, 'top')
    r.tap_el(dlg.locator('.v3-render-src'), 2.0)
    r.tap_el(dlg.locator('.v3-render-src'), 1.6)
    r.cap('「保存・共有」で写真に保存・LINEで送る', .3, 'top')
    with r.p.expect_download() as dl:
        r.tap_el(dlg.locator('[aria-label="パースを保存・共有"]'), 1.4)
    assert dl.value.suggested_filename.endswith('.jpg'), dl.value.suggested_filename
    r.cap('作った絵は端末に残り、次に開いても見られる', 2.2, 'top')
    r.uncap()

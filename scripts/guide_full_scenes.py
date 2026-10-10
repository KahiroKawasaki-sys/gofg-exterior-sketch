"""詳細モードの解説動画の場面（record-guide.py から呼ぶ）。

r は record-guide.py の Rec。押すボタンは枠で光らせ、下に一言を出す。
"""
import pathlib

FIXTURE = pathlib.Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'site-plan.pdf'


def top(r, label):
    return r.p.locator(f'.v3-top [aria-label="{label}"]').first


def left(r, label):
    return r.p.locator(f'.v3-left [aria-label="{label}"]').first


def menu(r, text):
    return r.p.locator('.v3-menu .mi', has_text=text).first


def center(b):
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def area(r):
    """図面の左の空き地（サンプル邸の敷地の外）"""
    sx, sy, sw, sh = r.stage()
    return sx + 80, sy + sh * 0.16, sx + sw * 0.30, sy + sh * 0.60


def slide(r, loc, value, ms=700, after=.5):
    """スライダーのつまみをドラッグして値を変える"""
    b = loc.bounding_box()
    mn, mx, cur = loc.evaluate('e => [+e.min, +e.max, +e.value]')
    fx = lambda v: b['x'] + 8 + (b['width'] - 16) * (v - mn) / (mx - mn)
    y = b['y'] + b['height'] / 2
    r.drag([(fx(cur), y), (fx(value), y)], ms, after)


def rect(r, x0, y0, x1, y1, ms=600):
    r.tap_el(top(r, '図形'), .3)
    r.drag([(x0, y0), (x1, y1)], ms, .3)


def screen(r):
    r.cap('詳細モードの画面', 1.4)
    r.uncap()
    r.mark(r.p.locator('.v3-bar.r1'), '1段目：描く道具（ペン・線・図形・寸法・文字）と太さ・色', 2.6)
    r.mark(r.p.locator('.v3-bar.r2'), '2段目：下絵・書き出し・全体表示と、右パネル（部品・塗る…）', 2.6)
    r.mark(r.p.locator('.v3-left'), '左：選択・ガイド吸着・元に戻す', 2.2)
    r.mark(r.p.locator('.v3-side'), '右：パネル（部品・レイヤー・ガイド線・塗る…）', 2.4)
    r.mark(r.p.locator('.v3-side .sx-vbtn').first, '各パネルの「動画」で、そのパネルの使い方が見られる', 2.4)
    r.mark(r.p.locator('.v3-top .sx-modebtn', has_text='かんたんモード'), '迷ったら「かんたんモード」に戻せる', 2.2)
    r.unmark()
    r.uncap()


def pen(r):
    x0, y0, x1, y1 = area(r)
    r.cap('ペン・線・図形', 1.3)
    r.uncap()
    r.cap('▼でペンの種類（マーカー・鉛筆など）', .3, 'top')
    r.tap_el(top(r, 'ペンの種類'), .5)
    r.tap_el(menu(r, 'マーカー'), .4)
    r.cap('太さはスライダー、色は丸から選ぶ', .3, 'top')
    slide(r, r.p.locator('.v3-width input[type=range]'), 10)
    r.tap_el(top(r, '#3f7fbf'), .3)
    r.drag([(x0, y0 + 20), (x0 + 60, y0 - 10), (x1 - 40, y0 + 40), (x1, y0)], 900, .5)
    r.cap('線の▼で直線・折れ線・矢印', .3, 'top')
    r.tap_el(top(r, '#2f3b38'), .2)
    slide(r, r.p.locator('.v3-width input[type=range]'), 4, 400, .2)
    r.tap_el(top(r, '線の種類'), .5)
    r.tap_el(menu(r, '矢印'), .4)
    r.drag([(x0, y0 + 90), (x1, y0 + 70)], 600, .5)
    r.cap('図形の▼で四角・楕円', .3, 'top')
    r.tap_el(top(r, '図形の種類'), .5)
    r.tap_el(menu(r, '楕円'), .4)
    r.drag([(x0, y0 + 120), (x0 + 90, y0 + 190)], 600, .4)
    r.cap('円は中心から外へドラッグ', .3, 'top')
    r.tap_el(top(r, '円'), .3)
    r.drag([(x1 - 40, y0 + 160), (x1, y0 + 160)], 500, .4)
    r.cap('曲線は端から端へ（ふくらみは自動）', .3, 'top')
    r.tap_el(top(r, '曲線'), .3)
    r.drag([(x0, y1), (x1, y1 - 10)], 600, .4)
    r.cap('ペンの▼の「線種」で破線・点線も', .3, 'top')
    r.tap_el(top(r, 'ペンの種類'), .5)
    r.p.locator('.v3-menu select').select_option('dashed')
    r.p.wait_for_timeout(500)
    r.tap_el(menu(r, 'ペン'), .4)
    r.drag([(x0, y1 + 40), (x1, y1 + 40)], 700, 1.2)
    r.uncap()


def dim(r):
    x0, y0, x1, y1 = area(r)
    r.cap('寸法・文字', 1.3)
    r.uncap()
    rect(r, x0, y0 + 30, x1, y1 - 40, 300)
    r.cap('寸法：測りたい2点の間をドラッグ', .3, 'top')
    r.tap_el(top(r, '寸法'), .3)
    r.drag([(x0, y0 + 10), (x1, y0 + 10)], 800, .6)
    r.cap('単位（mm / cm / m）は「設定」で切り替え', .3, 'top')
    r.tap_el(top(r, '設定'), .5)
    unit = r.p.locator('.v3-side [aria-label="単位"]')
    r.mark(unit, '', .4)
    unit.select_option('m')
    r.p.wait_for_timeout(1200)
    r.unmark()
    r.tap_el(top(r, '設定'), .4)
    r.cap('文字：Tを選んで、置く場所をタップ', .3, 'top')
    r.tap_el(top(r, 'テキスト'), .3)
    r.tap((x0 + x1) / 2 - 40, (y0 + y1) / 2, .6)
    r.uncap()
    r.p.locator('.v3-textarea').type('駐車場 2台', delay=90)
    r.p.wait_for_timeout(300)
    r.cap('背景や枠もつけられる', .3, 'top')
    r.tap_el(r.p.locator('.v3-trow', has_text='背景').locator('input[type=checkbox]'), .5)
    r.tap_el(r.p.locator('.v3-modal .v3-btn.primary'), .8)
    r.cap('置いた文字は、Tのまま文字をタップすると直せる', .3, 'top')
    r.tap((x0 + x1) / 2 - 20, (y0 + y1) / 2 + 4, 1.2)
    if r.p.locator('.v3-modal').count():
        r.tap_el(r.p.locator('.v3-modal .v3-btn', has_text='キャンセル'), .8)
    r.uncap()


def select(r):
    x0, y0, x1, y1 = area(r)
    r.cap('選択・コピー・回転', 1.3)
    r.uncap()
    rect(r, x0, y0 + 40, x0 + 90, y0 + 120, 300)
    r.cap('左の「選択」→ 図形をタップ', .3, 'top')
    r.tap_el(left(r, '選択'), .3)
    r.tap(x0, y0 + 80, .6)
    r.cap('中をドラッグで移動', .3, 'top')
    r.drag([(x0 + 45, y0 + 40), (x0 + 75, y0 + 70)], 700, .4)
    r.cap('角の丸で拡大縮小、右の丸で回転', .3, 'top')
    se = center(r.p.locator('.selbox circle.h').nth(2).bounding_box())
    r.drag([se, (se[0] + 30, se[1] + 30)], 600, .4)
    rot = center(r.p.locator('.selbox circle.rot').bounding_box())
    r.drag([rot, (rot[0] - 10, rot[1] + 40)], 700, .6)
    r.cap('上のバーで複製・反転・前後・削除', .3, 'top')
    r.mark(r.p.locator('.v3-selbar'), '', 1.2)
    r.tap_el(r.p.locator('.v3-selbar button', has_text='複製'), .7)
    r.cap('「連続」で間隔と個数を決めて並べる', .3, 'top')
    r.tap_el(r.p.locator('.v3-selbar button', has_text='連続'), .6)
    r.p.locator('.v3-field', has_text='間隔').locator('input').fill('1500')
    r.p.locator('.v3-field', has_text='個数').locator('input').fill('3')
    r.p.wait_for_timeout(700)
    r.tap_el(r.p.locator('.v3-modal button[type=submit]'), .9)
    r.cap('何もない所から囲むと、まとめて選択', .3, 'top')
    sx, sy, sw, sh = r.stage()
    r.drag([(sx + 62, y0 - 10), (x1 + 160, y0 - 10), (x1 + 160, y1 + 40), (sx + 62, y1 + 40), (sx + 62, y0 - 10)], 1100, .8)
    r.tap_el(r.p.locator('.v3-selbar button[title="削除"]'), 1.0)
    r.cap('まちがえたら左下の「元に戻す」', .3, 'top')
    r.tap_el(left(r, '元に戻す'), 1.2)
    r.uncap()


def objects(r):
    x0, y0, x1, y1 = area(r)
    r.cap('部品（車・植栽など）', 1.3)
    r.uncap()
    r.tap_el(top(r, '部品'), .4) if not r.p.locator('.v3-side', has_text='部品を選んで').count() else None
    r.cap('種類を選んで、部品を押す → 図面をタップ', .3, 'top')
    r.tap_el(r.p.locator('.v3-side .v3-chip', has_text='植栽'), .4)
    r.tap_el(r.p.locator('.v3-side .v3-list .v3-item').first, .5)
    r.tap(x0 + 40, y0 + 40, .8)
    r.cap('置いた部品は大きさ・向き・色を調整', .3, 'top')
    det = r.p.locator('.v3-side .v3-item.placed.on + .v3-detail')
    det.scroll_into_view_if_needed()
    slide(r, det.locator('.v3-slider', has_text='サイズ').locator('input'), 170)
    slide(r, det.locator('.v3-slider', has_text='回転').locator('input'), 40)
    r.cap('「その他」→ ランダム配置で、向き・大きさを変えて何本も', .3, 'top')
    r.p.locator('.v3-side').evaluate('e => e.scrollTo({ top: 0, behavior: "smooth" })')
    r.p.wait_for_timeout(500)
    r.tap_el(r.p.locator('.v3-side .v3-list .v3-item').nth(1), .4)
    r.tap_el(r.p.locator('.v3-side .v3-more summary'), .5)
    r.tap_el(r.p.locator('.v3-side .v3-more .v3-pbtn', has_text='ランダム配置'), .4)
    for k in range(4):
        r.tap(x0 + 20 + k * 45, y1 - 30 - (k % 2) * 40, .3)
    r.cap('手描きを囲むと、部品として登録できる', .3, 'top')
    r.tap_el(top(r, 'ペン'), .2)
    r.drag([(x1 - 30, y0 + 120), (x1 - 10, y0 + 100), (x1 + 10, y0 + 125), (x1 - 10, y0 + 150), (x1 - 30, y0 + 120)], 700, .3)
    r.tap_el(r.p.locator('.v3-side .v3-more .v3-pbtn', has_text='囲って登録'), .4)
    r.drag([(x1 - 50, y0 + 80), (x1 + 30, y0 + 80), (x1 + 30, y0 + 170), (x1 - 50, y0 + 170), (x1 - 50, y0 + 80)], 900, 1.6)
    r.uncap()


def layers(r):
    x0, y0, x1, y1 = area(r)
    r.cap('レイヤー：下描き → 清書', 1.4)
    r.uncap()
    r.tap_el(top(r, 'レイヤー'), .6)
    r.cap('まず下描き（いまのレイヤー）', .3, 'top')
    r.tap_el(top(r, 'ペン'), .2)
    for k in range(3):
        r.drag([(x0 + k * 6, y0 + 20 + k * 5), (x1 - k * 4, y0 + 30 - k * 3), (x1 - 10, y1 - k * 6), (x0 + 6, y1 - 20 + k * 4), (x0 + k * 6, y0 + 20 + k * 5)], 700, .1)
    r.cap('透明度を下げて、うすくする', .3, 'top')
    slide(r, r.p.locator('.v3-opac input[type=range]'), 25)
    r.cap('＋で新しいレイヤーを足して清書', .3, 'top')
    r.tap_el(r.p.locator('.v3-side [aria-label="レイヤーを追加"]'), .5)
    r.tap_el(top(r, '#c4473d'), .2)
    slide(r, r.p.locator('.v3-width input[type=range]'), 6, 400, .2)
    r.tap_el(top(r, '直線'), .2)
    for a, b in [((x0, y0 + 25), (x1, y0 + 25)), ((x1, y0 + 25), (x1, y1 - 10)), ((x1, y1 - 10), (x0, y1 - 10)), ((x0, y1 - 10), (x0, y0 + 25))]:
        r.drag([a, b], 400, .1)
    r.cap('目のマークで下描きを隠す', .3, 'top')
    row = r.p.locator('.v3-lrow', has_text='レイヤー 1')
    r.tap_el(row.locator('[aria-label="非表示"]'), 1.0)
    r.cap('鍵でロック（触っても動かない）', .3, 'top')
    r.tap_el(r.p.locator('.v3-lrow.on [aria-label="ロック"]'), 1.0)
    r.cap('名前はダブルクリック、順番は左端をドラッグ', 2.0, 'top')
    r.uncap()


def guides(r):
    r.cap('ガイド線：平行にそろえる', 1.4)
    r.uncap()
    r.tap_el(top(r, 'ガイド線'), .6)
    r.cap('「直線ガイド」を追加', .3, 'top')
    r.tap_el(r.p.locator('.v3-side .v3-pbtn', has_text='直線ガイド'), .7)
    r.cap('端の丸をドラッグして向きを合わせる', .3, 'top')
    hb = center(r.p.locator('.v3-svg circle.ghandle').nth(1).bounding_box())
    ha = center(r.p.locator('.v3-svg circle.ghandle').nth(0).bounding_box())
    r.drag([hb, (hb[0] - 10, hb[1] - 80)], 800, .5)
    hb = (hb[0] - 10, hb[1] - 80)
    r.cap('ガイド吸着ONなら、近い向きの線が平行にそろう', .3, 'top')
    r.mark(left(r, 'ガイド吸着'), '', .8)
    r.unmark()
    r.tap_el(top(r, 'ペン'), .2)
    dx, dy = hb[0] - ha[0], hb[1] - ha[1]
    for off in (70, 140):
        r.drag([(ha[0] + 15, ha[1] + off), (ha[0] + dx * .5 + 25, ha[1] + dy * .5 + off - 12), (hb[0] - 10, hb[1] + off + 10)], 900, .5)
    r.cap('勾配・円・グリッドなどのガイドもある', .3, 'top')
    r.tap_el(r.p.locator('.v3-side .v3-pbtn', has_text='線勾配'), .6)
    r.mark(r.p.locator('.v3-side .v3-detail'), '', 1.6)
    r.unmark()
    r.tap_el(r.p.locator('.v3-side .v3-pbtn', has_text='円ガイド'), 1.4)
    r.uncap()


def paint(r):
    x0, y0, x1, y1 = area(r)
    r.cap('塗る（砂利・芝・ウッドなど）', 1.3)
    r.uncap()
    rect(r, x0, y0 + 20, x1, y1 - 30, 300)
    r.tap_el(top(r, '塗る'), .6)
    r.cap('① 線で囲まれた所をタップ', .3, 'top')
    r.tap((x0 + x1) / 2, (y0 + y1) / 2, 1.0)
    r.cap('② 素材を選ぶ', .3, 'top')
    r.tap_el(r.p.locator('.v3-side .v3-texgrid button', has_text='レンガ'), 1.2)
    r.cap('大きさ・向き・明るさをスライダーで調整', .3, 'top')
    sl = lambda name: r.p.locator('.v3-side .v3-slider', has_text=name).locator('input[type=range]')
    sl('大きさ').scroll_into_view_if_needed()
    slide(r, sl('大きさ'), 2.2)
    slide(r, sl('向き'), 45)
    slide(r, sl('明るさ'), 130)
    r.cap('囲まれていない所は「なぞって追加」', .3, 'top')
    r.p.locator('.v3-side').evaluate('e => e.scrollTo({ top: 0, behavior: "smooth" })')
    r.p.wait_for_timeout(500)
    r.tap_el(r.p.locator('.v3-side .v3-pbtn', has_text='なぞって追加'), .3)
    r.drag([(x1 + 30, y0 + 40), (x1 + 120, y0 + 50), (x1 + 120, y0 + 90), (x1 + 30, y0 + 100)], 900, .4)
    r.tap_el(r.p.locator('.v3-side .v3-texgrid button', has_text='芝'), 1.8)
    r.uncap()


def open_underlay(r):
    """一覧の「下絵から始める」から開く"""
    r.p.goto(r.url)
    r.p.locator('.v3-home').wait_for()
    r.p.wait_for_timeout(600)


def underlay(r):
    r.cap('下絵と縮尺合わせ', 1.3)
    r.cap('一覧の「下絵から始める」でPDF・画像を読み込む', .3, 'top')
    with r.p.expect_file_chooser() as fc:
        r.tap_el(r.p.locator('.v3-new', has_text='下絵から始める'), .2)
    fc.value.set_files(str(FIXTURE))
    r.p.locator('.v3-stage').wait_for()
    r.p.wait_for_timeout(1500)
    if r.p.locator('.v3-modal', has_text='ページを選ぶ').count():
        r.tap_el(r.p.locator('.v3-modal button[type=submit]'), 1.2)
    r.cap('「設定」で下絵の濃さを調整', .3, 'top')
    r.tap_el(top(r, '設定'), .6)
    slide(r, r.p.locator('.v3-side .v3-slider', has_text='濃さ').locator('input'), 30)
    r.cap('縮尺合わせ：長さが分かる2点をタップ', .3, 'top')
    r.tap_el(r.p.locator('.v3-side button', has_text='縮尺合わせ'), .5)
    sx, sy, sw, sh = r.stage()
    r.tap(sx + sw * 0.3, sy + sh * 0.5, .5)
    r.tap(sx + sw * 0.7, sy + sh * 0.5, .8)
    r.cap('実際の長さを入れると、下絵が実寸になる', .3, 'top')
    f = r.p.locator('.v3-field input').first
    f.fill('')
    f.type('10000', delay=110)
    r.p.wait_for_timeout(500)
    r.tap_el(r.p.locator('.v3-modal button[type=submit]'), 1.0)
    r.tap_el(top(r, '表示を全体に合わせる'), 1.0)
    r.cap('ロックを外すと、選択で下絵を動かせる', .3, 'top')
    r.mark(r.p.locator('.v3-side .v3-chk', has_text='ロック'), '', 1.6)
    r.unmark()
    r.uncap()


def save(r):
    x0, y0, x1, y1 = area(r)
    r.cap('保存・書き出し・履歴', 1.3)
    r.uncap()
    r.mark(r.p.locator('.v3-top .status'), '描いた内容は自動でこの端末に保存される', 2.0)
    r.unmark()
    rect(r, x0, y0 + 20, x1, y1 - 30, 300)
    r.cap('「別名で保存」で別案を残す', .3, 'top')
    r.tap_el(top(r, '別名で保存'), .6)
    r.p.wait_for_timeout(400)
    r.tap_el(r.p.locator('.v3-modal button[type=submit]'), 1.0)
    r.cap('書き出し：PNG画像・PDF（A4/A3）', .3, 'top')
    r.tap_el(top(r, '書き出し'), .7)
    with r.p.expect_download() as dl:
        r.tap_el(menu(r, 'PDF（A3横）'), 1.5)
    assert dl.value.suggested_filename.endswith('.pdf')
    r.cap('編集データ（.json）で別の端末に引き継ぐ', .3, 'top')
    r.tap_el(top(r, '書き出し'), .6)
    with r.p.expect_download() as dl:
        r.tap_el(menu(r, '編集データを書き出す'), 1.2)
    assert dl.value.suggested_filename.endswith('.json')
    r.cap('「履歴」で前の状態に戻れる', .3, 'top')
    r.tap_el(top(r, 'ペン'), .2)
    r.drag([(x0 + 20, y0 + 60), (x1 - 20, y1 - 60)], 500, .2)
    r.drag([(x1 - 20, y0 + 60), (x0 + 20, y1 - 60)], 500, .3)
    r.tap_el(top(r, '履歴'), .7)
    r.cap('行を押すと、その操作の前に戻る', .3, 'top')
    r.tap_el(r.p.locator('.v3-side .v3-item').last, 1.4)
    r.cap('家のマークで一覧へ（保存した案が並ぶ）', .3, 'top')
    r.tap_el(top(r, '案件一覧'), 2.0)
    r.uncap()


FULL_SCENES = {
    'f-screen': screen, 'f-pen': pen, 'f-dim': dim, 'f-select': select, 'f-objects': objects,
    'f-layers': layers, 'f-guides': guides, 'f-paint': paint, 'f-underlay': underlay, 'f-save': save,
}
FULL_OPEN = {'f-underlay': open_underlay}

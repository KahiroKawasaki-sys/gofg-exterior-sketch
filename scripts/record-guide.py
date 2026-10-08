"""使い方動画（かんたんモード／詳細モード）を、実際の画面を操作して録画する。

開発サーバー（npm run dev）を起動した状態で実行する:
    python scripts/record-guide.py                 # 全部
    python scripts/record-guide.py --only draw f-pen --shots C:/tmp/shots

src/v3/guide/<名前>.mp4 を上書きする（詳細モードの f-* はサムネイル .jpg も）。画面を変えたら撮り直す。
詳細モードの場面は scripts/guide_full_scenes.py。
指の位置は丸、押した瞬間は濃い丸で映す（録画には本物のカーソルが映らないため）。
"""
import argparse
import math
import pathlib
import subprocess
import tempfile
import time

import sys

import imageio_ffmpeg
from playwright.sync_api import Page, sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from guide_full_scenes import FULL_OPEN, FULL_SCENES  # noqa: E402

W, H = 1180, 820
ROOT = pathlib.Path(__file__).resolve().parent.parent

OVERLAY = r"""
try { localStorage.setItem('gofg-v3-tour', 'done'); localStorage.removeItem('gofg-v3-ui'); } catch {}
addEventListener('DOMContentLoaded', () => {
  const f = document.createElement('div');
  f.style.cssText = 'position:fixed;left:-99px;top:-99px;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;background:rgba(46,87,71,.28);border:2.5px solid #2e5747;pointer-events:none;z-index:2147483647;transition:transform .12s,background .12s';
  const cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(20,24,22,.86);color:#fff;font:700 26px/1.4 "Yu Gothic UI","Meiryo",sans-serif;padding:14px 28px;border-radius:16px;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .25s;white-space:nowrap';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;border:3px solid #f0a020;border-radius:12px;box-shadow:0 0 0 4px rgba(240,160,32,.25),0 0 18px rgba(240,160,32,.55);pointer-events:none;z-index:2147483645;opacity:0;transition:all .2s ease';
  document.body.append(f, cap, ring);
  window.__mark = (x, y, w, h) => { ring.style.left = (x - 5) + 'px'; ring.style.top = (y - 5) + 'px'; ring.style.width = (w + 10) + 'px'; ring.style.height = (h + 10) + 'px'; ring.style.opacity = '1'; };
  window.__unmark = () => { ring.style.opacity = '0'; };
  const at = e => { f.style.left = e.clientX + 'px'; f.style.top = e.clientY + 'px'; };
  addEventListener('pointermove', at, true);
  addEventListener('pointerdown', e => { at(e); f.style.transform = 'scale(.72)'; f.style.background = 'rgba(46,87,71,.6)'; }, true);
  addEventListener('pointerup', () => { f.style.transform = 'scale(1)'; f.style.background = 'rgba(46,87,71,.28)'; }, true);
  window.__cap = (t, where) => { cap.textContent = t || ''; cap.style.opacity = t ? '1' : '0'; cap.style.top = where === 'low' ? 'calc(100% - 230px)' : '50%'; };
});
"""


class Rec:
    def __init__(self, page: Page, flash: bool = False):
        self.p = page
        self.x, self.y = W / 2, H / 2
        self.flash = flash  # 押すボタンを枠で光らせる（ボタンの多い詳細モード用）

    def mark(self, target, text: str = '', wait: float = 1.8, where: str = 'low'):
        b = target if isinstance(target, dict) else target.bounding_box()
        assert b, f'not visible: {target}'
        self.p.evaluate('([x, y, w, h]) => window.__mark(x, y, w, h)', [b['x'], b['y'], b['width'], b['height']])
        if text:
            self.cap(text, wait, where)
        else:
            self.p.wait_for_timeout(int(wait * 1000))

    def unmark(self):
        self.p.evaluate('() => window.__unmark()')

    def cap(self, text: str, wait: float = 1.6, where: str = 'mid'):
        where = 'low' if where == 'top' else where
        self.p.evaluate('([t, w]) => window.__cap(t, w)', [text, where])
        self.p.wait_for_timeout(int(wait * 1000))

    def uncap(self):
        self.p.evaluate('() => window.__cap("")')

    def move(self, x: float, y: float, ms: int = 450):
        n = max(2, ms // 30)
        for i in range(1, n + 1):
            t = i / n
            e = t * t * (3 - 2 * t)
            self.p.mouse.move(self.x + (x - self.x) * e, self.y + (y - self.y) * e)
        self.x, self.y = x, y

    def tap(self, x: float, y: float, after: float = .5):
        self.move(x, y)
        self.p.wait_for_timeout(120)
        self.p.mouse.down()
        self.p.wait_for_timeout(110)
        self.p.mouse.up()
        self.p.wait_for_timeout(int(after * 1000))

    def tap_el(self, locator, after: float = .5):
        b = locator.bounding_box()
        assert b, f'not visible: {locator}'
        if self.flash:
            self.p.evaluate('([x, y, w, h]) => window.__mark(x, y, w, h)', [b['x'], b['y'], b['width'], b['height']])
        self.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2, after)
        if self.flash:
            self.unmark()

    def drag(self, pts: list[tuple[float, float]], ms: int = 1200, after: float = .5):
        self.move(*pts[0])
        self.p.wait_for_timeout(120)
        self.p.mouse.down()
        n = max(len(pts), ms // 30)
        # 折れ線を等間隔に補間して、手で引いたような速さで動かす
        seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        total = sum(seg) or 1
        for k in range(1, n + 1):
            d, i = total * k / n, 0
            while i < len(seg) - 1 and d > seg[i]:
                d -= seg[i]
                i += 1
            t = min(1, d / (seg[i] or 1))
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
            self.p.mouse.move(x, y)
        self.x, self.y = pts[-1]
        self.p.mouse.up()
        self.p.wait_for_timeout(int(after * 1000))

    def tool(self, name: str, after: float = .4):
        self.tap_el(self.p.locator('.sx-tool', has_text=name).first, after)

    def step(self, name: str, after: float = .6):
        self.tap_el(self.p.locator('.sx-step', has_text=name), after)

    def stage(self):
        b = self.p.locator('.v3-stage').bounding_box()
        return b['x'], b['y'], b['width'], b['height']

    def items(self) -> int:
        return self.p.evaluate("() => document.querySelectorAll('.v3-svg path, .v3-svg rect, .v3-svg use, .v3-svg image').length")


def open_sample(r: Rec):
    r.p.goto(r.url)
    r.p.get_by_text('サンプル邸で試す').click()
    r.p.locator('.v3-stage').wait_for()
    r.p.wait_for_timeout(900)
    if r.p.locator('.sx-seg').count():
        r.p.locator('.sx-seg button', has_text='中').click()


def parking(r: Rec):
    """左の空き地（駐車場の位置）。サンプル邸の左側の余白を使う"""
    sx, sy, sw, sh = r.stage()
    return sx + sw * 0.08, sy + sh * 0.18, sx + sw * 0.30, sy + sh * 0.62


def draw(r: Rec):
    x0, y0, x1, y1 = parking(r)
    r.cap('① 描く', 1.4)
    r.uncap()
    r.tap_el(r.p.locator('.sx-seg button', has_text='中'), .2)
    r.tool('ペン')
    r.cap('ペンを選んで、なぞるだけ', 1.0, 'top')
    pts = [(x0 + (x1 - x0) * (i / 40), y0 + 30 + 40 * math.sin(i / 40 * math.pi * 2)) for i in range(41)]
    n0 = r.items()
    r.drag(pts, 1500)
    assert r.items() > n0, 'ペンの線が増えていない'
    r.cap('四角は、角から角へドラッグ', .6, 'top')
    r.tool('四角')
    r.drag([(x0, y0 + 110), (x1, y1)], 900)
    r.cap('寸法は、測りたい2点の間をドラッグ', .6, 'top')
    r.tool('寸法')
    r.drag([(x0, y1 + 24), (x1, y1 + 24)], 900, 1.2)
    r.cap('太さと色はここで選ぶ', .4, 'top')
    r.tap_el(r.p.locator('.sx-seg button', has_text='太'), .4)
    r.tap_el(r.p.locator('.sx-colors button', has_text='赤'), .4)
    r.tool('ペン')
    r.drag([(x0 + 20, y1 - 30), (x1 - 20, y0 + 140)], 700, 1.2)
    r.uncap()


def parts(r: Rec):
    x0, y0, x1, y1 = parking(r)
    r.tool('四角')
    r.drag([(x0, y0 + 60), (x1, y1)], 300, .2)
    r.cap('② 部品を置く', 1.4)
    r.uncap()
    r.step('部品')
    r.cap('種類を選んで…', .3, 'top')
    r.tap_el(r.p.locator('.sx-cats button', has_text='乗り物'), .4)
    r.tap_el(r.p.locator('.sx-part').nth(1), .4)
    r.cap('置きたい場所をタップ', .3, 'top')
    n0 = r.items()
    r.tap((x0 + x1) / 2, (y0 + y1) / 2 + 30, .8)
    assert r.items() > n0, '部品が置かれていない'
    r.cap('木は、タップするたびに増える', .3, 'top')
    r.tap_el(r.p.locator('.sx-cats button', has_text='植栽'), .4)
    r.tap_el(r.p.locator('.sx-part').first, .4)
    for k in range(3):
        r.tap(x1 + 40 + k * 46, y0 + 40 + (k % 2) * 30, .35)
    r.cap('「動かす」でドラッグして調整', .3, 'top')
    r.tool('動かす')
    r.drag([(x1 + 40, y0 + 40), (x1 + 50, y0 + 110)], 900, 1.4)
    r.uncap()


def paint(r: Rec):
    x0, y0, x1, y1 = parking(r)
    r.cap('③ 塗る', 1.2)
    r.cap('まず、線で囲んだ形を描いておく', .4, 'top')
    r.tool('四角')
    r.drag([(x0, y0 + 60), (x1, y1)], 800, .4)
    r.step('塗る')
    r.cap('囲まれた場所をタップ', .3, 'top')
    r.tap((x0 + x1) / 2, (y0 + y1) / 2 + 30, 1.0)
    assert r.p.locator('.sx-badge.done').count() == 1, '塗る範囲が選ばれていない'
    r.cap('素材を選ぶ → 塗れる', .3, 'top')
    n0 = r.p.evaluate("() => document.querySelectorAll('.v3-svg image, .v3-svg pattern').length")
    r.tap_el(r.p.locator('.sx-tex', has_text='土間').first, 1.2)
    assert r.p.evaluate("() => document.querySelectorAll('.v3-svg image, .v3-svg pattern').length") > n0, '塗られていない'
    r.cap('別の場所も同じ手順で', .3, 'top')
    sx, sy, sw, sh = r.stage()
    r.step('描く', .3)
    r.tool('四角')
    r.drag([(x0, y0 - 10), (x1, y0 + 50)], 600, .3)
    r.step('塗る')
    r.tap((x0 + x1) / 2, y0 + 20, .8)
    r.tap_el(r.p.locator('.sx-tex', has_text='芝').first, 1.6)
    r.uncap()


def out(r: Rec):
    x0, y0, x1, y1 = parking(r)
    r.tool('四角')
    r.drag([(x0, y0 + 60), (x1, y1)], 300, .2)
    r.cap('④ 出力', 1.2)
    r.uncap()
    r.step('出力')
    r.cap('PDFを押すだけ', .4, 'top')
    with r.p.expect_download() as dl:
        r.tap_el(r.p.locator('.sx-out', has_text='A3'), 1.5)
    assert dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename
    r.cap('できたPDFを、LINEやメールでお客様へ', 2.4)
    r.uncap()


def undo(r: Rec):
    x0, y0, x1, y1 = parking(r)
    r.cap('間違えたら', 1.2)
    r.uncap()
    r.tap_el(r.p.locator('.sx-colors button', has_text='赤'), .3)
    r.tap_el(r.p.locator('.sx-seg button', has_text='太'), .3)
    n0 = r.items()
    r.drag([(x0, y0 + 40), (x1, y1 - 40)], 900, .6)
    r.cap('「戻す」で1つ前へ', .6, 'top')
    r.tap_el(r.p.get_by_role('button', name='元に戻す'), 1.2)
    assert r.items() == n0, '戻すで線が消えていない'
    r.cap('「進む」で取り消しを取り消し', .6, 'top')
    r.tap_el(r.p.get_by_role('button', name='やり直す'), 1.4)
    r.uncap()


SCENES = {'draw': draw, 'parts': parts, 'paint': paint, 'out': out, 'undo': undo, **FULL_SCENES}


def to_mp4(src: pathlib.Path, dst: pathlib.Path, start: float):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-loglevel', 'error', '-ss', f'{start:.2f}', '-i', str(src),
                    '-vf', 'scale=960:-2,setsar=1', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(dst)], check=True)


def poster(src: pathlib.Path, dst: pathlib.Path):
    """一覧に出すサムネイル（動画の6割あたりの1コマ）"""
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    info = subprocess.run([ff, '-i', str(src)], capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
    h, m, sec = info.split('Duration: ')[1].split(',')[0].split(':')
    t = (int(h) * 3600 + int(m) * 60 + float(sec)) * 0.6
    subprocess.run([ff, '-y', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', str(src), '-frames:v', '1',
                    '-vf', 'scale=480:-2', '-q:v', '5', str(dst)], check=True)


def main():
    out_dir = pathlib.Path(ARGS.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = ARGS.only or list(SCENES)
    with sync_playwright() as pw, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        browser = pw.chromium.launch()
        for name in names:
            ctx = browser.new_context(viewport={'width': W, 'height': H}, record_video_dir=tmp,
                                      record_video_size={'width': W, 'height': H}, accept_downloads=True)
            ctx.add_init_script(OVERLAY)
            full = name.startswith('f-')
            if full:
                ctx.add_init_script("try { localStorage.setItem('gofg-v3-ui', 'full'); } catch {}")
            page = ctx.new_page()
            t0 = time.time()
            r = Rec(page, flash=full)
            r.url = ARGS.url
            FULL_OPEN.get(name, open_sample)(r)
            start = time.time() - t0
            try:
                SCENES[name](r)
            except Exception:
                if ARGS.shots:
                    page.screenshot(path=str(pathlib.Path(ARGS.shots) / f'{name}-fail.png'))
                raise
            if ARGS.shots:
                pathlib.Path(ARGS.shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(pathlib.Path(ARGS.shots) / f'{name}.png'))
            video = page.video
            ctx.close()
            webm = pathlib.Path(video.path())
            dst = out_dir / f'{name}.mp4'
            to_mp4(webm, dst, start)
            if full:
                poster(dst, out_dir / f'{name}.jpg')
            print(f'{name}: {dst} ({dst.stat().st_size // 1024} KB)')
        browser.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4173/')
    ap.add_argument('--out', default=str(ROOT / 'src' / 'v3' / 'guide'))
    ap.add_argument('--only', nargs='*', choices=list(SCENES))
    ap.add_argument('--shots', default='')
    ARGS = ap.parse_args()
    main()

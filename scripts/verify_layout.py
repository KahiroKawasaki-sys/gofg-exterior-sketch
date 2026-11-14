"""文字の表示崩れを、iPad の画面サイズごとに WebKit で確かめる。

開発サーバー（npm run dev）を起動した状態で実行する:
    python scripts/verify_layout.py --out C:/tmp/layout
    python scripts/verify_layout.py --out C:/tmp/layout --only full-select 3d-wall --sizes 1180x820 768x1024

場面ごと・画面サイズごとに <out>/<場面>-<幅>x<高さ>.png を保存し、崩れている所を文字で一覧にする:
  折れ   … ボタンの文字が2行以上に折れている（高さが決まったボタンでは上下が切れる）
  切れ   … 文字が枠に入りきらず切れている
  画面外 … ボタンが画面の外に出ている（横に流れる帯の続きなど）
画面を変えたら回して、一覧が空になることを確かめる。
"""
import argparse
import pathlib

from playwright.sync_api import Page, sync_playwright

SIZES = ['1366x1024', '1180x820', '1024x768', '820x1180', '768x1024']

# 見えている文字つきの部品を調べ、折れ・切れ・画面外を返す
CHECK = r"""
() => {
  const out = [], seen = new Set();
  const visible = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  // その場所でいちばん上に描かれているか（別の画面の下に隠れた物は数えない）
  const onTop = el => { const r = el.getBoundingClientRect(), x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)); const t = document.elementFromPoint(x, y); return !t || el.contains(t) || t.contains(el); };
  const lines = el => { let n = 0; const rg = document.createRange(); const walk = node => { for (const c of node.childNodes) { if (c.nodeType === 3 && c.textContent.trim()) { rg.selectNodeContents(c); n = Math.max(n, new Set([...rg.getClientRects()].map(q => Math.round(q.top / 4))).size); } else if (c.nodeType === 1) walk(c); } }; walk(el); return n; };
  for (const el of document.querySelectorAll('button, select, .v3-btn, .v3-tl, .sx-out, .sx-tool, .sx-step, label, summary, th, td, h4, b')) {
    if (!visible(el)) continue;
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 40) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), tag = el.tagName.toLowerCase(), cls = (el.className && el.className.baseVal === undefined ? el.className : '').toString().split(' ')[0];
    const push = (kind, extra = '') => { const k = kind + '|' + tag + '.' + cls + '|' + text; if (seen.has(k)) return; seen.add(k); out.push(`${kind}  ${tag}${cls ? '.' + cls : ''} 「${text}」${extra}`); };
    const isBtn = tag === 'button' || el.classList.contains('v3-btn');
    if (isBtn && !el.closest('.sx-cats, .sx-parts, .sx-texs') && (r.right > innerWidth + 2 || r.left < -2)) { push('画面外', ` (x=${Math.round(r.left)}〜${Math.round(r.right)} / 画面幅${innerWidth})`); continue; }
    if (!onTop(el)) continue;
    if (isBtn && el.innerText.trim() && !el.innerText.trim().includes('\n') && lines(el) > 1) push('折れ', ` (${lines(el)}行・幅${Math.round(r.width)}px)`);
    if (cs.display !== 'inline' && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0) push('切れ', ` (中身${el.scrollWidth}px > 枠${el.clientWidth}px)`);
    if (isBtn && el.scrollHeight > el.clientHeight + 3 && cs.height !== 'auto' && el.innerText.trim()) push('切れ', ` (高さ：中身${el.scrollHeight}px > 枠${el.clientHeight}px)`);
  }
  // 横に流れる帯：続きが隠れているのに、流せることが分からないもの
  for (const el of document.querySelectorAll('.v3-bar, .sx-row, .sx-outs, .v3-tabs, .v3-selbar, .v3-phead')) {
    if (!visible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 4) out.push(`帯の続き  .${el.className.toString().split(' ').join('.')} (中身${el.scrollWidth}px > 見える幅${el.clientWidth}px)`);
  }
  return out;
}
"""

MAKE_WALL = r"""
async () => {
  const [T, { saveDoc }] = await Promise.all([import('/src/v3/types.ts'), import('/src/v3/store.ts')]);
  const d = T.newDoc('確認：塀1本');
  const line = { id: T.uid(), type: 'line', kind: 'polyline', color: '#2f3b38', width: 4, dash: 'solid', pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }], role3: 'wall', h3: 1800 };
  d.layers = d.layers.map(l => l.name === 'レイヤー 1' ? { ...l, items: [line] } : l);
  await saveDoc(d); return d.id;
}
"""


def open_sample(p: Page, url: str, ui: str):
    p.goto(url)
    p.evaluate(f"() => {{ try {{ localStorage.setItem('gofg-v3-tour', 'done'); localStorage.setItem('gofg-v3-ui', '{ui}'); }} catch {{}} }}")
    p.goto(url)
    p.get_by_text('サンプル邸で試す').click()
    p.locator('.v3-stage').wait_for()
    p.wait_for_timeout(700)


def select_all(p: Page):
    p.get_by_role('button', name='選択', exact=True).first.click()
    b = p.locator('.v3-stage').bounding_box()
    lasso(p, b, 0.9)


def lasso(p: Page, b, bottom: float):
    """図面をぐるっと囲んで、まとめて選ぶ（選択は囲み線）"""
    x0, y0, x1, y1 = b['x'] + b['width'] * 0.12, b['y'] + b['height'] * 0.08, b['x'] + b['width'] * 0.9, b['y'] + b['height'] * bottom
    p.mouse.move(x0, y0)
    p.mouse.down()
    for x, y in [(x1, y0), (x1, y1), (x0, y1), (x0, y0 + 4)]:
        p.mouse.move(x, y, steps=8)
    p.mouse.up()
    p.wait_for_timeout(400)
    p.locator('.v3-selbar').wait_for(timeout=4000)


def s_home(p, url):
    p.goto(url); p.get_by_text('サンプル邸で試す').wait_for()


def s_full(p, url):
    open_sample(p, url, 'full')


def s_full_select(p, url):
    open_sample(p, url, 'full'); select_all(p)


def s_full_select_layers(p, url):
    open_sample(p, url, 'full'); p.get_by_role('button', name='レイヤー', exact=True).click(); select_all(p)


def s_full_objects(p, url):
    open_sample(p, url, 'full'); p.get_by_role('button', name='部品', exact=True).click(); p.wait_for_timeout(300)


def s_full_paint(p, url):
    open_sample(p, url, 'full'); p.get_by_role('button', name='塗る', exact=True).click(); p.wait_for_timeout(300)


def s_full_qty(p, url):
    open_sample(p, url, 'full'); p.get_by_role('button', name='集計', exact=True).click(); p.wait_for_timeout(600)


def s_full_est(p, url):
    s_full_qty(p, url); p.get_by_role('tab', name='概算見積').click(); p.wait_for_timeout(600)


def s_full_board(p, url):
    s_full_qty(p, url); p.get_by_role('tab', name='仕様書').click(); p.wait_for_timeout(600)


def s_full_settings(p, url):
    open_sample(p, url, 'full'); p.get_by_role('button', name='設定', exact=True).click(); p.wait_for_timeout(300)


def s_simple(p, url):
    open_sample(p, url, 'simple')


def s_simple_select(p, url):
    open_sample(p, url, 'simple'); p.locator('.sx-tool', has_text='動かす').first.click(); select_all_simple(p)


def select_all_simple(p: Page):
    lasso(p, p.locator('.v3-stage').bounding_box(), 0.85)


def s_simple_parts(p, url):
    open_sample(p, url, 'simple'); p.locator('.sx-step', has_text='部品').click(); p.wait_for_timeout(300)


def s_simple_paint(p, url):
    open_sample(p, url, 'simple'); p.locator('.sx-step', has_text='塗る').click(); p.wait_for_timeout(300)


def s_simple_out(p, url):
    open_sample(p, url, 'simple'); p.locator('.sx-step', has_text='出力').click(); p.wait_for_timeout(300)


def s_meeting(p, url):
    open_sample(p, url, 'simple'); p.get_by_role('button', name='打ち合わせ').first.click(); p.wait_for_timeout(500)


def s_3d(p, url):
    open_sample(p, url, 'simple'); p.get_by_role('button', name='3Dで見る').first.click()
    p.locator('.v3-3d-stage canvas').wait_for(); p.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000); p.wait_for_timeout(800)


def s_3d_wall(p, url):
    """塀を1本だけ置いた図面を3Dで開き、画面の中央（＝塀）をタップして「選んだ線を3Dで」を出す"""
    p.goto(url); p.get_by_text('サンプル邸で試す').wait_for()
    doc = p.evaluate(MAKE_WALL)
    p.goto(f'{url}?doc={doc}'); p.locator('.v3-stage').wait_for(); p.wait_for_timeout(500)
    p.get_by_role('button', name='3Dで見る').first.click()
    p.locator('.v3-3d-stage canvas').wait_for(); p.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000); p.wait_for_timeout(800)
    b = p.locator('.v3-3d-stage').bounding_box()
    p.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2 - 6)
    p.locator('.v3-3d-roles.mats').wait_for(timeout=5000)


def s_3d_render(p, url):
    s_3d(p, url); p.get_by_role('button', name='AIパースを作る').click(); p.wait_for_timeout(700)


SCENES = {
    'home': s_home, 'full': s_full, 'full-select': s_full_select, 'full-select-layers': s_full_select_layers, 'full-objects': s_full_objects,
    'full-paint': s_full_paint, 'full-qty': s_full_qty, 'full-est': s_full_est, 'full-board': s_full_board, 'full-settings': s_full_settings,
    'simple': s_simple, 'simple-select': s_simple_select, 'simple-parts': s_simple_parts, 'simple-paint': s_simple_paint, 'simple-out': s_simple_out,
    'meeting': s_meeting, '3d': s_3d, '3d-wall': s_3d_wall, '3d-render': s_3d_render,
}


def main():
    out = pathlib.Path(ARGS.out)
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    with sync_playwright() as pw:
        browser = getattr(pw, ARGS.browser).launch()
        for size in ARGS.sizes:
            w, h = (int(v) for v in size.split('x'))
            for name in ARGS.only or list(SCENES):
                ctx = browser.new_context(viewport={'width': w, 'height': h})
                ctx.add_init_script("try { localStorage.setItem('gofg-v3-tour', 'done'); } catch {}")
                page = ctx.new_page()
                try:
                    SCENES[name](page, ARGS.url)
                    found = page.evaluate(CHECK)
                except Exception as e:  # 場面まで進めなかった（ボタンが押せない等）も崩れの手がかり
                    found = [f'進めず  {type(e).__name__}: {str(e).splitlines()[0][:140]}']
                page.screenshot(path=str(out / f'{name}-{size}.png'))
                ctx.close()
                total += len(found)
                print(f'[{size}] {name}: ' + ('OK' if not found else f'{len(found)}件'))
                for f in found:
                    print('    ' + f)
        browser.close()
    print(f'合計 {total} 件')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4173/')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', nargs='*', choices=list(SCENES))
    ap.add_argument('--sizes', nargs='*', default=SIZES)
    ap.add_argument('--browser', default='webkit', choices=['webkit', 'chromium'])
    ARGS = ap.parse_args()
    main()

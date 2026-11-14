"""3Dの見た目を画像で確かめる（iPad と同じ WebKit で撮る）。

開発サーバー（npm run dev）を起動した状態で実行する:
    python scripts/verify_3d.py --out C:/tmp/shots3d
    python scripts/verify_3d.py --out C:/tmp/shots3d --only sample 乗り物 --browser chromium

サンプル邸と、部品を分類ごとに並べた確認用の図面、塀・フェンス・門扉の図面を端末保存に入れて3Dで開き、
斜め上／人の目線（サンプル邸は真上も）を <out>/<名前>-<視点>.png に保存する。
部品の形や光を変えたら、変える前と後で撮って見比べる。
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

W, H = 1180, 820

# ページの中で図面を作って端末保存に入れる（アプリのコードをそのまま使う）
MAKE_DOCS = r"""
async () => {
  const [{ builtinLibrary }, T, { saveDoc }, { sampleDoc }] = await Promise.all([
    import('/src/v3/library.ts'), import('/src/v3/types.ts'), import('/src/v3/store.ts'), import('/src/v3/useDoc.ts')]);
  const lib = builtinLibrary(), out = [];
  const line = (pts, extra) => ({ id: T.uid(), type: 'line', kind: 'polyline', color: '#2f3b38', width: 4, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra });
  const put = async (name, items, objs) => {
    const d = T.newDoc('確認：' + name);
    d.layers = d.layers.map(l => l.kind === 'object' ? { ...l, items: objs } : l.name === 'レイヤー 1' ? { ...l, items } : l);
    await saveDoc(d); out.push({ name, id: d.id });
  };
  const s = sampleDoc(); await saveDoc(s); out.push({ name: 'sample', id: s.id });
  // 部品：分類ごとに1枚。横に並べ、幅 14m で折り返す
  const cats = [...new Set(lib.map(l => l.cat))];
  for (const cat of cats) {
    let x = 0, y = 0, rowH = 0; const objs = [];
    for (const l of lib.filter(v => v.cat === cat)) {
      if (x > 0 && x + l.w > 1400) { x = 0; y += rowH + 80; rowH = 0; }
      objs.push({ id: T.uid(), type: 'obj', ref: l.id, name: l.name, x, y, w: l.w, h: l.h, rot: 0, flip: false, color: null });
      x += l.w + 70; rowH = Math.max(rowH, l.h);
    }
    await put(cat, [], objs);
  }
  // 線：塀4種（L字で角を見る）・フェンス3種・門扉・斜めの角
  const items = [];
  ['block', 'plaster', 'wood', 'alumi'].forEach((m, i) => items.push(line([[i * 420, 0], [i * 420 + 300, 0], [i * 420 + 300, 250]], { role3: 'wall', mat3: m, h3: 1400 })));
  ['board', 'lattice', 'mesh'].forEach((m, i) => items.push(line([[i * 420, 500], [i * 420 + 300, 500], [i * 420 + 300, 750]], { role3: 'fence', mat3: m, h3: 1200 })));
  items.push(line([[1300, 500], [1400, 500]], { role3: 'gate' }), line([[1450, 500], [1650, 500]], { role3: 'gate' }));
  items.push(line([[1300, 750], [1500, 650], [1700, 750]], { role3: 'wall', mat3: 'block', h3: 1200 }));
  await put('線', items, []);
  return out;
}
"""


def main():
    out = pathlib.Path(ARGS.out)
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = getattr(pw, ARGS.browser).launch()
        ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=ARGS.scale)
        ctx.add_init_script("try { localStorage.setItem('gofg-v3-tour', 'done'); } catch {}")
        page = ctx.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(ARGS.url)
        page.get_by_text('サンプル邸で試す').wait_for()
        docs = page.evaluate(MAKE_DOCS)
        for d in docs:
            if ARGS.only and d['name'] not in ARGS.only:
                continue
            page.goto(f"{ARGS.url}?doc={d['id']}")
            page.locator('.v3-stage').wait_for()
            page.wait_for_timeout(500)
            page.get_by_role('button', name='3Dで見る').first.click()
            page.locator('.v3-3d-stage canvas').wait_for()
            page.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000)
            page.wait_for_timeout(1200)
            views = ['斜め上', '人の目線'] + (['真上'] if d['name'] == 'sample' else [])
            for v in views:
                page.locator('.v3-3d-seg button', has_text=v).click()
                page.wait_for_timeout(700)
                p = out / f"{d['name']}-{v}.png"
                page.locator('.v3-3d-stage').screenshot(path=str(p))
                print(p)
        # 立面図つきの家：配置図PDFから始め、3D画面で立面図PDFを読み込む（フォルダごとに 配置図.pdf と 立面図.pdf）
        for folder in sorted(pathlib.Path(ARGS.elev).iterdir()) if ARGS.elev else []:
            site, elev = folder / '配置図.pdf', folder / '立面図.pdf'
            name = f'elev{folder.name}'
            if not (site.exists() and elev.exists()) or (ARGS.only and name not in ARGS.only):
                continue
            page.goto(ARGS.url)
            page.get_by_text('サンプル邸で試す').wait_for()
            page.locator('input[type=file]').first.set_input_files(str(site))
            page.locator('.v3-stage').wait_for(timeout=60000)
            page.get_by_role('button', name='あとで').click(timeout=15000)
            page.get_by_role('button', name='3Dで見る').first.click()
            page.locator('.v3-3d-stage canvas').wait_for()
            page.locator('.v3-3d input[type=file]').set_input_files(str(elev))
            page.get_by_role('button', name='3Dに貼る').click(timeout=60000)
            page.locator('.v3-elev').wait_for(state='detached', timeout=60000)
            page.wait_for_timeout(4000)  # 建物の位置合わせ（配置図の線に重ねる）を待つ
            page.locator('.v3-3d-msg').wait_for(state='detached', timeout=60000)
            for v in ['斜め上', '人の目線']:
                page.locator('.v3-3d-seg button', has_text=v).click()
                page.wait_for_timeout(900)
                p = out / f'{name}-{v}.png'
                page.locator('.v3-3d-stage').screenshot(path=str(p))
                print(p)
            # 外壁の色を濃くして、妻の三角も同じ色になるか見る
            page.get_by_role('button', name='外壁 ネイビー').click()
            page.locator('.v3-3d-seg button', has_text='斜め上').click()
            page.wait_for_timeout(1500)
            page.locator('.v3-3d-stage').screenshot(path=str(out / f'{name}-ネイビー.png'))
        browser.close()
        for e in dict.fromkeys(errors):
            print('ERROR:', e)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4173/')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--elev', default='', help='立面図サンプルのフォルダ（中の各フォルダに 配置図.pdf と 立面図.pdf）')
    ap.add_argument('--browser', default='webkit', choices=['webkit', 'chromium'])
    ap.add_argument('--scale', type=float, default=1)
    ARGS = ap.parse_args()
    main()

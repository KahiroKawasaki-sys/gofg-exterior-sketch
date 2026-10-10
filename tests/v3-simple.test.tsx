// @vitest-environment jsdom
// かんたんモード：4手順の切替、道具の選択、初回案内、詳細モードとの切替
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '../src/v3/Editor';
import { newDoc } from '../src/v3/types';
import { simpleHint } from '../src/v3/Simple';
// 素材の見本画像は canvas 描画が要るため、テストでは空にする
vi.mock('../src/v3/textures', async orig => ({ ...(await orig<typeof import('../src/v3/textures')>()), textureSrc: () => '' }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Node の localStorage は jsdom と食い違うため、端末保存を単純な Map で置き換える
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function open() {
  await act(async () => { root.render(<Editor initial={newDoc('テスト邸')} onHome={() => {}} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}
const q = (s: string) => document.querySelector(s);
const qa = (s: string) => [...document.querySelectorAll(s)];
const byText = (sel: string, t: string) => qa(sel).find(e => e.textContent?.includes(t)) as HTMLElement;
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };

it('初回は案内が出て、最後まで進むと次回からは出ない', async () => {
  await open();
  expect(q('.sx-tour')).toBeTruthy();
  for (let i = 0; i < 8; i++) await click(q('.sx-brow .next'));
  expect(q('.sx-tour')).toBeNull();
  expect(localStorage.getItem('gofg-v3-tour')).toBe('done');
  await act(async () => root.unmount()); root = createRoot(host);
  await open();
  expect(q('.sx-tour')).toBeNull();
});

it('標準はかんたんモードで、詳細の道具や右パネルは出さない', async () => {
  localStorage.setItem('gofg-v3-tour', 'done');
  await open();
  expect(q('.sx-dock')).toBeTruthy();
  expect(q('.v3-top')).toBeNull();
  expect(q('.v3-left')).toBeNull();
  expect(q('.v3-side')).toBeNull();
  expect(qa('.sx-step').map(e => e.textContent?.replace(/\d/, ''))).toEqual(['描く', '部品', '塗る', '出力']);
});

it('手順を押すと、その手順の道具だけに切り替わる', async () => {
  localStorage.setItem('gofg-v3-tour', 'done');
  await open();
  expect(byText('.sx-tool.on', 'ペン')).toBeTruthy();
  await click(byText('.sx-step', '部品'));
  expect(q('.sx-parts')).toBeTruthy();
  await click(byText('.sx-step', '塗る'));
  expect(byText('.sx-badge.now', '塗る場所をタップ')).toBeTruthy();
  expect(q('.sx-texs.wait')).toBeTruthy();
  await click(byText('.sx-step', '出力'));
  expect(qa('.sx-out').length).toBe(4);
  await click(byText('.sx-step', '描く'));
  await click(byText('.sx-tool', '四角'));
  expect(byText('.sx-tool.on', '四角')).toBeTruthy();
  await click(byText('.sx-seg button', '太'));
  expect(byText('.sx-seg button.on', '太')).toBeTruthy();
});

it('塗る場所を選ばずに素材を押すと、先にタップするよう伝える', async () => {
  localStorage.setItem('gofg-v3-tour', 'done');
  await open();
  await click(byText('.sx-step', '塗る'));
  await click(q('.sx-tex'));
  expect(q('.v3-toast')?.textContent).toContain('塗りたい場所');
});

it('詳細モードへ切り替えると端末に覚え、かんたんモードへ戻せる', async () => {
  localStorage.setItem('gofg-v3-tour', 'done');
  await open();
  await click(q('[aria-label="詳細モードへ"]'));
  expect(q('.v3-top')).toBeTruthy();
  expect(q('.sx-dock')).toBeNull();
  expect(localStorage.getItem('gofg-v3-ui')).toBe('full');
  await click(byText('.sx-modebtn', 'かんたんモード'));
  expect(q('.sx-dock')).toBeTruthy();
  expect(localStorage.getItem('gofg-v3-ui')).toBe('simple');
});

it('使い方には動く見本と実画面の動画がある', async () => {
  localStorage.setItem('gofg-v3-tour', 'done');
  await open();
  await click(q('[aria-label="使い方"]'));
  expect(qa('.sx-hcard').length).toBe(8);
  expect(qa('.sx-hcard .sx-demo').length).toBe(8);
  await click(byText('.sx-hcard', '① 描く').querySelector('.sx-watch'));
  expect(q('.sx-player video')?.getAttribute('src')).toMatch(/draw.*\.mp4/);
  await click(byText('.sx-tourbtn', '案内をもう一度'));
  expect(q('.sx-tour')).toBeTruthy();
});

it('道具ごとの一言', () => {
  expect(simpleHint('pen', 0)).toBe('なぞって線を描く');
  expect(simpleHint('aiFill', 0)).toBe('線で囲まれた場所をタップ');
  expect(simpleHint('aiFill', 3)).toContain('素材を選ぶ');
  expect(simpleHint('place', 0, '芝')).toContain('「芝」');
  expect(simpleHint('select', 0, undefined, 'parts')).toContain('部品を選ぶ');
  expect(simpleHint('pen', 0, undefined, 'out')).toBe('');
});

// ---- 詳細モード ----
async function openFull() { localStorage.setItem('gofg-v3-tour', 'done'); localStorage.setItem('gofg-v3-ui', 'full'); await open(); }

it('詳細モード：▼メニューを押しても画面が落ちない（ペン・線・図形・書き出し）', async () => {
  await openFull();
  for (const label of ['ペンの種類', '線の種類', '図形の種類', '書き出し']) {
    await click(q(`.v3-top [aria-label="${label}"]`));
    expect(q('.v3-menu'), label).toBeTruthy();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    await click(q(`.v3-top [aria-label="${label}"]`));
    await click(q(`.v3-top [aria-label="${label}"]`));
  }
  expect(q('.v3-top')).toBeTruthy();
});

it('詳細モード：「使い方」で詳細の解説動画一覧を開き、続けて次の動画へ進める', async () => {
  await openFull();
  await click(byText('.sx-modebtn', '使い方'));
  expect(byText('.sx-tabs button.on', '詳細モード')).toBeTruthy();
  expect(qa('.sx-vcard').length).toBe(10);
  await click(byText('.sx-vcard', '画面の見方'));
  expect(q('.sx-player video')?.getAttribute('src')).toMatch(/f-screen.*\.mp4/);
  await click(byText('.sx-player .v3-btn', '次：ペン・線・図形'));
  expect(q('.sx-player video')?.getAttribute('src')).toMatch(/f-pen.*\.mp4/);
  await click(byText('.sx-tabs button', 'かんたんモード'));
  expect(qa('.sx-hcard .sx-demo').length).toBe(8);
});

it('詳細モード：各パネルの「動画」でそのパネルの解説がすぐ流れる', async () => {
  await openFull();
  await click(q('.v3-side .sx-vbtn'));
  expect(q('.sx-player video')?.getAttribute('src')).toMatch(/f-objects.*\.mp4/);
  await click(q('.sx-help [aria-label="閉じる"]'));
  await click(q('.v3-top [aria-label="レイヤー"]'));
  await click(q('.v3-side .sx-vbtn'));
  expect(q('.sx-player video')?.getAttribute('src')).toMatch(/f-layers.*\.mp4/);
});

it('詳細モード：「塗る」から素材の一覧がすぐ出て、AIツールは無い', async () => {
  await openFull();
  expect(q('[aria-label="AIツール"]')).toBeNull();
  await click(q('.v3-top [aria-label="塗る"]'));
  const side = q('.v3-side')!;
  expect(side.textContent).toContain('① 塗る場所を選ぶ');
  for (const name of ['芝', 'ウッド', 'いまの色', '写真から']) expect(byText('.v3-side .v3-texgrid button', name)).toBeTruthy();
  expect(side.textContent).not.toMatch(/AI|ジョブ|生成/);
  // 場所を選ぶ前に素材を押すと、先に場所を選ぶよう案内する
  await click(byText('.v3-side .v3-texgrid button', '芝'));
  expect(q('.v3-toast')?.textContent).toContain('塗りたい場所');
});

it('詳細モード：ツールバーは2段で、重複・飾りのボタンは無い', async () => {
  await openFull();
  expect(qa('.v3-top .v3-bar').length).toBe(2);
  for (const gone of ['開く', 'ログアウト（一覧へ）', 'クラウド', '利用者', '左に回転', '右に回転', 'パネル', 'テキスト一覧', 'AIツール']) expect(q(`[aria-label="${gone}"]`)).toBeNull();
  expect(qa('.v3-top [aria-label="案件一覧"]').length).toBe(1);
  // 全体表示は文字つき、回転していなければ「0°に戻す」は出さない
  expect(byText('.v3-top .v3-tl', '全体表示')).toBeTruthy();
  expect(q('[aria-label="回転を戻す"]')).toBeNull();
  // 左の縦は上と重ならない操作だけ
  expect(qa('.v3-left button').map(b => b.getAttribute('aria-label'))).toEqual(['やり直す', '選択', 'ガイド吸着', '元に戻す']);
  // 単位・縮尺・グリッド間隔は設定へ
  await click(q('.v3-top [aria-label="設定"]'));
  for (const label of ['単位', '縮尺', '距離表示', 'グリッド間隔mm']) expect(q(`.v3-side [aria-label="${label}"]`)).toBeTruthy();
});

it('詳細モード：部品は押すとすぐ置ける状態になり、細かい機能は「その他」にまとまる', async () => {
  await openFull();
  if (!q('.v3-side')?.textContent?.includes('部品を選んで')) await click(q('.v3-top [aria-label="部品"]'));
  expect(q('.v3-side')?.textContent).not.toContain('登録を配置');
  await click(q('.v3-side .v3-list .v3-item'));
  expect(q('.v3-toast')?.textContent).toContain('図面をタップで置けます');
  expect(q('.v3-side .v3-list .v3-item.on')).toBeTruthy();
  expect(byText('.v3-more summary', 'その他')).toBeTruthy();
});

it('詳細モード：ガイド線は外構で使う5種類だけ', async () => {
  await openFull();
  await click(q('.v3-top [aria-label="ガイド線"]'));
  expect(qa('.v3-side .v3-grid3 .v3-pbtn').map(b => b.textContent)).toEqual(['直線ガイド', '線勾配', '面勾配', '円ガイド', 'グリッド']);
});

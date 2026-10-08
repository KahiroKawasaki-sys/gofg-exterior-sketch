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

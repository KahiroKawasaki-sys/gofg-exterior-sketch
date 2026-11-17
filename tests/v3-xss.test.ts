// @vitest-environment jsdom
// 細工した編集データ（.garden3.json）で画面に任意のコードが入らないこと
import { describe, expect, it } from 'vitest';
import { itemMarkup, layerMarkup, svgId } from '../src/v3/markup';
import { symbolMarkup } from '../src/v3/library';
import { validDoc } from '../src/v3/docCheck';
import { newDoc, newLayer, type Item } from '../src/v3/types';
import { sampleDoc } from '../src/v3/useDoc';

const ctx = { mmPerPx: 10, unit: 'mm' };
const EVIL = '"><script>alert(1)</script><img src=x onerror=alert(1)>';
const tex = (over: Record<string, unknown>) => ({ id: 'a', type: 'texture', name: 'x', mask: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 10, h: 10, tex: 'b:lawn', texName: '芝', scale: 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100, ...over }) as unknown as Item;

// 文字列をHTMLとして読み、要素と属性に危険なものが無いかを見る
function parse(svg: string) {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  return host;
}
function assertSafe(svg: string) {
  const host = parse(svg);
  expect(host.querySelectorAll('script, img, foreignObject, iframe').length).toBe(0);
  for (const el of host.querySelectorAll('*')) for (const a of el.attributes) {
    expect(a.name.startsWith('on')).toBe(false);
    expect(/javascript:/i.test(a.value)).toBe(false);
  }
}

describe('markup のエスケープ', () => {
  it('塗りの id に細工があっても属性から抜け出さない', () => {
    const s = itemMarkup(tex({ id: EVIL }), ctx);
    assertSafe(s);
    expect(s).not.toContain('<script');
    // 参照（url(#..)）と定義（id=..）は同じ形にそろう
    const id = svgId(EVIL);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s).toContain(`id="mk-${id}"`); expect(s).toContain(`url(#mk-${id})`);
  });
  it('マスク・素材の画像は data:/同梱だけ（外部URL・javascript: は空にする）', () => {
    const s = itemMarkup(tex({ mask: 'javascript:alert(1)', tex: 'https://evil.example/x.png' }), ctx);
    assertSafe(s);
    expect(s).not.toContain('evil.example');
  });
  it('色・数値・文字・部品の参照に細工があっても無害', () => {
    const items = [
      { id: 'l', type: 'line', kind: 'arrow', color: EVIL, width: EVIL, dash: 'solid', pts: [{ x: 0, y: 0 }, { x: EVIL, y: 5 }] },
      { id: 's', type: 'stroke', brush: 'pen', color: 'red;background:url(//evil)', width: 2, dash: 'solid', pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      { id: 'r', type: 'shape', shape: 'rect', color: EVIL, width: 2, dash: 'solid', x: 0, y: 0, w: 10, h: 10, rot: EVIL },
      { id: 'd', type: 'dim', color: EVIL, width: 1, a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, size: EVIL },
      { id: 't', type: 'text', x: 0, y: 0, text: EVIL, size: 12, color: EVIL, bg: EVIL, border: EVIL, rot: 0 },
      { id: 'o', type: 'obj', ref: EVIL, name: EVIL, x: 0, y: 0, w: 10, h: 10, rot: 0, flip: false, color: EVIL },
    ] as unknown as Item[];
    const layer = { ...newLayer('x'), items };
    const s = layerMarkup(layer, ctx);
    assertSafe(s);
    expect(s).not.toContain('evil');
    expect(s).toContain('&lt;script&gt;'); // 文字そのものは文字として出る
  });
  it('部品の定義（symbol）と置き場所（use）の id が一致する', () => {
    const l = { id: 'b-tree', name: 'x', cat: '植栽', w: 1, h: 1, vw: 1, vh: 1, svg: '' };
    expect(symbolMarkup(l)).toContain('id="lib-b-tree" viewBox=');
    // 書き出し（画像化）は XML として読むので、壊れていないこと
    expect(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${symbolMarkup(l)}</svg>`, 'image/svg+xml').querySelector('parsererror')).toBeNull();
    const o = { id: 'o', type: 'obj', ref: 'b-tree', name: 'x', x: 0, y: 0, w: 1, h: 1, rot: 0, flip: false, color: null } as Item;
    expect(itemMarkup(o, ctx)).toContain('href="#lib-b-tree"');
  });
});

describe('validDoc（読み込み時の検査）', () => {
  it('新規・サンプル・書き出しと同じ形のデータは通る', () => {
    expect(() => validDoc(JSON.parse(JSON.stringify(newDoc())))).not.toThrow();
    const s = sampleDoc();
    expect(() => validDoc(JSON.parse(JSON.stringify({ ...s, view: { x: 0, y: 0, k: 1, r: 0 } })))).not.toThrow();
  });
  const withItem = (it: unknown) => { const d = newDoc(); d.layers[1].items.push(it as Item); return JSON.parse(JSON.stringify(d)); };
  it('細工した塗り・色・画像・型違いは断る', () => {
    expect(() => validDoc(withItem(tex({ id: { toString: 1 } })))).toThrow(/正しくない/);
    expect(() => validDoc(withItem(tex({ mask: 'https://evil.example/m.png' })))).toThrow(/塗りの範囲/);
    expect(() => validDoc(withItem(tex({ tex: 'javascript:alert(1)' })))).toThrow(/塗りの素材/);
    expect(() => validDoc(withItem({ id: 't', type: 'text', x: 0, y: 0, text: 'a', size: 12, color: EVIL, bg: null, border: null, rot: 0 }))).toThrow(/文字の色/);
    expect(() => validDoc(withItem({ id: 'l', type: 'line', kind: 'line', color: '#000', width: '3"/>', dash: 'solid', pts: [] }))).toThrow(/線の太さ/);
    expect(() => validDoc(withItem({ id: 'x', type: 'script' }))).toThrow(/図形の種類/);
    const d = newDoc(); expect(() => validDoc({ ...JSON.parse(JSON.stringify(d)), underlay: { src: 'javascript:alert(1)', name: 'x', x: 0, y: 0, w: 1, h: 1, opacity: 1, visible: true, locked: true } })).toThrow(/下絵/);
    expect(() => validDoc({ schema: 2 })).toThrow(/v0.3/);
  });
});

import { it, expect } from 'vitest';
import { buildDxf, traceMask, encodeSjis, matLayer } from '../src/v3/dxf';
import { builtinLibrary } from '../src/v3/library';
import { sampleDoc } from '../src/v3/useDoc';
import { newDoc, uid, type Doc, type Item } from '../src/v3/types';

const lib = builtinLibrary();
const withItems = (items: Item[]): Doc => { const d = newDoc(); return { ...d, layers: d.layers.map((l, i) => i === 1 ? { ...l, items } : l) }; };
const line = (pts: [number, number][], extra: Partial<Item & { type: 'line' }> = {}): Item =>
  ({ id: uid(), type: 'line', kind: 'polyline', color: '#000', width: 3, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra }) as Item;
// DXFを (コード, 値) の組に戻す
const pairs = (s: string) => { const a = s.split('\r\n'); const out: [string, string][] = []; for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]); return out; };
const entities = (s: string, type: string) => pairs(s).filter(([c, v]) => c === '0' && v === type).length;

it('R12形式で、区切り・終わりがそろっている', () => {
  const s = buildDxf(sampleDoc(), lib);
  expect(s).toContain('AC1009'); expect(s).toContain('ANSI_932');
  const p = pairs(s);
  expect(p.filter(([c, v]) => c === '0' && v === 'SECTION').length).toBe(p.filter(([c, v]) => c === '0' && v === 'ENDSEC').length);
  expect(p[p.length - 1]).toEqual(['0', 'EOF']);
  expect(entities(s, 'POLYLINE')).toBe(entities(s, 'SEQEND'));
});

it('座標は mm で、図面の下向きは DXF の上向きに反転する', () => {
  const s = buildDxf(withItems([line([[0, 0], [100, 50]])]), lib);
  const p = pairs(s), v = p.flatMap(([c, val], i) => c === '0' && val === 'VERTEX' ? [p.slice(i, i + 5)] : []);
  expect(v[1].find(([c]) => c === '10')![1]).toBe('1000');
  expect(v[1].find(([c]) => c === '20')![1]).toBe('-500');
});

it('線は3Dと同じ判定でレイヤー分けされる', () => {
  const s = buildDxf(withItems([
    line([[0, 0], [600, 0], [600, 500], [0, 500], [0, 0]]),
    line([[0, 600], [300, 600]], { role3: 'fence' }),
    line([[0, 700], [300, 700]], { dash: 'dashed' }),
    line([[0, 800], [300, 800]]),
  ]), lib);
  const layersOfPolys = pairs(s).flatMap(([c, v], i, a) => c === '0' && v === 'POLYLINE' ? [a[i + 1][1]] : []);
  expect(layersOfPolys).toEqual(['建物', 'フェンス', '線_破線', '塀']);
});

it('部品はブロックとして置かれ、名前も文字で入る。ファイルは Shift_JIS で書く', () => {
  const s = buildDxf(sampleDoc(), lib);
  expect(entities(s, 'INSERT')).toBe(4);
  expect(entities(s, 'TEXT')).toBe(4);
  expect(s).toContain('P_AQUA');
  expect(s).toContain('アクア（自動車）');
  expect([...encodeSjis('芝a㎡')]).toEqual([0x8e, 0xc5, 0x61, 0x87, 0x75]);
  expect([...encodeSjis('😀')]).toEqual([0x3f]);
});

it('塗りのマスクから輪郭を取り出せる（四角は4点、穴も別の輪郭になる）', () => {
  const W = 10, H = 8, bits = new Uint8Array(W * H);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 9; x++) bits[y * W + x] = 1;
  const one = traceMask(bits, W, H);
  expect(one).toHaveLength(1); expect(one[0]).toHaveLength(4);
  bits[3 * W + 4] = bits[3 * W + 5] = bits[4 * W + 4] = bits[4 * W + 5] = 0;
  expect(traceMask(bits, W, H)).toHaveLength(2);
});

it('塗りの輪郭は素材ごとのレイヤーに閉じた線で入る', () => {
  const tex: Item = { id: uid(), type: 'texture', name: '芝', mask: '', x: 0, y: 0, w: 100, h: 100, tex: 'b:lawn', texName: '芝生（やわらか）', scale: 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100 };
  const s = buildDxf(withItems([tex]), lib, new Map([[tex.id, [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]]]]));
  expect(matLayer('b:lawn')).toBe('素材_芝生（やわらか）');
  expect(pairs(s).some(([c, v], i, a) => c === '0' && v === 'POLYLINE' && a[i + 1][1] === '素材_芝生（やわらか）')).toBe(true);
});

import { it, expect } from 'vitest';
import { quantities, quantitiesCsv, itemLength } from '../src/v3/quantities';
import { builtinLibrary } from '../src/v3/library';
import { newDoc, uid, type Doc, type Item } from '../src/v3/types';

const lib = builtinLibrary();
const withItems = (items: Item[]): Doc => { const d = newDoc(); return { ...d, layers: d.layers.map((l, i) => i === 1 ? { ...l, items } : l) }; };
const line = (pts: [number, number][], extra: Partial<Item & { type: 'line' }> = {}): Item =>
  ({ id: uid(), type: 'line', kind: 'polyline', color: '#000', width: 3, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra }) as Item;
const obj = (ref: string): Item => { const l = lib.find(v => v.id === ref)!; return { id: uid(), type: 'obj', ref, name: l.name, x: 0, y: 0, w: l.w, h: l.h, rot: 0, flip: false, color: null }; };
const tex = (t: string, name: string): Item => ({ id: uid(), type: 'texture', name, mask: '', x: 0, y: 0, w: 100, h: 100, tex: t, texName: name, scale: 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100 });

it('線は種類ごとに長さ（m）を合計し、自動判定かどうかを区別する', () => {
  const rows = quantities(withItems([
    line([[0, 0], [300, 0], [300, 400]]), // 3m + 4m の塀（自動）
    line([[0, 600], [500, 600]], { role3: 'fence' }),
    line([[0, 700], [200, 700]], { role3: 'fence' }),
    line([[0, 800], [150, 800]], { role3: 'gate' }),
    line([[0, 900], [500, 900]], { dash: 'dashed' }), // 数えない
  ]), lib);
  const by = (n: string) => rows.find(r => r.name === n)!;
  expect(by('塀')).toMatchObject({ qty: 7, unit: 'm', auto: true });
  expect(by('フェンス')).toMatchObject({ qty: 7, unit: 'm', ids: expect.any(Array) });
  expect(by('フェンス').auto).toBeFalsy();
  expect(by('門扉')).toMatchObject({ qty: 1, unit: '箇所' });
  expect(rows.some(r => r.qty === 5)).toBe(false);
});

it('部品は名前ごとに数え、車と人は数えない', () => {
  const rows = quantities(withItems([obj('b-wc-symbol'), obj('b-wc-symbol'), obj('b-carport1'), obj('b-aqua'), obj('b-person1')]), lib);
  expect(rows.map(r => [r.name, r.qty, r.unit])).toEqual([['シンボルツリー（まる）', 2, '本'], ['カーポート 1台用', 1, '基']]);
});

it('素材は名前ごとに面積を合計し、建物は棟で数える', () => {
  const a = tex('b:concrete', '土間コンクリート'), b = tex('b:concrete', '土間コンクリート'), c = tex('b:lawn', '芝生（やわらか）');
  const rows = quantities(withItems([a, b, c, line([[0, 0], [600, 0], [600, 500], [0, 500], [0, 0]])]), lib, new Map([[a.id, 12.34], [b.id, 3], [c.id, 20]]));
  expect(rows.slice(0, 2).map(r => [r.name, r.qty])).toEqual([['芝生（やわらか）', 20], ['土間コンクリート', 15.3]]);
  expect(rows.find(r => r.name === '建物')).toMatchObject({ qty: 1, unit: '棟' });
});

it('図形の周の長さとCSV（Excel向けBOM付き）', () => {
  expect(itemLength({ id: 'r', type: 'shape', shape: 'rect', color: '#000', width: 1, dash: 'solid', x: 0, y: 0, w: 300, h: 200, rot: 0 }, 10)).toBeCloseTo(10);
  const csv = quantitiesCsv([{ key: 'k', group: '線', name: 'フェンス, 目隠し', qty: 7, unit: 'm', ids: [], auto: true }], 'テスト邸');
  expect(csv.startsWith('﻿# テスト邸')).toBe(true);
  expect(csv).toContain('線,"フェンス, 目隠し",7,m,自動判定を含む');
});

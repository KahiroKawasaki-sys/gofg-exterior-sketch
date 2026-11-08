import { it, expect } from 'vitest';
import { joinLines, viewLabels, levels, faceForCrop, levelsForCrop, drawingScale, underlayWidthPx, type TextItem } from '../src/v3/elevLabels';

const T = (str: string, x: number, y: number, w = str.length * 8, h = 10): TextItem => ({ str, x, y, w, h });

it('ばらばらの文字片を行につなげ、面のラベルとレベルを読む', () => {
  const items = [
    T('▽', 20, 100, 8), T(' 最高高', 30, 100, 40), T('(7,807)', 74, 100, 50),
    T('▽ 最高軒高 (5,994)', 20, 200),
    T('▽ 2階FL (3,377)', 20, 300), T('▼GL±0', 20, 420),
    T('東側立面図 S=1/100', 300, 470), T('南側', 900, 470, 20), T('立面図', 921, 470, 30),
  ];
  const lines = joinLines(items);
  expect(lines.find(l => l.str.includes('最高高'))!.str).toBe('▽ 最高高(7,807)');
  const labels = viewLabels(items);
  expect(labels.map(l => l.face)).toEqual(['E', 'S']);
  const lv = levels(items);
  expect(lv.find(l => l.kind === 'ridge')).toMatchObject({ y: 100, mm: 7807 });
  expect(lv.find(l => l.kind === 'eaves')).toMatchObject({ y: 200, mm: 5994 });
  expect(lv.find(l => l.kind === 'gl')).toMatchObject({ y: 420, mm: 0 });
  expect(lv.find(l => l.label.includes('2階FL'))!.kind).toBe('other');
});

it('枠ごとに面とレベルを割り当て、GLと最高高から1pxの実寸を出す', () => {
  const items = [T('▽ 最高高 (7,807)', 20, 100), T('▼GL±0', 20, 420), T('東側立面図', 300, 470), T('北側立面図', 900, 470)];
  const crop = { x: 10, y: 60, w: 500, h: 380 };
  expect(faceForCrop(crop, viewLabels(items))).toBe('E');
  expect(faceForCrop({ x: 700, y: 60, w: 400, h: 380 }, viewLabels(items))).toBe('N');
  expect(faceForCrop({ x: 10, y: 1000, w: 400, h: 300 }, viewLabels(items))).toBeUndefined();
  const lv = levelsForCrop(crop, levels(items));
  expect(lv.mmPerPx).toBeCloseTo(7807 / 320, 3);
  expect(lv.ridge?.y).toBe(100); expect(lv.gl?.y).toBe(420);
});

it('図面の縮尺：「配置図 S=1/150」を優先し、無ければ多い方。用紙と合わせて下絵の実寸(px)にする', () => {
  expect(drawingScale([T('配置図 S=1/150', 300, 500), T('図 名： 配置図', 400, 700), T('S=1/100', 500, 700)])).toBe(150);
  expect(drawingScale([T('S=1/100', 1, 1), T('S=1/100', 1, 2), T('S=1/200', 1, 3)])).toBe(100);
  expect(drawingScale([T('東側立面図 S＝1／100', 1, 1)])).toBe(100);
  expect(drawingScale([T('合計 1/2', 1, 1)])).toBeUndefined();
  // A3横（3072px）を 1/150 で、図面の 1px=10mm → 420mm×150/10 = 6300px
  expect(underlayWidthPx(3072, 2172, [T('配置図 S=1/150', 1, 1)], 10)).toEqual({ w: 6300, denom: 150, paper: 'A3横' });
  expect(underlayWidthPx(3072, 2172, undefined, 10)).toEqual({ w: 1200 });
});

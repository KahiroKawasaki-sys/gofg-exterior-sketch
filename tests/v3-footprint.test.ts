import { it, expect } from 'vitest';
import { locateFootprint, dilate } from '../src/v3/footprint';

const canvas = (W: number, H: number) => new Uint8Array(W * H);
const rect = (m: Uint8Array, W: number, x: number, y: number, w: number, h: number) => {
  for (let i = 0; i < w; i++) { m[y * W + x + i] = 1; m[(y + h - 1) * W + x + i] = 1; }
  for (let j = 0; j < h; j++) { m[(y + j) * W + x] = 1; m[(y + j) * W + x + w - 1] = 1; }
};

it('配置図の中で、建物の大きさの四角がいちばん重なる場所を見つける（向きが逆でも）', () => {
  const W = 300, H = 220, m = canvas(W, H);
  rect(m, W, 10, 10, 280, 200);       // 敷地の枠
  rect(m, W, 120, 60, 80, 110);       // 建物（幅80 × 奥行110）
  for (let x = 0; x < W; x++) m[150 * W + x] = 1; // 横切る線（道路境界）
  const f = locateFootprint(m, W, H, 80, 110)!;
  expect(f).not.toBeNull();
  expect(Math.abs(f.x - 120)).toBeLessThanOrEqual(2); expect(Math.abs(f.y - 60)).toBeLessThanOrEqual(2);
  expect(f.w).toBe(80); expect(f.h).toBe(110); expect(f.score).toBeGreaterThan(0.9);
  // 幅と奥行きを逆に渡しても、回して見つける
  const g = locateFootprint(m, W, H, 110, 80)!;
  expect(g.w).toBe(80); expect(g.h).toBe(110); expect(Math.abs(g.x - 120)).toBeLessThanOrEqual(2);
});

it('何も無ければ点数が低い。膨らませると隣の画素も1になる', () => {
  const W = 100, H = 100, m = canvas(W, H);
  const f = locateFootprint(m, W, H, 30, 40)!;
  expect(f.score).toBe(0);
  m[50 * W + 50] = 1;
  const d = dilate(m, W, H, 1);
  expect(d[49 * W + 49]).toBe(1); expect(d[52 * W + 52]).toBe(0);
});

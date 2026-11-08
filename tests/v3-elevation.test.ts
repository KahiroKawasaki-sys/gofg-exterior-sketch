import { it, expect } from 'vitest';
import { edgeFace, isClockwise, faceU, polyBBox, buildingHeight, quadrants, darkBounds, wallTopRatio, whiteToAlpha, guessPaper, mmPerPxFromPaper } from '../src/v3/elevation';

const img = (w: number, h: number, paint: (x: number, y: number) => number | null): ImageData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = paint(x, y); const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v ?? 255; data[i + 3] = 255; }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
};

it('建物の辺を外向きの法線で東西南北に振り分ける（時計回り・反時計回りどちらでも）', () => {
  const cw = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }]; // 画面座標で時計回り
  expect(isClockwise(cw)).toBe(true);
  const faces = cw.map((a, i) => edgeFace(a, cw[(i + 1) % 4], true));
  expect(faces).toEqual(['N', 'E', 'S', 'W']);
  const ccw = [...cw].reverse();
  expect(isClockwise(ccw)).toBe(false);
  expect(ccw.map((a, i) => edgeFace(a, ccw[(i + 1) % 4], false))).toEqual(['S', 'E', 'N', 'W']);
});

it('立面図の横位置：北面は左が東、南面は左が西、東面は左が北、西面は左が南', () => {
  const bb = polyBBox([{ x: 0, z: 0 }, { x: 10, z: 8 }]);
  expect(faceU('N', { x: 10, z: 0 }, bb)).toBe(0); expect(faceU('N', { x: 0, z: 0 }, bb)).toBe(1);
  expect(faceU('S', { x: 0, z: 8 }, bb)).toBe(0); expect(faceU('S', { x: 10, z: 8 }, bb)).toBe(1);
  expect(faceU('E', { x: 10, z: 0 }, bb)).toBe(0); expect(faceU('E', { x: 10, z: 8 }, bb)).toBe(1);
  expect(faceU('W', { x: 0, z: 8 }, bb)).toBe(0); expect(faceU('W', { x: 0, z: 0 }, bb)).toBe(1);
});

it('建物の高さは一番高い立面図から。壁の上端は屋根の下', () => {
  expect(buildingHeight({})).toBeNull();
  const r = buildingHeight({ S: { src: '', w: 400, h: 240, mmPerPx: 25, wallTop: 0.4 }, E: { src: '', w: 300, h: 200, mmPerPx: 25, wallTop: 0.3 } })!;
  expect(r.h).toBeCloseTo(6.0); // 240px × 25mm
  expect(r.wallTop).toBeCloseTo(6.0 - 2.4); // 上から4割が屋根
  expect(buildingHeight({ S: { src: '', w: 400, h: 240, mmPerPx: 25 } }, 1.1)!.h).toBeCloseTo(6.6);
});

it('用紙を4等分し、濃い部分の範囲に縮める。壁の上端は横幅の6割が描かれた最初の行', () => {
  const q = quadrants(1000, 700);
  expect(q).toHaveLength(4); expect(q[0].x).toBeLessThan(q[1].x); expect(q[2].y).toBeGreaterThan(q[0].y);
  // 左上の区画に 100..200 × 50..150 の四角（暗い）
  const data = img(1000, 700, (x, y) => (x >= 100 && x <= 200 && y >= 50 && y <= 150) ? 30 : null);
  const b = darkBounds(data, q[0])!;
  expect(b.x).toBeLessThanOrEqual(100); expect(b.x + b.w).toBeGreaterThanOrEqual(201); expect(b.y).toBeLessThanOrEqual(50);
  expect(darkBounds(data, q[3])).toBeNull();
  // 屋根：上1/4は中央の細い三角、下は全幅
  const roof = img(100, 100, (x, y) => y < 25 ? (Math.abs(x - 50) < y ? 30 : null) : 30);
  whiteToAlpha(roof);
  expect(wallTopRatio(roof)).toBeCloseTo(0.25, 1);
});

it('白は透明、薄い灰色は半透明、線はそのまま', () => {
  const d = img(3, 1, x => [255, 230, 40][x]);
  whiteToAlpha(d);
  expect(d.data[3]).toBe(0); expect(d.data[7]).toBeGreaterThan(0); expect(d.data[7]).toBeLessThan(255); expect(d.data[11]).toBe(255);
});

it('用紙の見当と 1px あたりの実寸', () => {
  expect(guessPaper(1191, 842).name).toBe('A3横');
  expect(guessPaper(842, 1191).name).toBe('A3縦');
  // A3横 420mm を 3072px に描いた 1/100 → 1px = 13.67mm
  expect(mmPerPxFromPaper(420, 3072, 100)).toBeCloseTo(13.67, 2);
});

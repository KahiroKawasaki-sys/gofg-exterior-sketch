import { it, expect } from 'vitest';
import { roofPeak, edgeFace, isClockwise, faceU, faceAxis, polyBBox, buildingHeight, roofFace, quadrants, darkBounds, wallTopRatio, whiteToAlpha, guessPaper, mmPerPxFromPaper, findBody, simplifyRoof, eraseLevelLines, largestComponent, detectWindows, tintLines } from '../src/v3/elevation';

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

it('立面図の横位置：北から見ると左が東、南からは左が西、東からは左が南、西からは左が北', () => {
  const bb = polyBBox([{ x: 0, z: 0 }, { x: 10, z: 8 }]);
  expect(faceU('N', { x: 10, z: 0 }, bb)).toBe(0); expect(faceU('N', { x: 0, z: 0 }, bb)).toBe(1);
  expect(faceU('S', { x: 0, z: 8 }, bb)).toBe(0); expect(faceU('S', { x: 10, z: 8 }, bb)).toBe(1);
  expect(faceU('E', { x: 10, z: 8 }, bb)).toBe(0); expect(faceU('E', { x: 10, z: 0 }, bb)).toBe(1);
  expect(faceU('W', { x: 0, z: 0 }, bb)).toBe(0); expect(faceU('W', { x: 0, z: 8 }, bb)).toBe(1);
  for (const f of ['N', 'S', 'E', 'W'] as const) for (const u of [0, 0.3, 1]) { const v = faceAxis(f, u, bb); const p = f === 'N' || f === 'S' ? { x: v, z: 0 } : { x: 0, z: v }; expect(faceU(f, p, bb)).toBeCloseTo(u); }
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

it('建物の本体を見つける：地面の線で幅、上端の輪郭で屋根。左の寸法線と下の表題は外れる', () => {
  const W = 400, H = 300;
  // 家：壁 x 100..300、地面 y=220、軒 y=140、棟 y=80（三角屋根は 90..310 に軒の出）
  // 寸法線：x=30 に縦線（y 60..230）と y=80 の引き出し線（x 30..100）、表題：y=260 の短い線
  const d = img(W, H, (x, y) => {
    const wall = (x === 100 || x === 300) && y >= 128 && y <= 220; // 壁は屋根の線につながる
    const groundLine = y === 220 && x >= 95 && x <= 305;
    const roofL = x >= 90 && x <= 200 && Math.abs(y - (140 - (x - 90) * 60 / 110)) < 1.2;
    const roofR = x > 200 && x <= 310 && Math.abs(y - (80 + (x - 200) * 60 / 110)) < 1.2;
    const dimV = x === 30 && y >= 60 && y <= 230, dimH = y === 80 && x >= 30 && x <= 100;
    const level = y === 140 && x >= 20 && x <= 380; // ▽軒高のレベル線（全幅）
    const title = y === 260 && x >= 150 && x <= 250, box = y === 262 && x >= 150 && x <= 250;
    return wall || groundLine || roofL || roofR || dimV || dimH || title || box || level ? 30 : null;
  });
  whiteToAlpha(d);
  const b = findBody(d)!;
  expect(b).not.toBeNull();
  expect(b.ground).toBe(220);
  expect(b.rect.x).toBeGreaterThanOrEqual(85); expect(b.rect.x).toBeLessThanOrEqual(101); // 軒の出〜壁まで。寸法線 x=30 は入らない
  expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(316);
  expect(b.rect.y).toBeLessThanOrEqual(80); expect(b.rect.y + b.rect.h).toBeLessThan(255); // 表題は入らない
  // 壁の横範囲（基礎 95..305）
  expect(b.wallU[0]).toBeCloseTo((95 - b.rect.x) / b.rect.w, 1); expect(b.wallU[1]).toBeCloseTo((305 - b.rect.x) / b.rect.w, 1);
  // 軒は上から約 (140-y0)/h、棟は頂点
  expect(b.eaves).toBeGreaterThan(0.3); expect(b.eaves).toBeLessThan(0.5);
  const ys = b.roof.map(p => p.y); expect(Math.max(...ys)).toBeGreaterThan(0.9); expect(b.roof.length).toBeLessThanOrEqual(12);
  expect(roofFace({ E: { src: '', w: 1, h: 1, mmPerPx: 1, roof: b.roof }, S: { src: '', w: 1, h: 1, mmPerPx: 1, roof: [{ x: 0, y: 0.6 }, { x: 1, y: 0.6 }] } })).toBe('E');
  expect(simplifyRoof([{ x: 0, y: 0 }, { x: 0.5, y: 0.001 }, { x: 1, y: 0 }], 0.01)).toHaveLength(2);
  // 平側で軒の出の端だけ下がる帯（太陽光パネルの網掛けなど）は山ではない。妻側の三角が勝つ（滝本様②）
  const band = [{ x: 0, y: 0.6 }, { x: 0.03, y: 0.85 }, { x: 0.97, y: 0.85 }, { x: 1, y: 0.6 }];
  const gable = [{ x: 0, y: 0.6 }, { x: 0.5, y: 0.85 }, { x: 1, y: 0.6 }];
  expect(roofPeak(band)).toBeLessThan(0.04); expect(roofPeak(gable)).toBeGreaterThan(0.1);
  expect(roofFace({ S: { src: '', w: 1, h: 1, mmPerPx: 1, roof: band }, E: { src: '', w: 1, h: 1, mmPerPx: 1, roof: gable } })).toBe('E');
  expect(roofFace({ S: { src: '', w: 1, h: 1, mmPerPx: 1, roof: band } })).toBeNull(); // 平側しか無ければ陸屋根
  // 何も描かれていない絵は null
  const blank = img(100, 100, () => null); whiteToAlpha(blank); expect(findBody(blank)).toBeNull();
});

it('レベル線（細くて長い横線）は消え、壁と交わる所は残る。いちばん大きな塊が選ばれる', () => {
  const W = 200, H = 100;
  const d = img(W, H, (x, y) => (y === 50 && x >= 5 && x <= 195) || (x === 100 && y >= 30 && y <= 70) || (x >= 20 && x <= 24 && y >= 20 && y <= 24) ? 30 : null);
  whiteToAlpha(d);
  const mask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (d.data[i * 4 + 3] > 40) mask[i] = 1;
  eraseLevelLines(mask, W, H);
  expect(mask[50 * W + 10]).toBe(0); expect(mask[50 * W + 100]).toBe(1); expect(mask[40 * W + 100]).toBe(1);
  const c = largestComponent(mask, W, H)!;
  expect(c.count).toBe(41); expect(c.pick[40 * W + 100]).toBe(1); expect(c.pick[22 * W + 22]).toBe(0);
});

it('窓：壁の中で線に囲まれた穴を窓とし、格子で分かれたガラスは1つにまとめる。壁全体や細い隙間は窓にしない', () => {
  const W = 300, H = 200;
  // 壁 x 20..280、軒 y=40、GL y=180。窓A: 60..120 × 80..130（中桟 x=90）、窓B: 180..230 × 70..140
  const d = img(W, H, (x, y) => {
    const wall = (x === 20 || x === 280) && y >= 40 && y <= 180, top = y === 40 && x >= 20 && x <= 280, gl = y === 180 && x >= 20 && x <= 280;
    const a = ((x === 60 || x === 120 || x === 90) && y >= 80 && y <= 130) || ((y === 80 || y === 130) && x >= 60 && x <= 120);
    const b = ((x === 180 || x === 230) && y >= 70 && y <= 140) || ((y === 70 || y === 140) && x >= 180 && x <= 230);
    return wall || top || gl || a || b ? 30 : null;
  });
  whiteToAlpha(d);
  const rect = { x: 0, y: 0, w: W, h: H };
  const wins = detectWindows(d, rect, { eaves: 40, gl: 180 }, [20, 280]);
  expect(wins).toHaveLength(2);
  const A = wins.find(w => w.x < 0.5)!, B = wins.find(w => w.x > 0.5)!;
  expect(Math.abs(A.x * W - 58)).toBeLessThanOrEqual(2); expect(Math.abs((A.x + A.w) * W - 123)).toBeLessThanOrEqual(2); expect(Math.abs(A.y * H - 78)).toBeLessThanOrEqual(2);
  expect(Math.abs(B.w * W - 55)).toBeLessThanOrEqual(3); expect(Math.abs(B.h * H - 75)).toBeLessThanOrEqual(3);
  tintLines(d, [10, 20, 30]);
  expect(Array.from(d.data.slice((40 * W + 100) * 4, (40 * W + 100) * 4 + 3))).toEqual([10, 20, 30]);
});

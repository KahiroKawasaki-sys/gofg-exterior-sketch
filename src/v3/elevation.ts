// 立面図：1枚の用紙（東・南・西・北の4面）を切り出して、3Dの建物の各面に貼る。
// 純粋な計算（面の割り当て・貼り方）と、画像の処理（切り出し・白抜き）を分けている。
import { type Elevation, type ElevFace } from './types';
import { type P2 } from './scene3d';

export const FACES: ElevFace[] = ['E', 'S', 'W', 'N'];
export const FACE_LABEL: Record<ElevFace, string> = { N: '北側', E: '東側', S: '南側', W: '西側' };
// 用紙の並び（左上→右上→左下→右下）。配置図の建築士事務所の立面図はこの順で並ぶことが多い
export const DEFAULT_ORDER: ElevFace[] = ['E', 'S', 'W', 'N'];

export type Rect = { x: number; y: number; w: number; h: number };
export type Crop = { face: ElevFace; rect: Rect };

// 辺の外向きの法線から、その辺がどの面か決める（図面は y 下向き＝南。z=y なので -z が北）
// winding: 多角形の符号付き面積（+なら時計回り＝画面座標で外向きは左手側）
export function edgeFace(a: P2, b: P2, cw: boolean): ElevFace {
  const dx = b.x - a.x, dz = b.z - a.z;
  // 画面座標（y 下向き）で、時計回りの多角形は外側が進行方向の左手（-dz, dx）→ 反時計回りなら右手
  const nx = cw ? dz : -dz, nz = cw ? -dx : dx;
  if (Math.abs(nx) >= Math.abs(nz)) return nx > 0 ? 'E' : 'W';
  return nz > 0 ? 'S' : 'N';
}

// 画面座標（y 下向き）で見た時計回りか（符号付き面積の符号が y 上向きの座標系と逆になる）
export const isClockwise = (poly: P2[]) => poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + (b.x - a.x) * (b.z + a.z); }, 0) < 0;

// 辺の両端を、その面の立面図の横位置（0..1）にする。立面図は外から見た絵なので左右の向きを合わせる
// 北面は外（北）から見ると左が東、南面は左が西、東面は左が北、西面は左が南
export function faceU(face: ElevFace, p: P2, bbox: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const W = Math.max(1e-6, bbox.maxX - bbox.minX), D = Math.max(1e-6, bbox.maxZ - bbox.minZ);
  switch (face) {
    case 'N': return (bbox.maxX - p.x) / W;
    case 'S': return (p.x - bbox.minX) / W;
    case 'E': return (p.z - bbox.minZ) / D;
    case 'W': return (bbox.maxZ - p.z) / D;
  }
}

export const polyBBox = (poly: P2[]) => ({ minX: Math.min(...poly.map(p => p.x)), maxX: Math.max(...poly.map(p => p.x)), minZ: Math.min(...poly.map(p => p.z)), maxZ: Math.max(...poly.map(p => p.z)) });

// 立面図があるときの建物の高さ（m）と、壁の上端（屋根の下）の高さ（m）
export function buildingHeight(elev: Partial<Record<ElevFace, Elevation>>, scale = 1): { h: number; wallTop: number } | null {
  const list = Object.values(elev).filter((e): e is Elevation => !!e);
  if (!list.length) return null;
  const h = Math.max(...list.map(e => e.h * e.mmPerPx)) / 1000 * scale;
  const tops = list.map(e => (e.wallTop ?? 0.3) * e.h * e.mmPerPx / 1000 * scale);
  return { h, wallTop: Math.min(h, Math.max(0.5, h - Math.max(...tops))) };
}

// ---- 画像の処理（ブラウザだけ） ----

// 用紙を4等分し、それぞれの中の「濃い部分」の範囲に縮める（下の表題欄ぶんは外す）
export function quadrants(w: number, h: number, inset = 0.03, bottomInset = 0.1): Rect[] {
  const ix = w * inset, iy = h * inset;
  const qw = (w - ix * 2) / 2, qh = (h - iy - h * bottomInset) / 2;
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => ({ x: ix + cx * qw, y: iy + cy * qh, w: qw, h: qh }));
}

// 濃い画素の範囲（枠線・タイトル欄のような画像の端に接する線は無視するため、端から少し内側だけ見る）
export function darkBounds(data: ImageData, r: Rect, threshold = 200): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(data.width, Math.ceil(r.x + r.w)), y1 = Math.min(data.height, Math.ceil(r.y + r.h));
  let minX = x1, minY = y1, maxX = x0, maxY = y0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * data.width + x) * 4;
    if (data.data[i + 3] > 40 && (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3 < threshold) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (n < 50) return null;
  const pad = Math.max(2, Math.round(Math.min(maxX - minX, maxY - minY) * 0.02));
  return { x: Math.max(x0, minX - pad), y: Math.max(y0, minY - pad), w: Math.min(x1, maxX + pad) - Math.max(x0, minX - pad), h: Math.min(y1, maxY + pad) - Math.max(y0, minY - pad) };
}

// 壁の上端の位置（上から 0..1）。中央の帯（横 15〜85%）で、描かれている幅が6割以上あり、そのすぐ下も幅が続く最初の行。
// 寸法線や引き出し線（細い1〜2行）には反応せず、屋根の面〜軒の高さで止まる
export function wallTopRatio(data: ImageData, minCover = 0.6): number {
  const W = data.width, H = data.height;
  const x0 = Math.floor(W * 0.15), x1 = Math.ceil(W * 0.85), band = Math.max(1, x1 - x0);
  const span = (y: number) => {
    let first = -1, last = -1;
    for (let x = x0; x < x1; x++) if (data.data[(y * W + x) * 4 + 3] > 40) { if (first < 0) first = x; last = x; }
    return first < 0 ? 0 : (last - first) / band;
  };
  const spans = Array.from({ length: H }, (_, y) => span(y));
  const look = Math.max(3, Math.round(H * 0.06));
  for (let y = 0; y < H - look; y++) {
    if (spans[y] < minCover) continue;
    let ok = 0;
    for (let k = 1; k <= look; k++) if (spans[y + k] >= minCover * 0.8) ok++;
    if (ok / look >= 0.7) return y / H;
  }
  return 0;
}

export type PaperGuess = { name: string; widthMm: number; heightMm: number };
// 用紙サイズの見当（縦横比から A3/A4 の横・縦）。合わなければ A3 横
export function guessPaper(w: number, h: number): PaperGuess {
  const r = w / h;
  if (Math.abs(r - 1.414) < 0.08) return w >= 2400 || r > 1 ? { name: 'A3横', widthMm: 420, heightMm: 297 } : { name: 'A3横', widthMm: 420, heightMm: 297 };
  if (Math.abs(r - 0.707) < 0.08) return { name: 'A3縦', widthMm: 297, heightMm: 420 };
  return { name: 'A3横', widthMm: 420, heightMm: 297 };
}

// 1px が何 mm（実寸）か：用紙の幅(mm) ÷ 画像の幅(px) × 縮尺の分母
export const mmPerPxFromPaper = (paperWidthMm: number, imageWidthPx: number, denominator: number) => paperWidthMm / imageWidthPx * denominator;

// 切り出して白を透明にする（PNG dataURL）。長辺 maxPx まで
export function cropToElevation(img: CanvasImageSource & { width: number; height: number }, crop: Rect, mmPerPx: number, maxPx = 1200): Elevation {
  const k = Math.min(1, maxPx / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * k)), h = Math.max(1, Math.round(crop.h * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  whiteToAlpha(data);
  g.putImageData(data, 0, 0);
  const wallTop = wallTopRatio(data);
  const out = { src: c.toDataURL('image/png'), w, h, mmPerPx: mmPerPx / k, wallTop };
  c.width = c.height = 0;
  return out;
}

// 白〜薄い灰色を透明に。線の縁は半透明にして滑らかに
export function whiteToAlpha(data: ImageData, lo = 215, hi = 248) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v >= hi) d[i + 3] = 0;
    else if (v > lo) d[i + 3] = Math.round(d[i + 3] * (hi - v) / (hi - lo));
  }
}

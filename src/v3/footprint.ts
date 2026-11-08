// 建物の位置合わせ：立面図から分かった建物の大きさ（幅×奥行き）の四角を、配置図（下絵）の中で
// 線がいちばんよく重なる場所に置く。計算は純粋（テスト可）、画像の読み込みだけブラウザ
import { type Underlay } from './types';

export type Found = { x: number; y: number; w: number; h: number; score: number };

// mask：濃い画素=1（W×H）。bw/bd：建物の幅・奥行き（mask の px）。横長・縦長の両方を試す
export function locateFootprint(mask: Uint8Array, W: number, H: number, bw: number, bd: number, step = 0): Found | null {
  const dil = dilate(mask, W, H, 2);
  const s = step || Math.max(2, Math.round(Math.min(bw, bd) / 24));
  let best: Found | null = null;
  const trySize = (w: number, h: number, x0: number, x1: number, y0: number, y1: number, st: number) => {
    const W2 = Math.round(w), H2 = Math.round(h);
    if (W2 < 8 || H2 < 8 || W2 > W || H2 > H) return;
    const per = perimeter(W2, H2, Math.max(2, Math.round(Math.min(W2, H2) / 40)));
    for (let y = Math.max(0, y0); y <= Math.min(H - H2, y1); y += st) for (let x = Math.max(0, x0); x <= Math.min(W - W2, x1); x += st) {
      let hit = 0;
      for (let i = 0; i < per.length; i += 2) { const px = x + per[i], py = y + per[i + 1]; if (dil[py * W + px]) hit++; }
      const score = hit / (per.length / 2);
      if (!best || score > best.score) best = { x, y, w: W2, h: H2, score };
    }
  };
  for (const [w, h] of [[bw, bd], [bd, bw]]) trySize(w, h, 0, W, 0, H, s);
  if (!best) return null;
  // 粗い探索のあと、周りを 1px 刻みで詰める
  const b: Found = best;
  trySize(b.w, b.h, b.x - s, b.x + s, b.y - s, b.y + s, 1);
  return best;
}

// 四角の外周の点（相対座標）を間引いて並べる
function perimeter(w: number, h: number, gap: number): Int32Array {
  const pts: number[] = [];
  for (let x = 0; x < w; x += gap) { pts.push(x, 0, x, h - 1); }
  for (let y = gap; y < h - 1; y += gap) { pts.push(0, y, w - 1, y); }
  return Int32Array.from(pts);
}

export function dilate(src: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!src[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = y + dy, xx = x + dx; if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = 1; }
  }
  return out;
}

// 下絵の絵を読んで、建物（幅 wM × 奥行き dM メートル）の四角を探す。見つかれば図面の座標（px）で返す
export async function findFootprintOnUnderlay(u: Underlay, wM: number, dM: number, mmPerPx: number, maxPx = 1024): Promise<Found | null> {
  const img = new Image(); img.src = u.src;
  await img.decode();
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 40 && (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < 170) mask[i] = 1;
  c.width = c.height = 0;
  // 図面px → 絵px：下絵の幅 u.w（図面px）が W（絵px）
  const toImg = W / u.w, toDoc = u.w / W;
  const bw = wM * 1000 / mmPerPx * toImg, bd = dM * 1000 / mmPerPx * toImg;
  const f = locateFootprint(mask, W, H, bw, bd);
  if (!f || f.score < 0.55) return null;
  return { x: u.x + f.x * toDoc, y: u.y + f.y * toDoc, w: f.w * toDoc, h: f.h * toDoc, score: f.score };
}

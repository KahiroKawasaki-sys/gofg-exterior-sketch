// 3Dの地面：配置図（下絵）から「敷地の図」だけを残す。文字・表題欄・求積図・用紙の枠は消し、線は薄いグレーにする
import { type Underlay } from './types';
import { components } from './elevation';

export type SiteGround = { src: string; box: { x: number; y: number; w: number; h: number } }; // box は図面の座標（px）
const cache = new Map<string, Promise<SiteGround | null>>();

// around：建物のある範囲（図面px）。その範囲に重なる大きな線画を「敷地の図」とみなす
export function siteGround(u: Underlay, around: { x: number; y: number; w: number; h: number }): Promise<SiteGround | null> {
  const key = u.src.slice(0, 64) + ':' + u.src.length + ':' + [around.x, around.y, around.w, around.h].map(v => Math.round(v)).join(',');
  let p = cache.get(key);
  if (!p) { p = compute(u, around).catch(() => null); cache.set(key, p); if (cache.size > 6) cache.delete(cache.keys().next().value!); }
  return p;
}

async function compute(u: Underlay, around: { x: number; y: number; w: number; h: number }): Promise<SiteGround | null> {
  const img = new Image(); img.src = u.src; await img.decode();
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 40 && (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < 180) mask[i] = 1;
  // 絵の座標 ↔ 図面の座標
  const sx = W / u.w, sy = H / u.h;
  const ax0 = (around.x - u.x) * sx, ay0 = (around.y - u.y) * sy, ax1 = ax0 + around.w * sx, ay1 = ay0 + around.h * sy;
  const comps = components(mask, W, H, 40);
  if (!comps.length) return null;
  const overlaps = (cc: { x0: number; x1: number; y0: number; y1: number }) => cc.x1 >= ax0 && cc.x0 <= ax1 && cc.y1 >= ay0 && cc.y0 <= ay1;
  // 建物に重なる線画のうちいちばん大きいもの＝敷地の図。その範囲に重なる大きめの線画も足す（境界線・道路・寸法線）
  const main = comps.filter(overlaps).sort((a, b) => b.count - a.count)[0] || comps[0];
  const minCount = Math.max(60, W * H * 0.0004);
  let bx0 = main.x0, by0 = main.y0, bx1 = main.x1, by1 = main.y1;
  const keep = comps.filter(cc => cc === main || (cc.count >= minCount && cc.x1 >= bx0 && cc.x0 <= bx1 && cc.y1 >= by0 && cc.y0 <= by1));
  for (const cc of keep) { bx0 = Math.min(bx0, cc.x0); by0 = Math.min(by0, cc.y0); bx1 = Math.max(bx1, cc.x1); by1 = Math.max(by1, cc.y1); }
  // 残す線を薄いグレーで描く
  const out = g.createImageData(W, H);
  for (const cc of keep) for (let i = 0; i < W * H; i++) if (cc.pick[i]) { out.data[i * 4] = 118; out.data[i * 4 + 1] = 120; out.data[i * 4 + 2] = 118; out.data[i * 4 + 3] = 170; }
  g.putImageData(out, 0, 0);
  const src = c.toDataURL('image/png');
  c.width = c.height = 0;
  const pad = Math.max(bx1 - bx0, by1 - by0) * 0.04;
  return { src, box: { x: u.x + (bx0 - pad) / sx, y: u.y + (by0 - pad) / sy, w: (bx1 - bx0 + pad * 2) / sx, h: (by1 - by0 + pad * 2) / sy } };
}

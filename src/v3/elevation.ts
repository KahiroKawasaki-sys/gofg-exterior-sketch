// 立面図：1枚の用紙（東・南・西・北の4面）を切り出して、3Dの建物の各面に貼る。
// 純粋な計算（面の割り当て・貼り方・建物本体の見つけ方）と、画像の処理（切り出し・白抜き）を分けている。
import { type Elevation, type ElevFace, type RoofPt, type WinRect } from './types';
import { type P2 } from './scene3d';

export const FACES: ElevFace[] = ['E', 'S', 'W', 'N'];
export const FACE_LABEL: Record<ElevFace, string> = { N: '北側', E: '東側', S: '南側', W: '西側' };
// 用紙の並び（左上→右上→左下→右下）。配置図の建築士事務所の立面図はこの順で並ぶことが多い
export const DEFAULT_ORDER: ElevFace[] = ['E', 'S', 'W', 'N'];

export type Rect = { x: number; y: number; w: number; h: number };
export type Crop = { face: ElevFace; rect: Rect };

// 辺の外向きの法線から、その辺がどの面か決める（図面は y 下向き＝南。z=y なので -z が北）
export function edgeFace(a: P2, b: P2, cw: boolean): ElevFace {
  const dx = b.x - a.x, dz = b.z - a.z;
  // 画面座標（y 下向き）で、時計回りの多角形は外側が進行方向の右手（dz, -dx）
  const nx = cw ? dz : -dz, nz = cw ? -dx : dx;
  if (Math.abs(nx) >= Math.abs(nz)) return nx > 0 ? 'E' : 'W';
  return nz > 0 ? 'S' : 'N';
}

// 画面座標（y 下向き）で見た時計回りか（符号付き面積の符号が y 上向きの座標系と逆になる）
export const isClockwise = (poly: P2[]) => poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + (b.x - a.x) * (b.z + a.z); }, 0) < 0;

// 辺の両端を、その面の立面図の横位置（0..1）にする。立面図は外から見た絵なので左右の向きを合わせる。
// 北から見ると左が東、南から見ると左が西、東から見る（西向き）と左が南、西から見る（東向き）と左が北
export function faceU(face: ElevFace, p: P2, bbox: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const W = Math.max(1e-6, bbox.maxX - bbox.minX), D = Math.max(1e-6, bbox.maxZ - bbox.minZ);
  switch (face) {
    case 'N': return (bbox.maxX - p.x) / W;
    case 'S': return (p.x - bbox.minX) / W;
    case 'E': return (bbox.maxZ - p.z) / D;
    case 'W': return (p.z - bbox.minZ) / D;
  }
}
// faceU の逆：絵の横位置 u（0..1）を、その面の軸（東西面は z、南北面は x）の座標にする
export function faceAxis(face: ElevFace, u: number, bbox: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  switch (face) {
    case 'N': return bbox.maxX - u * (bbox.maxX - bbox.minX);
    case 'S': return bbox.minX + u * (bbox.maxX - bbox.minX);
    case 'E': return bbox.maxZ - u * (bbox.maxZ - bbox.minZ);
    case 'W': return bbox.minZ + u * (bbox.maxZ - bbox.minZ);
  }
}

export const polyBBox = (poly: P2[]) => ({ minX: Math.min(...poly.map(p => p.x)), maxX: Math.max(...poly.map(p => p.x)), minZ: Math.min(...poly.map(p => p.z)), maxZ: Math.max(...poly.map(p => p.z)) });

// 立面図があるときの建物の高さ（m）と、壁の上端（軒。屋根の下）の高さ（m）
export function buildingHeight(elev: Partial<Record<ElevFace, Elevation>>, scale = 1): { h: number; wallTop: number } | null {
  const list = Object.values(elev).filter((e): e is Elevation => !!e);
  if (!list.length) return null;
  const h = Math.max(...list.map(e => e.h * e.mmPerPx)) / 1000 * scale;
  const tops = list.map(e => (e.wallTop ?? 0.3) * e.h * e.mmPerPx / 1000 * scale);
  return { h, wallTop: Math.min(h, Math.max(0.5, h - Math.max(...tops))) };
}

// 屋根の断面に使う面：軒と棟の差が一番大きい面（妻側）。無ければ null
export function roofFace(elev: Partial<Record<ElevFace, Elevation>>): ElevFace | null {
  // 「山」の高さ＝輪郭の最高点と両端の平均の差。平側（屋根の帯が平らに見える面）はほぼ0、妻側は大きい
  let best: ElevFace | null = null, peak = 0.04;
  for (const f of FACES) {
    const e = elev[f]; if (!e?.roof?.length) continue;
    const ys = e.roof.map(p => p.y), s = Math.max(...ys) - (ys[0] + ys[ys.length - 1]) / 2;
    if (s > peak) { peak = s; best = f; }
  }
  return best;
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

const opaque = (d: ImageData, x: number, y: number) => d.data[(y * d.width + x) * 4 + 3] > 40;

export type Body = { rect: Rect; ground: number; wallU: [number, number]; roof: RoofPt[]; eaves: number; ridge: number; windows?: WinRect[] };

// 細くて長い横線（▽最高高・GL などのレベル線、寸法線）を消す。壁や屋根の線と交わる所（太い所）は残す。
// keep を渡すと、その横範囲（建物の壁の中）は消さず、外にはみ出した部分だけ消す
export function eraseLevelLines(mask: Uint8Array, W: number, H: number, minLen = 0.35, maxThick = 3, keep?: [number, number]) {
  const thick = (x: number, y: number) => { let n = 1; for (let k = 1; k <= maxThick && y - k >= 0 && mask[(y - k) * W + x]; k++) n++; for (let k = 1; k <= maxThick && y + k < H && mask[(y + k) * W + x]; k++) n++; return n; };
  const outside = (x: number) => !keep || x < keep[0] || x > keep[1];
  for (let y = 0; y < H; y++) {
    let start = -1, last = -1;
    const flush = () => {
      if (start >= 0 && last - start + 1 >= W * minLen) {
        let thin = 0, n = 0;
        for (let x = start; x <= last; x++) if (mask[y * W + x]) { n++; if (thick(x, y) <= maxThick) thin++; }
        if (n && thin / n >= 0.6) for (let x = start; x <= last; x++) if (mask[y * W + x] && outside(x) && thick(x, y) <= maxThick) mask[y * W + x] = 0;
      }
      start = -1;
    };
    const gap = Math.max(4, Math.round(W * 0.012)); // 破線（点線）のレベル線もひとつの線として見る
    for (let x = 0; x <= W; x++) {
      const on = x < W && mask[y * W + x];
      if (on) { if (start < 0) start = x; last = x; }
      else if (start >= 0 && (x - last > gap || x === W)) flush();
    }
  }
}

export type Component = { pick: Uint8Array; count: number; x0: number; x1: number; y0: number; y1: number };

// ひとつながりの線画（4近傍）を大きい順に。図枠（絵の縦横ほぼ全体に広がる薄い四角）は外す
export function components(mask: Uint8Array, W: number, H: number, max = 6): Component[] {
  const label = new Int32Array(W * H); let cur = 0;
  const stats: { id: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || label[i]) continue;
    cur++; const st = { id: cur, n: 0, x0: W, x1: -1, y0: H, y1: -1 }; stack.push(i); label[i] = cur;
    while (stack.length) {
      const j = stack.pop()!; st.n++;
      const x = j % W, y = (j - x) / W;
      if (x < st.x0) st.x0 = x; if (x > st.x1) st.x1 = x; if (y < st.y0) st.y0 = y; if (y > st.y1) st.y1 = y;
      if (x > 0 && mask[j - 1] && !label[j - 1]) { label[j - 1] = cur; stack.push(j - 1); }
      if (x < W - 1 && mask[j + 1] && !label[j + 1]) { label[j + 1] = cur; stack.push(j + 1); }
      if (y > 0 && mask[j - W] && !label[j - W]) { label[j - W] = cur; stack.push(j - W); }
      if (y < H - 1 && mask[j + W] && !label[j + W]) { label[j + W] = cur; stack.push(j + W); }
    }
    stats.push(st);
  }
  const frame = (c: typeof stats[number]) => (c.x1 - c.x0) >= W * 0.9 && (c.y1 - c.y0) >= H * 0.9 && c.n / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) < 0.02;
  const top = stats.filter(c => !frame(c)).sort((a, b) => b.n - a.n).slice(0, max);
  return top.map(c => { const pick = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (label[i] === c.id) pick[i] = 1; return { pick, count: c.n, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 }; });
}
export const largestComponent = (mask: Uint8Array, W: number, H: number) => { const c = components(mask, W, H, 1)[0]; return c ? { pick: c.pick, count: c.count } : null; };

// 立面図の絵から「建物の本体」を見つける（2段階）：
// 1) レベル線を全部消して、いちばん大きな線画（壁のまとまり）から建物の横位置を見当づける
// 2) 元の絵で、その横範囲の外を消し、レベル線も壁の外にはみ出た部分だけ消す → いちばん大きな線画＝屋根まで含む家
// 家の外形の下端＝地面、下のほうの幅＝壁（基礎）、各列の上端＝屋根の輪郭。寸法線・文字・表題・図枠は外れる
export function findBody(d: ImageData): Body | null {
  const W = d.width, H = d.height;
  const mask0 = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d.data[i * 4 + 3] > 40) mask0[i] = 1;
  const maxThick = Math.max(3, Math.round(H * 0.007));
  // 1) 見当
  const m1 = mask0.slice(); eraseLevelLines(m1, W, H, 0.35, maxThick);
  const c1 = components(m1, W, H, 1)[0];
  if (!c1 || c1.count < W * H * 0.002) return null;
  const ww = c1.x1 - c1.x0 + 1, keep: [number, number] = [c1.x0, c1.x1];
  const lo = Math.max(0, Math.round(c1.x0 - ww * 0.2)), hi = Math.min(W - 1, Math.round(c1.x1 + ww * 0.2));
  // 2) 本番
  const m2 = mask0.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < lo || x > hi) m2[y * W + x] = 0;
  eraseLevelLines(m2, W, H, 0.35, maxThick, keep);
  const comp = components(m2, W, H, 1)[0];
  if (!comp || comp.count < W * H * 0.002) return null;
  const m = comp.pick;
  let { x0, x1, y0, y1 } = comp;
  if (x1 - x0 < W * 0.2 || y1 - y0 < H * 0.15) return null;
  // 列ごとの画素数：両端の薄い列（引き出し線で繋がった文字など）は落とす
  const colN = Array.from({ length: x1 - x0 + 1 }, (_, i) => { let n = 0; for (let y = y0; y <= y1; y++) n += m[y * W + x0 + i]; return n; });
  const peak = Math.max(...colN), lim = Math.max(2, peak * 0.08);
  while (x1 - x0 > W * 0.2 && colN[0] < lim) { colN.shift(); x0++; }
  while (x1 - x0 > W * 0.2 && colN[colN.length - 1] < lim) { colN.pop(); x1--; }
  const ground = y1;
  // 壁（基礎）の幅：下 8% の行で、いちばん左右に伸びている範囲
  let gx0 = x1, gx1 = x0;
  for (let y = Math.max(y0, ground - Math.round((y1 - y0) * 0.08)); y <= ground; y++) for (let x = x0; x <= x1; x++) if (m[y * W + x]) { if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; }
  if (gx1 - gx0 < (x1 - x0) * 0.3) { gx0 = x0; gx1 = x1; }
  // 上端の輪郭（幅 5% の中央値でならす：寸法の小さな枠や細い縦線を無視）
  const top: number[] = [];
  for (let x = x0; x <= x1; x++) { let t = -1; for (let y = y0; y <= y1; y++) if (m[y * W + x]) { t = y; break; } top.push(t < 0 ? y1 : t); }
  const win = Math.max(1, Math.round(top.length * 0.025));
  const prof = top.map((_, i) => { const s = top.slice(Math.max(0, i - win), Math.min(top.length, i + win + 1)).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; });
  // 軒：壁の両端のすぐ内側の上端（低い方）。屋根の下＝壁の上端
  const span = Math.max(1, Math.round((gx1 - gx0) * 0.06));
  const sample = (a: number, b: number) => prof.slice(Math.max(0, a - x0), Math.min(prof.length, b - x0 + 1));
  const eavesRow = Math.max(...sample(gx0, gx0 + span), ...sample(gx1 - span, gx1));
  // 屋根の輪郭：壁の外（軒の出）は軒の高さに、壁の中で棟より高い所（軒出の寸法など）は棟に揃える
  const ridgeIn = Math.min(...prof.slice(Math.max(0, gx0 - x0), Math.min(prof.length, gx1 - x0 + 1)));
  const shaped = prof.map((t, i) => { const x = x0 + i; return x < gx0 || x > gx1 ? Math.max(t, eavesRow) : Math.max(t, ridgeIn); });
  const rect = { x: x0, y: Math.max(0, ridgeIn - Math.round(H * 0.01)), w: x1 - x0 + 1, h: 0 };
  rect.h = Math.min(H - 1, ground + Math.round(H * 0.012)) - rect.y + 1;
  const pts = shaped.map((t, i) => ({ x: i / Math.max(1, prof.length - 1), y: (rect.y + rect.h - 1 - t) / rect.h }));
  return { rect, ground, wallU: [(gx0 - x0) / rect.w, (gx1 - x0 + 1) / rect.w], roof: simplifyRoof(pts, 0.012), eaves: (eavesRow - rect.y) / rect.h, ridge: 0 };
}

// 窓：壁の中（軒〜GL・壁の左右の間）で、線に囲まれた「穴」（外側とつながっていない透明な領域）のうち、
// 大きすぎず小さすぎないもの。格子で分かれたガラスは近いもの同士をまとめて1つの窓にする。位置は切り出し後の 0..1
export function detectWindows(d: ImageData, rect: Rect, rows: { eaves: number; gl: number }, walls: [number, number]): WinRect[] {
  const W = d.width, H = d.height;
  const y0 = Math.max(0, Math.round(rows.eaves) + 3), y1 = Math.min(H - 1, Math.round(rows.gl) - 3), x0 = Math.max(0, walls[0] + 2), x1 = Math.min(W - 1, walls[1] - 2);
  const Hw = y1 - y0, Ww = x1 - x0;
  if (Hw < 20 || Ww < 20) return [];
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d.data[i * 4 + 3] > 40) mask[i] = 1;
  // 外側（縁から透明をたどる）
  const ext = new Uint8Array(W * H); const stack: number[] = [];
  const push = (i: number) => { if (!mask[i] && !ext[i]) { ext[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) { const j = stack.pop()!, x = j % W, y = (j - x) / W; if (x > 0) push(j - 1); if (x < W - 1) push(j + 1); if (y > 0) push(j - W); if (y < H - 1) push(j + W); }
  // 穴の塊
  const label = new Int32Array(W * H); let cur = 0;
  const holes: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x; if (mask[i] || ext[i] || label[i]) continue;
    cur++; const h = { x0: x, y0: y, x1: x, y1: y, n: 0 }; label[i] = cur; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!, jx = j % W, jy = (j - jx) / W; h.n++;
      if (jx < h.x0) h.x0 = jx; if (jx > h.x1) h.x1 = jx; if (jy < h.y0) h.y0 = jy; if (jy > h.y1) h.y1 = jy;
      for (const nb of [j - 1, j + 1, j - W, j + W]) { const nx = nb % W, ny = (nb - nx) / W; if (nb < 0 || nb >= W * H || Math.abs(nx - jx) > 1 || ny < y0 - 1 || ny > y1 + 1) continue; if (!mask[nb] && !ext[nb] && !label[nb]) { label[nb] = cur; stack.push(nb); } }
    }
    holes.push(h);
  }
  const minDim = Math.max(4, Hw * 0.05), maxW = Ww * 0.6, maxH = Hw * 0.75;
  const cand = holes.filter(h => { const w = h.x1 - h.x0 + 1, hh = h.y1 - h.y0 + 1; return w >= minDim && hh >= minDim && w <= maxW && hh <= maxH && h.n >= w * hh * 0.5; });
  // 近い穴（格子で分かれたガラス）をまとめる
  const gap = Math.max(3, Hw * 0.04);
  const groups: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const h of cand.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const g = groups.find(q => h.x0 <= q.x1 + gap && h.x1 >= q.x0 - gap && h.y0 <= q.y1 + gap && h.y1 >= q.y0 - gap);
    if (g) { g.x0 = Math.min(g.x0, h.x0); g.y0 = Math.min(g.y0, h.y0); g.x1 = Math.max(g.x1, h.x1); g.y1 = Math.max(g.y1, h.y1); }
    else groups.push({ ...h });
  }
  return groups.filter(g => g.x1 - g.x0 + 1 <= maxW && g.y1 - g.y0 + 1 <= maxH)
    .map(g => ({ x: (g.x0 - 2 - rect.x) / rect.w, y: (g.y0 - 2 - rect.y) / rect.h, w: (g.x1 - g.x0 + 5) / rect.w, h: (g.y1 - g.y0 + 5) / rect.h }))
    .filter(w => w.x >= 0 && w.y >= 0 && w.x + w.w <= 1 && w.y + w.h <= 1);
}

// 線の色を揃える（黒い線を少し柔らかいグレーに。3Dでは外壁色の上に乗る）
export function tintLines(data: ImageData, rgb: [number, number, number] = [84, 86, 88], alpha = 0.6) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.round(d[i + 3] * alpha); }
}

// 家のシルエットの上端（列ごとの行）。壁の外のレベル線を消してから、透明な所を縁から塗りつぶす（外側）。
// 列ごとに、上から見て「外側でない画素が minRun 以上続く」最初の行を返す。無ければ軒より下（none）
export function silhouetteTop(d: ImageData, rows: { ridge: number; eaves: number; gl: number }, walls: [number, number], rx0: number, rx1: number, drop: number, maxThick: number): number[] {
  const W = d.width, H = d.height;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d.data[i * 4 + 3] > 40) mask[i] = 1;
  eraseLevelLines(mask, W, H, 0.35, maxThick, walls);
  // 外側：透明な画素を縁から4近傍で塗りつぶす
  const ext = new Uint8Array(W * H); const stack: number[] = [];
  const push = (i: number) => { if (!mask[i] && !ext[i]) { ext[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const j = stack.pop()!, x = j % W, y = (j - x) / W;
    if (x > 0) push(j - 1); if (x < W - 1) push(j + 1); if (y > 0) push(j - W); if (y < H - 1) push(j + W);
  }
  const minRun = Math.max(4, Math.round(H * 0.03)), none = rows.eaves + drop + 1;
  const yTop = Math.max(0, Math.round(rows.ridge) - 2), yBot = Math.min(H - 1, Math.round(rows.eaves + drop));
  const out: number[] = [];
  for (let x = rx0; x <= rx1; x++) {
    let t = none;
    for (let y = yTop; y <= yBot; y++) {
      if (ext[y * W + x]) continue;
      let run = 0; while (y + run <= Math.min(H - 1, yBot + minRun) && !ext[(y + run) * W + x]) run++;
      if (run >= minRun) { t = y; break; }
      y += run;
    }
    out.push(t);
  }
  return out;
}

// 図面の文字から分かった行（最高高・軒高・GL）を手がかりに本体を見つける（PDF向け。こちらが本命）。
// 壁：軒〜GLの間に縦線が6割以上続く列のうち、いちばん外側の2本（棟より上まで伸びる寸法線は除く）。
// 屋根：棟〜軒の間の各列の上端（レベル線そのものの行は飛ばす）。壁の外へ屋根が続く範囲が軒の出
// bans：寸法線と分かっている列（px）。その近く（幅の 2.5%）の縦線は壁にしない
export function bodyFromLevels(d: ImageData, rows: { ridge: number; eaves: number; gl: number }, bans: number[] = []): Body | null {
  const W = d.width, H = d.height;
  const ridge = Math.max(0, Math.min(H - 1, Math.round(rows.ridge))), eaves = Math.max(ridge + 2, Math.min(H - 1, Math.round(rows.eaves))), gl = Math.max(eaves + 4, Math.min(H - 1, Math.round(rows.gl)));
  const skip = Math.max(2, Math.round(H * 0.006));
  const col = (x: number, y0: number, y1: number) => { let n = 0; for (let y = y0; y <= y1; y++) if (opaque(d, x, y)) n++; return n; };
  // 壁の候補列
  const wallSpan = gl - eaves - skip * 2;
  const cand: number[] = [];
  for (let x = 0; x < W; x++) {
    if (col(x, eaves + skip, gl - skip) / Math.max(1, wallSpan) < 0.6) continue;
    if (ridge > skip * 2 && col(x, 0, ridge - skip) / Math.max(1, ridge - skip) > 0.3) continue; // 棟より上まで伸びる＝寸法線
    if (col(x, ridge + skip, eaves - skip) / Math.max(1, eaves - ridge - skip * 2) > 0.7) continue; // 屋根の中も縦に通る＝寸法線（壁は軒で止まる）
    if (bans.some(b => Math.abs(b - x) <= W * 0.025)) continue; // 縦書きの数字のそば＝高さの寸法線
    cand.push(x);
  }
  if (cand.length < 2) return null;
  let wx0 = cand[0], wx1 = cand[cand.length - 1];
  if (wx1 - wx0 < W * 0.15) return null;
  // 屋根の輪郭：棟〜軒の間の上端（レベル線の行は飛ばす）
  const allow = Math.round((wx1 - wx0) * 0.2);
  const rx0 = Math.max(0, wx0 - allow), rx1 = Math.min(W - 1, wx1 + allow);
  // 軒の出は壁の外で下がるので、軒高より少し下（6%）まで見る
  const drop = Math.round(H * 0.06);
  // 屋根の輪郭＝家のシルエットの上端。外側（透明）を縁から塗りつぶし、塗りつぶされなかった所が家。
  // 勾配の記号・引き出し線・文字は「薄い」ので、縦に一定以上つながる所だけを家とみなす
  const top = silhouetteTop(d, { ridge, eaves, gl }, [wx0, wx1], rx0, rx1, drop, Math.max(3, Math.round(H * 0.007)));
  const win = Math.max(1, Math.round(top.length * 0.02));
  const prof = top.map((_, i) => { const s = top.slice(Math.max(0, i - win), Math.min(top.length, i + win + 1)).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; });
  // 屋根が実際にある範囲（壁から外へ続けて屋根の線がある列）。そこまでが軒の出
  let a = wx0 - rx0, b = wx1 - rx0;
  while (a > 0 && prof[a - 1] <= eaves + drop) a--;
  while (b < prof.length - 1 && prof[b + 1] <= eaves + drop) b++;
  const x0 = rx0 + a, x1 = rx0 + b;
  const rect = { x: x0, y: Math.max(0, ridge - Math.round(H * 0.01)), w: x1 - x0 + 1, h: 0 };
  rect.h = Math.min(H - 1, gl + Math.round(H * 0.012)) - rect.y + 1;
  const pts = prof.slice(a, b + 1).map((t, i) => ({ x: i / Math.max(1, b - a), y: (rect.y + rect.h - 1 - Math.min(eaves + drop, Math.max(ridge, t))) / rect.h }));
  return { rect, ground: gl, wallU: [(wx0 - x0) / rect.w, (wx1 - x0 + 1) / rect.w], roof: simplifyRoof(pts, 0.015), eaves: (eaves - rect.y) / rect.h, ridge: 0, windows: detectWindows(d, rect, { eaves, gl }, [wx0, wx1]) };
}

// 輪郭の間引き（Ramer–Douglas–Peucker）。端点は残す
export function simplifyRoof(pts: RoofPt[], tol: number): RoofPt[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
    if (dist > far) { far = dist; idx = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplifyRoof(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyRoof(pts.slice(idx), tol)];
}

export type PaperGuess = { name: string; widthMm: number; heightMm: number };
// 用紙サイズの見当（縦横比から A3/A4 の横・縦）。合わなければ A3 横
export function guessPaper(w: number, h: number): PaperGuess {
  const r = w / h;
  if (Math.abs(r - 1.414) < 0.08) return { name: 'A3横', widthMm: 420, heightMm: 297 };
  if (Math.abs(r - 0.707) < 0.08) return { name: 'A3縦', widthMm: 297, heightMm: 420 };
  return { name: 'A3横', widthMm: 420, heightMm: 297 };
}

// 1px が何 mm（実寸）か：用紙の幅(mm) ÷ 画像の幅(px) × 縮尺の分母
export const mmPerPxFromPaper = (paperWidthMm: number, imageWidthPx: number, denominator: number) => paperWidthMm / imageWidthPx * denominator;

// 枠の中を切り出し → 白を透明に → 建物の本体を見つけて、本体だけに縮めた PNG にする。長辺 maxPx まで
// rows：図面の文字から分かった行（用紙の px 座標）。あれば本体の見つけ方がずっと確かになる
export function cropToElevation(img: CanvasImageSource & { width: number; height: number }, crop: Rect, mmPerPx: number, maxPx = 1200, rows?: { ridge: number; eaves: number; gl: number }, bans: number[] = []): Elevation {
  const k = Math.min(1, maxPx / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * k)), h = Math.max(1, Math.round(crop.h * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  whiteToAlpha(data);
  tintLines(data);
  const body = (rows && bodyFromLevels(data, { ridge: (rows.ridge - crop.y) * k, eaves: (rows.eaves - crop.y) * k, gl: (rows.gl - crop.y) * k }, bans.map(b => (b - crop.x) * k))) || findBody(data);
  let out: Elevation;
  if (body) {
    const r = body.rect, c2 = document.createElement('canvas'); c2.width = r.w; c2.height = r.h;
    g.putImageData(data, 0, 0);
    c2.getContext('2d')!.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    out = { src: c2.toDataURL('image/png'), w: r.w, h: r.h, mmPerPx: mmPerPx / k, wallTop: body.eaves, wallU: body.wallU, roof: body.roof, ...(body.windows?.length && { windows: body.windows }) };
    c2.width = c2.height = 0;
  } else {
    g.putImageData(data, 0, 0);
    out = { src: c.toDataURL('image/png'), w, h, mmPerPx: mmPerPx / k, wallTop: wallTopRatio(data) };
  }
  c.width = c.height = 0;
  return out;
}

// 壁の上端の位置（上から 0..1）。本体が見つからなかったときの予備：中央の帯で幅が6割以上続く最初の行
export function wallTopRatio(data: ImageData, minCover = 0.6): number {
  const W = data.width, H = data.height;
  const x0 = Math.floor(W * 0.15), x1 = Math.ceil(W * 0.85), band = Math.max(1, x1 - x0);
  const span = (y: number) => { let first = -1, last = -1; for (let x = x0; x < x1; x++) if (opaque(data, x, y)) { if (first < 0) first = x; last = x; } return first < 0 ? 0 : (last - first) / band; };
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

// 白〜薄い灰色を透明に。線の縁は半透明にして滑らかに
export function whiteToAlpha(data: ImageData, lo = 215, hi = 248) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v >= hi) d[i + 3] = 0;
    else if (v > lo) d[i + 3] = Math.round(d[i + 3] * (hi - v) / (hi - lo));
  }
}

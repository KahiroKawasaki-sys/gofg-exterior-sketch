// SVGの画像化・閉じた輪郭の塗りつぶし判定・書き出し
import { type Doc, type LibItem, type Box, type Pt, type Layer, itemBox, unionBox } from './types';
import { layerMarkup, SHARED_DEFS, type RenderCtx } from './markup';
import { symbolMarkup } from './library';

export function contentBox(doc: Doc, pad = 40): Box {
  const boxes: Box[] = [];
  for (const l of doc.layers) if (l.visible) for (const it of l.items) if (!(it.type === 'obj' && it.hidden)) boxes.push(itemBox(it));
  if (doc.underlay?.visible) boxes.push({ x: doc.underlay.x, y: doc.underlay.y, w: doc.underlay.w, h: doc.underlay.h });
  if (!boxes.length) return { x: 0, y: 0, w: 1200, h: 900 };
  const b = unionBox(boxes);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

function usedSymbols(layers: Layer[], lib: LibItem[]) {
  const ids = new Set<string>();
  for (const l of layers) for (const it of l.items) if (it.type === 'obj') ids.add(it.ref);
  return lib.filter(l => ids.has(l.id)).map(symbolMarkup).join('');
}

export function docSVG(doc: Doc, lib: LibItem[], ctx: RenderCtx, box: Box, opt: { layers?: (l: Layer) => boolean; underlay?: boolean; background?: string; pxW?: number; pxH?: number } = {}): string {
  const layers = doc.layers.filter(l => l.visible && (!opt.layers || opt.layers(l)));
  let body = '';
  if (opt.background) body += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${opt.background}"/>`;
  const u = doc.underlay;
  if (u && u.visible && opt.underlay !== false) body += `<image href="${u.src}" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" opacity="${u.opacity}" preserveAspectRatio="none"/>`;
  for (const l of layers) body += `<g opacity="${l.opacity}">${layerMarkup(l, ctx)}</g>`;
  const w = opt.pxW ?? box.w, h = opt.pxH ?? box.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"><defs>${SHARED_DEFS}${usedSymbols(layers, lib)}</defs>${body}</svg>`;
}

export function rasterize(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(Error('画像化に失敗しました')); };
    img.src = url;
  });
}

// 線（暗いピクセル）を壁として、タップ位置から広がる領域を求める。
// gap: 線の小さな隙間をふさぐ半径(px)。外周に漏れたら「閉じていない」と判断する。
export function floodRegion(data: ImageData, sx: number, sy: number, gap = 2): Uint8Array | null {
  const { width: W, height: H, data: d } = data, N = W * H;
  const wall = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = d[i * 4 + 3]; if (a < 30) continue;
    const lum = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) * a / 255 + 255 * (1 - a / 255);
    if (lum < 200) wall[i] = 1;
  }
  const grown = gap > 0 ? dilate(wall, W, H, gap) : wall;
  const x0 = Math.round(sx), y0 = Math.round(sy);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H || grown[y0 * W + x0]) return null;
  const fill = new Uint8Array(N), stack = [y0 * W + x0]; fill[y0 * W + x0] = 1;
  let leak = false;
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) leak = true;
    if (x > 0 && !fill[i - 1] && !grown[i - 1]) { fill[i - 1] = 1; stack.push(i - 1); }
    if (x < W - 1 && !fill[i + 1] && !grown[i + 1]) { fill[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !fill[i - W] && !grown[i - W]) { fill[i - W] = 1; stack.push(i - W); }
    if (y < H - 1 && !fill[i + W] && !grown[i + W]) { fill[i + W] = 1; stack.push(i + W); }
  }
  if (leak) return null;
  // 壁を太らせた分だけ塗りを広げ、線の下まで届かせる
  return dilate(fill, W, H, gap + 1);
}

export function dilate(src: Uint8Array, W: number, H: number, r: number): Uint8Array {
  // 横→縦の2パスで正方形の膨張（高速）
  const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) { let run = -1e9; for (let x = 0; x < W; x++) { if (src[y * W + x]) run = x; if (x - run <= r) tmp[y * W + x] = 1; } run = 1e9; for (let x = W - 1; x >= 0; x--) { if (src[y * W + x]) run = x; if (run - x <= r) tmp[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let run = -1e9; for (let y = 0; y < H; y++) { if (tmp[y * W + x]) run = y; if (y - run <= r) out[y * W + x] = 1; } run = 1e9; for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) run = y; if (run - y <= r) out[y * W + x] = 1; } }
  return out;
}

// 塗る場所（選択範囲）。図面上の固定範囲を画素で持つ。
export class Selection {
  box: Box; k: number; W: number; H: number; bits: Uint8Array; version = 0;
  constructor(box: Box) {
    this.box = box; this.k = Math.min(2, 2000 / Math.max(box.w, box.h));
    this.W = Math.max(1, Math.round(box.w * this.k)); this.H = Math.max(1, Math.round(box.h * this.k));
    this.bits = new Uint8Array(this.W * this.H);
  }
  toPx(p: Pt) { return { x: (p.x - this.box.x) * this.k, y: (p.y - this.box.y) * this.k }; }
  add(mask: Uint8Array) { for (let i = 0; i < mask.length; i++) if (mask[i]) this.bits[i] = 1; this.version++; }
  brush(pts: Pt[], radiusWorld: number, erase: boolean) {
    const r = Math.max(1, radiusWorld * this.k), W = this.W, H = this.H;
    const stamp = (cx: number, cy: number) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.bits[y * W + x] = erase ? 0 : 1;
    };
    for (let i = 0; i < pts.length; i++) {
      const a = this.toPx(pts[Math.max(0, i - 1)]), b = this.toPx(pts[i]), steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r * 0.5)));
      for (let s = 0; s <= steps; s++) stamp(a.x + (b.x - a.x) * s / steps, a.y + (b.y - a.y) * s / steps);
    }
    this.version++;
  }
  clear() { this.bits.fill(0); this.version++; }
  count() { let n = 0; for (const v of this.bits) n += v; return n; }
  bounds() {
    let x0 = this.W, y0 = this.H, x1 = -1, y1 = -1;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.bits[y * this.W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }
  // 表示用（半透明の緑）または切り抜き用（白）の画像
  image(color: [number, number, number, number], crop = false): { url: string; box: Box } | null {
    const b = crop ? this.bounds() : { x0: 0, y0: 0, x1: this.W - 1, y1: this.H - 1 };
    if (!b) return null;
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!, img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (this.bits[(y + b.y0) * this.W + x + b.x0]) { const o = (y * w + x) * 4; img.data[o] = color[0]; img.data[o + 1] = color[1]; img.data[o + 2] = color[2]; img.data[o + 3] = color[3]; }
    g.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), box: { x: this.box.x + b.x0 / this.k, y: this.box.y + b.y0 / this.k, w: w / this.k, h: h / this.k } };
  }
  // 保存済みマスク画像から選択範囲を作り直す
  static async fromImage(url: string, box: Box): Promise<Selection> {
    const s = new Selection(box), img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(Error('選択範囲を読み込めません')); img.src = url; });
    const c = document.createElement('canvas'); c.width = s.W; c.height = s.H; const g = c.getContext('2d')!; g.drawImage(img, 0, 0, s.W, s.H);
    const d = g.getImageData(0, 0, s.W, s.H).data; for (let i = 0; i < s.bits.length; i++) s.bits[i] = d[i * 4 + 3] > 100 ? 1 : 0;
    s.version++; return s;
  }
}

export async function fillAt(doc: Doc, lib: LibItem[], ctx: RenderCtx, sel: Selection, p: Pt): Promise<boolean> {
  const svg = docSVG(doc, lib, ctx, sel.box, { layers: l => l.kind === 'draw', pxW: sel.W, pxH: sel.H });
  const c = await rasterize(svg, sel.W, sel.H);
  const data = c.getContext('2d')!.getImageData(0, 0, sel.W, sel.H), q = sel.toPx(p);
  const mask = floodRegion(data, q.x, q.y, 2);
  if (!mask) return false;
  sel.add(mask); return true;
}

export async function exportImage(doc: Doc, lib: LibItem[], ctx: RenderCtx, maxPx = 3000): Promise<Blob> {
  const box = contentBox(doc, 60), k = Math.min(3, maxPx / Math.max(box.w, box.h)), w = Math.round(box.w * k), h = Math.round(box.h * k);
  const c = await rasterize(docSVG(doc, lib, ctx, box, { background: '#ffffff', pxW: w, pxH: h }), w, h);
  return await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('PNGを作れませんでした')), 'image/png'));
}

export async function exportPDF(doc: Doc, lib: LibItem[], ctx: RenderCtx, paper: 'A4' | 'A3'): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const png = await exportImage(doc, lib, ctx, paper === 'A3' ? 4200 : 3000);
  const pdf = await PDFDocument.create(), size: [number, number] = paper === 'A3' ? [1190.55, 841.89] : [841.89, 595.28];
  const page = pdf.addPage(size), img = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
  const m = 24, k = Math.min((size[0] - m * 2) / img.width, (size[1] - m * 2) / img.height);
  page.drawImage(img, { x: (size[0] - img.width * k) / 2, y: (size[1] - img.height * k) / 2, width: img.width * k, height: img.height * k });
  const bytes = await pdf.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
}

export async function thumbnail(doc: Doc, lib: LibItem[], ctx: RenderCtx): Promise<string> {
  const box = contentBox(doc, 30), k = 360 / Math.max(box.w, box.h), w = Math.max(1, Math.round(box.w * k)), h = Math.max(1, Math.round(box.h * k));
  const c = await rasterize(docSVG(doc, lib, ctx, box, { background: '#ffffff', pxW: w, pxH: h }), w, h);
  return c.toDataURL('image/jpeg', 0.75);
}

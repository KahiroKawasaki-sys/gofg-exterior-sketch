// DXF書き出し（RIKCADなどのCADで読み込む用）。単位は mm、図面の下向きの y は DXF では上向きに直す。
// 互換性を優先して最も古く広く読める R12 形式（AC1009）で書き、日本のCADに合わせて文字は Shift_JIS（ANSI_932）にする。
import { type Doc, type Item, type LibItem, type Pt, type TextItem, corners, textSize, rotPt, rad } from './types';
import { resolveRole, canRaise } from './scene3d';
import { TEXTURES } from './textures';

export type Loop = Pt[];

// レイヤー名（色は AutoCAD の色番号）
export const L = {
  building: '建物', wall: '塀', fence: 'フェンス', gate: '門扉', line: '線', dashed: '線_破線', sketch: '手描き',
  arrow: '矢印', dim: '寸法', text: '文字', parts: '部品', partsName: '部品名', matLabel: '素材名',
} as const;
export const DXF_LAYERS: { name: string; color: number; ltype?: string }[] = [
  { name: L.building, color: 7 }, { name: L.wall, color: 8 }, { name: L.fence, color: 30 }, { name: L.gate, color: 5 },
  { name: L.line, color: 7 }, { name: L.dashed, color: 1, ltype: 'DASHED' }, { name: L.sketch, color: 9 }, { name: L.arrow, color: 6 },
  { name: L.dim, color: 3 }, { name: L.text, color: 7 }, { name: L.parts, color: 4 }, { name: L.partsName, color: 4 }, { name: L.matLabel, color: 2 },
];

const n = (v: number) => (Math.round(v * 10) / 10).toString();
// DXFの値に使えない改行・制御文字を除く
export const dxfText = (s: string) => s.replace(/[\x00-\x1f]/g, ' ');

// Shift_JIS（Windows-31J）への変換表。ブラウザには変換器がないので、読み取り側（TextDecoder）から逆引き表を作る
let sjis: Map<string, number[]> | null = null;
function sjisTable() {
  if (sjis) return sjis;
  sjis = new Map();
  const dec = new TextDecoder('shift_jis');
  for (let b = 0xa1; b <= 0xdf; b++) sjis.set(dec.decode(new Uint8Array([b])), [b]);
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    if (hi > 0x9f && hi < 0xe0) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '\ufffd' && !sjis.has(ch)) sjis.set(ch, [hi, lo]);
    }
  }
  return sjis;
}
// 書き出すファイルの中身（Shift_JIS）。表にない文字は ? にする
export function encodeSjis(text: string): Uint8Array {
  const t = sjisTable(), out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out.push(c);
    else out.push(...(t.get(ch) || [0x3f]));
  }
  return new Uint8Array(out);
}
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase();
export const matLayer = (tex: string) => '素材_' + (tex.startsWith('b:') ? (TEXTURES.find(t => t.id === tex.slice(2))?.name || safeName(tex.slice(2))) : '画像');

class Writer {
  out: string[] = [];
  g(code: number, v: string | number) { this.out.push(String(code), typeof v === 'number' ? n(v) : v); }
  poly(layer: string, pts: { x: number; y: number }[], closed: boolean) {
    if (pts.length < 2) return;
    this.g(0, 'POLYLINE'); this.g(8, layer); this.g(66, '1'); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, closed ? '1' : '0');
    for (const p of pts) { this.g(0, 'VERTEX'); this.g(8, layer); this.g(10, p.x); this.g(20, p.y); this.g(30, 0); }
    this.g(0, 'SEQEND'); this.g(8, layer);
  }
  line(layer: string, a: { x: number; y: number }, b: { x: number; y: number }) {
    this.g(0, 'LINE'); this.g(8, layer); this.g(10, a.x); this.g(20, a.y); this.g(30, 0); this.g(11, b.x); this.g(21, b.y); this.g(31, 0);
  }
  circle(layer: string, c: { x: number; y: number }, r: number) { this.g(0, 'CIRCLE'); this.g(8, layer); this.g(10, c.x); this.g(20, c.y); this.g(30, 0); this.g(40, r); }
  text(layer: string, p: { x: number; y: number }, h: number, s: string, rot = 0, center = false) {
    this.g(0, 'TEXT'); this.g(8, layer); this.g(10, p.x); this.g(20, p.y); this.g(30, 0); this.g(40, h); this.g(1, dxfText(s));
    if (rot) this.g(50, rot);
    if (center) { this.g(72, '1'); this.g(11, p.x); this.g(21, p.y); this.g(31, 0); }
  }
}

const ROUND_CATS = new Set(['植栽', '低木', '下草']);

function ellipsePts(it: Item & { type: 'shape' }): Pt[] {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2, out: Pt[] = [];
  for (let i = 0; i < 48; i++) {
    const t = i / 48 * Math.PI * 2;
    out.push(rotPt({ x: cx + Math.cos(t) * it.w / 2, y: cy + Math.sin(t) * it.h / 2 }, { x: cx, y: cy }, rad(it.rot)));
  }
  return out;
}

function layerFor(it: Item & { type: 'line' | 'stroke' | 'shape' }, mmPerPx: number): string {
  const role = resolveRole(it, mmPerPx);
  if (role === 'building') return L.building;
  if (role === 'wall') return L.wall;
  if (role === 'fence') return L.fence;
  if (role === 'gate') return L.gate;
  if (it.type === 'stroke') return L.sketch;
  return it.dash === 'solid' ? L.line : L.dashed;
}

// contours: 素材（塗り）ごとの輪郭。マスク画像から作るのは画面側（textureContours）
export function buildDxf(doc: Doc, lib: LibItem[], contours: Map<string, Loop[]> = new Map()): string {
  const mm = doc.mmPerPx, P = (p: Pt) => ({ x: p.x * mm, y: -p.y * mm });
  const items = doc.layers.filter(l => l.visible).flatMap(l => l.items);
  const libMap = new Map(lib.map(l => [l.id, l]));
  const usedRefs = [...new Set(items.filter(i => i.type === 'obj' && !i.hidden).map(i => (i as Item & { type: 'obj' }).ref))].filter(r => libMap.has(r));
  const mats = [...new Set(items.filter(i => i.type === 'texture').map(i => matLayer((i as Item & { type: 'texture' }).tex)))];
  const w = new Writer();

  // HEADER
  w.g(0, 'SECTION'); w.g(2, 'HEADER'); w.g(9, '$ACADVER'); w.g(1, 'AC1009'); w.g(9, '$DWGCODEPAGE'); w.g(3, 'ANSI_932'); w.g(9, '$INSUNITS'); w.g(70, '4'); w.g(9, '$MEASUREMENT'); w.g(70, '1'); w.g(0, 'ENDSEC');
  // TABLES：線種とレイヤー
  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  w.g(0, 'TABLE'); w.g(2, 'LTYPE'); w.g(70, '2');
  w.g(0, 'LTYPE'); w.g(2, 'CONTINUOUS'); w.g(70, '0'); w.g(3, 'Solid line'); w.g(72, '65'); w.g(73, '0'); w.g(40, 0);
  w.g(0, 'LTYPE'); w.g(2, 'DASHED'); w.g(70, '0'); w.g(3, '__ __ __'); w.g(72, '65'); w.g(73, '2'); w.g(40, 300); w.g(49, 200); w.g(49, -100);
  w.g(0, 'ENDTAB');
  const layers = [...DXF_LAYERS, ...mats.map(name => ({ name, color: 2, ltype: undefined }))];
  w.g(0, 'TABLE'); w.g(2, 'LAYER'); w.g(70, String(layers.length + 1));
  w.g(0, 'LAYER'); w.g(2, '0'); w.g(70, '0'); w.g(62, '7'); w.g(6, 'CONTINUOUS');
  for (const l of layers) { w.g(0, 'LAYER'); w.g(2, l.name); w.g(70, '0'); w.g(62, String(l.color)); w.g(6, l.ltype || 'CONTINUOUS'); }
  w.g(0, 'ENDTAB'); w.g(0, 'ENDSEC');

  // BLOCKS：部品ごとに中心を原点にした外形（樹木は円、それ以外は四角）
  w.g(0, 'SECTION'); w.g(2, 'BLOCKS');
  for (const ref of usedRefs) {
    const li = libMap.get(ref)!, bw = li.w * mm, bh = li.h * mm, name = 'P_' + safeName(ref.replace(/^b-/, ''));
    w.g(0, 'BLOCK'); w.g(8, '0'); w.g(2, name); w.g(70, '0'); w.g(10, 0); w.g(20, 0); w.g(30, 0); w.g(3, name);
    if (ROUND_CATS.has(li.cat)) w.circle('0', { x: 0, y: 0 }, Math.min(bw, bh) / 2);
    else w.poly('0', [{ x: -bw / 2, y: -bh / 2 }, { x: bw / 2, y: -bh / 2 }, { x: bw / 2, y: bh / 2 }, { x: -bw / 2, y: bh / 2 }], true);
    w.g(0, 'ENDBLK'); w.g(8, '0');
  }
  w.g(0, 'ENDSEC');

  // ENTITIES
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  for (const it of items) {
    if (it.type === 'line' && it.kind === 'arrow') {
      w.poly(L.arrow, it.pts.map(P), false);
      if (it.pts.length > 1) {
        const a = it.pts[it.pts.length - 2], b = it.pts[it.pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), s = Math.max(8, it.width * 4);
        for (const d of [-0.4, 0.4]) w.line(L.arrow, P(b), P({ x: b.x - s * Math.cos(ang + d), y: b.y - s * Math.sin(ang + d) }));
      }
    } else if (canRaise(it)) {
      const layer = layerFor(it, mm);
      if (it.type === 'shape') {
        const pts = it.shape === 'rect' ? corners(it.x, it.y, it.w, it.h, it.rot) : ellipsePts(it);
        w.poly(layer, pts.map(P), true);
      } else {
        const pts = it.pts, f = pts[0], l = pts[pts.length - 1];
        const closed = pts.length > 3 && Math.hypot(f.x - l.x, f.y - l.y) < 5;
        w.poly(layer, (closed ? pts.slice(0, -1) : pts).map(P), closed);
      }
    } else if (it.type === 'dim') {
      // 寸法は線＋端の目印＋寸法値の文字で書く（どのCADでも同じ見た目になるように）
      const a = P(it.a), b = P(it.b), len = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const t = 150, nx = -Math.sin(ang), ny = Math.cos(ang);
      w.line(L.dim, a, b);
      for (const p of [a, b]) w.line(L.dim, { x: p.x - nx * t, y: p.y - ny * t }, { x: p.x + nx * t, y: p.y + ny * t });
      let deg = ang * 180 / Math.PI; if (deg > 90 || deg < -90) deg += 180;
      const fs = (it.size ?? 13) * mm;
      w.text(L.dim, { x: (a.x + b.x) / 2 + nx * fs * 0.6, y: (a.y + b.y) / 2 + ny * fs * 0.6 }, fs * 0.8, String(Math.round(len)), deg, true);
    } else if (it.type === 'text') {
      writeText(w, it, P, mm);
    } else if (it.type === 'obj' && !it.hidden && libMap.has(it.ref)) {
      const li = libMap.get(it.ref)!, c = P({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
      w.g(0, 'INSERT'); w.g(8, L.parts); w.g(2, 'P_' + safeName(it.ref.replace(/^b-/, ''))); w.g(10, c.x); w.g(20, c.y); w.g(30, 0);
      w.g(41, (it.flip ? -1 : 1) * it.w / li.w); w.g(42, it.h / li.h); w.g(43, 1); if (it.rot) w.g(50, -it.rot);
      w.text(L.partsName, c, Math.max(100, Math.min(250, Math.min(it.w, it.h) * mm * 0.12)), it.name, 0, true);
    } else if (it.type === 'texture') {
      const layer = matLayer(it.tex), loops = contours.get(it.id) || [];
      for (const loop of loops) w.poly(layer, loop.map(P), true);
      const big = loops.reduce<Loop | null>((m, l) => !m || l.length > m.length ? l : m, null);
      if (big) {
        const c = big.reduce((s, p) => ({ x: s.x + p.x / big.length, y: s.y + p.y / big.length }), { x: 0, y: 0 });
        w.text(L.matLabel, P(c), 200, TEXTURES.find(t => 'b:' + t.id === it.tex)?.name || it.texName || '素材', 0, true);
      }
    }
  }
  w.g(0, 'ENDSEC'); w.g(0, 'EOF');
  return w.out.join('\r\n') + '\r\n';
}

function writeText(w: Writer, t: TextItem, P: (p: Pt) => { x: number; y: number }, mm: number) {
  const s = textSize(t), pad = t.bg || t.border ? t.size * 0.3 : 0, c = { x: t.x + s.w / 2, y: t.y + s.h / 2 };
  t.text.split('\n').forEach((row, i) => {
    if (!row.trim()) return;
    const base = rotPt({ x: t.x + pad, y: t.y + pad * 0.66 + t.size * (1.25 * i + 0.98) }, c, rad(t.rot));
    w.text(L.text, P(base), t.size * mm * 0.8, row, -t.rot);
  });
}

// 塗りのマスク（白黒の画素）から輪郭を取り出す。画素のふちを1周たどり、まっすぐな所の点を間引く
export function traceMask(bits: Uint8Array, W: number, H: number): Pt[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && bits[y * W + x] === 1;
  const next = new Map<number, number[]>(), key = (x: number, y: number) => y * (W + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); const v = next.get(k); if (v) v.push(key(x1, y1)); else next.set(k, [key(x1, y1)]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Pt[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop: Pt[] = [];
      let k = start;
      do {
        loop.push({ x: k % (W + 1), y: Math.floor(k / (W + 1)) });
        const v = next.get(k)!; const nk = v.pop()!; if (!v.length) next.delete(k); k = nk;
      } while (k !== start && next.has(k));
      if (loop.length >= 4) loops.push(simplifyLoop(loop, 1));
    }
  }
  return loops.filter(l => l.length >= 3);
}

function simplifyLoop(loop: Pt[], tol: number): Pt[] {
  // まず一直線に並んだ点を除き（画素のふちなので角だけ残る）、それでも多ければ Ramer–Douglas–Peucker で間引く
  const corners = loop.filter((p, i) => {
    const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
  if (corners.length <= 8) return corners;
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let far = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L; if (d > far) { far = d; idx = i; } }
    if (far <= tol) return [a, b];
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))];
  };
  // 閉じた線は、始点と一番遠い点で2本に分けてから間引く
  let far = 0, idx = 0;
  corners.forEach((p, i) => { const d = Math.hypot(p.x - corners[0].x, p.y - corners[0].y); if (d > far) { far = d; idx = i; } });
  const out = [...rdp(corners.slice(0, idx + 1)).slice(0, -1), ...rdp([...corners.slice(idx), corners[0]]).slice(0, -1)];
  return out.length >= 3 ? out : corners;
}

// 画面側：塗りのマスク画像を読み、図面座標の輪郭にする（長い辺を最大 maxPx 画素に縮めてから）
export async function textureContours(doc: Doc, maxPx = 400): Promise<Map<string, Loop[]>> {
  const out = new Map<string, Loop[]>();
  for (const l of doc.layers) {
    if (!l.visible) continue;
    for (const it of l.items) {
      if (it.type !== 'texture') continue;
      try {
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(Error('mask')); img.src = it.mask; });
        const k = Math.min(1, maxPx / Math.max(img.width, img.height)), W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data, bits = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) bits[i] = d[i * 4 + 3] > 127 ? 1 : 0;
        out.set(it.id, traceMask(bits, W, H).map(loop => loop.map(p => ({ x: it.x + p.x / W * it.w, y: it.y + p.y / H * it.h }))));
      } catch { /* 読めないマスクは輪郭なしで続ける */ }
    }
  }
  return out;
}

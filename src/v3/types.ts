// v0.3 データ構造。座標は「図面px」（縮尺 1px = mmPerPx mm）。
export type Pt = { x: number; y: number; p?: number };
export type Brush = 'pen' | 'marker' | 'matte' | 'pencil';
export type Dash = 'solid' | 'dashed' | 'dotted';

export type StrokeItem = { id: string; type: 'stroke'; brush: Brush; color: string; width: number; dash: Dash; pts: Pt[] };
export type LineItem = { id: string; type: 'line'; kind: 'line' | 'polyline' | 'arrow'; color: string; width: number; dash: Dash; pts: Pt[] };
export type ShapeItem = { id: string; type: 'shape'; shape: 'rect' | 'ellipse' | 'circle'; color: string; width: number; dash: Dash; x: number; y: number; w: number; h: number; rot: number };
export type DimItem = { id: string; type: 'dim'; color: string; width: number; a: Pt; b: Pt; size?: number };
export type TextItem = { id: string; type: 'text'; x: number; y: number; text: string; size: number; color: string; bg: string | null; border: string | null; rot: number };
export type ObjItem = { id: string; type: 'obj'; ref: string; name: string; x: number; y: number; w: number; h: number; rot: number; flip: boolean; color: string | null; hidden?: boolean; locked?: boolean };
export type TextureItem = {
  id: string; type: 'texture'; name: string; mask: string; x: number; y: number; w: number; h: number;
  tex: string; texName: string; scale: number; rot: number; hue: number; sat: number; bright: number; contrast: number;
};
export type Item = StrokeItem | LineItem | ShapeItem | DimItem | TextItem | ObjItem | TextureItem;

export type LayerKind = 'draw' | 'text' | 'fill' | 'texture' | 'object';
export type Layer = { id: string; name: string; kind: LayerKind; visible: boolean; locked: boolean; opacity: number; items: Item[] };

export type GuideType = 'line' | 'slope' | 'face' | 'circle' | 'curve' | 'golden' | 'grid' | 'ruler';
export type Guide = { id: string; type: GuideType; name: string; a: Pt; b: Pt; c?: Pt; visible: boolean; locked: boolean; hA: number; hB: number; spacing?: number };

export type Underlay = { src: string; name: string; x: number; y: number; w: number; h: number; opacity: number; visible: boolean; locked: boolean };

export type Doc = {
  schema: 3; id: string; name: string; updatedAt: string; mmPerPx: number;
  underlay?: Underlay; layers: Layer[]; guides: Guide[]; activeLayer: string;
  view?: { x: number; y: number; k: number; r: number };
};

export type LibItem = { id: string; name: string; cat: string; w: number; h: number; vw: number; vh: number; svg: string; builtin?: boolean; tint?: boolean };

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const PALETTE = ['#2f3b38', '#c4473d', '#111111', '#a35a1f', '#9e9e9e', '#8f8c80', '#3f7fbf', '#b779c7'];
export const SOFT = ['#9a9a9a', '#e8b4ae', '#a3a8a5', '#dcc2a2', '#dadada', '#d6d4cc', '#b6cfe2', '#e3cbe8'];

export function newLayer(name: string, kind: LayerKind = 'draw'): Layer {
  return { id: uid(), name, kind, visible: true, locked: false, opacity: 1, items: [] };
}

export function newDoc(name = '新しいキャンバス'): Doc {
  const fill = newLayer('塗りレイヤー', 'fill');
  const l1 = newLayer('レイヤー 1');
  const objects = newLayer('オブジェクト', 'object');
  const text = newLayer('テキストレイヤー', 'text');
  return { schema: 3, id: uid(), name, updatedAt: new Date().toISOString(), mmPerPx: 10, layers: [fill, l1, objects, text], guides: [], activeLayer: l1.id };
}

// 幾何ヘルパー
export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const rad = (d: number) => d * Math.PI / 180;
export const deg = (r: number) => r * 180 / Math.PI;
export function rotPt(p: Pt, c: Pt, a: number): Pt { const s = Math.sin(a), k = Math.cos(a), x = p.x - c.x, y = p.y - c.y; return { x: c.x + x * k - y * s, y: c.y + x * s + y * k }; }
export type Box = { x: number; y: number; w: number; h: number };
export function boxOf(pts: Pt[]): Box {
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const p of pts) { if (p.x < x) x = p.x; if (p.y < y) y = p.y; if (p.x > r) r = p.x; if (p.y > b) b = p.y; }
  if (!isFinite(x)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x, y, w: r - x, h: b - y };
}
export function unionBox(boxes: Box[]): Box { return boxOf(boxes.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])); }

export function corners(x: number, y: number, w: number, h: number, rot: number): Pt[] {
  const c = { x: x + w / 2, y: y + h / 2 }, a = rad(rot);
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map(p => rotPt(p, c, a));
}

export function itemBox(it: Item): Box {
  switch (it.type) {
    case 'stroke': case 'line': { const b = boxOf(it.pts), m = it.width / 2; return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }; }
    case 'dim': { const b = boxOf([it.a, it.b]); return { x: b.x - 10, y: b.y - 10, w: b.w + 20, h: b.h + 20 }; }
    case 'shape': case 'obj': return boxOf(corners(it.x, it.y, it.w, it.h, it.rot));
    case 'texture': return { x: it.x, y: it.y, w: it.w, h: it.h };
    case 'text': { const s = textSize(it); return boxOf(corners(it.x, it.y, s.w, s.h, it.rot)); }
  }
}

export function textSize(t: TextItem) {
  const rows = t.text.split('\n');
  const w = Math.max(...rows.map(r => [...r].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0)), 1) * t.size + (t.bg || t.border ? t.size * 0.6 : 0);
  return { w, h: rows.length * t.size * 1.25 + (t.bg || t.border ? t.size * 0.4 : 0) };
}

export function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 平行移動・回転・拡大（選択した図形をまとめて変形する）
export function transformItem(it: Item, f: (p: Pt) => Pt, dRot: number, k: number, flip = false): Item {
  const mapBox = <T extends { x: number; y: number; w: number; h: number; rot: number }>(o: T): T => {
    const c = f({ x: o.x + o.w / 2, y: o.y + o.h / 2 }), w = o.w * k, h = o.h * k;
    return { ...o, x: c.x - w / 2, y: c.y - h / 2, w, h, rot: (o.rot + dRot) % 360 };
  };
  switch (it.type) {
    case 'stroke': case 'line': return { ...it, pts: it.pts.map(p => ({ ...f(p), p: p.p })), width: it.width * (k === 1 ? 1 : Math.sqrt(k)) };
    case 'dim': return { ...it, a: f(it.a), b: f(it.b) };
    case 'shape': return mapBox(it);
    case 'obj': return { ...mapBox(it), flip: flip ? !it.flip : it.flip };
    case 'texture': { const c = f({ x: it.x + it.w / 2, y: it.y + it.h / 2 }); return { ...it, x: c.x - it.w / 2, y: c.y - it.h / 2 }; }
    case 'text': { const s = textSize(it), c = f({ x: it.x + s.w / 2, y: it.y + s.h / 2 }), size = it.size * k, t2 = { ...it, size }, s2 = textSize(t2); return { ...t2, x: c.x - s2.w / 2, y: c.y - s2.h / 2, rot: (it.rot + dRot) % 360 }; }
  }
}

export function fmtLen(px: number, mmPerPx: number, unit: string) {
  const mm = px * mmPerPx;
  if (unit === 'm') return (mm / 1000).toFixed(2) + ' m';
  if (unit === 'cm') return (mm / 10).toFixed(1) + ' cm';
  return Math.round(mm) + ' mm';
}

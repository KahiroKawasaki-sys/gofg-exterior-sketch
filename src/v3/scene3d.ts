// 平面図 → 3Dの立体リスト。描画ライブラリに依存しない純粋な変換（テストしやすくするため）。
// 座標は m。図面の x → x、図面の y（下向き）→ z。高さは y（上向き）。
import { type Doc, type Item, type LibItem, type Pt, corners } from './types';

export type P2 = { x: number; z: number };
export type Solid =
  | { kind: 'wall'; a: P2; b: P2; h: number; t: number; color: string }
  | { kind: 'building'; poly: P2[]; h: number }
  | { kind: 'tree'; x: number; z: number; r: number; h: number; form: 'round' | 'cone' | 'palm'; color: string }
  | { kind: 'shrub'; x: number; z: number; rx: number; rz: number; h: number; rot: number; color: string }
  | { kind: 'box'; x: number; z: number; w: number; d: number; h: number; rot: number; color: string; y0?: number }
  | { kind: 'car'; x: number; z: number; w: number; d: number; rot: number; color: string }
  | { kind: 'carport'; x: number; z: number; w: number; d: number; h: number; rot: number }
  | { kind: 'cylinder'; x: number; z: number; r: number; h: number; color: string }
  | { kind: 'person'; x: number; z: number; h: number; color: string }
  | { kind: 'stone'; x: number; z: number; rx: number; rz: number; h: number; rot: number };

export type SceneOpts = { wallH: number; buildingH: number };
export const DEFAULT_SCENE_OPTS: SceneOpts = { wallH: 1.2, buildingH: 6 };
// 囲みが建物とみなされる最小の広さ（㎡）。花壇や駐車枠を建物にしないため
export const BUILDING_MIN_AREA = 20;
const WALL_T = 0.12, MIN_SEG = 0.2;

export type Scene = { solids: Solid[]; raised: Set<string> };

const polyArea = (p: P2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.z - b.x * a.z; }, 0)) / 2;

function lineSolids(it: Item & { type: 'line' }, m: (p: Pt) => P2, o: SceneOpts): Solid[] {
  if (it.kind === 'arrow' || it.dash !== 'solid' || it.pts.length < 2) return [];
  const pts = it.pts.map(m), first = pts[0], last = pts[pts.length - 1];
  const closed = pts.length > 3 && Math.hypot(first.x - last.x, first.z - last.z) < 0.05;
  if (closed) {
    const poly = pts.slice(0, -1);
    if (polyArea(poly) >= BUILDING_MIN_AREA) return [{ kind: 'building', poly, h: o.buildingH }];
  }
  const out: Solid[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.hypot(b.x - a.x, b.z - a.z) >= MIN_SEG) out.push({ kind: 'wall', a, b, h: o.wallH, t: WALL_T, color: '#d9d6cf' });
  }
  return out;
}

// 部品の種類（カテゴリと部品ID）から、汎用の形と高さを決める。メーカー商品の形は使わない
function objSolid(it: Item & { type: 'obj' }, lib: Map<string, LibItem>, mm: number): Solid | null {
  const L = lib.get(it.ref);
  if (!L || !L.builtin) return null;
  const k = mm / 1000, x = (it.x + it.w / 2) * k, z = (it.y + it.h / 2) * k, w = it.w * k, d = it.h * k, rot = it.rot;
  const id = it.ref.replace(/^b-/, ''), r = Math.min(w, d) / 2, tint = it.color;
  switch (L.cat) {
    case '植栽': {
      if (id === 'palm') return { kind: 'tree', x, z, r, h: 4.5, form: 'palm', color: '#6f9a4a' };
      if (id === 'conifer') return { kind: 'tree', x, z, r, h: Math.max(2, r * 4), form: 'cone', color: '#4f7a3e' };
      if (id === 'agave') return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.8, rot, color: '#7f9c8a' };
      const color = id.includes('maple') || id === 'momiji' ? '#c7793d' : id.includes('olive') ? '#93a886' : id.endsWith('-d') ? '#4f7a3e' : '#78a352';
      return { kind: 'tree', x, z, r, h: Math.max(2.5, r * 2.6), form: 'round', color };
    }
    case '低木':
      if (id.startsWith('wc-hedge')) return { kind: 'box', x, z, w, d, h: 1.2, rot, color: '#5f8b45' };
      return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: id === 'boxwood' ? 0.6 : 0.8, rot, color: id === 'tsutsuji' || id === 'wc-azalea' ? '#c77a9a' : id === 'ajisai' ? '#7f9fd6' : '#5f8b45' };
    case '下草': return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.3, rot, color: '#7aa35c' };
    case '景石': return { kind: 'stone', x, z, rx: w / 2, rz: d / 2, h: Math.min(w, d) * 0.55, rot };
    case '乗り物':
      if (/bicycle|bike|moped/.test(id)) return { kind: 'box', x, z, w: w * 0.6, d, h: 1.0, rot, color: '#555b60' };
      return { kind: 'car', x, z, w: w / 1.14, d, rot, color: tint || '#e9ecef' };
    case 'カーポート': return { kind: 'carport', x, z, w, d, h: 2.3, rot };
    case '照明': return id === 'light1' ? { kind: 'cylinder', x, z, r: 0.05, h: 0.8, color: '#3d3d3d' } : { kind: 'cylinder', x, z, r: 0.06, h: 0.25, color: '#3d3d3d' };
    case 'ガーデンファニチャー':
      if (/table|bico/.test(id)) return { kind: 'cylinder', x, z, r, h: 0.7, color: tint || '#4a4a4a' };
      if (/planter|cobble/.test(id)) return { kind: 'box', x, z, w, d, h: 0.45, rot, color: '#b9b2a6' };
      if (/chair/.test(id)) return { kind: 'box', x, z, w, d, h: 0.8, rot, color: '#4a4a4a' };
      return { kind: 'box', x, z, w, d, h: 0.7, rot, color: '#6b6b6b' };
    case 'キャラクター': return { kind: 'person', x, z, h: 1.6, color: tint || '#3f7fbf' };
    case '未分類':
      if (id === 'gatepost') return { kind: 'box', x, z, w, d, h: 1.4, rot, color: '#d8d5cf' };
      if (id === 'funcpost') return { kind: 'box', x, z, w, d, h: 1.2, rot, color: '#4c4c4c' };
      if (id === 'faucet') return { kind: 'box', x, z, w: w * 0.6, d: d * 0.6, h: 0.9, rot, color: '#bfb9ad' };
      if (id === 'ac') return { kind: 'box', x, z, w, d, h: 0.65, rot, color: '#f2f2f0' };
      return null;
    case 'その他':
      if (id === 'shed') return { kind: 'box', x, z, w, d, h: 1.8, rot, color: '#efefec' };
      if (id === 'cycleport') return { kind: 'carport', x, z, w, d, h: 2.1, rot };
      if (id === 'bench') return { kind: 'box', x, z, w, d, h: 0.45, rot, color: '#c79f72' };
      if (id === 'dryer') return { kind: 'box', x, z, w, d: Math.min(d, 0.06), h: 1.8, rot, color: '#9a9a9a' };
      return null;
  }
  return null;
}

export function buildScene(doc: Doc, lib: LibItem[], o: SceneOpts = DEFAULT_SCENE_OPTS): Scene {
  const k = doc.mmPerPx / 1000, m = (p: Pt): P2 => ({ x: p.x * k, z: p.y * k });
  const libMap = new Map(lib.map(l => [l.id, l]));
  const solids: Solid[] = [], raised = new Set<string>();
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const it of layer.items) {
      if (it.type === 'line') solids.push(...lineSolids(it, m, o));
      else if (it.type === 'shape' && it.shape === 'rect' && it.dash === 'solid') {
        const poly = corners(it.x, it.y, it.w, it.h, it.rot).map(m);
        if (polyArea(poly) >= BUILDING_MIN_AREA) solids.push({ kind: 'building', poly, h: o.buildingH });
      } else if (it.type === 'obj' && !it.hidden) {
        const s = objSolid(it, libMap, doc.mmPerPx);
        // 立体にした部品は地面の絵から外す（二重に見えないように）
        if (s) { solids.push(s); raised.add(it.id); }
      }
    }
  }
  return { solids, raised };
}

// 地面に貼る絵：立体にした部品を除いた図面
export function groundDoc(doc: Doc, raised: Set<string>): Doc {
  return { ...doc, layers: doc.layers.map(l => ({ ...l, items: l.items.filter(i => !raised.has(i.id)) })) };
}

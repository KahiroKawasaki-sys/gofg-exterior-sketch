// 平面図 → 3Dの立体リスト。描画ライブラリに依存しない純粋な変換（テストしやすくするため）。
// 座標は m。図面の x → x、図面の y（下向き）→ z。高さは y（上向き）。
import { type Doc, type Item, type LibItem, type Pt, type Role3, corners, segDist } from './types';

export type P2 = { x: number; z: number };
export type Solid = (
  | { kind: 'wall'; a: P2; b: P2; h: number; t: number; color: string }
  | { kind: 'fence'; a: P2; b: P2; h: number; base: number }
  | { kind: 'gate'; a: P2; b: P2; h: number }
  | { kind: 'building'; poly: P2[]; h: number }
  | { kind: 'tree'; x: number; z: number; r: number; h: number; form: 'round' | 'cone' | 'palm'; color: string }
  | { kind: 'shrub'; x: number; z: number; rx: number; rz: number; h: number; rot: number; color: string }
  | { kind: 'box'; x: number; z: number; w: number; d: number; h: number; rot: number; color: string; y0?: number }
  | { kind: 'car'; x: number; z: number; w: number; d: number; rot: number; color: string }
  | { kind: 'carport'; x: number; z: number; w: number; d: number; h: number; rot: number }
  | { kind: 'cylinder'; x: number; z: number; r: number; h: number; color: string }
  | { kind: 'person'; x: number; z: number; h: number; color: string }
  | { kind: 'stone'; x: number; z: number; rx: number; rz: number; h: number; rot: number }
) & { src?: string };

export type SceneOpts = { wallH: number; buildingH: number };
export const DEFAULT_SCENE_OPTS: SceneOpts = { wallH: 1.2, buildingH: 6 };
// 囲みが建物とみなされる最小の広さ（㎡）。花壇や駐車枠を建物にしないため
export const BUILDING_MIN_AREA = 20;
const WALL_T = 0.12, MIN_SEG = 0.2;

export type Scene = { solids: Solid[]; raised: Set<string> };

const polyArea = (p: P2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.z - b.x * a.z; }, 0)) / 2;

export const ROLE_LABELS: [Role3, string][] = [['auto', '自動'], ['wall', '塀'], ['fence', 'フェンス'], ['gate', '門扉'], ['building', '建物'], ['ground', '地面のまま']];
// 線・図形で3Dの種類を選べるもの
export const canRaise = (it: Item): it is Item & { type: 'line' | 'stroke' | 'shape' } => (it.type === 'line' && it.kind !== 'arrow') || it.type === 'stroke' || it.type === 'shape';
const FENCE_BASE = 0.2, GATE_H = 1.2;

// 手描きの線は点が多いので、壁にする前に間引く（Ramer–Douglas–Peucker）
export function simplify(pts: P2[], tol: number): P2[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist({ x: pts[i].x, y: pts[i].z }, { x: a.x, y: a.z }, { x: b.x, y: b.z });
    if (d > far) { far = d; idx = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

function outline(it: Item & { type: 'line' | 'stroke' | 'shape' }, m: (p: Pt) => P2): { pts: P2[]; closed: boolean } {
  if (it.type === 'shape') {
    if (it.shape === 'rect') { const c = corners(it.x, it.y, it.w, it.h, it.rot).map(m); return { pts: [...c, c[0]], closed: true }; }
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = it.rot * Math.PI / 180, out: P2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24 * Math.PI * 2, x = Math.cos(t) * it.w / 2, y = Math.sin(t) * it.h / 2;
      out.push(m({ x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) }));
    }
    return { pts: out, closed: true };
  }
  let pts = it.pts.map(m);
  if (it.type === 'stroke') pts = simplify(pts, 0.1);
  const f = pts[0], l = pts[pts.length - 1];
  return { pts, closed: pts.length > 3 && Math.hypot(f.x - l.x, f.z - l.z) < 0.05 };
}

// 指定がなければ今までどおり自動で決める：実線の線は塀、20㎡以上の実線の囲み（線・四角）は建物、それ以外は地面のまま
function autoRole(it: Item & { type: 'line' | 'stroke' | 'shape' }, pts: P2[], closed: boolean): Role3 {
  if (it.dash !== 'solid' || it.type === 'stroke') return 'ground';
  const big = closed && polyArea(pts.slice(0, -1)) >= BUILDING_MIN_AREA;
  if (it.type === 'shape') return it.shape === 'rect' && big ? 'building' : 'ground';
  return big ? 'building' : 'wall';
}

// 線・図形の「何であるか」（指定がなければ自動判定）。3DとDXF書き出しで同じ判定を使う
export function resolveRole(it: Item & { type: 'line' | 'stroke' | 'shape' }, mmPerPx: number): Role3 {
  if (it.role3 && it.role3 !== 'auto') return it.role3;
  const k = mmPerPx / 1000, { pts, closed } = outline(it, p => ({ x: p.x * k, z: p.y * k }));
  return autoRole(it, pts, closed);
}

function raiseSolids(it: Item & { type: 'line' | 'stroke' | 'shape' }, m: (p: Pt) => P2, o: SceneOpts): Solid[] {
  if (it.type === 'stroke' ? it.pts.length < 2 : it.type === 'line' && it.pts.length < 2) return [];
  const { pts, closed } = outline(it, m);
  const role = !it.role3 || it.role3 === 'auto' ? autoRole(it, pts, closed) : it.role3;
  const h = it.h3 ? it.h3 / 1000 : null, src = it.id;
  if (role === 'ground') return [];
  if (role === 'building') {
    const poly = closed ? pts.slice(0, -1) : pts;
    return poly.length >= 3 ? [{ kind: 'building', poly, h: h ?? o.buildingH, src }] : [];
  }
  if (role === 'gate') {
    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(b.x - a.x, b.z - a.z) >= MIN_SEG ? [{ kind: 'gate', a, b, h: h ?? GATE_H, src }] : [];
  }
  const out: Solid[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_SEG) continue;
    out.push(role === 'fence' ? { kind: 'fence', a, b, h: h ?? o.wallH, base: FENCE_BASE, src } : { kind: 'wall', a, b, h: h ?? o.wallH, t: WALL_T, color: '#d9d6cf', src });
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
      if (canRaise(it)) solids.push(...raiseSolids(it, m, o));
      else if (it.type === 'obj' && !it.hidden) {
        const s = objSolid(it, libMap, doc.mmPerPx);
        // 立体にした部品は地面の絵から外す（二重に見えないように）
        if (s) { solids.push({ ...s, src: it.id }); raised.add(it.id); }
      }
    }
  }
  return { solids, raised };
}

// 地面に貼る絵：立体にした部品を除いた図面
export function groundDoc(doc: Doc, raised: Set<string>): Doc {
  return { ...doc, layers: doc.layers.map(l => ({ ...l, items: l.items.filter(i => !raised.has(i.id)) })) };
}

// 3D画面で地面をタップしたとき、その近くの線・図形を探す（tol は m）
export function pickRaisable(doc: Doc, p: P2, tol = 0.4): string | null {
  const k = doc.mmPerPx / 1000, q = { x: p.x / k, y: p.z / k }, t = tol / k;
  let best: string | null = null, bestD = t;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    for (const it of l.items) {
      if (!canRaise(it)) continue;
      const { pts } = outline(it, pt => ({ x: pt.x, z: pt.y }));
      for (let i = 1; i < pts.length; i++) {
        const d = segDist(q, { x: pts[i - 1].x, y: pts[i - 1].z }, { x: pts[i].x, y: pts[i].z });
        if (d < bestD) { bestD = d; best = it.id; }
      }
    }
  }
  return best;
}

// 選んだ線・図形の形（m）。3D画面で地面のままの線を光らせるのに使う
export function itemOutline(doc: Doc, id: string): P2[] | null {
  const k = doc.mmPerPx / 1000;
  for (const l of doc.layers) for (const it of l.items) if (it.id === id && canRaise(it)) return outline(it, p => ({ x: p.x * k, z: p.y * k })).pts;
  return null;
}

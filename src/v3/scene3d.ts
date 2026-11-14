// 平面図 → 3Dの立体リスト。描画ライブラリに依存しない純粋な変換（テストしやすくするため）。
// 座標は m。図面の x → x、図面の y（下向き）→ z。高さは y（上向き）。
import { type Doc, type Item, type LibItem, type Pt, type Role3, type Mat3, type ElevFace, type Elevation, type ShapeItem, corners, segDist, uid } from './types';
import { buildingHeight } from './elevation';
import { PERSON_COLORS } from './library';

export type P2 = { x: number; z: number };
export type CarBody = 'sedan' | 'hatch' | 'suv' | 'kei';
export type PropType = 'table' | 'chair' | 'tableset' | 'bench' | 'planter' | 'planterbench' | 'bicycle' | 'motorbike' | 'faucet' | 'ac' | 'dryer' | 'meter';
// join：この線分の終点で次の線分につながる（角をつなぐ）
export type Solid = (
  | { kind: 'wall'; a: P2; b: P2; h: number; t: number; color: string; mat?: Mat3; join?: boolean }
  | { kind: 'fence'; a: P2; b: P2; h: number; base: number; mat?: Mat3; join?: boolean }
  | { kind: 'gate'; a: P2; b: P2; h: number }
  | { kind: 'building'; poly: P2[]; h: number; faces?: Partial<Record<ElevFace, Elevation>>; wallTop?: number }
  | { kind: 'tree'; x: number; z: number; r: number; h: number; form: 'round' | 'multi' | 'cone' | 'palm'; color: string }
  | { kind: 'shrub'; x: number; z: number; rx: number; rz: number; h: number; rot: number; color: string; form?: 'mound' | 'ball' | 'cover' | 'tuft' | 'rosette'; flower?: string }
  | { kind: 'box'; x: number; z: number; w: number; d: number; h: number; rot: number; color: string; y0?: number }
  | { kind: 'car'; x: number; z: number; w: number; d: number; rot: number; color: string; body?: CarBody }
  | { kind: 'carport'; x: number; z: number; w: number; d: number; h: number; rot: number; posts?: 2 | 4 }
  | { kind: 'hedge'; x: number; z: number; w: number; d: number; h: number; rot: number; color: string; flower?: string }
  | { kind: 'gatepost'; x: number; z: number; w: number; d: number; h: number; rot: number; variant: 'wall' | 'func' }
  | { kind: 'shed'; x: number; z: number; w: number; d: number; h: number; rot: number }
  | { kind: 'light'; x: number; z: number; h: number; kind2: 'pole' | 'spot'; rot?: number }
  | { kind: 'cylinder'; x: number; z: number; r: number; h: number; color: string }
  | { kind: 'person'; x: number; z: number; h: number; color: string; rot?: number }
  | { kind: 'stone'; x: number; z: number; rx: number; rz: number; h: number; rot: number }
  | { kind: 'prop'; type: PropType; x: number; z: number; w: number; d: number; rot: number; color?: string }
) & { src?: string };

// elevations：立面図があれば建物の面に貼り、高さも立面図から決める（elevScale で大きさを調整）
export type SceneOpts = { wallH: number; buildingH: number; elevations?: Partial<Record<ElevFace, Elevation>>; elevScale?: number };
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
    if (poly.length < 3) return [];
    const faces = o.elevations && Object.keys(o.elevations).length ? o.elevations : undefined;
    const eh = faces ? buildingHeight(faces, o.elevScale ?? 1) : null;
    return [{ kind: 'building', poly, h: h ?? eh?.h ?? o.buildingH, src, ...(faces && { faces, wallTop: eh?.wallTop }) }];
  }
  if (role === 'gate') {
    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(b.x - a.x, b.z - a.z) >= MIN_SEG ? [{ kind: 'gate', a, b, h: h ?? GATE_H, src }] : [];
  }
  const out: Solid[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_SEG) continue;
    // 次の線分へ続く所（閉じた線は最後も）は、角をつなぐ
    const join = i < pts.length - 1 || closed;
    out.push(role === 'fence' ? { kind: 'fence', a, b, h: h ?? o.wallH, base: FENCE_BASE, src, mat: it.mat3, ...(join && { join }) } : { kind: 'wall', a, b, h: h ?? o.wallH, t: WALL_T, color: '#d9d6cf', src, mat: it.mat3, ...(join && { join }) });
  }
  return out;
}

// 葉の色（図面の部品の色味に合わせる）
const LEAF = { light: '#8fb85e', mid: '#76a64f', dark: '#557f3c', olive: '#9fb08c', autumn: '#cf7445', momiji: '#9cbb68' };
const TREE_COLOR: Record<string, string> = { 'tree-top': LEAF.light, ego: LEAF.light, oak: LEAF.light, chuboku2: LEAF.light, 'wc-symbol': LEAF.light, momiji: LEAF.momiji, olive: LEAF.olive, 'wc-olive': LEAF.olive, 'wc-tree-d': LEAF.dark, 'wc-maple': LEAF.autumn };
// 株立ち（細い幹が数本）で見せる樹種
const MULTI_STEM = new Set(['aodamo', 'june', 'ego', 'shara', 'momiji']);
const CAR_BODY: Record<string, CarBody> = { car4900: 'sedan', car4600: 'sedan', vezel: 'suv', polo: 'hatch', car4300: 'hatch', aqua: 'hatch', kei3500: 'kei', kei3300: 'kei' };
const TABLE_COLOR: Record<string, string> = { table: '#262626', bico: '#2c2c2c', housetable: '#b8875a', circletable: '#5f6164' };

// 部品の種類（カテゴリと部品ID）から、形と高さを決める。メーカー商品の形は使わない
function objSolid(it: Item & { type: 'obj' }, lib: Map<string, LibItem>, mm: number): Solid | null {
  const L = lib.get(it.ref);
  if (!L || !L.builtin) return null;
  const k = mm / 1000, x = (it.x + it.w / 2) * k, z = (it.y + it.h / 2) * k, w = it.w * k, d = it.h * k, rot = it.rot;
  const id = it.ref.replace(/^b-/, ''), r = Math.min(w, d) / 2, tint = it.color || undefined;
  const prop = (type: PropType, color?: string, extraRot = 0): Solid => ({ kind: 'prop', type, x, z, w, d, rot: rot + extraRot, color });
  switch (L.cat) {
    case '植栽': {
      if (id === 'palm') return { kind: 'tree', x, z, r, h: 4.5, form: 'palm', color: '#6f9a4a' };
      if (id === 'conifer') return { kind: 'tree', x, z, r, h: Math.max(2, r * 4), form: 'cone', color: '#4f7a3e' };
      if (id === 'agave') return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.7, rot, color: '#7f9c8a', form: 'rosette' };
      const multi = MULTI_STEM.has(id);
      return { kind: 'tree', x, z, r, h: Math.max(multi ? 3 : 2.5, r * (multi ? 2.9 : 2.6)), form: multi ? 'multi' : 'round', color: TREE_COLOR[id] || LEAF.mid };
    }
    case '低木': {
      if (id.startsWith('wc-hedge')) return { kind: 'hedge', x, z, w, d, h: 1.2, rot, color: '#5f8b45', flower: id === 'wc-hedge-f' ? '#ee6f85' : undefined };
      if (id === 'boxwood') return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: Math.max(0.5, Math.min(w, d) * 0.9), rot, color: '#4f7a3e', form: 'ball' };
      const dark = id === 'wc-shrub-d' || /teiboku[135]/.test(id);
      return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.8, rot, color: dark ? LEAF.dark : '#5f8b45', flower: id === 'tsutsuji' || id === 'wc-azalea' ? '#e883ab' : id === 'ajisai' ? '#8fb0e6' : undefined };
    }
    case '下草': {
      if (id === 'agave2') return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.4, rot, color: '#7f9c8a', form: 'rosette' };
      if (id === 'hosta' || id === 'fukkiso') return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: 0.28, rot, color: id === 'hosta' ? '#8db36a' : LEAF.dark, form: 'cover' };
      // 奇数番の下草・リュウノヒゲは低い株、偶数番・グラスは背のある葉
      const low = id === 'ryunohige' || /shitakusa[135]/.test(id);
      return { kind: 'shrub', x, z, rx: w / 2, rz: d / 2, h: low ? 0.22 : 0.5, rot, color: low ? '#4f7f45' : '#84ab5c', form: 'tuft' };
    }
    case '景石': return { kind: 'stone', x, z, rx: w / 2, rz: d / 2, h: Math.min(w, d) * 0.55, rot };
    case '乗り物':
      if (id === 'bicycle') return prop('bicycle', tint);
      if (id === 'bike' || id === 'moped') return prop('motorbike', tint);
      return { kind: 'car', x, z, w: w / 1.14, d, rot, color: tint || '#e9ecef', body: CAR_BODY[id] || 'hatch' };
    case 'カーポート': return { kind: 'carport', x, z, w, d, h: 2.3, rot, posts: 4 };
    case '照明': return id === 'light1' ? { kind: 'light', x, z, h: 0.8, kind2: 'pole', rot } : { kind: 'light', x, z, h: 0.3, kind2: 'spot', rot: rot + 90 };
    case 'ガーデンファニチャー':
      if (id === 'tableset') return prop('tableset');
      if (/table|bico/.test(id)) return prop('table', tint || TABLE_COLOR[id]);
      if (id === 'cobblebench') return prop('planterbench');
      if (id === 'cobble') return prop('planter');
      if (/chair/.test(id)) return prop('chair', tint, id === 'clickchair' ? 45 : 0); // クリックチェアは図面で45°回した向き
      return null;
    case 'キャラクター': {
      const i = +id.replace('person', '') || 0;
      return { kind: 'person', x, z, h: i === 5 ? 1.15 : 1.65, color: tint || PERSON_COLORS[i] || '#3f7fbf', rot };
    }
    case '門まわり・設備':
    case '未分類':
      if (id === 'gatepost') return { kind: 'gatepost', x, z, w, d, h: 1.4, rot, variant: 'wall' };
      if (id === 'funcpost') return { kind: 'gatepost', x, z, w, d, h: 1.5, rot, variant: 'func' };
      if (id === 'faucet') return prop('faucet');
      if (id === 'ac') return prop('ac');
      if (id === 'meter') return prop('meter');
      return null;
    case 'その他':
      if (id === 'shed') return { kind: 'shed', x, z, w, d, h: 1.9, rot };
      if (id === 'cycleport') return { kind: 'carport', x, z, w, d, h: 2.1, rot, posts: 2 };
      if (id === 'bench') return prop('bench');
      if (id === 'dryer') return prop('dryer');
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

// 図面に「建物」があるか（種類を建物にした線・囲み、または自動で建物になる大きな囲み）
export function hasBuilding(doc: Doc): boolean {
  return doc.layers.some(l => l.items.some(it => canRaise(it) && resolveRole(it, doc.mmPerPx) === 'building'));
}

// 立面図から建物の幅（東西）と奥行き（南北）を出す（m）。南北面の壁の幅＝東西の長さ、東西面の壁の幅＝南北の長さ
export function footprintFromElevations(elev: Partial<Record<ElevFace, Elevation>>): { w: number; d: number } | null {
  const wallM = (e?: Elevation) => e ? ((e.wallU ? e.wallU[1] - e.wallU[0] : 1) * e.w * e.mmPerPx) / 1000 : undefined;
  const w = wallM(elev.S) ?? wallM(elev.N), d = wallM(elev.E) ?? wallM(elev.W);
  if (!w && !d) return null;
  return { w: w ?? d!, d: d ?? w! };
}

// 立面図を図面に入れる。建物の囲みがまだ無ければ、立面図から読んだ大きさの四角を中央（下絵の中心）に置いて建物にする
export function withElevations(doc: Doc, elev: Partial<Record<ElevFace, Elevation>>, center: Pt, rectId = uid()): Doc {
  const next: Doc = { ...doc, elevations: elev, elevScale: doc.elevScale ?? 1 };
  if (hasBuilding(doc)) return next;
  const fp = footprintFromElevations(elev);
  if (!fp) return next;
  const k = 1000 / doc.mmPerPx, w = fp.w * k, h = fp.d * k;
  const c = doc.underlay ? { x: doc.underlay.x + doc.underlay.w / 2, y: doc.underlay.y + doc.underlay.h / 2 } : center;
  const rect: ShapeItem = { id: rectId, type: 'shape', shape: 'rect', color: '#2f3b38', width: 3, dash: 'solid', x: c.x - w / 2, y: c.y - h / 2, w, h, rot: 0, role3: 'building' };
  const target = doc.layers.find(l => l.id === doc.activeLayer && l.kind === 'draw') || doc.layers.find(l => l.kind === 'draw') || doc.layers[0];
  return { ...next, layers: next.layers.map(l => l.id === target.id ? { ...l, items: [...l.items, rect] } : l) };
}

// 自動で置いた建物の四角を、配置図で見つけた位置・向きに動かす
export function placeBuilding(doc: Doc, rectId: string, at: { x: number; y: number; w: number; h: number }): Doc {
  return { ...doc, layers: doc.layers.map(l => ({ ...l, items: l.items.map(it => it.id === rectId && it.type === 'shape' ? { ...it, x: at.x, y: at.y, w: at.w, h: at.h } : it) })) };
}

// 自動集計：素材ごとの面積（㎡）、部品ごとの数、線の種類ごとの長さ（m）。
// 線の種類は3D・DXFと同じ判定（resolveRole）。指定がなく自動で決めたものは「自動判定」と分かるようにする。
import { type Doc, type Item, type LibItem, type Role3 } from './types';
import { resolveRole, canRaise, simplify } from './scene3d';
import { TEXTURES } from './textures';

export type QtyGroup = '素材' | '部品' | '線';
// cat：部品の分類（植栽など）。area：塀・フェンスの立面の面積（長さ×高さ、㎡単価の品目に使う）
export type QtyRow = { key: string; group: QtyGroup; name: string; qty: number; unit: string; ids: string[]; auto?: boolean; role?: Role3; note?: string; cat?: string; area?: number };

// 高さを指定していない塀・フェンスは3Dの標準と同じ 1.2m とみなす
export const DEFAULT_WALL_H = 1.2;

// 施工の対象ではない部品（車・人）は数えない
const SKIP_CATS = new Set(['乗り物', 'キャラクター']);
const UNIT_BY_CAT: Record<string, string> = { 植栽: '本', 低木: '本', 下草: '株', 景石: '個', カーポート: '基', 照明: '台' };
const ROLE_NAME: Record<string, string> = { wall: '塀', fence: 'フェンス', gate: '門扉', building: '建物', ground: '未分類の線' };

export const texDisplayName = (it: Item & { type: 'texture' }) =>
  (it.tex.startsWith('b:') && TEXTURES.find(t => t.id === it.tex.slice(2))?.name) || it.texName || '素材';

// 線の長さ（m）。手描きは細かな揺れを間引いてから測る
export function itemLength(it: Item & { type: 'line' | 'stroke' | 'shape' }, mmPerPx: number): number {
  const k = mmPerPx / 1000;
  if (it.type === 'shape') {
    if (it.shape === 'rect') return 2 * (it.w + it.h) * k;
    const a = it.w / 2, b = it.h / 2; // 楕円の周（ラマヌジャンの近似）
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * k;
  }
  let pts = it.pts.map(p => ({ x: p.x * k, z: p.y * k }));
  if (it.type === 'stroke') pts = simplify(pts, 0.05);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return len;
}

// areas：塗りごとの面積（㎡）。マスク画像から数えるのは画面側（textureAreas）
export function quantities(doc: Doc, lib: LibItem[], areas: Map<string, number> = new Map()): QtyRow[] {
  const rows = new Map<string, QtyRow>();
  const add = (key: string, base: Omit<QtyRow, 'qty' | 'ids' | 'key'>, qty: number, id: string) => {
    const r = rows.get(key) || { key, ...base, qty: 0, ids: [] };
    r.qty += qty; r.ids.push(id); rows.set(key, r);
  };
  const libMap = new Map(lib.map(l => [l.id, l]));
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const it of layer.items) {
      if (it.type === 'texture') {
        const name = texDisplayName(it);
        add('mat:' + name, { group: '素材', name, unit: '㎡' }, areas.get(it.id) ?? 0, it.id);
      } else if (it.type === 'obj' && !it.hidden) {
        const cat = libMap.get(it.ref)?.cat || '自作部品';
        if (SKIP_CATS.has(cat)) continue;
        add('obj:' + it.name, { group: '部品', name: it.name, unit: UNIT_BY_CAT[cat] || '個', cat }, 1, it.id);
      } else if (canRaise(it)) {
        // 点線・破線・手描きで種類を付けていないものは、下書きや補助線とみなして数えない
        const explicit = !!it.role3 && it.role3 !== 'auto', role = resolveRole(it, doc.mmPerPx);
        if (!explicit && (it.dash !== 'solid' || it.type === 'stroke')) continue;
        const key = 'line:' + role, name = ROLE_NAME[role] || '線';
        if (role === 'building') add(key, { group: '線', name, unit: '棟', role }, 1, it.id);
        else if (role === 'gate') add(key, { group: '線', name, unit: '箇所', role }, 1, it.id);
        else {
          const len = itemLength(it, doc.mmPerPx);
          add(key, { group: '線', name, unit: 'm', role }, len, it.id);
          if (role === 'wall' || role === 'fence') { const r = rows.get(key)!; r.area = (r.area || 0) + len * (it.h3 ? it.h3 / 1000 : DEFAULT_WALL_H); }
        }
        if (!explicit) rows.get(key)!.auto = true;
      }
    }
  }
  const order: QtyGroup[] = ['素材', '線', '部品'];
  return [...rows.values()]
    .map(r => ({ ...r, qty: r.unit === '㎡' || r.unit === 'm' ? Math.round(r.qty * 10) / 10 : r.qty, ...(r.area != null && { area: Math.round(r.area * 10) / 10 }) }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.qty - a.qty);
}

// Excel でそのまま開けるCSV（先頭にBOM）
export function quantitiesCsv(rows: QtyRow[], title: string): string {
  const q = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = [`# ${title}`, '区分,品目,数量,単位,備考', ...rows.map(r => [r.group, r.name, String(r.qty), r.unit, r.auto ? '自動判定を含む' : ''].map(q).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// 画面側：塗りのマスク画像の塗られた画素を数えて面積（㎡）にする
export async function textureAreas(doc: Doc, maxPx = 800): Promise<Map<string, number>> {
  const out = new Map<string, number>(), k = doc.mmPerPx / 1000;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    for (const it of l.items) {
      if (it.type !== 'texture') continue;
      try {
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(Error('mask')); img.src = it.mask; });
        const s = Math.min(1, maxPx / Math.max(img.width, img.height)), W = Math.max(1, Math.round(img.width * s)), H = Math.max(1, Math.round(img.height * s));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
        out.set(it.id, on / (W * H) * (it.w * k) * (it.h * k));
      } catch { /* 読めないマスクは 0㎡ として続ける */ }
    }
  }
  return out;
}

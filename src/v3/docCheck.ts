// 読み込む編集データ（.garden3.json・クラウド）の検査。細工されたファイルで画面に任意のコードを入れられないよう、
// 型・文字の種類・長さを確かめる。画面に出す側（markup.ts）でもエスケープするので、ここは「明らかにおかしいものを断る」役。
import { type Doc } from './types';
import { isColor } from './markup';

const NOT_V3 = 'このファイルは外構スケッチv0.3の編集データではありません';
const LIMIT = { id: 200, name: 500, text: 20000, layers: 1000, items: 200000, pts: 200000, guides: 2000 };
const ITEM_TYPES = new Set(['stroke', 'line', 'shape', 'dim', 'text', 'obj', 'texture']);
const LAYER_KINDS = new Set(['draw', 'text', 'fill', 'texture', 'object']);
const GUIDE_TYPES = new Set(['line', 'slope', 'face', 'circle', 'curve', 'golden', 'grid', 'ruler']);

class Bad extends Error {}
const bad = (where: string): never => { throw new Bad(where); };
const obj = (v: unknown, where: string) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad(where));
const arr = (v: unknown, max: number, where: string) => (Array.isArray(v) && v.length <= max ? v : bad(where));
const num = (v: unknown, where: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad(where); };
const optNum = (v: unknown, where: string) => { if (v !== undefined) num(v, where); };
const str = (v: unknown, max: number, where: string) => { if (typeof v !== 'string' || v.length > max) bad(where); };
const optStr = (v: unknown, max: number, where: string) => { if (v !== undefined && v !== null) str(v, max, where); };
const optBool = (v: unknown, where: string) => { if (v !== undefined && typeof v !== 'boolean') bad(where); };
const color = (v: unknown, where: string) => { if (!isColor(v)) bad(where); };
const optColor = (v: unknown, where: string) => { if (v !== undefined && v !== null) color(v, where); };
// 画像は埋め込み（data:）だけ。外部URLや javascript: は断る
const image = (v: unknown, where: string) => { if (typeof v !== 'string' || !/^data:[\w.+-]*\/?[\w.+-]*[;,]/i.test(v)) bad(where); };
const pt = (v: unknown, where: string) => { const p = obj(v, where); num(p.x, where); num(p.y, where); optNum(p.p, where); };
const pts = (v: unknown, where: string) => { for (const p of arr(v, LIMIT.pts, where)) pt(p, where); };

function item(v: unknown) {
  const it = obj(v, '図形');
  str(it.id, LIMIT.id, '図形のID');
  if (typeof it.type !== 'string' || !ITEM_TYPES.has(it.type)) bad('図形の種類');
  optStr(it.role3, 20, '3Dの種類'); optNum(it.h3, '3Dの高さ'); optStr(it.mat3, 20, '3Dの見た目');
  switch (it.type) {
    case 'stroke': case 'line':
      color(it.color, '線の色'); num(it.width, '線の太さ'); optStr(it.dash, 20, '線の種類'); optStr(it.brush, 20, 'ブラシ'); optStr(it.kind, 20, '線の種類'); pts(it.pts, '線の点'); break;
    case 'shape':
      color(it.color, '図形の色'); num(it.width, '線の太さ'); optStr(it.dash, 20, '線の種類'); str(it.shape, 20, '図形の形');
      for (const k of ['x', 'y', 'w', 'h', 'rot']) num(it[k], '図形の位置'); break;
    case 'dim':
      color(it.color, '寸法の色'); num(it.width, '寸法の太さ'); pt(it.a, '寸法の位置'); pt(it.b, '寸法の位置'); optNum(it.size, '寸法の文字'); break;
    case 'text':
      str(it.text, LIMIT.text, '文字'); color(it.color, '文字の色'); optColor(it.bg, '文字の背景'); optColor(it.border, '文字の枠');
      for (const k of ['x', 'y', 'size', 'rot']) num(it[k], '文字の位置'); break;
    case 'obj':
      str(it.ref, LIMIT.id, '部品'); optStr(it.name, LIMIT.name, '部品の名前'); optColor(it.color, '部品の色');
      optBool(it.flip, '部品の反転'); optBool(it.hidden, '部品の表示'); optBool(it.locked, '部品の固定');
      for (const k of ['x', 'y', 'w', 'h', 'rot']) num(it[k], '部品の位置'); break;
    case 'texture':
      image(it.mask, '塗りの範囲');
      if (typeof it.tex !== 'string' || !(/^b:[\w-]{1,60}$/.test(it.tex) || /^data:image\//i.test(it.tex))) bad('塗りの素材');
      optStr(it.name, LIMIT.name, '塗りの名前'); optStr(it.texName, LIMIT.name, '塗りの名前');
      for (const k of ['x', 'y', 'w', 'h', 'scale', 'rot', 'hue', 'sat', 'bright', 'contrast']) num(it[k], '塗りの設定'); break;
  }
}

function check(v: unknown) {
  const d = obj(v, '全体');
  str(d.id, LIMIT.id, 'ID'); str(d.name, LIMIT.name, '名前'); optStr(d.updatedAt, 64, '更新日時'); optStr(d.activeLayer, LIMIT.id, 'レイヤー');
  num(d.mmPerPx, '縮尺');
  let count = 0;
  for (const l of arr(d.layers, LIMIT.layers, 'レイヤー')) {
    const L = obj(l, 'レイヤー');
    str(L.id, LIMIT.id, 'レイヤーのID'); str(L.name, LIMIT.name, 'レイヤーの名前');
    if (typeof L.kind !== 'string' || !LAYER_KINDS.has(L.kind)) bad('レイヤーの種類');
    optBool(L.visible, 'レイヤーの表示'); optBool(L.locked, 'レイヤーの固定'); optNum(L.opacity, 'レイヤーの濃さ');
    const items = arr(L.items, LIMIT.items, '図形'); count += items.length; if (count > LIMIT.items) bad('図形の数');
    items.forEach(item);
  }
  for (const g of arr(d.guides, LIMIT.guides, 'ガイド')) {
    const G = obj(g, 'ガイド');
    str(G.id, LIMIT.id, 'ガイドのID'); optStr(G.name, LIMIT.name, 'ガイドの名前');
    if (typeof G.type !== 'string' || !GUIDE_TYPES.has(G.type)) bad('ガイドの種類');
    pt(G.a, 'ガイドの位置'); pt(G.b, 'ガイドの位置'); if (G.c !== undefined) pt(G.c, 'ガイドの位置');
    optBool(G.visible, 'ガイドの表示'); optBool(G.locked, 'ガイドの固定'); optNum(G.hA, 'ガイドの高さ'); optNum(G.hB, 'ガイドの高さ'); optNum(G.spacing, 'ガイドの間隔');
  }
  if (d.underlay !== undefined) {
    const u = obj(d.underlay, '下絵');
    image(u.src, '下絵の画像'); optStr(u.name, LIMIT.name, '下絵の名前');
    for (const k of ['x', 'y', 'w', 'h', 'opacity']) num(u[k], '下絵の位置');
  }
  if (d.view !== undefined) { const w = obj(d.view, '表示位置'); for (const k of ['x', 'y', 'k', 'r']) num(w[k], '表示位置'); }
  if (d.elevations !== undefined) {
    for (const [face, e] of Object.entries(obj(d.elevations, '立面図'))) {
      if (!['N', 'E', 'S', 'W'].includes(face)) bad('立面図の向き');
      if (e === undefined) continue;
      const E = obj(e, '立面図'); image(E.src, '立面図の画像'); num(E.w, '立面図の大きさ'); num(E.h, '立面図の大きさ'); num(E.mmPerPx, '立面図の縮尺');
    }
  }
  optNum(d.elevScale, '立面図の大きさ');
  if (d.elevStyle !== undefined) { const s = obj(d.elevStyle, '家の色'); optColor(s.wall, '外壁の色'); optColor(s.roof, '屋根の色'); }
  if (d.est !== undefined) obj(d.est, '見積');
  if (d.meeting !== undefined) obj(d.meeting, '打ち合わせ');
}

export function validDoc(v: unknown): Doc {
  const d = v as Doc;
  if (!d || typeof d !== 'object' || d.schema !== 3 || typeof d.id !== 'string' || !Array.isArray(d.layers) || !Array.isArray(d.guides)) throw Error(NOT_V3);
  try { check(d); } catch (e) {
    if (e instanceof Bad) throw Error(`編集データの中身が正しくないため開けません（${e.message}）`);
    throw e;
  }
  return d;
}

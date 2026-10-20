// 商品ボード：会社で実際に使うメーカー品の一覧。単価表（PriceBook）の品目に、メーカー・型番・寸法・公式ページを足したもの。
// 中身は会社が自分で登録する（建材サーチ等のサイトから自動で取り込まない：規約で複製が禁止されているため）。
// 画像や細かい仕様は公式ページへのリンクで見る。
import { type ObjItem, type LibItem, type Pt, uid } from './types';
import { type PriceBook, type PriceItem, safeUrl } from './estimate';
import { TEXTURES } from './textures';

// 分類ごとの単位と、図面での使い方（lib：置くときの平面記号、use：結び付けられる図面の項目）
export type BoardCat = { cat: string; unit: string; lib?: string; use?: 'line' | 'mat' };
export const BOARD_CATS: BoardCat[] = [
  { cat: 'フェンス', unit: 'm', use: 'line' },
  { cat: '門扉', unit: '箇所', use: 'line' },
  { cat: 'ブロック・塀', unit: '㎡', use: 'line' },
  { cat: 'カーポート', unit: '基', lib: 'b-carport1' },
  { cat: 'サイクルポート', unit: '基', lib: 'b-cycleport' },
  { cat: '物置', unit: '基', lib: 'b-shed' },
  { cat: '機能門柱・ポスト', unit: '基', lib: 'b-funcpost' },
  { cat: '表札・インターホン', unit: '個' },
  { cat: '照明', unit: '台', lib: 'b-light1' },
  { cat: '立水栓', unit: '基', lib: 'b-faucet' },
  { cat: '舗装材', unit: '㎡', use: 'mat' },
  { cat: '植栽', unit: '本', lib: 'b-wc-tree-m' },
  { cat: 'その他', unit: '個' },
];
export const boardCat = (cat: string) => BOARD_CATS.find(c => c.cat === cat);

// 線の項目（集計の line:〜）と素材（mat:〜）
export const LINE_USES: [string, string][] = [['line:fence', 'フェンスの線'], ['line:gate', '門扉の線'], ['line:wall', '塀の線']];
export const matUses = (): [string, string][] => TEXTURES.filter(t => t.name !== '水面').map(t => ['mat:' + t.name, t.name + '（素材）']);

export const boardItems = (b: PriceBook) => b.items.filter(i => i.board);

// この商品が見積で使われている所（単価表の結び付け）
export function usesOf(b: PriceBook, id: string): string[] {
  const label = (k: string) => LINE_USES.find(([u]) => u === k)?.[1] || (k.startsWith('mat:') ? k.slice(4) + '（素材）' : k.startsWith('obj:') ? '図面の「' + k.slice(4) + '」' : k.startsWith('cat:') ? k.slice(4) + 'の部品' : k);
  return Object.entries(b.links).filter(([, ids]) => ids.includes(id)).map(([k]) => label(k));
}

// 線・素材の項目に、この商品を使う（同じ項目に結び付いていた品目は外れる）
export const useFor = (b: PriceBook, key: string, id: string): PriceBook => ({ ...b, links: { ...b.links, [key]: [id] } });

// 入力フォームの中身 → 品目。売値（単価）と商品名は必須
export type ProductForm = { cat: string; name: string; unit: string; price: string; cost: string; maker: string; model: string; w: string; d: string; h: string; color: string; list: string; url: string; note: string };
export const emptyForm = (cat = 'フェンス'): ProductForm => ({ cat, name: '', unit: boardCat(cat)?.unit || '個', price: '', cost: '', maker: '', model: '', w: '', d: '', h: '', color: '', list: '', url: '', note: '' });
export const formOf = (i: PriceItem): ProductForm => {
  const s = (v?: number | string) => v == null ? '' : String(v);
  return { cat: i.cat, name: i.name, unit: i.unit, price: s(i.price), cost: s(i.cost), maker: s(i.maker), model: s(i.model), w: s(i.w), d: s(i.d), h: s(i.h), color: s(i.color), list: s(i.list), url: s(i.url), note: s(i.note) };
};
const num = (s: string) => { const v = parseFloat(s.normalize('NFKC').replace(/[,¥円\s]/g, '')); return isFinite(v) && v > 0 ? v : undefined; };

export function productFrom(f: ProductForm, id?: string): { item?: PriceItem; error?: string } {
  const name = f.name.trim(), price = num(f.price);
  if (!name) return { error: '商品名を入れてください' };
  if (!price) return { error: '売値（単価）を入れてください' };
  if (f.url.trim() && !safeUrl(f.url)) return { error: '公式ページは https:// から始まるアドレスを入れてください' };
  const t = (s: string) => s.trim() || undefined;
  const item: PriceItem = {
    id: id || 'g-' + uid(), cat: f.cat || 'その他', name, unit: f.unit.trim() || boardCat(f.cat)?.unit || '個', price, board: true,
    cost: num(f.cost), maker: t(f.maker), model: t(f.model), w: num(f.w), d: num(f.d), h: num(f.h), color: t(f.color), list: num(f.list), url: safeUrl(f.url) || undefined, note: t(f.note),
  };
  for (const k of Object.keys(item) as (keyof PriceItem)[]) if (item[k] === undefined) delete item[k];
  return { item };
}

// 商品を足す・直す（直したときは見積の結び付けをそのまま残す）
export function saveProduct(b: PriceBook, it: PriceItem): PriceBook {
  const has = b.items.some(i => i.id === it.id);
  return { ...b, items: has ? b.items.map(i => i.id === it.id ? it : i) : [...b.items, it], updatedAt: new Date().toISOString() };
}
export function removeProduct(b: PriceBook, id: string): PriceBook {
  const links: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(b.links)) { const rest = ids.filter(x => x !== id); if (rest.length) links[k] = rest; }
  return { ...b, items: b.items.filter(i => i.id !== id), links, updatedAt: new Date().toISOString() };
}

// まとめて読み込んだ商品を足す（単価表の他の品目は残す）。同じ分類・商品名・型番のものは中身を入れ替え、見積の結び付けは保つ
export function mergeProducts(b: PriceBook, imported: PriceItem[]): { book: PriceBook; added: number; updated: number } {
  const key = (i: PriceItem) => i.cat + '/' + i.name + '/' + (i.model || '');
  const byKey = new Map(b.items.filter(i => !i.prov).map(i => [key(i), i.id]));
  let items = [...b.items], added = 0, updated = 0;
  for (const it of imported) {
    const id = byKey.get(key(it)), next = { ...it, board: true };
    if (id) { items = items.map(i => i.id === id ? { ...next, id } : i); updated++; }
    else { items.push(next); byKey.set(key(it), it.id); added++; }
  }
  return { book: { ...b, items, updatedAt: new Date().toISOString() }, added, updated };
}

// 図面に置く部品。記号は分類の標準部品を使い、幅・奥行が入っていれば実寸にする。
// 名前を商品名にして、集計の「obj:商品名」をこの商品に結び付ける
export function productObj(p: PriceItem, lib: LibItem[], mmPerPx: number, at: Pt): { obj: ObjItem; key: string } | null {
  const ref = boardCat(p.cat)?.lib, l = ref && lib.find(x => x.id === ref);
  if (!l) return null;
  const w = p.w ? p.w / mmPerPx : l.w, h = p.d ? p.d / mmPerPx : l.h;
  return { obj: { id: uid(), type: 'obj', ref: l.id, name: p.name, x: at.x - w / 2, y: at.y - h / 2, w, h, rot: 0, flip: false, color: null }, key: 'obj:' + p.name };
}

export const sizeText = (i: PriceItem) => {
  const parts = ([['W', i.w], ['D', i.d], ['H', i.h]] as const).filter(([, v]) => v).map(([k, v]) => k + v);
  return parts.length ? parts.join('×') + 'mm' : '';
};

// 一括登録のひな形（＊で始まる行は読み込まれない見本）
export function boardTemplate(): string[][] {
  return [
    ['分類', '品目', '単位', '単価', '原価', 'メーカー', '型番', '幅mm', '奥行mm', '高さmm', '色', '定価', '公式ページURL', 'メモ', '商品ボード'],
    ['フェンス', '＊見本）アルミ目隠しフェンス H1000', 'm', '18000', '11000', '〇〇メーカー', 'ABC-1000', '', '', '1000', 'ブラウン', '25000', 'https://www.example.com/', '1行目は見本です。＊で始まる行は読み込まれません', '○'],
  ];
}

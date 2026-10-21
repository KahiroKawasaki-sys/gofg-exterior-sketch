// 仕様書（マテリアルボード）：図面で使った素材・塀やフェンス・部品を、写真＋品名＋メーカー・色のカードで並べる。
// 写真は単価表の品目に登録したもの。まだなければ図面の質感・部品の絵で代わりに見せる（登録ゼロでも形になる）。
import { type Doc, type Item, type LibItem } from './types';
import { type QtyRow, type QtyGroup } from './quantities';
import { type PriceBook, type PriceItem, linkFor } from './estimate';
import { SHARED_DEFS } from './markup';

export type BoardPic =
  | { kind: 'photo'; src: string }      // 単価表に登録した写真
  | { kind: 'texture'; tex: string }    // 図面で塗った質感（b:素材ID か画像）
  | { kind: 'symbol'; lib: string }     // 部品の平面図記号
  | { kind: 'line'; role: string }      // 塀・フェンス・門扉の簡単な絵
  | { kind: 'none' };
// title：図面での名前（芝生・オリーブ等）、product：結び付けた品目名、spec：メーカー / 品番 / 色、item：写真などを登録する品目
export type BoardCard = { key: string; group: QtyGroup; cat: string; title: string; product: string; spec: string; qty: string; item?: string; pic: BoardPic; ids: string[] };

export const BOARD_SECTIONS: [QtyGroup, string][] = [['素材', '舗装・植栽地'], ['線', '塀・フェンス・門扉'], ['部品', '植栽・設備']];
const LINE_CAT: Record<string, string> = { wall: '塀', fence: 'フェンス', gate: '門扉' };
const num = (n: number) => n.toLocaleString('ja-JP', { maximumFractionDigits: 1 });

export const specText = (i?: PriceItem) => i ? [i.maker, i.model, i.color].filter(Boolean).join(' / ') : '';

// 部品の記号を、線の色を決めて単独のSVGにする（画面の確認とPDFの両方で使う）
export function symbolSvg(l: LibItem, color = '#2f3b38') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${l.vw} ${l.vh}" width="${l.vw}" height="${l.vh}" color="${color}" overflow="visible"><defs>${SHARED_DEFS}</defs>${l.svg}</svg>`;
}

function findItem(doc: Doc, id: string): Item | undefined {
  for (const l of doc.layers) { const it = l.items.find(x => x.id === id); if (it) return it; }
}

export function boardCards(rows: QtyRow[], book: PriceBook, doc: Doc, lib: LibItem[]): BoardCard[] {
  const items = new Map(book.items.map(i => [i.id, i])), libIds = new Set(lib.map(l => l.id));
  const out: BoardCard[] = [];
  for (const row of rows) {
    // 建物と、種類の分からない線は仕様書に載せない
    if (row.role === 'building' || row.role === 'ground') continue;
    const linked = linkFor(book, row).map(id => items.get(id)).filter((i): i is PriceItem => !!i);
    // 写真を登録する先：写真のある品目 → 会社の品目 → 仮の品目
    const main = linked.find(i => i.img) || linked.find(i => !i.prov) || linked[0];
    let pic: BoardPic = { kind: 'none' };
    if (main?.img) pic = { kind: 'photo', src: main.img };
    else if (row.group === '素材') { const it = row.ids.map(id => findItem(doc, id)).find(i => i?.type === 'texture'); if (it?.type === 'texture') pic = { kind: 'texture', tex: it.tex }; }
    else if (row.group === '部品') { const it = row.ids.map(id => findItem(doc, id)).find(i => i?.type === 'obj'); if (it?.type === 'obj' && libIds.has(it.ref)) pic = { kind: 'symbol', lib: it.ref }; }
    else if (row.role && LINE_CAT[row.role]) pic = { kind: 'line', role: row.role };
    const cat = row.cat || (row.role && LINE_CAT[row.role]) || main?.cat || BOARD_SECTIONS.find(([g]) => g === row.group)![1];
    out.push({
      key: row.key, group: row.group, cat, title: row.name,
      product: linked.map(i => i.name).join('＋'), spec: specText(linked.find(i => specText(i)) || main),
      qty: row.qty ? `${num(row.qty)}${row.unit}` : '', item: main?.id, pic, ids: row.ids,
    });
  }
  return out;
}

// ---- 配置（A4縦・4列）。数字は mm。描く側（boardPdf）と画面の確認で同じ配置を使う ----
export const BOARD = { left: 14, right: 196, top: 36, bottom: 276, cols: 4, gap: 4, head: 9, rowGap: 5 } as const;
export const cardW = (BOARD.right - BOARD.left - BOARD.gap * (BOARD.cols - 1)) / BOARD.cols;
export const picH = cardW * 0.75;
export const cardH = picH + 21; // 写真＋分類・名前・品名2行・メーカー
export type BoardSlot = { kind: 'head'; text: string; y: number } | { kind: 'card'; card: BoardCard; x: number; y: number };

export function layoutBoard(cards: BoardCard[]): BoardSlot[][] {
  const pages: BoardSlot[][] = [[]];
  let y: number = BOARD.top;
  const room = (h: number) => y + h <= BOARD.bottom;
  const newPage = () => { pages.push([]); y = BOARD.top; };
  for (const [g, label] of BOARD_SECTIONS) {
    const cs = cards.filter(c => c.group === g); if (!cs.length) continue;
    // 見出しだけがページの最後に残らないよう、見出し＋1段分が入らなければ次のページへ
    if (!room(BOARD.head + cardH)) newPage();
    pages[pages.length - 1].push({ kind: 'head', text: label, y }); y += BOARD.head;
    for (let i = 0; i < cs.length; i += BOARD.cols) {
      if (!room(cardH)) newPage();
      cs.slice(i, i + BOARD.cols).forEach((card, k) => pages[pages.length - 1].push({ kind: 'card', card, x: BOARD.left + k * (cardW + BOARD.gap), y }));
      y += cardH + BOARD.rowGap;
    }
    y += 2;
  }
  return pages;
}

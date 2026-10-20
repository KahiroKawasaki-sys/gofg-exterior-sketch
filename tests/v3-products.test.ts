// 商品ボード：商品の登録・読み込み・単価表との行き来・図面に置く部品
import { it, expect } from 'vitest';
import { buildEstimate, defaultBook, importItems, parseCsv, parsePriceTable, priceBookCsv, safeUrl, tableCsv, type PriceItem } from '../src/v3/estimate';
import { boardItems, boardTemplate, emptyForm, mergeProducts, productFrom, productObj, removeProduct, saveProduct, usesOf, useFor } from '../src/v3/products';
import { builtinLibrary } from '../src/v3/library';
import { type QtyRow } from '../src/v3/quantities';

const product = (over: Partial<ReturnType<typeof emptyForm>> = {}) => productFrom({ ...emptyForm('カーポート'), name: 'カーポートA 1台用', price: '280,000', maker: 'メーカーA', model: 'CP-1', w: '2700', d: '5000', url: 'https://www.example.com/cp', ...over });

it('フォームから商品を作る（必須・数字・リンクの確かめ）', () => {
  const r = product();
  expect(r.item).toMatchObject({ cat: 'カーポート', name: 'カーポートA 1台用', unit: '基', price: 280000, maker: 'メーカーA', model: 'CP-1', w: 2700, d: 5000, url: 'https://www.example.com/cp', board: true });
  expect(r.item!.id.startsWith('g-')).toBe(true);
  expect('cost' in r.item!).toBe(false);
  expect(product({ name: ' ' }).error).toMatch('商品名');
  expect(product({ price: '' }).error).toMatch('売値');
  expect(product({ url: 'javascript:alert(1)' }).error).toMatch('https://');
  expect(safeUrl('ftp://x')).toBe('');
});

it('登録した商品は見積の品目になり、図面に置くと実寸の部品になって金額に入る', () => {
  const p = product().item!, lib = builtinLibrary();
  let book = saveProduct(defaultBook(), p);
  expect(boardItems(book).map(i => i.name)).toEqual(['カーポートA 1台用']);
  const r = productObj(p, lib, 10, { x: 500, y: 500 })!;
  expect(r.obj).toMatchObject({ ref: 'b-carport1', name: 'カーポートA 1台用', w: 270, h: 500, x: 365, y: 250 });
  book = useFor(book, r.key, p.id);
  expect(usesOf(book, p.id)).toEqual(['図面の「カーポートA 1台用」']);
  const rows: QtyRow[] = [{ key: r.key, group: '部品', name: p.name, qty: 1, unit: '基', ids: [r.obj.id], cat: 'カーポート' }];
  expect(buildEstimate(rows, book).lines[0]).toMatchObject({ name: 'カーポートA 1台用', amount: 280000 });
  // 置く記号のない分類
  expect(productObj({ ...p, cat: '表札・インターホン' }, lib, 10, { x: 0, y: 0 })).toBeNull();
  // 消すと結び付けも外れる
  book = removeProduct(book, p.id);
  expect(boardItems(book)).toEqual([]);
  expect(book.links[r.key]).toBeUndefined();
});

it('フェンスの商品を図面のフェンスの線に使う', () => {
  const f = productFrom({ ...emptyForm('フェンス'), name: '目隠しフェンス H1000', price: '18000' }).item!;
  const book = useFor(saveProduct(defaultBook(), f), 'line:fence', f.id);
  const e = buildEstimate([{ key: 'line:fence', group: '線', name: 'フェンス', qty: 12, unit: 'm', ids: ['a'], role: 'fence' }], book);
  expect(e.lines[0]).toMatchObject({ name: '目隠しフェンス H1000', qty: 12, unit: 'm', amount: 216000 });
  expect(usesOf(book, f.id)).toEqual(['フェンスの線']);
});

it('ひな形・単価表CSVを読むと、メーカー・型番・寸法・定価・リンクも入る（＊の見本行は読まない）', () => {
  const rows = boardTemplate();
  rows.push(['物置', '物置B', '基', '150000', '90000', 'メーカーB', 'SB-1', '2000', '900', '1800', 'グレー', '200000', 'https://www.example.com/sb', '', '○']);
  rows.push(['機能門柱・ポスト', '門柱C', '基', '98000', '', '', '', '', '', '', '', '', 'javascript:alert(1)', '', '']);
  const items = parsePriceTable(parseCsv(tableCsv(rows)));
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ cat: '物置', name: '物置B', maker: 'メーカーB', model: 'SB-1', w: 2000, d: 900, h: 1800, color: 'グレー', list: 200000, cost: 90000, url: 'https://www.example.com/sb', board: true });
  expect(items[1].url).toBeUndefined();
  expect(items[1].board).toBeUndefined();
  // 単価表CSVに書き出して読み直しても同じ
  const book = { ...defaultBook(), items: [...defaultBook().items, ...items] };
  const again = parsePriceTable(parseCsv(priceBookCsv(book)));
  expect(again.find(i => i.name === '物置B')).toMatchObject({ maker: 'メーカーB', model: 'SB-1', w: 2000, list: 200000, board: true });
  // 昔の単価表（商品ボードの列なし）もそのまま読める
  expect(parsePriceTable([['分類', '品目', '単位', '単価'], ['土間', '土間打ち 刷毛引き', '㎡', '9000']])[0]).toEqual({ id: 'i-土間/土間打ち 刷毛引き/㎡', cat: '土間', name: '土間打ち 刷毛引き', unit: '㎡', price: 9000 });
});

it('商品をまとめて読み込んでも単価表のほかの品目は残り、同じ商品は入れ替わって結び付けが保たれる', () => {
  const master: PriceItem = { id: 'i-土間/土間打ち/㎡', cat: '土間', name: '土間打ち', unit: '㎡', price: 9000 };
  const p = product().item!;
  let book = useFor(saveProduct({ ...defaultBook(), items: [master] }, p), 'obj:' + p.name, p.id);
  const r = mergeProducts(book, [
    { id: 'i-x', cat: 'カーポート', name: 'カーポートA 1台用', unit: '基', price: 300000, model: 'CP-1' },
    { id: 'i-y', cat: '照明', name: 'ポールライトD', unit: '台', price: 32000 },
  ]);
  expect(r).toMatchObject({ added: 1, updated: 1 });
  book = r.book;
  expect(book.items.map(i => i.name)).toEqual(['土間打ち', 'カーポートA 1台用', 'ポールライトD']);
  expect(book.items.find(i => i.name === 'カーポートA 1台用')).toMatchObject({ id: p.id, price: 300000, board: true });
  expect(book.links['obj:' + p.name]).toEqual([p.id]);
});

it('単価表を読み込み直しても、商品ボードの商品と結び付けは消えない', () => {
  const p = product().item!;
  const book = useFor(saveProduct(defaultBook(), p), 'obj:' + p.name, p.id);
  const r = importItems(book, [{ id: 'i-土間/土間打ち 刷毛引き/㎡', cat: '土間', name: '土間打ち 刷毛引き', unit: '㎡', price: 9000 }], '御社単価');
  expect(r.book.items.some(i => i.id === p.id)).toBe(true);
  expect(r.book.links['obj:' + p.name]).toEqual([p.id]);
  expect(r.book.links['mat:土間コンクリート']).toEqual(['i-土間/土間打ち 刷毛引き/㎡']);
});

it('図面に置ける分類の記号は、どれも標準部品にある', async () => {
  const { BOARD_CATS } = await import('../src/v3/products');
  const ids = new Set(builtinLibrary().map(l => l.id));
  for (const c of BOARD_CATS.filter(c => c.lib)) expect(ids.has(c.lib!), c.cat).toBe(true);
});

it('商品ボードに商品を足しただけなら、単価表はまだ「仮の単価」のまま', async () => {
  const { isProvisional } = await import('../src/v3/estimate');
  expect(isProvisional(saveProduct(defaultBook(), product().item!))).toBe(true);
});

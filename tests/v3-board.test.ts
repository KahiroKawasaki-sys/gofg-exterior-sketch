import { it, expect } from 'vitest';
import { quantities } from '../src/v3/quantities';
import { builtinLibrary } from '../src/v3/library';
import { newDoc, uid, type Doc, type Item } from '../src/v3/types';
import { defaultBook, parsePriceTable, importItems, priceBookCsv, parseCsv } from '../src/v3/estimate';
import { boardCards, layoutBoard, BOARD, cardH, type BoardCard } from '../src/v3/materialBoard';

const lib = builtinLibrary();
const withItems = (items: Item[]): Doc => { const d = newDoc(); return { ...d, layers: d.layers.map((l, i) => i === 1 ? { ...l, items } : l) }; };
const line = (pts: [number, number][], extra: Partial<Item & { type: 'line' }> = {}): Item =>
  ({ id: uid(), type: 'line', kind: 'polyline', color: '#000', width: 3, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra }) as Item;
const obj = (ref: string): Item => { const l = lib.find(v => v.id === ref)!; return { id: uid(), type: 'obj', ref, name: l.name, x: 0, y: 0, w: l.w, h: l.h, rot: 0, flip: false, color: null }; };
const tex = (t: string, name: string): Item => ({ id: uid(), type: 'texture', name, mask: '', x: 0, y: 0, w: 100, h: 100, tex: t, texName: name, scale: 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100 });

it('写真がなければ素材は質感・部品は記号・フェンスは線の絵で代わりに見せ、建物は載せない', () => {
  const lawn = tex('b:lawn', '芝生（やわらか）');
  const doc = withItems([lawn, obj('b-wc-symbol'), line([[0, 0], [500, 0]], { role3: 'fence' }), line([[0, 0], [600, 0], [600, 500], [0, 500], [0, 0]])]);
  const cards = boardCards(quantities(doc, lib, new Map([[lawn.id, 20]])), defaultBook(), doc, lib);
  const by = (t: string) => cards.find(c => c.title === t)!;
  expect(by('芝生（やわらか）')).toMatchObject({ group: '素材', pic: { kind: 'texture', tex: 'b:lawn' }, product: '天然芝張り（材工）', qty: '20㎡', item: 'p-lawn' });
  expect(by('シンボルツリー（まる）')).toMatchObject({ group: '部品', cat: '植栽', pic: { kind: 'symbol', lib: 'b-wc-symbol' }, qty: '1本' });
  expect(by('フェンス')).toMatchObject({ cat: 'フェンス', pic: { kind: 'line', role: 'fence' }, qty: '5m' });
  expect(cards.some(c => c.title === '建物')).toBe(false);
});

it('品目に写真・メーカー・品番・色があればカードに出し、写真のある品目を登録先にする', () => {
  const book = defaultBook();
  book.items = book.items.map(i => i.id === 'p-fence' ? { ...i, maker: 'LIXIL', model: 'プラスG', color: 'クリエモカ', img: 'data:image/jpeg;base64,xx' } : i);
  const doc = withItems([line([[0, 0], [500, 0]], { role3: 'fence' })]);
  const [c] = boardCards(quantities(doc, lib), book, doc, lib);
  expect(c).toMatchObject({ spec: 'LIXIL / プラスG / クリエモカ', pic: { kind: 'photo', src: 'data:image/jpeg;base64,xx' }, item: 'p-fence' });
});

it('品目を「なし」にした項目は、品目未設定のカードになる', () => {
  const book = { ...defaultBook(), links: { ...defaultBook().links, 'line:fence': ['-'] } };
  const doc = withItems([line([[0, 0], [500, 0]], { role3: 'fence' })]);
  const [c] = boardCards(quantities(doc, lib), book, doc, lib);
  expect(c.product).toBe('');
  expect(c.item).toBeUndefined();
});

it('単価表のメーカー・品番・色の列を読み、CSVにも書き出す', () => {
  const items = parsePriceTable(parseCsv('分類,品目,単位,単価,メーカー,品番,色\nフェンス,アルミフェンス H800,m,16000,LIXIL,プラスG,クリエモカ\n植栽,シマトネリコ,本,30000,,,\n'));
  expect(items[0]).toMatchObject({ maker: 'LIXIL', model: 'プラスG', color: 'クリエモカ' });
  expect(items[1].maker).toBeUndefined();
  const csv = priceBookCsv({ ...defaultBook(), items });
  expect(csv).toContain('メーカー,品番,色');
  expect(csv).toContain('LIXIL,プラスG,クリエモカ');
});

it('単価表を読み込み直しても、同じ品目の写真・メーカーは引き継ぎ、表に書いてあれば表を優先する', () => {
  const first = importItems(defaultBook(), parsePriceTable(parseCsv('分類,品目,単位,単価\nフェンス,アルミフェンス,m,16000\n植栽,シマトネリコ,本,30000\n')), 'v1').book;
  const withPhoto = { ...first, items: first.items.map(i => i.name === 'アルミフェンス' ? { ...i, img: 'data:x', maker: '旧メーカー' } : i.name === 'シマトネリコ' ? { ...i, color: '緑' } : i) };
  const next = importItems(withPhoto, parsePriceTable(parseCsv('分類,品目,単位,単価,メーカー\nフェンス,アルミフェンス,m,17000,LIXIL\n植栽,シマトネリコ,本,32000,\n')), 'v2').book;
  const f = next.items.find(i => i.name === 'アルミフェンス')!, t = next.items.find(i => i.name === 'シマトネリコ')!;
  expect(f).toMatchObject({ price: 17000, img: 'data:x', maker: 'LIXIL' });
  expect(t).toMatchObject({ price: 32000, color: '緑' });
  expect('maker' in t).toBe(false);
});

it('配置：見出しの下に4列で並べ、ページからはみ出さず、見出しだけがページ末に残らない', () => {
  const card = (g: BoardCard['group'], n: number): BoardCard => ({ key: g + n, group: g, cat: '', title: 't', product: '', spec: '', qty: '', pic: { kind: 'none' }, ids: [] });
  const cards = [...Array.from({ length: 9 }, (_, i) => card('素材', i)), ...Array.from({ length: 3 }, (_, i) => card('線', i)), ...Array.from({ length: 14 }, (_, i) => card('部品', i))];
  const pages = layoutBoard(cards);
  expect(pages.flat().filter(s => s.kind === 'card')).toHaveLength(26);
  for (const p of pages) {
    for (const s of p) if (s.kind === 'card') expect(s.y + cardH).toBeLessThanOrEqual(BOARD.bottom);
    const last = p[p.length - 1]; expect(last.kind).toBe('card');
  }
  const first = pages[0].filter(s => s.kind === 'card').slice(0, 5);
  expect(new Set(first.slice(0, 4).map(s => s.y)).size).toBe(1);
  expect(first[4].y).toBeGreaterThan(first[0].y);
  expect(pages.length).toBeGreaterThan(1);
});

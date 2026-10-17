import { it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { buildEstimate, defaultBook, parsePriceTable, importItems, parseCsv, estimateCsv, normUnit } from '../src/v3/estimate';
import { readXlsx } from '../src/v3/xlsx';
import { type QtyRow } from '../src/v3/quantities';

const row = (key: string, group: QtyRow['group'], name: string, qty: number, unit: string, extra: Partial<QtyRow> = {}): QtyRow => ({ key, group, name, qty, unit, ids: ['x'], ...extra });
const rows: QtyRow[] = [
  row('mat:土間コンクリート', '素材', '土間コンクリート', 20, '㎡'),
  row('line:wall', '線', '塀', 10, 'm', { role: 'wall', area: 12, auto: true }),
  row('line:building', '線', '建物', 1, '棟', { role: 'building' }),
  row('obj:オリーブ', '部品', 'オリーブ', 2, '本', { cat: '植栽' }),
  row('obj:テーブルセット', '部品', 'テーブルセット', 1, '個', { cat: 'ガーデンファニチャー' }),
];

it('仮の単価で金額を出す（塀は長さ×高さの㎡、植栽は分類で結び付く、建物は対象外）', () => {
  const e = buildEstimate(rows, defaultBook());
  const by = (l: string) => e.lines.find(x => x.label === l)!;
  expect(by('土間コンクリート')).toMatchObject({ qty: 20, unit: '㎡', price: 11000, amount: 220000, prov: true });
  expect(by('塀')).toMatchObject({ qty: 12, unit: '㎡', byArea: true, amount: 12 * 18000, auto: true });
  expect(by('オリーブ')).toMatchObject({ qty: 2, unit: '本', amount: 60000 });
  expect(e.lines.some(l => l.label === '建物')).toBe(false);
  expect(e.unpriced.map(r => r.name)).toEqual(['テーブルセット']);
  expect(e.subtotal).toBe(220000 + 216000 + 60000);
  expect(e.overhead).toBe(49600);
  expect(e.tax).toBe(Math.floor((496000 + 49600) * 0.1));
  expect(e.total).toBe(496000 + 49600 + e.tax);
});

it('図面ごとの手直し（数量・単価・追加項目・値引き・諸経費）が効く', () => {
  const key = 'mat:土間コンクリート|p-concrete';
  const e = buildEstimate(rows.slice(0, 1), defaultBook(), { qty: { [key]: 25 }, price: { [key]: 10000 }, extras: [{ id: 'a', name: '残土処分', unit: '㎥', qty: 3, price: 8000 }], discount: 20000, overheadPct: 0 });
  expect(e.lines[0]).toMatchObject({ qty: 25, price: 10000, amount: 250000, edited: true });
  expect(e.lines[1]).toMatchObject({ extra: true, amount: 24000 });
  expect(e.subtotal).toBe(274000);
  expect(e.total).toBe(Math.floor(254000 * 1.1));
  const csv = estimateCsv(e, 'テスト邸');
  expect(csv.startsWith('﻿# 概算見積 テスト邸')).toBe(true);
  expect(csv).toContain('値引き,,,,-20000');
});

// item_master.csv と同じ形（英字の見出し、全角ｍ、単価なし・注記の行）
const MASTER = `﻿category,item,unit,unit_price,cost,is_generic
駐車場工事,T100厚土間打ち 刷毛引き,㎡,8000,6000,False
駐車場工事,"伸縮目地（材工)",ｍ,1800,1200,False
駐車場工事,スリット単粒砕石,式,,,False
庭,砂利（T30-50）,㎡,1300,,False
庭,高麗芝 材・工,㎡,3300,,False
ブロック工事,CB120ブロック積み（材・工）,㎡,9250,7000,False
フェンス,フェンス施工費,式,,,False
-,残土処分、運搬費,立米,8000,5500,False
-,＊残土の質によっては、金額が変わる場合がございます。,,,,False
`;

it('単価表CSVを読み込み、品目を自動で結び付ける（見つからない行は仮単価を残す）', () => {
  const items = parsePriceTable(parseCsv(MASTER));
  expect(items.map(i => i.name)).toEqual(['T100厚土間打ち 刷毛引き', '伸縮目地（材工)', '砂利（T30-50）', '高麗芝 材・工', 'CB120ブロック積み（材・工）', '残土処分、運搬費']);
  expect(items[1].unit).toBe('m');
  expect(items[5]).toMatchObject({ cat: '共通', unit: '㎥', cost: 5500 });
  const { book, matched, kept } = importItems(defaultBook(), items, 'G of the G 単価');
  expect(book.links['mat:土間コンクリート']).toEqual([items[0].id]);
  expect(book.links['mat:芝']).toEqual([items[3].id]);
  expect(book.links['line:wall']).toEqual([items[4].id]);
  expect(book.links['line:fence']).toEqual(['p-fence']); // フェンスは単価付きの品目がないので仮のまま
  expect(matched).toBeGreaterThanOrEqual(5);
  expect(kept).toBeGreaterThan(0);
  const e = buildEstimate(rows, book);
  expect(e.lines.find(l => l.label === '土間コンクリート')).toMatchObject({ price: 8000, prov: undefined });
  expect(e.lines.find(l => l.label === '塀')).toMatchObject({ qty: 12, price: 9250 });
  // 選び直した品目は、読み込み直しても名前で引き継ぐ
  const again = importItems({ ...book, links: { ...book.links, 'mat:土間コンクリート': [items[2].id] } }, items, '再読込');
  expect(again.book.links['mat:土間コンクリート']).toEqual([items[2].id]);
});

it('見出しが日本語の表、見出しがない表', () => {
  expect(parsePriceTable([['見積単価表'], [], ['分類', '品目', '単位', '単価'], ['植栽', 'シマトネリコ H2.5', '本', '¥28,000']])[0]).toMatchObject({ name: 'シマトネリコ H2.5', unit: '本', price: 28000 });
  expect(() => parsePriceTable([['a', 'b'], ['1', '2']])).toThrow(/見出し/);
  expect(normUnit('ｍ2')).toBe('㎡');
});

it('Excel（.xlsx）の最初のシートを読む', () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>単位</t></is></c><c r="D1" t="s"><v>2</v></c></row>
<row r="3"><c r="B3" t="s"><v>3</v></c><c r="C3" t="str"><v>㎡</v></c><c r="D3"><v>1300</v></c></row></sheetData></worksheet>`;
  const shared = `<sst><si><t>分類</t></si><si><r><t>品</t></r><r><t>目</t></r></si><si><t>単価</t><rPh><t>タンカ</t></rPh></si><si><t>砂利 &amp; 防草</t></si></sst>`;
  const wb = `<workbook xmlns:r="r"><sheets><sheet name="単価" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`;
  const z = zipSync({ 'xl/workbook.xml': strToU8(wb), 'xl/_rels/workbook.xml.rels': strToU8(rels), 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
  const t = readXlsx(z);
  expect(t[0]).toEqual(['分類', '品目', '単位', '単価']);
  expect(t[2]).toEqual(['', '砂利 & 防草', '㎡', '1300']);
  expect(parsePriceTable(t)[0]).toMatchObject({ name: '砂利 & 防草', price: 1300, unit: '㎡' });
});

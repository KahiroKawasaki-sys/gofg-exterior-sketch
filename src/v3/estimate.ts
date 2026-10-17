// 概算見積：集計（数量）×単価表。単価表は会社ごと（端末に保存）、図面ごとの調整は doc.est に持つ。
// 最初は「仮の単価」で動き、御社の単価表（Excel・CSV）を読み込むと品目を自動で結び付け直す。
import { type DocEstimate, type EstExtra } from './types';
import { type QtyRow } from './quantities';

export type PriceItem = { id: string; cat: string; name: string; unit: string; price: number; cost?: number; prov?: boolean };
// links：集計の行（mat:芝 / line:fence / obj:オリーブ / cat:植栽）→ 単価表の品目id（複数可：下地＋仕上げなど）
// company：見積書に載せる会社名
export type PriceBook = { name: string; items: PriceItem[]; links: Record<string, string[]>; overheadPct: number; taxPct: number; updatedAt?: string; company?: string };

export type EstLine = {
  key: string; group: string; label: string; name: string; qty: number; unit: string; price: number; amount: number;
  row?: string; item?: string; ids?: string[]; auto?: boolean; prov?: boolean; edited?: boolean; extra?: boolean; byArea?: boolean;
};
export type Estimate = {
  lines: EstLine[]; unpriced: QtyRow[]; subtotal: number; overheadPct: number; overhead: number;
  discount: number; taxPct: number; tax: number; total: number;
};

export const normUnit = (u: string) => {
  const s = (u || '').trim().normalize('NFKC');
  if (/^(m2|㎡|平米|m\^2|m²)$/i.test(s)) return '㎡';
  if (/^(m3|㎥|立米|m³)$/i.test(s)) return '㎥';
  if (/^(m|ｍ|メートル)$/i.test(s)) return 'm';
  return s;
};
const COUNT_UNITS = new Set(['本', '株', '個', '基', '台', '箇所', 'セット', '組', '枚', '棟', '式', '']);

// 集計の数量を、品目の単位に合わせる（m の塀を ㎡ 単価で → 長さ×高さ、式 → 1）
function convertQty(row: QtyRow, unit: string): { qty: number; byArea?: boolean } {
  const u = normUnit(unit);
  if (u === row.unit) return { qty: row.qty };
  if (u === '㎡' && row.area != null) return { qty: row.area, byArea: true };
  if (u === '式') return { qty: 1 };
  return { qty: row.qty };
}

const yen = (n: number) => Math.round(n);

export function linkFor(book: PriceBook, row: QtyRow): string[] {
  const direct = book.links[row.key];
  if (direct?.length) return direct;
  return (row.cat && book.links['cat:' + row.cat]) || [];
}

export function buildEstimate(rows: QtyRow[], book: PriceBook, est: DocEstimate = {}): Estimate {
  const items = new Map(book.items.map(i => [i.id, i]));
  const lines: EstLine[] = [], unpriced: QtyRow[] = [];
  for (const row of rows) {
    if (row.role === 'building') continue; // 建物は工事の対象外
    const linked = linkFor(book, row).map(id => items.get(id)).filter((i): i is PriceItem => !!i);
    if (!linked.length) { unpriced.push(row); continue; }
    for (const it of linked) {
      const key = row.key + '|' + it.id, c = convertQty(row, it.unit);
      const qty = est.qty?.[key] ?? Math.round(c.qty * 10) / 10, price = est.price?.[key] ?? it.price;
      lines.push({
        key, group: row.group, label: row.name, name: it.name, qty, unit: normUnit(it.unit) || row.unit, price, amount: yen(qty * price),
        row: row.key, item: it.id, ids: row.ids, auto: row.auto, prov: it.prov, byArea: c.byArea && est.qty?.[key] == null,
        edited: est.qty?.[key] != null || est.price?.[key] != null,
      });
    }
  }
  for (const x of est.extras || []) lines.push({ key: 'x:' + x.id, group: '追加', label: '追加', name: x.name, qty: x.qty, unit: x.unit, price: x.price, amount: yen(x.qty * x.price), extra: true });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const overheadPct = est.overheadPct ?? book.overheadPct, overhead = yen(subtotal * overheadPct / 100);
  const discount = Math.max(0, est.discount || 0), taxPct = book.taxPct;
  const base = Math.max(0, subtotal + overhead - discount), tax = Math.floor(base * taxPct / 100);
  return { lines, unpriced, subtotal, overheadPct, overhead, discount, taxPct, tax, total: base + tax };
}

// ---- 仮の単価表（一般的な目安。会社の単価表を読み込むまでの仮置き） ----
const P = (id: string, cat: string, name: string, unit: string, price: number): PriceItem => ({ id: 'p-' + id, cat, name, unit, price, prov: true });
const PROV_ITEMS: PriceItem[] = [
  P('concrete', '土間', '土間コンクリート（刷毛引き・下地共）', '㎡', 11000),
  P('arai', '土間', '洗い出し仕上げ（下地共）', '㎡', 14000),
  P('gravel', '庭', '防草シート＋砂利敷き', '㎡', 2500),
  P('lawn', '庭', '天然芝張り（材工）', '㎡', 3500),
  P('stone', 'アプローチ', '乱形石貼り（下地共）', '㎡', 18000),
  P('brick', 'アプローチ', 'レンガ敷き（下地共）', '㎡', 15000),
  P('tile', 'アプローチ', 'タイル貼り（下地共）', '㎡', 16000),
  P('deck', '庭', 'ウッドデッキ', '㎡', 40000),
  P('chip', '庭', '防草シート＋ウッドチップ敷き', '㎡', 2500),
  P('wall', 'ブロック工事', 'ブロック塀（基礎・化粧ブロック共）', '㎡', 18000),
  P('fence', 'フェンス', 'アルミフェンス H800程度（材工）', 'm', 16000),
  P('gate', '門扉', '門扉 片開き（材工）', '箇所', 120000),
  P('tree', '植栽', '高木（H2.5m程度・植付共）', '本', 30000),
  P('shrub', '植栽', '低木（植付共）', '本', 4000),
  P('ground', '植栽', '下草・グランドカバー', '株', 1200),
  P('rock', '庭', '景石（据付共）', '個', 20000),
  P('carport', 'カーポート', 'カーポート 1台用（材工）', '基', 350000),
  P('light', '照明', 'ガーデンライト（電気工事共）', '台', 35000),
  P('pole', '機能門柱', '機能門柱（材工）', '基', 150000),
  P('faucet', '立水栓', '立水栓（給水工事共）', '基', 60000),
  P('shed', '物置', '物置（組立共）', '基', 150000),
  P('cycle', 'サイクルポート', 'サイクルポート（材工）', '基', 180000),
];
const PROV_LINKS: Record<string, string[]> = {
  'mat:土間コンクリート': ['p-concrete'], 'mat:洗い出し': ['p-arai'], 'mat:砂利（グレー）': ['p-gravel'], 'mat:砂利（ブルーグレー）': ['p-gravel'],
  'mat:芝': ['p-lawn'], 'mat:芝生（やわらか）': ['p-lawn'], 'mat:乱形石': ['p-stone'], 'mat:レンガ敷き': ['p-brick'], 'mat:タイル': ['p-tile'],
  'mat:ウッドデッキ': ['p-deck'], 'mat:ウッドチップ・土': ['p-chip'],
  'line:wall': ['p-wall'], 'line:fence': ['p-fence'], 'line:gate': ['p-gate'],
  'cat:植栽': ['p-tree'], 'cat:低木': ['p-shrub'], 'cat:下草': ['p-ground'], 'cat:景石': ['p-rock'], 'cat:カーポート': ['p-carport'], 'cat:照明': ['p-light'],
  'obj:機能門柱': ['p-pole'], 'obj:立水栓': ['p-faucet'], 'obj:物置 2000×900': ['p-shed'], 'obj:サイクルポート': ['p-cycle'],
};
export const defaultBook = (): PriceBook => ({ name: '仮の単価', items: PROV_ITEMS.map(i => ({ ...i })), links: structuredClone(PROV_LINKS), overheadPct: 10, taxPct: 10 });
export const isProvisional = (b: PriceBook) => b.items.every(i => i.prov);

// ---- 単価表の読み込み ----
// 表（1行目付近に見出し）から品目を取り出す。見出しは「分類・品目・単位・単価・原価」か item_master.csv の英字
export function parsePriceTable(table: string[][]): PriceItem[] {
  const find = (row: string[], re: RegExp) => row.findIndex(c => re.test((c || '').trim()));
  let h = -1, col = { cat: -1, name: -1, unit: -1, price: -1, cost: -1 };
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const row = table[r], name = find(row, /^(item|品目|品名|名称|項目|商品名)$/i), price = find(row, /^(unit_price|単価|price|販売単価|金額単価)$/i);
    if (name >= 0 && price >= 0) { h = r; col = { name, price, cat: find(row, /^(category|分類|区分|工事|工種|カテゴリ)$/i), unit: find(row, /^(unit|単位)$/i), cost: find(row, /^(cost|原価|仕入)$/i) }; break; }
  }
  if (h < 0) throw Error('見出し（品目・単価）が見つかりません');
  const num = (s: string | undefined) => { const v = parseFloat((s || '').normalize('NFKC').replace(/[,¥円\s]/g, '')); return isFinite(v) ? v : NaN; };
  const out: PriceItem[] = [], seen = new Set<string>();
  for (const row of table.slice(h + 1)) {
    const name = (row[col.name] || '').trim(), price = num(row[col.price]);
    if (!name || name.startsWith('＊') || name.startsWith('*') || !(price > 0)) continue;
    const cat = col.cat >= 0 ? (row[col.cat] || '').trim().replace(/^-$/, '共通') : '', unit = col.unit >= 0 ? normUnit(row[col.unit] || '') : '';
    const id = 'i-' + cat + '/' + name + '/' + unit;
    if (seen.has(id)) continue; // 同じ品目が別の分類にも載っていることがある
    seen.add(id);
    const cost = num(row[col.cost]);
    out.push({ id, cat, name, unit, price, ...(cost > 0 && { cost }) });
  }
  if (!out.length) throw Error('単価の入った品目がありません');
  return out;
}

// 集計の行ごとに、品目名にこの言葉を含み、単位が合うものを探す（先に書いた言葉ほど優先）
const AREA = ['㎡'], LEN = ['m'], CNT = ['本', '株', '個', 'セット', '基', '台', '箇所', '組'];
const AUTO: [string, string[], string[]][] = [
  ['mat:土間コンクリート', ['土間打ち 刷毛', '土間打ち', '土間コン'], AREA], ['mat:洗い出し', ['洗い出し'], AREA],
  ['mat:砂利（グレー）', ['砂利'], AREA], ['mat:砂利（ブルーグレー）', ['砂利'], AREA],
  ['mat:芝', ['高麗芝', '天然芝', '芝張'], AREA], ['mat:芝生（やわらか）', ['高麗芝', '天然芝', '芝張'], AREA],
  ['mat:乱形石', ['乱形'], AREA], ['mat:レンガ敷き', ['レンガ', 'ブリック'], AREA], ['mat:タイル', ['タイル貼'], AREA],
  ['mat:ウッドデッキ', ['ウッドデッキ'], AREA], ['mat:ウッドチップ・土', ['ウッドチップ'], AREA],
  ['line:wall', ['CB120ブロック積み', 'ブロック積み（材・工）', 'ブロック積み', 'ブロック塀'], [...AREA, ...LEN]],
  ['line:fence', ['フェンス'], LEN], ['line:gate', ['門扉'], CNT],
  ['cat:植栽', ['シンボルツリー', '高木', '植栽'], CNT], ['cat:低木', ['低木'], CNT], ['cat:下草', ['下草', 'グランドカバー'], CNT],
  ['cat:景石', ['景石'], CNT], ['cat:カーポート', ['カーポート'], CNT], ['cat:照明', ['照明', 'ライト'], CNT],
  ['obj:機能門柱', ['機能門柱'], CNT], ['obj:立水栓', ['立水栓', '水栓柱'], CNT], ['obj:物置 2000×900', ['物置'], CNT], ['obj:サイクルポート', ['サイクルポート'], CNT],
];
export function autoMatch(items: PriceItem[], key: string): string | undefined {
  const a = AUTO.find(([k]) => k === key); if (!a) return;
  for (const w of a[1]) {
    const hit = items.find(i => !i.prov && i.name.includes(w) && a[2].includes(normUnit(i.unit)));
    if (hit) return hit.id;
  }
}

// 読み込んだ品目で単価表を作り直す。前に選んであった品目は名前が同じなら引き継ぎ、
// 見つからない行は自動で探し、それでもなければ仮の単価を残す
export function importItems(old: PriceBook, imported: PriceItem[], name: string): { book: PriceBook; matched: number; kept: number } {
  const oldItems = new Map(old.items.map(i => [i.id, i])), byName = new Map(imported.map(i => [i.cat + '/' + i.name, i.id]));
  const keep = new Map<string, PriceItem>(), links: Record<string, string[]> = {};
  let matched = 0, kept = 0;
  const keys = new Set([...Object.keys(old.links), ...AUTO.map(([k]) => k)]);
  for (const key of keys) {
    const prev = (old.links[key] || []).map(id => oldItems.get(id)).filter((i): i is PriceItem => !!i);
    const carried = prev.filter(i => !i.prov).map(i => byName.get(i.cat + '/' + i.name)).filter((id): id is string => !!id);
    if (carried.length) { links[key] = carried; matched++; continue; }
    const auto = autoMatch(imported, key);
    if (auto) { links[key] = [auto]; matched++; continue; }
    const provs = prev.filter(i => i.prov);
    if (provs.length) { provs.forEach(i => keep.set(i.id, i)); links[key] = provs.map(i => i.id); kept++; }
  }
  return { book: { ...old, name, items: [...imported, ...keep.values()], links, updatedAt: new Date().toISOString() }, matched, kept };
}

// ---- CSV ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csvCell = (s: string) => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
const csv = (rows: (string | number)[][]) => '﻿' + rows.map(r => r.map(v => csvCell(String(v))).join(',')).join('\r\n') + '\r\n';

export const priceBookCsv = (b: PriceBook) => csv([['分類', '品目', '単位', '単価', '原価'], ...b.items.map(i => [i.cat, i.name, i.unit, i.price, i.cost ?? ''])]);

export function estimateCsv(e: Estimate, title: string): string {
  return csv([
    [`# 概算見積 ${title}`], ['区分', '図面の項目', '品目', '数量', '単位', '単価', '金額', '備考'],
    ...e.lines.map(l => [l.group, l.label, l.name, l.qty, l.unit, l.price, l.amount, [l.prov && '仮単価', l.auto && '自動判定を含む', l.byArea && '長さ×高さ', l.edited && '手直し'].filter(Boolean).join(' ')]),
    [], ['', '', '小計', '', '', '', e.subtotal], ['', '', `諸経費（${e.overheadPct}%）`, '', '', '', e.overhead],
    ...(e.discount ? [['', '', '値引き', '', '', '', -e.discount]] : []),
    ['', '', `消費税（${e.taxPct}%）`, '', '', '', e.tax], ['', '', '合計（税込）', '', '', '', e.total],
    ...(e.unpriced.length ? [[], ['# 単価が決まっていない項目（金額に入っていません）'], ...e.unpriced.map(r => [r.group, r.name, '', r.qty, r.unit])] : []),
  ]);
}

export const newExtra = (name: string, unit: string, price: number, id: string): EstExtra => ({ id, name, unit, qty: 1, price });

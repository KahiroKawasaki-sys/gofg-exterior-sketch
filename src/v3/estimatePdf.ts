// 見積書PDF（A4縦）。表は画面と同じ文字で描けるよう canvas に描いて画像としてPDFに貼る。
// 1枚目：宛名・合計金額・図面、2枚目以降：明細と合計、比べる案があれば最後に比較表
import { type Estimate, type EstLine } from './estimate';

export type Compare = { aName: string; bName: string; a: Estimate; b: Estimate };
export type CompareRow = { label: string; a: number; b: number };

// 2つの案の金額を、品目ごとに並べる（片方にしかない品目は 0）
export function compareRows(a: Estimate, b: Estimate): CompareRow[] {
  const key = (l: EstLine) => l.name, m = new Map<string, CompareRow>();
  for (const l of a.lines) { const r = m.get(key(l)) || { label: l.name, a: 0, b: 0 }; r.a += l.amount; m.set(key(l), r); }
  for (const l of b.lines) { const r = m.get(key(l)) || { label: l.name, a: 0, b: 0 }; r.b += l.amount; m.set(key(l), r); }
  return [...m.values()];
}

// 明細を1ページに入る行数で区切る（見出し行も1行と数える）
export type Row = { kind: 'head'; text: string } | { kind: 'line'; l: EstLine };
// お客様向けには、同じ品目・同じ単価の行（樹種ちがいの高木など）を1行にまとめる
export function mergeLines(lines: EstLine[]): EstLine[] {
  const out: EstLine[] = [], at = new Map<string, number>();
  for (const l of lines) {
    const k = [l.group, l.name, l.unit, l.price].join('|'), i = at.get(k);
    if (i == null || l.extra) { at.set(k, out.length); out.push({ ...l }); continue; }
    const m = out[i]; m.qty = Math.round((m.qty + l.qty) * 10) / 10; m.amount += l.amount;
  }
  return out;
}

export function paginate(lines: EstLine[], perPage: number): Row[][] {
  const rows: Row[] = [];
  for (const g of ['素材', '線', '部品', '追加']) {
    const ls = lines.filter(l => l.group === g); if (!ls.length) continue;
    rows.push({ kind: 'head', text: g === '素材' ? '舗装・植栽地' : g === '線' ? '塀・フェンス・門扉' : g === '部品' ? '植栽・設備' : 'その他工事' });
    ls.forEach(l => rows.push({ kind: 'line', l }));
  }
  const pages: Row[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  // 見出しがページの最後に1行だけ残らないようにする
  for (let i = 0; i < pages.length - 1; i++) { const last = pages[i][pages[i].length - 1]; if (last.kind === 'head') { pages[i].pop(); pages[i + 1].unshift(last); } }
  return pages.length ? pages : [[]];
}

const W = 1240, H = 1754, MM = W / 210; // A4縦、1mm ≒ 5.9px
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans JP","Noto Sans CJK JP","IPAGothic",sans-serif';
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const num = (n: number) => n.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
export const honorific = (name: string) => /(様|御中|殿)$/.test(name.trim()) ? name.trim() : name.trim() + ' 様';
export const jpDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

function page(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#222'; g.textBaseline = 'alphabetic';
  return [c, g];
}
const font = (g: CanvasRenderingContext2D, px: number, bold = false) => { g.font = `${bold ? 700 : 400} ${px}px ${FONT}`; };
function fit(g: CanvasRenderingContext2D, s: string, w: number) {
  if (g.measureText(s).width <= w) return s;
  let t = s; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, align: CanvasTextAlign = 'left', w?: number) => { g.textAlign = align; g.fillText(w ? fit(g, s, w) : s, x, y); };
const hline = (g: CanvasRenderingContext2D, x1: number, x2: number, y: number, lw = 1, color = '#bbb') => { g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke(); };
function footer(g: CanvasRenderingContext2D, n: number, total: number) { font(g, 11 * MM / 4); g.fillStyle = '#888'; text(g, `${n} / ${total}`, W / 2, H - 10 * MM, 'center'); g.fillStyle = '#222'; }

export type PdfInfo = { client: string; company: string; date: Date; subject?: string; note?: string };

export function drawEstimatePages(e: Estimate, info: PdfInfo, plan?: CanvasImageSource & { width: number; height: number }, cmp?: Compare): HTMLCanvasElement[] {
  const L = 18 * MM, R = W - 18 * MM, out: HTMLCanvasElement[] = [];
  // ---- 1枚目 ----
  const [c1, g1] = page();
  font(g1, 9 * MM, true); text(g1, '御 見 積 書', W / 2, 30 * MM, 'center');
  hline(g1, W / 2 - 40 * MM, W / 2 + 40 * MM, 33 * MM, 2, '#222');
  font(g1, 6 * MM, true); text(g1, honorific(info.client), L, 50 * MM, 'left', 100 * MM); hline(g1, L, L + 100 * MM, 52 * MM, 1.5, '#222');
  font(g1, 3.6 * MM); text(g1, jpDate(info.date), R, 44 * MM, 'right');
  if (info.company) { font(g1, 4.4 * MM, true); text(g1, info.company, R, 54 * MM, 'right', 80 * MM); }
  font(g1, 3.8 * MM); text(g1, `件名：${info.subject || '外構工事 概算見積'}`, L, 64 * MM);
  text(g1, '下記の通り御見積申し上げます。', L, 71 * MM);
  // 合計金額の枠
  g1.strokeStyle = '#222'; g1.lineWidth = 2; g1.strokeRect(L, 77 * MM, R - L, 20 * MM);
  font(g1, 4.4 * MM, true); text(g1, '御見積金額（税込）', L + 6 * MM, 89.5 * MM);
  font(g1, 8.5 * MM, true); text(g1, yen(e.total) + ' -', R - 6 * MM, 90.5 * MM, 'right');
  font(g1, 3.2 * MM); g1.fillStyle = '#555';
  text(g1, `（うち消費税 ${yen(e.tax)}）`, R, 102 * MM, 'right');
  text(g1, info.note || '※図面からの概算です。現地調査・詳細の打ち合わせにより金額が変わることがあります。', L, 108 * MM, 'left', R - L);
  g1.fillStyle = '#222';
  if (plan && plan.width && plan.height) {
    const top = 114 * MM, bottom = H - 18 * MM, k = Math.min((R - L) / plan.width, (bottom - top) / plan.height);
    const w = plan.width * k, h = plan.height * k;
    g1.drawImage(plan, L + (R - L - w) / 2, top + (bottom - top - h) / 2, w, h);
    g1.strokeStyle = '#ddd'; g1.lineWidth = 1; g1.strokeRect(L, top, R - L, bottom - top);
  }
  out.push(c1);

  // ---- 明細 ----
  const rowH = 8.2 * MM, top = 34 * MM, sumRows = 5, perPage = Math.floor((H - top - 28 * MM) / rowH);
  const pages = paginate(mergeLines(e.lines), perPage);
  // 最後のページに合計欄が入らなければ1ページ足す
  if (pages[pages.length - 1].length + sumRows + 1 > perPage) pages.push([]);
  const cols = { name: L + 2 * MM, qty: R - 92 * MM, unit: R - 80 * MM, price: R - 40 * MM, amt: R - 2 * MM };
  pages.forEach((rows, pi) => {
    const [c, g] = page();
    font(g, 5.5 * MM, true); text(g, '御見積明細', L, 22 * MM);
    font(g, 3.4 * MM); text(g, honorific(info.client), R, 22 * MM, 'right');
    g.fillStyle = '#eef2ef'; g.fillRect(L, top - 6 * MM, R - L, rowH); g.fillStyle = '#222';
    font(g, 3.3 * MM, true);
    const hy = top - 6 * MM + rowH * 0.68;
    text(g, '品名', cols.name, hy); text(g, '数量', cols.qty, hy, 'right'); text(g, '単位', cols.unit, hy); text(g, '単価', cols.price, hy, 'right'); text(g, '金額', cols.amt, hy, 'right');
    let y = top - 6 * MM + rowH;
    for (const r of rows) {
      const by = y + rowH * 0.66;
      if (r.kind === 'head') { font(g, 3.4 * MM, true); g.fillStyle = '#2f5d4e'; text(g, '■ ' + r.text, cols.name, by); g.fillStyle = '#222'; }
      else {
        font(g, 3.3 * MM); text(g, r.l.name, cols.name + 3 * MM, by, 'left', cols.qty - cols.name - 18 * MM);
        text(g, num(r.l.qty), cols.qty, by, 'right'); text(g, r.l.unit, cols.unit, by, 'left', 14 * MM);
        text(g, num(r.l.price), cols.price, by, 'right'); text(g, num(r.l.amount), cols.amt, by, 'right');
      }
      y += rowH; hline(g, L, R, y, 1, '#e2e2e2');
    }
    if (pi === pages.length - 1) {
      y += rowH * 0.5;
      const sums: [string, number, boolean?][] = [['小計', e.subtotal], [`諸経費（${e.overheadPct}%）`, e.overhead], ...(e.discount ? [['値引き', -e.discount] as [string, number]] : []), [`消費税（${e.taxPct}%）`, e.tax], ['合計（税込）', e.total, true]];
      for (const [label, v, strong] of sums) {
        if (strong) hline(g, cols.qty - 20 * MM, R, y, 2, '#222');
        font(g, (strong ? 4 : 3.4) * MM, !!strong); text(g, label, cols.qty - 18 * MM, y + rowH * 0.66); text(g, yen(v), cols.amt, y + rowH * 0.66, 'right');
        y += rowH;
      }
    }
    out.push(c);
  });

  // ---- 比較 ----
  if (cmp) {
    const [c, g] = page();
    font(g, 5.5 * MM, true); text(g, 'A案・B案の比較', L, 16 * MM);
    font(g, 3.4 * MM); text(g, `A案：${cmp.aName}`, L, 22.5 * MM, 'left', R - L); text(g, `B案：${cmp.bName}`, L, 27.5 * MM, 'left', R - L);
    const cx = { a: R - 64 * MM, b: R - 32 * MM, d: R - 2 * MM };
    g.fillStyle = '#eef2ef'; g.fillRect(L, top + 1 * MM, R - L, rowH); g.fillStyle = '#222';
    font(g, 3.3 * MM, true); const hy = top + 1 * MM + rowH * 0.68;
    text(g, '品名', L + 2 * MM, hy); text(g, 'A案', cx.a, hy, 'right'); text(g, 'B案', cx.b, hy, 'right'); text(g, '差額（B−A）', cx.d, hy, 'right');
    let y = top + 1 * MM + rowH;
    const rows = compareRows(cmp.a, cmp.b), max = Math.floor((H - top - 40 * MM) / rowH) - 3;
    const shown = rows.slice(0, max);
    for (const r of shown) {
      const by = y + rowH * 0.66; font(g, 3.2 * MM);
      text(g, r.label, L + 2 * MM, by, 'left', cx.a - L - 34 * MM);
      text(g, r.a ? num(r.a) : '—', cx.a, by, 'right'); text(g, r.b ? num(r.b) : '—', cx.b, by, 'right');
      const d = r.b - r.a; g.fillStyle = d > 0 ? '#b03a2e' : d < 0 ? '#2f6f5a' : '#222'; text(g, d ? (d > 0 ? '+' : '−') + num(Math.abs(d)) : '0', cx.d, by, 'right'); g.fillStyle = '#222';
      y += rowH; hline(g, L, R, y, 1, '#e2e2e2');
    }
    if (rows.length > shown.length) { font(g, 3 * MM); g.fillStyle = '#777'; text(g, `ほか ${rows.length - shown.length} 品目`, L + 2 * MM, y + rowH * 0.66); g.fillStyle = '#222'; y += rowH; }
    y += rowH * 0.5; hline(g, L, R, y, 2, '#222');
    font(g, 4 * MM, true); const d = cmp.b.total - cmp.a.total, by = y + rowH * 0.75;
    text(g, '合計（税込）', L + 2 * MM, by); text(g, num(cmp.a.total), cx.a, by, 'right'); text(g, num(cmp.b.total), cx.b, by, 'right');
    text(g, (d > 0 ? '+' : d < 0 ? '−' : '') + num(Math.abs(d)), cx.d, by, 'right');
    out.push(c);
  }
  out.forEach((c, i) => footer(c.getContext('2d')!, i + 1, out.length));
  return out;
}

export async function estimatePdf(pages: HTMLCanvasElement[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const c of pages) {
    const png = await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(Error('PDFを作れませんでした')), 'image/png'));
    const img = await pdf.embedPng(new Uint8Array(await png.arrayBuffer())), p = pdf.addPage([595.28, 841.89]);
    p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  const bytes = await pdf.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
}

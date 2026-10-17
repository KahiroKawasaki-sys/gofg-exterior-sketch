// Excel（.xlsx）の最初のシートを文字の表として読む。単価表の読み込み専用の最小限の読み取り
import { unzipSync, strFromU8 } from 'fflate';

const unesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)));
// <si> や <is> の中の <t> をつなげる（ふりがな <rPh> は除く）
const texts = (xml: string) => unesc((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function readXlsx(data: Uint8Array): string[][] {
  const z = unzipSync(data), get = (p: string) => z[p] ? strFromU8(z[p]) : '';
  const shared = (get('xl/sharedStrings.xml').match(/<si\b[\s\S]*?<\/si>/g) || []).map(texts);
  // 最初のシートの場所は workbook と rels から引く
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || rid && rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  const path = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
  const sheet = get(path) || get('xl/worksheets/sheet1.xml');
  if (!sheet) throw Error('Excelのシートが読めません');
  const out: string[][] = [];
  for (const m of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rn = m[1].match(/\br="(\d+)"/)?.[1], r = rn ? +rn - 1 : out.length, row: string[] = [];
    for (const c of m[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '', ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1], t = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const val = t === 's' ? shared[+(v || 0)] ?? '' : t === 'inlineStr' ? texts(body) : unesc(v ?? '');
      row[ref ? colIndex(ref) : row.length] = val;
    }
    out[r] = Array.from(row, x => x ?? '');
  }
  return Array.from(out, x => x ?? []);
}

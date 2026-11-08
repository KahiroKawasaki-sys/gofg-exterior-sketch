// 立面図（PDF）の文字から、面のラベル（東側立面図…）とレベル（▽最高高 7,807・▽最高軒高 5,994・▽GL±0）を読む。
// 文字は pdf.js が描画した絵の px 座標で受け取る（source.ts の text()）。純粋な計算だけ
import { type ElevFace } from './types';
import { type Rect, guessPaper } from './elevation';

export type TextItem = { str: string; x: number; y: number; w: number; h: number; rot?: boolean }; // x,y は左下（ベースライン）。rot：回転した文字（縦の寸法の数字）
export type ViewLabel = { face: ElevFace; x: number; y: number; w: number };
export type Level = { kind: 'ridge' | 'eaves' | 'gl' | 'other'; y: number; x: number; mm?: number; label: string };
export type CropLevels = { ridge?: Level; eaves?: Level; gl?: Level; mmPerPx?: number };

const FACE_CHARS: Record<string, ElevFace> = { 東: 'E', 西: 'W', 南: 'S', 北: 'N' };

// 文字片は行ごとにばらばらに来ることがあるので、同じ高さで近い物をつなげる
export function joinLines(items: TextItem[]): TextItem[] {
  const sorted = [...items].filter(t => t.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: TextItem[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - t.y) <= Math.max(2, last.h * 0.5) && t.x - (last.x + last.w) <= Math.max(6, last.h * 1.5) && t.x >= last.x - 2) {
      last.str += t.str; last.w = Math.max(last.x + last.w, t.x + t.w) - last.x; last.h = Math.max(last.h, t.h);
    } else out.push({ ...t });
  }
  return out;
}

// 「東側立面図」「北立面図」などのラベル
export function viewLabels(items: TextItem[]): ViewLabel[] {
  const out: ViewLabel[] = [];
  for (const t of joinLines(items)) {
    const m = t.str.replace(/\s/g, '').match(/([東西南北])側?立面/);
    if (m) out.push({ face: FACE_CHARS[m[1]], x: t.x + t.w / 2, y: t.y, w: t.w });
  }
  return out;
}

const num = (s: string) => { const m = s.replace(/[，,．]/g, m => m === '．' ? '.' : ',').match(/(\d{1,2}[,]\d{3}|\d{3,5})(?:\.\d+)?/); if (!m) return undefined; const v = Number(m[1].replace(/,/g, '')); return isFinite(v) && v >= 300 && v <= 20000 ? v : undefined; };

// レベル：▽最高高 (7,807)・▽最高軒高 (5,994)・▽軒高・▽GL±0・▽1FL など。y は文字のベースライン（＝線の高さにほぼ一致）
export function levels(items: TextItem[]): Level[] {
  const out: Level[] = [];
  for (const t of joinLines(items)) {
    const s = t.str.replace(/\s/g, '');
    if (!/[▽▼△]|GL|FL|最高|軒高|軒の高/.test(s)) continue;
    let kind: Level['kind'] = 'other';
    if (/GL/i.test(s) && !/FL/.test(s)) kind = 'gl';
    else if (/最高(の)?高(さ)?|最高高|棟高|最高の高さ/.test(s) && !/軒/.test(s)) kind = 'ridge';
    else if (/軒高|軒の高さ|最高軒/.test(s)) kind = 'eaves';
    const mm = kind === 'gl' ? 0 : num(s);
    out.push({ kind, y: t.y, x: t.x, mm, label: s });
  }
  return out;
}

// 縦に回転した数字（1,813・2,617 など）の x 位置。その近くの縦線は高さの寸法線なので、壁の候補から外す
export function dimensionColumns(items: TextItem[]): number[] {
  return items.filter(t => t.rot && /^[\d,.，]+$/.test(t.str.trim()) && t.str.trim().length >= 2).map(t => t.x);
}

// 面のラベルは絵のすぐ下にあるので、枠（crop）の中か真下にあるラベルで面を決める
export function faceForCrop(crop: Rect, labels: ViewLabel[]): ElevFace | undefined {
  let best: ViewLabel | undefined, bd = Infinity;
  for (const l of labels) {
    const inX = l.x >= crop.x - crop.w * 0.1 && l.x <= crop.x + crop.w * 1.1;
    // ラベルは絵の下にある：枠の下半分〜枠の下 30% まで。枠より上のラベル（上の絵のもの）は見ない
    if (!inX || l.y < crop.y + crop.h * 0.5 || l.y > crop.y + crop.h * 1.3) continue;
    const d = Math.abs(l.y - (crop.y + crop.h)) + Math.abs(l.x - (crop.x + crop.w / 2)) * 0.2;
    if (d < bd) { bd = d; best = l; }
  }
  return best?.face;
}

// 枠の中のレベルから、最高高・軒高・GL の行と、1px の実寸（mm）を決める。GL と最高高が揃えば実寸が決まる
export function levelsForCrop(crop: Rect, all: Level[]): CropLevels {
  const inside = all.filter(l => l.x >= crop.x - crop.w * 0.15 && l.x <= crop.x + crop.w && l.y >= crop.y - crop.h * 0.05 && l.y <= crop.y + crop.h * 1.05);
  const pick = (k: Level['kind']) => inside.filter(l => l.kind === k).sort((a, b) => (k === 'gl' ? b.y - a.y : a.y - b.y))[0];
  const ridge = pick('ridge'), eaves = pick('eaves'), gl = pick('gl');
  let mmPerPx: number | undefined;
  if (gl && ridge?.mm && gl.y - ridge.y > 10) mmPerPx = ridge.mm / (gl.y - ridge.y);
  else if (gl && eaves?.mm && gl.y - eaves.y > 10) mmPerPx = eaves.mm / (gl.y - eaves.y);
  return { ridge, eaves, gl, mmPerPx };
}

// 図面の縮尺（S=1/150 など）の分母。「配置図」と同じ行にあるものを優先し、無ければいちばん多く出てくるもの
export function drawingScale(items: TextItem[], prefer = /配置図|平面図/): number | undefined {
  const found: { denom: number; preferred: boolean }[] = [];
  for (const t of joinLines(items)) {
    const s = t.str.replace(/\s/g, '').replace(/／/g, '/').replace(/：/g, ':');
    const m = s.match(/S[=＝]?1[/:](\d{2,4})/i) || s.match(/1[/:](\d{2,4})(?![\d,])/);
    if (m) found.push({ denom: +m[1], preferred: prefer.test(s) });
  }
  if (!found.length) return undefined;
  const pref = found.find(f => f.preferred); if (pref) return pref.denom;
  const count = new Map<number, number>(); for (const f of found) count.set(f.denom, (count.get(f.denom) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// 下絵（PDF）の実寸：用紙の幅(mm) × 縮尺の分母 ÷ 図面の 1px の mm → 下絵の幅(px)。縮尺が読めなければ 1200px
export function underlayWidthPx(imageW: number, imageH: number, text: TextItem[] | undefined, mmPerPx: number): { w: number; denom?: number; paper?: string } {
  const denom = text ? drawingScale(text) : undefined;
  if (!denom) return { w: 1200 };
  const paper = guessPaper(imageW, imageH);
  return { w: paper.widthMm * denom / mmPerPx, denom, paper: paper.name };
}

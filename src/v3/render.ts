// AIパース：3D画面の写しをサーバーの画像AI（/api/ai/render）に渡して写真調のパースにする。
// できた絵は端末（IndexedDB の renders）に図面IDつきで残す。図面データ本体には入れない（容量が大きいため）。
import { apiPost, isNativeApp } from './platform';
import { uid, type Doc, type LibItem } from './types';
import { buildScene, type Solid } from './scene3d';

export type RenderStyle = 'day' | 'dusk' | 'night';
export type RenderView = 'bird' | 'top' | 'eye';
export const RENDER_STYLES: [RenderStyle, string, string][] = [['day', '昼', '明るい自然光'], ['dusk', '夕方', '灯りがともる夕暮れ'], ['night', '夜', '照明が映える夜景']];
export type Render = { id: string; docId: string; at: string; view: RenderView; style: RenderStyle; note: string; src: string; ms?: number };

// お客様と一緒に見る画面なので、原価（1枚 約8円）は出さない。待ち時間だけ伝える
export const RENDER_COST_NOTE = '1枚 30秒〜1分';
export const RENDER_NOTE_PLACEHOLDER = '例：塀は黒いタイル、芝は人工芝、門柱は木目';

// 画像AIが受け付ける縦横比のうち、3D画面に一番近いもの
const ASPECTS: [number, number][] = [[16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [1, 1], [5, 4], [4, 5], [21, 9]];
export function nearestAspect(w: number, h: number): string {
  const r = w / Math.max(1, h);
  let best = ASPECTS[0], d = Infinity;
  for (const a of ASPECTS) { const e = Math.abs(Math.log(r / (a[0] / a[1]))); if (e < d) { d = e; best = a; } }
  return `${best[0]}:${best[1]}`;
}

// 保存するときのファイル名（図面名_パース_昼.jpg）
export function renderFileName(docName: string, style: RenderStyle, at?: string): string {
  const base = docName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || 'gaikou';
  const label = RENDER_STYLES.find(s => s[0] === style)?.[1] || '';
  const stamp = at ? at.replace(/[-:T]/g, '').slice(2, 12) : '';
  return `${base}_パース${label ? '_' + label : ''}${stamp ? '_' + stamp : ''}.jpg`;
}

// 3Dの写し（PNG）を送りやすい大きさの JPEG にする（長い辺 maxPx）
export async function shrinkToJpeg(blob: Blob, maxPx = 1536, quality = 0.86): Promise<{ dataUrl: string; w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { dataUrl: c.toDataURL('image/jpeg', quality), w, h };
}

export async function dataUrlBlob(src: string): Promise<Blob> { return (await fetch(src)).blob(); }

// 図面に置いた部品の一覧（英語）。画像AIに「何が置いてあるか」を伝え、部品どおりに描かせる（軽は軽、セダンはセダン）
const COLOR_WORDS: [string, [number, number, number]][] = [['white', [235, 235, 235]], ['silver', [185, 188, 192]], ['grey', [120, 122, 126]], ['dark grey', [50, 54, 60]], ['black', [20, 20, 22]], ['red', [200, 50, 45]], ['blue', [60, 110, 190]], ['navy', [40, 55, 90]], ['brown', [120, 85, 55]], ['beige', [215, 200, 170]], ['green', [70, 120, 80]], ['yellow', [225, 180, 60]]];
function colorWord(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '';
  const v = parseInt(m[1], 16), c = [v >> 16, (v >> 8) & 255, v & 255];
  let best = '', d = Infinity;
  for (const [w, k] of COLOR_WORDS) { const e = (c[0] - k[0]) ** 2 + (c[1] - k[1]) ** 2 + (c[2] - k[2]) ** 2; if (e < d) { d = e; best = w; } }
  return best;
}
const CAR_WORD = { sedan: 'sedan', hatch: 'hatchback', suv: 'SUV', kei: 'small kei car' } as const;
const PROP_WORD: Record<string, string> = { table: 'garden table', chair: 'garden chair', tableset: 'garden table with four chairs', bench: 'bench', planter: 'planter', planterbench: 'planter with bench', bicycle: 'bicycle', motorbike: 'motorbike', faucet: 'garden water tap post', ac: 'air conditioner outdoor unit', dryer: 'laundry drying poles', meter: 'water meter lid' };
function partWord(s: Solid): string | null {
  switch (s.kind) {
    case 'car': return `${colorWord(s.color)} ${CAR_WORD[s.body ?? 'hatch']}`.trim();
    case 'carport': return s.posts === 2 ? 'bicycle port' : 'carport';
    case 'tree': return s.form === 'palm' ? 'palm tree' : s.form === 'cone' ? 'conifer' : s.form === 'multi' ? 'multi-stem deciduous tree' : 'broadleaf tree';
    case 'shrub': return s.form === 'tuft' ? 'ornamental grass' : s.form === 'rosette' ? 'agave' : s.form === 'cover' ? 'ground cover plant' : s.flower ? 'flowering shrub' : 'shrub';
    case 'hedge': return 'hedge';
    case 'stone': return 'garden rock';
    case 'gatepost': return s.variant === 'func' ? 'slim mailbox post' : 'gate post wall';
    case 'shed': return 'storage shed';
    case 'light': return s.kind2 === 'pole' ? 'garden pole light' : 'garden spotlight';
    case 'person': return null; // 人は描かせない
    case 'prop': return PROP_WORD[s.type] || null;
    case 'gate': return 'gate';
    default: return null; // 塀・フェンス・建物は形で分かる
  }
}
export function renderParts(doc: Doc, lib: LibItem[]): string {
  const count = new Map<string, number>(), ids = new Set<string>();
  for (const s of buildScene(doc, lib).solids) {
    const w = partWord(s); if (!w) continue;
    const key = s.kind === 'gate' ? `${w}/${s.src}` : `${w}/${s.src ?? ''}`;
    if (ids.has(key)) continue; ids.add(key);
    count.set(w, (count.get(w) || 0) + 1);
  }
  return [...count].map(([w, n]) => `${n} ${w}`).join(', ').slice(0, 600);
}

// サーバーにパースを頼む。サーバーは画像AIを最大170秒待つ（worker/render.ts の TIMEOUT_MS）ので、アプリはそれより長く待つ
export const RENDER_TIMEOUT_MS = 185_000;
export async function requestRender(p: { image: string; view: RenderView; style: RenderStyle; note: string; aspect: string; parts?: string }): Promise<{ image: string; text?: string; ms?: number }> {
  const r = await apiPost('/api/ai/render', { ...p, size: '2K' }, { readTimeoutMs: RENDER_TIMEOUT_MS });
  const data = r.data as { image?: string; text?: string; ms?: number; error?: string };
  if (!r.ok || !data.image) throw Error(data.error || (r.status === 401 || r.status === 403 ? (isNativeApp() ? 'AIの通行証が通りませんでした。アプリを最新版にしてください' : 'ログインし直してください') : '画像AIにつながりませんでした'));
  return { image: data.image, text: data.text, ms: data.ms };
}

export function newRender(docId: string, view: RenderView, style: RenderStyle, note: string, src: string, ms?: number): Render {
  return { id: uid(), docId, at: new Date().toISOString(), view, style, note, src, ms };
}

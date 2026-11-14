// AIパース：3D画面の写しをサーバーの画像AI（/api/ai/render）に渡して写真調のパースにする。
// できた絵は端末（IndexedDB の renders）に図面IDつきで残す。図面データ本体には入れない（容量が大きいため）。
import { apiPost, isNativeApp } from './platform';
import { uid } from './types';

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

// サーバーにパースを頼む
export async function requestRender(p: { image: string; view: RenderView; style: RenderStyle; note: string; aspect: string }): Promise<{ image: string; text?: string; ms?: number }> {
  const r = await apiPost('/api/ai/render', { ...p, size: '2K' });
  const data = r.data as { image?: string; text?: string; ms?: number; error?: string };
  if (!r.ok || !data.image) throw Error(data.error || (r.status === 401 || r.status === 403 ? (isNativeApp() ? 'AIの通行証が通りませんでした。アプリを最新版にしてください' : 'ログインし直してください') : '画像AIにつながりませんでした'));
  return { image: data.image, text: data.text, ms: data.ms };
}

export function newRender(docId: string, view: RenderView, style: RenderStyle, note: string, src: string, ms?: number): Render {
  return { id: uid(), docId, at: new Date().toISOString(), view, style, note, src, ms };
}

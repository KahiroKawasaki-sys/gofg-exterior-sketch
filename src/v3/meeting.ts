// 打ち合わせAI（画面側）：iPadの音声認識で会話を文字にし、サーバーのAIに要望を読み取らせる。
// 読み取った要望はカードにして、押すと図面（塀・フェンスの高さ）や見積（追加項目・予算）に反映する。
import { type Doc, type Item, type DocEstimate, type AiAction, type MeetRequest, type Meeting, uid } from './types';
import { canRaise, resolveRole } from './scene3d';
import { type PriceBook } from './estimate';
import { apiPost, isNativeApp, nativeSpeech } from './platform';

export type { AiAction, MeetRequest, MeetLine, Meeting } from './types';

const KINDS = ['駐車場', '舗装・素材', '塀・フェンス', '門まわり', '植栽', '設備', '予算', '工期', 'その他'];
const STATUS = ['要望', '決定', '検討中', '不要'] as const;

export const transcriptText = (m: Meeting) => m.lines.map(l => l.text).join('\n');

// AIの返事を確かめながら取り込む。同じidの要望は「反映済み」を引き継ぎ、新しい要望にはidを振る
export function mergeRequests(prev: MeetRequest[], incoming: unknown[]): MeetRequest[] {
  const old = new Map(prev.map(r => [r.id, r]));
  const out: MeetRequest[] = [];
  for (const raw of incoming) {
    const v = raw as Partial<MeetRequest> & { action?: Record<string, unknown> };
    if (!v || typeof v.text !== 'string' || !v.text.trim()) continue;
    const id = typeof v.id === 'string' && old.has(v.id) ? v.id : 'r' + uid().slice(0, 8);
    const action = cleanAction(v.action);
    const before = old.get(id);
    out.push({
      id, text: v.text.trim().slice(0, 200), kind: KINDS.includes(v.kind as string) ? v.kind as string : 'その他',
      status: STATUS.includes(v.status as typeof STATUS[number]) ? v.status as MeetRequest['status'] : '要望',
      ...(typeof v.quote === 'string' && v.quote.trim() && { quote: v.quote.trim().slice(0, 200) }),
      ...(action && { action }),
      ...(before?.applied && sameAction(before.action, action) && { applied: true }),
    });
  }
  return out;
}
function cleanAction(a: Record<string, unknown> | undefined): AiAction | undefined {
  if (!a || typeof a !== 'object') return;
  const n = (v: unknown) => typeof v === 'number' && isFinite(v) ? v : NaN;
  if (a.type === 'height' && (a.role === 'wall' || a.role === 'fence') && n(a.mm) >= 200 && n(a.mm) <= 4000) return { type: 'height', role: a.role, mm: Math.round(n(a.mm)) };
  if (a.type === 'extra' && typeof a.name === 'string' && a.name.trim()) return { type: 'extra', name: a.name.trim().slice(0, 80), ...(n(a.qty) > 0 && { qty: n(a.qty) }), ...(typeof a.unit === 'string' && a.unit && { unit: a.unit.slice(0, 10) }) };
  if (a.type === 'budget' && n(a.yen) >= 10000) return { type: 'budget', yen: Math.round(n(a.yen)) };
}
const sameAction = (a?: AiAction, b?: AiAction) => JSON.stringify(a) === JSON.stringify(b);

export const actionLabel = (a: AiAction) =>
  a.type === 'height' ? `${a.role === 'wall' ? '塀' : 'フェンス'}の高さを ${(a.mm / 1000).toFixed(1)}m にする`
    : a.type === 'extra' ? `見積に「${a.name}」を${a.qty ? ` ${a.qty}${a.unit || ''}` : ''}足す`
      : `予算を ${a.yen.toLocaleString('ja-JP')}円 にする`;

// 反映：図面の塀・フェンスの高さ／見積の追加項目／予算。反映できなかったときは理由を返す
export function applyAction(doc: Doc, a: AiAction, book: PriceBook): { doc: Doc; message: string } {
  if (a.type === 'height') {
    let n = 0;
    const layers = doc.layers.map(l => ({ ...l, items: l.items.map(i => { if (!canRaise(i) || resolveRole(i, doc.mmPerPx) !== a.role) return i; n++; return { ...i, h3: a.mm } as Item; }) }));
    if (!n) return { doc, message: `図面に${a.role === 'wall' ? '塀' : 'フェンス'}の線がまだありません。線を引いて種類を選んでから反映してください` };
    return { doc: { ...doc, layers }, message: `${a.role === 'wall' ? '塀' : 'フェンス'} ${n}本の高さを ${(a.mm / 1000).toFixed(1)}m にしました` };
  }
  if (a.type === 'extra') {
    const it = book.items.find(i => i.name === a.name) || book.items.find(i => i.name.includes(a.name) || a.name.includes(i.name));
    const est: DocEstimate = doc.est || {};
    const extra = { id: uid(), name: it?.name || a.name, unit: it?.unit || a.unit || '式', qty: a.qty || 1, price: it?.price || 0 };
    return { doc: { ...doc, est: { ...est, extras: [...(est.extras || []), extra] } }, message: it ? `見積に「${extra.name}」を足しました` : `見積に「${extra.name}」を足しました。単価が未定なので見積で入れてください` };
  }
  return { doc: { ...doc, meeting: { ...(doc.meeting || { lines: [], requests: [] }), budget: a.yen } }, message: `予算を ${a.yen.toLocaleString('ja-JP')}円 にしました` };
}

// ---- 音声認識（ブラウザの Web Speech API。iPadのSafari・Chromeで使える） ----
type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SRClass = () => (globalThis as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  || (globalThis as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
export const speechAvailable = () => isNativeApp() || !!SRClass();

// 止めるまで聞き続ける（Safari は無音が続くと止まるので、自動でつなぎ直す）
export function listen(onFinal: (text: string) => void, onInterim: (text: string) => void, onError: (msg: string) => void): () => void {
  if (isNativeApp()) return listenNative(onFinal, onInterim, onError);
  const C = SRClass(); if (!C) { onError('この端末では音声認識が使えません。iPadのSafariで開いてください'); return () => {}; }
  let active = true, rec: SR | null = null;
  const start = () => {
    rec = new C(); rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], t = r[0]?.transcript || '';
        if (r.isFinal) { if (t.trim()) onFinal(t.trim()); } else interim += t;
      }
      onInterim(interim);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active = false; onError('マイクの使用が許可されていません。設定でマイクを許可してください'); }
    };
    rec.onend = () => { onInterim(''); if (active) setTimeout(() => active && start(), 250); };
    try { rec.start(); } catch { /* 二重開始は無視 */ }
  };
  start();
  return () => { active = false; try { rec?.stop(); } catch { /* 停止済み */ } };
}

// アプリでは端末本体の音声認識を使う（アプリの中の画面ではWebの音声認識が安定しないため）
function listenNative(onFinal: (text: string) => void, onInterim: (text: string) => void, onError: (msg: string) => void): () => void {
  let stopped = false;
  const sp = nativeSpeech();
  const subs = Promise.all([sp.addListener('final', e => onFinal(e.text)), sp.addListener('partial', e => onInterim(e.text))]);
  sp.start().catch((e: Error) => { if (!stopped) onError(e.message || '音声認識を始められませんでした'); });
  return () => {
    stopped = true;
    sp.stop().catch(() => {}).finally(() => subs.then(hs => hs.forEach(h => h.remove())));
    onInterim('');
  };
}

// サーバーのAIに読み取らせる
export async function readRequests(m: Meeting, book: PriceBook): Promise<{ requests: MeetRequest[]; usage?: { input: number; output: number } }> {
  const r = await apiPost('/api/ai/meeting', { transcript: transcriptText(m), previous: m.requests.map(q => ({ id: q.id, text: q.text })), items: [...new Set(book.items.map(i => i.name))].slice(0, 150) });
  const data = r.data as { requests?: unknown[]; error?: string; usage?: { input: number; output: number } };
  if (!r.ok) throw Error(data.error || (r.status === 401 || r.status === 403 ? (isNativeApp() ? 'AIの通行証が通りませんでした。アプリを最新版にしてください' : 'ログインし直してください') : 'AIにつながりませんでした'));
  return { requests: mergeRequests(m.requests, data.requests || []), usage: data.usage };
}

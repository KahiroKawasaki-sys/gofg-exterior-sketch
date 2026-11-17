// 打ち合わせAI（画面側）：録音を文字にした全文から、サーバーのAIに議事録を作らせる。
// 全文（時刻つき）と議事録は、コピー・共有・ファイル保存できる（打ち合わせのサンプル回収にも使う）。
// 下の「要望の読み取り・図面／見積への反映」（readRequests・applyAction・summaryText など）は一旦停止中。画面からは呼ばない。
import { type Doc, type Item, type DocEstimate, type AiAction, type MeetRequest, type Meeting, type MeetLine, uid } from './types';
import { canRaise, resolveRole } from './scene3d';
import { type PriceBook } from './estimate';
import { apiPost, isNativeApp, nativeSpeech } from './platform';

export type { AiAction, MeetRequest, MeetLine, Meeting } from './types';

const KINDS = ['駐車場', '舗装・素材', '塀・フェンス', '門まわり', '植栽', '設備', '予算', '工期', 'その他'];
const STATUS = ['要望', '決定', '検討中', '不要'] as const;

export const transcriptText = (m: Meeting) => m.lines.map(l => l.text).join('\n');

// ---- 文字起こしの全文（時刻つき）と議事録 ----
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '--:--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const elapsed = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
export const dateLabel = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`;
const startOf = (m: Meeting, now?: Date) => m.startedAt ? new Date(m.startedAt) : m.lines[0] ? new Date(m.lines[0].t) : now || new Date();
// 1行：[時:分:秒 / 録音を始めてからの時間] 文字。手で足したメモは [時:分:秒 / メモ]
export const lineStamp = (l: MeetLine) => `[${clock(l.t)} / ${l.from != null ? elapsed(l.from) : 'メモ'}]`;
export const timedTranscript = (m: Meeting) => m.lines.map(l => `${lineStamp(l)} ${l.text}`).join('\n');

// ファイル・共有に出す全文（見出しつき）
export function transcriptExport(m: Meeting, o: { name?: string; now?: Date } = {}): string {
  return [
    `【打ち合わせ 文字起こし（全文）】${o.name ? ` ${o.name}` : ''}`,
    `開始：${dateLabel(startOf(m, o.now))}　行数：${m.lines.length}`,
    '時刻の見方：[時:分:秒 / 録音を始めてからの時間]（「メモ」は手で足した行）',
    '',
    timedTranscript(m),
  ].join('\n');
}

// ファイル名（例：山田様邸_文字起こし_20261117-1030.txt）。使えない文字は _ にする
export function exportFileName(kind: '文字起こし' | '議事録', name: string | undefined, d: Date): string {
  const base = (name || '打ち合わせ').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60);
  return `${base}_${kind}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
}

// 議事録は長い打ち合わせだと時間がかかるので、アプリで返事を待つ長さを延ばす（既定は120秒）
export const MINUTES_TIMEOUT_MS = 240000;
// サーバーのAIに議事録を作らせる（同じ口 /api/ai/meeting を mode:'minutes' で使う）
export async function makeMinutes(m: Meeting, o: { name?: string; now?: Date } = {}): Promise<{ minutes: string; usage?: { input: number; output: number } }> {
  const r = await apiPost('/api/ai/meeting', { mode: 'minutes', transcript: timedTranscript(m), name: o.name || '', date: dateLabel(startOf(m, o.now)) }, { readTimeoutMs: MINUTES_TIMEOUT_MS });
  const data = r.data as { minutes?: unknown; error?: string; usage?: { input: number; output: number } };
  if (!r.ok) throw Error(data.error || (r.status === 401 || r.status === 403 ? (isNativeApp() ? 'AIの通行証が通りませんでした。アプリを最新版にしてください' : 'ログインし直してください') : 'AIにつながりませんでした'));
  if (typeof data.minutes !== 'string' || !data.minutes.trim()) throw Error('議事録を作れませんでした。もう一度押してください');
  return { minutes: data.minutes.trim(), usage: data.usage };
}

// ---- ここから下は一旦停止中（要望の読み取り・図面／見積への反映）。戻すときのために残す ----

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

// 前回AIに読ませてから増えた行数
export const unreadCount = (m: Meeting, readCount: number) => Math.max(0, m.lines.length - Math.min(readCount, m.lines.length));

// 打ち合わせのまとめ（LINE・メールに貼る箇条書き）。決定→要望→検討中の順、予算と見積、反映済み
export function summaryText(m: Meeting, o: { total?: number; name?: string; now?: Date } = {}): string {
  const now = o.now || new Date();
  const live = m.requests.filter(r => r.status !== '不要');
  const sec = (title: string, rows: MeetRequest[]) => rows.length ? [`■${title}`, ...rows.map(r => `・${r.text}${r.applied && r.action ? `（${actionLabel(r.action)}：反映済み）` : ''}`)] : [];
  const out = [`【打ち合わせまとめ】${o.name ? ` ${o.name}` : ''}`, `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`, ''];
  out.push(...sec('決まったこと', live.filter(r => r.status === '決定')));
  out.push(...sec('ご要望', live.filter(r => r.status === '要望')));
  out.push(...sec('検討中', live.filter(r => r.status === '検討中')));
  if (m.budget != null) {
    out.push('', `■ご予算 ${m.budget.toLocaleString('ja-JP')}円`);
    if (o.total != null) out.push(`　概算見積 ${Math.round(o.total).toLocaleString('ja-JP')}円（${o.total > m.budget ? `${Math.round(o.total - m.budget).toLocaleString('ja-JP')}円 超過` : `残り ${Math.round(m.budget - o.total).toLocaleString('ja-JP')}円`}）`);
  }
  if (!live.length) out.push('（要望はまだありません）');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 打ち合わせの録音：数分ごとの区切り（チャンク）で音声を取り出し、順にサーバーへ送って文字にする。
// 録音そのものは端末の中だけ。文字になった区切りの音声は消す。
import { apiPost, blobBase64, isNativeApp, nativeRecorder } from './platform';

export const SEGMENT_MS = 3 * 60 * 1000; // 1区切り3分（AAC 32kbps で約0.7MB）

export type Chunk = { i: number; startMs: number; durMs: number; base64: string; mime: string; path?: string };
export type SegState = { i: number; startMs: number; durMs: number; state: 'queued' | 'sending' | 'done' | 'error'; error?: string; tries: number };
export type TranscribedLine = { from: number; to: number; text: string };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

export type AudioSource = { start(): Promise<void>; stop(): Promise<void> };
type OnChunk = (c: Chunk) => void;
type OnState = (s: RecorderState, message?: string) => void;

export const recordingAvailable = () => isNativeApp() || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');

// ブラウザで録音できる形式（Safari は mp4、Chrome は webm）
export function pickMime(supported: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(supported) || '';
}

// ブラウザ：MediaRecorder を区切りごとに止めて作り直す（1ファイルずつ単独で読める形にするため）
export function webSource(onChunk: OnChunk, onState: OnState, segmentMs = SEGMENT_MS): AudioSource {
  let stream: MediaStream | null = null, rec: MediaRecorder | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let i = 0, t0 = 0, stopping = false, finished: (() => void) | null = null;
  const mime = pickMime();
  const begin = () => {
    if (!stream) return;
    const r = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), audioBitsPerSecond: 32000 });
    const parts: Blob[] = [], start = Date.now(), index = i++;
    r.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    r.onstop = async () => {
      const blob = new Blob(parts, { type: r.mimeType || mime });
      if (blob.size > 0) {
        try { onChunk({ i: index, startMs: start - t0, durMs: Date.now() - start, base64: await blobBase64(blob), mime: blob.type }); }
        catch { onState('error', '録音データを読めませんでした'); }
      }
      if (stopping && rec === r) finished?.();
    };
    r.onerror = () => onState('error', '録音が止まりました');
    r.start();
    rec = r;
    timer = setTimeout(() => { if (!stopping) { const old = rec; begin(); old?.stop(); } }, segmentMs);
  };
  return {
    async start() {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { throw Error((e as Error).name === 'NotAllowedError' ? 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください' : 'マイクを使えませんでした'); }
      t0 = Date.now(); i = 0; stopping = false;
      begin(); onState('recording');
    },
    async stop() {
      stopping = true; if (timer) clearTimeout(timer);
      const r = rec;
      if (r && r.state !== 'inactive') { await new Promise<void>(res => { finished = res; r.stop(); }); }
      stream?.getTracks().forEach(t => t.stop()); stream = null; rec = null;
      onState('idle');
    },
  };
}

// アプリ：端末の録音プラグイン（ios/App/App/RecorderPlugin.swift）。画面を閉じていても録音が続く
export function nativeSource(onChunk: OnChunk, onState: OnState, segmentMs = SEGMENT_MS): AudioSource {
  const p = nativeRecorder();
  let handles: Promise<{ remove(): Promise<void> }[]> | null = null;
  return {
    async start() {
      handles = Promise.all([
        p.addListener('segment', e => onChunk({ i: e.i, startMs: e.startMs, durMs: e.durMs, base64: e.base64, mime: e.mime || 'audio/mp4', path: e.path })),
        p.addListener('state', e => onState(e.state, e.message)),
      ]);
      await p.start({ segmentSec: Math.round(segmentMs / 1000) });
      onState('recording');
    },
    async stop() {
      try { await p.stop(); } finally { await handles?.then(hs => Promise.all(hs.map(h => h.remove()))); handles = null; onState('idle'); }
    },
  };
}

export const audioSource = (onChunk: OnChunk, onState: OnState, segmentMs = SEGMENT_MS) => isNativeApp() ? nativeSource(onChunk, onState, segmentMs) : webSource(onChunk, onState, segmentMs);

// 区切りをサーバーで文字にする（既定の送り方）
export async function postChunk(c: Chunk, terms: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return apiPost('/api/ai/transcribe', { audio: c.base64, index: c.i, startMs: c.startMs, terms });
}

const RETRY_MS = [2000, 5000, 15000];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// 送り手：区切りを順に1つずつ送り、文字の行を返す。失敗は少し待って再試行し、止めたときは残りを送り切る
export class Transcriber {
  private queue: Chunk[] = [];
  private segs = new Map<number, SegState>();
  private running = false;
  private waiters: (() => void)[] = [];
  constructor(private o: {
    post?: (c: Chunk, terms: string) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>;
    terms?: () => string;
    onLines: (i: number, lines: TranscribedLine[]) => void;
    onState?: (segs: SegState[]) => void;
    discard?: (c: Chunk) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
    maxTries?: number;
  }) {}

  get segments(): SegState[] { return [...this.segs.values()].sort((a, b) => a.i - b.i); }
  get busy() { return this.running || this.queue.length > 0; }
  get doneMs() { return this.segments.filter(s => s.state === 'done').reduce((a, s) => a + s.durMs, 0); }
  get totalMs() { return this.segments.reduce((a, s) => a + s.durMs, 0); }

  add(c: Chunk) {
    this.segs.set(c.i, { i: c.i, startMs: c.startMs, durMs: c.durMs, state: 'queued', tries: 0 });
    this.queue.push(c); this.queue.sort((a, b) => a.i - b.i);
    this.emit(); void this.pump();
  }
  // 失敗した区切りをもう一度送る
  retry(chunks: Chunk[]) {
    for (const c of chunks) { const s = this.segs.get(c.i); if (s && s.state === 'error') { s.state = 'queued'; s.tries = 0; s.error = undefined; this.queue.push(c); } }
    this.queue.sort((a, b) => a.i - b.i); this.emit(); void this.pump();
  }
  // 送り終わる（成功か、再試行を使い切る）まで待つ
  flush(): Promise<void> { return this.busy ? new Promise(res => this.waiters.push(res)) : Promise.resolve(); }

  private emit() { this.o.onState?.(this.segments); }
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const c = this.queue.shift()!, s = this.segs.get(c.i)!;
        s.state = 'sending'; this.emit();
        const max = this.o.maxTries ?? RETRY_MS.length + 1;
        for (;;) {
          s.tries++;
          let r: { ok: boolean; status: number; data: Record<string, unknown> } | null = null, err = '';
          try { r = await (this.o.post || postChunk)(c, this.o.terms?.() || ''); } catch (e) { err = (e as Error).message || '送信できませんでした'; }
          if (r?.ok) {
            const lines = Array.isArray(r.data.lines) ? (r.data.lines as TranscribedLine[]).filter(l => l && typeof l.text === 'string') : [];
            this.o.onLines(c.i, lines);
            s.state = 'done'; this.emit();
            await this.o.discard?.(c).catch(() => {});
            break;
          }
          const status = r?.status || 0, message = (r?.data?.error as string) || err || '文字起こしに失敗しました';
          const fatal = status === 413 || status === 401 || status === 403 || status === 400;
          if (fatal || s.tries >= max) { s.state = 'error'; s.error = fatal ? message : `${message}（${s.tries}回試しました）`; this.emit(); break; }
          await (this.o.wait || sleep)(RETRY_MS[Math.min(s.tries - 1, RETRY_MS.length - 1)]);
        }
      }
    } finally {
      this.running = false;
      if (!this.queue.length) { const ws = this.waiters; this.waiters = []; ws.forEach(w => w()); }
      else void this.pump();
    }
  }
}

// 行を打ち合わせの記録の形にする（時刻は録音開始からの秒を、開始時刻に足した実時刻）
export function toMeetLines(startedAt: number, lines: TranscribedLine[]) {
  return lines.map(l => ({ t: new Date(startedAt + l.from * 1000).toISOString(), text: l.text, from: l.from, to: l.to }));
}

// 行を時刻順に並べ直す（区切りが順不同で届いても会話の順になる）
export function sortLines<T extends { from?: number; t: string }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => (a.from ?? Date.parse(a.t) / 1000) - (b.from ?? Date.parse(b.t) / 1000) || Date.parse(a.t) - Date.parse(b.t));
}

export const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

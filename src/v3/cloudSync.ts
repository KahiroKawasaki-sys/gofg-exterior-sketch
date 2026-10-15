// v0.3 キャンバスのクラウド保存（Web版）。端末保存（IndexedDB）を正とし、裏でクラウドへ送る・受け取る。
// サーバーは v0.2 と同じ Cloudflare Worker + D1。ファイルの分割保存・本人確認・容量上限も共通。
import { type Doc, uid } from './types';
import { listDocs, loadDoc, saveDoc, deleteDoc, getMeta, setMeta, deleteMeta, listMeta, validDoc } from './store';
import { isNativeApp } from './platform';

const CHUNK = 1024 * 1024, ASSET = 'gofg-asset:', SYNC = 'cloud-sync:', DEL = 'cloud-delete:';
type SyncState = { cloudRevision: number; syncedUpdatedAt: string; payload: string };
type Record3 = Doc & { thumb?: string };
export type CloudHead = { id: string; name: string; revision: number; payload: string; deleted: number; updated: string };
export type CloudState = { phase: 'off' | 'syncing' | 'synced' | 'pending' | 'error'; message: string; detail?: string; forked?: number };
export class CloudError extends Error { constructor(message: string, public status: number) { super(message); } }

const hash = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
async function api<T>(path: string, method = 'GET', body?: BodyInit): Promise<T> {
  let r: Response;
  try { r = await fetch('/api' + path, { method, body, credentials: 'same-origin', cache: 'no-store', headers: { 'X-Sketch-Client': '2', 'Content-Type': body instanceof ArrayBuffer ? 'application/octet-stream' : 'application/json' }, signal: AbortSignal.timeout(30000) }); }
  catch { throw new CloudError('通信できません。図面は端末に保存してあり、つながったら送ります', 0); }
  if (!r.headers.get('content-type')?.includes('application/json')) throw new CloudError('ログインの期限切れか、通信を確認してください。図面は端末に残っています', 401);
  const data = await r.json();
  if (!r.ok) throw new CloudError(data.error || 'クラウド保存に失敗しました', r.status);
  return data as T;
}

// ---------- ファイル本体（1MBごとに分割・SHA-256で照合。同じ画像は二度送らない） ----------
async function upload(blob: Blob, name: string) {
  const hashes: string[] = [];
  for (let o = 0; o < blob.size; o += CHUNK) hashes.push(await hash(await blob.slice(o, o + CHUNK).arrayBuffer()));
  const id = await hash(new TextEncoder().encode(hashes.join('') + ':' + blob.size));
  const head = await api<{ complete: boolean }>('/blobs', 'POST', JSON.stringify({ id, bytes: blob.size, hashes, media: blob.type, name }));
  if (!head.complete) {
    for (let n = 0; n < hashes.length; n++) await api('/blobs/' + id + '/' + n, 'PUT', await blob.slice(n * CHUNK, (n + 1) * CHUNK).arrayBuffer());
    await api('/blobs/' + id + '/complete', 'POST', '{}');
  }
  return id;
}
async function download(id: string) {
  const m = await api<{ bytes: number; parts: number; hashes: string[]; media: string }>('/blobs/' + id);
  if (m.bytes > 24 * CHUNK || m.parts !== Math.ceil(m.bytes / CHUNK)) throw Error('保存ファイルの容量が正しくありません');
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  for (let n = 0; n < m.parts; n++) {
    const { body } = await api<{ body: string }>('/blobs/' + id + '/' + n), bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    if (await hash(bytes) !== m.hashes[n]) throw Error('受信データの確認に失敗しました。もう一度同期してください');
    pieces.push(bytes);
  }
  return new Blob(pieces, { type: m.media });
}
function toBase64(bytes: Uint8Array) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromDataURL(src: string) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(src.slice(0, 40));
  if (!m) return null;
  const bin = atob(src.slice(m[0].length)), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// 下絵・塗りの画像（data URL）は編集データから外して別ファイルにする。保存のたびに画像を送り直さないため
const known = new Map<string, string>();
const remember = (src: string, id: string) => { if (known.size > 60) known.delete(known.keys().next().value!); known.set(src, id); };
async function pack(v: unknown): Promise<unknown> {
  if (typeof v === 'string') {
    if (v.length < 2048 || !v.startsWith('data:image/')) return v;
    const hit = known.get(v); if (hit) return ASSET + hit;
    const blob = fromDataURL(v); if (!blob) return v;
    const id = await upload(blob, 'image'); remember(v, id); return ASSET + id;
  }
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await pack(x)); return out; }
  if (v && typeof v === 'object') { const out: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) out[k] = await pack(x); return out; }
  return v;
}
async function unpack(v: unknown, got = new Map<string, string>()): Promise<unknown> {
  if (typeof v === 'string' && v.startsWith(ASSET)) {
    const id = v.slice(ASSET.length);
    if (!got.has(id)) { const b = await download(id), src = `data:${b.type};base64,${toBase64(new Uint8Array(await b.arrayBuffer()))}`; got.set(id, src); remember(src, id); }
    return got.get(id);
  }
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await unpack(x, got)); return out; }
  if (v && typeof v === 'object') { const out: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) out[k] = await unpack(x, got); return out; }
  return v;
}

// ---------- 1枚ずつの送受信 ----------
const isDirty = (rec: Record3 | undefined, s: SyncState | undefined) => !!rec && rec.updatedAt !== s?.syncedUpdatedAt;
async function push(id: string, retried = false): Promise<void> {
  const rec = await loadDoc(id) as Record3 | undefined, s = await getMeta<SyncState>(SYNC + id);
  if (!rec || !isDirty(rec, s)) return;
  const { thumb, view: _view, ...doc } = rec;
  const body = { doc: await pack(doc), thumb: thumb ? await pack(thumb) : undefined };
  const payload = await upload(new Blob([JSON.stringify(body)], { type: 'application/json' }), 'canvas.json'), expectedRevision = s?.cloudRevision || 0;
  try {
    const r = await api<{ revision: number }>('/canvases/' + encodeURIComponent(id), 'PUT', JSON.stringify({ payload, expectedRevision, operation: payload + '_' + expectedRevision }));
    await setMeta(SYNC + id, { cloudRevision: r.revision, syncedUpdatedAt: rec.updatedAt, payload } satisfies SyncState);
  } catch (e) {
    // 送ったつもりの画像がクラウドで整理済みだった場合は、覚えている画像を捨てて1回だけ送り直す
    if (e instanceof CloudError && e.status === 400 && !retried) { known.clear(); return push(id, true); }
    throw e;
  }
}
async function receive(head: CloudHead) {
  const data = JSON.parse(await (await download(head.payload)).text());
  const doc = validDoc(await unpack(data.doc));
  if (doc.id !== head.id) throw Error('受信したキャンバスが一致しません');
  const thumb = typeof data.thumb === 'string' ? String(await unpack(data.thumb)) : undefined;
  await saveDoc(doc, thumb);
  await setMeta(SYNC + doc.id, { cloudRevision: head.revision, syncedUpdatedAt: doc.updatedAt, payload: head.payload } satisfies SyncState);
}

// 端末で消したキャンバスは、次の同期でクラウド側にも削除の印を付ける
export async function markDeleted(id: string) {
  const s = await getMeta<SyncState>(SYNC + id);
  if (s) await setMeta(DEL + id, { cloudRevision: s.cloudRevision });
  await deleteMeta(SYNC + id);
}

/** pull=true でクラウドの変更も取り込む。同じ図面を2台で同時に編集した場合は、端末の版を別名で残してクラウドの版を受け取る */
export async function synchronize(pull = true): Promise<{ forked: number; pending: number }> {
  const status = await api<{ available: boolean; error?: string }>('/session');
  if (!status.available) throw new CloudError(status.error || 'クラウド保存は準備中です。図面は端末に保存しています', 503);
  let forked = 0;
  if (pull) {
    const { canvases } = await api<{ canvases: CloudHead[] }>('/canvases');
    const deleting = new Set((await listMeta(DEL)).map(m => m.id.slice(DEL.length)));
    for (const head of canvases) {
      if (deleting.has(head.id)) continue;
      const rec = await loadDoc(head.id) as Record3 | undefined, s = await getMeta<SyncState>(SYNC + head.id), dirty = isDirty(rec, s);
      if (head.revision === (s?.cloudRevision || 0)) continue;
      if (head.deleted) {
        // 他の端末で削除済み。手元で編集していなければ消し、編集していればその版を送り直して残す
        if (rec && !dirty) await deleteDoc(head.id);
        await setMeta(SYNC + head.id, { cloudRevision: head.revision, syncedUpdatedAt: dirty ? s?.syncedUpdatedAt || '' : '', payload: head.payload } satisfies SyncState);
        continue;
      }
      if (rec && dirty) {
        const { thumb, ...doc } = rec;
        await saveDoc({ ...doc, id: uid(), name: doc.name + '（この端末の版）', updatedAt: new Date().toISOString() }, thumb);
        forked++;
      }
      await receive(head);
    }
  }
  for (const t of await listMeta<{ cloudRevision: number }>(DEL)) {
    const id = t.id.slice(DEL.length);
    try { await api('/canvases/' + encodeURIComponent(id), 'PUT', JSON.stringify({ deleted: true, expectedRevision: t.value.cloudRevision, operation: 'del_' + t.value.cloudRevision })); }
    catch (e) { if (!(e instanceof CloudError && e.status === 409)) throw e; } // 他の端末で更新されていれば、そちらを残す
    await deleteMeta(t.id);
  }
  let pending = 0;
  for (const d of await listDocs()) {
    try { await push(d.id); } catch (e) { if (e instanceof CloudError && e.status === 409) { pending++; continue; } throw e; }
  }
  return { forked, pending };
}

// ---------- 画面向け：状態の通知と自動同期 ----------
let state: CloudState = { phase: 'off', message: '端末に保存しています' };
const listeners = new Set<(s: CloudState) => void>();
const emit = (s: CloudState) => { state = s; listeners.forEach(f => f(s)); };
export function onCloudState(f: (s: CloudState) => void) { listeners.add(f); f(state); return () => { listeners.delete(f); }; }

let running: Promise<void> | null = null, queued: boolean | null = null, pushTimer = 0, retryTimer = 0;
export function syncNow(pull = true): Promise<void> {
  if (isNativeApp()) { emit({ phase: 'off', message: 'アプリ版は端末に保存しています' }); return Promise.resolve(); }
  if (running) { queued = !!queued || pull; return running; }
  running = (async () => {
    for (let next: boolean | null = pull; next !== null; next = queued) {
      queued = null; clearTimeout(retryTimer);
      emit({ phase: 'syncing', message: 'クラウドと同期中…', forked: state.forked });
      try {
        const r = await synchronize(next), forked = (state.forked || 0) + r.forked;
        emit(r.pending ? { phase: 'pending', message: `未送信 ${r.pending}件（次の同期で送ります）`, forked } : { phase: 'synced', message: 'クラウドに保存済み', forked });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'クラウド保存に失敗しました';
        if (e instanceof CloudError && e.status === 503) emit({ phase: 'off', message: 'クラウド保存は準備中（端末に保存）', detail: msg });
        else { emit({ phase: 'error', message: 'クラウド未送信（端末には保存済み）', detail: msg, forked: state.forked }); retryTimer = window.setTimeout(() => syncNow(false), 60000); }
      }
    }
  })().finally(() => { running = null; });
  return running;
}
/** 編集の保存後に呼ぶ。数秒まとめてからクラウドへ送る */
export function schedulePush() {
  if (isNativeApp()) return;
  clearTimeout(pushTimer); pushTimer = window.setTimeout(() => syncNow(false), 4000);
}
export const clearForkNotice = () => emit({ ...state, forked: 0 });

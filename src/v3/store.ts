// v0.3 の端末保存（IndexedDB）。v0.2 の案件データとは別のDBに置き、旧データは変更しない。
import { type Doc, type LibItem } from './types';

const DB = 'gofg-sketch-v3';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { for (const n of ['docs', 'library', 'meta']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode), req = f(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result as T : undefined as T);
      t.onerror = t.onabort = () => reject(t.error || Error('端末保存に失敗しました'));
    });
  } finally { db.close(); }
}

export type DocMeta = { id: string; name: string; updatedAt: string; thumb?: string };
export const listDocs = async () => (await tx<(Doc & { thumb?: string })[]>('docs', 'readonly', s => s.getAll()))
  .map(d => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, thumb: d.thumb }))
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const loadDoc = (id: string) => tx<Doc | undefined>('docs', 'readonly', s => s.get(id));
export const saveDoc = (doc: Doc, thumb?: string) => tx<void>('docs', 'readwrite', s => { s.put({ ...doc, thumb }); });
export const deleteDoc = (id: string) => tx<void>('docs', 'readwrite', s => { s.delete(id); });
export const listLibrary = async () => (await tx<LibItem[]>('library', 'readonly', s => s.getAll())) || [];
export const saveLibItem = (l: LibItem) => tx<void>('library', 'readwrite', s => { s.put(l); });
export const deleteLibItem = (id: string) => tx<void>('library', 'readwrite', s => { s.delete(id); });
export const getMeta = <T,>(id: string) => tx<{ id: string; value: T } | undefined>('meta', 'readonly', s => s.get(id)).then(v => v?.value);
export const setMeta = (id: string, value: unknown) => tx<void>('meta', 'readwrite', s => { s.put({ id, value }); });

export function validDoc(v: unknown): Doc {
  const d = v as Doc;
  if (!d || d.schema !== 3 || typeof d.id !== 'string' || !Array.isArray(d.layers) || !Array.isArray(d.guides)) throw Error('このファイルは外構スケッチv0.3の編集データではありません');
  return d;
}

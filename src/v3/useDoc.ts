// 編集中の図面と取り消し・やり直しの履歴
import { useCallback, useRef, useState } from 'react';
import { type Doc, type Item, type Layer, newDoc, newLayer, uid } from './types';
import { builtinLibrary } from './library';

export type HistEntry = { doc: Doc; label: string; at: number };

export function useDoc(initial: Doc) {
  const docRef = useRef(initial), past = useRef<HistEntry[]>([]), future = useRef<HistEntry[]>([]), base = useRef<Doc | null>(null);
  const [, force] = useState(0);
  const rerender = () => force(v => v + 1);

  // commit=true で履歴に積む。ドラッグ中は live() で画面だけ更新し、最後に end() で1件にまとめる
  const set = useCallback((next: Doc | ((d: Doc) => Doc), label = '編集') => {
    const prev = docRef.current, d = typeof next === 'function' ? next(prev) : next;
    if (d === prev) return;
    past.current.push({ doc: base.current || prev, label, at: Date.now() }); base.current = null;
    if (past.current.length > 120) past.current.shift();
    future.current = []; docRef.current = { ...d, updatedAt: new Date().toISOString() }; rerender();
  }, []);
  const live = useCallback((f: (d: Doc) => Doc) => { if (!base.current) base.current = docRef.current; docRef.current = f(docRef.current); rerender(); }, []);
  const end = useCallback((label = '編集') => { if (!base.current) return; const b = base.current; base.current = null; if (b === docRef.current) return; past.current.push({ doc: b, label, at: Date.now() }); future.current = []; docRef.current = { ...docRef.current, updatedAt: new Date().toISOString() }; rerender(); }, []);
  const cancel = useCallback(() => { if (base.current) { docRef.current = base.current; base.current = null; rerender(); } }, []);
  const undo = useCallback(() => { const e = past.current.pop(); if (!e) return; future.current.push({ doc: docRef.current, label: e.label, at: Date.now() }); docRef.current = e.doc; rerender(); }, []);
  const redo = useCallback(() => { const e = future.current.pop(); if (!e) return; past.current.push({ doc: docRef.current, label: e.label, at: Date.now() }); docRef.current = e.doc; rerender(); }, []);
  const restore = useCallback((i: number) => { const e = past.current[i]; if (!e) return; set(e.doc, '履歴から復元'); }, [set]);
  const reset = useCallback((d: Doc) => { docRef.current = d; past.current = []; future.current = []; base.current = null; rerender(); }, []);
  return { doc: docRef.current, set, live, end, cancel, undo, redo, restore, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0, history: past.current };
}

// レイヤー操作の小さなヘルパー
export const mapLayer = (d: Doc, id: string, f: (l: Layer) => Layer): Doc => ({ ...d, layers: d.layers.map(l => l.id === id ? f(l) : l) });
export const addItems = (d: Doc, layerId: string, items: Item[]): Doc => mapLayer(d, layerId, l => ({ ...l, items: [...l.items, ...items] }));
export const layerOfKind = (d: Doc, kind: Layer['kind']) => d.layers.find(l => l.kind === kind)!;
export function ensureLayer(d: Doc, kind: 'text' | 'object' | 'fill'): Doc {
  if (d.layers.some(l => l.kind === kind)) return d;
  const l = newLayer(kind === 'text' ? 'テキストレイヤー' : kind === 'object' ? 'オブジェクト' : '塗りレイヤー', kind);
  return { ...d, layers: kind === 'fill' ? [l, ...d.layers] : kind === 'object' ? [...d.layers.filter(x => x.kind !== 'text'), l, ...d.layers.filter(x => x.kind === 'text')] : [...d.layers, l] };
}
export function updateItem(d: Doc, id: string, f: (it: Item) => Item): Doc {
  return { ...d, layers: d.layers.map(l => l.items.some(i => i.id === id) ? { ...l, items: l.items.map(i => i.id === id ? f(i) : i) } : l) };
}
export function removeItems(d: Doc, ids: Set<string>): Doc {
  return { ...d, layers: d.layers.map(l => l.items.some(i => ids.has(i.id)) ? { ...l, items: l.items.filter(i => !ids.has(i.id)) } : l) };
}
export function findItem(d: Doc, id: string): { item: Item; layer: Layer } | null {
  for (const l of d.layers) { const item = l.items.find(i => i.id === id); if (item) return { item, layer: l }; }
  return null;
}

// 動画の最初の画面に近い見本（建物・敷地・車・自転車）
export function sampleDoc(): Doc {
  const d = newDoc('サンプル邸／外構スケッチ');
  const site = newLayer('レイヤー 4');
  const L = (pts: [number, number][], dash: 'solid' | 'dashed' = 'solid', width = 4): Item => ({ id: uid(), type: 'line', kind: 'polyline', color: '#2f3b38', width, dash, pts: pts.map(([x, y]) => ({ x, y })) });
  site.items.push(
    L([[0, -200], [0, 2350]]), L([[1150, -200], [1150, 2500]]),
    L([[0, 2350], [1150, 2500]], 'dashed', 3),
    L([[130, 0], [870, 0], [870, 1050], [800, 1050], [800, 1350], [130, 1350], [130, 0]], 'solid', 4.5),
    L([[800, 1150], [830, 1150]], 'solid', 3), L([[800, 1290], [830, 1290]], 'solid', 3),
    L([[812, 1195], [790, 1220], [812, 1245], [812, 1195]], 'solid', 2.5),
    L([[-800, 1900], [500, 3200]], 'dashed', 2.5),
    L([[1450, -200], [1450, 3000]], 'solid', 2.5),
  );
  const lib = builtinLibrary(), obj = (ref: string, x: number, y: number, rot = 0): Item => {
    const l = lib.find(v => v.id === ref)!; return { id: uid(), type: 'obj', ref, name: l.name, x: x - l.w / 2, y: y - l.h / 2, w: l.w, h: l.h, rot, flip: false, color: null };
  };
  const layers = d.layers.map(l => l.kind === 'object' ? { ...l, items: [obj('b-aqua', 520, 1820), obj('b-bicycle', 1240, 1950), obj('b-bicycle', 1300, 1950), obj('b-bike', 1740, 1960)] } : l);
  const l1 = layers.find(l => l.name === 'レイヤー 1')!;
  return { ...d, layers: [layers[0], site, ...layers.slice(1)], activeLayer: l1.id, view: undefined };
}

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
  // 打ち合わせの記録（会話・要望）は取り消しの対象にしない。履歴の各時点にも同じ記録を入れておく
  const setMeeting = useCallback((f: (m: Doc['meeting']) => Doc['meeting']) => {
    const meeting = f(docRef.current.meeting), put = (d: Doc) => ({ ...d, meeting });
    docRef.current = { ...put(docRef.current), updatedAt: new Date().toISOString() };
    if (base.current) base.current = put(base.current);
    past.current = past.current.map(e => ({ ...e, doc: put(e.doc) })); future.current = future.current.map(e => ({ ...e, doc: put(e.doc) }));
    rerender();
  }, []);
  const cancel = useCallback(() => { if (base.current) { docRef.current = base.current; base.current = null; rerender(); } }, []);
  const undo = useCallback(() => { const e = past.current.pop(); if (!e) return; future.current.push({ doc: docRef.current, label: e.label, at: Date.now() }); docRef.current = e.doc; rerender(); }, []);
  const redo = useCallback(() => { const e = future.current.pop(); if (!e) return; past.current.push({ doc: docRef.current, label: e.label, at: Date.now() }); docRef.current = e.doc; rerender(); }, []);
  const restore = useCallback((i: number) => { const e = past.current[i]; if (!e) return; set(e.doc, '履歴から復元'); }, [set]);
  const reset = useCallback((d: Doc) => { docRef.current = d; past.current = []; future.current = []; base.current = null; rerender(); }, []);
  return { doc: docRef.current, set, live, end, setMeeting, cancel, undo, redo, restore, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0, history: past.current };
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

// 塗りの切り抜き（白い多角形の画像）。画面ではPNG、画面のない所（テスト）ではSVGで作る
type XY = [number, number];
function polyMask(pts: XY[]): { mask: string; x: number; y: number; w: number; h: number } {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const S = 0.5, W = Math.max(1, Math.ceil(w * S)), H = Math.max(1, Math.ceil(h * S));
  if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
    try {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath();
      pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo']((px - x) * S, (py - y) * S));
      g.closePath(); g.fill();
      return { mask: c.toDataURL('image/png'), x, y, w, h };
    } catch { /* 下のSVGで代える */ }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}"><polygon points="${pts.map(([px, py]) => `${px - x},${py - y}`).join(' ')}" fill="#fff"/></svg>`;
  return { mask: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), x, y, w, h };
}

// 完成済みの見本：敷地（閉じた線）・建物・塗り分け・フェンスと門袖・植栽・カーポート。
// 3D・AIパース・見積がそのまま試せるよう、線の種類は最初から決めてある。敷地の左は練習用に空けておく
export function sampleDoc(): Doc {
  const d = newDoc('サンプル邸／外構スケッチ');
  const site = newLayer('敷地・建物');
  const L = (pts: XY[], extra: Partial<Item & { type: 'line' }> = {}, width = 4): Item =>
    ({ id: uid(), type: 'line', kind: 'polyline', color: '#2f3b38', width, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra }) as Item;
  const road = (x: number) => 2350 + x * 150 / 1150; // 道路との境（手前が少し斜め）
  site.items.push(
    L([[0, -200], [1150, -200], [1150, 2500], [0, 2350], [0, -200]], { role3: 'ground' }, 2.5), // 敷地の線（数えない）
    L([[130, 0], [870, 0], [870, 1050], [800, 1050], [800, 1350], [130, 1350], [130, 0]], { role3: 'building' }, 4.5),
    L([[800, 1150], [830, 1150]], { role3: 'ground' }, 3), L([[800, 1290], [830, 1290]], { role3: 'ground' }, 3),
    L([[812, 1195], [790, 1220], [812, 1245], [812, 1195]], { role3: 'ground' }, 2.5),
    L([[0, -200], [1150, -200], [1150, 1040]], { role3: 'fence', mat3: 'mesh', h3: 1000 }), // 裏と横のフェンス
    L([[1085, 2140], [1085, 2330]], { role3: 'wall', mat3: 'plaster', h3: 1400 }, 6), // 門袖の塀
  );
  const paint = (tex: string, name: string, pts: XY[]): Layer => {
    const layer = newLayer(`塗り（${name}）`, 'texture');
    layer.items = [{ id: uid(), type: 'texture', name, ...polyMask(pts), tex: 'b:' + tex, texName: name, scale: 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100 }];
    return layer;
  };
  const paints = [
    paint('gravel-gray', '砂利（グレー）', [[20, -180], [1130, -180], [1130, 1040], [880, 1040], [880, -10], [120, -10], [120, 1380], [20, 1380]]),
    paint('lawn', '芝生（やわらか）', [[20, 1390], [200, 1390], [200, 1600], [560, 1600], [560, 1390], [900, 1390], [900, 1740], [20, 1740]]),
    paint('deck', 'ウッドデッキ', [[200, 1360], [560, 1360], [560, 1600], [200, 1600]]),
    paint('concrete', '土間コンクリート', [[20, 1760], [900, 1760], [900, road(900) - 14], [20, road(20) - 14]]),
    paint('stone-random', '乱形石', [[900, 1060], [1040, 1060], [1040, road(1040) - 14], [900, road(900) - 14]]),
    paint('tile', 'タイル', [[805, 1055], [900, 1055], [900, 1345], [805, 1345]]),
    paint('soil', 'ウッドチップ・土', [[1040, 1060], [1130, 1060], [1130, road(1130) - 14], [1040, road(1040) - 14]]),
  ];
  const lib = builtinLibrary(), obj = (ref: string, x: number, y: number, rot = 0): Item => {
    const l = lib.find(v => v.id === ref)!; return { id: uid(), type: 'obj', ref, name: l.name, x: x - l.w / 2, y: y - l.h / 2, w: l.w, h: l.h, rot, flip: false, color: null };
  };
  const parts = [
    obj('b-carport1', 200, 2040), obj('b-aqua', 200, 2050), obj('b-kei3500', 500, 2060),
    obj('b-bicycle', 745, 1900), obj('b-bicycle', 800, 1900),
    obj('b-wc-tree-m', 725, 1560), obj('b-wc-olive', 105, 1500),
    obj('b-wc-shrub', 300, 1690), obj('b-wc-azalea', 400, 1690), obj('b-wc-shrub', 500, 1690), obj('b-wc-shrub-d', 600, 1690),
    obj('b-wc-shrub-d', 1085, 1480), obj('b-wc-azalea', 1085, 1640), obj('b-wc-shrub', 1085, 1800),
    obj('b-hosta', 640, 1450), obj('b-grass1', 830, 1680), obj('b-hosta', 1085, 1960),
    obj('b-light1', 1085, 1330), obj('b-light1', 1085, 2060), obj('b-light2', 640, 1640),
    obj('b-funcpost', 1085, 2400, 90), obj('b-faucet', 60, 1700), obj('b-shed', 260, -95),
  ];
  const layers = d.layers.map(l => l.kind === 'object' ? { ...l, items: parts } : l);
  const l1 = layers.find(l => l.name === 'レイヤー 1')!;
  return { ...d, layers: [layers[0], ...paints, site, ...layers.slice(1)], activeLayer: l1.id, view: undefined };
}

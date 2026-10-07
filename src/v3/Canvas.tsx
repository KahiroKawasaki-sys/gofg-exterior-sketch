// 作図領域。描画・選択・ガイド・ジェスチャーを扱う。
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { type Doc, type Item, type Layer, type LibItem, type Pt, type Guide, type Box, type Brush, type Dash, dist, rotPt, rad, deg, boxOf, itemBox, unionBox, pointInPoly, segDist, transformItem, corners, textSize, fmtLen, uid } from './types';
import { layerMarkup, penOutline, smoothPath, SHARED_DEFS, type RenderCtx } from './markup';
import { symbolMarkup } from './library';
import { type Selection } from './raster';

export type View = { x: number; y: number; k: number; r: number };
export type Tool = 'select' | 'pen' | 'eraser' | 'text' | 'dim' | 'circle' | 'line' | 'shape' | 'curve' | 'register' | 'place' | 'random' | 'aiBrush' | 'aiErase' | 'aiFill' | 'calib';
export type ToolOpts = { brush: Brush; dash: Dash; width: number; color: string; lineKind: 'line' | 'polyline' | 'arrow'; shapeKind: 'rect' | 'ellipse'; measure: string; unit: string };

export type CanvasApi = {
  live: (f: (d: Doc) => Doc) => void; end: (label?: string) => void; set: (f: (d: Doc) => Doc, label?: string) => void;
  addItem: (it: Item, kind?: 'draw' | 'text' | 'object') => void;
  text: (p: Pt, editId?: string) => void;
  place: (p: Pt, random: boolean) => void;
  lasso: (poly: Pt[], mode: 'register') => void;
  fill: (p: Pt) => void;
  aiBrushed: () => void;
  calib: (a: Pt, b: Pt) => void;
  toast: (m: string) => void;
  selectGuide: (id: string | null) => void;
};

/** 指1本の扱い。auto = Apple Pencilを使うまでは指で描き、使った後は指で画面移動（手のひら誤描画を防ぐ） */
export type FingerMode = 'auto' | 'draw' | 'pan';

type Props = {
  doc: Doc; lib: LibItem[]; ctx: RenderCtx; view: View; setView: (v: View) => void; tool: Tool; opts: ToolOpts;
  guideSnap: boolean; fingerMode: FingerMode; penSeen: boolean; onPen: () => void; showGrid: boolean; gridMm: number; guideEdit: boolean; activeGuide: string | null;
  sel: string[]; setSel: (ids: string[]) => void; api: CanvasApi; aiSel: Selection | null; aiVersion: number; aiRadius: number;
};

const toWorld = (v: View, s: Pt): Pt => { const p = rotPt({ x: s.x - v.x, y: s.y - v.y }, { x: 0, y: 0 }, -rad(v.r)); return { x: p.x / v.k, y: p.y / v.k }; };
const toScreen = (v: View, w: Pt): Pt => { const p = rotPt({ x: w.x * v.k, y: w.y * v.k }, { x: 0, y: 0 }, rad(v.r)); return { x: p.x + v.x, y: p.y + v.y }; };
export { toWorld, toScreen };

// レイヤー単位でSVG文字列を作り直す（中身が変わったときだけ）
const LayerG = memo(function LayerG({ layer, ctx }: { layer: Layer; ctx: RenderCtx }) {
  const html = useMemo(() => layerMarkup(layer, ctx), [layer.items, ctx]);
  return <g opacity={layer.opacity} dangerouslySetInnerHTML={{ __html: html }} />;
});

const Defs = memo(function Defs({ lib }: { lib: LibItem[] }) {
  const html = useMemo(() => SHARED_DEFS + lib.map(symbolMarkup).join(''), [lib]);
  return <defs dangerouslySetInnerHTML={{ __html: html }} />;
});

function hitItem(it: Item, p: Pt, tol: number): boolean {
  switch (it.type) {
    case 'stroke': case 'line': { const w = tol + it.width; for (let i = 1; i < it.pts.length; i++) if (segDist(p, it.pts[i - 1], it.pts[i]) < w) return true; return it.pts.length === 1 && dist(p, it.pts[0]) < w; }
    case 'dim': return segDist(p, it.a, it.b) < tol + 4;
    case 'obj': case 'shape': return pointInPoly(p, corners(it.x, it.y, it.w, it.h, it.rot));
    case 'text': { const s = textSize(it); return pointInPoly(p, corners(it.x, it.y, s.w, s.h, it.rot)); }
    case 'texture': { const b = itemBox(it); return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h; }
  }
}

function applyTransform(d: Doc, ids: Set<string>, f: (p: Pt) => Pt, dRot: number, k: number): Doc {
  return { ...d, layers: d.layers.map(l => l.items.some(i => ids.has(i.id)) ? { ...l, items: l.items.map(i => ids.has(i.id) ? transformItem(i, f, dRot, k) : i) } : l) };
}

type Snap = { kind: 'line'; o: Pt; dir: Pt; label: string } | { kind: 'circle'; c: Pt; r: number; label: string };

function guideDirs(g: Guide): number[] {
  const a = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x);
  if (g.type === 'grid') return [a, a + Math.PI / 2];
  if (g.type === 'line' || g.type === 'slope' || g.type === 'ruler' || g.type === 'face') return [a];
  return [];
}
const angDiff = (a: number, b: number) => { let d = Math.abs(a - b) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d; return d; };
function lineDistance(p: Pt, g: Guide) { const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, l = Math.hypot(dx, dy) || 1; return Math.abs((p.x - g.a.x) * dy - (p.y - g.a.y) * dx) / l; }

export function Canvas(props: Props) {
  const { doc, lib, ctx, view, setView, tool, opts, sel, setSel, api } = props;
  const svgRef = useRef<SVGSVGElement>(null), liveRef = useRef<SVGPathElement>(null), selCanvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ v0: View; p1: Pt; p2: Pt; ids: [number, number] } | null>(null);
  const op = useRef<any>(null);
  const opPointer = useRef<number | null>(null), penDown = useRef(false), lastPen = useRef(-1e9), lastTap = useRef({ t: -1e9, x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<{ x: number; y: number; text: string } | null>(null);
  const [preview, setPreview] = useState<{ kind: string; pts: Pt[] } | null>(null);
  const [poly, setPoly] = useState<Pt[] | null>(null);
  const [space, setSpace] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const viewRef = useRef(view); viewRef.current = view;
  // 自動テスト・操作動画用に、図面座標→画面座標の変換を公開する
  useEffect(() => { (window as unknown as { __v3: unknown }).__v3 = { screen: (x: number, y: number) => { const r = svgRef.current!.getBoundingClientRect(), s = toScreen(viewRef.current, { x, y }); return { x: s.x + r.left, y: s.y + r.top }; } }; }, []);
  const docRef = useRef(doc); docRef.current = doc;

  // iPad Safari：touch-action だけでは Pencil・指のドラッグでページのスクロールや拡大鏡が起きることがあるため、
  // キャンバス上のタッチの既定動作を止める（Pointer Events はそのまま届く）
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    const start = (e: TouchEvent) => { stop(e); const a = document.activeElement as HTMLElement | null; if (a?.matches?.('input,textarea,select,[contenteditable]')) a.blur(); };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('selectstart', stop);
    // Safari独自のピンチ（ページ全体の拡大）を止める
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', stop); el.removeEventListener('selectstart', stop);
      document.removeEventListener('gesturestart', stop); document.removeEventListener('gesturechange', stop);
    };
  }, []);

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea')) { setSpace(true); } if (e.key === 'Escape') { setPoly(null); setPreview(null); op.current = null; } if (e.key === 'Enter' && poly && poly.length > 1) finishPolyline(); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  // 選択範囲（AIツール）の表示
  useEffect(() => {
    const s = props.aiSel, c = selCanvas.current; if (!s || !c) return;
    if (c.width !== s.W || c.height !== s.H) { c.width = s.W; c.height = s.H; }
    const g = c.getContext('2d')!, img = g.createImageData(s.W, s.H);
    for (let i = 0; i < s.bits.length; i++) if (s.bits[i]) { img.data[i * 4] = 98; img.data[i * 4 + 1] = 140; img.data[i * 4 + 2] = 120; img.data[i * 4 + 3] = 120; }
    g.putImageData(img, 0, 0);
  }, [props.aiSel, props.aiVersion]);

  const local = (e: { clientX: number; clientY: number }): Pt => { const r = svgRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const visibleWorld = (): Box => boxOf([{ x: 0, y: 0 }, { x: size.w, y: 0 }, { x: size.w, y: size.h }, { x: 0, y: size.h }].map(p => toWorld(view, p)));

  const selItems = useMemo(() => { const s = new Set(sel); const out: Item[] = []; for (const l of doc.layers) for (const i of l.items) if (s.has(i.id)) out.push(i); return out; }, [sel, doc]);
  const selBox = selItems.length ? unionBox(selItems.map(itemBox)) : null;

  function pickItem(p: Pt): Item | null {
    const tol = 6 / view.k;
    const layers = [...doc.layers].reverse().filter(l => l.visible && !l.locked);
    // オブジェクト・文字を優先、テクスチャは最後
    for (const pass of [0, 1]) for (const l of layers) {
      if ((pass === 0) === (l.kind === 'texture' || l.kind === 'fill')) continue;
      for (let i = l.items.length - 1; i >= 0; i--) { const it = l.items[i]; if (it.type === 'obj' && (it.hidden || it.locked)) continue; if (hitItem(it, p, tol)) return it; }
    }
    return null;
  }

  function computeSnap(start: Pt, cur: Pt): Snap | null {
    if (!props.guideSnap) return null;
    if (dist(start, cur) * view.k < 14) return null;
    const a = Math.atan2(cur.y - start.y, cur.x - start.x);
    let best: { d: number; s: Snap } | null = null;
    for (const g of doc.guides) {
      if (!g.visible) continue;
      for (const ga of guideDirs(g)) {
        const d = angDiff(a, ga);
        if (d < rad(7) && (!best || d < best.d)) best = { d, s: { kind: 'line', o: start, dir: { x: Math.cos(ga), y: Math.sin(ga) }, label: g.type === 'grid' ? 'グリッド' : `平行距離: ${fmtLen(lineDistance(start, g), ctx.mmPerPx, ctx.unit)}` } };
      }
      if (g.type === 'circle') {
        const r0 = dist(start, g.a); if (r0 * view.k < 10) continue;
        const tang = Math.atan2(start.y - g.a.y, start.x - g.a.x) + Math.PI / 2, d = angDiff(a, tang);
        if (d < rad(14) && (!best || d < best.d)) best = { d, s: { kind: 'circle', c: g.a, r: r0, label: `半径: ${fmtLen(r0, ctx.mmPerPx, ctx.unit)}` } };
      }
    }
    return best?.s ?? null;
  }
  const project = (s: Snap, p: Pt): Pt => {
    if (s.kind === 'line') { const t = (p.x - s.o.x) * s.dir.x + (p.y - s.o.y) * s.dir.y; return { x: s.o.x + s.dir.x * t, y: s.o.y + s.dir.y * t, p: p.p }; }
    const a = Math.atan2(p.y - s.c.y, p.x - s.c.x); return { x: s.c.x + Math.cos(a) * s.r, y: s.c.y + Math.sin(a) * s.r, p: p.p };
  };
  const showLabel = (sp: Pt, text: string) => setLabel({ x: sp.x + 14, y: sp.y - 30, text });

  // ---------- 入力 ----------
  function onDown(e: RPE<SVGSVGElement>) {
    if (e.pointerType === 'pen') {
      // ペンが触れたら、先に置かれた手のひらの操作を捨てる
      penDown.current = true; lastPen.current = e.timeStamp;
      if (!props.penSeen) props.onPen();
      if (gesture.current || op.current?.kind === 'pan' || (op.current && opPointer.current !== null && opPointer.current !== e.pointerId)) {
        if (op.current?.kind === 'pen') liveRef.current?.setAttribute('d', '');
        else if (op.current && op.current.kind !== 'pan') api.end();
        op.current = null; gesture.current = null; setPreview(null); setLabel(null);
      }
      pointers.current.clear();
    } else if (e.pointerType === 'touch' && (penDown.current || e.timeStamp - lastPen.current < 400)) return; // ペン使用中の手のひら
    const s = local(e); pointers.current.set(e.pointerId, s);
    svgRef.current!.setPointerCapture(e.pointerId);
    opPointer.current = e.pointerId;
    const fingerDraw = props.fingerMode === 'draw' || (props.fingerMode === 'auto' && !props.penSeen);
    const touches = [...pointers.current.entries()];
    if (e.pointerType === 'touch' && touches.length === 2) {
      // 2本指：描画を取り消して画面操作へ
      if (op.current?.kind === 'pen') { op.current = null; if (liveRef.current) liveRef.current.setAttribute('d', ''); }
      else if (op.current) { api.end(); op.current = null; }
      gesture.current = { v0: viewRef.current, p1: touches[0][1], p2: touches[1][1], ids: [touches[0][0], touches[1][0]] }; setLabel(null); return;
    }
    if (e.button === 1 || e.button === 2 || space || (e.pointerType === 'touch' && !fingerDraw && tool !== 'select')) { op.current = { kind: 'pan', s, v0: viewRef.current }; return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const w = toWorld(view, s), pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    const start: Pt = { ...w, p: pr };

    // ガイドの端点・本体ハンドル
    if (props.guideEdit || props.activeGuide) {
      const tol = 12 / view.k;
      for (const g of [...doc.guides].reverse()) {
        if (!g.visible || g.locked) continue;
        if (props.activeGuide && g.id !== props.activeGuide && !props.guideEdit) continue;
        const mid = g.type === 'circle' ? g.a : { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
        const which = dist(w, g.a) < tol ? 'a' : dist(w, g.b) < tol ? 'b' : g.c && dist(w, g.c) < tol ? 'c' : dist(w, mid) < tol ? 'move' : null;
        if (which) { api.selectGuide(g.id); op.current = { kind: 'guide', id: g.id, which, w0: w, g0: g }; return; }
      }
    }

    switch (tool) {
      case 'pen': op.current = { kind: 'pen', pts: [start], snap: null as Snap | null, t: e.timeStamp, last: start }; break;
      case 'eraser': op.current = { kind: 'erase' }; eraseAt(w); break;
      case 'aiBrush': case 'aiErase': op.current = { kind: 'ai', pts: [w] }; props.aiSel?.brush([w], props.aiRadius, tool === 'aiErase'); api.aiBrushed(); break;
      case 'dim': case 'circle': case 'shape': op.current = { kind: tool, a: w, b: w }; break;
      case 'curve': op.current = { kind: 'curve', a: w, b: w }; break;
      case 'line':
        if (opts.lineKind === 'polyline') {
          // iPadでは dblclick が来ないため、ダブルタップを自前で判定する
          const lt = lastTap.current, dbl = e.detail >= 2 || (e.pointerType !== 'mouse' && e.timeStamp - lt.t < 350 && dist(lt, s) < 24);
          lastTap.current = { t: e.timeStamp, x: s.x, y: s.y };
          const p0 = poly ? [...poly] : [w]; if (poly) p0.push(snapAngle(poly[poly.length - 1], w, e.shiftKey)); setPoly(p0); if (dbl && p0.length > 2) { finishPolyline(p0.slice(0, -1)); lastTap.current.t = -1e9; }
        }
        else op.current = { kind: 'line', a: w, b: w, snap: null as Snap | null };
        break;
      case 'register': op.current = { kind: 'lassoReg', pts: [w] }; break;
      case 'select': {
        const hit = pickItem(w);
        const inBox = selBox && w.x >= selBox.x && w.x <= selBox.x + selBox.w && w.y >= selBox.y && w.y <= selBox.y + selBox.h;
        const h = selBox && handleAt(s);
        if (h) { op.current = { kind: h === 'rot' ? 'rotate' : 'scale', handle: h, d0: docRef.current, ids: new Set(sel), box: selBox, w0: w }; return; }
        if (hit && !sel.includes(hit.id)) { const ids = e.shiftKey ? [...sel, hit.id] : [hit.id]; setSel(ids); op.current = { kind: 'move', d0: docRef.current, ids: new Set(ids), w0: w }; return; }
        if ((hit && sel.includes(hit.id)) || inBox) { op.current = { kind: 'move', d0: docRef.current, ids: new Set(sel), w0: w }; return; }
        if (doc.underlay && doc.underlay.visible && !doc.underlay.locked && w.x >= doc.underlay.x && w.y >= doc.underlay.y && w.x <= doc.underlay.x + doc.underlay.w && w.y <= doc.underlay.y + doc.underlay.h) { op.current = { kind: 'underlay', w0: w, u0: doc.underlay }; return; }
        op.current = { kind: 'lasso', pts: [w] }; setSel([]);
        break;
      }
      default: op.current = { kind: 'tap', w, s, t: e.timeStamp };
    }
  }

  function snapAngle(a: Pt, b: Pt, force: boolean): Pt {
    if (!force) return b;
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / rad(15)) * rad(15), l = dist(a, b);
    return { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l };
  }

  function handleAt(s: Pt): string | null {
    if (!selBox) return null;
    const cs = [{ x: selBox.x, y: selBox.y }, { x: selBox.x + selBox.w, y: selBox.y }, { x: selBox.x + selBox.w, y: selBox.y + selBox.h }, { x: selBox.x, y: selBox.y + selBox.h }].map(p => toScreen(view, p));
    const names = ['nw', 'ne', 'se', 'sw'];
    for (let i = 0; i < 4; i++) if (dist(cs[i], s) < 14) return names[i];
    const rp = rotHandle(selBox); if (dist(toScreen(view, rp), s) < 16) return 'rot';
    return null;
  }
  const rotHandle = (b: Box): Pt => { const c = { x: b.x + b.w, y: b.y + b.h / 2 }; const off = 34 / view.k; return { x: c.x + off, y: c.y }; };

  function eraseAt(w: Pt) {
    const r = Math.max(8 / view.k, opts.width * 2);
    const hitIds = new Set<string>();
    for (const l of docRef.current.layers) if (l.visible && !l.locked && (l.kind === 'draw' || l.kind === 'text')) for (const it of l.items) if (it.type !== 'texture' && hitItem(it, w, r)) hitIds.add(it.id);
    if (hitIds.size) api.live(d => ({ ...d, layers: d.layers.map(l => l.items.some(i => hitIds.has(i.id)) ? { ...l, items: l.items.filter(i => !hitIds.has(i.id)) } : l) }));
  }

  function onMove(e: RPE<SVGSVGElement>) {
    const s = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    if (e.pointerType === 'pen') lastPen.current = e.timeStamp;
    const g = gesture.current;
    if (g) {
      const a = pointers.current.get(g.ids[0]), b = pointers.current.get(g.ids[1]); if (!a || !b) return;
      const m0 = { x: (g.p1.x + g.p2.x) / 2, y: (g.p1.y + g.p2.y) / 2 }, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.min(40, Math.max(0.05, g.v0.k * dist(a, b) / Math.max(1, dist(g.p1, g.p2))));
      let r = g.v0.r + deg(Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(g.p2.y - g.p1.y, g.p2.x - g.p1.x));
      const snapR = Math.round(r / 90) * 90; if (Math.abs(r - snapR) < 4) r = snapR;
      const w0 = toWorld(g.v0, m0), q = rotPt({ x: w0.x * k, y: w0.y * k }, { x: 0, y: 0 }, rad(r));
      setView({ x: m.x - q.x, y: m.y - q.y, k, r }); return;
    }
    const o = op.current;
    if (o && opPointer.current !== null && opPointer.current !== e.pointerId) return; // 別の指・手のひらの動き
    if (!o) {
      if (e.pointerType === 'touch' && !pointers.current.has(e.pointerId)) return;
      if (tool === 'line' && poly) setPreview({ kind: 'poly', pts: [...poly, snapAngle(poly[poly.length - 1], toWorld(view, s), e.shiftKey)] });
      return;
    }
    const w = toWorld(view, s);
    switch (o.kind) {
      case 'pan': setView({ ...o.v0, x: o.v0.x + s.x - o.s.x, y: o.v0.y + s.y - o.s.y }); break;
      case 'pen': {
        const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent];
        for (const ev of evs) {
          const sp = local(ev), wp = toWorld(view, sp), dt = Math.max(1, ev.timeStamp - o.t), speed = dist(wp, o.last) * view.k / dt;
          const pr = e.pointerType === 'pen' ? (ev.pressure || 0.5) : Math.max(0.25, Math.min(0.8, 0.75 - speed * 0.12));
          if (dist(wp, o.last) * view.k < 1.2) continue;
          o.pts.push({ ...wp, p: pr }); o.last = wp; o.t = ev.timeStamp;
        }
        if (!o.snap && o.pts.length > 3) o.snap = computeSnap(o.pts[0], o.last);
        const pts: Pt[] = o.snap ? o.pts.map((p: Pt) => project(o.snap, p)) : o.pts;
        liveRef.current?.setAttribute('d', liveD(pts));
        const end = pts[pts.length - 1];
        if (o.snap) showLabel(s, o.snap.label); else if (opts.measure !== 'off' && o.pts.length > 2) showLabel(s, `直線: ${fmtLen(dist(o.pts[0], end), ctx.mmPerPx, ctx.unit)}`); else setLabel(null);
        break;
      }
      case 'erase': eraseAt(w); break;
      case 'ai': o.pts.push(w); props.aiSel?.brush(o.pts.slice(-2), props.aiRadius, tool === 'aiErase'); api.aiBrushed(); break;
      case 'line': {
        let b = snapAngle(o.a, w, e.shiftKey); if (!o.snap) o.snap = computeSnap(o.a, b); if (o.snap) b = project(o.snap, b);
        o.b = b; setPreview({ kind: 'line', pts: [o.a, b] }); showLabel(s, o.snap ? o.snap.label + ` / 長さ ${fmtLen(dist(o.a, b), ctx.mmPerPx, ctx.unit)}` : `直線: ${fmtLen(dist(o.a, b), ctx.mmPerPx, ctx.unit)}`); break;
      }
      case 'dim': o.b = snapAngle(o.a, w, e.shiftKey); setPreview({ kind: 'dim', pts: [o.a, o.b] }); showLabel(s, `寸法: ${fmtLen(dist(o.a, o.b), ctx.mmPerPx, ctx.unit)}`); break;
      case 'circle': o.b = w; setPreview({ kind: 'circle', pts: [o.a, w] }); showLabel(s, `半径: ${fmtLen(dist(o.a, w), ctx.mmPerPx, ctx.unit)}`); break;
      case 'curve': o.b = w; setPreview({ kind: 'curve', pts: [o.a, w] }); break;
      case 'shape': o.b = e.shiftKey ? { x: o.a.x + Math.sign(w.x - o.a.x) * Math.abs(w.y - o.a.y), y: w.y } : w; setPreview({ kind: opts.shapeKind, pts: [o.a, o.b] }); showLabel(s, `${fmtLen(Math.abs(o.b.x - o.a.x), ctx.mmPerPx, ctx.unit)} × ${fmtLen(Math.abs(o.b.y - o.a.y), ctx.mmPerPx, ctx.unit)}`); break;
      case 'lasso': case 'lassoReg': o.pts.push(w); setPoly([...o.pts]); break;
      case 'move': { const dx = w.x - o.w0.x, dy = w.y - o.w0.y; api.live(() => applyTransform(o.d0, o.ids, p => ({ x: p.x + dx, y: p.y + dy }), 0, 1)); showLabel(s, `移動 ${fmtLen(Math.hypot(dx, dy), ctx.mmPerPx, ctx.unit)}`); break; }
      case 'scale': {
        const b: Box = o.box, anchor = { nw: { x: b.x + b.w, y: b.y + b.h }, ne: { x: b.x, y: b.y + b.h }, se: { x: b.x, y: b.y }, sw: { x: b.x + b.w, y: b.y } }[o.handle as 'nw'] as Pt;
        const k = Math.max(0.05, dist(anchor, w) / Math.max(1e-6, dist(anchor, o.w0)));
        api.live(() => applyTransform(o.d0, o.ids, p => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k }), 0, k)); showLabel(s, `${Math.round(k * 100)}%`); break;
      }
      case 'rotate': {
        const b: Box = o.box, c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        let a = deg(Math.atan2(w.y - c.y, w.x - c.x) - Math.atan2(o.w0.y - c.y, o.w0.x - c.x));
        const sn = Math.round(a / 15) * 15; if (Math.abs(a - sn) < 2.5) a = sn;
        api.live(() => applyTransform(o.d0, o.ids, p => rotPt(p, c, rad(a)), a, 1)); o.angle = a; showLabel(s, `${Math.round(a)}°回転`); break;
      }
      case 'guide': {
        const dx = w.x - o.w0.x, dy = w.y - o.w0.y, g0: Guide = o.g0;
        const mv = (p?: Pt) => p && ({ x: p.x + dx, y: p.y + dy });
        const ng: Guide = o.which === 'move' ? { ...g0, a: mv(g0.a)!, b: mv(g0.b)!, c: mv(g0.c) } : { ...g0, [o.which]: w };
        api.live(d => ({ ...d, guides: d.guides.map(x => x.id === g0.id ? ng : x) }));
        const len = dist(ng.a, ng.b); showLabel(s, ng.type === 'circle' ? `半径: ${fmtLen(len, ctx.mmPerPx, ctx.unit)}` : `${fmtLen(len, ctx.mmPerPx, ctx.unit)} / ${Math.round(((deg(Math.atan2(ng.b.y - ng.a.y, ng.b.x - ng.a.x)) % 360) + 360) % 360)}°`); break;
      }
      case 'underlay': { const u = o.u0; api.live(d => ({ ...d, underlay: { ...u, x: u.x + w.x - o.w0.x, y: u.y + w.y - o.w0.y } })); break; }
    }
  }

  function liveD(pts: Pt[]) {
    if (opts.brush === 'pen' && opts.dash === 'solid') return penOutline(pts, opts.width);
    return smoothPath(pts);
  }

  function onUp(e: RPE<SVGSVGElement>) {
    if (e.pointerType === 'pen') { penDown.current = false; lastPen.current = e.timeStamp; }
    const known = pointers.current.delete(e.pointerId);
    if (!known && e.pointerType !== 'mouse') return; // 無視した手のひら
    if (gesture.current) { if (pointers.current.size < 2) gesture.current = null; op.current = null; opPointer.current = null; return; }
    if (op.current && opPointer.current !== null && opPointer.current !== e.pointerId) return;
    const o = op.current; op.current = null; opPointer.current = null; setLabel(null);
    if (!o) return;
    const w = toWorld(view, local(e));
    switch (o.kind) {
      case 'pen': {
        liveRef.current?.setAttribute('d', '');
        let pts: Pt[] = o.pts;
        if (o.snap) {
          const a = project(o.snap, pts[0]), b = project(o.snap, pts[pts.length - 1]);
          if (o.snap.kind === 'line') { pts = Array.from({ length: 9 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, p: 0.6 })); }
          else { const s0 = o.snap as Extract<Snap, { kind: 'circle' }>; let a0 = Math.atan2(a.y - s0.c.y, a.x - s0.c.x), sweep = 0; let prev = a0; for (const p of o.pts) { const an = Math.atan2(p.y - s0.c.y, p.x - s0.c.x); let d = an - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; sweep += d; prev = an; } const n = Math.max(6, Math.ceil(Math.abs(sweep) * 12)); pts = Array.from({ length: n + 1 }, (_, i) => { const an = a0 + sweep * i / n; return { x: s0.c.x + Math.cos(an) * s0.r, y: s0.c.y + Math.sin(an) * s0.r, p: 0.6 }; }); }
        }
        if (pts.length === 1) pts = [pts[0], { ...pts[0], x: pts[0].x + 0.3 / view.k }];
        api.addItem({ id: uid(), type: 'stroke', brush: opts.brush, color: opts.color, width: opts.width, dash: opts.dash, pts: simplify(pts, 0.35 / view.k) });
        break;
      }
      case 'erase': api.end('消しゴム'); break;
      case 'ai': break;
      case 'line': if (dist(o.a, o.b) * view.k > 3) api.addItem({ id: uid(), type: 'line', kind: opts.lineKind === 'arrow' ? 'arrow' : 'line', color: opts.color, width: opts.width, dash: opts.dash, pts: [o.a, o.b] }); setPreview(null); break;
      case 'dim': if (dist(o.a, o.b) * view.k > 4) api.addItem({ id: uid(), type: 'dim', color: opts.color, width: opts.width, a: o.a, b: o.b, size: Math.round(15 / view.k) }); setPreview(null); break;
      case 'circle': { const r = dist(o.a, o.b); if (r * view.k > 3) api.addItem({ id: uid(), type: 'shape', shape: 'circle', color: opts.color, width: opts.width, dash: opts.dash, x: o.a.x - r, y: o.a.y - r, w: r * 2, h: r * 2, rot: 0 }); setPreview(null); break; }
      case 'curve': { if (dist(o.a, o.b) * view.k > 4) { const m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 }, nrm = { x: -(o.b.y - o.a.y) * 0.25, y: (o.b.x - o.a.x) * 0.25 }; const c = { x: m.x + nrm.x, y: m.y + nrm.y }; const pts = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return { x: (1 - t) ** 2 * o.a.x + 2 * (1 - t) * t * c.x + t * t * o.b.x, y: (1 - t) ** 2 * o.a.y + 2 * (1 - t) * t * c.y + t * t * o.b.y, p: 0.6 }; }); api.addItem({ id: uid(), type: 'stroke', brush: opts.brush, color: opts.color, width: opts.width, dash: opts.dash, pts }); } setPreview(null); break; }
      case 'shape': { const b = boxOf([o.a, o.b]); if (b.w * view.k > 3 && b.h * view.k > 3) api.addItem({ id: uid(), type: 'shape', shape: opts.shapeKind, color: opts.color, width: opts.width, dash: opts.dash, ...b, rot: 0 }); setPreview(null); break; }
      case 'lasso': {
        setPoly(null);
        const pts: Pt[] = o.pts; if (pts.length < 3 || boxOf(pts).w * view.k < 4) { const hit = pickItem(w); setSel(hit ? [hit.id] : []); break; }
        const ids: string[] = [];
        for (const l of doc.layers) if (l.visible && !l.locked && l.kind !== 'fill') for (const it of l.items) { if (it.type === 'obj' && (it.hidden || it.locked)) continue; const b = itemBox(it); if (pointInPoly({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, pts)) ids.push(it.id); }
        setSel(ids); if (ids.length) api.toast(`${ids.length}件を選択`); break;
      }
      case 'lassoReg': setPoly(null); if (o.pts.length > 3) api.lasso(o.pts, 'register'); break;
      case 'move': api.end('移動'); break;
      case 'scale': api.end('拡大縮小'); break;
      case 'rotate': api.end('回転'); break;
      case 'guide': api.end('ガイド線を調整'); break;
      case 'underlay': api.end('下絵を移動'); break;
      case 'tap': {
        if (dist(o.s, local(e)) > 8) break;
        if (tool === 'text') { const hit = pickItem(o.w); api.text(o.w, hit?.type === 'text' ? hit.id : undefined); }
        else if (tool === 'place' || tool === 'random') api.place(o.w, tool === 'random');
        else if (tool === 'aiFill') api.fill(o.w);
        else if (tool === 'calib') { const pts = [...(poly || []), o.w]; if (pts.length === 2) { setPoly(null); api.calib(pts[0], pts[1]); } else setPoly(pts); }
        break;
      }
    }
  }

  function finishPolyline(p = poly) {
    if (p && p.length > 1) api.addItem({ id: uid(), type: 'line', kind: 'polyline', color: opts.color, width: opts.width, dash: opts.dash, pts: p });
    setPoly(null); setPreview(null);
  }

  function onWheel(e: React.WheelEvent) {
    const s = local(e);
    if (e.shiftKey) { setView({ ...view, x: view.x - e.deltaY, y: view.y - e.deltaX }); return; }
    const k = Math.min(40, Math.max(0.05, view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    const w = toWorld(view, s), q = rotPt({ x: w.x * k, y: w.y * k }, { x: 0, y: 0 }, rad(view.r));
    setView({ ...view, k, x: s.x - q.x, y: s.y - q.y });
  }

  // ---------- 描画 ----------
  const vw = visibleWorld(), px = 1 / view.k;
  const tf = `translate(${view.x} ${view.y}) rotate(${view.r}) scale(${view.k})`;
  const gridStep = props.gridMm / ctx.mmPerPx;
  const objLayer = doc.layers.find(l => l.kind === 'object');
  const cursor = space || op.current?.kind === 'pan' ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair';
  const s = props.aiSel;

  return (
    <div ref={wrapRef} className="v3-canvas" onContextMenu={e => e.preventDefault()}>
      <svg ref={svgRef} className="v3-svg" style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onDoubleClick={() => { if (tool === 'line' && opts.lineKind === 'polyline' && poly) finishPolyline(poly.length > 2 ? poly.slice(0, -1) : poly); }}>
        <Defs lib={lib} />
        <g transform={tf}>
          {props.showGrid && gridStep * view.k > 4 && <GridLines box={vw} step={gridStep} px={px} />}
          {doc.underlay?.visible && <image href={doc.underlay.src} x={doc.underlay.x} y={doc.underlay.y} width={doc.underlay.w} height={doc.underlay.h} opacity={doc.underlay.opacity} preserveAspectRatio="none" />}
          {doc.layers.filter(l => l.visible && l.kind !== 'object' && l.kind !== 'text').map(l => <LayerG key={l.id} layer={l} ctx={ctx} />)}
          {objLayer?.visible && <LayerG layer={objLayer} ctx={ctx} />}
          {doc.layers.filter(l => l.visible && l.kind === 'text').map(l => <LayerG key={l.id} layer={l} ctx={ctx} />)}
          {doc.guides.filter(g => g.visible).map(g => <GuideView key={g.id} g={g} box={vw} px={px} ctx={ctx} active={g.id === props.activeGuide} edit={props.guideEdit} />)}
          <path ref={liveRef} className={'live ' + opts.brush} fill={opts.brush === 'pen' && opts.dash === 'solid' ? opts.color : 'none'} stroke={opts.brush === 'pen' && opts.dash === 'solid' ? 'none' : opts.color} strokeWidth={opts.brush === 'marker' ? opts.width * 2.6 : opts.brush === 'matte' ? opts.width * 3.2 : opts.width * 0.8} strokeLinecap="round" strokeLinejoin="round" opacity={opts.brush === 'marker' ? 0.5 : 1} strokeDasharray={opts.dash === 'dashed' ? `${opts.width * 4} ${opts.width * 3}` : opts.dash === 'dotted' ? `0.1 ${opts.width * 2.2}` : undefined} />
          {preview && <Preview p={preview} opts={opts} px={px} />}
          {poly && <path d={'M' + poly.map(p => `${p.x} ${p.y}`).join('L') + (tool === 'select' || tool === 'register' ? 'Z' : '')} className={tool === 'select' || tool === 'register' ? 'lasso' : 'polyline-preview'} strokeWidth={px * 1.5} />}
          {tool === 'calib' && poly?.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={6 * px} className="calib-pt" />)}
          {selBox && tool === 'select' && <SelectionBox box={selBox} px={px} />}
        </g>
      </svg>
      {s && <canvas ref={selCanvas} className="v3-selmask" style={{ transform: `translate(${view.x}px,${view.y}px) rotate(${view.r}deg) scale(${view.k}) translate(${s.box.x}px,${s.box.y}px) scale(${1 / s.k})` }} />}
      {label && <div className="v3-label" style={{ left: label.x, top: label.y }}>{label.text}</div>}
      {selBox && tool === 'select' && op.current?.kind !== 'move' && <div className="v3-rotlabel" style={{ left: toScreen(view, rotHandle(selBox)).x - 10, top: toScreen(view, rotHandle(selBox)).y - 34 }}>0°回転</div>}
    </div>
  );
}

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (dist(pts[i], out[out.length - 1]) > tol) out.push(pts[i]);
  out.push(pts[pts.length - 1]); return out;
}

function GridLines({ box, step, px }: { box: Box; step: number; px: number }) {
  let d = '';
  const x0 = Math.floor(box.x / step) * step, y0 = Math.floor(box.y / step) * step;
  for (let x = x0; x < box.x + box.w; x += step) d += `M${x} ${box.y}L${x} ${box.y + box.h}`;
  for (let y = y0; y < box.y + box.h; y += step) d += `M${box.x} ${y}L${box.x + box.w} ${y}`;
  return <path d={d} stroke="#dfe3e1" strokeWidth={px} fill="none" />;
}

function Preview({ p, opts, px }: { p: { kind: string; pts: Pt[] }; opts: ToolOpts; px: number }) {
  const [a, b] = p.pts, common = { stroke: opts.color, strokeWidth: Math.max(px, opts.width * 0.8), fill: 'none', strokeDasharray: opts.dash === 'dashed' ? `${opts.width * 4} ${opts.width * 3}` : undefined };
  if (p.kind === 'line' || p.kind === 'dim') return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />;
  if (p.kind === 'poly') return <path d={'M' + p.pts.map(q => `${q.x} ${q.y}`).join('L')} {...common} />;
  if (p.kind === 'circle') return <circle cx={a.x} cy={a.y} r={dist(a, b)} {...common} />;
  if (p.kind === 'curve') { const m = { x: (a.x + b.x) / 2 - (b.y - a.y) * 0.25, y: (a.y + b.y) / 2 + (b.x - a.x) * 0.25 }; return <path d={`M${a.x} ${a.y}Q${m.x} ${m.y} ${b.x} ${b.y}`} {...common} />; }
  const bx = boxOf([a, b]);
  if (p.kind === 'ellipse') return <ellipse cx={bx.x + bx.w / 2} cy={bx.y + bx.h / 2} rx={bx.w / 2} ry={bx.h / 2} {...common} />;
  return <rect {...bx} width={bx.w} height={bx.h} {...common} />;
}

function SelectionBox({ box, px }: { box: Box; px: number }) {
  const r = 6 * px, rp = { x: box.x + box.w + 34 * px, y: box.y + box.h / 2 };
  return (
    <g className="selbox">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={px * 1.2} strokeDasharray={`${4 * px} ${3 * px}`} />
      <line x1={box.x + box.w} y1={rp.y} x2={rp.x} y2={rp.y} strokeWidth={px} className="stalk" />
      {[[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={r} strokeWidth={px * 1.2} className="h" />)}
      <circle cx={rp.x} cy={rp.y} r={r * 1.3} className="rot" />
    </g>
  );
}

function GuideView({ g, box, px, ctx, active, edit }: { g: Guide; box: Box; px: number; ctx: RenderCtx; active: boolean; edit: boolean }) {
  const L = Math.hypot(box.w, box.h) * 2;
  const ang = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x), dx = Math.cos(ang), dy = Math.sin(ang);
  const cls = 'guide' + (active ? ' active' : '');
  const sw = px * (active ? 1.4 : 1), dash = `${7 * px} ${5 * px}`;
  const handles = (edit || active) && !g.locked;
  const H = (p: Pt | undefined, key: string) => p && <circle key={key} cx={p.x} cy={p.y} r={6 * px} className="ghandle" strokeWidth={px * 1.2} />;
  const txt = (p: Pt, t: string, size = 12) => <text x={p.x} y={p.y} fontSize={size * px} className="gtext">{t}</text>;
  const mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
  const len = dist(g.a, g.b);
  let body: React.ReactNode = null;
  if (g.type === 'line' || g.type === 'slope' || g.type === 'face') {
    body = <line x1={g.a.x - dx * L} y1={g.a.y - dy * L} x2={g.a.x + dx * L} y2={g.a.y + dy * L} strokeWidth={sw} strokeDasharray={dash} className={cls} />;
    if (g.type !== 'line') {
      const pct = len ? (g.hB - g.hA) * 100 / (len * ctx.mmPerPx) : 0;
      body = <>{body}<line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} strokeWidth={sw * 2.2} className={cls + ' solidpart'} />
        {txt({ x: g.a.x + 8 * px, y: g.a.y - 6 * px }, `A+${g.hA}`)}{txt({ x: g.b.x + 8 * px, y: g.b.y - 6 * px }, `B+${g.hB}`)}
        {txt({ x: mid.x + 8 * px, y: mid.y + 16 * px }, `${Math.abs(pct).toFixed(1)}%`)}
        {g.type === 'face' && <path d={`M${mid.x - dy * 20 * px} ${mid.y + dx * 20 * px}l${dx * 26 * px} ${dy * 26 * px}`} strokeWidth={sw * 1.6} className={cls} markerEnd="" />}</>;
    }
  } else if (g.type === 'ruler') {
    const step = 1000 / ctx.mmPerPx, n = Math.floor(len / step);
    let d = `M${g.a.x} ${g.a.y}L${g.b.x} ${g.b.y}`;
    for (let i = 0; i <= n; i++) { const p = { x: g.a.x + dx * step * i, y: g.a.y + dy * step * i }; d += `M${p.x} ${p.y}l${-dy * 8 * px} ${dx * 8 * px}`; }
    body = <><path d={d} strokeWidth={sw} className={cls + ' solidpart'} />{Array.from({ length: n + 1 }, (_, i) => <text key={i} x={g.a.x + dx * step * i - dy * 20 * px} y={g.a.y + dy * step * i + dx * 20 * px} fontSize={10 * px} className="gtext">{i}m</text>)}</>;
  } else if (g.type === 'circle') {
    body = <circle cx={g.a.x} cy={g.a.y} r={len} strokeWidth={sw} strokeDasharray={dash} className={cls} fill="none" />;
  } else if (g.type === 'curve') {
    const c = g.c || mid; body = <path d={`M${g.a.x} ${g.a.y}Q${2 * c.x - mid.x} ${2 * c.y - mid.y} ${g.b.x} ${g.b.y}`} strokeWidth={sw} strokeDasharray={dash} className={cls} fill="none" />;
  } else if (g.type === 'golden') {
    const bx = boxOf([g.a, g.b]), phi = 0.618; const x1 = bx.x + bx.w * phi, y1 = bx.y + bx.h * phi;
    body = <path d={`M${bx.x} ${bx.y}h${bx.w}v${bx.h}h${-bx.w}ZM${x1} ${bx.y}V${bx.y + bx.h}M${x1} ${y1}H${bx.x + bx.w}M${bx.x + bx.w * (1 - phi) * phi + bx.w * phi * 0} ${bx.y}`} strokeWidth={sw} strokeDasharray={dash} className={cls} fill="none" />;
  } else if (g.type === 'grid') {
    const step = (g.spacing || 1000) / ctx.mmPerPx; let d = '';
    const n = Math.min(80, Math.ceil(L / step / 4));
    for (let i = -n; i <= n; i++) { const o = { x: g.a.x - dy * step * i, y: g.a.y + dx * step * i }; d += `M${o.x - dx * L / 4} ${o.y - dy * L / 4}L${o.x + dx * L / 4} ${o.y + dy * L / 4}`; const o2 = { x: g.a.x + dx * step * i, y: g.a.y + dy * step * i }; d += `M${o2.x + dy * L / 4} ${o2.y - dx * L / 4}L${o2.x - dy * L / 4} ${o2.y + dx * L / 4}`; }
    body = <path d={d} strokeWidth={px * 0.8} className={cls + ' gridg'} />;
  }
  return <g>{body}{handles && <>{H(g.a, 'a')}{g.type !== 'grid' && H(g.b, 'b')}{g.type === 'curve' && H(g.c || mid, 'c')}{g.type !== 'circle' && <rect x={mid.x - 5 * px} y={mid.y - 5 * px} width={10 * px} height={10 * px} className="ghandle mid" strokeWidth={px} />}</>}</g>;
}

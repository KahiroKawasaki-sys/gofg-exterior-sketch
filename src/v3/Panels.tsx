// 右側パネル（オブジェクト・レイヤー・ガイド線・AIツール・設定・履歴・テキスト）
import { useRef, useState, type ReactNode } from 'react';
import { Plus, Copy, ArrowDownToLine, Combine, Trash2, Eye, EyeOff, Lock, LockOpen, GripVertical, X, CircleMinus, Pencil } from 'lucide-react';
import { type Doc, type Layer, type LibItem, type Guide, type GuideType, type ObjItem, type TextureItem, type TextItem, type Pt, dist, deg, rad, fmtLen, PALETTE } from './types';
import { CATEGORIES } from './library';
import { TEXTURES, textureSrc } from './textures';
import { type Selection } from './raster';
import { type HistEntry } from './useDoc';
import { type Tool } from './Canvas';

export type Job = { id: string; name: string; thumb: string; tex: string; texName: string; sel: number; layer: string; time: string };
export type GenKind = 'texture' | 'aiTexture' | 'aiPen' | 'aiObject' | 'color';

export type EditorApi = {
  doc: Doc; set: (f: (d: Doc) => Doc, label?: string) => void; live: (f: (d: Doc) => Doc) => void; end: (label?: string) => void;
  tool: Tool; setTool: (t: Tool) => void; toast: (m: string) => void; close: () => void;
  // objects
  lib: LibItem[]; libSel: string | null; setLibSel: (id: string | null) => void; cat: string; setCat: (c: string) => void;
  sel: string[]; setSel: (ids: string[]) => void; removeLib: (id: string) => void; updateLib: (l: LibItem) => void; registerItem: (id: string) => void;
  // guides
  activeGuide: string | null; setActiveGuide: (id: string | null) => void; addGuide: (t: GuideType) => void; unit: string;
  // ai
  aiSel: Selection | null; aiCount: number; clearAi: () => void; genKind: GenKind; setGenKind: (g: GenKind) => void; jobs: Job[]; applyJob: (j: Job) => void;
  pickImage: (anchor: DOMRect) => void; activeTex: string | null; setActiveTex: (id: string | null) => void; recallSelection: (t: TextureItem) => void; saveTexture: (t: TextureItem) => void; aiKeyword: (k: string) => void;
  openPanel: (p: string) => void;
  // history
  history: HistEntry[]; restore: (i: number) => void;
  editText: (id: string) => void;
};

const Head = ({ title, children, onClose }: { title: string; children?: ReactNode; onClose: () => void }) => (
  <div className="v3-phead"><b>{title}</b><span className="sp" />{children}<button className="v3-ib" aria-label="閉じる" onClick={onClose}><X size={16} /></button></div>
);
const Card = ({ title, children }: { title?: string; children: ReactNode }) => <section className="v3-card">{title && <h4>{title}</h4>}{children}</section>;

// ---------------- レイヤー ----------------
export function LayerPanel({ e }: { e: EditorApi }) {
  const { doc, set } = e;
  const list = [...doc.layers].reverse().filter(l => l.kind !== 'object');
  const active = doc.layers.find(l => l.id === doc.activeLayer);
  const [rename, setRename] = useState<string | null>(null);
  const drag = useRef<{ id: string; y0: number; over: string | null } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const upd = (id: string, f: (l: Layer) => Layer, label: string) => set(d => ({ ...d, layers: d.layers.map(l => l.id === id ? f(l) : l) }), label);
  const add = () => set(d => {
    const n = Math.max(0, ...d.layers.map(l => Number(/^レイヤー (\d+)$/.exec(l.name)?.[1] || 0))) + 1;
    const nl: Layer = { id: crypto.randomUUID(), name: `レイヤー ${n}`, kind: 'draw', visible: true, locked: false, opacity: 1, items: [] };
    const i = d.layers.findIndex(l => l.id === d.activeLayer), at = i >= 0 && d.layers[i].kind !== 'text' && d.layers[i].kind !== 'object' ? i + 1 : d.layers.findIndex(l => l.kind === 'object');
    const layers = [...d.layers]; layers.splice(at < 0 ? layers.length : at, 0, nl); return { ...d, layers, activeLayer: nl.id };
  }, 'レイヤーを追加');
  const dup = () => active && set(d => { const i = d.layers.findIndex(l => l.id === active.id), nl = { ...active, id: crypto.randomUUID(), name: active.name + ' のコピー', kind: active.kind === 'text' ? 'draw' as const : active.kind, items: active.items.map(it => ({ ...it, id: crypto.randomUUID() })) }; const layers = [...d.layers]; layers.splice(i + 1, 0, nl); return { ...d, layers, activeLayer: nl.id }; }, 'レイヤーを複製');
  const mergeDown = () => {
    if (!active) return; const i = doc.layers.findIndex(l => l.id === active.id), below = doc.layers[i - 1];
    if (!below || below.kind === 'object') return e.toast('下に結合できるレイヤーがありません');
    set(d => ({ ...d, layers: d.layers.filter(l => l.id !== active.id).map(l => l.id === below.id ? { ...l, items: [...l.items, ...active.items] } : l), activeLayer: below.id }), '下のレイヤーと結合');
  };
  const mergeVisible = () => {
    const vis = doc.layers.filter(l => l.visible && l.kind === 'draw'); if (vis.length < 2) return e.toast('結合できる表示中のレイヤーがありません');
    const keep = vis[0]; set(d => ({ ...d, layers: d.layers.filter(l => !vis.slice(1).some(v => v.id === l.id)).map(l => l.id === keep.id ? { ...l, items: vis.flatMap(v => v.items) } : l), activeLayer: keep.id }), '表示レイヤーを結合');
  };
  const del = () => {
    if (!active) return; if (active.kind === 'text' || active.kind === 'fill') return e.toast('このレイヤーは削除できません');
    if (doc.layers.filter(l => l.kind === 'draw').length <= 1 && active.kind === 'draw') return e.toast('描画レイヤーは1つ以上必要です');
    set(d => { const rest = d.layers.filter(l => l.id !== active.id); return { ...d, layers: rest, activeLayer: rest.find(l => l.kind === 'draw')?.id || rest[0].id }; }, 'レイヤーを削除');
  };
  const onGrip = (ev: React.PointerEvent, id: string) => { (ev.target as HTMLElement).setPointerCapture(ev.pointerId); drag.current = { id, y0: ev.clientY, over: null }; };
  const onGripMove = (ev: React.PointerEvent) => {
    if (!drag.current) return; const el = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => (x as HTMLElement).dataset?.layer) as HTMLElement | undefined;
    drag.current.over = el?.dataset.layer || null; setOver(drag.current.over);
  };
  const onGripUp = () => {
    const dr = drag.current; drag.current = null; setOver(null); if (!dr || !dr.over || dr.over === dr.id) return;
    set(d => { const from = d.layers.find(l => l.id === dr.id)!, rest = d.layers.filter(l => l.id !== dr.id), i = rest.findIndex(l => l.id === dr.over); const di = d.layers.findIndex(l => l.id === dr.id), ti = d.layers.findIndex(l => l.id === dr.over); rest.splice(di < ti ? i + 1 : i, 0, from); return { ...d, layers: rest }; }, 'レイヤーの順番を変更');
  };
  return (
    <div className="v3-panel">
      <div className="v3-phead layer"><b className="vert">レイヤー</b>
        <button className="v3-ib" aria-label="レイヤーを追加" onClick={add}><Plus size={17} /></button>
        <button className="v3-ib" aria-label="複製" onClick={dup}><Copy size={16} /></button>
        <button className="v3-ib" aria-label="下に結合" onClick={mergeDown}><ArrowDownToLine size={16} /></button>
        <button className="v3-ib" aria-label="表示レイヤーを結合" onClick={mergeVisible}><Combine size={16} /></button>
        <button className="v3-ib" aria-label="削除" onClick={del}><Trash2 size={16} /></button>
        <button className="v3-ib" aria-label="閉じる" onClick={e.close}><X size={16} /></button>
      </div>
      <div className="v3-layers" onPointerMove={onGripMove} onPointerUp={onGripUp}>
        {list.map(l => (
          <div key={l.id} data-layer={l.id} className={'v3-lrow' + (l.id === doc.activeLayer ? ' on' : '') + (over === l.id ? ' over' : '')}>
            <div className="v3-lmain" onClick={() => set(d => ({ ...d, activeLayer: l.id }), 'レイヤーを選択')} onDoubleClick={() => setRename(l.id)}>
              <span className="grip" onPointerDown={ev => onGrip(ev, l.id)}><GripVertical size={14} /></span>
              {rename === l.id ? <input autoFocus defaultValue={l.name} onBlur={ev => { const v = ev.target.value.trim(); setRename(null); if (v && v !== l.name) upd(l.id, x => ({ ...x, name: v }), '名前を変更'); }} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
                : <span className="nm">{l.name}</span>}
              <button className="v3-ib" aria-label={l.visible ? '非表示' : '表示'} onClick={ev => { ev.stopPropagation(); upd(l.id, x => ({ ...x, visible: !x.visible }), '表示切替'); }}>{l.visible ? <Eye size={15} /> : <EyeOff size={15} className="dim" />}</button>
              <button className="v3-ib" aria-label={l.locked ? 'ロック解除' : 'ロック'} onClick={ev => { ev.stopPropagation(); upd(l.id, x => ({ ...x, locked: !x.locked }), 'ロック切替'); }}>{l.locked ? <Lock size={15} /> : <LockOpen size={15} className="dim" />}</button>
            </div>
            {l.id === doc.activeLayer && (
              <div className="v3-opac"><span className="vert">透明度</span>
                <input type="range" min={0} max={100} value={Math.round(l.opacity * 100)} onChange={ev => e.live(d => ({ ...d, layers: d.layers.map(x => x.id === l.id ? { ...x, opacity: +ev.target.value / 100 } : x) }))} onPointerUp={() => e.end('透明度')} onKeyUp={() => e.end('透明度')} />
                <em>{Math.round(l.opacity * 100)}%</em></div>
            )}
          </div>
        ))}
      </div>
      <p className="v3-note pad">下描きのレイヤーは透明度を下げるか非表示にし、新しいレイヤーで清書します。行をダブルクリックで名前を変更、左端をドラッグで順番を入れ替えます。</p>
    </div>
  );
}

// ---------------- オブジェクト ----------------
function Thumb({ l, size = 26 }: { l: LibItem; size?: number }) {
  const k = Math.min(size / l.vw, size / l.vh);
  return <svg className="v3-thumb" width={size} height={size} viewBox={`${-(size / k - l.vw) / 2} ${-(size / k - l.vh) / 2} ${size / k} ${size / k}`}><use href={`#lib-${l.id}`} /></svg>;
}

export function ObjectPanel({ e }: { e: EditorApi }) {
  const { doc, lib, cat, setCat, libSel, setLibSel, tool, setTool } = e;
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, lib.filter(l => l.cat === c).length]));
  const extra = [...new Set(lib.map(l => l.cat).filter(c => !CATEGORIES.includes(c)))];
  const list = lib.filter(l => l.cat === cat);
  const selLib = lib.find(l => l.id === libSel);
  const objLayer = doc.layers.find(l => l.kind === 'object');
  const placed = (objLayer?.items || []) as ObjItem[];
  const selObj = placed.find(o => e.sel.length === 1 && o.id === e.sel[0]);
  const updObj = (f: (o: ObjItem) => ObjItem, label: string, liveOnly = false) => {
    if (!selObj) return; const g = (d: Doc) => ({ ...d, layers: d.layers.map(l => l.kind === 'object' ? { ...l, items: l.items.map(i => i.id === selObj.id ? f(i as ObjItem) : i) } : l) });
    liveOnly ? e.live(g) : e.set(g, label);
  };
  const mode = (t: Tool, label: string) => { setTool(t); e.toast(label); };
  const allHidden = placed.length > 0 && placed.every(o => o.hidden);
  const libOf = (o: ObjItem) => lib.find(l => l.id === o.ref);
  return (
    <div className="v3-panel">
      <Head title="オブジェクト" onClose={e.close} />
      <Card title="ツールモード">
        <div className="v3-grid2">
          <button className={'v3-pbtn' + (tool === 'select' ? ' on' : '')} onClick={() => mode('select', 'オブジェクト選択 ON')}>選択</button>
          <button className={'v3-pbtn' + (tool === 'register' ? ' on' : '')} onClick={() => mode('register', '登録したい範囲を囲んでください')}>囲って登録</button>
          <button className={'v3-pbtn' + (tool === 'place' ? ' on' : '')} onClick={() => selLib ? mode('place', `「${selLib.name}」をタップで配置`) : e.toast('一覧から登録オブジェクトを選んでください')}>登録を配置</button>
          <button className={'v3-pbtn' + (tool === 'random' ? ' on' : '')} onClick={() => selLib ? mode('random', 'タップごとに向き・大きさを変えて配置') : e.toast('一覧から登録オブジェクトを選んでください')}>ランダム配置</button>
          <button className="v3-pbtn" disabled={!placed.length || allHidden} onClick={() => e.set(d => ({ ...d, layers: d.layers.map(l => l.kind === 'object' ? { ...l, items: l.items.map(i => ({ ...i, hidden: true })) } : l) }), '一括非表示')}>一括非表示</button>
          <button className="v3-pbtn" disabled={!placed.some(o => o.hidden)} onClick={() => e.set(d => ({ ...d, layers: d.layers.map(l => l.kind === 'object' ? { ...l, items: l.items.map(i => ({ ...i, hidden: false })) } : l) }), '一括表示')}>一括表示</button>
        </div>
        <p className="v3-note">登録後はこの端末に保存され、別キャンバスでも配置できます。ランダム配置はタップごとに左右反転・回転・80〜120%サイズへ更新されます。</p>
      </Card>
      <Card title="登録オブジェクト">
        <div className="v3-chips">
          {[...CATEGORIES, ...extra].map(c => <button key={c} className={'v3-chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}>{c} ({counts[c] ?? lib.filter(l => l.cat === c).length})</button>)}
        </div>
        <div className="v3-list">
          {list.map(l => (
            <div key={l.id}>
              <button className={'v3-item' + (l.id === libSel ? ' on' : '')} onClick={() => setLibSel(l.id === libSel ? null : l.id)}><Thumb l={l} /><span>{l.name}</span></button>
              {l.id === libSel && (
                <div className="v3-detail">
                  <div className="v3-row"><button className="v3-link" onClick={() => mode('place', `「${l.name}」をタップで配置`)}>配置</button><button className="v3-link" onClick={() => mode('random', 'タップごとに向き・大きさを変えて配置')}>ランダム配置</button>{!l.builtin && <button className="v3-link" onClick={() => e.removeLib(l.id)}>削除</button>}</div>
                  <label className="v3-kv"><span>名前</span><input value={l.name} disabled={l.builtin} onChange={ev => e.updateLib({ ...l, name: ev.target.value })} /></label>
                  <label className="v3-kv"><span>カテゴリ</span><select value={l.cat} disabled={l.builtin} onChange={ev => e.updateLib({ ...l, cat: ev.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
                  <p className="v3-note">寸法 {Math.round(l.w * doc.mmPerPx)}×{Math.round(l.h * doc.mmPerPx)} mm</p>
                </div>
              )}
            </div>
          ))}
          {!list.length && <p className="v3-note">このカテゴリはまだありません。「囲って登録」で手描きを登録できます。</p>}
        </div>
      </Card>
      <Card title="配置オブジェクト">
        {!placed.length && <p className="v3-note">配置したオブジェクトがここに並びます。</p>}
        <div className="v3-list">
          {[...placed].reverse().map(o => {
            const l = libOf(o);
            return (
              <div key={o.id}>
                <div className={'v3-item placed' + (selObj?.id === o.id ? ' on' : '') + (o.hidden ? ' hid' : '')} onClick={() => { e.setSel([o.id]); if (tool !== 'select') setTool('select'); }}>
                  <GripVertical size={12} className="dim" />{l && <Thumb l={l} />}<span>{o.name}</span>
                  <button className="v3-ib" aria-label="ロック" onClick={ev => { ev.stopPropagation(); e.set(d => ({ ...d, layers: d.layers.map(x => x.kind === 'object' ? { ...x, items: x.items.map(i => i.id === o.id ? { ...i, locked: !(i as ObjItem).locked } : i) } : x) }), 'ロック切替'); }}>{o.locked ? <Lock size={13} /> : <LockOpen size={13} className="dim" />}</button>
                </div>
                {selObj?.id === o.id && (
                  <div className="v3-detail">
                    <p className="v3-note">種別　{l?.cat || '—'}　{l?.name}</p>
                    <label className="v3-chk"><input type="checkbox" checked={!o.hidden} onChange={ev => updObj(x => ({ ...x, hidden: !ev.target.checked }), '表示切替')} />表示</label>
                    <div className="v3-row wrap">
                      <button className="v3-link" onClick={() => e.registerItem(o.id)}>このオブジェクトを登録</button>
                      <button className="v3-link" onClick={() => updObj(x => ({ ...x, flip: !x.flip }), '左右反転')}>左右反転</button>
                      <button className="v3-link" onClick={() => updObj(x => ({ ...x, color: null }), '元色')}>元色</button>
                      <button className="v3-link danger" onClick={() => { e.set(d => ({ ...d, layers: d.layers.map(x => x.kind === 'object' ? { ...x, items: x.items.filter(i => i.id !== o.id) } : x) }), '削除'); e.setSel([]); }}>削除</button>
                    </div>
                    <div className="v3-slider"><span>サイズ</span><input type="range" min={20} max={300} value={Math.round((o.w / (l?.w || o.w)) * 100)} onChange={ev => { const k = +ev.target.value / 100, w = (l?.w || o.w) * k, h = (l?.h || o.h) * k; updObj(x => ({ ...x, x: x.x + x.w / 2 - w / 2, y: x.y + x.h / 2 - h / 2, w, h }), 'サイズ', true); }} onPointerUp={() => e.end('サイズ')} /><em>{Math.round((o.w / (l?.w || o.w)) * 100)}%</em></div>
                    <div className="v3-slider"><span>回転</span><input type="range" min={-180} max={180} value={Math.round(((o.rot + 540) % 360) - 180)} onChange={ev => updObj(x => ({ ...x, rot: +ev.target.value }), '回転', true)} onPointerUp={() => e.end('回転')} /><em>{Math.round(((o.rot + 540) % 360) - 180)}°</em></div>
                    {l?.tint !== false && <div className="v3-row"><span className="v3-note">色</span>{PALETTE.slice(0, 7).map(c => <button key={c} className={'v3-dot' + (o.color === c ? ' on' : '')} style={{ background: c }} onClick={() => updObj(x => ({ ...x, color: c }), '色')} />)}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ---------------- ガイド線 ----------------
const GUIDE_NAMES: Record<GuideType, string> = { line: '直線', slope: '線勾配', face: '面勾配', circle: '円', curve: '曲線', golden: '黄金比', grid: 'グリッド', ruler: '定規' };
export function GuidePanel({ e }: { e: EditorApi }) {
  const { doc, activeGuide, setActiveGuide } = e;
  const upd = (id: string, f: (g: Guide) => Guide, label = 'ガイド線を変更') => e.set(d => ({ ...d, guides: d.guides.map(g => g.id === id ? f(g) : g) }), label);
  const mm = doc.mmPerPx;
  return (
    <div className="v3-panel">
      <div className="v3-phead"><b>ガイド線</b><span className="sp" />
        <button className="v3-ib" aria-label="選択中のガイド線を削除" disabled={!activeGuide} onClick={() => { if (!activeGuide) return; e.set(d => ({ ...d, guides: d.guides.filter(g => g.id !== activeGuide) }), 'ガイド線を削除'); setActiveGuide(null); }}><CircleMinus size={17} /></button>
        <button className="v3-ib" aria-label="直線ガイドを追加" onClick={() => e.addGuide('line')}><Plus size={17} /></button>
        <button className="v3-ib" aria-label="閉じる" onClick={e.close}><X size={16} /></button>
      </div>
      <div className="v3-card"><div className="v3-grid3">
        {(['line', 'slope', 'face', 'circle', 'curve', 'golden', 'grid', 'ruler'] as GuideType[]).map(t => <button key={t} className="v3-pbtn sm" onClick={() => e.addGuide(t)}>{t === 'line' ? '直線ガイド' : t === 'slope' ? '線勾配' : t === 'face' ? '面勾配' : t === 'circle' ? '円ガイド' : t === 'curve' ? '曲線ガイド' : t === 'golden' ? '黄金比ガイド' : t === 'grid' ? 'グリッド' : '定規'}</button>)}
      </div></div>
      <div className="v3-list">
        {[...doc.guides].reverse().map(g => {
          const ang = Math.round(((deg(Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x)) % 360) + 360) % 360), len = dist(g.a, g.b), on = g.id === activeGuide;
          return (
            <div key={g.id}>
              <div className={'v3-grow' + (on ? ' on' : '')} onClick={() => setActiveGuide(on ? null : g.id)}>
                <Pencil size={12} className="dim" /><span className="chip">{GUIDE_NAMES[g.type]}</span>
                <input className="nm" value={g.name} onClick={ev => ev.stopPropagation()} onChange={ev => upd(g.id, x => ({ ...x, name: ev.target.value }), '名前')} />
                <input className="ang" type="number" value={ang} onClick={ev => ev.stopPropagation()} onChange={ev => { const a = rad(+ev.target.value || 0); upd(g.id, x => ({ ...x, b: { x: x.a.x + Math.cos(a) * len, y: x.a.y + Math.sin(a) * len } }), '角度'); }} /><em>°</em>
                <button className="v3-ib" aria-label="表示切替" onClick={ev => { ev.stopPropagation(); upd(g.id, x => ({ ...x, visible: !x.visible }), '表示切替'); }}>{g.visible ? <Eye size={14} /> : <EyeOff size={14} className="dim" />}</button>
                <button className="v3-ib" aria-label="ロック切替" onClick={ev => { ev.stopPropagation(); upd(g.id, x => ({ ...x, locked: !x.locked }), 'ロック切替'); }}>{g.locked ? <Lock size={14} /> : <LockOpen size={14} className="dim" />}</button>
              </div>
              {on && (
                <div className="v3-detail">
                  {(g.type === 'slope' || g.type === 'face') && <>
                    <div className="v3-kv2"><span>高さ</span><label>A<input type="number" value={g.hA} onChange={ev => upd(g.id, x => ({ ...x, hA: +ev.target.value || 0 }))} /></label><label>B<input type="number" value={g.hB} onChange={ev => upd(g.id, x => ({ ...x, hB: +ev.target.value || 0 }))} /></label></div>
                    <label className="v3-kv"><span>A-B距離</span><input type="number" value={Math.round(len * mm * 10) / 10} onChange={ev => { const L = (+ev.target.value || 1) / mm, a = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x); upd(g.id, x => ({ ...x, b: { x: x.a.x + Math.cos(a) * L, y: x.a.y + Math.sin(a) * L } })); }} /><em>mm</em></label>
                    <label className="v3-kv"><span>A-B勾配</span><input type="number" step="0.1" value={len ? Math.round((g.hB - g.hA) * 1000 / (len * mm)) / 10 : 0} onChange={ev => upd(g.id, x => ({ ...x, hB: Math.round(x.hA + (+ev.target.value || 0) * len * mm / 100) }))} /><em>%</em></label>
                  </>}
                  {g.type === 'circle' && <label className="v3-kv"><span>半径</span><input type="number" value={Math.round(len * mm)} onChange={ev => { const L = (+ev.target.value || 1) / mm, a = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x); upd(g.id, x => ({ ...x, b: { x: x.a.x + Math.cos(a) * L, y: x.a.y + Math.sin(a) * L } })); }} /><em>mm</em></label>}
                  {g.type === 'grid' && <label className="v3-kv"><span>間隔</span><input type="number" value={g.spacing || 1000} onChange={ev => upd(g.id, x => ({ ...x, spacing: Math.max(50, +ev.target.value || 1000) }))} /><em>mm</em></label>}
                  {(g.type === 'line' || g.type === 'ruler' || g.type === 'curve' || g.type === 'golden') && <p className="v3-note">長さ {fmtLen(len, mm, e.unit)}</p>}
                  <p className="v3-note">端点ハンドルで向き・長さ、中央の四角で位置を動かします。ガイド吸着がONなら、ガイドと同じ向きに引いた線は平行にそろいます。</p>
                </div>
              )}
            </div>
          );
        })}
        {!doc.guides.length && <p className="v3-note pad">上のボタンでガイド線を追加します。ガイドに沿って引いた線は平行・同心円にそろいます。</p>}
      </div>
    </div>
  );
}

// ---------------- AIツール（選択範囲・テクスチャ） ----------------
export function AIPanel({ e }: { e: EditorApi }) {
  const { doc, tool, setTool, genKind, setGenKind } = e;
  const [kw, setKw] = useState('砂利');
  const texItems = doc.layers.flatMap(l => l.items.filter(i => i.type === 'texture').map(i => ({ item: i as TextureItem, layer: l })));
  const cur = texItems.find(t => t.item.id === e.activeTex) || texItems[texItems.length - 1];
  const updTex = (f: (t: TextureItem) => TextureItem) => cur && e.live(d => ({ ...d, layers: d.layers.map(l => l.id === cur.layer.id ? { ...l, items: l.items.map(i => i.id === cur.item.id ? f(i as TextureItem) : i) } : l) }));
  const slider = (label: string, key: 'scale' | 'rot' | 'hue' | 'sat' | 'bright' | 'contrast', min: number, max: number, step = 1) => cur && (
    <div className="v3-slider vlab"><span className="vert">{label}</span><input type="range" min={min} max={max} step={step} value={cur.item[key]} onChange={ev => updTex(t => ({ ...t, [key]: +ev.target.value }))} onPointerUp={() => e.end('テクスチャ設定')} onKeyUp={() => e.end('テクスチャ設定')} /><input className="num" type="number" step={step} value={cur.item[key]} onChange={ev => { updTex(t => ({ ...t, [key]: +ev.target.value })); e.end('テクスチャ設定'); }} /></div>
  );
  return (
    <div className="v3-panel">
      <Head title="AIツール" onClose={e.close} />
      <Card title="選択範囲">
        <div className="v3-grid4">
          <button className={'v3-pbtn sq' + (tool === 'aiBrush' ? ' on' : '')} onClick={() => setTool('aiBrush')}>選択ブラシ</button>
          <button className={'v3-pbtn sq' + (tool === 'aiErase' ? ' on' : '')} onClick={() => setTool('aiErase')}>選択消しゴム</button>
          <button className={'v3-pbtn sq' + (tool === 'aiFill' ? ' on' : '')} onClick={() => setTool('aiFill')}>塗りつぶし追加</button>
          <button className="v3-pbtn sq" disabled={!e.aiCount} onClick={e.clearAi}>クリア</button>
        </div>
        <span className="v3-badge">{e.aiCount ? `選択中 ${e.aiCount}` : '未選択'}</span>
        <p className="v3-note">閉じた輪郭の内側をタップして、選択範囲に追加します。ブラシの太さは上部の線幅で変わります。</p>
      </Card>
      <Card title="生成種別">
        <div className="v3-chips">
          {([['texture', 'テクスチャツール'], ['aiTexture', 'AIテクスチャ'], ['aiPen', 'AIペン'], ['aiObject', 'AIオブジェクト'], ['color', 'カラーオブジェクト生成']] as [GenKind, string][]).map(([k, l]) => <button key={k} className={'v3-chip lg' + (genKind === k ? ' on soft' : '')} onClick={() => setGenKind(k)}>{l}</button>)}
        </div>
        <p className="v3-note">{genKind === 'texture' ? '生成種別: テクスチャツール / 画像読込 / 繰返し適用' : genKind === 'aiTexture' ? 'キーワードから素材テクスチャを作ります（端末内で生成）' : genKind === 'color' ? '選択範囲を上部で選んだ色で塗ります' : 'AI接続を設定すると使えます（現在は未接続）'}</p>
      </Card>
      <Card title="生成">
        {genKind === 'texture' && <button className="v3-btn primary" onClick={ev => e.pickImage(ev.currentTarget.getBoundingClientRect())}>画像を適用…</button>}
        {genKind === 'aiTexture' && <div className="v3-row"><input className="v3-in" value={kw} onChange={ev => setKw(ev.target.value)} placeholder="例: 砂利 芝 レンガ" /><button className="v3-btn primary" onClick={() => e.aiKeyword(kw)}>生成</button></div>}
        {genKind === 'color' && <button className="v3-btn primary" onClick={() => e.aiKeyword('#color')}>色で塗る</button>}
        {(genKind === 'aiPen' || genKind === 'aiObject') && <button className="v3-btn primary" disabled>生成</button>}
        <p className="v3-note">接続先: {genKind === 'aiPen' || genKind === 'aiObject' ? '未設定' : 'ローカル画像'}</p>
      </Card>
      <Card title="ジョブ">
        <div className="v3-jobs">
          {!e.jobs.length && <div className="v3-empty">生成ジョブはありません。</div>}
          {[...e.jobs].reverse().map(j => (
            <div key={j.id} className="v3-job">
              <img src={j.thumb} alt="" />
              <div><b>{j.name}</b><em>DONE</em><p>Selection: {j.sel} / Ref: {j.texName} / Layer: {j.layer} / {j.time}</p><div className="bar"><i /></div><button className="v3-link" onClick={() => e.applyJob(j)}>適用</button></div>
            </div>
          ))}
        </div>
        <p className="v3-note">{e.jobs.length ? `完了 ${e.jobs.length}` : '待機中のジョブはありません。'}</p>
      </Card>
      <Card title="テクスチャ設定">
        {cur ? <>
          <p className="v3-note">{cur.item.texName} / {cur.layer.name}</p>
          <div className="v3-grid3">
            <button className="v3-pbtn sm" onClick={() => e.recallSelection(cur.item)}>選択範囲を呼び出す</button>
            <button className="v3-pbtn sm" onClick={() => { e.set(d => ({ ...d, activeLayer: cur.layer.id }), 'レイヤーを選択'); e.openPanel('layers'); }}>レイヤーを選択</button>
            <button className="v3-pbtn sm" onClick={() => e.saveTexture(cur.item)}>テクスチャ画像を保存</button>
          </div>
          {texItems.length > 1 && <select className="v3-in" value={cur.item.id} onChange={ev => e.setActiveTex(ev.target.value)}>{texItems.map(t => <option key={t.item.id} value={t.item.id}>{t.layer.name}：{t.item.texName}</option>)}</select>}
          {slider('拡大', 'scale', 0.1, 5, 0.1)}{slider('回転', 'rot', -180, 180)}{slider('色相', 'hue', -180, 180)}{slider('彩度', 'sat', 0, 200)}{slider('明るさ', 'bright', 20, 200)}{slider('コントラスト', 'contrast', 20, 200)}
        </> : <p className="v3-note">保存済みのテクスチャを選ぶと、ここで拡大縮小や回転、色味、明るさを調整できます。</p>}
      </Card>
    </div>
  );
}

export function TexturePicker({ onPick }: { onPick: (tex: string, name: string) => void }) {
  return <div className="v3-texgrid">{TEXTURES.map(t => <button key={t.id} onClick={() => onPick('b:' + t.id, t.name)}><img src={textureSrc('b:' + t.id)} alt="" /><span>{t.name}</span></button>)}</div>;
}

// ---------------- 履歴・テキスト ----------------
export function HistoryPanel({ e }: { e: EditorApi }) {
  return (
    <div className="v3-panel">
      <Head title="履歴" onClose={e.close} />
      <div className="v3-list">
        {!e.history.length && <p className="v3-note pad">まだ操作履歴はありません。</p>}
        {[...e.history].map((h, i) => ({ h, i })).reverse().slice(0, 60).map(({ h, i }) => (
          <button key={i} className="v3-item" onClick={() => e.restore(i)}><span>{h.label}</span><em>{new Date(h.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</em></button>
        ))}
      </div>
      <p className="v3-note pad">行を押すと、その操作の直前の状態に戻します（戻した操作も履歴に残ります）。</p>
    </div>
  );
}

export function TextsPanel({ e }: { e: EditorApi }) {
  const texts = e.doc.layers.flatMap(l => l.items.filter(i => i.type === 'text')) as TextItem[];
  return (
    <div className="v3-panel">
      <Head title="テキスト" onClose={e.close} />
      <div className="v3-list">
        {!texts.length && <p className="v3-note pad">「T」で図面をタップすると、寸法やメモを置けます。</p>}
        {texts.map(t => <button key={t.id} className={'v3-item' + (e.sel.includes(t.id) ? ' on' : '')} onClick={() => { e.setSel([t.id]); e.setTool('select'); }} onDoubleClick={() => e.editText(t.id)}><span style={{ color: t.color }}>{t.text.split('\n')[0]}</span></button>)}
      </div>
    </div>
  );
}

export const guideDefaults = (t: GuideType, c: Pt, span: number): Guide => {
  const a = { x: c.x - span / 2, y: c.y }, b = { x: c.x + span / 2, y: c.y };
  const base: Guide = { id: crypto.randomUUID(), type: t, name: 'ガイド', a, b, visible: true, locked: false, hA: 0, hB: 0 };
  if (t === 'slope' || t === 'face') return { ...base, name: t === 'slope' ? '線勾配' : '面勾配', hA: 0, hB: 400 };
  if (t === 'circle') return { ...base, name: '円ガイド', a: c, b: { x: c.x + span / 3, y: c.y } };
  if (t === 'curve') return { ...base, name: '曲線ガイド', c: { x: c.x, y: c.y - span / 4 } };
  if (t === 'golden') return { ...base, name: '黄金比', a: { x: c.x - span / 2, y: c.y - span * 0.309 }, b: { x: c.x + span / 2, y: c.y + span * 0.309 } };
  if (t === 'grid') return { ...base, name: 'グリッド', spacing: 1000 };
  if (t === 'ruler') return { ...base, name: '定規' };
  return base;
};

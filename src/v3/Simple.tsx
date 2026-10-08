// かんたんモード：「描く・部品・塗る・出力」の4手順だけを大きなボタンで出す。
// 使い方は文章ではなく、実際のボタンを光らせる案内（Tour）と動く見本（Demo）で見せる。
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  PenTool, Slash, Square, MoveHorizontal, Type, Eraser, Hand, Car, PaintBucket, FileDown, Undo2, Redo2, Scan, CircleHelp,
  SlidersHorizontal, ChevronLeft, X, Play, Printer, FileImage, Save, RotateCcw,
} from 'lucide-react';
import { type LibItem } from './types';
import { type Tool, type ToolOpts } from './Canvas';
import { Thumb } from './Panels';
import { CATEGORIES } from './library';
import { TEXTURES, textureSrc } from './textures';
import './simple.css';
// 実画面の操作動画（scripts/record-guide.py で撮り直せる）
import drawMp4 from './guide/draw.mp4';
import partsMp4 from './guide/parts.mp4';
import paintMp4 from './guide/paint.mp4';
import outMp4 from './guide/out.mp4';
import undoMp4 from './guide/undo.mp4';

export type Step = 'draw' | 'parts' | 'paint' | 'out';
export type ExportKind = 'png' | 'a4' | 'a3' | 'json';

// ---------------- 上部バー ----------------
export function SimpleTop({ name, saved, canUndo, canRedo, undo, redo, fit, home, help, toFull }: {
  name: string; saved: 'saved' | 'saving' | 'error'; canUndo: boolean; canRedo: boolean;
  undo: () => void; redo: () => void; fit: () => void; home: () => void; help: () => void; toFull: () => void;
}) {
  return (
    <header className="sx-top">
      <button className="sx-tb" onClick={home} aria-label="一覧へ戻る"><ChevronLeft size={20} /><span>一覧</span></button>
      <div className="sx-name"><b>{name}</b><em className={saved === 'error' ? 'err' : ''}>{saved === 'saving' ? '保存中…' : saved === 'error' ? '保存エラー' : '自動保存済み'}</em></div>
      <span className="sp" />
      <div className="sx-group" data-tour="undo">
        <button className="sx-tb" onClick={undo} disabled={!canUndo} aria-label="元に戻す"><Undo2 size={20} /><span>戻す</span></button>
        <button className="sx-tb" onClick={redo} disabled={!canRedo} aria-label="やり直す"><Redo2 size={20} /><span>進む</span></button>
      </div>
      <button className="sx-tb" onClick={fit} aria-label="全体を表示"><Scan size={20} /><span>全体</span></button>
      <button className="sx-tb help" onClick={help} data-tour="help" aria-label="使い方"><CircleHelp size={20} /><span>使い方</span></button>
      <button className="sx-tb" onClick={toFull} data-tour="mode" aria-label="詳細モードへ"><SlidersHorizontal size={19} /><span>詳細</span></button>
    </header>
  );
}

// ---------------- 下部：手順タブと、手順ごとの道具 ----------------
const STEPS: { id: Step; label: string; icon: ReactNode }[] = [
  { id: 'draw', label: '描く', icon: <PenTool size={22} /> },
  { id: 'parts', label: '部品', icon: <Car size={22} /> },
  { id: 'paint', label: '塗る', icon: <PaintBucket size={22} /> },
  { id: 'out', label: '出力', icon: <FileDown size={22} /> },
];

const DRAW: { label: string; icon: ReactNode; tool: Tool; patch?: Partial<ToolOpts> }[] = [
  { label: 'ペン', icon: <PenTool size={20} />, tool: 'pen', patch: { brush: 'pen', dash: 'solid' } },
  { label: '直線', icon: <Slash size={20} />, tool: 'line', patch: { lineKind: 'line' } },
  { label: '四角', icon: <Square size={20} />, tool: 'shape', patch: { shapeKind: 'rect' } },
  { label: '寸法', icon: <MoveHorizontal size={20} />, tool: 'dim' },
  { label: '文字', icon: <Type size={20} />, tool: 'text' },
  { label: '消す', icon: <Eraser size={20} />, tool: 'eraser' },
  { label: '動かす', icon: <Hand size={20} />, tool: 'select' },
];
const WIDTHS: [string, number][] = [['細', 3], ['中', 6], ['太', 12]];
const COLORS: [string, string][] = [['黒', '#2f3b38'], ['赤', '#c4473d'], ['青', '#3f7fbf'], ['茶', '#a35a1f']];
const PART_ORDER = ['乗り物', '植栽', '低木', '下草', 'カーポート', '照明', 'ガーデンファニチャー', '景石', 'その他', '未分類', 'キャラクター'];

export type DockProps = {
  step: Step; setStep: (s: Step) => void;
  tool: Tool; setTool: (t: Tool) => void; opts: ToolOpts; setOpts: (o: ToolOpts) => void;
  lib: LibItem[]; libSel: string | null; setLibSel: (id: string) => void; cat: string; setCat: (c: string) => void;
  aiCount: number; clearAi: () => void; paint: (tex: string, name: string) => void; paintColor: () => void;
  exportAs: (k: ExportKind) => void;
};

export function SimpleDock(p: DockProps) {
  return (
    <footer className="sx-dock" data-tour="dockall">
      <div className="sx-sheet" data-tour="sheet">
        {p.step === 'draw' && <DrawSheet {...p} />}
        {p.step === 'parts' && <PartsSheet {...p} />}
        {p.step === 'paint' && <PaintSheet {...p} />}
        {p.step === 'out' && <OutSheet {...p} />}
      </div>
      <nav className="sx-steps" data-tour="dock" aria-label="手順">
        {STEPS.map((s, i) => (
          <button key={s.id} data-tour={'step-' + s.id} className={'sx-step' + (p.step === s.id ? ' on' : '')} onClick={() => p.setStep(s.id)}>
            <i>{i + 1}</i>{s.icon}<span>{s.label}</span>
          </button>
        ))}
      </nav>
    </footer>
  );
}

function DrawSheet({ tool, setTool, opts, setOpts }: DockProps) {
  return (
    <div className="sx-row">
      <div className="sx-tools">
        {DRAW.map(d => (
          <button key={d.label} className={'sx-tool' + (tool === d.tool ? ' on' : '')} onClick={() => { if (d.patch) setOpts({ ...opts, ...d.patch }); setTool(d.tool); }}>
            {d.icon}<span>{d.label}</span>
          </button>
        ))}
      </div>
      <i className="sx-sep" />
      <div className="sx-opts">
        <div className="sx-seg" aria-label="線の太さ">
          {WIDTHS.map(([l, w]) => <button key={l} className={opts.width === w ? 'on' : ''} onClick={() => setOpts({ ...opts, width: w })}><b style={{ height: Math.max(2, w / 1.5) }} />{l}</button>)}
        </div>
        <div className="sx-colors" aria-label="色">
          {COLORS.map(([l, c]) => <button key={c} className={opts.color === c ? 'on' : ''} onClick={() => setOpts({ ...opts, color: c })}><b style={{ background: c }} />{l}</button>)}
        </div>
      </div>
    </div>
  );
}

function PartsSheet({ lib, libSel, setLibSel, cat, setCat, tool, setTool }: DockProps) {
  const extra = [...new Set(lib.map(l => l.cat))].filter(c => !PART_ORDER.includes(c) && !CATEGORIES.includes(c));
  const cats = [...PART_ORDER, ...extra].filter(c => lib.some(l => l.cat === c));
  const cur = cats.includes(cat) ? cat : cats[0];
  const list = lib.filter(l => l.cat === cur);
  return (
    <div className="sx-prow">
      <button className={'sx-tool' + (tool === 'select' ? ' on' : '')} onClick={() => setTool('select')}><Hand size={20} /><span>動かす</span></button>
      <i className="sx-sep" />
      <div className="sx-col">
      <div className="sx-cats">
        {cats.map(c => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="sx-parts">
        {list.map(l => (
          <button key={l.id} className={'sx-part' + (tool === 'place' && libSel === l.id ? ' on' : '')} onClick={() => { setLibSel(l.id); setTool('place'); }}>
            <Thumb l={l} size={40} /><span>{l.name}</span>
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}

function PaintSheet({ aiCount, clearAi, paint, paintColor, opts }: DockProps) {
  return (
    <div className="sx-row">
      <div className="sx-paintstep">
        <div className={'sx-badge' + (aiCount ? ' done' : ' now')}><i>1</i>塗る場所をタップ{aiCount ? <em>選択済み</em> : null}</div>
        <div className={'sx-badge' + (aiCount ? ' now' : '')}><i>2</i>素材を選ぶ</div>
        {aiCount > 0 && <button className="sx-mini" onClick={clearAi}><RotateCcw size={14} />選び直す</button>}
      </div>
      <i className="sx-sep" />
      <div className={'sx-texs' + (aiCount ? '' : ' wait')}>
        {TEXTURES.map(t => (
          <button key={t.id} className="sx-tex" onClick={() => paint('b:' + t.id, t.name)}><img src={textureSrc('b:' + t.id)} alt="" /><span>{t.name.replace(/（.*）/, '')}</span></button>
        ))}
        <button className="sx-tex" onClick={paintColor}><b style={{ background: opts.color }} /><span>いまの色</span></button>
      </div>
    </div>
  );
}

function OutSheet({ exportAs }: DockProps) {
  const B = (k: ExportKind, icon: ReactNode, t: string, s: string) => <button className="sx-out" onClick={() => exportAs(k)}>{icon}<b>{t}</b><span>{s}</span></button>;
  return (
    <div className="sx-row center">
      {B('a3', <Printer size={22} />, 'PDF（A3）', 'お客様に渡す・印刷')}
      {B('a4', <Printer size={22} />, 'PDF（A4）', '家庭のプリンタ用')}
      {B('png', <FileImage size={22} />, '画像（PNG）', 'LINE・メールに貼る')}
      {B('json', <Save size={22} />, '編集データ', '別の端末で続きを描く')}
    </div>
  );
}

// 道具ごとの一言（キャンバス上部に出す）
export function simpleHint(tool: Tool, aiCount: number, partName?: string, step?: Step) {
  if (step === 'out') return '';
  if (step === 'parts' && tool !== 'place') return '下から部品を選ぶ／置いた部品はドラッグで動かす';
  switch (tool) {
    case 'pen': return 'なぞって線を描く';
    case 'line': return '始点から終点までドラッグ';
    case 'shape': return '角から角へドラッグ';
    case 'dim': return '測りたい2点の間をドラッグ';
    case 'text': return '文字を置く場所をタップ';
    case 'eraser': return '消したい線をなぞる';
    case 'select': return 'タップで選ぶ・ドラッグで動かす';
    case 'place': return `「${partName || '部品'}」：タップするたびに置けます`;
    case 'aiFill': return aiCount ? '下から素材を選ぶ（別の場所も続けてタップ可）' : '線で囲まれた場所をタップ';
    default: return '';
  }
}

// ---------------- 動く見本 ----------------
export type DemoKind = 'flow' | 'draw' | 'parts' | 'paint' | 'out' | 'undo' | 'pinch' | 'move';

export function Demo({ kind }: { kind: DemoKind }) {
  const finger = (cls: string) => <g className={'dm-finger ' + cls}><circle r="9" /><circle className="rip" r="9" /></g>;
  return (
    <svg className={'sx-demo dm-' + kind} viewBox="0 0 200 120" aria-hidden="true">
      <defs>
        <pattern id="dm-gravel" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#b7c2c7" /><circle cx="2" cy="2" r="1.6" fill="#8d999f" /><circle cx="6" cy="5" r="1.3" fill="#e1e6e8" /><circle cx="3" cy="7" r="1" fill="#7c878c" /></pattern>
      </defs>
      <rect className="dm-paper" x="1" y="1" width="198" height="118" rx="10" />
      {kind === 'flow' && <g className="dm-flow">
        {['描く', '部品', '塗る', '出力'].map((t, i) => (
          <g key={t} className={'n n' + i} transform={`translate(${28 + i * 48} 58)`}>
            <circle r="17" /><text y="5" textAnchor="middle" className="num">{i + 1}</text><text y="36" textAnchor="middle" className="lb">{t}</text>
          </g>
        ))}
        {[0, 1, 2].map(i => <path key={i} className={'ar ar' + i} d={`M${48 + i * 48} 58h8`} />)}
      </g>}
      {kind === 'draw' && <g>
        <path className="dm-ink" pathLength={100} d="M28 88 C 50 30, 92 28, 108 62 S 160 96, 176 34" />
        {finger('follow')}
      </g>}
      {kind === 'parts' && <g>
        <rect className="dm-tray" x="10" y="88" width="180" height="26" rx="7" />
        <g className="dm-tile t-car" transform="translate(30 101)"><rect x="-14" y="-10" width="28" height="20" rx="5" /><g transform="scale(.55)"><rect x="-14" y="-7" width="28" height="14" rx="4" className="car" /><circle cx="-8" cy="7" r="3" /><circle cx="8" cy="7" r="3" /></g></g>
        <g className="dm-tile" transform="translate(68 101)"><rect x="-14" y="-10" width="28" height="20" rx="5" /><circle r="6" className="tree" /></g>
        <g className="dm-tile" transform="translate(106 101)"><rect x="-14" y="-10" width="28" height="20" rx="5" /><circle r="4" cx="-3" className="tree" /><circle r="4" cx="4" cy="2" className="tree" /></g>
        <rect className="dm-house" x="20" y="12" width="60" height="46" />
        <g transform="translate(140 42)"><g className="dm-placed"><rect x="-22" y="-12" width="44" height="24" rx="7" className="car" /><circle cx="-12" cy="12" r="5" /><circle cx="12" cy="12" r="5" /></g></g>
        {finger('parts')}
      </g>}
      {kind === 'paint' && <g>
        <rect className="dm-region" x="40" y="14" width="96" height="62" />
        <rect className="dm-filled" x="40" y="14" width="96" height="62" fill="url(#dm-gravel)" />
        <rect className="dm-outline" x="40" y="14" width="96" height="62" />
        <rect className="dm-tray" x="10" y="88" width="180" height="26" rx="7" />
        <rect className="dm-swatch s1" x="120" y="92" width="30" height="18" rx="4" fill="url(#dm-gravel)" />
        <rect className="dm-swatch" x="156" y="92" width="30" height="18" rx="4" fill="#9cc47c" />
        <rect className="dm-swatch" x="84" y="92" width="30" height="18" rx="4" fill="#cfcac0" />
        {finger('paint')}
      </g>}
      {kind === 'out' && <g>
        <g className="dm-sheet"><rect x="22" y="22" width="62" height="76" rx="5" /><path d="M32 40h30M32 52h40M32 64h22" /><rect x="34" y="72" width="30" height="16" className="fillg" /></g>
        <path className="dm-arrow" pathLength={100} d="M96 60h26m-8-8 8 8-8 8" />
        <g className="dm-pdf"><rect x="132" y="22" width="52" height="76" rx="5" /><rect x="132" y="22" width="52" height="20" rx="5" className="band" /><text x="158" y="37" textAnchor="middle">PDF</text><path d="M142 56h32M142 66h24M142 76h28" /></g>
      </g>}
      {kind === 'undo' && <g>
        <path className="dm-ink2" pathLength={100} d="M30 70 C 60 30, 90 90, 120 50" />
        <g className="dm-btn" transform="translate(162 34)"><rect x="-22" y="-16" width="44" height="32" rx="9" /><path d="M-7 -4 h10 a7 7 0 0 1 0 14 h-8 M-7 -4 l5 -5 M-7 -4 l5 5" /></g>
        {finger('undo')}
      </g>}
      {kind === 'pinch' && <g>
        <g transform="translate(100 60)"><g className="dm-zoom"><rect x="-20" y="-20" width="40" height="40" className="house" /><rect x="-12" y="-4" width="10" height="10" className="fillg" /></g></g>
        <g className="dm-finger pa"><circle r="9" /></g><g className="dm-finger pb"><circle r="9" /></g>
      </g>}
      {kind === 'move' && <g>
        <rect className="dm-house" x="18" y="16" width="56" height="60" />
        <g className="dm-mover"><rect x="-20" y="-11" width="40" height="22" rx="7" className="car" /><circle cx="-11" cy="11" r="4.5" /><circle cx="11" cy="11" r="4.5" /><rect className="selb" x="-25" y="-16" width="50" height="34" /></g>
        {finger('move')}
      </g>}
    </svg>
  );
}

// ---------------- 初回案内（実際のボタンを光らせる） ----------------
export type TourStep = { target: string; title: string; text: string; demo?: DemoKind; before?: () => void };
type Rect = { x: number; y: number; w: number; h: number };

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const s = steps[i];
  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = document.querySelector(`[data-tour="${s.target}"]`);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [s.target]);
  useLayoutEffect(() => { s.before?.(); const id = requestAnimationFrame(() => requestAnimationFrame(measure)), t = setTimeout(measure, 350); return () => { cancelAnimationFrame(id); clearTimeout(t); }; }, [i]);
  useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [measure]);
  const last = i === steps.length - 1;
  const next = () => last ? onDone() : setI(i + 1);

  // 吹き出しは対象の上か下へ。画面の半分を超える大きな対象（キャンバス）では中央に出す
  const pad = 6, bw = Math.min(320, vp.w - 24);
  let style: React.CSSProperties = { width: bw, left: (vp.w - bw) / 2, top: vp.h / 2 - 140 };
  if (rect && rect.h < vp.h * 0.5) {
    const left = Math.min(Math.max(12, rect.x + rect.w / 2 - bw / 2), vp.w - bw - 12);
    style = rect.y + rect.h / 2 > vp.h / 2 ? { width: bw, left, bottom: vp.h - rect.y + pad + 12 } : { width: bw, left, top: rect.y + rect.h + pad + 12 };
  }
  return (
    <div className="sx-tour" role="dialog" aria-label="使い方の案内">
      {rect ? <div className="sx-hole" style={{ left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2 }} /> : <div className="sx-dim" />}
      <div className="sx-bubble" style={style}>
        {s.demo && <Demo kind={s.demo} />}
        <b>{s.title}</b>
        <p>{s.text}</p>
        <div className="sx-brow">
          <button className="skip" onClick={onDone}>スキップ</button>
          <span className="dots">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
          {i > 0 && <button className="back" onClick={() => setI(i - 1)}>戻る</button>}
          <button className="next" onClick={next}>{last ? 'はじめる' : '次へ'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 使い方（動く見本の一覧） ----------------
export type HelpItem = { demo: DemoKind; title: string; text: string; video?: string };
export const HELP: HelpItem[] = [
  { demo: 'flow', title: '全体の流れ', text: '下の①〜④を左から順に' },
  { demo: 'draw', title: '① 描く', text: 'ペンを選んでなぞる', video: drawMp4 },
  { demo: 'parts', title: '② 部品を置く', text: '部品を選んで図面をタップ', video: partsMp4 },
  { demo: 'paint', title: '③ 塗る', text: '囲まれた場所をタップ→素材', video: paintMp4 },
  { demo: 'out', title: '④ 出力', text: 'PDFにしてお客様へ', video: outMp4 },
  { demo: 'move', title: '動かす', text: '「動かす」で選んでドラッグ', video: partsMp4 },
  { demo: 'undo', title: '間違えたら', text: '上の「戻す」で1つ前へ', video: undoMp4 },
  { demo: 'pinch', title: '拡大・移動', text: '2本指で広げる・ずらす' },
];

// 詳細モードの解説動画（guideFull.ts）。サムネイル画像つき
export type GuideVideo = { id: string; title: string; text: string; video: string; poster: string };
export type HelpTab = 'simple' | 'full';
type Playing = { title: string; src: string; list: { title: string; src: string }[] };

export function HelpSheet({ items, full, tab: tab0 = 'simple', open, onClose, onTour }: {
  items: HelpItem[]; full: GuideVideo[]; tab?: HelpTab; open?: string; onClose: () => void; onTour: () => void;
}) {
  const [tab, setTab] = useState<HelpTab>(tab0);
  const simpleList = items.filter(h => h.video && h.demo !== 'move').map(h => ({ title: h.title, src: h.video! }));
  const fullList = full.map(v => ({ title: v.title, src: v.video }));
  const start = full.find(v => v.id === open);
  const [playing, setPlaying] = useState<Playing | null>(start ? { title: start.title, src: start.video, list: fullList } : null);
  const idx = playing ? playing.list.findIndex(x => x.src === playing.src && x.title === playing.title) : -1;
  const next = playing && idx >= 0 && idx < playing.list.length - 1 ? playing.list[idx + 1] : null;
  return (
    <div className="v3-modal-bg" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sx-help" role="dialog" aria-label="使い方">
        <div className="sx-hhead"><b>使い方</b>
          <div className="sx-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'simple'} className={tab === 'simple' ? 'on' : ''} onClick={() => { setTab('simple'); setPlaying(null); }}>かんたんモード</button>
            <button role="tab" aria-selected={tab === 'full'} className={tab === 'full' ? 'on' : ''} onClick={() => { setTab('full'); setPlaying(null); }}>詳細モード</button>
          </div>
          <span className="sp" />{tab === 'simple' && <button className="sx-tourbtn" onClick={onTour}><Play size={15} />案内をもう一度</button>}<button className="v3-ib" aria-label="閉じる" onClick={onClose}><X size={18} /></button></div>
        {playing ? (
          <div className="sx-player">
            <video key={playing.src + playing.title} src={playing.src} autoPlay controls playsInline muted />
            <div className="v3-actions"><b>{playing.title}</b><span className="sp" />
              <button className="v3-btn" onClick={() => setPlaying(null)}>一覧に戻る</button>
              {next && <button className="v3-btn primary" onClick={() => setPlaying({ ...playing, ...next })}>次：{next.title}</button>}
            </div>
          </div>
        ) : tab === 'simple' ? (
          <div className="sx-hgrid">
            {items.map(h => (
              <div key={h.title} className="sx-hcard">
                <Demo kind={h.demo} />
                <b>{h.title}</b><span>{h.text}</span>
                {h.video && <button className="sx-watch" onClick={() => setPlaying({ title: h.title, src: h.video!, list: simpleList })}><Play size={13} />実際の画面で見る</button>}
              </div>
            ))}
          </div>
        ) : (
          <div className="sx-hgrid">
            {full.map(v => (
              <button key={v.id} className="sx-hcard sx-vcard" onClick={() => setPlaying({ title: v.title, src: v.video, list: fullList })}>
                <span className="th"><img src={v.poster} alt="" /><i><Play size={18} /></i></span>
                <b>{v.title}</b><span>{v.text}</span>
              </button>
            ))}
            {!full.length && <p className="v3-note">動画を準備中です。</p>}
          </div>
        )}
      </div>
    </div>
  );
}

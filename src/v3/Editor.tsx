// v0.3 エディタ：上部3段の道具、左の縦ボタン、右のパネル、作図領域
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon, Download, PenTool, ChevronDown, Eraser, Type, MoveHorizontal, Circle, Slash, SquareX, Grid3x3, Maximize, Spline,
  AlignJustify, Lock, LockOpen, RotateCw, RotateCcw, Copy, House, Save, SaveAll, FolderOpen, ArrowDownToLine, ArrowUpFromLine, CloudUpload,
  User, LogOut, PanelRight, Layers, LayoutGrid, Ruler, FileText, Sparkles, History, Settings, Redo2, Undo2, SquareDashedMousePointer, Magnet,
  Trash2, FlipHorizontal2, ArrowUp, ArrowDown, PackagePlus, X, Camera, Images, FolderOpen as Folder, CircleHelp, Play,
} from 'lucide-react';
import { type Doc, type Item, type LibItem, type Pt, type ObjItem, type TextItem, type TextureItem, type GuideType, PALETTE, uid, itemBox, unionBox, boxOf, pointInPoly, transformItem, dist, rad, newLayer } from './types';
import { useDoc, ensureLayer, findItem, removeItems, updateItem } from './useDoc';
import { Canvas, type Tool, type ToolOpts, type View, type CanvasApi, type FingerMode, toWorld } from './Canvas';

// 端末ごとの入力設定。プライベートブラウズ等で使えなくても動くようにする
const readPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても続行 */ } };
import { builtinLibrary, CATEGORIES } from './library';
import { itemMarkup } from './markup';
import { textureSrc, textureName, TEXTURES } from './textures';
import { Selection, contentBox, fillAt, exportImage, exportPDF, thumbnail, docSVG, rasterize } from './raster';
import { saveDoc, listLibrary, saveLibItem, deleteLibItem, validDoc } from './store';
import { LayerPanel, ObjectPanel, GuidePanel, AIPanel, HistoryPanel, TextsPanel, TexturePicker, guideDefaults, type EditorApi, type Job, type GenKind } from './Panels';
import { TextDialog, PromptDialog, Menu, Modal, type Field, type TextValue } from './Dialogs';
import { readSource } from '../io';
import { isNativeApp, saveFile } from './platform';
import { SimpleTop, SimpleDock, Tour, HelpSheet, HELP, simpleHint, type Step, type TourStep, type HelpTab } from './Simple';
import { GUIDE_FULL } from './guideFull';

const VERSION = 'ver 2026.10.09-01 (guide-videos)';
type PanelId = 'objects' | 'layers' | 'guides' | 'ai' | 'settings' | 'history' | 'texts' | null;

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'gaikou';

export function Editor({ initial, onHome }: { initial: Doc; onHome: () => void }) {
  const D = useDoc(initial);
  const { doc } = D;
  const [tool, setToolRaw] = useState<Tool>('pen');
  const [opts, setOpts] = useState<ToolOpts>({ brush: 'pen', dash: 'solid', width: 3, color: PALETTE[0], lineKind: 'line', shapeKind: 'rect', measure: 'line', unit: 'mm' });
  const [view, setView] = useState<View>(initial.view || { x: 0, y: 0, k: 1, r: 0 });
  // かんたんモード（標準）と詳細モード。端末ごとに覚える
  const [ui, setUiRaw] = useState<'simple' | 'full'>(() => readPref('gofg-v3-ui') === 'full' ? 'full' : 'simple');
  const simple = ui === 'simple';
  const [step, setStepRaw] = useState<Step>('draw');
  const [tour, setTour] = useState(() => readPref('gofg-v3-ui') !== 'full' && readPref('gofg-v3-tour') !== 'done');
  const [help, setHelp] = useState<{ tab: HelpTab; open?: string } | null>(null);
  const [hintOn, setHintOn] = useState(true);
  const [panel, setPanel] = useState<PanelId>(() => readPref('gofg-v3-ui') === 'full' ? 'objects' : null);
  const [sel, setSel] = useState<string[]>([]);
  const [guideSnap, setGuideSnap] = useState(true), [showGrid, setShowGrid] = useState(false), [gridMm, setGridMm] = useState(100);
  const [fingerMode, setFingerModeRaw] = useState<FingerMode>(() => { const v = readPref('gofg-v3-finger'); return v === 'draw' || v === 'pan' ? v : 'auto'; });
  const [penSeen, setPenSeen] = useState(() => readPref('gofg-v3-pen-seen') === '1');
  const setFingerMode = (m: FingerMode) => { setFingerModeRaw(m); writePref('gofg-v3-finger', m); };
  const [activeGuide, setActiveGuide] = useState<string | null>(null);
  const [userLib, setUserLib] = useState<LibItem[]>([]);
  const lib = useMemo(() => [...builtinLibrary(), ...userLib], [userLib]);
  const [libSel, setLibSel] = useState<string | null>('b-bicycle'), [cat, setCat] = useState('乗り物');
  const [aiSel, setAiSel] = useState<Selection | null>(null), [aiVer, setAiVer] = useState(0);
  const [genKind, setGenKind] = useState<GenKind>('texture');
  const [jobs, setJobs] = useState<Job[]>([]), [activeTex, setActiveTex] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [textDlg, setTextDlg] = useState<{ p: Pt; edit?: TextItem } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; fields: Field[]; note?: string; ok: string; run: (v: Record<string, string | number | boolean>) => void } | null>(null);
  const [texPick, setTexPick] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const stageRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null), imgRef = useRef<HTMLInputElement>(null), camRef = useRef<HTMLInputElement>(null), jsonRef = useRef<HTMLInputElement>(null);
  const ctx = useMemo(() => ({ mmPerPx: doc.mmPerPx, unit: opts.unit }), [doc.mmPerPx, opts.unit]);
  const toastTimer = useRef<number>(0);
  const toast = useCallback((m: string) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600); }, []);
  const setTool = useCallback((t: Tool) => { setToolRaw(t); if (t !== 'select') setSel([]); }, []);
  const setStep = (s: Step) => { setStepRaw(s); setTool(s === 'draw' ? 'pen' : s === 'paint' ? 'aiFill' : 'select'); };
  const setUi = (u: 'simple' | 'full') => { setUiRaw(u); writePref('gofg-v3-ui', u); if (u === 'simple') { setPanel(null); setStep('draw'); } else setPanel('objects'); };
  const endTour = () => { setTour(false); writePref('gofg-v3-tour', 'done'); setStep('draw'); };

  useEffect(() => { listLibrary().then(setUserLib).catch(() => {}); }, []);
  useEffect(() => { setHintOn(true); if (tool === 'place' || tool === 'aiFill' || (step === 'parts' && tool === 'select')) return; const t = setTimeout(() => setHintOn(false), 4000); return () => clearTimeout(t); }, [tool, step]);
  // 初回は図面全体が入るように表示
  useEffect(() => { if (!initial.view) requestAnimationFrame(() => fit()); }, []);

  // 自動保存（端末）
  const docRef = useRef(doc); docRef.current = doc;
  useEffect(() => {
    setSaved('saving');
    const t = setTimeout(() => { saveDoc({ ...doc, view }).then(() => setSaved('saved')).catch(() => setSaved('error')); }, 700);
    return () => clearTimeout(t);
  }, [doc]);
  const saveWithThumb = async () => { try { const th = await thumbnail(docRef.current, lib, ctx); await saveDoc({ ...docRef.current, view }, th); setSaved('saved'); } catch { setSaved('error'); } };
  const goHome = async () => { await saveWithThumb(); onHome(); };

  function fit() {
    const el = stageRef.current; if (!el) return;
    const r = el.getBoundingClientRect(), b = contentBox(docRef.current, 80), k = Math.min(r.width / b.w, r.height / b.h, 4);
    setView({ k, r: 0, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k });
  }
  const viewCenter = (): Pt => { const el = stageRef.current!, r = el.getBoundingClientRect(); return toWorld(view, { x: r.width / 2, y: r.height / 2 }); };

  // ---------- 図形の追加 ----------
  const addItem = useCallback((it: Item, kind?: 'draw' | 'text' | 'object') => {
    const k = kind || (it.type === 'obj' ? 'object' : it.type === 'text' ? 'text' : 'draw');
    D.set(d0 => {
      let d = k === 'draw' ? d0 : ensureLayer(d0, k as 'text' | 'object');
      let target = k === 'draw' ? d.layers.find(l => l.id === d.activeLayer) : d.layers.find(l => l.kind === k);
      if (k === 'draw' && (!target || target.kind === 'text' || target.kind === 'object' || target.kind === 'texture')) target = [...d.layers].reverse().find(l => l.kind === 'draw');
      if (!target) { const nl = newLayer('レイヤー 1'); d = { ...d, layers: [d.layers[0], nl, ...d.layers.slice(1)], activeLayer: nl.id }; target = nl; }
      if (target.locked || !target.visible) { setTimeout(() => toast(`「${target!.name}」は${target!.locked ? 'ロック中' : '非表示'}です`), 0); return d0; }
      const id = target.id;
      return { ...d, layers: d.layers.map(l => l.id === id ? { ...l, items: [...l.items, it] } : l) };
    }, it.type === 'stroke' ? '手描き' : it.type === 'obj' ? 'オブジェクトを配置' : it.type === 'text' ? '文字' : '作図');
  }, [D.set, toast]);

  const placeObj = (p: Pt, random: boolean) => {
    const l = lib.find(v => v.id === libSel); if (!l) return toast('一覧から登録オブジェクトを選んでください');
    const k = random ? 0.8 + Math.random() * 0.4 : 1, w = l.w * k, h = l.h * k;
    const it: ObjItem = { id: uid(), type: 'obj', ref: l.id, name: l.name, x: p.x - w / 2, y: p.y - h / 2, w, h, rot: random ? Math.round(Math.random() * 360) : 0, flip: random ? Math.random() < 0.5 : false, color: null };
    addItem(it, 'object');
    // かんたんモードは続けて置けるようにし、調整は「動かす」で行う
    if (!random && !simple) { setToolRaw('select'); setSel([it.id]); }
  };

  const registerFrom = async (items: Item[], name?: string) => {
    const usable = items.filter(i => i.type !== 'texture'); if (!usable.length) return toast('登録できる線やオブジェクトがありません');
    const b = unionBox(usable.map(itemBox)), pad = 2;
    const svg = `<g transform="translate(${-b.x + pad} ${-b.y + pad})">${usable.map(i => itemMarkup(i, ctx)).join('')}</g>`;
    const n = userLib.length + 1;
    const l: LibItem = { id: 'u-' + uid(), name: name || `登録オブジェクト ${n}`, cat: CATEGORIES.includes(cat) ? cat : '未分類', w: b.w + pad * 2, h: b.h + pad * 2, vw: b.w + pad * 2, vh: b.h + pad * 2, svg, tint: false };
    await saveLibItem(l); setUserLib(u => [...u, l]); setLibSel(l.id); setCat(l.cat); setPanel('objects');
    toast(`「${l.name}」を${l.cat}に登録しました`);
  };

  const ensureSel = (p?: Pt) => {
    if (aiSel) return aiSel;
    const b = contentBox(doc, 300), bb = p ? unionBox([b, { x: p.x - 50, y: p.y - 50, w: 100, h: 100 }]) : b;
    const s = new Selection(bb); setAiSel(s); return s;
  };
  // 選択ブラシは選択範囲の入れ物が無いと何も塗れないため、道具を選んだ時点で用意する
  useEffect(() => { if (tool === 'aiBrush' && !aiSel) ensureSel(); }, [tool, aiSel]);

  const applyTexture = (tex: string, texName: string, jobName = texName) => {
    if (!aiSel || !aiSel.count()) return toast('先に「塗りつぶし追加」か「選択ブラシ」で範囲を選んでください');
    const img = aiSel.image([255, 255, 255, 255], true); if (!img) return;
    const it: TextureItem = { id: uid(), type: 'texture', name: texName, mask: img.url, ...img.box, tex, texName, scale: tex.startsWith('data:image/png;base64,') && texName === '色' ? 1 : 1, rot: 0, hue: 0, sat: 100, bright: 100, contrast: 100 };
    const n = doc.layers.filter(l => l.kind === 'texture').length + 1, layer = newLayer(`生成テクスチャ ${n}`, 'texture');
    layer.items = [it];
    D.set(d => { const fi = d.layers.findIndex(l => l.kind === 'fill'), lastTex = d.layers.map(l => l.kind).lastIndexOf('texture'), at = Math.max(fi, lastTex) + 1; const layers = [...d.layers]; layers.splice(at, 0, layer); return { ...d, layers }; }, 'テクスチャを適用');
    const now = new Date();
    setJobs(j => [...j, { id: uid(), name: jobName, thumb: textureSrc(tex), tex, texName, sel: aiSel.count() > 0 ? j.length + 1 : 0, layer: layer.name, time: now.toTimeString().slice(0, 5) }]);
    setActiveTex(it.id); setAiSel(null); toast('テクスチャを適用しました');
  };

  const solidTex = (c: string) => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const g = cv.getContext('2d')!; g.fillStyle = c; g.fillRect(0, 0, 8, 8); return cv.toDataURL('image/png'); };
  const aiKeyword = (k: string) => {
    if (k === '#color') return applyTexture(solidTex(opts.color), '色', 'カラーオブジェクト');
    const map: [RegExp, string][] = [[/青|ブルー|砂利|じゃり/, 'gravel-blue'], [/グレー|灰|砕石/, 'gravel-gray'], [/コンクリ|土間|モルタル/, 'concrete'], [/洗い出し|ベージュ/, 'washed'], [/土|チップ|ウッドチップ|マルチ|茶/, 'soil'], [/芝|草|グリーン/, 'grass'], [/レンガ|煉瓦/, 'brick'], [/タイル|石張/, 'tile'], [/デッキ|木|ウッド/, 'deck'], [/水|池/, 'water']];
    const hit = map.find(([re]) => re.test(k)); const id = hit ? hit[1] : TEXTURES[Math.floor(Math.random() * TEXTURES.length)].id;
    applyTexture('b:' + id, textureName('b:' + id), `「${k}」から生成`);
  };

  const onImageFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('画像ファイルを選んでください');
    const url = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    // 大きい写真は縮小してテクスチャにする
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = url; });
    const s = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    applyTexture(c.toDataURL('image/jpeg', 0.88), f.name.replace(/\.[^.]+$/, ''), f.name.replace(/\.[^.]+$/, ''));
  };

  const onUnderlayFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const src = await readSource(f);
      const run = async (page: number) => {
        const im = await src.render(page); await src.close();
        const c = viewCenter(), w = 1200, h = 1200 * im.height / im.width;
        D.set(d => ({ ...d, underlay: { src: im.src, name: f.name, x: c.x - w / 2, y: c.y - h / 2, w, h, opacity: 0.6, visible: true, locked: true } }), '下絵を読み込み');
        toast('下絵を読み込みました。設定の「縮尺合わせ」で実寸に合わせられます');
      };
      if (src.pages > 1) setPrompt({ title: 'ページを選ぶ', fields: [{ key: 'page', label: `ページ（1〜${src.pages}）`, type: 'number', value: 1 }], ok: '読み込む', run: v => { setPrompt(null); run(Math.min(src.pages, Math.max(1, Math.round(+v.page || 1)))); } });
      else await run(1);
    } catch (err) { toast(err instanceof Error ? err.message : '下絵を読み込めませんでした'); }
  };

  const exportAs = async (kind: 'png' | 'a4' | 'a3' | 'json') => {
    setMenu(null);
    try {
      if (kind === 'json') return await saveFile(new Blob([JSON.stringify({ ...doc, view })], { type: 'application/json' }), safeName(doc.name) + '.garden3.json');
      toast('書き出し中…');
      const blob = kind === 'png' ? await exportImage(doc, lib, ctx) : await exportPDF(doc, lib, ctx, kind === 'a3' ? 'A3' : 'A4');
      const result = await saveFile(blob, `${safeName(doc.name)}.${kind === 'png' ? 'png' : 'pdf'}`); toast(result === 'cancelled' ? '書き出しをキャンセルしました' : '書き出しました');
    } catch (err) { toast(err instanceof Error ? err.message : '書き出しに失敗しました'); }
  };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try { const d = validDoc(JSON.parse(await f.text())); D.reset({ ...d, id: doc.id, name: d.name }); toast('編集データを読み込みました'); setTimeout(fit, 50); }
    catch (err) { toast(err instanceof Error ? err.message : '読み込めませんでした'); }
  };

  // 選択中の図形への操作
  const selItems = () => { const s = new Set(sel); return doc.layers.flatMap(l => l.items.filter(i => s.has(i.id))); };
  const duplicate = (dx = 30, dy = 30, count = 1, dir?: Pt, gap?: number) => {
    const ids = new Set(sel); if (!ids.size) return;
    const fresh: string[] = [];
    D.set(d => ({ ...d, layers: d.layers.map(l => { const src = l.items.filter(i => ids.has(i.id)); if (!src.length) return l; const add: Item[] = []; for (let n = 1; n <= count; n++) { const ox = dir ? dir.x * gap! * n : dx * n, oy = dir ? dir.y * gap! * n : dy * n; for (const i of src) { const c = transformItem(i, p => ({ x: p.x + ox, y: p.y + oy }), 0, 1); const id = uid(); fresh.push(id); add.push({ ...c, id }); } } return { ...l, items: [...l.items, ...add] }; }) }), count > 1 ? '連続コピー' : '複製');
    if (count === 1) setSel(fresh); else toast(`連続コピー ${count} 個複製しました`);
  };
  const deleteSel = () => { if (!sel.length) return; D.set(d => removeItems(d, new Set(sel)), '削除'); setSel([]); };
  const flipSel = () => { const its = selItems(); if (!its.length) return; const b = unionBox(its.map(itemBox)), cx = b.x + b.w / 2; const ids = new Set(sel); D.set(d => ({ ...d, layers: d.layers.map(l => ({ ...l, items: l.items.map(i => ids.has(i.id) ? transformItem(i, p => ({ x: 2 * cx - p.x, y: p.y }), i.type === 'obj' || i.type === 'shape' || i.type === 'text' ? -2 * ((i as ObjItem).rot || 0) : 0, 1, true) : i) })) }), '左右反転'); };
  const orderSel = (up: boolean) => { const ids = new Set(sel); D.set(d => ({ ...d, layers: d.layers.map(l => { if (!l.items.some(i => ids.has(i.id))) return l; const a = l.items.filter(i => ids.has(i.id)), b = l.items.filter(i => !ids.has(i.id)); return { ...l, items: up ? [...b, ...a] : [...a, ...b] }; }) }), up ? '前面へ' : '背面へ'); };
  const contCopy = () => {
    if (!sel.length) return toast('先に図形を選択してください');
    const g = doc.guides.find(x => x.id === activeGuide) || doc.guides.find(x => x.visible && (x.type === 'line' || x.type === 'slope' || x.type === 'ruler'));
    setPrompt({
      title: '連続コピー', ok: '複製', note: 'ガイドにスナップをONにすると、選択中（なければ最初）の直線ガイドの向きに並べます。OFFは画面の横方向です。',
      fields: [{ key: 'mode', label: 'モード', type: 'select', value: '通常', options: ['通常'] }, { key: 'gap', label: '間隔', type: 'number', value: 1000, suffix: 'mm' }, { key: 'count', label: '個数', type: 'number', value: 6 }, { key: 'snap', label: 'ガイドにスナップ', type: 'checkbox', value: !!g }],
      run: v => { setPrompt(null); const gap = Math.max(1, +v.gap || 1000) / doc.mmPerPx, n = Math.min(100, Math.max(1, Math.round(+v.count || 1))); let dir = { x: Math.cos(rad(-view.r)), y: Math.sin(rad(-view.r)) }; if (v.snap && g) { const L = dist(g.a, g.b) || 1; dir = { x: (g.b.x - g.a.x) / L, y: (g.b.y - g.a.y) / L }; } duplicate(0, 0, n, dir, gap); },
    });
  };
  const calib = (a: Pt, b: Pt) => {
    if (!doc.underlay) { setTool('select'); return toast('先に下絵を読み込んでください'); }
    setPrompt({
      title: '縮尺合わせ', ok: '合わせる', note: '下絵上で選んだ2点間の実際の長さを入力します。下絵だけを拡大縮小し、描いた線はそのままです。',
      fields: [{ key: 'mm', label: '2点間の実寸', type: 'number', value: Math.round(dist(a, b) * doc.mmPerPx), suffix: 'mm' }],
      run: v => { setPrompt(null); setTool('pen'); const target = (+v.mm || 0) / doc.mmPerPx, d0 = dist(a, b); if (!target || d0 < 1) return; const k = target / d0; D.set(d => d.underlay ? { ...d, underlay: { ...d.underlay, x: a.x + (d.underlay.x - a.x) * k, y: a.y + (d.underlay.y - a.y) * k, w: d.underlay.w * k, h: d.underlay.h * k } } : d, '縮尺合わせ'); toast('下絵の縮尺を合わせました'); },
    });
  };

  const api: CanvasApi = {
    live: D.live, end: D.end, set: D.set, addItem, toast,
    text: (p, editId) => { const ex = editId ? findItem(doc, editId)?.item as TextItem | undefined : undefined; setTextDlg({ p, edit: ex }); },
    place: placeObj,
    lasso: (poly) => { const items: Item[] = []; for (const l of doc.layers) if (l.visible && (l.id === doc.activeLayer || l.kind === 'object' || l.kind === 'draw')) for (const it of l.items) { if (it.type === 'texture') continue; const b = itemBox(it); if (pointInPoly({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly)) items.push(it); } registerFrom(items); },
    fill: async p => { const s = ensureSel(p); try { const ok = await fillAt(doc, lib, ctx, s, p); if (ok) { setAiVer(v => v + 1); toast(simple ? '塗る場所を選びました。下から素材を選んでください' : 'AIツール: 選択範囲を追加しました'); } else toast('閉じた輪郭の内側をタップしてください（線のすき間をふさぐと選べます）'); } catch { toast('範囲を判定できませんでした'); } },
    aiBrushed: () => setAiVer(v => v + 1),
    calib, selectGuide: id => { setActiveGuide(id); },
  };

  const editorApi: EditorApi = {
    doc, set: D.set, live: D.live, end: D.end, tool, setTool, toast, close: () => setPanel(null),
    lib, libSel, setLibSel, cat, setCat, sel, setSel,
    removeLib: async id => { await deleteLibItem(id); setUserLib(u => u.filter(l => l.id !== id)); setLibSel(null); },
    updateLib: async l => { setUserLib(u => u.map(x => x.id === l.id ? l : x)); await saveLibItem(l); },
    registerItem: id => { const f = findItem(doc, id); if (f) registerFrom([f.item], f.item.type === 'obj' ? f.item.name + '（登録）' : undefined); },
    activeGuide, setActiveGuide, unit: opts.unit,
    addGuide: (t: GuideType) => { const c = viewCenter(), span = 380 / view.k; const g = { ...guideDefaults(t, c, span), name: `ガイド` }; if (t !== 'line') g.name = guideDefaults(t, c, span).name; D.set(d => ({ ...d, guides: [...d.guides, g] }), 'ガイド線を追加'); setActiveGuide(g.id); },
    aiSel, aiCount: aiSel && aiVer >= 0 ? aiSel.count() : 0, clearAi: () => { aiSel?.clear(); setAiSel(null); }, genKind, setGenKind, jobs,
    applyJob: j => applyTexture(j.tex, j.texName, j.name),
    pickImage: rect => setMenu({ id: 'apply', rect }),
    activeTex, setActiveTex, recallSelection: async t => { setAiSel(await Selection.fromImage(t.mask, { x: t.x, y: t.y, w: t.w, h: t.h })); setAiVer(v => v + 1); toast('選択範囲を呼び出しました'); },
    saveTexture: async t => { const svg = docSVG({ ...doc, underlay: undefined, layers: [{ id: 'x', name: 'x', kind: 'texture', visible: true, locked: false, opacity: 1, items: [t] }] }, lib, ctx, { x: t.x, y: t.y, w: t.w, h: t.h }, { pxW: t.w * 2, pxH: t.h * 2 }); const c = await rasterize(svg, t.w * 2, t.h * 2); c.toBlob(b => { if (b) void saveFile(b, safeName(t.texName) + '-texture.png').catch(() => toast('テクスチャを書き出せませんでした')); }); },
    aiKeyword, openPanel: p => setPanel(p as PanelId),
    history: D.history, restore: D.restore,
    video: id => setHelp({ tab: 'full', open: id }),
    editText: id => { const f = findItem(doc, id); if (f && f.item.type === 'text') setTextDlg({ p: { x: f.item.x, y: f.item.y }, edit: f.item }); },
  };

  // キーボード
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? D.redo() : D.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); D.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); deleteSel(); }
      const keys: Record<string, Tool> = { v: 'select', p: 'pen', e: 'eraser', t: 'text', l: 'line', m: 'dim', o: 'circle', r: 'shape' };
      if (keys[e.key]) setTool(keys[e.key]);
      if (e.key === 'Escape') setSel([]);
      if (e.key === '0') fit();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const zoomRot = (dr: number) => { const el = stageRef.current!, r = el.getBoundingClientRect(), s = { x: r.width / 2, y: r.height / 2 }, w = toWorld(view, s), nr = view.r + dr, q = { x: w.x * view.k, y: w.y * view.k }, a = rad(nr); setView({ ...view, r: nr, x: s.x - (q.x * Math.cos(a) - q.y * Math.sin(a)), y: s.y - (q.x * Math.sin(a) + q.y * Math.cos(a)) }); };
  const rotLabel = ((Math.round(view.r) % 360) + 360) % 360;
  const T = (t: Tool) => tool === t ? ' on' : '';
  // 位置はクリックの時点で読む（setState の中では currentTarget が null になり画面ごと落ちる）
  const openMenu = (id: string) => (e: React.MouseEvent) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu(m => m?.id === id ? null : { id, rect }); };
  const panelBtn = (p: PanelId) => () => setPanel(cur => cur === p ? null : p);
  const P = (p: PanelId) => panel === p ? ' on' : '';
  const fs = () => { if (isNativeApp()) return toast('アプリは全画面で表示しています'); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('全画面にできませんでした')); };
  const aiCount = aiSel && aiVer >= 0 ? aiSel.count() : 0;
  const NEED_AREA = '先に、塗りたい場所（線で囲まれた所）をタップしてください';
  const hintText = simple ? simpleHint(tool, aiCount, lib.find(l => l.id === libSel)?.name, step) : '';
  const tourSteps: TourStep[] = [
    { target: 'dock', title: 'この4つだけ覚えればOK', text: '左から順に使うと、外構図が1枚できあがります。', demo: 'flow', before: () => setStep('draw') },
    { target: 'dockall', title: '① 描く', text: 'ペンを選んで、指かPencilでなぞるだけ。', demo: 'draw', before: () => setStep('draw') },
    { target: 'dockall', title: '② 部品', text: '車や木を選んで、置きたい場所をタップ。', demo: 'parts', before: () => setStep('parts') },
    { target: 'dockall', title: '③ 塗る', text: '線で囲まれた場所をタップ → 砂利や芝を選ぶ。', demo: 'paint', before: () => setStep('paint') },
    { target: 'dockall', title: '④ 出力', text: 'PDFにして、そのままお客様へ。', demo: 'out', before: () => setStep('out') },
    { target: 'undo', title: '間違えたら「戻す」', text: '1回押すごとに1つ前に戻ります。', demo: 'undo', before: () => setStep('draw') },
    { target: 'stage', title: '画面の動かし方', text: '2本指で広げると拡大、ずらすと移動。', demo: 'pinch' },
    { target: 'help', title: '迷ったらここ', text: '「使い方」から、いつでも動きで見返せます。' },
  ];
  const selBox = sel.length ? (() => { const its = selItems(); return its.length ? unionBox(its.map(itemBox)) : null; })() : null;

  return (
    <div className={'v3' + (simple ? ' v3-simple' : '')}>
      <input ref={fileRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e => { onUnderlayFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={imgRef} type="file" hidden accept="image/*" onChange={e => { onImageFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={e => { onImageFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={jsonRef} type="file" hidden accept="application/json,.json" onChange={e => { importJson(e.target.files?.[0]); e.target.value = ''; }} />

      {simple ? <SimpleTop name={doc.name} saved={saved} canUndo={D.canUndo} canRedo={D.canRedo} undo={D.undo} redo={D.redo} fit={fit} home={goHome} help={() => setHelp({ tab: 'simple' })} toFull={() => setUi('full')} /> : <header className="v3-top">
        <div className="v3-bar r1">
          <button className="v3-tb" aria-label="下絵を読み込む" title="下絵（PDF・画像）を読み込む" onClick={() => fileRef.current?.click()}><ImageIcon size={18} /></button>
          <button className="v3-tb" aria-label="書き出し" title="書き出し" onClick={openMenu('export')}><Download size={18} /></button>
          <i className="sep" />
          <button className={'v3-tb' + T('pen')} aria-label="ペン" title="ペン" onClick={() => setTool('pen')}><PenTool size={18} /></button>
          <button className="v3-tb dd" aria-label="ペンの種類" onClick={openMenu('pen')}><ChevronDown size={15} /></button>
          <button className={'v3-tb' + T('eraser')} aria-label="消しゴム" title="消しゴム" onClick={() => setTool('eraser')}><Eraser size={18} /></button>
          <button className={'v3-tb' + T('text')} aria-label="テキスト" title="テキスト" onClick={() => setTool('text')}><Type size={18} /></button>
          <button className={'v3-tb' + T('dim')} aria-label="寸法" title="寸法線" onClick={() => setTool('dim')}><MoveHorizontal size={18} /></button>
          <button className={'v3-tb' + T('circle')} aria-label="円" title="円" onClick={() => setTool('circle')}><Circle size={17} /></button>
          <button className={'v3-tb' + T('line')} aria-label="直線" title={opts.lineKind === 'polyline' ? '折れ線' : opts.lineKind === 'arrow' ? '矢印' : '直線'} onClick={() => setTool('line')}><Slash size={17} /></button>
          <button className="v3-tb dd" aria-label="線の種類" onClick={openMenu('line')}><ChevronDown size={15} /></button>
          <button className={'v3-tb' + T('shape')} aria-label="図形" title={opts.shapeKind === 'rect' ? '四角形' : '楕円'} onClick={() => setTool('shape')}><SquareX size={17} /></button>
          <button className="v3-tb dd" aria-label="図形の種類" onClick={openMenu('shape')}><ChevronDown size={15} /></button>
          <button className={'v3-tb' + (showGrid ? ' on' : '')} aria-label="グリッド" title="グリッド表示" onClick={() => setShowGrid(v => !v)}><Grid3x3 size={18} /></button>
          <button className="v3-tb" aria-label="全画面" title="全画面" onClick={fs}><Maximize size={17} /></button>
          <button className={'v3-tb' + T('curve')} aria-label="曲線" title="曲線" onClick={() => setTool('curve')}><Spline size={17} /></button>
          <i className="sep" />
          <div className="v3-width"><span className="dotmin" /><input type="range" min={1} max={30} value={opts.width} onChange={e => setOpts({ ...opts, width: +e.target.value })} aria-label="線の太さ" /><em>{opts.width}</em></div>
          <div className="v3-colors">
            <button className={'clear' + (opts.color === '#ffffff' ? ' on' : '')} aria-label="白（消し色）" onClick={() => setOpts({ ...opts, color: '#ffffff' })} />
            {PALETTE.map(c => <button key={c} aria-label={c} className={opts.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setOpts({ ...opts, color: c })} />)}
          </div>
          <select className="v3-sel" value={opts.measure} onChange={e => setOpts({ ...opts, measure: e.target.value })} aria-label="距離表示"><option value="line">直線距離</option><option value="off">表示なし</option></select>
          <select className="v3-sel" value={opts.unit} onChange={e => setOpts({ ...opts, unit: e.target.value })} aria-label="単位"><option>mm</option><option>cm</option><option>m</option></select>
        </div>
        <div className="v3-bar r2">
          <button className="v3-tb sm" aria-label="グリッド間隔" title="グリッド・連続コピーの間隔" onClick={() => setShowGrid(v => !v)}><AlignJustify size={16} /></button>
          <input className="v3-num" type="number" value={gridMm} min={10} step={10} onChange={e => setGridMm(Math.max(10, +e.target.value || 100))} aria-label="グリッド間隔mm" /><span className="unit">mm</span>
          <i className="sep" />
          <button className="v3-mono" title="縮尺を切り替え" onClick={() => D.set(d => ({ ...d, mmPerPx: d.mmPerPx === 10 ? 20 : d.mmPerPx === 20 ? 5 : 10 }), '縮尺を変更')}>縮尺: 1/{doc.mmPerPx * 10} (1px = {doc.mmPerPx} mm)</button>
          <i className="sep" />
          <button className={'v3-tb sm' + (doc.underlay?.locked !== false ? ' on' : '')} aria-label="下絵のロック" title={doc.underlay ? (doc.underlay.locked ? '下絵はロック中（押すと移動できます）' : '下絵を移動できます') : '下絵なし'} onClick={() => doc.underlay ? D.set(d => ({ ...d, underlay: d.underlay && { ...d.underlay, locked: !d.underlay.locked } }), '下絵ロック') : toast('下絵はまだありません')}>{doc.underlay?.locked === false ? <LockOpen size={16} /> : <Lock size={16} />}</button>
          <button className="v3-tb sm" aria-label="表示を全体に合わせる" title="全体表示" onClick={fit}><RotateCw size={16} /></button>
          <button className="v3-tb sm" aria-label="連続コピー" title="連続コピー" onClick={contCopy} disabled={!sel.length}><Copy size={16} /></button>
        </div>
        <div className="v3-bar r3">
          <button className="sx-modebtn" onClick={() => setUi('simple')}>かんたんモード</button>
          <button className="sx-modebtn" onClick={() => setHelp({ tab: 'full' })}><CircleHelp size={15} />使い方</button>
          <button className="v3-tb sm" aria-label="案件一覧" title="案件一覧へ" onClick={goHome}><House size={16} /></button>
          <span className="v3-mono status">{saved === 'saving' ? '保存中…' : saved === 'error' ? '保存エラー' : '端末に保存済み'}</span>
          <button className="v3-tb sm" aria-label="上書き保存" title="上書き保存" onClick={() => saveWithThumb().then(() => toast('端末に保存しました'))}><Save size={16} /></button>
          <button className="v3-tb sm on" aria-label="別名で保存" title="別名で保存" onClick={() => setPrompt({ title: '別名で保存', fields: [{ key: 'name', label: '名前', value: doc.name + ' 別案' }], ok: '保存', run: async v => { setPrompt(null); const nd = { ...doc, id: uid(), name: String(v.name || doc.name), updatedAt: new Date().toISOString() }; await saveDoc(nd, await thumbnail(nd, lib, ctx)); D.reset(nd); toast('別案として保存しました'); } })}><SaveAll size={16} /></button>
          <button className="v3-tb sm" aria-label="開く" title="案件一覧から開く" onClick={goHome}><FolderOpen size={16} /></button>
          <button className="v3-tb sm" aria-label="編集データを読み込む" title="編集データ(.json)を読み込む" onClick={() => jsonRef.current?.click()}><ArrowDownToLine size={16} /></button>
          <button className="v3-tb sm" aria-label="編集データを書き出す" title="編集データ(.json)を書き出す" onClick={() => exportAs('json')}><ArrowUpFromLine size={16} /></button>
          <button className="v3-tb sm" aria-label="クラウド" title="クラウド同期（公開版では停止中）" onClick={() => toast('開発版はこの端末に保存します。端末間は編集データで引き継ぎます')}><CloudUpload size={16} /></button>
          <button className="v3-tb sm on" aria-label="利用者" title="利用者" onClick={() => toast('この端末で利用中（ログインなし）')}><User size={16} /></button>
          <button className="v3-tb sm" aria-label="ログアウト（一覧へ）" title="案件一覧へ戻る" onClick={goHome}><LogOut size={16} /></button>
          <i className="sep" />
          <button className={'v3-tb sm' + (panel ? ' on' : '')} aria-label="パネル" title="右パネルの表示" onClick={() => setPanel(p => p ? null : 'objects')}><PanelRight size={16} /></button>
          <button className={'v3-tb sm' + P('layers')} aria-label="レイヤー" title="レイヤー" onClick={panelBtn('layers')}><Layers size={16} /></button>
          <button className={'v3-tb sm' + P('objects')} aria-label="オブジェクト" title="オブジェクト" onClick={panelBtn('objects')}><LayoutGrid size={16} /></button>
          <button className={'v3-tb sm' + P('guides')} aria-label="ガイド線" title="ガイド線" onClick={panelBtn('guides')}><Ruler size={16} /></button>
          <button className={'v3-tb sm' + P('texts')} aria-label="テキスト一覧" title="テキスト一覧" onClick={panelBtn('texts')}><FileText size={16} /></button>
          <button className={'v3-tb sm' + P('ai')} aria-label="AIツール" title="AIツール（選択範囲・テクスチャ）" onClick={panelBtn('ai')}><Sparkles size={16} /></button>
          <button className="v3-tb sm" aria-label="左に回転" title="表示を左に15°回転" onClick={() => zoomRot(-15)}><RotateCcw size={16} /></button>
          <button className="v3-tb sm" aria-label="右に回転" title="表示を右に15°回転" onClick={() => zoomRot(15)}><RotateCw size={16} /></button>
          <button className={'v3-tb sm' + P('history')} aria-label="履歴" title="履歴" onClick={panelBtn('history')}><History size={16} /></button>
          <button className="v3-mono" title="回転を0°に戻す" onClick={() => zoomRot(-view.r)}>回転: {rotLabel}°</button>
          <button className={'v3-tb sm' + P('settings')} aria-label="設定" title="設定" onClick={panelBtn('settings')}><Settings size={16} /></button>
        </div>
      </header>}

      <div className="v3-body">
        <div className="v3-stage" ref={stageRef} data-tour="stage">
          <Canvas doc={doc} lib={lib} ctx={ctx} view={view} setView={setView} tool={tool} opts={opts} guideSnap={guideSnap} fingerMode={fingerMode} penSeen={penSeen} onPen={() => { setPenSeen(true); writePref('gofg-v3-pen-seen', '1'); if (fingerMode === 'auto') toast('Apple Pencilを検出しました。指1本は画面移動になります'); }} showGrid={showGrid} gridMm={gridMm}
            guideEdit={panel === 'guides'} activeGuide={activeGuide} sel={sel} setSel={setSel} api={api} aiSel={aiSel} aiVersion={aiVer} aiRadius={Math.max(4, opts.width * 4)} />
          {!simple && <nav className="v3-left" aria-label="よく使う操作">
            <button className="v3-fb" aria-label="やり直す" title="やり直す" disabled={!D.canRedo} onClick={D.redo}><Redo2 size={18} /></button>
            <button className={'v3-fb' + T('select')} aria-label="選択" title="選択（囲んで複数選択）" onClick={() => setTool('select')}><SquareDashedMousePointer size={18} /></button>
            <button className={'v3-fb' + T('pen')} aria-label="ペン" title="ペン" onClick={() => setTool('pen')}><PenTool size={18} /></button>
            <button className={'v3-fb' + T('eraser')} aria-label="消しゴム" title="消しゴム" onClick={() => setTool('eraser')}><Eraser size={18} /></button>
            <button className={'v3-fb' + (guideSnap ? ' on' : '')} aria-label="ガイド吸着" title={guideSnap ? 'ガイド吸着 ON' : 'ガイド吸着 OFF'} onClick={() => { setGuideSnap(v => !v); toast(guideSnap ? 'ガイド吸着 OFF' : 'ガイド吸着 ON'); }}><Magnet size={18} /></button>
            <button className={'v3-fb' + P('layers')} aria-label="レイヤー" title="レイヤー" onClick={panelBtn('layers')}><AlignJustify size={18} /></button>
            <button className={'v3-fb' + T('aiFill')} aria-label="塗りつぶし範囲" title="閉じた範囲を選ぶ（AIツール）" onClick={() => { setTool('aiFill'); setPanel('ai'); }}><Sparkles size={18} /></button>
            <button className={'v3-fb' + P('guides')} aria-label="ガイド線" title="ガイド線" onClick={panelBtn('guides')}><Ruler size={18} /></button>
            <span className="gap" />
            <button className="v3-fb" aria-label="元に戻す" title="元に戻す" disabled={!D.canUndo} onClick={D.undo}><Undo2 size={18} /></button>
          </nav>}
          {selBox && tool === 'select' && (
            <div className="v3-selbar">
              <button onClick={() => duplicate()} title="複製"><Copy size={15} />複製</button>
              {!simple && <button onClick={contCopy} title="連続コピー">連続</button>}
              <button onClick={flipSel} title="左右反転"><FlipHorizontal2 size={15} />{simple && '反転'}</button>
              {!simple && <>
                <button onClick={() => orderSel(true)} title="前面へ"><ArrowUp size={15} /></button>
                <button onClick={() => orderSel(false)} title="背面へ"><ArrowDown size={15} /></button>
                <button onClick={() => registerFrom(selItems())} title="オブジェクトとして登録"><PackagePlus size={15} />登録</button>
              </>}
              <button onClick={deleteSel} className="danger" title="削除"><Trash2 size={15} />{simple && '削除'}</button>
              <button onClick={() => setSel([])} title="選択解除"><X size={15} />{simple && '解除'}</button>
            </div>
          )}
          {simple && hintOn && hintText && !(selBox && tool === 'select') && <div className="sx-hint">{hintText}</div>}
          {tool === 'calib' && <div className="v3-hint">下絵上で、長さが分かる2点を順に押してください</div>}
          {!simple && tool === 'register' && <div className="v3-hint">登録したい手描き・オブジェクトを囲んでください</div>}
          {!simple && (tool === 'place' || tool === 'random') && <div className="v3-hint">{tool === 'random' ? 'ランダム配置' : '配置'}：{lib.find(l => l.id === libSel)?.name} — 図面をタップ</div>}
          {toastMsg && <div className="v3-toast">{toastMsg}</div>}
        </div>
        {panel && !simple && (
          <aside className="v3-side">
            {panel === 'objects' && <ObjectPanel e={editorApi} />}
            {panel === 'layers' && <LayerPanel e={editorApi} />}
            {panel === 'guides' && <GuidePanel e={editorApi} />}
            {panel === 'ai' && <AIPanel e={editorApi} />}
            {panel === 'history' && <HistoryPanel e={editorApi} />}
            {panel === 'texts' && <TextsPanel e={editorApi} />}
            {panel === 'settings' && settingsPanel()}
          </aside>
        )}
      </div>
      {simple && <SimpleDock step={step} setStep={setStep} tool={tool} setTool={setTool} opts={opts} setOpts={setOpts}
        lib={lib} libSel={libSel} setLibSel={setLibSel} cat={cat} setCat={setCat}
        aiCount={aiCount} clearAi={editorApi.clearAi} paint={(t, n) => aiCount ? applyTexture(t, n) : toast(NEED_AREA)} paintColor={() => aiCount ? aiKeyword('#color') : toast(NEED_AREA)}
        exportAs={exportAs} />}

      {menu?.id === 'pen' && <Menu anchor={menu.rect} onClose={() => setMenu(null)}>
        {([['pen', 'ペン', '●'], ['marker', 'マーカー', '▬'], ['matte', 'マット塗り', '■'], ['pencil', '鉛筆', '✎']] as const).map(([b, l, ic]) => <button key={b} className={'mi' + (opts.brush === b ? ' on' : '')} onClick={() => { setOpts({ ...opts, brush: b }); setTool('pen'); setMenu(null); }}><span className="ic">{ic}</span>{l}</button>)}
        <hr /><p className="mh">ペン線種設定</p>
        <label className="mrow"><span>線種</span><select value={opts.dash} onChange={e => setOpts({ ...opts, dash: e.target.value as ToolOpts['dash'] })}><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label>
        <p className="v3-note">筆圧はApple Pencilの強さで変わります。マウスでは速さで太さが変わります。</p>
      </Menu>}
      {menu?.id === 'line' && <Menu anchor={menu.rect} onClose={() => setMenu(null)}>
        {([['line', '直線'], ['polyline', '折れ線（ダブルタップで終了）'], ['arrow', '矢印']] as const).map(([k, l]) => <button key={k} className={'mi' + (opts.lineKind === k ? ' on' : '')} onClick={() => { setOpts({ ...opts, lineKind: k }); setTool('line'); setMenu(null); }}>{l}</button>)}
      </Menu>}
      {menu?.id === 'shape' && <Menu anchor={menu.rect} onClose={() => setMenu(null)}>
        {([['rect', '四角形'], ['ellipse', '楕円']] as const).map(([k, l]) => <button key={k} className={'mi' + (opts.shapeKind === k ? ' on' : '')} onClick={() => { setOpts({ ...opts, shapeKind: k }); setTool('shape'); setMenu(null); }}>{l}</button>)}
      </Menu>}
      {menu?.id === 'export' && <Menu anchor={menu.rect} onClose={() => setMenu(null)}>
        <button className="mi" onClick={() => exportAs('png')}>PNG画像</button>
        <button className="mi" onClick={() => exportAs('a4')}>PDF（A4横）</button>
        <button className="mi" onClick={() => exportAs('a3')}>PDF（A3横）</button>
        <hr /><button className="mi" onClick={() => exportAs('json')}>編集データ（.json）</button>
      </Menu>}
      {menu?.id === 'apply' && <Menu anchor={menu.rect} onClose={() => setMenu(null)}>
        <button className="mi" onClick={() => { setMenu(null); setTexPick(true); }}><LayoutGrid size={15} />素材ライブラリ</button>
        <button className="mi" onClick={() => { setMenu(null); imgRef.current?.click(); }}><Images size={15} />写真ライブラリ</button>
        <button className="mi" onClick={() => { setMenu(null); camRef.current?.click(); }}><Camera size={15} />写真を撮る</button>
        <button className="mi" onClick={() => { setMenu(null); imgRef.current?.click(); }}><Folder size={15} />ファイルを選択</button>
      </Menu>}
      {texPick && <Modal title="素材ライブラリ" onClose={() => setTexPick(false)} wide><TexturePicker onPick={(t, n) => { setTexPick(false); applyTexture(t, n); }} /><div className="v3-actions"><span className="sp" /><button className="v3-btn" onClick={() => setTexPick(false)}>閉じる</button></div></Modal>}
      {textDlg && <TextDialog initial={textDlg.edit ? { text: textDlg.edit.text, color: textDlg.edit.color, bg: textDlg.edit.bg, border: textDlg.edit.border } : { text: '', color: opts.color === '#ffffff' ? PALETTE[0] : opts.color, bg: null, border: null }}
        onCancel={() => setTextDlg(null)}
        onDelete={textDlg.edit ? () => { D.set(d => removeItems(d, new Set([textDlg.edit!.id])), '文字を削除'); setTextDlg(null); } : undefined}
        onOk={(v: TextValue) => { const ed = textDlg.edit; if (ed) D.set(d => updateItem(d, ed.id, it => ({ ...it, ...v }) as Item), '文字を編集'); else addItem({ id: uid(), type: 'text', x: textDlg.p.x, y: textDlg.p.y, text: v.text, size: Math.round(24 / view.k), color: v.color, bg: v.bg, border: v.border, rot: -view.r }); setTextDlg(null); }} />}
      {tour && simple && <Tour steps={tourSteps} onDone={endTour} />}
      {help && <HelpSheet items={HELP} full={GUIDE_FULL} tab={help.tab} open={help.open} onClose={() => setHelp(null)} onTour={() => { setHelp(null); setUi('simple'); setTour(true); }} />}
      {prompt && <PromptDialog title={prompt.title} fields={prompt.fields} note={prompt.note} okLabel={prompt.ok} onOk={prompt.run} onCancel={() => { setPrompt(null); if (tool === 'calib') setTool('select'); }} />}
    </div>
  );

  function settingsPanel() {
    const u = doc.underlay;
    return (
      <div className="v3-panel">
        <div className="v3-phead"><b>設定</b><span className="sp" /><button className="sx-vbtn" onClick={() => setHelp({ tab: 'full', open: 'f-underlay' })}><Play size={12} />動画</button><button className="v3-ib" aria-label="閉じる" onClick={() => setPanel(null)}><X size={16} /></button></div>
        <section className="v3-card"><h4>案件</h4>
          <label className="v3-kv"><span>名前</span><input defaultValue={doc.name} onBlur={e => { const v = e.target.value.trim(); if (v && v !== doc.name) D.set(d => ({ ...d, name: v }), '名前を変更'); }} /></label>
        </section>
        <section className="v3-card"><h4>下絵</h4>
          {!u && <p className="v3-note">PDF・画像の配置図を読み込み、その上に描けます。</p>}
          <button className="v3-btn" onClick={() => fileRef.current?.click()}>{u ? '下絵を差し替える' : '下絵を読み込む'}</button>
          {u && <>
            <label className="v3-chk"><input type="checkbox" checked={u.visible} onChange={e => D.set(d => ({ ...d, underlay: { ...d.underlay!, visible: e.target.checked } }), '下絵の表示')} />表示</label>
            <label className="v3-chk"><input type="checkbox" checked={u.locked} onChange={e => D.set(d => ({ ...d, underlay: { ...d.underlay!, locked: e.target.checked } }), '下絵ロック')} />ロック（外すと選択ツールでドラッグ移動）</label>
            <div className="v3-slider"><span>濃さ</span><input type="range" min={5} max={100} value={Math.round(u.opacity * 100)} onChange={e => D.live(d => ({ ...d, underlay: { ...d.underlay!, opacity: +e.target.value / 100 } }))} onPointerUp={() => D.end('下絵の濃さ')} /><em>{Math.round(u.opacity * 100)}%</em></div>
            <div className="v3-row wrap"><button className="v3-btn" onClick={() => { setTool('calib'); toast('長さが分かる2点を順に押してください'); }}>縮尺合わせ（2点）</button><button className="v3-btn danger" onClick={() => D.set(d => ({ ...d, underlay: undefined }), '下絵を削除')}>下絵を外す</button></div>
          </>}
        </section>
        <section className="v3-card"><h4>入力</h4>
          <div className="v3-chk v3-finger">指1本の操作
            <select className="v3-sel" value={fingerMode} onChange={e => setFingerMode(e.target.value as FingerMode)}>
              <option value="auto">自動</option><option value="draw">描く</option><option value="pan">画面移動</option>
            </select>
          </div>
          <p className="v3-note">{fingerMode === 'auto' ? (penSeen ? 'Apple Pencil検出済み：Pencilで描画、指1本で画面移動。' : 'Pencilを使うまでは指でも描けます。Pencilを使うと指1本は画面移動に切り替わります。') : fingerMode === 'draw' ? '指でもPencilでも描きます。' : '指1本は画面移動、描画はPencilのみ。'}</p>
          <label className="v3-chk"><input type="checkbox" checked={guideSnap} onChange={e => setGuideSnap(e.target.checked)} />ガイド吸着（ガイドと同じ向きの線を平行にそろえる）</label>
          <p className="v3-note">2本指で移動・拡大縮小・回転。マウスはホイールで拡大縮小、右ドラッグかSpace＋ドラッグで移動。Shiftで15°単位。</p>
        </section>
        <section className="v3-card"><h4>書き出し</h4>
          <div className="v3-row wrap"><button className="v3-btn" onClick={() => exportAs('png')}>PNG</button><button className="v3-btn" onClick={() => exportAs('a4')}>PDF A4</button><button className="v3-btn" onClick={() => exportAs('a3')}>PDF A3</button><button className="v3-btn" onClick={() => exportAs('json')}>編集データ</button></div>
        </section>
        <section className="v3-card"><h4>このアプリ</h4><p className="v3-note">{VERSION}　保存先：この端末（クラウド同期は停止中。端末間は編集データで引き継ぎ）</p></section>
        {!isNativeApp() && <section className="v3-card"><h4>旧バージョン</h4><p className="v3-note">v0.2（下絵の原本保管・クラウド同期つき）は <a href="?v=2">こちら</a> から開けます。</p></section>}
      </div>
    );
  }
}


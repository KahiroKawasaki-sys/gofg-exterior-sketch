// 立面図の取り込み：用紙の絵の上で、東・南・西・北の4面を枠で囲んで割り当てる。縮尺と用紙サイズから実寸を決める
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { type ElevFace, type Elevation } from './types';
import { FACE_LABEL, DEFAULT_ORDER, quadrants, darkBounds, cropToElevation, mmPerPxFromPaper, guessPaper, type Rect, type Crop } from './elevation';

const PAPERS = [['A3横', 420, 297], ['A3縦', 297, 420], ['A4横', 297, 210], ['A4縦', 210, 297], ['A2横', 594, 420]] as const;
type Sheet = { src: string; width: number; height: number };

export function ElevationDialog({ sheet, onSave, onCancel }: { sheet: Sheet; onSave: (e: Partial<Record<ElevFace, Elevation>>) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [paper, setPaper] = useState(() => guessPaper(sheet.width, sheet.height).name);
  const [denom, setDenom] = useState(100);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  // 絵を読み、4等分→濃い部分に縮めた枠を初期値にする
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      setImg(im);
      try {
        const c = document.createElement('canvas'); const k = Math.min(1, 1600 / Math.max(im.width, im.height));
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext('2d')!; g.drawImage(im, 0, 0, c.width, c.height);
        const data = g.getImageData(0, 0, c.width, c.height);
        const qs = quadrants(c.width, c.height);
        setCrops(qs.map((q, i) => { const b = darkBounds(data, q) || q; return { face: DEFAULT_ORDER[i], rect: { x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k } }; }));
        c.width = c.height = 0;
      } catch { setCrops(quadrants(im.width, im.height).map((q, i) => ({ face: DEFAULT_ORDER[i], rect: q }))); }
    };
    im.onerror = () => setErr('立面図の絵を読めませんでした');
    im.src = sheet.src;
  }, [sheet.src]);
  useEffect(() => {
    const el = box.current; if (!el || !img) return;
    const f = () => setFit(Math.min(el.clientWidth / img.width, (window.innerHeight * 0.58) / img.height));
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, [img]);

  // 枠の移動・大きさ変え（指でもマウスでも）
  const drag = useRef<{ i: number; mode: 'move' | 'size'; sx: number; sy: number; r: Rect } | null>(null);
  const onDown = (e: React.PointerEvent, i: number, mode: 'move' | 'size') => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i, mode, sx: e.clientX, sy: e.clientY, r: crops[i].rect }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !img) return;
    const dx = (e.clientX - d.sx) / fit, dy = (e.clientY - d.sy) / fit;
    setCrops(cs => cs.map((c, i) => i !== d.i ? c : { ...c, rect: d.mode === 'move'
      ? { ...d.r, x: Math.max(0, Math.min(img.width - d.r.w, d.r.x + dx)), y: Math.max(0, Math.min(img.height - d.r.h, d.r.y + dy)) }
      : { ...d.r, w: Math.max(40, Math.min(img.width - d.r.x, d.r.w + dx)), h: Math.max(40, Math.min(img.height - d.r.y, d.r.h + dy)) } }));
  };
  const onUp = () => { drag.current = null; };

  const used = useMemo(() => crops.filter(c => c.face).map(c => c.face), [crops]);
  const save = async () => {
    if (!img) return;
    const p = PAPERS.find(x => x[0] === paper) || PAPERS[0];
    const mmPerPx = mmPerPxFromPaper(p[1], img.width, denom);
    setBusy(true); setErr('');
    try {
      const out: Partial<Record<ElevFace, Elevation>> = {};
      for (const c of crops) if (c.face && !out[c.face]) out[c.face] = cropToElevation(img, c.rect, mmPerPx);
      if (!Object.keys(out).length) { setErr('少なくとも1面を割り当ててください'); return; }
      onSave(out);
    } catch { setErr('立面図を切り出せませんでした'); }
    finally { setBusy(false); }
  };
  const setFace = (i: number, face: ElevFace | '') => setCrops(cs => cs.map((c, k) => k === i ? { ...c, face: face as ElevFace } : c));
  const p = PAPERS.find(x => x[0] === paper) || PAPERS[0];
  const realW = img ? Math.round(mmPerPxFromPaper(p[1], img.width, denom) * (crops[0]?.rect.w || 0) / 1000 * 10) / 10 : 0;

  return (
    <div className="v3-modal-bg" onPointerDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="v3-elev" role="dialog" aria-label="立面図の取り込み">
        <div className="v3-elev-head"><b>立面図を取り込む</b><span className="v3-note">枠を動かして、東・南・西・北の絵を囲んでください。枠の右下で大きさを変えられます</span><span className="sp" /><button className="v3-ib" aria-label="閉じる" onClick={onCancel}><X size={18} /></button></div>
        <div className="v3-elev-sheet" ref={box} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {img && <div className="v3-elev-canvas" style={{ width: img.width * fit, height: img.height * fit, backgroundImage: `url(${sheet.src})` }}>
            {crops.map((c, i) => (
              <div key={i} className={'v3-elev-crop' + (c.face ? '' : ' off')} style={{ left: c.rect.x * fit, top: c.rect.y * fit, width: c.rect.w * fit, height: c.rect.h * fit }} onPointerDown={e => onDown(e, i, 'move')}>
                <select value={c.face || ''} onChange={e => setFace(i, e.target.value as ElevFace | '')} onPointerDown={e => e.stopPropagation()} aria-label={`枠${i + 1}の面`}>
                  <option value="">使わない</option>
                  {(['N', 'E', 'S', 'W'] as ElevFace[]).map(f => <option key={f} value={f}>{FACE_LABEL[f]}{used.includes(f) && c.face !== f ? '（他の枠）' : ''}</option>)}
                </select>
                <i className="hd" onPointerDown={e => onDown(e, i, 'size')} aria-hidden />
              </div>
            ))}
          </div>}
          {!img && !err && <p className="v3-note pad">読み込んでいます…</p>}
        </div>
        <div className="v3-elev-foot">
          <label>用紙 <select value={paper} onChange={e => setPaper(e.target.value)}>{PAPERS.map(x => <option key={x[0]} value={x[0]}>{x[0]}</option>)}</select></label>
          <label>縮尺 1/<input type="number" min={20} max={500} step={10} value={denom} onChange={e => setDenom(Math.max(1, +e.target.value || 100))} /></label>
          {realW > 0 && <span className="v3-note">枠1の横幅 ≈ 実寸 {realW} m（合わなければ用紙か縮尺を直す）</span>}
          <span className="sp" />
          {err && <span className="v3-meet-err">{err}</span>}
          <button className="v3-btn" onClick={onCancel}>キャンセル</button>
          <button className="v3-btn primary" onClick={save} disabled={!img || busy}>{busy ? '切り出し中…' : '3Dに貼る'}</button>
        </div>
      </div>
    </div>
  );
}

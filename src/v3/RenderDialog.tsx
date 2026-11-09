// AIパース：3Dの写しから写真調のパースを作り、保存・共有・見比べる画面。
// 作った絵は端末（renders）に残り、同じ図面を開けばまた見られる。
import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Download, RefreshCw, Trash2, ChevronLeft } from 'lucide-react';
import { type Doc } from './types';
import { listRenders, saveRender, deleteRender } from './store';
import { saveFile } from './platform';
import { RENDER_STYLES, RENDER_COST_NOTE, RENDER_NOTE_PLACEHOLDER, type Render, type RenderStyle, type RenderView, nearestAspect, shrinkToJpeg, requestRender, newRender, renderFileName, dataUrlBlob } from './render';

const VIEW_LABEL: Record<RenderView, string> = { bird: '斜め上', top: '真上', eye: '人の目線' };
const fmtAt = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function RenderDialog({ snap, doc, view, onClose }: { snap: Blob; doc: Doc; view: RenderView; onClose: () => void }) {
  const [style, setStyle] = useState<RenderStyle>('day');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [list, setList] = useState<Render[]>([]);
  const [cur, setCur] = useState<Render | null>(null);
  const [snapUrl, setSnapUrl] = useState('');
  const [showSnap, setShowSnap] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const u = URL.createObjectURL(snap); setSnapUrl(u); return () => URL.revokeObjectURL(u); }, [snap]);
  useEffect(() => { listRenders<Render>(doc.id).then(rs => { if (!alive.current) return; setList(rs); if (rs[0]) { setCur(rs[0]); setStyle(rs[0].style); setNote(rs[0].note); } }).catch(() => {}); }, [doc.id]);
  useEffect(() => { if (!busy) return; setSec(0); const t = setInterval(() => setSec(s => s + 1), 1000); return () => clearInterval(t); }, [busy]);

  const make = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const { dataUrl, w, h } = await shrinkToJpeg(snap);
      const res = await requestRender({ image: dataUrl, view, style, note: note.trim(), aspect: nearestAspect(w, h) });
      const r = newRender(doc.id, view, style, note.trim(), res.image, res.ms);
      await saveRender(r).catch(() => {});
      if (!alive.current) return;
      setList(l => [r, ...l]); setCur(r); setShowSnap(false);
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : 'パースを作れませんでした');
    } finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (!cur) return;
    try { await saveFile(await dataUrlBlob(cur.src), renderFileName(doc.name, cur.style, cur.at)); }
    catch (e) { setErr(e instanceof Error ? e.message : '保存できませんでした'); }
  };
  const remove = async () => {
    if (!cur || !confirm('このパースを削除しますか？')) return;
    await deleteRender(cur.id).catch(() => {});
    const rest = list.filter(r => r.id !== cur.id);
    setList(rest); setCur(rest[0] || null);
  };

  return (
    <div className="v3-render" role="dialog" aria-label="AIパース">
      <header className="v3-3d-top">
        <button className="v3-3d-btn" onClick={onClose} aria-label="AIパースを閉じる"><ChevronLeft size={18} /><span>3Dへ戻る</span></button>
        <b className="v3-3d-name">{doc.name}<em>AIパース</em></b>
        <span className="sp" />
        {cur && <button className="v3-3d-btn" onClick={remove} aria-label="このパースを削除"><Trash2 size={17} /></button>}
        {cur && <button className="v3-3d-btn" onClick={save} aria-label="パースを保存・共有"><Download size={17} /><span>保存・共有</span></button>}
        <button className="v3-3d-btn" onClick={onClose} aria-label="閉じる"><X size={18} /></button>
      </header>
      <div className="v3-render-body">
        <aside className="v3-render-side">
          <div className="v3-render-src" onClick={() => setShowSnap(s => !s)} role="button" aria-label="元の3Dを見る">
            {snapUrl && <img src={snapUrl} alt="元の3D" />}
            <span>元の3D（{VIEW_LABEL[view]}）{cur ? '・タップで見比べ' : ''}</span>
          </div>
          <div className="v3-render-opt">
            <b>時間帯</b>
            <div className="v3-3d-roles" role="group" aria-label="時間帯">
              {RENDER_STYLES.map(([k, l, d]) => <button key={k} className={style === k ? 'on' : ''} onClick={() => setStyle(k)} title={d} disabled={busy}>{l}</button>)}
            </div>
          </div>
          <label className="v3-render-opt">
            <b>お客様の希望（任意）</b>
            <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder={RENDER_NOTE_PLACEHOLDER} disabled={busy} />
          </label>
          <button className="v3-render-go" onClick={make} disabled={busy} aria-label="パースを作る">
            <Sparkles size={18} />{busy ? `描いています… ${sec}秒` : cur ? 'もう一枚作る' : 'パースを作る'}
          </button>
          <p className="v3-render-note">{RENDER_COST_NOTE}。形や配置・視点は3Dのままにし、材質と光をAIが描きます。細部はAIの想像なので、お客様には「イメージ」として見せてください。</p>
          {err && <p className="v3-render-err" role="alert">{err}</p>}
        </aside>
        <section className={'v3-render-main' + (busy ? ' busy' : '')}>
          {cur && !showSnap ? (
            <figure>
              <img src={cur.src} alt={`AIパース ${RENDER_STYLES.find(s => s[0] === cur.style)?.[1] || ''}`} />
              <figcaption>{RENDER_STYLES.find(s => s[0] === cur.style)?.[1]}・{VIEW_LABEL[cur.view]}・{fmtAt(cur.at)}{cur.note ? `・${cur.note}` : ''}</figcaption>
            </figure>
          ) : snapUrl ? (
            <figure className={cur ? '' : 'dim'}>
              <img src={snapUrl} alt="元の3D" />
              <figcaption>{cur ? '元の3D（もう一度タップでパースへ）' : 'ここに写真調のパースが出ます。左の「パースを作る」を押してください'}</figcaption>
            </figure>
          ) : null}
          {busy && <div className="v3-render-busy" aria-live="polite"><Sparkles size={22} /><b>パースを描いています… {sec}秒</b><span>30秒〜1分ほどかかります。このまま待つか、3Dへ戻って続きをしても大丈夫です</span></div>}
          {list.length > 1 && (
            <div className="v3-render-strip" role="list" aria-label="これまでのパース">
              {list.map(r => (
                <button key={r.id} role="listitem" className={cur?.id === r.id ? 'on' : ''} onClick={() => { setCur(r); setShowSnap(false); }} aria-label={`${fmtAt(r.at)} のパース`}>
                  <img src={r.src} alt="" /><span>{RENDER_STYLES.find(s => s[0] === r.style)?.[1]} {fmtAt(r.at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {busy && <button className="v3-render-back" onClick={onClose} aria-label="3Dへ戻る（生成は続きます）"><RefreshCw size={14} className="spin" />裏で描いています。3Dへ戻る</button>}
    </div>
  );
}

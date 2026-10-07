import { useEffect, useRef, useState } from 'react';
import { Plus, FileUp, Trees, FolderOpen, Trash2, PenTool } from 'lucide-react';
import { type Doc, newDoc } from './types';
import { listDocs, loadDoc, saveDoc, deleteDoc, validDoc, type DocMeta } from './store';
import { sampleDoc } from './useDoc';
import { Editor } from './Editor';
import { readSource } from '../io';

export default function App3() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [open, setOpen] = useState<Doc | null>(null);
  const [err, setErr] = useState('');
  const pdfRef = useRef<HTMLInputElement>(null), jsonRef = useRef<HTMLInputElement>(null);
  const refresh = () => listDocs().then(setDocs).catch(() => setErr('端末の保存領域を開けませんでした'));
  useEffect(() => { refresh(); const id = new URLSearchParams(location.search).get('doc'); if (id) loadDoc(id).then(d => d && setOpen(d)); }, []);

  const start = async (d: Doc) => { await saveDoc(d); setOpen(d); };
  const fromFile = async (f?: File) => {
    if (!f) return;
    try {
      const src = await readSource(f), im = await src.render(1); await src.close();
      const d = newDoc(f.name.replace(/\.[^.]+$/, '')), w = 1200, h = 1200 * im.height / im.width;
      await start({ ...d, underlay: { src: im.src, name: f.name, x: 0, y: 0, w, h, opacity: 0.6, visible: true, locked: true } });
    } catch (e) { setErr(e instanceof Error ? e.message : '読み込めませんでした'); }
  };
  const fromJson = async (f?: File) => { if (!f) return; try { const d = validDoc(JSON.parse(await f.text())); await start({ ...d, id: crypto.randomUUID() }); } catch (e) { setErr(e instanceof Error ? e.message : '読み込めませんでした'); } };

  if (open) return <Editor key={open.id} initial={open} onHome={() => { setOpen(null); refresh(); }} />;
  return (
    <div className="v3-home">
      <input ref={pdfRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={jsonRef} type="file" hidden accept="application/json,.json" onChange={e => { fromJson(e.target.files?.[0]); e.target.value = ''; }} />
      <header className="v3-hhead"><span className="logo"><PenTool size={18} /></span><b>外構スケッチ</b><span className="v3-mono">ver 2026.10.06-01 (home-app)</span><span className="sp" /><span className="v3-mono">ローカル保存(端末)</span></header>
      <main>
        <h1>キャンバス</h1>
        <p className="lead">平面図の上で、手描き → 清書 → 部品・植栽 → 素材の塗り分け → 寸法まで。</p>
        {err && <p className="v3-err" onClick={() => setErr('')}>{err}</p>}
        <div className="v3-cards">
          <button className="v3-new" onClick={() => start(newDoc())}><Plus size={22} /><b>新しいキャンバス</b><span>白紙から描き始める</span></button>
          <button className="v3-new" onClick={() => pdfRef.current?.click()}><FileUp size={22} /><b>下絵から始める</b><span>PDF・画像の配置図を読み込む</span></button>
          <button className="v3-new accent" onClick={() => start(sampleDoc())}><Trees size={22} /><b>サンプル邸で試す</b><span>建物・敷地・車が入った見本</span></button>
          <button className="v3-new" onClick={() => jsonRef.current?.click()}><FolderOpen size={22} /><b>編集データを開く</b><span>.garden3.json を読み込む</span></button>
        </div>
        <h2>保存したキャンバス <em>{docs.length}</em></h2>
        <div className="v3-docs">
          {docs.map(d => (
            <div key={d.id} className="v3-doc" onClick={() => loadDoc(d.id).then(x => x && setOpen(x))}>
              <div className="th">{d.thumb ? <img src={d.thumb} alt="" /> : <PenTool size={26} />}</div>
              <b>{d.name}</b><span>{new Date(d.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <button className="v3-ib del" aria-label="削除" onClick={e => { e.stopPropagation(); if (confirm(`「${d.name}」を削除しますか？`)) deleteDoc(d.id).then(refresh); }}><Trash2 size={15} /></button>
            </div>
          ))}
          {!docs.length && <p className="v3-note">まだ保存したキャンバスはありません。</p>}
        </div>
      </main>
    </div>
  );
}

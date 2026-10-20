// 商品ボード：会社で使うメーカー品を登録して並べる。登録した商品はそのまま概算見積の品目になり、
// カーポート・物置などは図面に置ける。フェンス・門扉・舗装材は図面の線・素材に結び付ける。
import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink, MapPin, FilePlus2, Upload, Download, FileSpreadsheet, Search } from 'lucide-react';
import { type PriceBook, type PriceItem } from './estimate';
import { BOARD_CATS, LINE_USES, boardCat, boardItems, emptyForm, formOf, matUses, productFrom, removeProduct, saveProduct, sizeText, usesOf, useFor, type ProductForm } from './products';

const jpy = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

function Field({ label, k, f, set, ph, num, wide }: { label: string; k: keyof ProductForm; f: ProductForm; set: (f: ProductForm) => void; ph?: string; num?: boolean; wide?: boolean }) {
  return (
    <label className={'v3-pb-f' + (wide ? ' wide' : '')}><span>{label}</span>
      <input value={f[k]} placeholder={ph} inputMode={num ? 'decimal' : undefined} type={k === 'url' ? 'url' : 'text'} onChange={e => set({ ...f, [k]: e.target.value })} />
    </label>
  );
}

function ProductEditor({ init, id, onSave, onCancel }: { init: ProductForm; id?: string; onSave: (it: PriceItem) => void; onCancel: () => void }) {
  const [f, setF] = useState(init), [err, setErr] = useState('');
  const save = () => { const r = productFrom(f, id); if (r.error) return setErr(r.error); onSave(r.item!); };
  return (
    <div className="v3-pb-form" role="form" aria-label={id ? '商品を直す' : '商品を登録'}>
      <label className="v3-pb-f"><span>分類</span>
        <select value={f.cat} onChange={e => { const c = e.target.value; setF({ ...f, cat: c, unit: f.price || f.name ? f.unit : boardCat(c)?.unit || f.unit }); }}>
          {BOARD_CATS.map(c => <option key={c.cat}>{c.cat}</option>)}
          {!boardCat(f.cat) && <option>{f.cat}</option>}
        </select>
      </label>
      <Field label="商品名 *" k="name" f={f} set={setF} ph="例：〇〇フェンス H1000" wide />
      <Field label="メーカー" k="maker" f={f} set={setF} ph="例：LIXIL" />
      <Field label="型番" k="model" f={f} set={setF} />
      <Field label="幅 mm" k="w" f={f} set={setF} num />
      <Field label="奥行 mm" k="d" f={f} set={setF} num />
      <Field label="高さ mm" k="h" f={f} set={setF} num />
      <Field label="色" k="color" f={f} set={setF} />
      <Field label="売値（単価）*" k="price" f={f} set={setF} ph="円" num />
      <Field label="単位" k="unit" f={f} set={setF} />
      <Field label="原価" k="cost" f={f} set={setF} ph="円" num />
      <Field label="定価" k="list" f={f} set={setF} ph="円" num />
      <Field label="公式ページ" k="url" f={f} set={setF} ph="https://（メーカーの商品ページ）" wide />
      <Field label="メモ" k="note" f={f} set={setF} wide />
      {err && <p className="v3-pb-err" role="alert">{err}</p>}
      <div className="v3-row wide">
        <button className="v3-btn primary" onClick={save}>{id ? '直す' : '登録する'}</button>
        <button className="v3-btn" onClick={onCancel}>やめる</button>
      </div>
    </div>
  );
}

export function ProductBoard({ book, onBook, onPlace, onAddToEst, onImport, onExport, onTemplate }: {
  book: PriceBook; onBook: (b: PriceBook) => void; onPlace: (p: PriceItem) => void; onAddToEst: (p: PriceItem) => void;
  onImport: (f: File) => void; onExport: () => void; onTemplate: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState(''), [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ id?: string; form: ProductForm } | null>(null);
  const all = boardItems(book);
  const cats = [...new Set([...BOARD_CATS.map(c => c.cat), ...all.map(i => i.cat)])].filter(c => all.some(i => i.cat === c));
  const words = q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(i => (!cat || i.cat === cat) && words.every(w => [i.name, i.maker, i.model, i.color, i.note].join(' ').normalize('NFKC').toLowerCase().includes(w)));
  const del = (i: PriceItem) => { if (confirm(`「${i.name}」を商品ボードから消しますか？（見積の結び付けも外れます）`)) onBook(removeProduct(book, i.id)); };

  return (
    <div className="v3-est v3-pb">
      <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
        onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onImport(f); }} />
      <div className="v3-est-book">
        <span>御社で使う商品を登録しておくと、見積の品目として選べて、図面にも置けます。写真や細かい仕様は「公式ページ」から見ます。</span>
        <div className="v3-row wrap">
          <button className="v3-btn primary" onClick={() => setEdit({ form: emptyForm(cat || undefined) })}><Plus size={14} />商品を登録</button>
          <button className="v3-btn" onClick={() => fileRef.current?.click()} title="ひな形に入れたExcel・CSVを読み込む"><Upload size={14} />まとめて読み込む</button>
          <button className="v3-btn" onClick={onTemplate} title="まとめて入れるためのひな形（CSV）"><FileSpreadsheet size={14} />ひな形</button>
          <button className="v3-btn" onClick={onExport} title="登録した商品を含む単価表をCSVで保存"><Download size={14} />保存</button>
        </div>
      </div>

      {edit && <ProductEditor init={edit.form} id={edit.id} onCancel={() => setEdit(null)} onSave={it => { onBook(saveProduct(book, it)); setEdit(null); }} />}

      {all.length > 0 && <>
        <div className="v3-pb-search"><Search size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="商品名・メーカー・型番で探す" aria-label="商品を探す" /></div>
        <div className="v3-pb-cats" role="tablist">
          <button role="tab" aria-selected={!cat} className={!cat ? 'on' : ''} onClick={() => setCat('')}>すべて {all.length}</button>
          {cats.map(c => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c} {all.filter(i => i.cat === c).length}</button>)}
        </div>
      </>}
      {!all.length && !edit && <p className="v3-note pad">まだ商品がありません。「商品を登録」で1つずつ、または「ひな形」に50〜100点まとめて入れて「まとめて読み込む」で登録できます。</p>}
      {all.length > 0 && !shown.length && <p className="v3-note pad">見つかりませんでした。</p>}

      {shown.map(i => {
        const bc = boardCat(i.cat), uses = usesOf(book, i.id), margin = i.cost ? Math.round((1 - i.cost / i.price) * 100) : null;
        const choices = bc?.use === 'line' ? LINE_USES : bc?.use === 'mat' ? matUses() : [];
        return (
          <div key={i.id} className="v3-pb-card">
            <div className="top">
              <b className="nm">{i.name}</b><span className="sp" />
              <b className="amt">{jpy(i.price)}<small>/{i.unit || '式'}</small></b>
            </div>
            <div className="meta">
              <span className="cat">{i.cat}</span>
              {[i.maker, i.model, sizeText(i), i.color].filter(Boolean).join('・')}
            </div>
            {(i.list || i.cost || i.note) && <div className="meta sub">
              {i.list ? <>定価 {jpy(i.list)}（{Math.round(i.price / i.list * 100)}%）</> : null}
              {i.cost ? <> 原価 {jpy(i.cost)}{margin != null && <>（粗利 {margin}%）</>}</> : null}
              {i.note ? <> {i.note}</> : null}
            </div>}
            {uses.length > 0 && <div className="meta use">見積で使用中：{uses.join('、')}</div>}
            <div className="acts">
              {bc?.lib && <button className="v3-btn" onClick={() => onPlace(i)} title="図面の真ん中に置きます。置くと見積に入ります"><MapPin size={14} />図面に置く</button>}
              {choices.length > 0 && <select className="v3-est-sel" aria-label={`${i.name}を使う所`} value="" onChange={e => e.target.value && onBook(useFor(book, e.target.value, i.id))}>
                <option value="">図面の{bc?.use === 'mat' ? '素材' : '線'}に使う…</option>
                {choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>}
              {!bc?.lib && !choices.length && <button className="v3-btn" onClick={() => onAddToEst(i)} title="この図面の見積に「追加の項目」として入れます"><FilePlus2 size={14} />見積に入れる</button>}
              <span className="sp" />
              {i.url && <a className="v3-ib" href={i.url} target="_blank" rel="noopener noreferrer" aria-label={`${i.name}の公式ページ`} title="公式ページを開く"><ExternalLink size={15} /></a>}
              <button className="v3-ib" aria-label={`${i.name}を直す`} onClick={() => setEdit({ id: i.id, form: formOf(i) })}><Pencil size={14} /></button>
              <button className="v3-ib" aria-label={`${i.name}を消す`} onClick={() => del(i)}><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
      <p className="v3-note pad">商品ボードは単価表と一緒にこの端末に保存されます。メーカーの写真・図面・カタログはアプリに取り込まず、公式ページで見てください。</p>
    </div>
  );
}

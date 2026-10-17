// 概算見積の表示：集計×単価表。数量・単価はこの図面だけ手直しでき、品目の選び直しは単価表に覚える
import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload, Download, Plus, Trash2, FileText, Copy } from 'lucide-react';
import { type DocEstimate, uid } from './types';
import { type QtyRow } from './quantities';
import { type PriceBook, type Estimate, type EstLine, isProvisional } from './estimate';
import { compareRows } from './estimatePdf';

const jpy = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

// 数字の入力：打ち終わり（フォーカスが外れる・Enter）で確定。履歴が1文字ごとに増えないように
function Num({ value, onCommit, label, w = 64, step }: { value: number; onCommit: (v: number) => void; label: string; w?: number; step?: number }) {
  return <input key={value} className="v3-est-num" style={{ width: w }} type="number" inputMode="decimal" step={step ?? 'any'} aria-label={label} defaultValue={value}
    onBlur={e => { const v = parseFloat(e.target.value); if (isFinite(v) && v !== value) onCommit(v); else e.target.value = String(value); }}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function ItemSelect({ book, value, onChange, label, placeholder }: { book: PriceBook; value: string; onChange: (id: string) => void; label: string; placeholder: string }) {
  const cats = [...new Set(book.items.map(i => i.cat || 'その他'))];
  return (
    <select className="v3-est-sel" aria-label={label} value={value} onChange={e => e.target.value !== value && onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {cats.map(c => <optgroup key={c} label={c}>{book.items.filter(i => (i.cat || 'その他') === c).map(i => <option key={i.id} value={i.id}>{i.name}（{i.price.toLocaleString('ja-JP')}円/{i.unit || '式'}）</option>)}</optgroup>)}
    </select>
  );
}

export function EstView({ e, book, est, onBook, onEst, onPick, onCsv, onImport, onExportBook, others, onCompare, onPdf, onDuplicate }: {
  e: Estimate; book: PriceBook; est: DocEstimate; onBook: (b: PriceBook) => void; onEst: (est: DocEstimate) => void;
  onPick: (ids: string[]) => void; onCsv: () => void; onImport: (f: File) => void; onExportBook: () => void;
  others: { id: string; name: string }[]; onCompare: (id: string) => Promise<Estimate>; onPdf: (cmp?: { name: string; e: Estimate }) => void; onDuplicate: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // 比べる案：選んだ図面を同じ単価表で計算する
  const [cmp, setCmp] = useState<{ id: string; name: string; e: Estimate | null } | null>(null);
  const pickCompare = (id: string) => {
    if (!id) return setCmp(null);
    const name = others.find(o => o.id === id)?.name || 'ほかの案';
    setCmp({ id, name, e: null });
    onCompare(id).then(x => setCmp(c => c?.id === id ? { id, name, e: x } : c)).catch(() => setCmp(null));
  };
  const prov = isProvisional(book);
  const relink = (rowKey: string, id: string) => onBook({ ...book, links: { ...book.links, [rowKey]: id ? [id] : ['-'] } });
  const setLine = (l: EstLine, k: 'qty' | 'price', v: number) => onEst({ ...est, [k]: { ...est[k], [l.key]: v } });
  const resetLine = (l: EstLine) => { const q = { ...est.qty }, p = { ...est.price }; delete q[l.key]; delete p[l.key]; onEst({ ...est, qty: q, price: p }); };
  const extras = est.extras || [];
  const setExtra = (id: string, patch: Partial<(typeof extras)[number]>) => onEst({ ...est, extras: extras.map(x => x.id === id ? { ...x, ...patch } : x) });
  const addExtra = (id: string) => {
    if (!id) return;
    const it = id === '*' ? { name: '項目', unit: '式', price: 0 } : book.items.find(i => i.id === id)!;
    onEst({ ...est, extras: [...extras, { id: uid(), name: it.name, unit: it.unit || '式', qty: 1, price: it.price }] });
  };
  const groups = ['素材', '線', '部品'].map(g => [g, e.lines.filter(l => l.group === g)] as const).filter(([, ls]) => ls.length);

  return (
    <div className="v3-est">
      <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
        onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onImport(f); }} />
      <div className={'v3-est-book' + (prov ? ' prov' : '')}>
        {prov ? <span><b>仮の単価で計算しています。</b>御社の単価表（Excel・CSV）を読み込むと、品目を自動で結び付けて計算し直します。</span>
          : <span>単価表：<b>{book.name}</b>（{book.items.filter(i => !i.prov).length}品目）</span>}
        <label className="v3-est-co">見積書の会社名
          <input key={book.company || ''} defaultValue={book.company || ''} placeholder="例：〇〇エクステリア" aria-label="見積書の会社名"
            onBlur={ev => { const v = ev.target.value.trim(); if (v !== (book.company || '')) onBook({ ...book, company: v }); }} /></label>
        <div className="v3-row">
          <button className="v3-btn" onClick={() => fileRef.current?.click()}><Upload size={14} />単価表を読み込む</button>
          <button className="v3-btn" onClick={onExportBook} title="今の単価表をCSVで保存（Excelで直して読み込み直せます）"><Download size={14} />単価表を保存</button>
        </div>
      </div>

      {!e.lines.length && !e.unpriced.length && <p className="v3-note pad">まだ見積に入るものがありません。素材を塗る・部品を置く・実線を引くと、ここに金額が出ます。</p>}
      {groups.map(([g, ls]) => (
        <section key={g} className="v3-qty-group">
          <h4>{g === '素材' ? '素材' : g === '線' ? '塀・フェンス・門扉' : '部品'}</h4>
          {ls.map(l => (
            <div key={l.key} className={'v3-est-line' + (l.prov ? ' prov' : '')}>
              <div className="top">
                <button className="lbl" onClick={() => l.ids && onPick(l.ids)} title="図面で選ぶ">{l.label}</button>
                {l.prov && <em className="tag">仮単価</em>}{l.auto && <em className="tag auto">自動判定</em>}{l.byArea && <em className="tag">長さ×高さ</em>}
                <span className="sp" /><b className="amt">{jpy(l.amount)}</b>
              </div>
              <ItemSelect book={book} value={l.item || ''} onChange={id => relink(l.row!, id)} label={`${l.label}の品目`} placeholder="（見積に入れない）" />
              <div className="calc">
                <Num value={l.qty} label={`${l.label}の数量`} onCommit={v => setLine(l, 'qty', v)} /> {l.unit} ×
                <Num value={l.price} w={84} label={`${l.label}の単価`} onCommit={v => setLine(l, 'price', v)} /> 円
                {l.edited && <button className="v3-link" onClick={() => resetLine(l)}>元に戻す</button>}
              </div>
            </div>
          ))}
        </section>
      ))}

      <section className="v3-qty-group">
        <h4>追加の項目（残土処分・諸工事など）</h4>
        {extras.map(x => (
          <div key={x.id} className="v3-est-line">
            <div className="top">
              <input className="v3-est-name" aria-label="項目名" defaultValue={x.name} key={x.name} onBlur={ev => { const v = ev.target.value.trim(); if (v && v !== x.name) setExtra(x.id, { name: v }); }} />
              <span className="sp" /><b className="amt">{jpy(x.qty * x.price)}</b>
              <button className="v3-ib" aria-label={`${x.name}を消す`} onClick={() => onEst({ ...est, extras: extras.filter(y => y.id !== x.id) })}><Trash2 size={14} /></button>
            </div>
            <div className="calc">
              <Num value={x.qty} label={`${x.name}の数量`} onCommit={v => setExtra(x.id, { qty: v })} /> {x.unit} ×
              <Num value={x.price} w={84} label={`${x.name}の単価`} onCommit={v => setExtra(x.id, { price: v })} /> 円
            </div>
          </div>
        ))}
        <div className="v3-est-add"><Plus size={14} />
          <select aria-label="項目を追加" value="" onChange={ev => addExtra(ev.target.value)}>
            <option value="">項目を追加…</option>
            <option value="*">自由に入力する</option>
            {[...new Set(book.items.map(i => i.cat || 'その他'))].map(c => <optgroup key={c} label={c}>{book.items.filter(i => (i.cat || 'その他') === c).map(i => <option key={i.id} value={i.id}>{i.name}（{i.price.toLocaleString('ja-JP')}円/{i.unit || '式'}）</option>)}</optgroup>)}
          </select>
        </div>
      </section>

      {e.unpriced.length > 0 && (
        <section className="v3-qty-group">
          <h4>単価が決まっていない項目（金額に入っていません）</h4>
          {e.unpriced.map((r: QtyRow) => (
            <div key={r.key} className="v3-est-line un">
              <div className="top"><button className="lbl" onClick={() => onPick(r.ids)}>{r.name}</button><span className="sp" /><span className="q">{r.qty} {r.unit}</span></div>
              <ItemSelect book={book} value="" onChange={id => relink(r.key, id)} label={`${r.name}の品目を選ぶ`} placeholder="品目を選ぶ…" />
            </div>
          ))}
        </section>
      )}

      <div className="v3-est-sum">
        <div><span>小計</span><b>{jpy(e.subtotal)}</b></div>
        <div><span>諸経費 <Num value={e.overheadPct} w={48} label="諸経費の割合" onCommit={v => onEst({ ...est, overheadPct: Math.max(0, v) })} /> %</span><b>{jpy(e.overhead)}</b></div>
        <div><span>値引き <Num value={e.discount} w={90} step={1000} label="値引き" onCommit={v => onEst({ ...est, discount: Math.max(0, v) })} /> 円</span><b>{e.discount ? '−' + jpy(e.discount) : jpy(0)}</b></div>
        <div><span>消費税（{e.taxPct}%）</span><b>{jpy(e.tax)}</b></div>
        <div className="total"><span>合計（税込）</span><b>{jpy(e.total)}</b></div>
      </div>
      <section className="v3-qty-group">
        <h4>ほかの案と比べる（A案・B案）</h4>
        <div className="v3-est-add">
          <select aria-label="比べる案" value={cmp?.id || ''} onChange={ev => pickCompare(ev.target.value)}>
            <option value="">比べる図面を選ぶ…</option>
            {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        {cmp && (cmp.e ? (() => {
          const rows = compareRows(e, cmp.e).filter(r => r.a !== r.b).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a)).slice(0, 6), d = cmp.e.total - e.total;
          return (
            <div className="v3-est-cmp">
              <div className="hd"><span /><b>この図面</b><b>比べる案</b></div>
              <div className="tot"><span>合計（税込）</span><b>{jpy(e.total)}</b><b>{jpy(cmp.e.total)}</b></div>
              <p className={'diff' + (d > 0 ? ' up' : d < 0 ? ' down' : '')}>{d === 0 ? '同じ金額です' : `${cmp.name}は ${jpy(Math.abs(d))} ${d > 0 ? '高い' : '安い'}`}</p>
              {rows.map(r => <div key={r.label} className="row"><span>{r.label}</span><i>{r.a ? jpy(r.a) : '—'}</i><i>{r.b ? jpy(r.b) : '—'}</i></div>)}
            </div>);
        })() : <p className="v3-note pad">計算しています…</p>)}
        <button className="v3-btn" onClick={onDuplicate}><Copy size={14} />この図面を複製してB案を作る</button>
      </section>

      <div className="v3-row wrap">
        <button className="v3-btn primary" onClick={() => onPdf(cmp?.e ? { name: cmp.name, e: cmp.e } : undefined)} disabled={!e.lines.length}><FileText size={14} />見積書PDF{cmp?.e ? '（比較つき）' : ''}</button>
        <button className="v3-btn" onClick={onCsv} disabled={!e.lines.length}><FileSpreadsheet size={14} />CSVで保存</button>
      </div>
      <p className="v3-note pad">数量は図面からの概算です。数量・単価を直すとこの図面だけに効きます。品目を選び直すと単価表に覚えるので、ほかの図面にも同じ品目が使われます。単価表はこの端末に保存されます。</p>
    </div>
  );
}

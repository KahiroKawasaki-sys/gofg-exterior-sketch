// 集計パネル：素材の面積・線の長さ・部品の数。行を押すと図面のその箇所を選ぶ
import { useEffect, useState } from 'react';
import { X, FileSpreadsheet } from 'lucide-react';
import { type Doc, type LibItem, type Role3 } from './types';
import { quantities, textureAreas, type QtyRow, type QtyGroup } from './quantities';
import { ROLE_LABELS } from './scene3d';

export function QtyPanel({ doc, lib, onPick, onSetRole, onCsv, onClose, sheet }: {
  doc: Doc; lib: LibItem[]; onPick: (ids: string[]) => void; onSetRole: (ids: string[], role: Role3) => void;
  onCsv: (rows: QtyRow[]) => void; onClose: () => void; sheet?: boolean;
}) {
  const [areas, setAreas] = useState<Map<string, number> | null>(null);
  // 塗りの面積は画像を読むので、描き終わって少ししてから数え直す
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => textureAreas(doc).then(a => alive && setAreas(a)), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [doc]);
  const rows = quantities(doc, lib, areas || undefined);
  const groups: QtyGroup[] = ['素材', '線', '部品'];
  const fmt = (r: QtyRow) => r.unit === '㎡' && !areas ? '…' : r.qty.toLocaleString('ja-JP');

  return (
    <div className={'v3-panel v3-qty' + (sheet ? ' sheet' : '')} aria-label="集計">
      <div className="v3-qty-head"><b>集計</b><span className="sp" />
        <button className="v3-btn" onClick={() => onCsv(rows)} disabled={!rows.length}><FileSpreadsheet size={14} />CSV</button>
        <button className="v3-ib" onClick={onClose} aria-label="集計を閉じる"><X size={16} /></button>
      </div>
      {!rows.length && <p className="v3-note pad">まだ数えるものがありません。素材を塗る・部品を置く・実線を引くと、ここに数量が出ます。</p>}
      {groups.map(g => {
        const rs = rows.filter(r => r.group === g);
        if (!rs.length) return null;
        return (
          <section key={g} className="v3-qty-group">
            <h4>{g === '素材' ? '素材（面積）' : g === '線' ? '線（長さ）' : '部品（数）'}</h4>
            {rs.map(r => (
              <div key={r.key} className={'v3-qty-row' + (r.role === 'ground' ? ' warn' : '')}>
                <button className="v3-qty-main" onClick={() => onPick(r.ids)} title="図面で選ぶ">
                  <span className="nm">{r.name}{r.auto && <em className="auto">自動判定</em>}</span>
                  <span className="q"><b>{fmt(r)}</b> {r.unit}</span>
                </button>
                {g === '線' && (
                  <select aria-label={`${r.name}の種類を変える`} value="" onChange={e => e.target.value && onSetRole(r.ids, e.target.value as Role3)}>
                    <option value="">種類…</option>
                    {ROLE_LABELS.filter(([v]) => v !== 'auto').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
              </div>
            ))}
          </section>
        );
      })}
      <p className="v3-note pad">行を押すと図面でその箇所を選びます。「自動判定」は種類を選んでいない実線を、塀・建物と見なして数えたものです。点線・手描きの線は、種類を選んだときだけ数えます。車と人は数えません。面積は塗った範囲からの概算です。</p>
    </div>
  );
}

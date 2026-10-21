// 仕様書（マテリアルボード）の確認と登録：カードを押すと、その品目のメーカー・品番・色・写真を登録できる。
// 登録先は単価表の品目なので、一度入れればほかの図面の仕様書にも出る
import { useRef, useState } from 'react';
import { FileText, ImagePlus, Trash2 } from 'lucide-react';
import { type LibItem } from './types';
import { type PriceBook, type PriceItem } from './estimate';
import { type BoardCard, BOARD_SECTIONS, symbolSvg } from './materialBoard';
import { textureSrc } from './textures';

// 写真は長い辺 640px の JPEG に縮めて単価表に入れる（端末の保存領域を圧迫しないように）
export async function shrinkPhoto(file: File, max = 640): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return c.toDataURL('image/jpeg', 0.85);
}

const LINE_ICON: Record<string, string> = {
  wall: '<rect x="4" y="10" width="40" height="22" fill="#c9cbc3" stroke="#3d4a45" stroke-width="1.5"/><path d="M4 17h40M4 24h40M14 10v7M28 10v7M21 17v7M35 17v7M14 24v8M28 24v8" stroke="#3d4a45" stroke-width="1.2"/>',
  fence: '<path d="M4 12h40M4 30h40M8 12v18M14 12v18M20 12v18M26 12v18M32 12v18M38 12v18" stroke="#3d4a45" stroke-width="1.6" fill="none"/>',
  gate: '<rect x="6" y="8" width="5" height="26" fill="#c9cbc3" stroke="#3d4a45"/><rect x="37" y="8" width="5" height="26" fill="#c9cbc3" stroke="#3d4a45"/><rect x="13" y="12" width="22" height="20" fill="none" stroke="#3d4a45" stroke-width="1.5"/><path d="M17 12v20M21 12v20M25 12v20M29 12v20" stroke="#3d4a45"/>',
};

function CardPic({ c, lib }: { c: BoardCard; lib: Map<string, LibItem> }) {
  const p = c.pic;
  if (p.kind === 'photo') return <img src={p.src} alt="" />;
  if (p.kind === 'texture') return <img src={textureSrc(p.tex)} alt="" />;
  if (p.kind === 'symbol') { const l = lib.get(p.lib); return l ? <img className="sym" src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(symbolSvg(l))} alt="" /> : <span className="none">写真なし</span>; }
  if (p.kind === 'line') return <svg className="sym" viewBox="0 0 48 40" dangerouslySetInnerHTML={{ __html: LINE_ICON[p.role] || '' }} />;
  return <span className="none">写真なし</span>;
}

function Field({ label, value, onCommit, placeholder }: { label: string; value?: string; onCommit: (v: string) => void; placeholder: string }) {
  return <label>{label}<input key={value || ''} defaultValue={value || ''} placeholder={placeholder} aria-label={label}
    onBlur={e => { const v = e.target.value.trim(); if (v !== (value || '')) onCommit(v); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>;
}

export function BoardView({ cards, book, lib, onBook, onPick, onPdf, onToast }: {
  cards: BoardCard[]; book: PriceBook; lib: LibItem[]; onBook: (b: PriceBook) => void; onPick: (ids: string[]) => void; onPdf: () => void; onToast?: (m: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const libs = new Map(lib.map(l => [l.id, l]));
  const cur = cards.find(c => c.key === open), item = cur?.item ? book.items.find(i => i.id === cur.item) : undefined;
  const patch = (p: Partial<PriceItem>) => {
    if (!item) return;
    const next = { ...item, ...p };
    (Object.keys(p) as (keyof PriceItem)[]).forEach(k => { if (!next[k]) delete next[k]; });
    onBook({ ...book, items: book.items.map(i => i.id === item.id ? next : i) });
  };
  const pickPhoto = async (f: File) => {
    try { patch({ img: await shrinkPhoto(f) }); } catch { onToast?.('写真を読み込めませんでした'); }
  };

  return (
    <div className="v3-board">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) pickPhoto(f); }} />
      {!cards.length && <p className="v3-note pad">まだ載せるものがありません。素材を塗る・部品を置く・塀やフェンスを引くと、ここに並びます。</p>}
      {BOARD_SECTIONS.map(([g, label]) => {
        const cs = cards.filter(c => c.group === g); if (!cs.length) return null;
        return (
          <section key={g}>
            <h4>{label}</h4>
            <div className="grid">
              {cs.map(c => (
                <button key={c.key} className={'card' + (open === c.key ? ' on' : '')} onClick={() => setOpen(open === c.key ? null : c.key)} aria-expanded={open === c.key}>
                  <span className="pic"><CardPic c={c} lib={libs} /></span>
                  <span className="cat">{c.cat}{c.qty && <i>{c.qty}</i>}</span>
                  <b>{c.title}</b>
                  <span className="prod">{c.product || '品目未設定'}</span>
                  {c.spec && <span className="spec">{c.spec}</span>}
                </button>
              ))}
            </div>
            {cur && cur.group === g && (
              <div className="edit">
                {item ? <>
                  <p className="v3-note">「{item.name}」に登録します。ほかの図面でも同じ品目なら、この写真・メーカーが使われます。</p>
                  <div className="fields">
                    <Field label="メーカー" value={item.maker} placeholder="例：LIXIL" onCommit={v => patch({ maker: v })} />
                    <Field label="品番" value={item.model} placeholder="例：プラスG" onCommit={v => patch({ model: v })} />
                    <Field label="色" value={item.color} placeholder="例：クリエモカ" onCommit={v => patch({ color: v })} />
                  </div>
                  <div className="v3-row wrap">
                    <button className="v3-btn" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />{item.img ? '写真を変える' : '写真を選ぶ'}</button>
                    {item.img && <button className="v3-btn" onClick={() => patch({ img: undefined })}><Trash2 size={14} />写真を外す</button>}
                    <button className="v3-btn" onClick={() => onPick(cur.ids)}>図面で見る</button>
                  </div>
                </> : <p className="v3-note">この項目には品目が結び付いていません。「概算見積」タブで品目を選ぶと、写真やメーカーを登録できます。</p>}
              </div>
            )}
          </section>
        );
      })}
      <div className="v3-row wrap">
        <button className="v3-btn primary" onClick={onPdf} disabled={!cards.length}><FileText size={14} />仕様書PDF</button>
      </div>
      <p className="v3-note pad">写真がない項目は、図面の質感・部品の絵で代わりに表示します。写真・メーカー・品番・色は単価表に覚え、この端末に保存されます。単価表のCSVに「メーカー・品番・色」の列があれば、読み込み時にまとめて入ります。</p>
    </div>
  );
}

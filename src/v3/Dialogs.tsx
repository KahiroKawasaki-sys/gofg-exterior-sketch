import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PALETTE, SOFT } from './types';

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="v3-modal-bg" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'v3-modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Swatches({ colors, value, onPick, disabled }: { colors: string[]; value: string | null; onPick: (c: string) => void; disabled?: boolean }) {
  return <div className={'v3-sw' + (disabled ? ' off' : '')}>{colors.map(c => <button key={c} type="button" aria-label={c} className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onPick(c)} />)}</div>;
}

export type TextValue = { text: string; color: string; bg: string | null; border: string | null };
export function TextDialog({ initial, onOk, onCancel, onDelete }: { initial: TextValue; onOk: (v: TextValue) => void; onCancel: () => void; onDelete?: () => void }) {
  const [v, setV] = useState(initial), [bgOn, setBgOn] = useState(!!initial.bg), [bdOn, setBdOn] = useState(!!initial.border);
  const [bg, setBg] = useState(initial.bg || SOFT[4]), [bd, setBd] = useState(initial.border || PALETTE[2]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const ok = () => { if (v.text.trim()) onOk({ ...v, bg: bgOn ? bg : null, border: bdOn ? bd : null }); };
  return (
    <Modal title="テキスト入力" onClose={onCancel}>
      <label className="v3-lab">文字</label>
      <textarea ref={ref} className="v3-textarea" value={v.text} onChange={e => setV({ ...v, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok(); }} />
      <div className="v3-trow"><span>文字色</span><Swatches colors={PALETTE} value={v.color} onPick={c => setV({ ...v, color: c })} /></div>
      <div className="v3-trow"><span>背景</span><label className="v3-chk"><input type="checkbox" checked={bgOn} onChange={e => setBgOn(e.target.checked)} />ON</label><Swatches colors={SOFT} value={bgOn ? bg : null} onPick={c => { setBg(c); setBgOn(true); }} disabled={!bgOn} /></div>
      <div className="v3-trow"><span>枠線</span><label className="v3-chk"><input type="checkbox" checked={bdOn} onChange={e => setBdOn(e.target.checked)} />ON</label><Swatches colors={PALETTE} value={bdOn ? bd : null} onPick={c => { setBd(c); setBdOn(true); }} disabled={!bdOn} /></div>
      <p className="v3-note">改行に対応しています。</p>
      <div className="v3-actions">{onDelete && <button className="v3-btn danger" onClick={onDelete}>削除</button>}<span className="sp" /><button className="v3-btn" onClick={onCancel}>キャンセル</button><button className="v3-btn primary" onClick={ok} disabled={!v.text.trim()}>配置</button></div>
    </Modal>
  );
}

export type Field = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'checkbox'; value: string | number | boolean; options?: string[]; suffix?: string };
export function PromptDialog({ title, fields, note, okLabel = 'OK', onOk, onCancel }: { title: string; fields: Field[]; note?: string; okLabel?: string; onOk: (v: Record<string, string | number | boolean>) => void; onCancel: () => void }) {
  const [vals, setVals] = useState<Record<string, string | number | boolean>>(Object.fromEntries(fields.map(f => [f.key, f.value])));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={e => { e.preventDefault(); onOk(vals); }}>
        {fields.map((f, i) => (
          <label key={f.key} className="v3-field">
            <span>{f.label}</span>
            {f.type === 'select' ? <select value={String(vals[f.key])} onChange={e => setVals({ ...vals, [f.key]: e.target.value })}>{f.options!.map(o => <option key={o}>{o}</option>)}</select>
              : f.type === 'checkbox' ? <input type="checkbox" checked={!!vals[f.key]} onChange={e => setVals({ ...vals, [f.key]: e.target.checked })} />
                : <input ref={i === 0 ? first : undefined} type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} value={String(vals[f.key])} onChange={e => setVals({ ...vals, [f.key]: f.type === 'number' ? e.target.value : e.target.value })} />}
            {f.suffix && <em>{f.suffix}</em>}
          </label>
        ))}
        {note && <p className="v3-note">{note}</p>}
        <div className="v3-actions"><span className="sp" /><button type="button" className="v3-btn" onClick={onCancel}>キャンセル</button><button type="submit" className="v3-btn primary">{okLabel}</button></div>
      </form>
    </Modal>
  );
}

export function Menu({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.v3-menu')) onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', h), 0);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  const left = Math.min(anchor.left, window.innerWidth - 300);
  return <div className="v3-menu" style={{ left: Math.max(8, left), top: anchor.bottom + 6 }}>{children}</div>;
}

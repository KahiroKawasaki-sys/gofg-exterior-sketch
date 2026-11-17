// ライセンスの入口（ネイティブの Pro 版だけ）。キー入力 → 登録。別の端末で使用中なら切り替えを確認する。
// 使っている途中で別の端末に移された・停止された・7日以上確認できないときは、画面の上に重ねてロックする（図面は消さない・編集中の画面も残す）。
// App Store 3.1.3 のため、価格・購入・申込みの案内は置かない。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, Lock, PenTool } from 'lucide-react';
import { activate, check, evaluate, forget, licenseRequired, loadState, onLicenseChange, release, type LicenseState, type LockReason } from './license';
import './license.css';

type Phase = { k: 'enter'; error?: string } | { k: 'checking' } | { k: 'conflict'; key: string; deviceName: string; since: string } | { k: 'locked'; reason: LockReason } | { k: 'ok' };
const RECHECK_MS = 60_000;

const LOCK_TEXT: Record<LockReason, { title: string; body: string }> = {
  moved: { title: '別の端末で使用中です', body: 'このキーは別の端末に切り替えられました。この端末で続けるには、キーを入力して切り替えてください。' },
  suspended: { title: 'このキーは利用停止中です', body: '担当者へお問い合わせください。' },
  expired: { title: 'このキーの有効期限が切れています', body: '担当者へお問い合わせください。' },
  invalid: { title: 'ライセンスを確認できません', body: 'キーを入力し直してください。' },
  offline: { title: 'ライセンスを確認できません', body: '最後の確認から7日を過ぎました。インターネットにつないで「もう一度確認」を押してください。' },
};

const sinceLabel = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : `${d.getMonth() + 1}月${d.getDate()}日から使用中`; };

function initial(): Phase {
  const g = evaluate(loadState());
  if (g === 'ok') return { k: 'ok' };
  if (g === 'stale') return { k: 'checking' };
  if (g === 'locked') return { k: 'locked', reason: loadState()?.locked || 'invalid' };
  return { k: 'enter' };
}

export function LicenseGate({ children }: { children: ReactNode }) {
  if (!licenseRequired()) return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(initial);
  const [shown, setShown] = useState(phase.k === 'ok');
  const last = useRef(0);
  useEffect(() => { if (phase.k === 'ok') setShown(true); }, [phase.k]);

  // サーバーに確認する。断られたらロック。通信できなければ、7日を過ぎていればロック
  const verify = async (force = false) => {
    if (!force && Date.now() - last.current < RECHECK_MS) return;
    last.current = Date.now();
    const r = await check();
    if (r === 'ok') setPhase({ k: 'ok' });
    else if (r === 'none') setPhase({ k: 'enter' });
    else if (r === 'offline') setPhase(p => evaluate(loadState()) === 'ok' ? (p.k === 'checking' ? { k: 'ok' } : p) : { k: 'locked', reason: 'offline' });
    else setPhase({ k: 'locked', reason: r });
  };

  useEffect(() => {
    if (phase.k === 'ok' || phase.k === 'checking') void verify(true);
    const visible = () => { if (document.visibilityState === 'visible' && loadState()) void verify(); };
    document.addEventListener('visibilitychange', visible);
    const off = onLicenseChange(s => {
      if (!s) setPhase({ k: 'enter' });
      else if (s.locked && s.locked !== 'offline') setPhase({ k: 'locked', reason: s.locked });
    });
    return () => { document.removeEventListener('visibilitychange', visible); off(); };
    // 起動時に1回だけ
  }, []);

  if (phase.k === 'ok') return <>{children}</>;
  return <>
    {shown && children}
    <div className={'lic-screen' + (shown ? ' over' : '')} role="dialog" aria-modal="true" aria-label="ライセンス">
      <div className="lic-card">
        <div className="lic-brand"><span className="lic-logo"><PenTool size={18} /></span><b>外構スケッチ Pro</b></div>
        {phase.k === 'checking' && <p className="lic-lead">ライセンスを確認しています…</p>}
        {phase.k === 'enter' && <KeyForm error={phase.error} onDone={setPhase} />}
        {phase.k === 'conflict' && <Conflict phase={phase} onDone={setPhase} />}
        {phase.k === 'locked' && <Locked reason={phase.reason} onRetry={() => verify(true)} onKey={() => setPhase({ k: 'enter' })} />}
      </div>
    </div>
  </>;
}

function KeyForm({ error, onDone }: { error?: string; onDone: (p: Phase) => void }) {
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(error || '');
  const submit = async () => {
    if (busy || key.replace(/[^A-Za-z0-9]/g, '').length < 12) { setErr('キーを最後まで入力してください。'); return; }
    setBusy(true); setErr('');
    const r = await activate(key);
    setBusy(false);
    if (r.kind === 'ok') onDone({ k: 'ok' });
    else if (r.kind === 'inUse') onDone({ k: 'conflict', key, deviceName: r.deviceName, since: r.since });
    else setErr(r.message);
  };
  return <form className="lic-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <h1><KeyRound size={18} />ライセンスキーを入力してください</h1>
    <input className="lic-input" aria-label="ライセンスキー" placeholder="GS-XXXX-XXXX-XXXX-XXXX" value={key} autoFocus
      autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
      onChange={e => setKey(e.target.value.toUpperCase())} />
    {err && <p className="lic-err" role="alert">{err}</p>}
    <button className="lic-btn primary" type="submit" disabled={busy}>{busy ? '確認しています…' : 'はじめる'}</button>
    <p className="lic-note">キーは契約時にお渡ししています。お問い合わせは担当者へ。<br />1つのキーで同時に使える端末は1台です。</p>
  </form>;
}

function Conflict({ phase, onDone }: { phase: Extract<Phase, { k: 'conflict' }>; onDone: (p: Phase) => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    const r = await activate(phase.key, true);
    setBusy(false);
    if (r.kind === 'ok') onDone({ k: 'ok' }); else if (r.kind === 'error') setErr(r.message); else setErr('切り替えが重なりました。もう一度お試しください。');
  };
  const since = sinceLabel(phase.since);
  return <div className="lic-form">
    <h1>このキーは別の端末で使われています</h1>
    <p className="lic-lead">別の端末（<b>{phase.deviceName || '名前のない端末'}</b>{since && `・${since}`}）で使われています。<br />この端末に切り替えますか？（前の端末では使えなくなります）</p>
    {err && <p className="lic-err" role="alert">{err}</p>}
    <button className="lic-btn primary" disabled={busy} onClick={go}>{busy ? '切り替えています…' : 'この端末に切り替える'}</button>
    <button className="lic-btn" disabled={busy} onClick={() => onDone({ k: 'enter' })}>やめる</button>
    <p className="lic-note">切り替えは月2回までです。それ以上は担当者へご連絡ください。</p>
  </div>;
}

function Locked({ reason, onRetry, onKey }: { reason: LockReason; onRetry: () => Promise<void>; onKey: () => void }) {
  const [busy, setBusy] = useState(false);
  const t = LOCK_TEXT[reason];
  return <div className="lic-form">
    <h1><Lock size={18} />{t.title}</h1>
    <p className="lic-lead">{t.body}</p>
    <p className="lic-note">描いた図面はこの端末に残っています。</p>
    {(reason === 'moved' || reason === 'invalid') && <button className="lic-btn primary" onClick={onKey}>キーを入力する</button>}
    <button className={'lic-btn' + (reason === 'offline' ? ' primary' : '')} disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false); }}>{busy ? '確認しています…' : 'もう一度確認'}</button>
    {(reason === 'suspended' || reason === 'expired') && <button className="lic-btn" onClick={() => { forget(); onKey(); }}>別のキーを入力する</button>}
  </div>;
}

// 設定パネルの「ライセンス」欄
export function LicenseCard() {
  const [s, setS] = useState<LicenseState | null>(loadState);
  const [busy, setBusy] = useState(false);
  useEffect(() => onLicenseChange(setS), []);
  if (!licenseRequired() || !s) return null;
  const date = (v: number) => new Date(v).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <section className="v3-card lic-settings"><h4>ライセンス</h4>
    <p className="v3-note">会社名：{s.clientName || '—'}<br />有効期限：{s.expiresAt ? s.expiresAt.replace(/-/g, '/') + ' まで' : '期限なし'}<br />最後の確認：{date(s.checkedAt)}</p>
    <button className="v3-btn danger" disabled={busy} onClick={async () => {
      if (!confirm('この端末の登録を外しますか？\n外したあとは、キーを入力するまでこの端末では使えません（図面は消えません）。')) return;
      setBusy(true); await release(); setBusy(false);
    }}>この端末の登録を外す</button>
  </section>;
}

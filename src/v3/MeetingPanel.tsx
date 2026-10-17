// 打ち合わせパネル：会話を聞いて文字にし、AIが読み取った要望をカードで出す。カードから図面・見積に反映できる
import { useEffect, useRef, useState } from 'react';
import { X, Mic, Square, Sparkles, Check, Plus, ChevronDown } from 'lucide-react';
import { type Doc, type LibItem, type Meeting } from './types';
import { listen, speechAvailable, readRequests, applyAction, actionLabel } from './meeting';
import { quantities, textureAreas } from './quantities';
import { buildEstimate, type PriceBook } from './estimate';

const AUTO_MS = 10 * 60 * 1000; // 話している間は10分ごとに読み取る（新しい会話があるときだけ）
// AI利用料の目安（1Mトークンあたり 入力5ドル・出力25ドル、1ドル200円）
const costYen = (u: { input: number; output: number }) => (u.input * 5 + u.output * 25) / 1e6 * 200;
const hhmm = (iso: string) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const jpy = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const EMPTY: Meeting = { lines: [], requests: [] };

// hidden：たたんでいる間も聞き取りは続け、小さな表示だけ出す
export function MeetingPanel({ doc, lib, book, onDoc, onMeeting, onClose, onHide, hidden, toast }: {
  doc: Doc; lib: LibItem[]; book: PriceBook; onDoc: (f: (d: Doc) => Doc, label: string) => void; onMeeting: (f: (m: Meeting) => Meeting) => void;
  onClose: () => void; onHide: (hide: boolean) => void; hidden?: boolean; toast: (m: string) => void;
}) {
  const m = doc.meeting || EMPTY;
  const [on, setOn] = useState(false), [interim, setInterim] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [memo, setMemo] = useState(''), [showLog, setShowLog] = useState(false), [spent, setSpent] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  const docRef = useRef(doc); docRef.current = doc;
  const readCount = useRef(m.lines.length);
  const setMeeting = (f: (mm: Meeting) => Meeting) => onMeeting(f);
  const addLine = (text: string) => setMeeting(mm => ({ ...mm, lines: [...mm.lines, { t: new Date().toISOString(), text }] }));

  const read = async () => {
    const cur = docRef.current.meeting || EMPTY;
    if (!cur.lines.length || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await readRequests(cur, book);
      readCount.current = cur.lines.length;
      if (r.usage) setSpent(s => s + costYen(r.usage!));
      setMeeting(mm => ({ ...mm, requests: r.requests, readAt: new Date().toISOString() }));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const readRef = useRef(read); readRef.current = read;

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { if ((docRef.current.meeting?.lines.length || 0) > readCount.current) readRef.current(); }, AUTO_MS);
    return () => clearInterval(t);
  }, [on]);
  const toggle = () => {
    if (on) { stopRef.current(); setOn(false); setInterim(''); return; }
    setErr(''); setOn(true);
    stopRef.current = listen(addLine, setInterim, msg => { setErr(msg); setOn(false); });
  };

  // 予算と見積の比べ
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!m.budget) return;
    let alive = true;
    const t = setTimeout(() => textureAreas(doc).then(a => alive && setTotal(buildEstimate(quantities(doc, lib, a), book, doc.est).total)), 400);
    return () => { alive = false; clearTimeout(t); };
  }, [doc, lib, book, m.budget]);

  const apply = (id: string) => {
    const q = m.requests.find(r => r.id === id); if (!q?.action) return;
    let msg = '';
    onDoc(d => {
      const r = applyAction(d, q.action!, book); msg = r.message;
      if (r.doc === d) return d;
      const mm = r.doc.meeting || EMPTY;
      return { ...r.doc, meeting: { ...mm, requests: mm.requests.map(x => x.id === id ? { ...x, applied: true } : x) } };
    }, '要望を反映');
    setTimeout(() => msg && toast(msg), 0);
  };
  const drop = (id: string) => setMeeting(mm => ({ ...mm, requests: mm.requests.map(x => x.id === id ? { ...x, status: '不要' } : x) }));
  const live = m.requests.filter(r => r.status !== '不要'), kinds = [...new Set(live.map(r => r.kind))];
  const canSpeak = speechAvailable();

  if (hidden) return (
    <button className={'v3-meet-pill' + (on ? ' on' : '')} onClick={() => onHide(false)}>
      {on ? <><i className="dot" />聞き取り中</> : <><Mic size={14} />打ち合わせ</>}{live.length > 0 && <b>{live.length}</b>}
    </button>
  );
  return (
    <div className="v3-panel v3-qty v3-meet sheet" aria-label="打ち合わせ">
      <div className="v3-qty-head"><b>打ち合わせ</b><span className="sp" />
        <button className="v3-ib" onClick={() => onHide(true)} aria-label="たたむ（聞き取りは続けます）" title="たたむ（聞き取りは続けます）"><ChevronDown size={16} /></button>
        <button className="v3-ib" onClick={() => { stopRef.current(); onClose(); }} aria-label="打ち合わせを閉じる"><X size={16} /></button>
      </div>

      <div className="v3-meet-ctl">
        <button className={'v3-meet-mic' + (on ? ' on' : '')} onClick={toggle} disabled={!canSpeak}>
          {on ? <><Square size={16} />聞き取りを止める</> : <><Mic size={18} />会話の聞き取りを始める</>}
        </button>
        <button className="v3-btn" onClick={read} disabled={busy || !m.lines.length}><Sparkles size={14} />{busy ? '読み取り中…' : 'AIで要望を読み取る'}</button>
      </div>
      {on && <p className="v3-meet-live"><i className="dot" />聞いています{interim ? `：${interim}` : '…'}</p>}
      {!canSpeak && <p className="v3-note pad">この画面では音声認識が使えません（iPadのSafariやパソコンのChromeで使えます）。下のメモ欄に打ち込んでも、AIが読み取れます。</p>}
      {err && <p className="v3-meet-err">{err}</p>}
      <div className="v3-meet-memo">
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="メモを足す（例：駐車場は2台、芝生にしたい）" aria-label="メモを足す"
          onKeyDown={e => { if (e.key === 'Enter' && memo.trim() && !e.nativeEvent.isComposing) { addLine(memo.trim()); setMemo(''); } }} />
        <button className="v3-ib" aria-label="メモを足す" disabled={!memo.trim()} onClick={() => { addLine(memo.trim()); setMemo(''); }}><Plus size={16} /></button>
      </div>

      {m.budget != null && (
        <div className="v3-meet-budget">
          <span>予算 <b>{jpy(m.budget)}</b></span>
          {total != null && <span>見積 <b>{jpy(total)}</b>（{total > m.budget ? <em className="over">{jpy(total - m.budget)} 超え</em> : <em>残り {jpy(m.budget - total)}</em>}）</span>}
        </div>
      )}

      {!live.length && <p className="v3-note pad">{m.lines.length ? '「AIで要望を読み取る」を押すと、会話からお客様の要望をカードにします。聞き取り中は10分ごとに自動で読み取ります。' : '聞き取りを始めるか、メモを足してください。会話の録音は保存しません。'}</p>}
      {kinds.map(k => (
        <section key={k} className="v3-qty-group">
          <h4>{k}</h4>
          {live.filter(r => r.kind === k).map(r => (
            <div key={r.id} className={'v3-meet-card s-' + r.status}>
              <div className="top"><em className="st">{r.status}</em><span className="tx">{r.text}</span>
                <button className="v3-ib" aria-label={`「${r.text}」を外す`} onClick={() => drop(r.id)}><X size={13} /></button></div>
              {r.quote && <p className="qt">「{r.quote}」</p>}
              {r.action && (r.applied ? <span className="done"><Check size={13} />反映しました：{actionLabel(r.action)}</span>
                : <button className="v3-btn primary" onClick={() => apply(r.id)}>反映：{actionLabel(r.action)}</button>)}
            </div>
          ))}
        </section>
      ))}

      <section className="v3-qty-group">
        <h4><button className="v3-link" onClick={() => setShowLog(v => !v)}>{showLog ? '会話の記録を閉じる' : `会話の記録を見る（${m.lines.length}件）`}</button></h4>
        {showLog && <div className="v3-meet-log">{m.lines.slice(-200).map((l, i) => <p key={i}><time>{hhmm(l.t)}</time>{l.text}</p>)}</div>}
      </section>
      <p className="v3-note pad">会話の文字とAIが読み取った要望は、この図面と一緒に保存されます。録音そのものは残しません。{spent > 0 && `今回のAI利用料の目安：約${Math.max(1, Math.round(spent))}円。`}</p>
    </div>
  );
}

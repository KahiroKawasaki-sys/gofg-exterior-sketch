// 打ち合わせパネル：① 録音する → ② 文字にする（自動） → ③ 議事録にする（AI）
// 文字にした全文（時刻つき）と議事録は、それぞれコピー・共有・ファイル保存できる。
// 要望の読み取り・図面／見積への反映は一旦やめている（下の LegacyRequestCards に残す。画面からは使わない）
import { useEffect, useRef, useState } from 'react';
import { X, Mic, Square, Sparkles, Check, Plus, ChevronDown, Share2, RotateCcw, Play, Pencil, Download } from 'lucide-react';
import { type Doc, type LibItem, type Meeting, type MeetLine } from './types';
import { applyAction, actionLabel, summaryText, makeMinutes, transcriptExport, exportFileName } from './meeting';
import { audioSource, recordingAvailable, Transcriber, toMeetLines, sortLines, mmss, type AudioSource, type Chunk, type SegState, type RecorderState } from './recorder';
import { quantities, textureAreas } from './quantities';
import { buildEstimate, type PriceBook } from './estimate';
import { isNativeApp, nativeRecorder, shareText, saveFile } from './platform';

// AI利用料の目安（Opus 5.5：1Mトークンあたり 入力4ドル・出力20ドル、1ドル200円）
const costYen = (u: { input: number; output: number }) => (u.input * 4 + u.output * 20) / 1e6 * 200;
const hhmm = (iso: string) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const jpy = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const EMPTY: Meeting = { lines: [], requests: [] };
const ORDER = { '決定': 0, '要望': 1, '検討中': 2, '不要': 3 } as const;

type Phase = 'idle' | 'recording' | 'transcribing' | 'writing' | 'done';

// hidden：たたんでいる間も録音・文字起こしは続け、小さな表示だけ出す
export function MeetingPanel({ doc, book, onMeeting, onClose, onHide, hidden, toast, onVideo }: {
  doc: Doc; lib: LibItem[]; book: PriceBook; onDoc: (f: (d: Doc) => Doc, label: string) => void; onMeeting: (f: (m: Meeting) => Meeting) => void;
  onClose: () => void; onHide: (hide: boolean) => void; hidden?: boolean; toast: (m: string) => void; onVideo?: () => void;
}) {
  const m = doc.meeting || EMPTY;
  const [rec, setRec] = useState<RecorderState>('idle'), [recMsg, setRecMsg] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [segs, setSegs] = useState<SegState[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [memo, setMemo] = useState(''), [spent, setSpent] = useState(0);
  const [edit, setEdit] = useState<{ i: number; text: string } | null>(null);
  const [editMin, setEditMin] = useState<string | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const srcRef = useRef<AudioSource | null>(null), trRef = useRef<Transcriber | null>(null);
  const chunks = useRef(new Map<number, Chunk>()), startedAt = useRef(0);
  const setMeeting = (f: (mm: Meeting) => Meeting) => onMeeting(f);
  const addLine = (text: string) => setMeeting(mm => ({ ...mm, lines: [...mm.lines, { t: new Date().toISOString(), text }] }));
  const terms = () => [...new Set(book.items.map(i => i.name.replace(/[（(].*?[）)]/g, '').trim()))].filter(Boolean).slice(0, 60).join('、');

  // ---- ③ 議事録を作る ----
  const write = async () => {
    const cur = docRef.current.meeting || EMPTY;
    if (!cur.lines.length || busy) return;
    setBusy(true); setErr(''); setPhase('writing'); setEditMin(null);
    try {
      const r = await makeMinutes(cur, { name: docRef.current.name });
      if (r.usage) setSpent(s => s + costYen(r.usage!));
      setMeeting(mm => ({ ...mm, minutes: r.minutes, minutesAt: new Date().toISOString(), minutesLines: cur.lines.length }));
      setPhase('done');
    } catch (e) { setErr((e as Error).message); setPhase('idle'); }
    finally { setBusy(false); }
  };
  const writeRef = useRef(write); writeRef.current = write;

  // ---- ① 録音 → ② 文字起こし ----
  const transcriber = () => trRef.current ??= new Transcriber({
    terms,
    onLines: (_i, lines) => { if (lines.length) setMeeting(mm => ({ ...mm, lines: sortLines([...mm.lines, ...toMeetLines(startedAt.current, lines)]) })); },
    onState: setSegs,
    discard: async c => { if (c.path && isNativeApp()) await nativeRecorder().discard({ path: c.path }); },
  });
  const startRec = async () => {
    setErr(''); setRecMsg('');
    const tr = transcriber();
    const src = audioSource(c => { chunks.current.set(c.i, c); tr.add(c); }, (s, msg) => { setRec(s); setRecMsg(msg || ''); if (s === 'error' && msg) toast(msg); });
    try {
      startedAt.current = Date.now(); srcRef.current = src;
      await src.start();
      setPhase('recording'); setElapsed(0);
      setMeeting(mm => ({ ...mm, startedAt: mm.startedAt || new Date(startedAt.current).toISOString() }));
    } catch (e) { srcRef.current = null; setRec('idle'); setErr((e as Error).message || '録音を始められませんでした'); }
  };
  const stopRec = async () => {
    const src = srcRef.current; srcRef.current = null;
    setPhase('transcribing');
    try { await src?.stop(); } catch { /* 止め損ねても続ける */ }
    setRec('idle');
    await transcriber().flush();
    await new Promise(r => setTimeout(r, 120)); // 文字の行が図面に入って描画されるのを待つ（docRef が最新になる）
    const cur = docRef.current.meeting || EMPTY;
    // 止めたら、全部の文字から議事録を作る（前に作ったときより会話が増えていれば）
    if (cur.lines.length > (cur.minutesLines || 0)) await writeRef.current(); else setPhase(cur.lines.length ? 'done' : 'idle');
  };
  const retryFailed = () => {
    const failed = segs.filter(s => s.state === 'error').map(s => chunks.current.get(s.i)).filter((c): c is Chunk => !!c);
    if (!failed.length) return;
    transcriber().retry(failed); setPhase('transcribing');
    transcriber().flush().then(() => setPhase(p => p === 'transcribing' ? 'done' : p));
  };
  useEffect(() => () => { srcRef.current?.stop().catch(() => {}); }, []);
  useEffect(() => {
    if (rec !== 'recording') return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(t);
  }, [rec]);
  const recording = rec === 'recording' || rec === 'paused';
  const close = () => { if (recording) { toast('先に「録音を止める」を押してください'); return; } onClose(); };

  // ---- 送る・保存する（全文と議事録） ----
  const shareOut = async (kind: '文字起こし' | '議事録') => {
    const text = kind === '議事録' ? m.minutes || '' : transcriptExport(m, { name: doc.name });
    if (!text.trim()) return;
    const r = await shareText(text, `${doc.name} ${kind}`).catch(() => 'failed' as const);
    toast(r === 'copied' ? `${kind}をコピーしました。LINEやメールに貼り付けてください` : r === 'shared' ? `${kind}を送りました` : r === 'cancelled' ? 'やめました' : 'コピー・共有できませんでした。「ファイルで保存」をお試しください');
  };
  const saveOut = async (kind: '文字起こし' | '議事録') => {
    const text = kind === '議事録' ? m.minutes || '' : transcriptExport(m, { name: doc.name });
    if (!text.trim()) return;
    // BOM付きにして、Windowsのメモ帳などでも文字化けしないようにする
    const r = await saveFile(new Blob(['﻿' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), exportFileName(kind, doc.name, new Date()), `${kind}を保存・共有`).catch(e => (e as Error).message);
    toast(r === 'saved' ? `${kind}をファイルにしました` : r === 'cancelled' ? 'やめました' : r);
  };
  const saveEdit = () => { if (!edit) return; const t = edit.text.trim(); setMeeting(mm => ({ ...mm, lines: mm.lines.map((l, i) => i === edit.i ? { ...l, text: t } : l).filter(l => l.text) })); setEdit(null); };
  const saveMin = () => { if (editMin == null) return; const t = editMin.trim(); setMeeting(mm => ({ ...mm, minutes: t || undefined })); setEditMin(null); };

  const canRecord = recordingAvailable();
  const newLines = Math.max(0, m.lines.length - Math.min(m.minutesLines || 0, m.lines.length));
  const doneMs = segs.filter(s => s.state === 'done').reduce((a, s) => a + s.durMs, 0), totalMs = segs.reduce((a, s) => a + s.durMs, 0);
  const failed = segs.filter(s => s.state === 'error').length, sending = segs.some(s => s.state === 'queued' || s.state === 'sending');
  const stepNow = recording ? 1 : phase === 'transcribing' || sending ? 2 : 3;

  if (hidden) return (
    <button className={'v3-meet-pill' + (recording ? ' on' : sending ? ' busy' : '')} onClick={() => onHide(false)}>
      {recording ? <><i className="dot" />{rec === 'paused' ? '録音を中断中' : '録音中'} {mmss(elapsed)}</> : sending ? <><i className="dot" />文字にしています…</> : busy ? <><i className="dot" />議事録を作っています…</> : <><Mic size={14} />打ち合わせ</>}
      {!recording && !sending && !busy && m.lines.length > 0 && <b>{m.minutes ? '議事録あり' : `${m.lines.length}行`}</b>}
    </button>
  );
  return (
    <div className="v3-panel v3-qty v3-meet sheet" aria-label="打ち合わせ">
      <div className="v3-qty-head"><b>打ち合わせ</b><span className="sp" />
        {onVideo && <button className="sx-vbtn" onClick={onVideo}><Play size={12} />動画</button>}
        <button className="v3-ib" onClick={() => onHide(true)} aria-label="たたむ（録音は続けます）" title="たたむ（録音は続けます）"><ChevronDown size={16} /></button>
        <button className="v3-ib" onClick={close} aria-label="打ち合わせを閉じる"><X size={16} /></button>
      </div>

      <ol className="v3-meet-steps" aria-label="流れ">
        <li className={stepNow === 1 ? 'on' : recording || m.lines.length ? 'ok' : ''}><b>1</b>録音する</li>
        <li className={stepNow === 2 ? 'on' : m.lines.length ? 'ok' : ''}><b>2</b>文字にする<small>（自動）</small></li>
        <li className={busy ? 'on' : m.minutes ? 'ok' : ''}><b>3</b>議事録にする<small>（AI）</small></li>
      </ol>

      <div className="v3-meet-ctl">
        {recording
          ? <button className="v3-meet-mic on" onClick={stopRec}><Square size={16} />録音を止める<span className="tm">{mmss(elapsed)}</span></button>
          : <button className="v3-meet-mic" onClick={startRec} disabled={!canRecord || phase === 'transcribing' || busy}><Mic size={18} />{m.lines.some(l => l.from != null) ? '録音を再開する' : '録音を始める'}</button>}
        <button className="v3-btn" onClick={write} disabled={busy || recording || sending || !m.lines.length}><Sparkles size={14} />{busy ? '議事録を作っています…' : m.minutes ? (newLines > 0 ? `議事録を作り直す（新しい会話 ${newLines}行）` : '議事録を作り直す') : '議事録を作る'}</button>
      </div>
      <p className="v3-meet-consent">録音はお客様に一言伝えてから始めてください。音声と文字は、文字起こしと議事録づくりのために外部のAIサービスへ送られます。</p>
      {rec === 'paused' && <p className="v3-meet-live"><i className="dot pause" />{recMsg || '録音を中断しています'}</p>}
      {rec === 'recording' && <p className="v3-meet-live"><i className="dot" />録音しています。たたんで図面を描きながらでも続きます</p>}
      {(phase === 'transcribing' || sending || failed > 0) && (
        <div className="v3-meet-prog">
          <span>{sending || phase === 'transcribing' ? '文字にしています…' : '文字起こし'} <b>{mmss(doneMs)}</b>／{mmss(Math.max(totalMs, elapsed))}</span>
          <i><em style={{ width: `${totalMs ? Math.min(100, doneMs / totalMs * 100) : 0}%` }} /></i>
          {failed > 0 && !sending && <button className="v3-link" onClick={retryFailed}><RotateCcw size={12} />{failed}区切りを送り直す</button>}
        </div>
      )}
      {!canRecord && <p className="v3-note pad">この画面では録音できません（iPadのアプリ・Safari、パソコンのChromeで使えます）。下のメモ欄に打ち込んでも、議事録にできます。</p>}
      {err && <p className="v3-meet-err">{err}</p>}
      <div className="v3-meet-memo">
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="メモを足す（例：駐車場は2台、芝生にしたい）" aria-label="メモを足す"
          onKeyDown={e => { if (e.key === 'Enter' && memo.trim() && !e.nativeEvent.isComposing) { addLine(memo.trim()); setMemo(''); } }} />
        <button className="v3-ib" aria-label="メモを足す" disabled={!memo.trim()} onClick={() => { addLine(memo.trim()); setMemo(''); }}><Plus size={16} /></button>
      </div>

      {!m.lines.length && <p className="v3-note pad">「録音を始める」を押して、お客様と話してください。録音を止めると、話した言葉が全部文字になり、AIが議事録にまとめます。</p>}

      {(m.minutes || busy) && <section className="v3-qty-group v3-meet-minutes" aria-label="議事録">
        <h4>議事録{m.minutesAt && <small>（{hhmm(m.minutesAt)} に作成）</small>}</h4>
        {busy && !m.minutes ? <p className="v3-note">AIが議事録を作っています。少し待ってください…</p>
          : editMin != null
            ? <div className="v3-meet-minedit"><textarea value={editMin} onChange={e => setEditMin(e.target.value)} aria-label="議事録を直す" rows={12} />
              <div className="v3-meet-share"><button className="v3-btn primary" onClick={saveMin}><Check size={14} />直した内容を残す</button><button className="v3-btn" onClick={() => setEditMin(null)}>やめる</button></div></div>
            : <>
              <div className="v3-meet-doc">{m.minutes}</div>
              <div className="v3-meet-share">
                <button className="v3-btn" onClick={() => shareOut('議事録')}><Share2 size={14} />議事録をコピー・共有</button>
                <button className="v3-btn" onClick={() => saveOut('議事録')}><Download size={14} />ファイルで保存</button>
                <button className="v3-btn" onClick={() => setEditMin(m.minutes || '')} aria-label="議事録を直す"><Pencil size={13} />直す</button>
              </div>
            </>}
      </section>}

      {m.lines.length > 0 && <section className="v3-qty-group" aria-label="文字起こし">
        <h4>文字起こし（全文 {m.lines.length}行）</h4>
        <div className="v3-meet-log">
          {m.lines.map((l, i) => edit?.i === i
            ? <p key={i} className="ed"><input autoFocus value={edit.text} onChange={e => setEdit({ i, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveEdit(); if (e.key === 'Escape') setEdit(null); }} aria-label="行を直す" /><button className="v3-ib" aria-label="保存" onClick={saveEdit}><Check size={14} /></button></p>
            : <p key={i}><time>{lineTime(l)}</time>{l.text}<button className="v3-ib ed" aria-label="この行を直す" onClick={() => setEdit({ i, text: l.text })}><Pencil size={12} /></button></p>)}
        </div>
        <div className="v3-meet-share">
          <button className="v3-btn" onClick={() => shareOut('文字起こし')}><Share2 size={14} />全文をコピー・共有</button>
          <button className="v3-btn" onClick={() => saveOut('文字起こし')}><Download size={14} />ファイルで保存</button>
        </div>
        <p className="v3-note">全文には話した時刻がつきます。まちがった文字は、行の右のえんぴつで直せます。</p>
      </section>}
      <p className="v3-note pad">録音は文字にし終えると端末から消えます。音声は文字に変えるだけで保存しません。文字と議事録はこの図面と一緒に保存されます（編集データの書き出しには入りません）。{spent > 0 && `今回のAI利用料の目安：約${Math.max(1, Math.round(spent))}円。`}</p>
    </div>
  );
}

const lineTime = (l: MeetLine) => l.from != null ? mmss(l.from * 1000) : hhmm(l.t);

// ---- 一旦停止中：AIが読み取った要望のカード・図面／見積への反映・予算と見積の比べ ----
// 打ち合わせのサンプルを見て分類・反映の仕様を決め直すまで、画面には出さない。戻すときは MeetingPanel の中に置き、
// 「AIで要望を読み取る」（meeting.ts の readRequests）を呼ぶボタンを戻す。
export function LegacyRequestCards({ doc, lib, book, onDoc, onMeeting, toast }: {
  doc: Doc; lib: LibItem[]; book: PriceBook; onDoc: (f: (d: Doc) => Doc, label: string) => void; onMeeting: (f: (m: Meeting) => Meeting) => void; toast: (m: string) => void;
}) {
  const m = doc.meeting || EMPTY;
  const [showDone, setShowDone] = useState(false);
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
  const drop = (id: string) => onMeeting(mm => ({ ...mm, requests: mm.requests.map(x => x.id === id ? { ...x, status: '不要' } : x) }));
  const live = m.requests.filter(r => r.status !== '不要');
  const byStatus = (a: typeof live[number], b: typeof live[number]) => ORDER[a.status] - ORDER[b.status];
  const todo = live.filter(r => r.action && !r.applied).sort(byStatus), done = live.filter(r => r.action && r.applied), rest = live.filter(r => !r.action).sort(byStatus);
  const share = async () => {
    const text = summaryText(m, { total: total ?? undefined, name: doc.name });
    const r = await shareText(text, `${doc.name} 打ち合わせまとめ`).catch(() => 'failed' as const);
    toast(r === 'copied' ? 'まとめをコピーしました。LINEやメールに貼り付けてください' : r === 'shared' ? 'まとめを共有しました' : r === 'cancelled' ? '共有をキャンセルしました' : '共有できませんでした');
  };
  return <>
    {m.budget != null && (
      <div className="v3-meet-budget">
        <span>予算 <b>{jpy(m.budget)}</b></span>
        {total != null && <span>見積 <b>{jpy(total)}</b>（{total > m.budget ? <em className="over">{jpy(total - m.budget)} 超え</em> : <em>残り {jpy(m.budget - total)}</em>}）</span>}
      </div>
    )}
    {todo.length > 0 && <section className="v3-qty-group"><h4>図面・見積に反映できます</h4>{todo.map(r => <Card key={r.id} r={r} onApply={apply} onDrop={drop} />)}</section>}
    {rest.length > 0 && <section className="v3-qty-group"><h4>要望・決まったこと</h4>{rest.map(r => <Card key={r.id} r={r} onApply={apply} onDrop={drop} />)}</section>}
    {done.length > 0 && <section className="v3-qty-group"><h4><button className="v3-link" onClick={() => setShowDone(v => !v)}>{showDone ? '反映済みを閉じる' : `反映済み（${done.length}件）を見る`}</button></h4>{showDone && done.map(r => <Card key={r.id} r={r} onApply={apply} onDrop={drop} />)}</section>}
    {live.length > 0 && <div className="v3-meet-share"><button className="v3-btn" onClick={share}><Share2 size={14} />まとめをコピー・共有</button><span className="v3-note">決定・要望・予算を箇条書きにして、LINEやメールに貼れます</span></div>}
  </>;
}

function Card({ r, onApply, onDrop }: { r: Meeting['requests'][number]; onApply: (id: string) => void; onDrop: (id: string) => void }) {
  return (
    <div className={'v3-meet-card s-' + r.status}>
      <div className="top"><em className="st">{r.status}</em><span className="tx">{r.text}</span>
        <button className="v3-ib" aria-label={`「${r.text}」を外す`} onClick={() => onDrop(r.id)}><X size={13} /></button></div>
      {r.quote && <p className="qt">「{r.quote}」</p>}
      {r.action && (r.applied ? <span className="done"><Check size={13} />反映しました：{actionLabel(r.action)}</span>
        : <button className="v3-btn primary" onClick={() => onApply(r.id)}>反映：{actionLabel(r.action)}</button>)}
    </div>
  );
}

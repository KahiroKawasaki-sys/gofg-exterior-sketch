import { it, expect, vi } from 'vitest';
import { mergeRequests, applyAction, actionLabel, summaryText, unreadCount, timedTranscript, transcriptExport, exportFileName, makeMinutes } from '../src/v3/meeting';

// 要望の読み取り・反映（一旦停止中。コードは残しているので、壊れていないことだけ確かめる）
import { defaultBook } from '../src/v3/estimate';
import { newDoc, uid, type Doc, type Item } from '../src/v3/types';

const withItems = (items: Item[]): Doc => { const d = newDoc(); return { ...d, layers: d.layers.map((l, i) => i === 1 ? { ...l, items } : l) }; };
const line = (role3?: 'fence' | 'wall'): Item => ({ id: uid(), type: 'line', kind: 'polyline', color: '#000', width: 3, dash: 'solid', pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }], role3 }) as Item;

it('AIの返事を取り込む：前回と同じidは反映済みを引き継ぎ、おかしな値は捨てる', () => {
  const prev = mergeRequests([], [{ id: '', kind: '塀・フェンス', text: '目隠しフェンスは1.8m', status: '決定', action: { type: 'height', role: 'fence', mm: 1800 } }]);
  expect(prev[0]).toMatchObject({ kind: '塀・フェンス', status: '決定', action: { type: 'height', role: 'fence', mm: 1800 } });
  prev[0].applied = true;
  const next = mergeRequests(prev, [
    { id: prev[0].id, kind: '塀・フェンス', text: '目隠しフェンスは1.8m（道路側だけ）', status: '決定', action: { type: 'height', role: 'fence', mm: 1800 } },
    { id: 'x', kind: '謎', text: '駐車場は2台', status: '?', action: { type: 'height', role: 'fence', mm: 99999 } },
    { id: '', kind: '予算', text: '', status: '要望' },
    { kind: '予算', text: '予算は300万円くらい', status: '要望', action: { type: 'budget', yen: 3000000 } },
  ]);
  expect(next).toHaveLength(3);
  expect(next[0]).toMatchObject({ id: prev[0].id, applied: true });
  expect(next[1]).toMatchObject({ kind: 'その他', status: '要望' });
  expect(next[1].action).toBeUndefined(); // 高さ 99m は捨てる
  expect(next[1].id).not.toBe('x');
  expect(actionLabel(next[2].action!)).toBe('予算を 3,000,000円 にする');
});

it('反映：フェンスの高さ・見積の追加項目・予算', () => {
  const book = defaultBook(), d = withItems([line('fence'), line('fence'), line()]);
  const h = applyAction(d, { type: 'height', role: 'fence', mm: 1800 }, book);
  expect(h.message).toContain('フェンス 2本');
  expect(h.doc.layers[1].items.map(i => (i as { h3?: number }).h3)).toEqual([1800, 1800, undefined]);
  expect(applyAction(withItems([]), { type: 'height', role: 'fence', mm: 1800 }, book).message).toContain('まだありません');
  const x = applyAction(d, { type: 'extra', name: '立水栓（給水工事共）' }, book);
  expect(x.doc.est?.extras?.[0]).toMatchObject({ name: '立水栓（給水工事共）', price: 60000, qty: 1 });
  const y = applyAction(d, { type: 'extra', name: '宅配ボックス', qty: 1, unit: '台' }, book);
  expect(y.doc.est?.extras?.[0]).toMatchObject({ name: '宅配ボックス', price: 0, unit: '台' });
  expect(y.message).toContain('単価が未定');
  expect(applyAction(d, { type: 'budget', yen: 3000000 }, book).doc.meeting?.budget).toBe(3000000);
});

it('まとめ：決定→要望→検討中の順に箇条書き。予算と見積、反映済みの印。不要は出さない', () => {
  const m = { lines: [], requests: [
    { id: 'a', kind: '塀・フェンス', text: '目隠しフェンスは1.8m', status: '決定' as const, action: { type: 'height' as const, role: 'fence' as const, mm: 1800 }, applied: true },
    { id: 'b', kind: '植栽', text: 'シンボルツリーがほしい', status: '要望' as const },
    { id: 'c', kind: '駐車場', text: '3台目はやめる', status: '不要' as const },
    { id: 'd', kind: '設備', text: '宅配ボックスを検討', status: '検討中' as const },
  ], budget: 3000000 };
  const t = summaryText(m, { total: 3250000, name: '山田様邸', now: new Date(2026, 10, 8) });
  expect(t.split('\n')).toEqual([
    '【打ち合わせまとめ】 山田様邸', '2026/11/8', '',
    '■決まったこと', '・目隠しフェンスは1.8m（フェンスの高さを 1.8m にする：反映済み）',
    '■ご要望', '・シンボルツリーがほしい',
    '■検討中', '・宅配ボックスを検討', '',
    '■ご予算 3,000,000円', '　概算見積 3,250,000円（250,000円 超過）',
  ]);
  expect(summaryText({ lines: [], requests: [] }, { now: new Date(2026, 10, 8) })).toContain('要望はまだありません');
  expect(unreadCount({ lines: [{ t: '', text: 'a' }, { t: '', text: 'b' }], requests: [] }, 1)).toBe(1);
  expect(unreadCount({ lines: [{ t: '', text: 'a' }], requests: [] }, 5)).toBe(0);
});

it('文字起こしの全文：行ごとに[時:分:秒 / 録音からの時間]。メモは「メモ」。ファイル名は使えない文字を除く', () => {
  const t0 = new Date(2026, 10, 17, 10, 30, 0);
  const at = (s: number) => new Date(t0.getTime() + s * 1000).toISOString();
  const m = { startedAt: t0.toISOString(), requests: [], lines: [
    { t: at(5), text: '駐車場は2台ほしいです', from: 5, to: 8 },
    { t: at(75), text: '芝生にしたい' },
    { t: at(125), text: '予算は300万円くらい', from: 125.4, to: 130 },
  ] };
  expect(timedTranscript(m).split('\n')).toEqual([
    '[10:30:05 / 0:05] 駐車場は2台ほしいです',
    '[10:31:15 / メモ] 芝生にしたい',
    '[10:32:05 / 2:05] 予算は300万円くらい',
  ]);
  const all = transcriptExport(m, { name: '山田様邸' }).split('\n');
  expect(all[0]).toBe('【打ち合わせ 文字起こし（全文）】 山田様邸');
  expect(all[1]).toBe('開始：2026/11/17 10:30　行数：3');
  expect(all.slice(-3)).toEqual(timedTranscript(m).split('\n'));
  expect(exportFileName('議事録', '山田/様:邸', t0)).toBe('山田_様_邸_議事録_20261117-1030.txt');
  expect(exportFileName('文字起こし', '', t0)).toBe('打ち合わせ_文字起こし_20261117-1030.txt');
});

it('議事録：同じ口に mode:minutes で時刻つきの全文を送り、返ってきた文章を使う', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ minutes: '  【打ち合わせ議事録】\n日時：2026/11/17 10:30  ', usage: { input: 10, output: 5 } }), { status: 200 }));
  const t0 = new Date(2026, 10, 17, 10, 30, 0);
  const m = { startedAt: t0.toISOString(), requests: [], lines: [{ t: new Date(t0.getTime() + 5000).toISOString(), text: '駐車場は2台', from: 5 }] };
  const r = await makeMinutes(m, { name: '山田様邸' });
  expect(r.minutes).toBe('【打ち合わせ議事録】\n日時：2026/11/17 10:30');
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/ai/meeting');
  expect(JSON.parse(String((init as RequestInit).body))).toEqual({ mode: 'minutes', transcript: '[10:30:05 / 0:05] 駐車場は2台', name: '山田様邸', date: '2026/11/17 10:30' });
  spy.mockResolvedValue(new Response(JSON.stringify({ error: 'AIが混み合っています' }), { status: 503 }));
  await expect(makeMinutes(m)).rejects.toThrow('混み合って');
  spy.mockResolvedValue(new Response(JSON.stringify({ minutes: '' }), { status: 200 }));
  await expect(makeMinutes(m)).rejects.toThrow('議事録を作れませんでした');
  spy.mockRestore();
});

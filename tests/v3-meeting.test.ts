import { it, expect } from 'vitest';
import { mergeRequests, applyAction, actionLabel } from '../src/v3/meeting';
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

import { it, expect, vi } from 'vitest';
vi.mock('../src/v3/platform', () => ({ apiPost: vi.fn(), blobBase64: vi.fn(), isNativeApp: () => false, nativeRecorder: vi.fn() }));
import { Transcriber, pickMime, toMeetLines, sortLines, mmss, type Chunk } from '../src/v3/recorder';

const chunk = (i: number, durMs = 180000): Chunk => ({ i, startMs: i * durMs, durMs, base64: 'QUJD', mime: 'audio/mp4', path: `/rec/${i}.m4a` });
const ok = (lines: unknown[]) => ({ ok: true, status: 200, data: { lines } });

it('区切りを順に1つずつ送り、行を返し、送れた音声は消す', async () => {
  const post = vi.fn(async (c: Chunk, _terms: string) => ok([{ from: c.startMs / 1000 + 1, to: c.startMs / 1000 + 2, text: `区切り${c.i}` }]));
  const got: [number, unknown][] = [], discard = vi.fn(async () => {}), states: string[][] = [];
  const t = new Transcriber({ post, onLines: (i, l) => got.push([i, l]), discard, onState: s => states.push(s.map(x => x.state)), terms: () => '乱形石' });
  t.add(chunk(1)); t.add(chunk(0));
  await t.flush();
  expect(got.map(g => g[0])).toEqual([1, 0]); // 先に届いた順に送る（並びは行の時刻で直す）
  expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[0][1]).toBe('乱形石');
  expect(discard).toHaveBeenCalledTimes(2);
  expect(t.segments.map(s => s.state)).toEqual(['done', 'done']);
  expect(t.doneMs).toBe(360000); expect(t.busy).toBe(false);
  expect(states.at(-1)).toEqual(['done', 'done']);
});

it('失敗は待って再試行し、使い切ったら error にする。413・401 は再試行しない', async () => {
  const post = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 502, data: { error: '失敗' } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ok([{ from: 0, to: 1, text: 'やっと' }]));
  const waits: number[] = [], got: unknown[] = [];
  const t = new Transcriber({ post, onLines: (_i, l) => got.push(...l), wait: async ms => { waits.push(ms); } });
  t.add(chunk(0)); await t.flush();
  expect(waits).toEqual([2000, 5000]); expect(got).toHaveLength(1); expect(t.segments[0].tries).toBe(3);

  const big = new Transcriber({ post: vi.fn(async () => ({ ok: false, status: 413, data: { error: '音声が長すぎます' } })), onLines: () => {}, wait: async () => {} });
  big.add(chunk(0)); await big.flush();
  expect(big.segments[0]).toMatchObject({ state: 'error', tries: 1, error: '音声が長すぎます' });

  const dead = new Transcriber({ post: vi.fn(async () => ({ ok: false, status: 500, data: {} })), onLines: () => {}, wait: async () => {}, maxTries: 2 });
  dead.add(chunk(0)); await dead.flush();
  expect(dead.segments[0].state).toBe('error'); expect(dead.segments[0].error).toContain('2回');
  // やり直し
  (dead as unknown as { o: { post: unknown } }).o.post = vi.fn(async () => ok([]));
  dead.retry([chunk(0)]); await dead.flush();
  expect(dead.segments[0].state).toBe('done');
});

it('録音開始からの秒を実時刻にし、区切りが前後しても会話の順に並ぶ', () => {
  const t0 = Date.parse('2026-11-08T10:00:00Z');
  const a = toMeetLines(t0, [{ from: 185, to: 190, text: '後' }]), b = toMeetLines(t0, [{ from: 3.5, to: 6, text: '先' }]);
  expect(a[0].t).toBe('2026-11-08T10:03:05.000Z');
  expect(sortLines([...a, ...b]).map(l => l.text)).toEqual(['先', '後']);
  expect(sortLines([{ t: '2026-11-08T10:05:00Z', text: 'メモ' }, ...b]).map(l => l.text)).toEqual(['先', 'メモ']);
  expect(mmss(185000)).toBe('3:05'); expect(mmss(0)).toBe('0:00');
});

it('録音できる形式を選ぶ（Safari は mp4、Chrome は webm）', () => {
  expect(pickMime(t => t === 'audio/mp4')).toBe('audio/mp4');
  expect(pickMime(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
  expect(pickMime(() => false)).toBe('');
});

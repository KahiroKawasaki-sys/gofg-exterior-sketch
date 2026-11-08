import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('アプリの作り分け', () => {
  it('指定がなければ全部入り（Web版・Pro）', async () => {
    vi.stubEnv('VITE_EDITION', '');
    expect((await import('../src/v3/edition')).PRO).toBe(true);
  });
  it('sketch を指定すると2Dだけ', async () => {
    vi.stubEnv('VITE_EDITION', 'sketch');
    const e = await import('../src/v3/edition');
    expect(e.EDITION).toBe('sketch'); expect(e.PRO).toBe(false);
  });
  it('使い方の「打ち合わせ」動画は Pro だけに出る', async () => {
    vi.stubEnv('VITE_EDITION', '');
    expect((await import('../src/v3/guideFull')).GUIDE_FULL.some(v => v.id === 'f-meeting')).toBe(true);
    expect((await import('../src/v3/Simple')).HELP.some(h => h.title.includes('打ち合わせ'))).toBe(true);
    vi.resetModules(); vi.stubEnv('VITE_EDITION', 'sketch');
    expect((await import('../src/v3/guideFull')).GUIDE_FULL.some(v => v.id === 'f-meeting')).toBe(false);
    expect((await import('../src/v3/Simple')).HELP.some(h => h.title.includes('打ち合わせ'))).toBe(false);
  });
});

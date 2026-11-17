// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: vi.fn(() => false), post: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native }, registerPlugin: () => ({ getId: async () => ({ id: 'device-from-keychain-1', name: 'iPad' }) }), CapacitorHttp: {} }));
vi.mock('../src/v3/platform', () => ({ isNativeApp: mocks.native, apiPost: mocks.post }));
import { evaluate, GRACE_MS, activate, check, loadState, licenseHeaders, release, licenseRequired, type LicenseState } from '../src/v3/license';

const DAY = 24 * 3600_000, now = Date.parse('2026-11-17T09:00:00+09:00');
const st = (o: Partial<LicenseState> = {}): LicenseState => ({ token: 'a.b', clientName: 'テスト外構', plan: 'pro', expiresAt: null, checkedAt: now, ...o });
const issued = { token: 'payload.sig', clientName: 'テスト外構', plan: 'pro', expiresAt: '2027-03-31' };

beforeEach(() => {
  // Node の localStorage は jsdom と食い違うため、単純な Map で置き換える
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() });
  vi.clearAllMocks(); mocks.native.mockReturnValue(false);
});

describe('通信できないときの猶予（7日）', () => {
  it('キー未入力は none', () => { expect(evaluate(null, now)).toBe('none'); });
  it('最後の確認から7日以内は使える。7日を過ぎたら確認が要る', () => {
    expect(evaluate(st(), now)).toBe('ok');
    expect(evaluate(st({ checkedAt: now - 6 * DAY }), now)).toBe('ok');
    expect(evaluate(st({ checkedAt: now - GRACE_MS }), now)).toBe('ok');
    expect(evaluate(st({ checkedAt: now - GRACE_MS - 1 }), now)).toBe('stale');
    expect(evaluate(st({ checkedAt: now - 30 * DAY }), now)).toBe('stale');
  });
  it('端末の時計を大きく進めた・戻した記録は信用しない', () => { expect(evaluate(st({ checkedAt: now + 2 * DAY }), now)).toBe('stale'); });
  it('サーバーに断られた（別の端末へ移った等）はロック', () => {
    expect(evaluate(st({ locked: 'moved' }), now)).toBe('locked');
    expect(evaluate(st({ locked: 'suspended', checkedAt: now }), now)).toBe('locked');
  });
});

describe('登録・確認', () => {
  it('Web ではゲートを出さない（開発サーバーの ?license=1 だけ）', () => {
    expect(licenseRequired()).toBe(false);
    history.replaceState(null, '', '/?license=1'); expect(licenseRequired()).toBe(import.meta.env.DEV);
    history.replaceState(null, '', '/');
  });
  it('キーで登録すると保存し、AI に付けるヘッダーができる', async () => {
    mocks.post.mockResolvedValueOnce({ ok: true, status: 200, data: issued });
    const r = await activate('gs-abcd-efgh-jkmn-pqrs');
    expect(r.kind).toBe('ok');
    const [path, body] = mocks.post.mock.calls[0];
    expect(path).toBe('/api/license/activate'); expect(body.key).toBe('gs-abcd-efgh-jkmn-pqrs'); expect(body.deviceId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(loadState()).toMatchObject({ clientName: 'テスト外構', expiresAt: '2027-03-31' });
    const h = await licenseHeaders();
    expect(h['X-License-Token']).toBe('payload.sig'); expect(h['X-Device-Id']).toBe(body.deviceId);
  });
  it('別の端末で使用中なら inUse、切り替えは takeover を呼ぶ', async () => {
    mocks.post.mockResolvedValueOnce({ ok: false, status: 409, data: { inUse: true, deviceName: 'iPad（事務所）', since: '2026-11-01T00:00:00Z' } });
    expect(await activate('GS-1')).toEqual({ kind: 'inUse', deviceName: 'iPad（事務所）', since: '2026-11-01T00:00:00Z' });
    mocks.post.mockResolvedValueOnce({ ok: false, status: 429, data: { error: '端末の切り替えは月2回までです。管理者へご連絡ください。' } });
    const r = await activate('GS-1', true);
    expect(mocks.post.mock.calls[1][0]).toBe('/api/license/takeover');
    expect(r).toEqual({ kind: 'error', message: '端末の切り替えは月2回までです。管理者へご連絡ください。' });
  });
  it('通信できなければ、登録は「通信できません」、確認は offline（ロックしない）', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    expect(await activate('GS-1')).toMatchObject({ kind: 'error', message: expect.stringContaining('通信できませんでした') });
    localStorage.setItem('gofg.license.v1', JSON.stringify(st({ checkedAt: Date.now() - DAY })));
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    expect(await check()).toBe('offline'); expect(loadState()?.locked).toBeUndefined();
    // 通行証で断られた（HTML のログイン画面＝理由なしの401）も、ライセンスのロックにはしない
    mocks.post.mockResolvedValueOnce({ ok: false, status: 401, data: {} });
    expect(await check()).toBe('offline');
  });
  it('確認で別の端末へ移されていたらロックし、成功なら最終確認時刻を更新する', async () => {
    localStorage.setItem('gofg.license.v1', JSON.stringify(st({ checkedAt: Date.now() - 3 * DAY })));
    mocks.post.mockResolvedValueOnce({ ok: true, status: 200, data: issued });
    expect(await check()).toBe('ok'); expect(Date.now() - loadState()!.checkedAt).toBeLessThan(5000);
    mocks.post.mockResolvedValueOnce({ ok: false, status: 401, data: { reason: 'moved' } });
    expect(await check()).toBe('moved'); expect(evaluate(loadState())).toBe('locked');
  });
  it('登録を外すとこの端末の記録が消える（サーバーに届かなくても）', async () => {
    localStorage.setItem('gofg.license.v1', JSON.stringify(st()));
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    await release(); expect(loadState()).toBeNull();
  });
});

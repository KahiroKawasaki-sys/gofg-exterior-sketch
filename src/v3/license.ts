// ライセンス（クライアントごとのキー＋同時1端末）のアプリ側。ネイティブの Pro 版だけで使う。
// サーバー（worker/license.ts）で登録した結果（署名トークン・会社名・期限・最後に確認できた時刻）を端末に残す。
// 通信できないときは、最後に確認できてから7日間はそのまま使える。図面データには一切触れない。
import { registerPlugin } from '@capacitor/core';
import { PRO } from './edition';
import { apiPost, isNativeApp } from './platform';

export const GRACE_MS = 7 * 24 * 3600_000;
const STATE_KEY = 'gofg.license.v1', DEVICE_KEY = 'gofg.deviceId.v1';
export type LockReason = 'moved' | 'suspended' | 'expired' | 'invalid' | 'offline';
export type LicenseState = { token: string; clientName: string; plan: string; expiresAt: string | null; checkedAt: number; locked?: LockReason };
export type Gate = 'none' | 'ok' | 'stale' | 'locked';

// ゲートを出すのはネイティブの Pro 版だけ。開発サーバーでは ?license=1 で確認できる（本番ビルドでは無効）
export function licenseRequired(): boolean {
  if (isNativeApp()) return PRO;
  return !!import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('license') === '1';
}

// 保存した状態から、今使えるかを決める（純粋関数）
// none＝キー未入力、ok＝最後の確認から7日以内、stale＝7日を過ぎた（通信して確認するまで使えない）、locked＝サーバーに断られた
export function evaluate(s: LicenseState | null, now = Date.now()): Gate {
  if (!s?.token) return 'none';
  if (s.locked && s.locked !== 'offline') return 'locked';
  return now - s.checkedAt <= GRACE_MS && s.checkedAt <= now + 3600_000 ? 'ok' : 'stale';
}

const storage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
export function loadState(): LicenseState | null {
  try { const v = JSON.parse(storage()?.getItem(STATE_KEY) || 'null'); return v && typeof v.token === 'string' ? v : null; } catch { return null; }
}
function saveState(s: LicenseState | null) {
  try { if (s) storage()?.setItem(STATE_KEY, JSON.stringify(s)); else storage()?.removeItem(STATE_KEY); } catch { /* 保存できなくても今回は使える */ }
  for (const fn of listeners) fn(s);
}
const listeners = new Set<(s: LicenseState | null) => void>();
export function onLicenseChange(fn: (s: LicenseState | null) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// 端末ID：iOS はキーチェーン（アプリを入れ直しても同じ）、それ以外は localStorage
type DevicePlugin = { getId(): Promise<{ id: string; name?: string; model?: string }> };
let device: Promise<{ id: string; name: string }> | undefined;
export function deviceInfo(): Promise<{ id: string; name: string }> {
  return device ??= (async () => {
    if (isNativeApp()) {
      try {
        const r = await registerPlugin<DevicePlugin>('GofgDevice').getId();
        if (r?.id && /^[A-Za-z0-9-]{8,64}$/.test(r.id)) return { id: r.id, name: (r.name || r.model || 'iPad／iPhone').slice(0, 60) };
      } catch { /* 下の localStorage にフォールバック */ }
    }
    let id = '';
    try { id = storage()?.getItem(DEVICE_KEY) || ''; } catch { /* 無視 */ }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) { id = crypto.randomUUID(); try { storage()?.setItem(DEVICE_KEY, id); } catch { /* 無視 */ } }
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    return { id, name: /iPad|Macintosh/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : 'この端末' };
  })();
}

// AI を呼ぶときに付けるヘッダー
export async function licenseHeaders(): Promise<Record<string, string>> {
  const s = loadState(); if (!s?.token) return {};
  return { 'X-License-Token': s.token, 'X-Device-Id': (await deviceInfo()).id };
}

type Issued = { token: string; clientName: string; plan: string; expiresAt: string | null };
function accept(d: Record<string, unknown>): LicenseState {
  const s: LicenseState = { token: String(d.token), clientName: String(d.clientName || ''), plan: String(d.plan || 'pro'), expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : null, checkedAt: Date.now() };
  saveState(s); return s;
}
const issued = (d: Record<string, unknown>): d is Issued => typeof d.token === 'string' && d.token.includes('.');
const msg = (d: Record<string, unknown>, fallback: string) => typeof d.error === 'string' && d.error ? d.error : fallback;
const OFFLINE = '通信できませんでした。インターネットにつないで、もう一度お試しください。';

export type ActivateResult =
  | { kind: 'ok'; state: LicenseState }
  | { kind: 'inUse'; deviceName: string; since: string }
  | { kind: 'error'; message: string };

// キーを入力して登録する（takeover＝別の端末から切り替える）
export async function activate(key: string, takeover = false): Promise<ActivateResult> {
  const { id, name } = await deviceInfo();
  let r;
  try { r = await apiPost(takeover ? '/api/license/takeover' : '/api/license/activate', { key: key.trim(), deviceId: id, deviceName: name }); }
  catch { return { kind: 'error', message: OFFLINE }; }
  if (r.ok && issued(r.data)) return { kind: 'ok', state: accept(r.data) };
  if (r.status === 409 && r.data.inUse) return { kind: 'inUse', deviceName: String(r.data.deviceName || ''), since: String(r.data.since || '') };
  if (r.status === 401) return { kind: 'error', message: msg(r.data, 'キーが正しくありません。入力し直してください。') };
  return { kind: 'error', message: msg(r.data, r.status >= 500 || !r.status ? OFFLINE : '登録できませんでした。担当者へお問い合わせください。') };
}

const REASONS: LockReason[] = ['moved', 'suspended', 'expired', 'invalid'];
export type CheckResult = 'ok' | 'offline' | LockReason | 'none';
// サーバーに確認する。断られたらロック、通信できなければ offline（猶予の判断は evaluate）
export async function check(): Promise<CheckResult> {
  const s = loadState(); if (!s?.token) return 'none';
  const { id } = await deviceInfo();
  let r;
  try { r = await apiPost('/api/license/check', { token: s.token, deviceId: id }); } catch { return 'offline'; }
  if (r.ok && issued(r.data)) { accept(r.data); return 'ok'; }
  const reason = r.status === 401 && REASONS.includes(r.data.reason as LockReason) ? r.data.reason as LockReason : null;
  if (reason) { saveState({ ...s, locked: reason }); return reason; }
  return 'offline';
}

// AI がライセンスで断られた（401）ときに呼ぶ。確認し直して、だめならロック
let rechecking: Promise<CheckResult> | undefined;
export function licenseRejected(): Promise<CheckResult> {
  return rechecking ??= check().finally(() => { rechecking = undefined; });
}

// この端末の登録を外す（別の端末へ移すとき）。サーバーに届かなくても、この端末の記録は消す
export async function release(): Promise<void> {
  const s = loadState();
  if (s?.token) { const { id } = await deviceInfo(); await apiPost('/api/license/release', { token: s.token, deviceId: id }).catch(() => null); }
  saveState(null);
}
export const forget = () => saveState(null);

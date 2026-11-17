// アプリからサーバー（Cloudflare）を呼ぶときの通行証。
// 1) Cloudflare Access のサービストークン（ビルド時に埋め込み）＝ Access を通るための共通の通行証。
// 2) その内側で、クライアントごとのライセンス（署名トークン＋端末ID。./license.ts）を Worker が確かめる。
// Webはログイン済みのCookieで通るので不要。
import { licenseHeaders, licenseRejected } from './license';

export async function appAuthHeaders(): Promise<Record<string, string>> {
  const id = import.meta.env.VITE_AI_CLIENT_ID, secret = import.meta.env.VITE_AI_CLIENT_SECRET;
  const access: Record<string, string> = id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
  return { ...access, ...await licenseHeaders() };
}

// AI がライセンスで断られた（401＋reason）ら、確認し直してロックするか決める
export function afterAppResponse(path: string, status: number, data: Record<string, unknown>): void {
  if (path.startsWith('/api/ai/') && status === 401 && typeof data.reason === 'string') void licenseRejected();
}

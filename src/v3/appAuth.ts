// アプリからサーバー（Cloudflare）を呼ぶときの通行証。
// 今は Pro のTestFlight版に組み込んだ Cloudflare Access のサービストークンを使う（Webはログイン済みのCookieで通るので不要）。
// 個別のライセンスキー方式に切り替えるときは、ここだけを差し替える。
export async function appAuthHeaders(): Promise<Record<string, string>> {
  const id = import.meta.env.VITE_AI_CLIENT_ID, secret = import.meta.env.VITE_AI_CLIENT_SECRET;
  return id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
}

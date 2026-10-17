import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function initializeNativePlatform(): Promise<void> {
  if (!isNativeApp()) return;
  document.documentElement.classList.add('v3-native');
  const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
  await Keyboard.setResizeMode({ mode: KeyboardResize.None });
  await Keyboard.setScroll({ isDisabled: true });
  const keyboard = (height: number) => {
    document.documentElement.style.setProperty('--v3-keyboard-height', `${height}px`);
    document.documentElement.classList.toggle('v3-keyboard', height > 0);
    // Only the form's own scroll container moves; the canvas stays fixed.
    if (height) requestAnimationFrame(() => {
      const field = document.activeElement;
      if (field instanceof HTMLElement && field.closest('.v3-modal, .v3-side')) field.scrollIntoView({ block: 'nearest' });
    });
  };
  await Keyboard.addListener('keyboardWillShow', event => keyboard(event.keyboardHeight));
  await Keyboard.addListener('keyboardWillHide', () => keyboard(0));
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('書き出しデータを読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

export async function saveFile(blob: Blob, fileName: string): Promise<'saved' | 'cancelled'> {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a);
    a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'saved';
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'), import('@capacitor/share'),
  ]);
  const folder = `exports/${crypto.randomUUID()}`;
  const name = fileName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || '図面';
  const path = `${folder}/${name}`;
  try {
    const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path, data: await blobBase64(blob), recursive: true });
    await Share.share({ title: name, files: [uri], dialogTitle: '図面を保存・共有' });
    return 'saved';
  } catch (error) {
    if (/cancel|キャンセル|取消/i.test(error instanceof Error ? error.message : String(error))) return 'cancelled';
    throw new Error('ファイルを保存・共有できませんでした。空き容量を確認して、もう一度お試しください。', { cause: error });
  } finally {
    await Filesystem.rmdir({ directory: Directory.Cache, path: folder, recursive: true }).catch(() => {});
  }
}

// サーバーのAPIを呼ぶ。Webは同じサイトへ普通に送る。アプリはWeb画面の外（端末の通信）から本番サーバーへ送る
export const API_ORIGIN = 'https://gofg-exterior-sketch.kawakahi135.workers.dev';
export async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Sketch-Client': '2' };
  if (!isNativeApp()) {
    const r = await fetch(path, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }
  const { appAuthHeaders } = await import('./appAuth');
  const r = await CapacitorHttp.post({ url: API_ORIGIN + path, headers: { ...headers, ...await appAuthHeaders() }, data: body, connectTimeout: 30000, readTimeout: 120000 });
  // ログイン画面（HTML）が返ってきたときは、通行証が通っていない
  const data = r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : {};
  const ok = r.status >= 200 && r.status < 300 && typeof r.data === 'object';
  return { ok, status: ok ? r.status : r.status < 300 ? 401 : r.status, data };
}

// 端末本体の音声認識（ios/App/App/SpeechPlugin.swift）
export type NativeSpeech = {
  available(): Promise<{ available: boolean }>; start(): Promise<void>; stop(): Promise<void>;
  addListener(event: 'partial' | 'final', fn: (e: { text: string }) => void): Promise<PluginListenerHandle>;
};
let speech: NativeSpeech | undefined;
export const nativeSpeech = () => speech ??= registerPlugin<NativeSpeech>('GofgSpeech');

/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// 利用者に見せる版（設定・ホーム画面）。VITE_APP_VERSION があればそれ、無ければ package.json の version
const APP_VERSION = process.env.VITE_APP_VERSION || (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
// アプリ（iOS）の画面に付ける CSP。インラインスクリプトは禁止。通信は自分（同梱ファイル・data:/blob:）と本番API宛てだけ。
// pdf.js の worker（同梱 .mjs）・下絵や塗りの data:/blob: 画像・WebAssembly（pdf.js の画像処理）は動くようにする。
// Web 版の CSP は worker/index.ts のレスポンスヘッダー（こちらは同じ方針で、アプリ用に API 宛先と wasm を足したもの）
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' data: blob: https://gofg-exterior-sketch.kawakahi135.workers.dev",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// App uses an independent entry. The browser keeps its existing v2/v3 routing.
export default defineConfig(({ mode }) => {
  const app = mode === 'app';
  const appHtml: Plugin = {
    name: 'native-app-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace('/src/main.tsx', '/src/main-app.tsx')
        .replace(/<link[^>]+>/g, '')
        .replace(/<meta name="apple-mobile-web-app-[^>]+>/g, '')
        .replace('content="#245a43"', 'content="#f5f5f3"')
        .replace('<meta charset="UTF-8">', `<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`),
    },
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (/[/\\]src[/\\](App|Stage|cloud|storage|model|io)\.(tsx?|jsx?)$/.test(id)) {
          this.error(`Legacy module entered the app build: ${id}`);
        }
      }
    },
  };
  return {
    plugins: [react(), ...(app ? [appHtml] : [])],
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION) },
    ...(app ? {
      base: './',
      publicDir: false,
      resolve: { alias: [{ find: /^\.\.\/io$/, replacement: fileURLToPath(new URL('./src/v3/source.ts', import.meta.url)) }] },
    } : {}),
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { chunkSizeWarningLimit: 900, ...(app ? { outDir: 'dist-app' } : {}) },
    // 実DB（Miniflare）を使う同期テストは、混んだPCだと既定の5秒を超えることがあるため長めにする
    test: { testTimeout: 20000, hookTimeout: 30000 },
  };
});

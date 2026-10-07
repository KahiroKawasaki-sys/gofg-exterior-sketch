import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

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
        .replace('content="#245a43"', 'content="#f5f5f3"'),
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
    ...(app ? {
      base: './',
      publicDir: false,
      resolve: { alias: [{ find: /^\.\.\/io$/, replacement: fileURLToPath(new URL('./src/v3/source.ts', import.meta.url)) }] },
    } : {}),
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { chunkSizeWarningLimit: 900, ...(app ? { outDir: 'dist-app' } : {}) },
  };
});

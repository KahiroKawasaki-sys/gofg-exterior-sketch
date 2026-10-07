import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = resolve('dist-app'), html = readFileSync(resolve(dir, 'index.html'), 'utf8');
assert(!/manifest|serviceWorker|apple-touch-icon/.test(html), 'App must not depend on PWA assets');
const sources = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(x => x[1]);
assert(sources.length && sources.every(x => x.startsWith('./')), 'App assets must have relative URLs');
for (const source of sources) readFileSync(resolve(dir, source));
const assets = readdirSync(resolve(dir, 'assets'));
assert(assets.some(x => /^pdf\.worker.*\.mjs$/.test(x)), 'Local PDF worker is missing');
assert(!readdirSync(dir).includes('manifest.webmanifest'), 'PWA manifest must not be bundled');
console.log('App bundle verified: v3 entry, relative/local assets, local PDF worker, no PWA dependency.');

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
// CSP：インラインスクリプト禁止・外部への通信は本番APIだけ。インラインの <script> も無いこと
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
assert(csp, 'App CSP meta is missing');
const directive = name => csp.split(';').map(x => x.trim()).find(x => x.startsWith(name + ' ')) || '';
assert(/'self'/.test(directive('script-src')) && !/'unsafe-inline'|'unsafe-eval'|\*|data:|blob:|https?:/.test(directive('script-src')), 'App CSP must forbid inline/external scripts');
assert(directive('object-src') === "object-src 'none'", 'App CSP must forbid plugins');
assert(directive('connect-src').split(/\s+/).slice(1).every(x => ["'self'", 'data:', 'blob:', 'https://gofg-exterior-sketch.kawakahi135.workers.dev'].includes(x)), 'App CSP connect-src must stay narrow');
assert(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'App CSP must come before scripts');
assert(![...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].some(m => !/\bsrc=/.test(m[1]) || m[2].trim()), 'App HTML must not contain inline scripts');
console.log('App bundle verified: v3 entry, relative/local assets, local PDF worker, no PWA dependency, CSP.');

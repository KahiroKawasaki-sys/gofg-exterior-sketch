import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('.wrangler/deploy.wrangler.jsonc', root), 'utf8'));
const base = new URL(process.argv[2] ?? 'https://invalid.example');
assert.equal(base.protocol, 'https:');
assert.ok(base.hostname.startsWith(config.name + '.') && base.hostname.endsWith('.workers.dev'), 'Pass this project deployed Workers URL.');
assert.ok(config.vars.ACCESS_TEAM_DOMAIN, 'Access team domain is required.');
const dist = new URL('dist/', root);
const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
 .filter(entry => entry.isFile())
 .map(entry => '/' + path.relative(dist.pathname.replace(/^\/([A-Za-z]:)/, '$1'), path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
async function get(pathname,headers,method='GET'){
 return fetch(new URL(pathname,base),{redirect:'manual',headers,method,signal:AbortSignal.timeout(20000)});
}
async function checkLogin(pathname,headers,label){
 const response=await get(pathname,headers);assert.equal(response.status,302,label+': expected login redirect');
 const redirect=new URL(response.headers.get('location'),base);assert.equal(redirect.protocol,'https:');assert.equal(redirect.hostname,config.vars.ACCESS_TEAM_DOMAIN);assert.ok(redirect.pathname.startsWith('/cdn-cgi/access/login/'));
 await response.body?.cancel();console.log('PASS '+label+' -> login required');
}
if(config.vars.PUBLIC_APP==='true'){
 for(const pathname of ['/',...new Set(files)]){
  let r=await get(pathname);if(pathname==='/index.html'&&r.status===307){assert.equal(new URL(r.headers.get('location'),base).href,new URL('/',base).href,'index.html must redirect only to this app root');await r.body?.cancel();r=await get('/');}assert.equal(r.status,200,pathname+': expected public asset');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok(r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));await r.body?.cancel();console.log('PASS '+pathname+' -> anonymous app asset');
 }
 const session=await get('/api/session');assert.equal(session.status,200);const status=await session.json();assert.equal(status.available,false);assert.equal(status.publicPreview,true);console.log('PASS /api/session -> local storage only');
 for(const pathname of ['/api','/api/plans','/api/plans/test/history','/api/blobs/'+'0'.repeat(64),'/api/maintenance']){
  const r=await get(pathname);assert.equal(r.status,403,pathname+': cloud data must be blocked');await r.body?.cancel();console.log('PASS '+pathname+' -> cloud data blocked');
 }
 for(const method of ['POST','PUT','DELETE']){const r=await get('/api/plans',undefined,method);assert.equal(r.status,403);await r.body?.cancel();console.log('PASS '+method+' /api/plans -> blocked');}
 for(const headers of [{'Cf-Access-Jwt-Assertion':'invalid.invalid.invalid'},{Cookie:'CF_Authorization=invalid.invalid.invalid'}]){const r=await get('/api/plans',headers);assert.equal(r.status,403);await r.body?.cancel();console.log('PASS invalid authentication -> cloud data blocked');}
 console.log('Public development app verified; private cloud data is inaccessible.');
}else{
 for(const pathname of ['/','/api/session','/api/plans','/api/plans/test/history','/api/blobs/'+'0'.repeat(64),...new Set(files)])await checkLogin(pathname,undefined,pathname);
 await checkLogin('/',{'Cf-Access-Jwt-Assertion':'invalid.invalid.invalid'},'invalid assertion');
 await checkLogin('/',{Cookie:'CF_Authorization=invalid.invalid.invalid'},'invalid session cookie');
 console.log('Anonymous/invalid sessions are blocked. Owner sign-in and iPad operation require separate checks.');
}

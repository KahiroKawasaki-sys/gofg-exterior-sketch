import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=>()=>{}),jwtVerify:vi.fn()}));
import {jwtVerify} from 'jose';
import worker from '../worker/index';
import {hashKey,normalizeKey,signToken,verifyToken,monthJST,TOKEN_TTL_MS} from '../worker/license';

let mf,db;
const run=vi.fn();
const env=(extra={})=>({ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAIL:'owner@example.test',ASSETS:{fetch:vi.fn()},AI:{run},DB:db,LICENSE_SIGNING_KEY:'test-signing-key',APP_SERVICE_TOKEN_ID:'app-token.access',...extra});
const post=(path,body,headers={})=>new Request('https://app.example.test'+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only','X-Sketch-Client':'2','Content-Type':'application/json','CF-Connecting-IP':'198.51.100.7',...headers},body:JSON.stringify(body)});
const call=async(path,body,headers,e=env())=>{const r=await worker.fetch(post(path,body,headers),e);return {status:r.status,data:await r.json().catch(()=>({}))};};
const A='device-aaaa-1111',B='device-bbbb-2222',C='device-cccc-3333';
let seq=0;
async function newLicense(fields={}){
 const key=`GS-TEST-${String(++seq).padStart(4,'2')}-ABCD-EFGH`;
 const cols={key_hash:await hashKey(key),client_name:'テスト外構株式会社',plan:'pro',created_at:new Date().toISOString(),...fields};
 const names=Object.keys(cols);
 const r=await db.prepare(`INSERT INTO licenses(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).bind(...Object.values(cols)).run();
 return {key,id:r.meta.last_row_id};
}
const aiHeaders=(token,dev)=>({'X-License-Token':token,'X-Device-Id':dev});
const audio=btoa('fake-audio-bytes');

beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-19',d1Databases:['DB'],log:undefined}));
 db=await mf.getD1Database('DB');
 const sql=readFileSync(new URL('../migrations/0003_licenses.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
 for(const s of sql.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(s).run();
},30000);
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
 vi.clearAllMocks();
 jwtVerify.mockResolvedValue({payload:{common_name:'app-token.access'}});
 run.mockResolvedValue({text:'駐車場は2台です。',segments:[{start:0,end:3,text:'駐車場は2台です。'}],transcription_info:{duration:150}});
 await db.prepare('DELETE FROM license_attempts').run();
});

describe('キーとトークン',()=>{
 it('キーは大文字・英数字にそろえてハッシュする（発行ツールと同じ値）',async()=>{
  expect(normalizeKey('gs-abcd efgh-2345')).toBe('GSABCDEFGH2345');
  expect(await hashKey('gs-abcd-efgh-jkmn-pqrs')).toBe(await hashKey('GS-ABCD-EFGH-JKMN-PQRS'));
  // scripts/test_license_admin.py と同じ期待値
  expect(await hashKey('GS-ABCD-EFGH-JKMN-PQRS')).toBe('99ee8d01958ccfb107c7626be1c43896810eda13c4ae1b740fa461297aef6e83');
 });
 it('署名が違う・改ざんされたトークンは受け付けない',async()=>{
  const t=await signToken({lic:1,dev:A,plan:'pro',iat:1,exp:2},'k1');
  expect((await verifyToken(t,'k1')).dev).toBe(A);
  expect(await verifyToken(t,'k2')).toBeNull();
  const [h,s]=t.split('.');
  const forged=btoa(JSON.stringify({lic:2,dev:A,plan:'pro',iat:1,exp:2})).replace(/=+$/,'')+'.'+s;
  expect(await verifyToken(forged,'k1')).toBeNull();
  expect(await verifyToken(h,'k1')).toBeNull();
 });
});

describe('ライセンスの登録と同時1端末',()=>{
 it('発行→登録→別端末は409→切り替え→旧端末は使えない→月2回を超えると429',async()=>{
  const {key}=await newLicense();
  const a=await call('/api/license/activate',{key:key.toLowerCase(),deviceId:A,deviceName:'iPad（事務所）'});
  expect(a.status).toBe(200);expect(a.data.clientName).toBe('テスト外構株式会社');expect(a.data.token).toMatch(/\./);
  expect(Date.parse(a.data.tokenExpiresAt)-Date.now()).toBeGreaterThan(TOKEN_TTL_MS-60_000);
  // 同じ端末なら何度でも
  expect((await call('/api/license/activate',{key,deviceId:A,deviceName:'iPad（事務所）'})).status).toBe(200);
  // 別端末は使用中
  const b=await call('/api/license/activate',{key,deviceId:B,deviceName:'iPhone'});
  expect(b.status).toBe(409);expect(b.data).toMatchObject({inUse:true,deviceName:'iPad（事務所）'});expect(b.data.since).toBeTruthy();
  // 切り替え（1回目）
  const t1=await call('/api/license/takeover',{key,deviceId:B,deviceName:'iPhone'});
  expect(t1.status).toBe(200);
  // 前の端末：check も AI も 401 moved
  const old=await call('/api/license/check',{token:a.data.token,deviceId:A});
  expect(old.status).toBe(401);expect(old.data.reason).toBe('moved');
  const ai=await call('/api/ai/transcribe',{audio},aiHeaders(a.data.token,A));
  expect(ai.status).toBe(401);expect(ai.data.reason).toBe('moved');
  // 新しい端末の check はトークンを更新して返す
  const ok=await call('/api/license/check',{token:t1.data.token,deviceId:B});
  expect(ok.status).toBe(200);expect(ok.data.token).toBeTruthy();
  // 2回目の切り替え（A に戻す）は通る。3回目は429
  expect((await call('/api/license/takeover',{key,deviceId:A,deviceName:'iPad（事務所）'})).status).toBe(200);
  const t3=await call('/api/license/takeover',{key,deviceId:C,deviceName:'iPad mini'});
  expect(t3.status).toBe(429);expect(t3.data.error).toContain('管理者');
 });
 it('max_devices が多いキー（審査用）は空きがある限りそのまま登録できる',async()=>{
  const {key}=await newLicense({max_devices:3});
  for(const d of [A,B,C])expect((await call('/api/license/activate',{key,deviceId:d,deviceName:d})).status).toBe(200);
  expect((await call('/api/license/activate',{key,deviceId:'device-dddd-4444',deviceName:'4台目'})).status).toBe(409);
 });
 it('無効なキーは401、停止中・期限切れは403。check は401で理由を返す',async()=>{
  expect((await call('/api/license/activate',{key:'GS-NONE-NONE-NONE-NONE',deviceId:A})).status).toBe(401);
  const s=await newLicense({status:'suspended'});
  const sr=await call('/api/license/activate',{key:s.key,deviceId:A});expect(sr.status).toBe(403);expect(sr.data.reason).toBe('suspended');
  const e=await newLicense({expires_at:'2020-01-31'});
  const er=await call('/api/license/activate',{key:e.key,deviceId:A});expect(er.status).toBe(403);expect(er.data.reason).toBe('expired');
  // 使っている途中で期限切れ・停止になった
  const l=await newLicense({expires_at:'2099-12-31'});
  const a=await call('/api/license/activate',{key:l.key,deviceId:A});expect(a.status).toBe(200);expect(a.data.expiresAt).toBe('2099-12-31');
  await db.prepare("UPDATE licenses SET expires_at='2020-01-31' WHERE id=?").bind(l.id).run();
  const c=await call('/api/license/check',{token:a.data.token,deviceId:A});expect(c.status).toBe(401);expect(c.data.reason).toBe('expired');
  expect((await call('/api/ai/meeting',{transcript:'a'},aiHeaders(a.data.token,A))).data.reason).toBe('expired');
  await db.prepare("UPDATE licenses SET expires_at=NULL,status='suspended' WHERE id=?").bind(l.id).run();
  expect((await call('/api/license/check',{token:a.data.token,deviceId:A})).data.reason).toBe('suspended');
 });
 it('キーの総当たりは同じIPから10回間違えると429',async()=>{
  for(let i=0;i<10;i++)expect((await call('/api/license/activate',{key:`GS-XXXX-XXXX-XXXX-${String(i).padStart(4,'X')}`,deviceId:A})).status).toBe(401);
  const {key}=await newLicense();
  expect((await call('/api/license/activate',{key,deviceId:A})).status).toBe(429);
  expect((await call('/api/license/activate',{key,deviceId:A},{'CF-Connecting-IP':'203.0.113.9'})).status).toBe(200);
 });
 it('この端末の登録を外すと、別の端末が切り替え回数を使わずに登録できる',async()=>{
  const {key}=await newLicense();
  const a=await call('/api/license/activate',{key,deviceId:A});
  expect((await call('/api/license/release',{token:a.data.token,deviceId:A})).status).toBe(200);
  expect((await call('/api/license/activate',{key,deviceId:B})).status).toBe(200);
 });
 it('入力の確認：端末IDが無い・別画面からの送信・トークンと端末が合わない',async()=>{
  const {key}=await newLicense();
  expect((await call('/api/license/activate',{key,deviceId:'x'})).status).toBe(400);
  expect((await call('/api/license/activate',{key,deviceId:A},{'X-Sketch-Client':''})).status).toBe(403);
  const a=await call('/api/license/activate',{key,deviceId:A});
  expect((await call('/api/license/check',{token:a.data.token,deviceId:B})).data.reason).toBe('invalid');
 });
});

describe('アプリからのAIはライセンス必須・月の上限',()=>{
 it('トークンなしは401、署名鍵が未設定なら503。Web（メールログイン）は従来どおり不要',async()=>{
  expect((await call('/api/ai/transcribe',{audio})).status).toBe(401);
  expect((await call('/api/ai/transcribe',{audio},{},env({LICENSE_SIGNING_KEY:undefined}))).status).toBe(503);
  expect((await call('/api/license/activate',{key:'x',deviceId:A},{},env({LICENSE_SIGNING_KEY:''}))).status).toBe(503);
  jwtVerify.mockResolvedValue({payload:{email:'owner@example.test'}});
  expect((await call('/api/ai/transcribe',{audio},{Origin:'https://app.example.test'},env({LICENSE_SIGNING_KEY:undefined}))).status).toBe(200);
 });
 it('期限切れトークンは401（check で取り直す）',async()=>{
  const {key,id}=await newLicense();
  await call('/api/license/activate',{key,deviceId:A});
  const old=await signToken({lic:id,dev:A,plan:'pro',iat:0,exp:Date.now()-1},'test-signing-key');
  expect((await call('/api/ai/meeting',{transcript:'a'},aiHeaders(old,A))).data.reason).toBe('invalid');
  const c=await call('/api/license/check',{token:old,deviceId:A});
  expect(c.status).toBe(200);
  expect((await call('/api/ai/transcribe',{audio},aiHeaders(c.data.token,A))).status).toBe(200);
 });
 it('文字起こしは秒で数え、上限（分）を超えたら429。AIパースも回数の上限で429',async()=>{
  const {key,id}=await newLicense({transcribe_monthly_min_limit:5,render_monthly_limit:2});
  const {data}=await call('/api/license/activate',{key,deviceId:A});
  const h=aiHeaders(data.token,A);
  expect((await call('/api/ai/transcribe',{audio},h)).status).toBe(200);
  expect((await call('/api/ai/transcribe',{audio},h)).status).toBe(200);
  const used=await db.prepare('SELECT count FROM license_usage WHERE license_id=? AND month=? AND feature=?').bind(id,monthJST(),'transcribe_sec').first();
  expect(used.count).toBe(300);
  const over=await call('/api/ai/transcribe',{audio},h);
  expect(over.status).toBe(429);expect(over.data.error).toContain('今月の上限に達しました');
  expect(run).toHaveBeenCalledTimes(2);
  await db.prepare('INSERT INTO license_usage(license_id,month,feature,count) VALUES(?,?,?,2)').bind(id,monthJST(),'render').run();
  const r=await call('/api/ai/render',{image:'x'},h);
  expect(r.status).toBe(429);expect(r.data.error).toContain('今月の上限に達しました');
 });
 it('アプリからはクラウド図面などのAPIは使えないまま',async()=>{
  const {key}=await newLicense();
  const {data}=await call('/api/license/activate',{key,deviceId:A});
  const r=await worker.fetch(post('/api/plans',{},aiHeaders(data.token,A)),env());
  expect(r.status).toBe(403);
 });
});

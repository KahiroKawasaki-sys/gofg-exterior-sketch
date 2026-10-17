import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=>()=>{}),jwtVerify:vi.fn()}));
import {jwtVerify} from 'jose';
import worker from '../worker/index';
const env=(extra={})=>({ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAIL:'owner@example.test',ASSETS:{fetch:vi.fn()},ANTHROPIC_API_KEY:'test-key',...extra});
const req=(body,headers={})=>new Request('https://app.example.test/api/ai/meeting',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only',Origin:'https://app.example.test','X-Sketch-Client':'2','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const realFetch=globalThis.fetch;
beforeEach(()=>{vi.clearAllMocks();jwtVerify.mockResolvedValue({payload:{email:'owner@example.test'}});});
afterEach(()=>{globalThis.fetch=realFetch;});
describe('打ち合わせAI',()=>{
 it('アプリ（サービストークン）は打ち合わせAIだけ使える',async()=>{
  globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({content:[{type:'tool_use',name:'record_requests',input:{requests:[]}}]}),{status:200}));
  jwtVerify.mockResolvedValue({payload:{common_name:'app-token.access'}});
  const appReq=(path)=>new Request('https://app.example.test'+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only','X-Sketch-Client':'2','Content-Type':'application/json'},body:JSON.stringify({transcript:'駐車場2台'})});
  expect((await worker.fetch(appReq('/api/ai/meeting'),env({APP_SERVICE_TOKEN_ID:'app-token.access'}))).status).toBe(200);
  expect((await worker.fetch(appReq('/api/docs'),env({APP_SERVICE_TOKEN_ID:'app-token.access'}))).status).toBe(403);
  expect((await worker.fetch(appReq('/api/ai/meeting'),env())).status).toBe(200);
  jwtVerify.mockResolvedValue({payload:{}});
  expect((await worker.fetch(appReq('/api/ai/meeting'),env())).status).toBe(403);
  jwtVerify.mockResolvedValue({payload:{common_name:'app-token.access'}});
  jwtVerify.mockResolvedValue({payload:{common_name:'other-token'}});
  expect((await worker.fetch(appReq('/api/ai/meeting'),env({APP_SERVICE_TOKEN_ID:'app-token.access'}))).status).toBe(403);
 });
 it('ログインしていなければ使えない',async()=>{const r=await worker.fetch(new Request('https://app.example.test/api/ai/meeting',{method:'POST'}),env());expect(r.status).toBe(401);});
 it('開発モード（メール確認なし）では使えない',async()=>{const r=await worker.fetch(req({transcript:'a'}),env({PUBLIC_APP:'true'}));expect(r.status).toBe(403);});
 it('キーが未登録なら503で知らせる',async()=>{const r=await worker.fetch(req({transcript:'a'}),env({ANTHROPIC_API_KEY:''}));expect(r.status).toBe(503);expect((await r.json()).error).toContain('キー');});
 it('別の画面からの送信は断る',async()=>{const r=await worker.fetch(req({transcript:'a'},{'X-Sketch-Client':''}),env());expect(r.status).toBe(403);});
 it('会話が空なら呼ばない',async()=>{globalThis.fetch=vi.fn();const r=await worker.fetch(req({transcript:'  '}),env());expect(r.status).toBe(400);expect(globalThis.fetch).not.toHaveBeenCalled();});
 it('Claude に要望を読み取らせ、ツールの入力をそのまま返す',async()=>{
  globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({content:[{type:'tool_use',name:'record_requests',input:{requests:[{id:'',kind:'駐車場',text:'車2台',status:'決定'}]}}],usage:{input_tokens:1200,output_tokens:300}}),{status:200}));
  const r=await worker.fetch(req({transcript:'駐車場は2台ほしいです',previous:[{id:'r1',text:'芝生にしたい'}],items:['T100厚土間打ち 刷毛引き']}),env());
  expect(r.status).toBe(200);expect(await r.json()).toEqual({requests:[{id:'',kind:'駐車場',text:'車2台',status:'決定'}],usage:{input:1200,output:300}});
  const [url,init]=globalThis.fetch.mock.calls[0];expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(init.headers['x-api-key']).toBe('test-key');
  const sent=JSON.parse(init.body);expect(sent.model).toBe('claude-opus-5-5');expect(sent.tool_choice).toEqual({type:'tool',name:'record_requests'});
  expect(sent.messages[0].content).toContain('[r1] 芝生にしたい');expect(sent.messages[0].content).toContain('駐車場は2台ほしいです');
 });
 it('モデルは設定で変えられる。キー間違い・混雑は分かる言葉で返す',async()=>{
  globalThis.fetch=vi.fn(async()=>new Response('{}',{status:401}));
  let r=await worker.fetch(req({transcript:'a'}),env({AI_MODEL:'claude-sonnet-5-5'}));expect(r.status).toBe(502);expect((await r.json()).error).toContain('キーが正しくありません');
  expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).model).toBe('claude-sonnet-5-5');
  globalThis.fetch=vi.fn(async()=>new Response('{}',{status:529}));
  r=await worker.fetch(req({transcript:'a'}),env());expect(r.status).toBe(503);expect((await r.json()).error).toContain('混み合って');
 });
});
describe('AI利用記録の送信',()=>{
 it('トークンがあれば応答の後に利用記録を送る（会話の本文は送らない）',async()=>{
  globalThis.fetch=vi.fn(async(url)=>String(url).includes('anthropic')
   ?new Response(JSON.stringify({content:[{type:'tool_use',name:'record_requests',input:{requests:[]}}],usage:{input_tokens:1000,output_tokens:200,cache_read_input_tokens:50}}),{status:200})
   :new Response('{}',{status:200}));
  const waits=[];const ctx={waitUntil:(p)=>waits.push(p)};
  const r=await worker.fetch(req({transcript:'駐車場は2台ほしいです'}),env({AI_USAGE_TOKEN:'usage-test'}),ctx);
  expect(r.status).toBe(200);await Promise.all(waits);
  const [url,init]=globalThis.fetch.mock.calls[1];
  expect(url).toBe('https://fukugyo-manager.vercel.app/api/ai-usage/ingest');expect(init.headers.authorization).toBe('Bearer usage-test');
  const sent=JSON.parse(init.body);
  expect(sent).toMatchObject({provider:'anthropic',model:'claude-opus-5-5',feature:'打ち合わせAI',status:'ok',inputTokens:1000,outputTokens:200,cachedInputTokens:50});
  expect(init.body).not.toContain('駐車場は2台');
 });
 it('失敗も記録する。トークンが無ければ送らない',async()=>{
  globalThis.fetch=vi.fn(async(url)=>String(url).includes('anthropic')?new Response('{}',{status:400}):new Response('{}',{status:200}));
  const waits=[];const ctx={waitUntil:(p)=>waits.push(p)};
  expect((await worker.fetch(req({transcript:'a'}),env({AI_USAGE_TOKEN:'usage-test'}),ctx)).status).toBe(502);await Promise.all(waits);
  expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body).status).toBe('error');
  globalThis.fetch.mockClear();
  await worker.fetch(req({transcript:'a'}),env(),ctx);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
 });
 it('記録の送信先が落ちていても応答は返る',async()=>{
  globalThis.fetch=vi.fn(async(url)=>{if(!String(url).includes('anthropic'))throw new Error('down');return new Response(JSON.stringify({content:[],usage:{input_tokens:1,output_tokens:1}}),{status:200});});
  const waits=[];const r=await worker.fetch(req({transcript:'a'}),env({AI_USAGE_TOKEN:'usage-test'}),{waitUntil:(p)=>waits.push(p)});
  expect(r.status).toBe(200);await expect(Promise.all(waits)).resolves.toBeDefined();
 });
});

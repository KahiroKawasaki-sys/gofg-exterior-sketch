import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=>()=>{}),jwtVerify:vi.fn()}));
import {jwtVerify} from 'jose';
import worker from '../worker/index';
import {toLines,TERMS,WHISPER_MODEL} from '../worker/transcribe';
const run=vi.fn();
const env=(extra={})=>({ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAIL:'owner@example.test',ASSETS:{fetch:vi.fn()},AI:{run},...extra});
const req=(body,headers={})=>new Request('https://app.example.test/api/ai/transcribe',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only',Origin:'https://app.example.test','X-Sketch-Client':'2','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const audio=btoa('fake-audio-bytes');
const realFetch=globalThis.fetch;
beforeEach(()=>{vi.clearAllMocks();jwtVerify.mockResolvedValue({payload:{email:'owner@example.test'}});run.mockResolvedValue({text:'駐車場は2台です。目隠しフェンスがほしい。',segments:[{start:0.5,end:3.2,text:' 駐車場は2台です。'},{start:3.4,end:6,text:'目隠しフェンスがほしい。'}],transcription_info:{duration:6.5}});});
afterEach(()=>{globalThis.fetch=realFetch;});

describe('文字起こし',()=>{
 it('Whisper に日本語＋外構用語の前置きで渡し、区切りの開始時刻を足して返す',async()=>{
  const r=await worker.fetch(req({audio,index:2,startMs:360000,terms:'ネスカF ハイグリッドフェンスUF8型'}),env());
  expect(r.status).toBe(200);
  const data=await r.json();
  expect(data).toEqual({index:2,duration:6.5,lines:[{from:360.5,to:363.2,text:'駐車場は2台です。'},{from:363.4,to:366,text:'目隠しフェンスがほしい。'}]});
  const [model,input]=run.mock.calls[0];
  expect(model).toBe(WHISPER_MODEL);expect(input.audio).toBe(audio);expect(input.language).toBe('ja');expect(input.vad_filter).toBe(true);
  expect(input.initial_prompt).toContain('乱形石');expect(input.initial_prompt).toContain('ハイグリッドフェンスUF8型');
 });
 it('data URL の前置きは外し、segments が無ければ全文を1行にする',async()=>{
  run.mockResolvedValueOnce({text:'こんにちは',transcription_info:{duration:2}});
  const r=await worker.fetch(req({audio:'data:audio/mp4;base64,'+audio}),env());
  expect(await r.json()).toEqual({index:0,duration:2,lines:[{from:0,to:2,text:'こんにちは'}]});
  expect(run.mock.calls[0][1].audio).toBe(audio);
 });
 it('アプリ（サービストークン）からも使える。他のAPIは使えない',async()=>{
  jwtVerify.mockResolvedValue({payload:{common_name:'app-token.access'}});
  const appReq=(path)=>new Request('https://app.example.test'+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only','X-Sketch-Client':'2','Content-Type':'application/json'},body:JSON.stringify({audio})});
  expect((await worker.fetch(appReq('/api/ai/transcribe'),env({APP_SERVICE_TOKEN_ID:'app-token.access'}))).status).toBe(200);
  expect((await worker.fetch(appReq('/api/docs'),env({APP_SERVICE_TOKEN_ID:'app-token.access'}))).status).toBe(403);
 });
 it('入力の確認：音声なし・長すぎ・準備なし・別画面',async()=>{
  expect((await worker.fetch(req({audio:''}),env())).status).toBe(400);
  expect((await worker.fetch(req({audio:'A'.repeat(2_500_000)}),env())).status).toBe(413);
  expect((await worker.fetch(req({audio}),env({AI:undefined}))).status).toBe(503);
  expect((await worker.fetch(req({audio},{'X-Sketch-Client':''}),env())).status).toBe(403);
  expect(run).not.toHaveBeenCalled();
 });
 it('Whisper が失敗したら分かる言葉で返し、利用記録に失敗を残す',async()=>{
  run.mockRejectedValueOnce(new Error('AiError: inference failed'));
  globalThis.fetch=vi.fn(async()=>new Response('{}',{status:200}));
  const waits=[];const r=await worker.fetch(req({audio}),env({AI_USAGE_TOKEN:'t'}),{waitUntil:(p)=>waits.push(p)});
  expect(r.status).toBe(502);expect((await r.json()).error).toContain('文字起こしに失敗');
  await Promise.all(waits);
  expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({provider:'cloudflare',feature:'文字起こし',status:'error'});
 });
});
describe('toLines',()=>{
 it('空白だけ・記号だけ・同じ文の繰り返しは捨て、時刻は0.1秒に丸める',()=>{
  const out={text:'a',segments:[{start:0,end:1,text:'   '},{start:1,end:2,text:'。。。'},{start:2,end:3.26,text:'芝生にしたい'},{start:3.3,end:4,text:'芝生にしたい'},{start:4,end:5,text:'予算は300万'}]};
  expect(toLines(out,10)).toEqual([{from:12,to:13.3,text:'芝生にしたい'},{from:14,to:15,text:'予算は300万'}]);
  expect(TERMS).toContain('カーポート');
 });
});

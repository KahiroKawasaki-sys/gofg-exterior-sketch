import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=>()=>{}),jwtVerify:vi.fn()}));
import {jwtVerify} from 'jose';
import worker from '../worker/index';
import {renderPrompt,pickImage,pickText,RENDER_MODEL} from '../worker/render';

const env=(extra={})=>({ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAIL:'owner@example.test',ASSETS:{fetch:vi.fn()},GEMINI_API_KEY:'test-key',...extra});
const req=(body,headers={})=>new Request('https://app.example.test/api/ai/render',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'test-only',Origin:'https://app.example.test','X-Sketch-Client':'2','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const png='data:image/png;base64,'+btoa('fake-png-bytes-'.repeat(20));
const out='x'.repeat(400);
const okBody={id:'int_1',steps:[{type:'thought',content:[{type:'image',data:'y'.repeat(300)}]},{type:'model_output',content:[{type:'text',text:'Here is the render.'},{type:'image',mime_type:'image/jpeg',data:out}]}],usage:{input_tokens:1300,output_tokens:1680}};
const realFetch=globalThis.fetch;
let fetchMock;
beforeEach(()=>{vi.clearAllMocks();jwtVerify.mockResolvedValue({payload:{email:'owner@example.test'}});fetchMock=vi.fn(async()=>new Response(JSON.stringify(okBody),{status:200}));globalThis.fetch=fetchMock;});
afterEach(()=>{globalThis.fetch=realFetch;});

describe('AIパース',()=>{
 it('画像モデルに3Dの写しと指示を送り、最後の model_output の画像を返す',async()=>{
  const r=await worker.fetch(req({image:png,view:'eye',style:'dusk',note:'塀は黒いタイル',aspect:'4:3',size:'2K'}),env());
  expect(r.status).toBe(200);
  const data=await r.json();
  expect(data.image).toBe('data:image/jpeg;base64,'+out);
  expect(data.text).toBe('Here is the render.');
  expect(data.model).toBe(RENDER_MODEL);
  const [url,init]=fetchMock.mock.calls[0];
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
  expect(init.headers['x-goog-api-key']).toBe('test-key');
  expect(init.headers['Api-Revision']).toBeTruthy();
  const body=JSON.parse(init.body);
  expect(body.model).toBe(RENDER_MODEL);
  expect(body.input[1]).toEqual({type:'image',mime_type:'image/png',data:png.split(',')[1]});
  expect(body.response_format).toEqual({type:'image',mime_type:'image/jpeg',aspect_ratio:'4:3',image_size:'2K'});
  expect(body.input[0].text).toContain('eye level');
  expect(body.input[0].text).toContain('blue hour');
  expect(body.input[0].text).toContain('塀は黒いタイル');
  expect(body.generation_config).toBeUndefined();
 });
 it('鍵が無ければ 503、画像が無ければ 400、大きすぎれば 413',async()=>{
  expect((await worker.fetch(req({image:png}),env({GEMINI_API_KEY:undefined}))).status).toBe(503);
  expect((await worker.fetch(req({}),env())).status).toBe(400);
  const big=await worker.fetch(req({image:'data:image/png;base64,'+'A'.repeat(6_100_000)}),env());
  expect(big.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it('アプリ（サービストークン）からも使える',async()=>{
  jwtVerify.mockResolvedValue({payload:{common_name:'app-token'}});
  const r=await worker.fetch(new Request('https://app.example.test/api/ai/render',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'t','X-Sketch-Client':'2','Content-Type':'application/json'},body:JSON.stringify({image:png})}),env());
  expect(r.status).toBe(200);
 });
 it('混雑（429）は 503、画像が返らなければ AI の説明つきで 502',async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'quota'}}),{status:429}));
  const busy=await worker.fetch(req({image:png}),env());
  expect(busy.status).toBe(503);const busyMsg=(await busy.json()).error;expect(busyMsg).toContain('利用枠');expect(busyMsg).toContain('Google: quota');
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'Resource has been exhausted'}}),{status:429}));
  expect((await (await worker.fetch(req({image:png}),env())).json()).error).toContain('混み合って');
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({steps:[{type:'model_output',content:[{type:'text',text:'I cannot render this.'}]}]}),{status:200}));
  const none=await worker.fetch(req({image:png}),env());
  expect(none.status).toBe(502);expect((await none.json()).error).toContain('I cannot render this.');
 });
 it('つながらなければ 502 の日本語エラー',async()=>{
  fetchMock.mockRejectedValueOnce(new TypeError('network'));
  const r=await worker.fetch(req({image:png}),env());
  expect(r.status).toBe(502);expect((await r.json()).error).toContain('つながりません');
 });
 it('利用記録を送る（画像1枚・2K）',async()=>{
  const waitUntil=vi.fn();
  await worker.fetch(req({image:png}),env({AI_USAGE_TOKEN:'u'}),{waitUntil});
  expect(waitUntil).toHaveBeenCalledTimes(1);
  const usageCall=fetchMock.mock.calls.find(c=>String(c[0]).includes('ai-usage'));
  expect(usageCall).toBeTruthy();
  const ev=JSON.parse(usageCall[1].body);
  expect(ev).toMatchObject({provider:'google',feature:'AIパース',status:'ok',images:1,imageSize:'2K',inputTokens:1300,outputTokens:1680});
 });
});

describe('render の部品',()=>{
 it('指示は視点・時間帯・希望を含み、形を変えないよう念を押す',()=>{
  const p=renderPrompt('bird','night','');
  expect(p).toContain('bird');expect(p).toContain('Night');expect(p).toContain('Do not add');expect(p).not.toContain('Customer request');
  expect(renderPrompt('top','day','芝は人工芝')).toContain('Customer request');
 });
 it('pickImage は model_output の最後の画像を選び、inline_data 形式も読む',()=>{
  expect(pickImage(okBody)).toEqual({data:out,mime:'image/jpeg'});
  expect(pickImage({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'z'.repeat(300)}}]}}]})).toEqual({data:'z'.repeat(300),mime:'image/png'});
  expect(pickImage({steps:[]})).toBeNull();
  expect(pickText(okBody)).toBe('Here is the render.');
 });
});

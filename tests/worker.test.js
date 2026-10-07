import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('jose',()=>({createRemoteJWKSet:vi.fn(()=>()=>{}),jwtVerify:vi.fn()}));
import {jwtVerify} from 'jose';
import worker from '../worker/index';
const assets=vi.fn(async()=>new Response('private application'));
const env=()=>({ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAIL:'owner@example.test',ASSETS:{fetch:assets}});
beforeEach(()=>{vi.clearAllMocks();jwtVerify.mockResolvedValue({payload:{email:'owner@example.test'}});});
describe('公開時の認証ゲート',()=>{
 it('許可メールが未設定なら配信しない',async()=>{const r=await worker.fetch(new Request('https://app.example.test/'),{...env(),ALLOWED_EMAIL:''});expect(r.status).toBe(503);expect(assets).not.toHaveBeenCalled();});
 it('正しい署名でも別メールなら403',async()=>{jwtVerify.mockResolvedValueOnce({payload:{email:'other@example.test'}});const r=await worker.fetch(new Request('https://app.example.test/',{headers:{'Cf-Access-Jwt-Assertion':'test-only'}}),env());expect(r.status).toBe(403);expect(assets).not.toHaveBeenCalled();});
 it('未設定なら静的ファイルも配信しない',async()=>{const r=await worker.fetch(new Request('https://app.example.test/'),{...env(),ACCESS_AUD:''});expect(r.status).toBe(503);expect(assets).not.toHaveBeenCalled();});
 it('トークンがないと401、画像やJSにも適用',async()=>{for(const path of ['/','/assets/main.js','/icon.svg','/api/session','/api/plans','/api/blobs/test','/samples/exterior-plan.pdf']){const r=await worker.fetch(new Request('https://app.example.test'+path),env());expect(r.status).toBe(401);}expect(assets).not.toHaveBeenCalled();});
 it('改ざん・期限切れの検証失敗時は配信しない',async()=>{jwtVerify.mockRejectedValueOnce(Error('expired'));const r=await worker.fetch(new Request('https://app.example.test/',{headers:{'Cf-Access-Jwt-Assertion':'test-only-invalid'}}),env());expect(r.status).toBe(401);expect(assets).not.toHaveBeenCalled();});
 it('署名・発行元・対象の検証を通した時だけ配信する',async()=>{const r=await worker.fetch(new Request('https://app.example.test/',{headers:{'Cf-Access-Jwt-Assertion':'test-only'}}),env());expect(jwtVerify).toHaveBeenCalledWith('test-only',expect.any(Function),{issuer:'https://test-team.cloudflareaccess.com',audience:'test-audience',algorithms:['RS256']});expect(await r.text()).toBe('private application');expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
});


describe('メール確認なしの開発モード',()=>{
 const preview=()=>({...env(),PUBLIC_APP:'true',DB:{prepare:vi.fn(()=>{throw Error('Existing cloud data must not be accessed');})}});
 it('画面と静的ファイルを匿名で配信し、保護ヘッダーを維持する',async()=>{for(const p of ['/','/assets/main.js','/icon.svg','/samples/exterior-plan.pdf']){const r=await worker.fetch(new Request('https://app.example.test'+p),preview());expect(r.status).toBe(200);expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");expect(r.headers.get('Cache-Control')).toBe('private, no-store');}expect(jwtVerify).not.toHaveBeenCalled();});
 it('状態確認では端末保存モードを返し、DBへ接続しない',async()=>{const e=preview(),r=await worker.fetch(new Request('https://app.example.test/api/session'),e);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({available:false,publicPreview:true});expect(e.DB.prepare).not.toHaveBeenCalled();});
 it('案件・原本・履歴と保存APIを、既存の認証があっても拒否する',async()=>{const e=preview();for(const p of ['/api','/api/plans','/api/plans/test','/api/plans/test/history','/api/blobs/test','/api/maintenance'])for(const method of ['GET','PUT','POST','DELETE']){const r=await worker.fetch(new Request('https://app.example.test'+p,{method,headers:{'Cf-Access-Jwt-Assertion':'test-only'}}),e);expect(r.status).toBe(403);}expect(e.DB.prepare).not.toHaveBeenCalled();expect(assets).not.toHaveBeenCalled();expect(jwtVerify).not.toHaveBeenCalled();});
 it('状態確認への書き込みや静的ファイルへのPOSTを拒否する',async()=>{expect((await worker.fetch(new Request('https://app.example.test/api/session',{method:'POST'}),preview())).status).toBe(403);expect((await worker.fetch(new Request('https://app.example.test/',{method:'POST'}),preview())).status).toBe(405);expect(assets).not.toHaveBeenCalled();});
 it('開発モードを終了すると、再び本人認証を要求する',async()=>{const e={...env(),PUBLIC_APP:'false'};expect((await worker.fetch(new Request('https://app.example.test/'),e)).status).toBe(401);expect((await worker.fetch(new Request('https://app.example.test/',{headers:{'Cf-Access-Jwt-Assertion':'test-only'}}),e)).status).toBe(200);});
 it('明示的にtrueを設定した場合だけ公開する',async()=>{for(const value of [undefined,'','false','TRUE','1'])expect((await worker.fetch(new Request('https://app.example.test/'),{...env(),PUBLIC_APP:value})).status).toBe(401);});
});

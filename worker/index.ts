import {createRemoteJWKSet,jwtVerify} from 'jose';
import {cloud,json} from './cloud';
import {meeting,type AiEnv} from './ai';
import {transcribe,type TranscribeEnv} from './transcribe';
import {render,type RenderEnv} from './render';
import {licenseApi,requireLicense,withinLimit,addUsage,LIMIT_MESSAGE,type LicenseEnv} from './license';
const keySets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
const deny=(message:string,status:number)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
async function serveAssets(request:Request,env:Env):Promise<Response>{
 const response=await env.ASSETS.fetch(request);const secured=new Response(response.body,response);secured.headers.set('Cache-Control','private, no-store');secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','no-referrer');secured.headers.set('X-Frame-Options','DENY');secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data: blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");return secured;
}
type WorkerEnv=Env & AiEnv & TranscribeEnv & RenderEnv & LicenseEnv & {DB?:D1Database;PUBLIC_APP?:string;APP_SERVICE_TOKEN_ID?:string};
// アプリ（サービストークン）からの AI 呼び出し。通行証の内側で、ライセンスと端末を確かめ、月の上限を数える
async function appAi(request:Request,env:WorkerEnv,path:string,ctx?:ExecutionContext):Promise<Response>{
 const lic=await requireLicense(request,env);if(lic instanceof Response)return lic;
 if(path!=='/api/ai/render'&&path!=='/api/ai/transcribe'&&path!=='/api/ai/meeting')return deny('アプリからはこの操作はできません。',403);
 const feature=path==='/api/ai/render'?'render':path==='/api/ai/meeting'?'meeting':'transcribe',db=env.DB!;
 if(!await withinLimit(db,lic,feature))return json({error:LIMIT_MESSAGE,limit:true},429);
 const r=feature==='render'?await render(request,env,true,ctx):feature==='meeting'?await meeting(request,env,true,ctx):await transcribe(request,env,true,ctx);
 if(r.ok){
  // 文字起こしは区切りの長さ（秒）を数える。返ってこなければ1分とみなす
  const sec=feature==='transcribe'?Number((await r.clone().json().catch(()=>({})) as {duration?:unknown}).duration)||60:1;
  await addUsage(db,lic.id,feature,feature==='transcribe'?Math.max(1,Math.ceil(sec)):1).catch(()=>{});
 }
 return r;
}
export default {
 async fetch(request:Request,env:WorkerEnv,ctx?:ExecutionContext):Promise<Response>{
  const url=new URL(request.url),isAPI=url.pathname==='/api'||url.pathname.startsWith('/api/');
  if(env.PUBLIC_APP==='true'){
   if(isAPI){
    if(url.pathname==='/api/session'&&request.method==='GET')return json({available:false,publicPreview:true,error:'開発中はメール確認なし・この端末に自動保存します。端末間の引き継ぎにはバックアップZIPを使ってください。'});
    return json({error:'開発中はクラウド図面へのアクセスを停止しています。端末保存とバックアップを利用できます。'},403);
   }
   if(!['GET','HEAD'].includes(request.method))return deny('Method not allowed',405);
   return serveAssets(request,env);
  }
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ALLOWED_EMAIL)return deny('認証設定が完了していません。公開準備中です。',503);
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))return deny('認証設定を確認してください。',503);
  if(!isAPI&&!['GET','HEAD'].includes(request.method))return deny('Method not allowed',405);
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)return deny('ログインが必要です。',401);
  let app=false;
  try{const issuer='https://'+env.ACCESS_TEAM_DOMAIN;const jwks=keySets.get(issuer)||createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));keySets.set(issuer,jwks);const {payload}=await jwtVerify(token,jwks,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});
   // iPhone／iPadアプリ（Pro）はメールのログインではなく、Accessのサービストークンで通る（Accessのポリシーに入れたトークンだけが届く）。
   // APP_SERVICE_TOKEN_ID を設定すれば、そのトークンに限る。使えるのは打ち合わせAI（文字起こし・議事録）とAIパースだけ
   app=typeof payload.email!=='string'&&typeof payload.common_name==='string'&&!!payload.common_name&&(!env.APP_SERVICE_TOKEN_ID||payload.common_name===env.APP_SERVICE_TOKEN_ID);
   if(!app&&(typeof payload.email!=='string'||payload.email.toLowerCase()!==env.ALLOWED_EMAIL.trim().toLowerCase()))return deny('このアカウントには利用権限がありません。',403);}
  catch{return deny('ログインを確認できません。再ログインしてください。',401);}
  // ライセンスの登録・確認（アプリが使う。通行証を持たない要求はここまで届かない）
  if(url.pathname.startsWith('/api/license/'))return licenseApi(request,env);
  if(app&&url.pathname.startsWith('/api/ai/'))return appAi(request,env,url.pathname,ctx);
  if(url.pathname==='/api/ai/meeting')return meeting(request,env,app,ctx);
  if(url.pathname==='/api/ai/transcribe')return transcribe(request,env,app,ctx);
  if(url.pathname==='/api/ai/render')return render(request,env,app,ctx);
  if(app)return deny('アプリからはこの操作はできません。',403);
  if(isAPI){if(!env.DB)return json({available:false,error:'クラウド接続の準備中です。端末保存とバックアップを利用できます。'},url.pathname==='/api/session'?200:503);return cloud(request,env.DB,env.ALLOWED_EMAIL.trim().toLowerCase());}
  return serveAssets(request,env);
 }
} satisfies ExportedHandler<Env>;

import {createRemoteJWKSet,jwtVerify} from 'jose';
import {cloud,json} from './cloud';
const keySets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
const deny=(message:string,status:number)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
async function serveAssets(request:Request,env:Env):Promise<Response>{
 const response=await env.ASSETS.fetch(request);const secured=new Response(response.body,response);secured.headers.set('Cache-Control','private, no-store');secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','no-referrer');secured.headers.set('X-Frame-Options','DENY');secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data: blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");return secured;
}
export default {
 async fetch(request:Request,env:Env & {DB?:D1Database;PUBLIC_APP?:string}):Promise<Response>{
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
  try{const issuer='https://'+env.ACCESS_TEAM_DOMAIN;const jwks=keySets.get(issuer)||createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));keySets.set(issuer,jwks);const {payload}=await jwtVerify(token,jwks,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});if(typeof payload.email!=='string'||payload.email.toLowerCase()!==env.ALLOWED_EMAIL.trim().toLowerCase())return deny('このアカウントには利用権限がありません。',403);}
  catch{return deny('ログインを確認できません。再ログインしてください。',401);}
  if(isAPI){if(!env.DB)return json({available:false,error:'クラウド接続の準備中です。端末保存とバックアップを利用できます。'},url.pathname==='/api/session'?200:503);return cloud(request,env.DB,env.ALLOWED_EMAIL.trim().toLowerCase());}
  return serveAssets(request,env);
 }
} satisfies ExportedHandler<Env>;

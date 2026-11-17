// ライセンスキー（クライアントごと）と同時1端末の制限。
// アプリは Access のサービストークン（通行証）で Worker まで届き、その内側でここがキーと端末を確かめる。
// キー本体は保存しない（SHA-256 だけ）。端末にはここで署名したトークン（14日有効）を渡し、AI を呼ぶたびに見せてもらう。
import {json} from './cloud';

export type LicenseEnv={DB?:D1Database;LICENSE_SIGNING_KEY?:string};
export type License={id:number;client_name:string;plan:string;status:string;expires_at:string|null;max_devices:number;swaps_month:string;swaps_count:number;render_monthly_limit:number;transcribe_monthly_min_limit:number};
type Activation={id:number;device_id:string;device_name:string;activated_at:string;last_seen:string};
type TokenBody={lic:number;dev:string;plan:string;iat:number;exp:number};
export type Reason='moved'|'suspended'|'expired'|'invalid';

export const TOKEN_TTL_MS=14*24*3600_000;
export const SWAPS_PER_MONTH=2;
const FAIL_LIMIT=10,FAIL_SLOT_MS=15*60_000;
const enc=new TextEncoder();
export const MESSAGES:Record<Reason,string>={
 moved:'このキーは別の端末で使われています。',
 suspended:'このキーは利用停止中です。担当者へお問い合わせください。',
 expired:'このキーの有効期限が切れています。担当者へお問い合わせください。',
 invalid:'ライセンスを確認できません。キーを入力し直してください。',
};
export const LIMIT_MESSAGE='今月の上限に達しました。来月までお待ちいただくか、担当者へお問い合わせください。';

const b64u=(b:Uint8Array)=>{let s='';for(const c of b)s+=String.fromCharCode(c);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64u=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
// 日本時間の日付・月（期限と月の上限は日本時間で数える）
const jst=(t=Date.now())=>new Date(t+9*3600_000).toISOString();
export const todayJST=(t?:number)=>jst(t).slice(0,10);
export const monthJST=(t?:number)=>jst(t).slice(0,7);
const nowISO=()=>new Date().toISOString();

// キーは大文字・英数字だけにそろえてからハッシュする（ハイフン・空白・小文字の違いを吸収）。scripts/license_admin.py と同じ規則
export const normalizeKey=(key:string)=>key.toUpperCase().replace(/[^A-Z0-9]/g,'');
export async function hashKey(key:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(normalizeKey(key))));}

async function hmac(secret:string){return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signToken(body:TokenBody,secret:string){
 const head=b64u(enc.encode(JSON.stringify(body)));
 return head+'.'+b64u(new Uint8Array(await crypto.subtle.sign('HMAC',await hmac(secret),enc.encode(head))));
}
// 署名が正しければ中身を返す（期限切れでも返す。期限の判断は呼び出し側）
export async function verifyToken(token:string,secret:string):Promise<TokenBody|null>{
 const [head,sig,extra]=token.split('.');
 if(!head||!sig||extra!==undefined||token.length>1000)return null;
 try{
  if(!await crypto.subtle.verify('HMAC',await hmac(secret),unb64u(sig),enc.encode(head)))return null;
  const b=JSON.parse(new TextDecoder().decode(unb64u(head)));
  return typeof b.lic==='number'&&typeof b.dev==='string'&&typeof b.exp==='number'?b:null;
 }catch{return null;}
}

const reject=(reason:Reason)=>json({error:MESSAGES[reason],reason,license:true},401);
const notReady=()=>json({error:'ライセンス確認の準備ができていません。しばらくしてからお試しください。'},503);
const deviceOK=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(v);
const cleanName=(v:unknown)=>(typeof v==='string'?v:'').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,60)||'名前のない端末';
const expired=(l:License,t?:number)=>!!l.expires_at&&todayJST(t)>l.expires_at;

const findByKey=(db:D1Database,keyHash:string)=>db.prepare('SELECT * FROM licenses WHERE key_hash=?').bind(keyHash).first<License>();
const findById=(db:D1Database,id:number)=>db.prepare('SELECT * FROM licenses WHERE id=?').bind(id).first<License>();
const liveDevices=async(db:D1Database,id:number)=>(await db.prepare('SELECT id,device_id,device_name,activated_at,last_seen FROM activations WHERE license_id=? AND revoked_at IS NULL ORDER BY last_seen ASC').bind(id).all<Activation>()).results;

async function issue(env:Required<LicenseEnv>,l:License,dev:string){
 const iat=Date.now(),exp=iat+TOKEN_TTL_MS;
 return json({token:await signToken({lic:l.id,dev,plan:l.plan,iat,exp},env.LICENSE_SIGNING_KEY),clientName:l.client_name,plan:l.plan,expiresAt:l.expires_at,tokenExpiresAt:new Date(exp).toISOString()});
}

// 総当たり対策：同じ IP からのキー間違いが15分で10回を超えたら、しばらく受け付けない
const ipOf=(req:Request)=>(req.headers.get('CF-Connecting-IP')||'unknown').slice(0,64);
const slotOf=()=>Math.floor(Date.now()/FAIL_SLOT_MS);
async function blocked(db:D1Database,ip:string){const r=await db.prepare('SELECT count FROM license_attempts WHERE ip=? AND slot=?').bind(ip,slotOf()).first<{count:number}>();return (r?.count||0)>=FAIL_LIMIT;}
async function failed(db:D1Database,ip:string){
 const slot=slotOf();
 await db.batch([
  db.prepare('INSERT INTO license_attempts(ip,slot,count) VALUES(?,?,1) ON CONFLICT(ip,slot) DO UPDATE SET count=count+1').bind(ip,slot),
  db.prepare('DELETE FROM license_attempts WHERE slot<?').bind(slot-1),
 ]);
}

type Body={key?:unknown;deviceId?:unknown;deviceName?:unknown;token?:unknown};
async function readBody(req:Request):Promise<Body|null>{
 const text=await req.text().catch(()=>'');if(text.length>4000)return null;
 try{const b=JSON.parse(text);return b&&typeof b==='object'?b:null;}catch{return null;}
}

// 端末を紐付ける（空きがあれば）。枠が埋まっていれば null
async function attach(db:D1Database,l:License,dev:string,name:string):Promise<boolean>{
 const t=nowISO();
 const r=await db.prepare('INSERT INTO activations(license_id,device_id,device_name,activated_at,last_seen) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM activations WHERE license_id=? AND revoked_at IS NULL)<?')
  .bind(l.id,dev,name,t,t,l.id,l.max_devices).run().catch(()=>null);
 return !!r?.meta.changes;
}

// POST /api/license/activate|takeover|check|release
export async function licenseApi(req:Request,env:LicenseEnv):Promise<Response>{
 if(!env.LICENSE_SIGNING_KEY||!env.DB)return notReady();
 const e=env as Required<LicenseEnv>,db=e.DB;
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('X-Sketch-Client')!=='2')return json({error:'この画面から操作をやり直してください'},403);
 const action=new URL(req.url).pathname.slice('/api/license/'.length);
 const b=await readBody(req);if(!b)return json({error:'送信内容を読み取れませんでした'},400);
 if(!deviceOK(b.deviceId))return json({error:'端末を確認できませんでした。アプリを開き直してください。'},400);
 const dev=b.deviceId,name=cleanName(b.deviceName);

 if(action==='activate'||action==='takeover'){
  const ip=ipOf(req);
  if(await blocked(db,ip))return json({error:'キーの入力を何度も間違えたため、しばらく受け付けません。15分ほど待ってからお試しください。'},429);
  const key=typeof b.key==='string'?b.key:'';
  const n=normalizeKey(key);
  const l=n.length>=12&&n.length<=40?await findByKey(db,await hashKey(key)):null;
  if(!l){await failed(db,ip);return json({error:'キーが正しくありません。入力し直してください。'},401);}
  if(l.status!=='active')return json({error:MESSAGES.suspended,reason:'suspended'},403);
  if(expired(l))return json({error:MESSAGES.expired,reason:'expired'},403);
  const live=await liveDevices(db,l.id),mine=live.find(a=>a.device_id===dev);
  if(mine){await db.prepare('UPDATE activations SET last_seen=?,device_name=? WHERE id=?').bind(nowISO(),name,mine.id).run();return issue(e,l,dev);}
  if(live.length<l.max_devices&&await attach(db,l,dev,name))return issue(e,l,dev);
  const others=await liveDevices(db,l.id);
  if(!others.length&&await attach(db,l,dev,name))return issue(e,l,dev);
  // 使っていない時間がいちばん長い端末を、切り替えの対象にする
  const old=others[0];
  if(!old)return json({error:'登録が重なりました。もう一度お試しください。'},409);
  if(action==='activate')return json({error:'このキーは別の端末で使われています。',inUse:true,deviceName:old.device_name,since:old.activated_at},409);
  const month=monthJST(),used=l.swaps_month===month?l.swaps_count:0;
  if(used>=SWAPS_PER_MONTH)return json({error:`端末の切り替えは月${SWAPS_PER_MONTH}回までです。管理者へご連絡ください。`,swapLimit:true},429);
  const t=nowISO();
  const res=await db.batch([
   db.prepare('UPDATE activations SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(t,old.id),
   db.prepare('UPDATE licenses SET swaps_month=?,swaps_count=? WHERE id=?').bind(month,used+1,l.id),
  ]);
  if(!res[0].meta.changes||!await attach(db,l,dev,name))return json({error:'切り替えが重なりました。もう一度お試しください。'},409);
  return issue(e,l,dev);
 }

 if(action==='check'||action==='release'){
  const p=typeof b.token==='string'?await verifyToken(b.token,e.LICENSE_SIGNING_KEY):null;
  if(!p||p.dev!==dev)return reject('invalid');
  const l=await findById(db,p.lic);if(!l)return reject('invalid');
  const live=(await liveDevices(db,l.id)).find(a=>a.device_id===dev);
  if(action==='release'){
   if(live)await db.prepare('UPDATE activations SET revoked_at=? WHERE id=?').bind(nowISO(),live.id).run();
   return json({released:true});
  }
  if(l.status!=='active')return reject('suspended');
  if(expired(l))return reject('expired');
  if(!live)return reject('moved');
  await db.prepare('UPDATE activations SET last_seen=? WHERE id=?').bind(nowISO(),live.id).run();
  return issue(e,l,dev);
 }
 return json({error:'見つかりません'},404);
}

// アプリから AI を呼ぶときの確認。有効なトークンと、今使える端末であること
export async function requireLicense(req:Request,env:LicenseEnv):Promise<License|Response>{
 if(!env.LICENSE_SIGNING_KEY||!env.DB)return notReady();
 const p=await verifyToken(req.headers.get('X-License-Token')||'',env.LICENSE_SIGNING_KEY);
 const dev=req.headers.get('X-Device-Id')||'';
 if(!p||p.dev!==dev||p.exp<Date.now())return reject('invalid');
 const l=await findById(env.DB,p.lic);
 if(!l)return reject('invalid');
 if(l.status!=='active')return reject('suspended');
 if(expired(l))return reject('expired');
 const r=await env.DB.prepare('UPDATE activations SET last_seen=? WHERE license_id=? AND device_id=? AND revoked_at IS NULL').bind(nowISO(),l.id,dev).run();
 if(!r.meta.changes)return reject('moved');
 return l;
}

// 月の上限（render＝回数、transcribe＝分。記録は秒）
export type Metered='render'|'transcribe'|'meeting';
const FEATURE:Record<Metered,string>={render:'render',transcribe:'transcribe_sec',meeting:'meeting'};
// 議事録づくり（いちばん費用がかかる AI）は、どのキーも月300回まで
export const MEETING_MONTHLY_LIMIT=300;
export async function usedThisMonth(db:D1Database,id:number,feature:Metered){
 const r=await db.prepare('SELECT count FROM license_usage WHERE license_id=? AND month=? AND feature=?').bind(id,monthJST(),FEATURE[feature]).first<{count:number}>();
 return r?.count||0;
}
export async function withinLimit(db:D1Database,l:License,feature:Metered){
 const used=await usedThisMonth(db,l.id,feature);
 if(feature==='meeting')return used<MEETING_MONTHLY_LIMIT;
 return feature==='render'?used<l.render_monthly_limit:used<l.transcribe_monthly_min_limit*60;
}
export async function addUsage(db:D1Database,id:number,feature:Metered,amount:number){
 await db.prepare('INSERT INTO license_usage(license_id,month,feature,count) VALUES(?,?,?,?) ON CONFLICT(license_id,month,feature) DO UPDATE SET count=count+excluded.count')
  .bind(id,monthJST(),FEATURE[feature],Math.max(0,Math.round(amount))).run();
}

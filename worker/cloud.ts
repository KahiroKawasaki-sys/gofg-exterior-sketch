import {Buffer} from 'node:buffer';
import type {D1Database} from '@cloudflare/workers-types';
import {validatePlan} from '../src/model';
const CHUNK=1024*1024,LIMIT=400*1024*1024;
const idOK=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const planOK=(v:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
const error=(message:string,status=400)=>json({error:message},status);
const hash=async(data:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
async function readBytes(req:Request,max:number){if(Number(req.headers.get('content-length'))>max)throw Error('入力が大きすぎます');const reader=req.body?.getReader();if(!reader)return new Uint8Array(0);const pieces:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('入力が大きすぎます');}pieces.push(value);}const joined=new Uint8Array(size);let offset=0;for(const piece of pieces){joined.set(piece,offset);offset+=piece.length;}return joined;}finally{reader.releaseLock();}}
async function readJSON(req:Request,max:number){return JSON.parse(new TextDecoder().decode(await readBytes(req,max)));}
type Manifest={owner:string;id:string;bytes:number;parts:number;hashes:string;media:string;name:string;complete:number;created:string};
async function manifest(db:D1Database,owner:string,id:string){return db.prepare('SELECT * FROM blobs WHERE owner=? AND id=?').bind(owner,id).first<Manifest>();}
async function payload(db:D1Database,owner:string,id:string){const m=await manifest(db,owner,id);if(!m?.complete||m.media!=='application/json'||m.bytes>12*CHUNK)throw Error('編集データが未完成です');const r=await db.prepare('SELECT body FROM chunks WHERE owner=? AND blob_id=? ORDER BY n').bind(owner,id).all<{body:string}>();let offset=0;const bytes=new Uint8Array(m.bytes);for(const part of r.results){const piece=Buffer.from(part.body,'base64');bytes.set(piece,offset);offset+=piece.length;}if(offset!==m.bytes)throw Error('編集データが欠けています');return JSON.parse(new TextDecoder().decode(bytes));}
export async function cloud(req:Request,db:D1Database,owner:string):Promise<Response>{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(!['GET','HEAD','POST','PUT'].includes(method))return error('この操作には対応していません',405);
 if(!['GET','HEAD'].includes(method)&&(req.headers.get('Origin')!==url.origin||req.headers.get('X-Sketch-Client')!=='2'))return error('この画面から操作をやり直してください',403);
 try{
 if(path==='/api/session'&&method==='GET'){const used=await db.prepare('SELECT COALESCE(SUM(bytes*4/3+parts*512+1024),0) AS total FROM blobs WHERE owner=?').bind(owner).first<{total:number}>();return json({available:true,bytes:used?.total||0,limit:LIMIT});}
 if(path==='/api/blobs'&&method==='POST'){
  const b=await readJSON(req,16000);if(!idOK(b.id)||!Number.isSafeInteger(b.bytes)||b.bytes<1||b.bytes>24*CHUNK||!Array.isArray(b.hashes)||b.hashes.length!==Math.ceil(b.bytes/CHUNK)||!b.hashes.every(idOK)||!['application/json','application/pdf','image/png','image/jpeg','image/webp'].includes(b.media)||typeof b.name!=='string'||b.name.length>255||(b.media==='application/json'&&b.bytes>12*CHUNK)||(b.media==='application/pdf'&&b.bytes>20*CHUNK))return error('ファイルの形式・容量を確認してください');
  const calculated=await hash(new TextEncoder().encode(b.hashes.join('')+':'+b.bytes));if(calculated!==b.id)return error('ファイルの確認情報が一致しません');
  const old=await manifest(db,owner,b.id);if(old)return json({complete:!!old.complete,id:b.id});
  const result=await db.prepare('INSERT OR IGNORE INTO blobs(owner,id,bytes,parts,hashes,media,name,created) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(bytes*4/3+parts*512+1024),0) FROM blobs WHERE owner=?)+?<=?').bind(owner,b.id,b.bytes,b.hashes.length,JSON.stringify(b.hashes),b.media,b.name,new Date().toISOString(),owner,Math.ceil(b.bytes*4/3)+b.hashes.length*512+1024,LIMIT).run();
  if(!result.meta.changes)return error('クラウド容量が上限です。端末保存は継続できます。バックアップ後に容量を整理してください',507);
  return json({id:b.id,complete:false});
 }
 const blobRoute=path.match(/^\/api\/blobs\/([a-f0-9]{64})(?:\/(\d+|complete))?$/);
 if(blobRoute){
  const [,id,part]=blobRoute,m=await manifest(db,owner,id);if(!m)return error('ファイルがありません',404);
  if(!part&&method==='GET')return m.complete?json({id,bytes:m.bytes,parts:m.parts,hashes:JSON.parse(m.hashes),media:m.media,name:m.name}):error('同期中のファイルです',409);
  if(part==='complete'&&method==='POST'){const count=await db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE owner=? AND blob_id=?').bind(owner,id).first<{total:number}>();if(count?.total!==m.parts)return error('ファイルがまだ揃っていません',409);await db.prepare('UPDATE blobs SET complete=1 WHERE owner=? AND id=?').bind(owner,id).run();return json({id,complete:true});}
  if(part&&/^\d+$/.test(part)){const n=Number(part);if(n>=m.parts)return error('分割番号が正しくありません');
   if(method==='PUT'){if(m.complete)return json({saved:true});const bytes=await readBytes(req,CHUNK),expected=n===m.parts-1?m.bytes-n*CHUNK:CHUNK;if(bytes.byteLength!==expected||await hash(bytes as Uint8Array<ArrayBuffer>)!==JSON.parse(m.hashes)[n])return error('ファイルの一部が破損しています');const encoded=Buffer.from(bytes).toString('base64');await db.prepare('INSERT OR REPLACE INTO chunks(owner,blob_id,n,body) VALUES(?,?,?,?)').bind(owner,id,n,encoded).run();return json({saved:true});}
   if(method==='GET'&&m.complete){const result=await db.prepare('SELECT body FROM chunks WHERE owner=? AND blob_id=? AND n=?').bind(owner,id,n).first<{body:string}>();return result?json(result):error('ファイルの一部がありません',404);}
  }return error('この操作には対応していません',405);
 }
 if(path==='/api/plans'&&method==='GET'){const result=await db.prepare('SELECT id,name,assignee,archived,revision,payload,updated FROM plans WHERE owner=? ORDER BY updated DESC LIMIT 1000').bind(owner).all();return json({plans:result.results});}
 const route=path.match(/^\/api\/plans\/([^/]+)(?:\/(history))?$/);
 if(route){const id=decodeURIComponent(route[1]);if(!planOK(id))return error('案件IDが正しくありません');
  if(route[2]==='history'&&method==='GET'){const result=await db.prepare('SELECT revision,payload,updated FROM versions WHERE owner=? AND plan_id=? ORDER BY revision DESC LIMIT 10').bind(owner,id).all();return json({versions:result.results});}
  if(!route[2]&&method==='GET'){const found=await db.prepare('SELECT id,name,assignee,archived,revision,payload,updated FROM plans WHERE owner=? AND id=?').bind(owner,id).first();return found?json(found):error('案件がありません',404);}
  if(!route[2]&&method==='PUT'){
   const b=await readJSON(req,2000);if(!idOK(b.payload)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||typeof b.operation!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(b.operation))return error('保存情報が正しくありません');
   const existing=await db.prepare('SELECT revision,operation,payload FROM plans WHERE owner=? AND id=?').bind(owner,id).first<{revision:number;operation:string;payload:string}>();
   if(existing&&existing.operation===b.operation&&existing.payload===b.payload)return json({revision:existing.revision});
   if((existing?.revision||0)!==b.expectedRevision)return error('別端末で更新されています。手元の編集を別案に保存してください',409);
   const data=await payload(db,owner,b.payload),doc=validatePlan(data.plan);if(doc.id!==id)return error('案件IDが一致しません');
   const refs=[b.payload];if(doc.underlay){if(!idOK(data.preview))return error('下絵がありません');const preview=await manifest(db,owner,data.preview);if(!preview?.complete||!['image/png','image/jpeg'].includes(preview.media))return error('下絵の保存が完了していません');refs.push(data.preview);}
   if(doc.underlay?.assetId){if(!idOK(data.original))return error('原本がありません');const original=await manifest(db,owner,data.original);if(!original?.complete||!['application/pdf','image/png','image/jpeg','image/webp'].includes(original.media)||original.bytes>20*CHUNK)return error('原本の保存が完了していません');refs.push(data.original);}
   const revision=b.expectedRevision+1,updated=new Date().toISOString(),statements=[
    db.prepare('INSERT INTO plans(owner,id,name,assignee,archived,revision,payload,operation,updated) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,assignee=excluded.assignee,archived=excluded.archived,revision=excluded.revision,payload=excluded.payload,operation=excluded.operation,updated=excluded.updated WHERE plans.revision=?').bind(owner,id,doc.name,doc.owner||'',doc.archived?1:0,revision,b.payload,b.operation,updated,b.expectedRevision),
    db.prepare('INSERT OR IGNORE INTO versions(owner,plan_id,revision,payload,updated) SELECT owner,id,revision,payload,updated FROM plans WHERE owner=? AND id=? AND operation=?').bind(owner,id,b.operation),
    ...refs.map(ref=>db.prepare('INSERT OR IGNORE INTO version_assets(owner,plan_id,revision,blob_id) SELECT owner,id,revision,? FROM plans WHERE owner=? AND id=? AND operation=?').bind(ref,owner,id,b.operation)),
    db.prepare('DELETE FROM versions WHERE owner=? AND plan_id=? AND revision<(SELECT MAX(revision)-9 FROM versions WHERE owner=? AND plan_id=?)').bind(owner,id,owner,id)
   ];
   const result=await db.batch(statements);if(!result[0].meta.changes)return error('別端末で更新されています。編集内容は端末に残っています',409);
   return json({revision,updated});
  }
 }
 if(path==='/api/maintenance'&&method==='POST'){await db.prepare("DELETE FROM blobs WHERE owner=? AND created<? AND NOT EXISTS(SELECT 1 FROM version_assets WHERE version_assets.owner=blobs.owner AND version_assets.blob_id=blobs.id)").bind(owner,new Date(Date.now()-86400000).toISOString()).run();return json({ok:true});}
 return error('この保存操作は見つかりません',404);
 }catch(e){const message=e instanceof Error?e.message:'';if(/SQLITE|D1_|quota|limit/i.test(message))return error('クラウド保存を利用できません。端末の編集は残っています。時間を置いて再試行してください',503);return error(message||'保存データを確認してください');}
}

// v0.3 キャンバスのクラウド保存。ファイル本体の分割保存・容量上限・認証は v0.2 と共通（cloud.ts）。
import type {D1Database} from '@cloudflare/workers-types';
import {error,idOK,json,manifest,payload,readJSON} from './cloud';
const canvasOK=(v:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const ASSET=/^gofg-asset:([a-f0-9]{64})$/;
const IMAGES=['image/png','image/jpeg','image/webp'];
// 画像は「gofg-asset:<ID>」に置き換えて別ファイルで保存する。編集データ内の参照を集める
export function assetRefs(value:unknown,found=new Set<string>()):Set<string>{
 if(typeof value==='string'){const m=ASSET.exec(value);if(m)found.add(m[1]);}
 else if(Array.isArray(value))for(const v of value)assetRefs(v,found);
 else if(value&&typeof value==='object')for(const v of Object.values(value))assetRefs(v,found);
 return found;
}
function validCanvas(v:unknown,id:string){
 const d=v as {schema?:unknown;id?:unknown;name?:unknown;layers?:unknown;guides?:unknown};
 if(!d||d.schema!==3||d.id!==id||typeof d.name!=='string'||!Array.isArray(d.layers)||!Array.isArray(d.guides))throw Error('v0.3のキャンバスとして読み込めません');
 return d as {name:string};
}
type Head={revision:number;operation:string;payload:string;deleted:number};
export async function canvases(req:Request,db:D1Database,owner:string):Promise<Response>{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(path==='/api/canvases'&&method==='GET'){const r=await db.prepare('SELECT id,name,revision,payload,deleted,updated FROM canvases WHERE owner=? ORDER BY updated DESC LIMIT 1000').bind(owner).all();return json({canvases:r.results});}
 const route=path.match(/^\/api\/canvases\/([^/]+)(?:\/(history))?$/);
 if(!route)return error('この保存操作は見つかりません',404);
 const id=decodeURIComponent(route[1]);if(!canvasOK(id))return error('キャンバスIDが正しくありません');
 if(route[2]==='history'&&method==='GET'){const r=await db.prepare('SELECT revision,payload,updated FROM canvas_versions WHERE owner=? AND canvas_id=? ORDER BY revision DESC LIMIT 10').bind(owner,id).all();return json({versions:r.results});}
 if(route[2])return error('この操作には対応していません',405);
 if(method==='GET'){const found=await db.prepare('SELECT id,name,revision,payload,deleted,updated FROM canvases WHERE owner=? AND id=?').bind(owner,id).first();return found?json(found):error('キャンバスがありません',404);}
 if(method!=='PUT')return error('この操作には対応していません',405);
 const b=await readJSON(req,2000);
 if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||typeof b.operation!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(b.operation)||(b.deleted!==true&&!idOK(b.payload)))return error('保存情報が正しくありません');
 const existing=await db.prepare('SELECT revision,operation,payload,deleted FROM canvases WHERE owner=? AND id=?').bind(owner,id).first<Head>();
 if(existing&&existing.operation===b.operation)return json({revision:existing.revision});
 if((existing?.revision||0)!==b.expectedRevision)return error('別端末で更新されています。手元の編集は端末に残っています',409);
 const revision=b.expectedRevision+1,updated=new Date().toISOString();
 // 削除は印だけ付ける（履歴と画像は残し、他の端末へ削除を伝える）
 if(b.deleted===true){
  if(!existing)return json({revision:0});
  const r=await db.prepare('UPDATE canvases SET deleted=1,revision=?,operation=?,updated=? WHERE owner=? AND id=? AND revision=?').bind(revision,b.operation,updated,owner,id,b.expectedRevision).run();
  if(!r.meta.changes)return error('別端末で更新されています。手元の編集は端末に残っています',409);
  return json({revision,updated});
 }
 const data=await payload(db,owner,b.payload),doc=validCanvas(data?.doc,id),refs=[b.payload];
 for(const ref of assetRefs(data)){const m=await manifest(db,owner,ref);if(!m?.complete||!IMAGES.includes(m.media))return error('画像の保存が完了していません');refs.push(ref);}
 if(refs.length>200)return error('画像が多すぎます');
 const statements=[
  db.prepare('INSERT INTO canvases(owner,id,name,revision,payload,operation,deleted,updated) VALUES(?,?,?,?,?,?,0,?) ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,revision=excluded.revision,payload=excluded.payload,operation=excluded.operation,deleted=0,updated=excluded.updated WHERE canvases.revision=?').bind(owner,id,doc.name.slice(0,200),revision,b.payload,b.operation,updated,b.expectedRevision),
  db.prepare('INSERT OR IGNORE INTO canvas_versions(owner,canvas_id,revision,payload,updated) SELECT owner,id,revision,payload,updated FROM canvases WHERE owner=? AND id=? AND operation=?').bind(owner,id,b.operation),
  ...refs.map(ref=>db.prepare('INSERT OR IGNORE INTO canvas_assets(owner,canvas_id,revision,blob_id) SELECT owner,id,revision,? FROM canvases WHERE owner=? AND id=? AND operation=?').bind(ref,owner,id,b.operation)),
  db.prepare('DELETE FROM canvas_versions WHERE owner=? AND canvas_id=? AND revision<(SELECT MAX(revision)-9 FROM canvas_versions WHERE owner=? AND canvas_id=?)').bind(owner,id,owner,id),
 ];
 const result=await db.batch(statements);if(!result[0].meta.changes)return error('別端末で更新されています。手元の編集は端末に残っています',409);
 return json({revision,updated});
}

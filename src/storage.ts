import {validatePlan,uid,type Plan} from './model';
export type SyncRecord={id:string;cloudRevision:number;syncedLocalRevision:number;cloudPayload?:string};
export type Original={id:string;name:string;type:string;blob:Blob};
export class ConflictError extends Error{constructor(){super('別のタブで更新されています。別案に複製してから、案件一覧で最新版を開いてください');}}
export function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('gofg-exterior-sketch-v1',2);r.onupgradeneeded=()=>{for(const n of ['plans','originals','sync','legacy','recovery'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('古いアプリのタブを閉じてから再試行してください'));});}
export async function readStore<T>(name:string,id:string):Promise<T|undefined>{const db=await openDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function writeStore(name:string,value:unknown){const db=await openDB();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(name,'readwrite');tx.objectStore(name).put(value);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||Error('端末保存が中断されました'));});}finally{db.close();}}
export async function listPlans():Promise<Plan[]>{const db=await openDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction('plans').objectStore('plans').getAll();r.onsuccess=()=>{const valid:Plan[]=[];let broken=0;for(const v of r.result){try{valid.push(validatePlan(v));}catch{broken++;}}if(broken&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('storage-warning',{detail:broken+'件の案件を読み込めませんでした。元データは保持しています。'}));resolve(valid.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));};r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function savePlan(doc:Plan,expectedRevision:number):Promise<Plan>{
 const clean=validatePlan(doc),db=await openDB();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['plans','legacy'],'readwrite'),store=tx.objectStore('plans');let result:Plan;let failure:Error|null=null;const read=store.get(doc.id);
 read.onsuccess=()=>{const existing=read.result as Plan|undefined;if((existing?.revision||0)!==expectedRevision){failure=new ConflictError();tx.abort();return;}if(existing?.schema===1)tx.objectStore('legacy').put(existing);result={...clean,revision:expectedRevision+1,updatedAt:new Date().toISOString()};store.put(result);};
 tx.oncomplete=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('plan-saved'));resolve(result);};tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('端末保存に失敗しました'));
 });}finally{db.close();}
}
export async function putOriginal(file:File,id=crypto.randomUUID()){await writeStore('originals',{id,name:file.name,type:file.type,blob:file});return id;}
export const getOriginal=(id:string)=>readStore<Original>('originals',id);
export const getSync=(id:string)=>readStore<SyncRecord>('sync',id);
export const putSync=(v:SyncRecord)=>writeStore('sync',v);
export async function receiveCloud(doc:Plan,cloudRevision:number,payload:string,expectedLocal:number){const clean=validatePlan(doc),db=await openDB();try{return await new Promise<Plan>((resolve,reject)=>{const tx=db.transaction(['plans','sync'],'readwrite'),plans=tx.objectStore('plans'),r=plans.get(doc.id);let saved:Plan;let failure:Error;r.onsuccess=()=>{if((r.result?.revision||0)!==expectedLocal){failure=new ConflictError();tx.abort();return;}saved={...clean,revision:expectedLocal+1};plans.put(saved);tx.objectStore('sync').put({id:doc.id,cloudRevision,syncedLocalRevision:saved.revision,cloudPayload:payload});};tx.oncomplete=()=>resolve(saved);tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('受信データを保存できませんでした'));});}finally{db.close();}}

export async function resolveCloudConflict(remote:Plan,cloudRevision:number,payload:string,expectedLocal:number){
 const clean=validatePlan(remote),db=await openDB();try{return await new Promise<Plan>((resolve,reject)=>{
  const tx=db.transaction(['plans','sync'],'readwrite'),plans=tx.objectStore('plans'),r=plans.get(clean.id);let saved:Plan;let failure:Error;
  r.onsuccess=()=>{const local=r.result as Plan|undefined;if(!local||local.revision!==expectedLocal){failure=new ConflictError();tx.abort();return;}
   const now=new Date().toISOString();plans.put({...local,id:uid(),revision:1,archived:false,name:(local.name+'（この端末の別案）').slice(0,120),updatedAt:now});
   saved={...clean,revision:expectedLocal+1};plans.put(saved);tx.objectStore('sync').put({id:clean.id,cloudRevision,syncedLocalRevision:saved.revision,cloudPayload:payload});};
  tx.oncomplete=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('plan-saved'));resolve(saved);};tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('競合を解決できませんでした'));
 });}finally{db.close();}
}

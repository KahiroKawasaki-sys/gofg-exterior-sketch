import {validatePlan,type Plan} from './model';
import {getOriginal,getSync,putSync,listPlans,receiveCloud,resolveCloudConflict,readStore,writeStore} from './storage';
const CHUNK=1024*1024;
const EMPTY='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
export class CloudError extends Error{constructor(message:string,public status:number){super(message);}}
export type CloudHead={id:string;name:string;assignee:string;archived:number;revision:number;payload:string;updated:string};
export type CloudStatus={available:boolean;publicPreview?:boolean;bytes?:number;limit?:number;error?:string};
const hash=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
async function api<T>(path:string,method='GET',body?:BodyInit):Promise<T>{
 let response:Response;try{response=await fetch('/api'+path,{method,body,credentials:'same-origin',cache:'no-store',headers:{'X-Sketch-Client':'2','Content-Type':body instanceof ArrayBuffer?'application/octet-stream':'application/json'},signal:AbortSignal.timeout(30000)});}catch{throw new CloudError('通信できません。編集内容は端末に保存し、接続後に再試行します',0);}
 if(!response.headers.get('content-type')?.includes('application/json'))throw new CloudError('ログイン期限または接続を確認してください。編集内容は端末に残っています',401);
 const data=await response.json();if(!response.ok)throw new CloudError(data.error||'クラウド保存に失敗しました',response.status);return data as T;
}
export async function cloudStatus():Promise<CloudStatus>{try{return await api<CloudStatus>('/session');}catch(e){return {available:false,error:e instanceof Error?e.message:'クラウド接続を確認してください'};}}
async function upload(blob:Blob,name:string){
 const hashes:string[]=[];for(let offset=0;offset<blob.size;offset+=CHUNK)hashes.push(await hash(await blob.slice(offset,offset+CHUNK).arrayBuffer()));
 const id=await hash(new TextEncoder().encode(hashes.join('')+':'+blob.size));
 const created=await api<{complete:boolean}>('/blobs','POST',JSON.stringify({id,hashes,bytes:blob.size,media:blob.type,name}));
 if(!created.complete){for(let n=0;n<hashes.length;n++)await api('/blobs/'+id+'/'+n,'PUT',await blob.slice(n*CHUNK,(n+1)*CHUNK).arrayBuffer());await api('/blobs/'+id+'/complete','POST','{}');}return id;
}
export async function downloadCloudBlob(id:string){const meta=await api<{bytes:number;parts:number;hashes:string[];media:string;name:string}>('/blobs/'+id);if(meta.bytes>24*CHUNK||meta.parts>24||meta.parts!==Math.ceil(meta.bytes/CHUNK))throw Error('保存ファイルの容量が正しくありません');const pieces:Uint8Array<ArrayBuffer>[]=[];for(let n=0;n<meta.parts;n++){const {body}=await api<{body:string}>('/blobs/'+id+'/'+n),binary=atob(body),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));if(await hash(bytes)!==meta.hashes[n])throw Error('受信データの確認に失敗しました。再試行してください');pieces.push(bytes);}const calculated=await hash(new TextEncoder().encode(meta.hashes.join('')+':'+meta.bytes));if(calculated!==id)throw Error('受信ファイルが一致しません');const blob=new Blob(pieces,{type:meta.media});if(blob.size!==meta.bytes)throw Error('受信サイズが一致しません');return {blob,name:meta.name,type:meta.media};}
async function dataURL(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
export async function fetchCloudPlan(payloadId:string){const {blob}=await downloadCloudBlob(payloadId),data=JSON.parse(await blob.text()),doc=validatePlan(data.plan);if(doc.underlay){const source=await downloadCloudBlob(data.preview);doc.underlay.src=await dataURL(source.blob);if(doc.underlay.assetId){const original=await downloadCloudBlob(data.original);await writeStore('originals',{id:doc.underlay.assetId,...original});}}return validatePlan(doc);}
function previewBlob(src:string){const comma=src.indexOf(','),media=/^data:(image\/(?:png|jpeg));base64$/.exec(src.slice(0,comma))?.[1];if(!media)throw Error('下絵の保存形式が正しくありません');const binary=atob(src.slice(comma+1)),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:media});}
async function push(doc:Plan){const sync=await getSync(doc.id);if(sync?.syncedLocalRevision===doc.revision)return;
 const copy=validatePlan(doc);let preview:string|undefined,original:string|undefined;
 if(copy.underlay){preview=await upload(previewBlob(copy.underlay.src),'underlay.png');if(copy.underlay.assetId){const source=await getOriginal(copy.underlay.assetId);if(!source)throw Error('原本が端末にありません。元の端末でバックアップを作成してください');original=await upload(source.blob,source.name);}copy.underlay.src=EMPTY;}
 const payload=await upload(new Blob([JSON.stringify({plan:copy,preview,original})],{type:'application/json'}),'plan.json'),expectedRevision=sync?.cloudRevision||0;
 const result=await api<{revision:number}>('/plans/'+encodeURIComponent(doc.id),'PUT',JSON.stringify({payload,expectedRevision,operation:payload+'_'+expectedRevision}));
 await putSync({id:doc.id,cloudRevision:result.revision,syncedLocalRevision:doc.revision,cloudPayload:payload});
}
let running:Promise<{conflicts:string[]}>|null=null;
export async function synchronize(pull=false):Promise<{conflicts:string[]}>{
 if(running){const previous=await running;if(!pull)return previous;}
 const execute=async()=>{const status=await cloudStatus();if(!status.available)throw new CloudError(status.error||'クラウド接続の準備中です',503);const conflicts:string[]=[];
 if(pull){const remote=await api<{plans:CloudHead[]}>('/plans'),local=await listPlans();for(const head of remote.plans){const doc=local.find(p=>p.id===head.id),sync=await getSync(head.id);if(doc&&doc.revision!==(sync?.syncedLocalRevision||0)){if(head.revision!==(sync?.cloudRevision||0))conflicts.push(head.id);continue;}if(!doc||head.revision>(sync?.cloudRevision||0)){const received=await fetchCloudPlan(head.payload);await receiveCloud(received,head.revision,head.payload,doc?.revision||0);}}}
 for(const doc of await listPlans()){if(conflicts.includes(doc.id))continue;try{await push(doc);}catch(e){if(e instanceof CloudError&&e.status===409)conflicts.push(doc.id);else throw e;}}
 return {conflicts};};
 running=(navigator.locks?navigator.locks.request('gofg-cloud-sync',execute):execute());
 try{return await running;}finally{running=null;}
}
export async function history(id:string){return (await api<{versions:{revision:number;payload:string;updated:string}[]}>('/plans/'+encodeURIComponent(id)+'/history')).versions;}
export async function maintenance(){return api('/maintenance','POST','{}');}

export async function pendingSyncCount(){let n=0;for(const p of await listPlans())if((await getSync(p.id))?.syncedLocalRevision!==p.revision)n++;return n;}
export async function resolveConflict(id:string){
 const execute=async()=>{const local=await readStore<Plan>('plans',id);if(!local)throw Error('端末の案件が見つかりません');const head=await api<CloudHead>('/plans/'+encodeURIComponent(id));const remote=await fetchCloudPlan(head.payload);return resolveCloudConflict(remote,head.revision,head.payload,local.revision);};
 if(running)await running;
 return navigator.locks?navigator.locks.request('gofg-cloud-sync',execute):execute();
}

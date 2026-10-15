import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import type {D1Database} from '@cloudflare/workers-types';
import 'fake-indexeddb/auto';
import {cloud} from '../worker/cloud';
import {synchronize,markDeleted} from '../src/v3/cloudSync';
import {saveDoc,loadDoc,listDocs,deleteDoc} from '../src/v3/store';
import {newDoc,type Doc,type TextureItem} from '../src/v3/types';
let mf:Miniflare,db:D1Database,offline=false,who='v3-owner@example.test';
const origin='https://v3sync.example.test';
const request=(path:string,init:RequestInit={})=>cloud(new Request(origin+'/api'+path,{...init,headers:{Origin:origin,'X-Sketch-Client':'2','Content-Type':'application/json',...Object.fromEntries(new Headers(init.headers))}}),db,who);
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-19',d1Databases:['DB']}));
 db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const f of ['0001_cloud.sql','0002_canvases.sql'])await db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8').replace(/\n/g,' '));
 vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{if(offline)throw Error('offline');if(!url.startsWith('/api/'))throw new TypeError('blocked');return cloud(new Request(origin+url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Origin:origin}}),db,who);});
},30000);
afterAll(async()=>{vi.unstubAllGlobals();await mf?.dispose();});
// 端末を入れ替える＝端末の保存領域を空にする
async function newDevice(){for(const d of await listDocs())await deleteDoc(d.id);await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('gofg-sketch-v3',1);r.onsuccess=()=>{const t=r.result.transaction('meta','readwrite');t.objectStore('meta').clear();t.oncomplete=()=>{r.result.close();resolve();};t.onerror=()=>reject(t.error);};r.onupgradeneeded=()=>{for(const n of ['docs','library','meta'])r.result.createObjectStore(n,{keyPath:'id'});};r.onerror=()=>reject(r.error);});}
beforeEach(async()=>{offline=false;who='v3-owner@example.test';await newDevice();await db.exec('DELETE FROM canvas_assets; DELETE FROM canvas_versions; DELETE FROM canvases; DELETE FROM chunks; DELETE FROM blobs;');});
const png=(seed:number)=>'data:image/png;base64,'+Buffer.from(Array.from({length:4000},(_,i)=>(i*seed)%251)).toString('base64');
const edit=(d:Doc,name:string):Doc=>({...d,name,updatedAt:new Date(Date.parse(d.updatedAt)+1000).toISOString()});
function withImages(name:string):Doc{
 const d=newDoc(name),tex:TextureItem={id:'t1',type:'texture',name:'芝生',mask:png(3),x:0,y:0,w:10,h:10,tex:png(5),texName:'芝生',scale:1,rot:0,hue:0,sat:100,bright:100,contrast:100};
 return {...d,underlay:{src:png(7),name:'plan.pdf',x:0,y:0,w:100,h:80,opacity:.6,visible:true,locked:true},layers:d.layers.map(l=>l.kind==='fill'?{...l,items:[tex]}:l)};
}

it('端末Aで保存した下絵・塗り付きのキャンバスを、空の端末Bでそのまま開ける',async()=>{
 const a=withImages('A邸');await saveDoc({...a,view:{x:1,y:2,k:3,r:0}},png(11));
 expect(await synchronize(false)).toEqual({forked:0,pending:0});
 await newDevice();expect(await listDocs()).toHaveLength(0);
 await synchronize(true);
 const b=await loadDoc(a.id) as Doc&{thumb?:string};
 expect(b).toMatchObject({...a,thumb:png(11)});expect(b.view).toBeUndefined();
});

it('同じ画像は一度だけ送り、文字だけの変更では画像を送り直さない',async()=>{
 const a=withImages('重複');await saveDoc(a);await synchronize(false);
 const count=async()=>(await db.prepare("SELECT COUNT(*) AS n FROM blobs WHERE media LIKE 'image/%'").first<{n:number}>())!.n;
 expect(await count()).toBe(3);
 await saveDoc(edit(a,'重複 変更'));await synchronize(false);
 expect(await count()).toBe(3);
 const head=await (await request('/canvases/'+a.id)).json() as any;expect(head).toMatchObject({name:'重複 変更',revision:2,deleted:0});
});

it('通信できない間は端末に残り、つながったら送る',async()=>{
 const a=newDoc('通信待ち');await saveDoc(a);offline=true;
 await expect(synchronize(false)).rejects.toThrow('通信できません');
 expect((await loadDoc(a.id))?.name).toBe('通信待ち');
 offline=false;await synchronize(false);
 expect((await request('/canvases/'+a.id)).status).toBe(200);
});

const idb=<T,>(f:(db:IDBDatabase)=>Promise<T>)=>new Promise<T>((resolve,reject)=>{const q=indexedDB.open('gofg-sketch-v3',1);q.onsuccess=()=>f(q.result).then(resolve,reject).finally(()=>q.result.close());q.onerror=()=>reject(q.error);});
// 端末の同期情報だけを書き出し・書き戻す（古い状態の端末を再現する）
const dumpMeta=()=>idb(db=>new Promise<unknown[]>(r=>{const g=db.transaction('meta').objectStore('meta').getAll();g.onsuccess=()=>r(g.result);}));
const restoreMeta=(rows:unknown[])=>idb(db=>new Promise<void>(r=>{const t=db.transaction('meta','readwrite');for(const m of rows)t.objectStore('meta').put(m);t.oncomplete=()=>r();}));

it('2台で同時に編集したら、端末の版を別名で残してクラウドの版を受け取る',async()=>{
 const base=newDoc('共通');await saveDoc(base);await synchronize(false);const deviceA=await dumpMeta();
 await newDevice();await synchronize(true);await saveDoc(edit(base,'Bの変更'));await synchronize(false);
 await newDevice();await saveDoc(edit(base,'Aの変更'));await restoreMeta(deviceA);
 expect(await synchronize(true)).toEqual({forked:1,pending:0});
 expect((await listDocs()).map(d=>d.name).sort()).toEqual(['Aの変更（この端末の版）','Bの変更']);
 expect(((await (await request('/canvases')).json()) as any).canvases).toHaveLength(2);
});

it('端末で削除すると他の端末からも消える。他の端末で編集していた図面は残す',async()=>{
 const a=newDoc('削除'),b=newDoc('編集中に削除');await saveDoc(a);await saveDoc(b);await synchronize(false);const deviceB=await dumpMeta();
 for(const d of [a,b]){await deleteDoc(d.id);await markDeleted(d.id);}
 await synchronize(true);
 expect(((await (await request('/canvases')).json()) as any).canvases.map((c:any)=>c.deleted)).toEqual([1,1]);
 await newDevice();await saveDoc(a);await saveDoc(edit(b,'編集を続けた'));await restoreMeta(deviceB);
 await synchronize(true);
 expect((await listDocs()).map(d=>d.name)).toEqual(['編集を続けた']);
 expect(await (await request('/canvases/'+b.id)).json()).toMatchObject({deleted:0,name:'編集を続けた'});
 await synchronize(true);expect((await listDocs()).map(d=>d.name)).toEqual(['編集を続けた']);
});

it('別の利用者のキャンバスは見えず、壊れた編集データや画像の欠けた保存は拒否する',async()=>{
 const a=newDoc('本人');await saveDoc(a);await synchronize(false);
 who='other@example.test';
 expect(((await (await request('/canvases')).json()) as any).canvases).toHaveLength(0);
 expect((await request('/canvases/'+a.id)).status).toBe(404);
 const sha=async(b:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
 const put=async(data:unknown,id:string)=>{const bytes=new TextEncoder().encode(JSON.stringify(data)),hashes=[await sha(bytes)],blob=await sha(new TextEncoder().encode(hashes.join('')+':'+bytes.length));await request('/blobs',{method:'POST',body:JSON.stringify({id:blob,hashes,bytes:bytes.length,media:'application/json',name:'c.json'})});await request('/blobs/'+blob+'/0',{method:'PUT',body:bytes});await request('/blobs/'+blob+'/complete',{method:'POST',body:'{}'});return request('/canvases/'+id,{method:'PUT',body:JSON.stringify({payload:blob,expectedRevision:0,operation:blob+'_0'})});};
 const d=newDoc('x');
 expect((await put({doc:{...d,schema:2}},d.id)).status).toBe(400);
 expect((await put({doc:d},'other-id')).status).toBe(400);
 expect((await put({doc:{...d,underlay:{src:'gofg-asset:'+'b'.repeat(64)}}},d.id)).status).toBe(400);
 expect((await put({doc:d},d.id)).status).toBe(200);
});

it('使用中の画像は整理で消さない',async()=>{
 const a=withImages('整理');await saveDoc(a);await synchronize(false);
 await db.prepare("UPDATE blobs SET created='2000-01-01T00:00:00.000Z'").run();
 expect((await request('/maintenance',{method:'POST',body:'{}'})).status).toBe(200);
 await newDevice();await synchronize(true);
 expect((await loadDoc(a.id))?.underlay?.src).toBe(png(7));
});

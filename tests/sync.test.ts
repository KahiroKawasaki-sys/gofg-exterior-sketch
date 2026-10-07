import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import type {D1Database} from '@cloudflare/workers-types';
import 'fake-indexeddb/auto';
import {cloud} from '../worker/cloud';
import {synchronize,resolveConflict,pendingSyncCount,downloadCloudBlob} from '../src/cloud';
import {savePlan,openDB,listPlans,getSync,readStore,writeStore} from '../src/storage';
import {newPlan,type Plan} from '../src/model';
let mf:Miniflare,db:D1Database,offline=false;
const origin='https://sync.example.test',owner='sync-owner@example.test';
beforeAll(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-19',d1Databases:['DB']}));
 db=await mf.getD1Database('DB') as unknown as D1Database;await db.exec(readFileSync(new URL('../migrations/0001_cloud.sql',import.meta.url),'utf8'));
 vi.stubGlobal('navigator',{});vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{if(offline)throw Error('offline');if(!url.startsWith('/api/'))throw new TypeError('CSP blocked a non-API fetch');return cloud(new Request(origin+url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Origin:origin}}),db,owner);});
},30000);
afterAll(async()=>{vi.unstubAllGlobals();await mf?.dispose();});
async function clearLocal(){const local=await openDB();await new Promise<void>((resolve,reject)=>{const tx=local.transaction(['plans','sync'],'readwrite');tx.objectStore('plans').clear();tx.objectStore('sync').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});local.close();}
beforeEach(async()=>{offline=false;await clearLocal();await db.exec('DELETE FROM version_assets; DELETE FROM versions; DELETE FROM plans; DELETE FROM chunks; DELETE FROM blobs;');});
it('端末Aから保存した案件を空の端末Bへ復元する',async()=>{const a=await savePlan(newPlan('AからBへ'),0);expect(await pendingSyncCount()).toBe(1);expect(await synchronize()).toEqual({conflicts:[]});expect(await pendingSyncCount()).toBe(0);await clearLocal();await synchronize(true);expect((await listPlans())[0].name).toBe(a.name);expect(await getSync(a.id)).toMatchObject({cloudRevision:1,syncedLocalRevision:1});});
it('通信失敗後も端末版が残り、再接続で送れる',async()=>{const a=await savePlan(newPlan('通信待ち'),0);offline=true;await expect(synchronize()).rejects.toThrow();expect((await readStore<Plan>('plans',a.id))?.name).toBe('通信待ち');expect(await pendingSyncCount()).toBe(1);offline=false;await synchronize();expect(await pendingSyncCount()).toBe(0);});
it('二つの端末で分岐した変更を双方保存して次の同期まで完了する',async()=>{
 const base=await savePlan(newPlan('共通'),0);await synchronize();const syncA=await getSync(base.id);const localA={...base,name:'Aの変更',revision:2};
 await clearLocal();await synchronize(true);const b=(await listPlans())[0];await savePlan({...b,name:'Bの変更'},b.revision);await synchronize();
 await clearLocal();const idb=await openDB();await new Promise<void>((resolve,reject)=>{const tx=idb.transaction(['plans','sync'],'readwrite');tx.objectStore('plans').put(localA);tx.objectStore('sync').put(syncA);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});idb.close();
 expect((await synchronize(true)).conflicts).toEqual([base.id]);await resolveConflict(base.id);expect((await listPlans()).map(p=>p.name).sort()).toEqual(['Aの変更（この端末の別案）','Bの変更']);await synchronize();expect(await pendingSyncCount()).toBe(0);
 const result=await cloud(new Request(origin+'/api/plans'),db,owner);expect((await result.json() as any).plans).toHaveLength(2);
});

it('通信先を同じサイトに制限しても下絵PNGと原本PDFをバイト一致で保存できる',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const pdf=readFileSync(new URL('../public/samples/exterior-plan.pdf',import.meta.url));
 const doc=newPlan('原本付き同期');doc.underlay={src:'data:image/png;base64,'+png,width:1000,height:800,opacity:0.7,visible:true,name:'sample.pdf',assetId:'original-sync-test'};
 await writeStore('originals',{id:'original-sync-test',name:'sample.pdf',type:'application/pdf',blob:new Blob([pdf],{type:'application/pdf'})});
 await savePlan(doc,0);await synchronize();expect(await pendingSyncCount()).toBe(0);
 const sync=await getSync(doc.id);const stored=await downloadCloudBlob(sync!.cloudPayload!);const data=JSON.parse(await stored.blob.text());
 const preview=await downloadCloudBlob(data.preview),original=await downloadCloudBlob(data.original);
 expect(preview.blob.type).toBe('image/png');expect(Buffer.from(await preview.blob.arrayBuffer()).toString('base64')).toBe(png);
 expect(original.blob.type).toBe('application/pdf');expect(Buffer.from(await original.blob.arrayBuffer())).toEqual(pdf);
});

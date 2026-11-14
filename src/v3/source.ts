// Native-only source reader. The Web build continues to use src/io.ts.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
const MAX_FILE=20*1024*1024;
export const image=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('画像を読み込めませんでした'));i.src=src;});
export type SourceImage={src:string;width:number;height:number};
export type SourceText={str:string;x:number;y:number;w:number;h:number;rot?:boolean}; // render() と同じ px 座標（x,y は文字の左下）。rot：縦書き（回転）の文字
export type Source={pages:number;file:File;render:(page:number)=>Promise<SourceImage>;text?:(page:number)=>Promise<SourceText[]>;close:()=>Promise<void>};
// getTextContent は ReadableStream を for await で回すが、iPad（WebKit）はそれに対応していない版があり失敗する。読み手で1つずつ取り出す
type TextItems={items:unknown[]};
async function textContent(p:{streamTextContent:(o?:object)=>ReadableStream<TextItems>}):Promise<TextItems>{
 const r=p.streamTextContent().getReader(),items:unknown[]=[];
 try{for(;;){const {done,value}=await r.read();if(done)break;items.push(...value.items);}}finally{r.releaseLock();}
 return {items};
}
export async function readSource(file:File):Promise<Source>{
 if(file.size>MAX_FILE)throw Error('20MB以下のPDF・PNG・JPEG・WebPを選んでください');
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  let pdf;try{pdf=await task.promise;}catch(e){await task.destroy();throw Error(e instanceof Error&&/password/i.test(e.name)?'パスワード付きPDFです。解除したPDFを選んでください':'PDFを読み込めません。ファイルを確認してください');}
  let closed=false;let queue:Promise<unknown>=Promise.resolve();
  // 文字（レベルや面のラベルを読むため）。render と同じ拡大率で px に直す
  const text=async(page:number)=>{const p=await pdf.getPage(page),base=p.getViewport({scale:1}),v=p.getViewport({scale:Math.min(4,3072/Math.max(base.width,base.height))});const tc=await textContent(p);const out:SourceText[]=[];for(const it of tc.items as {str?:string;transform?:number[];width?:number;height?:number}[]){if(!it.str||!it.transform)continue;const m=pdfjs.Util.transform(v.transform,it.transform);const sc=Math.hypot(m[0],m[1])||v.scale;const rot=Math.abs(m[1])>Math.abs(m[0]);out.push({str:it.str,x:m[4],y:m[5],w:(it.width||0)*v.scale,h:(it.height||0)*v.scale||sc,rot});}p.cleanup();return out;};
  return {pages:pdf.numPages,file,text,render:(page:number)=>{const work=queue.catch(()=>{}).then(async()=>{if(closed)throw Error('読み込みを終了しました');const p=await pdf.getPage(page),base=p.getViewport({scale:1}),v=p.getViewport({scale:Math.min(4,3072/Math.max(base.width,base.height))}),c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);try{await p.render({canvas:c,viewport:v}).promise;return {src:c.toDataURL('image/png'),width:c.width,height:c.height};}finally{c.width=c.height=0;p.cleanup();}});queue=work;return work;},close:async()=>{closed=true;await queue.catch(()=>{});await task.destroy();}};
 }
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('PDF・PNG・JPEG・WebPに対応しています。HEIC写真はJPEGに変換して選んでください');
 const url=URL.createObjectURL(file);try{const img=await image(url);if(img.naturalWidth*img.naturalHeight>60e6)throw Error('画像が大きすぎます。縮小して読み込んでください');const k=Math.min(1,3072/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*k));c.height=Math.max(1,Math.round(img.naturalHeight*k));c.getContext('2d')!.drawImage(img,0,0,c.width,c.height);const result={src:c.toDataURL('image/png'),width:c.width,height:c.height};c.width=c.height=0;return {pages:1,file,render:async()=>result,close:async()=>{}};}finally{URL.revokeObjectURL(url);}
}

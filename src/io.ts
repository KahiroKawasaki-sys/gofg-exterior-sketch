import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {uid,validatePlan,materials,type Plan,type Underlay} from './model';
import {drawingSVG} from './render';
import {getOriginal,putOriginal} from './storage';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const MAX_FILE=20*1024*1024;
export const image=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('画像を読み込めませんでした'));i.src=src;});
export type SourceImage={src:string;width:number;height:number};
export type Source={pages:number;file:File;render:(page:number)=>Promise<SourceImage>;close:()=>Promise<void>};
export async function readSource(file:File):Promise<Source>{
 if(file.size>MAX_FILE)throw Error('20MB以下のPDF・PNG・JPEG・WebPを選んでください');
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  let pdf;try{pdf=await task.promise;}catch(e){await task.destroy();throw Error(e instanceof Error&&/password/i.test(e.name)?'パスワード付きPDFです。解除したPDFを選んでください':'PDFを読み込めません。ファイルを確認してください');}
  let closed=false;let queue:Promise<unknown>=Promise.resolve();
  return {pages:pdf.numPages,file,render:(page:number)=>{const work=queue.catch(()=>{}).then(async()=>{if(closed)throw Error('読み込みを終了しました');const p=await pdf.getPage(page),base=p.getViewport({scale:1}),v=p.getViewport({scale:Math.min(4,3072/Math.max(base.width,base.height))}),c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);try{await p.render({canvas:c,viewport:v}).promise;return {src:c.toDataURL('image/png'),width:c.width,height:c.height};}finally{c.width=c.height=0;p.cleanup();}});queue=work;return work;},close:async()=>{closed=true;await queue.catch(()=>{});await task.destroy();}};
 }
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('PDF・PNG・JPEG・WebPに対応しています。HEIC写真はJPEGに変換して選んでください');
 const url=URL.createObjectURL(file);try{const img=await image(url);if(img.naturalWidth*img.naturalHeight>60e6)throw Error('画像が大きすぎます。縮小して読み込んでください');const k=Math.min(1,3072/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*k));c.height=Math.max(1,Math.round(img.naturalHeight*k));c.getContext('2d')!.drawImage(img,0,0,c.width,c.height);const result={src:c.toDataURL('image/png'),width:c.width,height:c.height};c.width=c.height=0;return {pages:1,file,render:async()=>result,close:async()=>{}};}finally{URL.revokeObjectURL(url);}
}
export async function prepareImage(source:SourceImage,rotation:number,crop:{left:number;top:number;right:number;bottom:number}):Promise<SourceImage>{
 const {left,top,right,bottom}=crop;if(![left,top,right,bottom].every(n=>Number.isFinite(n)&&n>=0&&n<=100)||left+right>=95||top+bottom>=95)throw Error('切り抜き後に図面が残るよう余白を指定してください');
 const img=await image(source.src),sw=img.width*(100-left-right)/100,sh=img.height*(100-top-bottom)/100,c=document.createElement('canvas'),turn=((rotation%360)+360)%360;
 c.width=Math.round(turn===90||turn===270?sh:sw);c.height=Math.round(turn===90||turn===270?sw:sh);
 const ctx=c.getContext('2d')!;ctx.translate(c.width/2,c.height/2);ctx.rotate(turn*Math.PI/180);ctx.drawImage(img,img.width*left/100,img.height*top/100,sw,sh,-sw/2,-sh/2,sw,sh);
 const result={src:c.toDataURL('image/png'),width:c.width,height:c.height};c.width=c.height=0;return result;
}
export function underlay(result:SourceImage,name:string):Underlay{return {src:result.src,name:name.slice(0,255),width:12000,height:12000*result.height/result.width,opacity:.7,visible:true,x:0,y:0,rotation:0,scaleVerified:false};}
export function download(data:Blob,name:string){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function shareOrDownload(blob:Blob,name:string,share=false){const file=new File([blob],name,{type:blob.type});if(share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:name});}else download(blob,name);}
export async function exportBackup(doc:Plan){
 const source=doc.underlay?.assetId?await getOriginal(doc.underlay.assetId):undefined,files:Record<string,Uint8Array>={'plan.json':strToU8(JSON.stringify(validatePlan(doc)))};
 if(doc.underlay?.assetId&&!source)throw Error('原本を取得できません。同期を完了してからバックアップしてください');
 if(source){files['original.bin']=new Uint8Array(await source.blob.arrayBuffer());files['original.json']=strToU8(JSON.stringify({name:source.name,type:source.type}));}
 const bytes=zipSync(files,{level:1});download(new Blob([new Uint8Array(bytes)],{type:'application/zip'}),safeName(doc.name)+'.garden.zip');
}
export async function importBackup(file:File){
 if(file.size>60*1024*1024)throw Error('60MB以下の編集データを選んでください');let raw:unknown,original:File|undefined;
 if(/\.zip$/i.test(file.name)){let total=0;const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:f=>{total+=f.originalSize;if(total>85*1024*1024||f.originalSize>55*1024*1024)throw Error('展開後のデータが大きすぎます');return ['plan.json','original.bin','original.json'].includes(f.name);}});if(!files['plan.json'])throw Error('対応する編集データがありません');raw=JSON.parse(strFromU8(files['plan.json']));if(files['original.bin']){if(files['original.bin'].length>MAX_FILE||!files['original.json'])throw Error('原本データを確認してください');const m=JSON.parse(strFromU8(files['original.json']));if(typeof m.name!=='string'||m.name.length>255||!['application/pdf','image/png','image/jpeg','image/webp'].includes(m.type))throw Error('原本の形式が正しくありません');original=new File([new Uint8Array(files['original.bin'])],m.name,{type:m.type});}}
 else raw=JSON.parse(await file.text());
 const doc=validatePlan(raw);if(doc.underlay){if(original)doc.underlay.assetId=await putOriginal(original);else delete doc.underlay.assetId;}
 return {...doc,id:uid(),revision:0,archived:false,name:(doc.name+'（取込）').slice(0,120),updatedAt:new Date().toISOString()};
}
export function safeName(name:string){return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'外構プラン';}
export type ExportResult={blob:Blob;preview:string;name:string};
export async function createExport(doc:Plan,size:'A4'|'A3',includeDraft=true,format:'pdf'|'png'='pdf'):Promise<ExportResult>{
 await document.fonts.ready;const rendered=drawingSVG(doc,2400,includeDraft),url=URL.createObjectURL(new Blob([rendered.svg],{type:'image/svg+xml;charset=utf-8'}));
 try{const img=await image(url),canvas=document.createElement('canvas');canvas.width=size==='A3'?3368:2400;canvas.height=Math.round(canvas.width/Math.SQRT2);const c=canvas.getContext('2d')!,k=canvas.width/2400;c.scale(k,k);c.fillStyle='#fff';c.fillRect(0,0,2400,1697);c.fillStyle='#253d2c';c.font='bold 34px sans-serif';let title=doc.name;while(c.measureText(title).width>2240)title=title.slice(0,-2)+'…';c.fillText(title,70,70);c.font='22px sans-serif';c.fillText('外構打ち合わせ用 / '+new Date().toLocaleDateString('ja-JP')+' / '+(doc.calibrated?'寸法: mm':'寸法未設定')+(doc.calibrated&&doc.underlay?.scaleVerified===false?' / 下絵の縮尺は要確認':'')+(doc.owner?' / 担当: '+doc.owner.slice(0,40):''),70,112);
 const ratio=Math.min(2260/img.width,1340/img.height),w=img.width*ratio,h=img.height*ratio;c.drawImage(img,(2400-w)/2,145+(1340-h)/2,w,h);
 const used=[...new Set(doc.elements.filter(()=>doc.layers.design).map(e=>e.kind==='part'&&e.part==='deck'?'wood' as const:e.material).filter(m=>m!=='none'))];c.font='21px sans-serif';let legendX=70;c.fillText('仕上げ',legendX,1540);legendX+=100;if(!used.length)c.fillText('なし',legendX,1540);for(const material of used){const swatch={concrete:'#e3e5df',grass:'#dce8cd',gravel:'#f3eee4',tile:'#d8c9b1',wood:'#b89770',water:'#cae0e6',none:'#fff'}[material];c.fillStyle=swatch;c.fillRect(legendX,1517,36,28);c.strokeStyle='#829180';c.lineWidth=1;c.strokeRect(legendX,1517,36,28);c.fillStyle='#253d2c';c.fillText(materials[material],legendX+46,1540);legendX+=c.measureText(materials[material]).width+78;}c.fillText('打ち合わせ用のイメージ図です。印刷縮尺は固定していません。施工図は別途確認してください。',70,1605);
 const preview=canvas.toDataURL('image/png');let blob:Blob;
 if(format==='png')blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像を作成できませんでした')),'image/png'));
 else{const {PDFDocument}=await import('pdf-lib'),pdf=await PDFDocument.create(),page=pdf.addPage(size==='A3'?[1190.55,841.89]:[841.89,595.28]),png=await pdf.embedPng(preview);page.drawImage(png,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});blob=new Blob([new Uint8Array(await pdf.save())],{type:'application/pdf'});}
 canvas.width=canvas.height=0;return {blob,preview,name:safeName(doc.name)+'.'+format};
 }finally{URL.revokeObjectURL(url);}
}

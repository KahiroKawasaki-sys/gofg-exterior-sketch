// AIパース：3D画面の写し（PNG/JPEG）を Google の画像モデル（Nano Banana 2.1）に渡し、写真調の外構パースにして返す。
// 画像はここで変換するだけで保存しない。形・配置・視点は3Dのまま、材質と光だけを足すよう指示する。
import {error,json,readJSON} from './cloud';
import {reportUsage,type UsageEnv} from './usage';

export type RenderEnv={GEMINI_API_KEY?:string;RENDER_MODEL?:string;RENDER_THINKING?:string}&UsageEnv;
export const RENDER_MODEL='gemini-nano-banana-2.1';
const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION='2026-05-20';
const MAX_BASE64=6_000_000; // 約4.5MB（1536px の JPEG なら十分）
const MAX_NOTE=300;
const TIMEOUT_MS=170_000;
export const ASPECTS=['16:9','9:16','4:3','3:4','3:2','2:3','1:1','5:4','4:5','21:9'] as const;
export const SIZES=['1K','2K'] as const;
export type RenderStyle='day'|'dusk'|'night';
export type RenderView='bird'|'top'|'eye';
const STYLE:Record<RenderStyle,string>={
 day:'Daytime. Soft natural sunlight with a lightly clouded sky, gentle shadows, fresh clean look.',
 dusk:'Evening blue hour just after sunset. Warm exterior lights on (gate post light, garden lights, windows glowing softly), soft gradient sky.',
 night:'Night. Dark blue sky, garden and gate post lights on, warm light from the windows, the ground lit by the exterior lights.',
};
const VIEW:Record<RenderView,string>={
 bird:'The camera is a high angle (bird\'s-eye) view of the whole site. Keep this high angle; do not lower the camera.',
 top:'The camera looks straight down at the site plan (top view). Keep the top-down view; render it like an aerial photograph.',
 eye:'The camera is at a standing person\'s eye level from the road. Keep this eye-level perspective.',
};

type Body={image?:unknown;view?:unknown;style?:unknown;note?:unknown;aspect?:unknown;size?:unknown};

// 画像モデルへの指示（英語のほうが安定する）。note は現場の希望（「塀は黒いタイル」など）
export function renderPrompt(view:RenderView,style:RenderStyle,note:string){
 return [
  'This image is a simple 3D model of a Japanese detached house and its exterior / garden design (外構). Turn it into a photorealistic architectural visualization photograph.',
  'Rules:',
  '- Keep the camera angle, framing and perspective exactly as in the image. '+VIEW[view],
  '- Keep the shape, position, size and count of every element exactly as in the image: the house (its walls, roof, windows), block walls, fences, gate posts, gates, carport, shed, planting, paving and the site boundary. Do not add buildings, cars, people, furniture or objects that are not in the image. Do not remove anything that is in the image.',
  '- Replace the simple geometry with realistic materials: the house keeps the colors shown; walls and fences become the products they represent (block wall, plastered wall, wooden or aluminum fence); the ground becomes real paving, concrete, gravel, lawn or soil following the areas shown; plants become real lush but tidy garden plants of the same size.',
  '- '+STYLE[style],
  note?'- Customer request (follow it only where it does not change shapes or positions): '+note:'',
  '- No text, no labels, no watermark, no border, no people.',
 ].filter(Boolean).join('\n');
}

// 返事の中から画像を取り出す（model_output の最後の画像。無ければどこでも最後の画像）
export function pickImage(j:unknown):{data:string;mime:string}|null{
 let last:{data:string;mime:string}|null=null,lastOut:{data:string;mime:string}|null=null;
 const walk=(v:unknown,inOut:boolean)=>{
  if(Array.isArray(v)){for(const x of v)walk(x,inOut);return;}
  if(!v||typeof v!=='object')return;
  const o=v as Record<string,unknown>;
  const out=inOut||o.type==='model_output';
  if((o.type==='image'||typeof o.inline_data==='object')&&typeof o.data==='string'&&o.data.length>100){
   const img={data:o.data,mime:typeof o.mime_type==='string'?o.mime_type:'image/jpeg'};
   last=img;if(out)lastOut=img;
  }
  const inl=o.inline_data||o.inlineData;
  if(inl&&typeof inl==='object'){const d=inl as Record<string,unknown>;if(typeof d.data==='string'&&d.data.length>100){const img={data:d.data,mime:typeof(d.mime_type??d.mimeType)==='string'?String(d.mime_type??d.mimeType):'image/jpeg'};last=img;if(out)lastOut=img;}}
  for(const x of Object.values(o))walk(x,out);
 };
 walk(j,false);
 return lastOut||last;
}

// 返事の文章（あれば。拒否理由などを添える）
export function pickText(j:unknown):string{
 const parts:string[]=[];
 const walk=(v:unknown)=>{if(Array.isArray(v)){v.forEach(walk);return;}if(!v||typeof v!=='object')return;const o=v as Record<string,unknown>;if(o.type==='text'&&typeof o.text==='string')parts.push(o.text);Object.values(o).forEach(walk);};
 walk(j);
 return parts.join(' ').replace(/\s+/g,' ').trim().slice(0,400);
}

export async function render(req:Request,env:RenderEnv,app=false,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response>{
 const url=new URL(req.url);
 if(req.method!=='POST')return error('この操作には対応していません',405);
 if((!app&&req.headers.get('Origin')!==url.origin)||req.headers.get('X-Sketch-Client')!=='2')return error('この画面から操作をやり直してください',403);
 if(!env.GEMINI_API_KEY)return error('AIパースの準備がまだできていません（画像AIの鍵が未設定）',503);
 let b:Body;try{b=await readJSON(req,MAX_BASE64+20000);}catch(e){const big=e instanceof Error&&/大きすぎ/.test(e.message);return error(big?'画像が大きすぎます':'送られた内容を読めません',big?413:400);}
 const raw=typeof b.image==='string'?b.image:'';
 const m=/^data:(image\/(?:png|jpeg|webp));base64,/.exec(raw);
 const inMime=m?m[1]:'image/png';
 const image=raw.replace(/^data:[^,]*,/,'');
 if(!image)return error('画像がありません');
 if(image.length>MAX_BASE64)return error('画像が大きすぎます',413);
 if(!/^[A-Za-z0-9+/=\s]+$/.test(image.slice(0,2000)))return error('画像の形式を読めません');
 const view:RenderView=b.view==='top'||b.view==='eye'?b.view:'bird';
 const style:RenderStyle=b.style==='dusk'||b.style==='night'?b.style:'day';
 const note=typeof b.note==='string'?b.note.replace(/\s+/g,' ').trim().slice(0,MAX_NOTE):'';
 const aspect=(ASPECTS as readonly string[]).includes(String(b.aspect))?String(b.aspect):'16:9';
 const size=(SIZES as readonly string[]).includes(String(b.size))?String(b.size):'2K';
 const model=env.RENDER_MODEL||RENDER_MODEL;
 const body:Record<string,unknown>={model,input:[{type:'text',text:renderPrompt(view,style,note)},{type:'image',mime_type:inMime,data:image}],
  response_format:{type:'image',mime_type:'image/jpeg',aspect_ratio:aspect,image_size:size}};
 if(env.RENDER_THINKING)body.generation_config={thinking_level:env.RENDER_THINKING};
 const started=Date.now();
 const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),TIMEOUT_MS);
 let status=0,j:unknown=null;
 try{
  const r=await fetch(ENDPOINT,{method:'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY,'Content-Type':'application/json','Api-Revision':API_REVISION},body:JSON.stringify(body),signal:ac.signal});
  status=r.status;
  j=await r.json().catch(()=>null);
 }catch(e){
  clearTimeout(timer);
  reportUsage(env,ctx,{provider:'google',model,feature:'AIパース',status:'error',latencyMs:Date.now()-started});
  const aborted=e instanceof Error&&e.name==='AbortError';
  return error(aborted?'パースの生成に時間がかかりすぎました。もう一度お試しください':'画像AIにつながりませんでした。通信を確認してください',aborted?504:502);
 }
 clearTimeout(timer);
 const usage=(j&&typeof j==='object'?(j as Record<string,unknown>).usage:undefined) as Record<string,number>|undefined;
 const img=status>=200&&status<300?pickImage(j):null;
 reportUsage(env,ctx,{provider:'google',model,feature:'AIパース',status:img?'ok':'error',latencyMs:Date.now()-started,
  inputTokens:usage?.input_tokens||usage?.prompt_tokens||0,outputTokens:usage?.output_tokens||0,images:img?1:0,imageSize:size});
 if(!img){
  const text=pickText(j);
  const apiMsg=j&&typeof j==='object'&&typeof (j as {error?:{message?:string}}).error?.message==='string'?(j as {error:{message:string}}).error.message:'';
  if(status===401||status===403)return error('画像AIの鍵が通りませんでした。設定を確認してください',502);
  if(status===429)return error('画像AIが混み合っています。少し待ってからもう一度お試しください',503);
  if(status===400)return error('画像AIが入力を受け付けませんでした'+(apiMsg?`（${apiMsg.slice(0,120)}）`:''),502);
  if(status>=500)return error('画像AIが一時的に使えません。少し待ってからもう一度お試しください',503);
  return error('パースを作れませんでした。視点や希望を変えてもう一度お試しください'+(text?`（AI: ${text.slice(0,120)}）`:''),502);
 }
 return json({image:`data:${img.mime};base64,${img.data}`,text:pickText(j)||undefined,model,size,aspect,ms:Date.now()-started});
}

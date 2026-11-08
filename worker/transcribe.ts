// 文字起こし：録音した音声（数分ごとの区切り）を Cloudflare Workers AI の Whisper で日本語の文字にする。
// 音声はここで文字に変えるだけで保存しない。区切りの開始時刻を足して、打ち合わせ全体の時刻（秒）で返す。
import {error,json,readJSON} from './cloud';
import {reportUsage,type UsageEnv} from './usage';

export type TranscribeEnv={AI?:Ai}&UsageEnv;
export const WHISPER_MODEL='@cf/openai/whisper-large-v3-turbo';
const MAX_BASE64=2_400_000; // 約1.8MB（AAC 32kbps で約7分）
const MAX_TERMS=400;
// 外構用語を先に聞かせて、専門語の聞き間違いを減らす
export const TERMS='外構工事の打ち合わせ。カーポート、サイクルポート、インターロッキング、土間コンクリート、刷毛引き、洗い出し、乱形石、ピンコロ、立水栓、散水栓、目隠しフェンス、メッシュフェンス、門柱、機能門柱、門扉、ポスト、表札、アプローチ、植栽、シンボルツリー、人工芝、芝生、防草シート、砕石、砂利、化粧ブロック、境界ブロック、擁壁、ウッドデッキ、タイルデッキ、テラス屋根、物置、宅配ボックス、スリット、カースペース。';

type Body={audio?:unknown;index?:unknown;startMs?:unknown;terms?:unknown};
type Line={from:number;to:number;text:string};

// Whisper の返事を打ち合わせ全体の時刻に直す。空・重複・記号だけの区切りは捨てる
export function toLines(out:Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output,startSec:number):Line[]{
 const segs=Array.isArray(out.segments)&&out.segments.length?out.segments:(out.text?.trim()?[{start:0,end:out.transcription_info?.duration??0,text:out.text}]:[]);
 const lines:Line[]=[];
 for(const s of segs){
  const text=(s.text||'').replace(/\s+/g,' ').trim();
  if(!text||!/[\p{L}\p{N}]/u.test(text))continue;
  if(lines.length&&lines[lines.length-1].text===text)continue; // 同じ文の繰り返し（幻聴）は1回だけ
  const from=Math.max(0,startSec+(typeof s.start==='number'?s.start:0)),to=Math.max(from,startSec+(typeof s.end==='number'?s.end:0));
  lines.push({from:Math.round(from*10)/10,to:Math.round(to*10)/10,text});
 }
 return lines;
}

export async function transcribe(req:Request,env:TranscribeEnv,app=false,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response>{
 const url=new URL(req.url);
 if(req.method!=='POST')return error('この操作には対応していません',405);
 if((!app&&req.headers.get('Origin')!==url.origin)||req.headers.get('X-Sketch-Client')!=='2')return error('この画面から操作をやり直してください',403);
 if(!env.AI)return error('文字起こしの準備がまだできていません',503);
 let b:Body;try{b=await readJSON(req,MAX_BASE64+20000);}catch(e){const big=e instanceof Error&&/大きすぎ/.test(e.message);return error(big?'音声が長すぎます。区切りを短くしてください':'送られた内容を読めません',big?413:400);}
 const audio=typeof b.audio==='string'?b.audio.replace(/^data:[^,]*,/,''):'';
 if(!audio)return error('音声がありません');
 if(audio.length>MAX_BASE64)return error('音声が長すぎます。区切りを短くしてください',413);
 if(!/^[A-Za-z0-9+/=\s]+$/.test(audio.slice(0,2000)))return error('音声の形式を読めません');
 const index=Number.isInteger(b.index)&&(b.index as number)>=0?b.index as number:0;
 const startMs=typeof b.startMs==='number'&&isFinite(b.startMs)&&b.startMs>=0?b.startMs:0;
 const terms=typeof b.terms==='string'?b.terms.replace(/\s+/g,'').slice(0,MAX_TERMS):'';
 const started=Date.now();
 try{
  const out=await env.AI.run(WHISPER_MODEL,{audio,language:'ja',task:'transcribe',vad_filter:true,initial_prompt:terms?`${TERMS}${terms}。`:TERMS});
  const duration=out.transcription_info?.duration;
  reportUsage(env,ctx,{provider:'cloudflare',model:WHISPER_MODEL,feature:'文字起こし',status:'ok',latencyMs:Date.now()-started,audioSeconds:Math.round(duration||0)});
  return json({index,lines:toLines(out,startMs/1000),duration});
 }catch(e){
  reportUsage(env,ctx,{provider:'cloudflare',model:WHISPER_MODEL,feature:'文字起こし',status:'error',latencyMs:Date.now()-started});
  const msg=e instanceof Error?e.message:String(e);
  const big=/too large|payload|413/i.test(msg);
  return error(big?'音声が大きすぎます。区切りを短くしてください':'文字起こしに失敗しました。もう一度お試しください',big?413:502);
 }
}

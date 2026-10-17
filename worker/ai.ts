// 打ち合わせAI：iPadで文字にした会話から、お客様の要望を読み取って返す。
// キー（ANTHROPIC_API_KEY）はサーバーの秘密の設定にだけ置き、画面には渡さない。録音・会話は保存しない。
import {error,json,readJSON} from './cloud';
import {anthropicEvent,reportUsage,type UsageEnv} from './usage';

export type AiEnv={ANTHROPIC_API_KEY?:string;AI_MODEL?:string}&UsageEnv;
const DEFAULT_MODEL='claude-opus-5-5';
const KINDS=['駐車場','舗装・素材','塀・フェンス','門まわり','植栽','設備','予算','工期','その他'] as const;

// Claude に必ずこの形で返させる（ツールの入力として受け取る）
const TOOL={
 name:'record_requests',
 description:'打ち合わせで出たお客様の要望・決まったことを記録する',
 input_schema:{type:'object',properties:{requests:{type:'array',items:{type:'object',properties:{
  id:{type:'string',description:'前回と同じ要望なら前回のid、新しい要望なら空文字'},
  kind:{type:'string',enum:[...KINDS]},
  text:{type:'string',description:'要望を短い日本語1文で（例：車2台分の駐車スペースがほしい）'},
  quote:{type:'string',description:'根拠になったお客様の発言（短く）'},
  status:{type:'string',enum:['要望','決定','検討中','不要']},
  action:{type:'object',description:'図面・見積にそのまま反映できるときだけ',properties:{
   type:{type:'string',enum:['height','extra','budget']},
   role:{type:'string',enum:['wall','fence'],description:'height：塀かフェンスか'},
   mm:{type:'number',description:'height：高さ（mm）'},
   name:{type:'string',description:'extra：見積に足す品目名。候補の品目名にあればその名前'},
   qty:{type:'number'},unit:{type:'string'},
   yen:{type:'number',description:'budget：予算（円、税込の総額）'}},required:['type']}},
  required:['id','kind','text','status']}}},required:['requests']},
};

const SYSTEM=`あなたは外構工事（駐車場・塀・フェンス・門まわり・植栽など）の打ち合わせに同席するアシスタントです。
営業担当とお客様の会話の文字起こし（音声認識なので誤字や話者の区別はありません）から、お客様の要望と決まったことだけを抜き出して record_requests で記録してください。
- 雑談・あいさつ・営業側の説明だけの部分は記録しない。
- 同じ要望は1つにまとめ、前回までの要望（idつき）と同じものは同じidで最新の内容に更新する。取り消された要望は status を「不要」にする。
- action は数値や品目がはっきりしているときだけ付ける。高さは mm、予算は円。推測で数値を作らない。
- extra の name は、候補の品目名に近いものがあればその名前をそのまま使う。`;

type Body={transcript?:unknown;previous?:unknown;items?:unknown};
const str=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';

export function buildPrompt(b:Body){
 const transcript=str(b.transcript,60000).trim();
 const previous=Array.isArray(b.previous)?b.previous.slice(0,60).map(p=>({id:str((p as {id?:unknown}).id,40),text:str((p as {text?:unknown}).text,200)})).filter(p=>p.id&&p.text):[];
 const items=Array.isArray(b.items)?b.items.slice(0,150).map(v=>str(v,80)).filter(Boolean):[];
 return [
  previous.length?`前回までの要望：\n${previous.map(p=>`- [${p.id}] ${p.text}`).join('\n')}`:'前回までの要望：なし',
  items.length?`見積の品目の候補：${items.join(' / ')}`:'',
  `会話の文字起こし：\n${transcript}`,
 ].filter(Boolean).join('\n\n');
}

// app：アプリからの呼び出し（ブラウザではないので Origin が付かない。通行証は index.ts で確認済み）
export async function meeting(req:Request,env:AiEnv,app=false,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response>{
 const url=new URL(req.url);
 if(req.method!=='POST')return error('この操作には対応していません',405);
 if((!app&&req.headers.get('Origin')!==url.origin)||req.headers.get('X-Sketch-Client')!=='2')return error('この画面から操作をやり直してください',403);
 if(!env.ANTHROPIC_API_KEY)return error('AIのキーがまだ登録されていません',503);
 let b:Body;try{b=await readJSON(req,200000);}catch{return error('送られた内容を読めません');}
 if(!str(b.transcript,60000).trim())return error('会話がまだありません');
 const model=env.AI_MODEL||DEFAULT_MODEL,started=Date.now();
 const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
  body:JSON.stringify({model,max_tokens:4000,system:SYSTEM,tools:[TOOL],tool_choice:{type:'tool',name:TOOL.name},messages:[{role:'user',content:buildPrompt(b)}]})});
 if(!r.ok){reportUsage(env,ctx,anthropicEvent(model,'打ち合わせAI',false,undefined,Date.now()-started));const status=r.status===429||r.status===529?503:502;return error(r.status===401?'AIのキーが正しくありません':r.status===429||r.status===529?'AIが混み合っています。少し待ってから読み取ってください':'AIから返事がありませんでした',status);}
 const data=await r.json() as {content?:{type:string;name?:string;input?:{requests?:unknown}}[];usage?:{input_tokens?:number;output_tokens?:number}};
 reportUsage(env,ctx,anthropicEvent(model,'打ち合わせAI',true,data.usage,Date.now()-started));
 const used=data.content?.find(c=>c.type==='tool_use'&&c.name===TOOL.name);
 const requests=Array.isArray(used?.input?.requests)?used.input.requests:[];
 return json({requests,usage:{input:data.usage?.input_tokens||0,output:data.usage?.output_tokens||0}});
}

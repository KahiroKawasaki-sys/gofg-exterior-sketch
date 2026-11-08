// 打ち合わせAI：文字にした会話から、お客様の要望を読み取って返す。
// キー（ANTHROPIC_API_KEY）はサーバーの秘密の設定にだけ置き、画面には渡さない。録音・会話は保存しない。
import {error,json,readJSON} from './cloud';
import {anthropicEvent,reportUsage,type UsageEnv} from './usage';

export type AiEnv={ANTHROPIC_API_KEY?:string;AI_MODEL?:string}&UsageEnv;
const DEFAULT_MODEL='claude-opus-5-5';
const KINDS=['駐車場','舗装・素材','塀・フェンス','門まわり','植栽','設備','予算','工期','その他'] as const;

// Claude にこの形で返させる（ツールの入力として受け取る）。
// Opus 5.5 以降はツールの強制指定（tool_choice: tool/any）が使えないので、auto にして指示で必ず呼ばせる
const TOOL={
 name:'record_requests',
 description:'打ち合わせで出たお客様の要望・決まったことを記録する。読み取れる要望が1つも無いときは requests を空の配列で呼ぶ',
 input_schema:{type:'object',properties:{requests:{type:'array',items:{type:'object',properties:{
  id:{type:'string',description:'前回と同じ要望なら前回のid、新しい要望なら空文字'},
  kind:{type:'string',enum:[...KINDS]},
  text:{type:'string',description:'要望を短い日本語1文で（例：車2台分の駐車スペースがほしい）'},
  quote:{type:'string',description:'根拠になったお客様の発言（短く。音声認識の誤りを読み替えたときは元の表記のまま）'},
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

export const SYSTEM=`あなたは外構工事（駐車場・塀・フェンス・門まわり・植栽など）の打ち合わせに同席するアシスタントです。
営業担当とお客様の会話の文字起こし（音声認識なので誤字や話者の区別はありません）から、お客様の要望と決まったことだけを抜き出して record_requests で記録してください。
- 雑談・あいさつ・営業側の説明だけの部分は記録しない。
- 同じ要望は1つにまとめ、前回までの要望（idつき）と同じものは同じidで最新の内容に更新する。取り消された要望は status を「不要」にする。
- action は数値や品目がはっきりしているときだけ付ける。高さは mm、予算は円。推測で数値を作らない。
- extra の name は、候補の品目名に近いものがあればその名前をそのまま使う。

音声認識の読み替え：外構用語が音の似た別の語になっていることがあるので、文脈から読み替える。
例：カーポート（加工ポート・カーボード）、インターロッキング（インターロック・インター六）、土間コン・土間コンクリート（どまこん・土間婚）、乱形石（卵形石・ランケイセキ）、立水栓（立水線・律水線）、目隠しフェンス（目隠し変数）、防草シート（暴走シート・坊主シート）、砕石（細石・再生）、化粧ブロック（化粧風呂区）、門柱（文中・門中）、境界（教会・鏡界）、擁壁（溶壁）、ピンコロ（ピン頃）、人工芝（人口芝）、宅配ボックス（宅配ボックス・託売ボックス）、シンボルツリー（シンボル釣り）。
寸法の言い方：H1800・いちはちまる＝1,800mm、いっけん＝1,820mm、いっしゃく＝303mm、へーべー・平米＝㎡。読み替えたときは quote に元の表記を残す。

最後に必ず record_requests ツールを1回だけ呼んで記録してください。本文の文章は書かないでください。`;

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

type Content={type:string;name?:string;input?:{requests?:unknown}};
type Usage={input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number};
type Reply={content?:Content[];usage?:Usage;stop_reason?:string};
const addUsage=(a:Usage|undefined,b:Usage|undefined):Usage=>({input_tokens:(a?.input_tokens||0)+(b?.input_tokens||0),output_tokens:(a?.output_tokens||0)+(b?.output_tokens||0),cache_read_input_tokens:(a?.cache_read_input_tokens||0)+(b?.cache_read_input_tokens||0),cache_creation_input_tokens:(a?.cache_creation_input_tokens||0)+(b?.cache_creation_input_tokens||0)});

// app：アプリからの呼び出し（ブラウザではないので Origin が付かない。通行証は index.ts で確認済み）
export async function meeting(req:Request,env:AiEnv,app=false,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response>{
 const url=new URL(req.url);
 if(req.method!=='POST')return error('この操作には対応していません',405);
 if((!app&&req.headers.get('Origin')!==url.origin)||req.headers.get('X-Sketch-Client')!=='2')return error('この画面から操作をやり直してください',403);
 if(!env.ANTHROPIC_API_KEY)return error('AIのキーがまだ登録されていません',503);
 let b:Body;try{b=await readJSON(req,200000);}catch{return error('送られた内容を読めません');}
 if(!str(b.transcript,60000).trim())return error('会話がまだありません');
 const model=env.AI_MODEL||DEFAULT_MODEL,started=Date.now();
 const messages:{role:'user'|'assistant';content:unknown}[]=[{role:'user',content:buildPrompt(b)}];
 let usage:Usage|undefined;
 // ツールを呼ばずに文章だけ返してきたら、1回だけ言い直して呼ばせる
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
   body:JSON.stringify({model,max_tokens:16000,system:SYSTEM,tools:[TOOL],tool_choice:{type:'auto'},output_config:{effort:'low'},messages})});
  if(!r.ok){reportUsage(env,ctx,anthropicEvent(model,'打ち合わせAI',false,usage,Date.now()-started));const status=r.status===429||r.status===529?503:502;return error(r.status===401?'AIのキーが正しくありません':r.status===429||r.status===529?'AIが混み合っています。少し待ってから読み取ってください':'AIから返事がありませんでした',status);}
  const data=await r.json() as Reply;
  usage=addUsage(usage,data.usage);
  const used=data.content?.find(c=>c.type==='tool_use'&&c.name===TOOL.name);
  if(used||data.stop_reason==='refusal'||attempt===1){
   reportUsage(env,ctx,anthropicEvent(model,'打ち合わせAI',true,usage,Date.now()-started));
   const requests=Array.isArray(used?.input?.requests)?used.input.requests:[];
   return json({requests,usage:{input:usage.input_tokens||0,output:usage.output_tokens||0}});
  }
  const prior=(data.content||[]).filter(c=>c.type==='text'||c.type==='thinking'||c.type==='redacted_thinking');
  messages.push({role:'assistant',content:prior.length?prior:[{type:'text',text:'（記録なし）'}]},{role:'user',content:'record_requests ツールを呼んで記録してください。文章は不要です。'});
 }
 return error('AIから返事がありませんでした',502);
}

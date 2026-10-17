// AI利用記録を複業マネージャー（AI利用状況）へ送る。AI_USAGE_TOKEN が無ければ何もしない。
// 送信は ctx.waitUntil で応答の後に行い、失敗してもアプリの動作には影響させない。会話の本文は送らない。
export type UsageEnv={AI_USAGE_TOKEN?:string;AI_USAGE_URL?:string};
const DEFAULT_URL='https://fukugyo-manager.vercel.app/api/ai-usage/ingest';

type AnthropicUsage={input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number};

export function anthropicEvent(model:string,feature:string,ok:boolean,usage:AnthropicUsage|undefined,latencyMs:number){
 return {provider:'anthropic',model,feature,status:ok?'ok':'error',latencyMs:Math.round(latencyMs),
  inputTokens:usage?.input_tokens||0,outputTokens:usage?.output_tokens||0,
  cachedInputTokens:usage?.cache_read_input_tokens||0,cacheWriteTokens:usage?.cache_creation_input_tokens||0};
}

export function reportUsage(env:UsageEnv,ctx:Pick<ExecutionContext,'waitUntil'>|undefined,event:Record<string,unknown>){
 if(!env.AI_USAGE_TOKEN||!ctx)return;
 ctx.waitUntil(fetch(env.AI_USAGE_URL||DEFAULT_URL,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_USAGE_TOKEN}`},
  body:JSON.stringify({...event,occurredAt:new Date().toISOString()})}).then(()=>undefined,()=>undefined));
}

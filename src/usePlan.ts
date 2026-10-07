import {useState,useRef,useEffect,useCallback} from 'react';
import {savePlan,ConflictError} from './storage';
import {type Plan,validatePlan} from './model';
export function usePlan(){
 const [doc,setDoc]=useState<Plan|null>(null),[status,setStatus]=useState('未保存'),[error,setError]=useState(''),[historyVersion,bump]=useState(0);
 const current=useRef<Plan|null>(null),past=useRef<Plan[]>([]),future=useRef<Plan[]>([]),seq=useRef(0),saved=useRef(0),revision=useRef(0),running=useRef<Promise<void>|null>(null),failed=useRef(false);
 const flush=useCallback(async():Promise<void>=>{
  if(running.current){await running.current;return;}
  if(!current.current||seq.current===saved.current)return;
  if(failed.current)throw Error('保存失敗を解消するか、別案に複製してください');
  const work=async()=>{while(current.current&&seq.current!==saved.current){const version=seq.current,snapshot=current.current;setStatus('保存中');try{const result=await savePlan(snapshot,revision.current);revision.current=result.revision;saved.current=version;current.current={...current.current,revision:result.revision,updatedAt:result.updatedAt};setDoc(current.current);setStatus('端末に保存済み');setError('');}catch(e){failed.current=true;setStatus(e instanceof ConflictError?'更新の競合':'保存失敗');setError(e instanceof Error?e.message:'保存できませんでした');throw e;}}};
  running.current=work();try{await running.current;}finally{running.current=null;}
 },[]);
 const change=useCallback((fn:(p:Plan)=>Plan,record=true)=>{if(!current.current)return;const next=fn(current.current);validatePlan(next);if(record){past.current=[...past.current.slice(-29),current.current];future.current=[];}current.current=next;seq.current++;setDoc(next);setStatus(failed.current?'保存失敗・作業を保護してください':'未保存');bump(v=>v+1);},[]);
 const load=useCallback(async(p:Plan,skipSave=false)=>{if(!skipSave)await flush();else if(running.current)await running.current.catch(()=>{});p=validatePlan(p);current.current=p;past.current=[];future.current=[];revision.current=p.revision;seq.current=p.revision?0:1;saved.current=0;failed.current=false;setError('');setStatus(p.revision?'端末に保存済み':'未保存');setDoc(p);bump(v=>v+1);},[flush]);
 const undo=()=>{const p=past.current.pop();if(!p||!current.current)return;future.current.push(current.current);current.current=p;seq.current++;setDoc(p);setStatus('未保存');bump(v=>v+1);};
 const redo=()=>{const p=future.current.pop();if(!p||!current.current)return;past.current.push(current.current);current.current=p;seq.current++;setDoc(p);setStatus('未保存');bump(v=>v+1);};
 const retry=()=>{failed.current=false;setError('');void flush().catch(()=>{});};
 useEffect(()=>{if(!doc||failed.current)return;const t=setTimeout(()=>{void flush().catch(()=>{});},800);return()=>clearTimeout(t);},[doc,flush,historyVersion]);
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(seq.current!==saved.current){e.preventDefault();e.returnValue='';}};const hide=()=>{if(document.hidden)void flush().catch(()=>{});};window.addEventListener('beforeunload',leave);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('visibilitychange',hide);};},[flush]);
 return {doc,status,error,change,load,flush,undo,redo,retry,canUndo:past.current.length>0,canRedo:future.current.length>0};
}

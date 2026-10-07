// @vitest-environment jsdom
// v0.3 キャンバスの iPad 入力（指モード・手のひら除外・ブラウザのスクロール抑止）
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {Canvas,type CanvasApi,type FingerMode,type Tool} from '../src/v3/Canvas';
import {newDoc} from '../src/v3/types';
type Fn=ReturnType<typeof vi.fn<(...a:any[])=>void>>;
let host:HTMLDivElement,root:Root,api:Record<keyof CanvasApi,Fn>,setView:Fn,onPen:Fn;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(SVGElement.prototype,'setPointerCapture',{configurable:true,value:()=>{}});vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,width:800,height:600,right:800,bottom:600,toJSON(){}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 api=Object.fromEntries(['live','end','set','addItem','text','place','lasso','fill','aiBrushed','calib','toast','selectGuide'].map(k=>[k,vi.fn<(...a:any[])=>void>()])) as never;setView=vi.fn<(...a:any[])=>void>();onPen=vi.fn<(...a:any[])=>void>();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(fingerMode:FingerMode,penSeen:boolean,tool:Tool='pen'){await act(async()=>{root.render(<Canvas doc={newDoc()} lib={[]} ctx={{mmPerPx:10,unit:'mm'}} view={{x:0,y:0,k:1,r:0}} setView={setView} tool={tool} opts={{brush:'pen',dash:'solid',width:3,color:'#333',lineKind:'line',shapeKind:'rect',measure:'line',unit:'mm'}} guideSnap={false} fingerMode={fingerMode} penSeen={penSeen} onPen={onPen} showGrid={false} gridMm={100} guideEdit={false} activeGuide={null} sel={[]} setSel={()=>{}} api={api as unknown as CanvasApi} aiSel={null} aiVersion={0} aiRadius={8}/>);});return host.querySelector('svg')!;}
async function pointer(target:globalThis.Element,type:string,id:number,pointerType:string,x:number,y:number){await act(async()=>{const event=new Event(type,{bubbles:true,cancelable:true});for(const [key,value] of Object.entries({pointerId:id,pointerType,clientX:x,clientY:y,button:0,pressure:.5,detail:0}))Object.defineProperty(event,key,{value});target.dispatchEvent(event);});}
async function stroke(svg:globalThis.Element,id:number,type:string){await pointer(svg,'pointerdown',id,type,100,100);await pointer(svg,'pointermove',id,type,200,150);await pointer(svg,'pointermove',id,type,300,300);await pointer(svg,'pointerup',id,type,300,300);}

it('自動モード：Pencil未使用なら指で線を描ける',async()=>{const svg=await render('auto',false);await stroke(svg,1,'touch');expect(api.addItem).toHaveBeenCalledTimes(1);expect(api.addItem.mock.calls[0][0].type).toBe('stroke');});
it('自動モード：Pencil使用後の指1本は画面移動になる',async()=>{const svg=await render('auto',true);await stroke(svg,1,'touch');expect(api.addItem).not.toHaveBeenCalled();expect(setView).toHaveBeenCalled();});
it('「描く」モードはPencil使用後も指で描ける',async()=>{const svg=await render('draw',true);await stroke(svg,1,'touch');expect(api.addItem).toHaveBeenCalledTimes(1);});
it('Pencilが触れたら検出を通知する',async()=>{const svg=await render('auto',false);await stroke(svg,1,'pen');expect(onPen).toHaveBeenCalled();expect(api.addItem).toHaveBeenCalledTimes(1);});
it('Pencilで描画中の手のひら接触は無視し、線を途切れさせない',async()=>{const svg=await render('auto',true);await pointer(svg,'pointerdown',1,'pen',100,100);await pointer(svg,'pointermove',1,'pen',200,200);await pointer(svg,'pointerdown',2,'touch',500,500);await pointer(svg,'pointermove',2,'touch',600,550);await pointer(svg,'pointermove',1,'pen',300,300);await pointer(svg,'pointerup',2,'touch',600,550);await pointer(svg,'pointerup',1,'pen',300,300);expect(api.addItem).toHaveBeenCalledTimes(1);expect(setView).not.toHaveBeenCalled();const pts=api.addItem.mock.calls[0][0].pts;expect(pts[pts.length-1].x).toBe(300);});
it('先に手のひらが触れていてもPencilの線を描ける',async()=>{const svg=await render('auto',false);await pointer(svg,'pointerdown',2,'touch',500,500);await pointer(svg,'pointermove',2,'touch',520,520);await stroke(svg,1,'pen');await pointer(svg,'pointerup',2,'touch',520,520);expect(api.addItem).toHaveBeenCalledTimes(1);expect(api.addItem.mock.calls[0][0].pts[0].x).toBe(100);});
it('キャンバス上のタッチはブラウザのスクロールを起こさない',async()=>{const svg=await render('auto',true);for(const type of ['touchstart','touchmove']){const e=new Event(type,{bubbles:true,cancelable:true});svg.dispatchEvent(e);expect(e.defaultPrevented).toBe(true);}});

import {useState,useRef,useEffect,useCallback,type PointerEvent as ReactPointer,type RefObject} from 'react';
import {Plus,Minus,Maximize,Check,X} from 'lucide-react';
import {type Plan,type Point,type Part,type Element,element,partAt,moved,snap,distance,planBounds,cleanStroke,simplify} from './model';
import {Content} from './Drawing';
export type Tool='select'|'pen'|'clean'|'finish'|'part'|'dimension'|'text'|'pan'|'scale'|'erase';
type View={x:number;y:number;w:number;h:number};
type Gesture={mode:'pan'|'draw'|'move'|'vertex'|'pinch'|'tap';pointer:number;pointerType:string;start:Point;client:Point;view:View;original?:Element;drawing?:Element;vertex?:number;distance?:number;mid?:Point;lastTime?:number;action?:()=>void};
type Props={doc:Plan;tool:Tool;figure:'line'|'polyline'|'rect'|'ellipse'|'area';part:Part;color:string;lineWidth:number;snapping:boolean;touchDraw:boolean;selected:string;onSelect:(id:string)=>void;onChange:(f:(d:Plan)=>Plan)=>void;onScale:(p:Point[])=>void;onText:(p:Point)=>void;onTool:(t:Tool)=>void;onHint:(s:string)=>void;svgRef:RefObject<SVGSVGElement|null>;fitSignal:number};
export function Stage(props:Props){
 const {doc,tool,figure,part,color,lineWidth,snapping,touchDraw,selected,onSelect,onChange,onScale,onText,onTool,onHint,svgRef,fitSignal}=props;
 const wrap=useRef<HTMLDivElement>(null),[size,setSize]=useState({w:800,h:600}),[view,setView]=useState<View>({x:-500,y:-500,w:15000,h:11500}),viewRef=useRef(view);
 const [draft,setDraft]=useState<Element|null>(null),[polygon,setPolygon]=useState<Point[]>([]),[calibration,setCalibration]=useState<Point[]>([]);
 const lastPen=useRef(0);const gesture=useRef<Gesture|null>(null),pointers=useRef(new Map<number,Point>()),polygonRef=useRef<Point[]>([]);
 const setV=(v:View)=>{viewRef.current=v;setView(v);};
 const fit=useCallback(()=>{const b=planBounds(doc),width=Math.max(b.w+1200,(b.h+1200)*size.w/size.h);setV({x:b.x+b.w/2-width/2,y:b.y+b.h/2-width*size.h/size.w/2,w:width,h:width*size.h/size.w});},[doc,size]);
 useEffect(()=>{const el=wrap.current;if(!el)return;const r=new ResizeObserver(()=>setSize({w:Math.max(1,el.clientWidth),h:Math.max(1,el.clientHeight)}));r.observe(el);return()=>r.disconnect();},[]);
 useEffect(()=>{fit();},[doc.id,size.w,size.h,fitSignal]);
 useEffect(()=>{gesture.current=null;pointers.current.clear();setDraft(null);polygonRef.current=[];setPolygon([]);setCalibration([]);},[tool,figure,doc.id]);
 const toWorld=(p:Point,v=viewRef.current):Point=>{const b=svgRef.current!.getBoundingClientRect();return {x:v.x+(p.x-b.left)*v.w/b.width,y:v.y+(p.y-b.top)*v.h/b.height};};
 const screen=(e:ReactPointer<SVGSVGElement>)=>({x:e.clientX,y:e.clientY});
 const snapPoint=(p:Point,start?:Point)=>{if(!snapping)return p;const threshold=9*viewRef.current.w/size.w;let best:Point|undefined;let d=threshold;for(const e of doc.elements.filter(e=>e.kind!=='stroke'))for(const target of e.points){const gap=distance(p,target);if(gap<d){best=target;d=gap;}}return best||snap(p,start,true);};
 const add=(e:Element)=>{onChange(d=>({...d,elements:[...d.elements,e]}));onSelect(e.id);};
 const finishArea=()=>{if(polygonRef.current.length<(figure==='polyline'?2:3))return;add({...element(figure==='polyline'?'polyline':'area',polygonRef.current),color,width:lineWidth,material:figure==='polyline'?'none':'concrete'});polygonRef.current=[];setPolygon([]);onTool('select');};
 function down(e:ReactPointer<SVGSVGElement>){
  if(e.button!==0)return;
  if(e.pointerType==='touch'&&(gesture.current?.pointerType==='pen'||performance.now()-lastPen.current<350))return;
  if(e.pointerType==='pen'){lastPen.current=performance.now();pointers.current.clear();gesture.current=null;setDraft(null);}
  const client=screen(e);pointers.current.set(e.pointerId,client);e.currentTarget.setPointerCapture(e.pointerId);
  const p=toWorld(client),v=viewRef.current;
  if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];gesture.current={mode:'pinch',pointer:e.pointerId,pointerType:e.pointerType,start:p,client,view:{...v},distance:distance(a,b),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};setDraft(null);return;}
  const base={pointer:e.pointerId,pointerType:e.pointerType,start:p,client,view:{...v}};
  if(tool==='pan'||(e.pointerType==='touch'&&!touchDraw&&(tool==='pen'||tool==='dimension'||(tool==='clean'&&!['area','polyline'].includes(figure))))){gesture.current={...base,mode:'pan'};return;}
  // Commit touch taps only after release so a second finger can cancel them for pinch zoom.
  const tap=(action:()=>void)=>{if(e.pointerType==='touch')gesture.current={...base,mode:'tap',action};else action();};
  if(tool==='scale'){tap(()=>{const next=[...calibration,p];if(next.length===2){onScale(next);setCalibration([]);}else setCalibration(next);});return;}
  if(tool==='select'||tool==='finish'||tool==='erase'){
   const target=(e.target as SVGElement).closest<SVGElement>('[data-element]');const id=target?.dataset.element||'';onSelect(id);const original=doc.elements.find(x=>x.id===id);
   if(tool==='erase'){if(original?.kind==='stroke'&&!original.locked)tap(()=>onChange(d=>({...d,elements:d.elements.filter(x=>x.id!==id)})));return;}
   if(original?.locked){onHint('固定中の図形です。設定で固定を解除できます');return;}
   if(original&&tool==='select'){const vertex=(e.target as SVGElement).closest<SVGElement>('[data-vertex]')?.dataset.vertex;gesture.current={...base,mode:vertex!==undefined?'vertex':'move',original,vertex:vertex===undefined?undefined:Number(vertex)};}else if(!original){gesture.current={...base,mode:'pan'};}return;
  }
  if(!doc.calibrated&&(tool==='part'||tool==='dimension')){onHint('先に「基準寸法」で元図面の実寸を設定してください');return;}
  if(tool==='part'){tap(()=>{const el=partAt(part,snapPoint(p));add(el);onTool('select');});return;}
  if(tool==='text'){tap(()=>onText(p));return;}
  if(tool==='clean'&&(figure==='area'||figure==='polyline')){tap(()=>{const point=snapPoint(p);if(figure==='area'&&polygonRef.current.length>=3&&distance(point,polygonRef.current[0])<18*v.w/size.w){finishArea();return;}polygonRef.current=[...polygonRef.current,point];setPolygon(polygonRef.current);});return;}
  const kind=tool==='pen'?'stroke':tool==='dimension'?'dimension':figure==='rect'?'rect':figure==='ellipse'?'ellipse':'line';
  const start=kind==='stroke'?p:snapPoint(p);const drawing={...element(kind,kind==='stroke'?[start]:[start,start]),color,width:lineWidth};gesture.current={...base,mode:'draw',drawing,lastTime:performance.now()};setDraft(drawing);
 }
 function move(e:ReactPointer<SVGSVGElement>){
  if(!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,screen(e));const g=gesture.current;if(!g)return;
  if(g.mode==='pinch'){if(pointers.current.size<2)return;const [a,b]=[...pointers.current.values()];const factor=g.distance!/Math.max(1,distance(a,b)),w=Math.min(200000,Math.max(800,g.view.w*factor)),h=w*size.h/size.w;const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},anchor=toWorld(g.mid!,g.view),box=svgRef.current!.getBoundingClientRect();setV({x:anchor.x-(mid.x-box.left)/box.width*w,y:anchor.y-(mid.y-box.top)/box.height*h,w,h});return;}
  if(e.pointerId!==g.pointer)return;
  if(g.mode==='tap'){if(distance(screen(e),g.client)>8)g.action=undefined;return;}
  if(g.mode==='pan'){setV({...g.view,x:g.view.x-(e.clientX-g.client.x)*g.view.w/size.w,y:g.view.y-(e.clientY-g.client.y)*g.view.h/size.h});return;}
  const p=toWorld(screen(e));
  if(g.mode==='move'&&g.original){const delta={x:p.x-g.start.x,y:p.y-g.start.y};g.drawing=moved(g.original,delta.x,delta.y);setDraft(g.drawing);}
  if(g.mode==='vertex'&&g.original){g.drawing={...g.original,points:g.original.points.map((a,i)=>i===g.vertex?snapPoint(p):a)};setDraft(g.drawing);}
  if(g.mode==='draw'&&g.drawing){const d=g.drawing;if(d.kind==='stroke'){if(distance(d.points[d.points.length-1],p)<viewRef.current.w/size.w||d.points.length>=20000)return;const events=e.nativeEvent.getCoalescedEvents?.()||[];const extras=events.length?events.map(v=>toWorld({x:v.clientX,y:v.clientY})):[p];g.drawing={...d,points:[...d.points,...extras].slice(0,20000)};g.lastTime=performance.now();}else g.drawing={...d,points:[d.points[0],snapPoint(p,d.points[0])]};setDraft(g.drawing);}
 }
 function up(e:ReactPointer<SVGSVGElement>){
  if(e.pointerType==='pen')lastPen.current=performance.now();pointers.current.delete(e.pointerId);const g=gesture.current;if(!g)return;
  if(g.mode==='pinch'){if(pointers.current.size===1){const [id,c]=[...pointers.current.entries()][0];gesture.current={mode:'pan',pointer:id,pointerType:'touch',start:toWorld(c),client:c,view:{...viewRef.current}};}else gesture.current=null;return;}
  if(g.pointer!==e.pointerId)return;
  if(g.mode==='tap'){gesture.current=null;g.action?.();return;}
  if(g.drawing){if(g.mode==='move'||g.mode==='vertex')onChange(d=>({...d,elements:d.elements.map(el=>el.id===g.drawing!.id?g.drawing!:el)}));else if(g.drawing.points.length>1&&(g.drawing.kind==='stroke'||distance(g.drawing.points[0],g.drawing.points[g.drawing.points.length-1])>viewRef.current.w/size.w*2)){let finished=g.drawing;if(finished.kind==='stroke'){finished={...finished,points:simplify(finished.points,viewRef.current.w/size.w*.4)};if(performance.now()-(g.lastTime||performance.now())>550)finished=cleanStroke(finished);}add(finished);}}
  setDraft(null);gesture.current=null;
 }
 function cancel(e:ReactPointer<SVGSVGElement>){pointers.current.delete(e.pointerId);gesture.current=null;setDraft(null);}
 function zoom(factor:number){const v=viewRef.current,w=Math.min(200000,Math.max(800,v.w*factor)),h=w*size.h/size.w;setV({x:v.x+(v.w-w)/2,y:v.y+(v.h-h)/2,w,h});}
 useEffect(()=>{const el=svgRef.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const v=viewRef.current,p=toWorld({x:e.clientX,y:e.clientY}),factor=Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.002),w=Math.min(200000,Math.max(800,v.w*factor)),h=w*size.h/size.w;setV({x:p.x-(p.x-v.x)*w/v.w,y:p.y-(p.y-v.y)*h/v.h,w,h});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[size]);
 const scale=view.w/size.w;
 return <div className="stage-shell"><div className="stage-tools"><div className="scale-label">{doc.calibrated?'実寸 mm':'基準寸法 未設定'}<span>幅 {Math.round(view.w/100)/10} m を表示</span></div><div className="button-row"><button onClick={()=>zoom(1.25)} aria-label="縮小"><Minus size={18}/></button><button onClick={()=>zoom(.8)} aria-label="拡大"><Plus size={18}/></button><button onClick={fit}><Maximize size={17}/>全体</button></div></div><div className="canvas-wrap" ref={wrap}><svg ref={svgRef} data-testid="drawing-canvas" className={'drawing tool-'+tool} viewBox={[view.x,view.y,view.w,view.h].join(' ')} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={e=>{if(pointers.current.has(e.pointerId))cancel(e);}} role="img" aria-label="外構図面の作図領域"><rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#fcfcf8" data-editor-only="true"/><Content doc={doc} selected={selected} draft={draft} scale={scale}/>{polygon.length>0&&<g data-editor-only="true"><polyline points={polygon.map(p=>p.x+','+p.y).join(' ')} fill="#dce8cd88" stroke="#237653" strokeWidth={2*scale}/>{polygon.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={5*scale} fill="#237653"/>)}</g>}{calibration.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={6*scale} fill="#cf7433" data-editor-only="true"/>)}</svg>{polygon.length>0&&<div className="polygon-actions"><span>{polygon.length}点</span><button disabled={polygon.length<(figure==='polyline'?2:3)} onClick={finishArea}><Check size={16}/>{figure==='polyline'?'線を確定':'面を確定'}</button><button aria-label="面の入力を取り消す" onClick={()=>{polygonRef.current=[];setPolygon([]);}}><X size={17}/></button></div>}</div></div>;
}

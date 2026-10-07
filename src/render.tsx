import {renderToStaticMarkup} from 'react-dom/server';
import {Content} from './Drawing';
import {planBounds,type Plan} from './model';
export function drawingSVG(doc:Plan,width=1600,includeDraft=true){const d={...doc,layers:{...doc.layers,draft:includeDraft&&doc.layers.draft}},view=planBounds(d,true),pad=Math.max(view.w,view.h)*.035,w=view.w+pad*2,h=view.h+pad*2,height=Math.max(1,Math.round(width*h/w));return {svg:renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={[view.x-pad,view.y-pad,w,h].join(' ')}><rect x={view.x-pad} y={view.y-pad} width={w} height={h} fill="#fff"/><Content doc={d} hit={false} scale={1}/></svg>),width,height};}
export function thumbnail(doc:Plan){return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(drawingSVG(doc,480).svg);}

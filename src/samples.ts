import {newPlan,element,partAt,type Material,type Plan} from './model';
export function samplePlan():Plan {
 const doc=newPlan('サンプル邸／外構プラン');
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=800;const c=canvas.getContext('2d')!;
 c.fillStyle='#fff';c.fillRect(0,0,1000,800);c.strokeStyle='#9a9f96';c.lineWidth=2;c.strokeRect(70,45,860,695);c.strokeRect(500,100,330,390);c.strokeRect(550,490,170,40);c.fillStyle='#626b61';c.font='24px sans-serif';c.fillText('建物',637,300);c.font='18px sans-serif';c.fillText('玄関',610,516);c.fillText('前面道路',444,778);c.beginPath();c.moveTo(100,90);c.lineTo(450,90);c.moveTo(100,80);c.lineTo(100,100);c.moveTo(450,80);c.lineTo(450,100);c.stroke();c.fillText('5,000 mm',222,77);
 doc.underlay={src:canvas.toDataURL('image/png'),name:'架空の配置図（サンプル）',width:14285.7142857,height:11428.5714286,opacity:.8,visible:true};
 const k=14285.7142857/1000;
 const poly=(coords:number[][],material:Material)=>({...element('area',coords.map(([x,y])=>({x:x*k,y:y*k}))),material});
 doc.elements=[poly([[95,126],[458,126],[458,718],[95,718]],'concrete'),poly([[480,547],[903,547],[903,718],[480,718]],'grass'),poly([[500,545],[720,545],[720,575],[545,575],[545,718],[500,718]],'gravel'),partAt('car',{x:200*k,y:450*k}),partAt('tree',{x:841*k,y:613*k}),partAt('gate',{x:582*k,y:686*k}),partAt('table',{x:700*k,y:620*k})];
 doc.elements.push(
 {...partAt('car',{x:365*k,y:390*k}),rotation:8},
 {...partAt('stairs',{x:635*k,y:542*k}),size:{w:2200,h:700}},
 {...partAt('deck',{x:745*k,y:610*k}),size:{w:2500,h:1600}},
 {...partAt('bicycle',{x:414*k,y:647*k}),rotation:-20},
 {...partAt('person',{x:585*k,y:635*k}),rotation:15},
 {...partAt('tree',{x:890*k,y:691*k}),size:{w:700,h:700}},
 {...element('dimension',[{x:100*k,y:735*k},{x:450*k,y:735*k}]),width:14},
 {...element('text',[{x:111*k,y:152*k}]),text:'駐車スペース 2台',color:'#657368'},
 {...element('text',[{x:535*k,y:723*k}]),text:'アプローチ / 庭・デッキ',color:'#657368'}
 );
 // Keep furniture above the deck surface.
 const table=doc.elements.find(e=>e.part==='table')!;doc.elements=doc.elements.filter(e=>e.id!==table.id);doc.elements.push({...table,points:[{x:750*k,y:610*k}],size:{w:1100,h:1100}});
 doc.owner='サンプル担当';
 doc.calibration={points:[{x:100*k,y:90*k},{x:450*k,y:90*k}],length:5000};return doc;
}

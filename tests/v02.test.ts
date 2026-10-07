import {describe,it,expect} from 'vitest';
import {newPlan,element,partAt,calibrated,validatePlan,underlayBounds,planBounds,area,cleanStroke,simplify,rotateElement,resizeElement,bounds,calibrateUnderlay} from '../src/model';
import {drawingSVG} from '../src/render';
import {savePlan,readStore,writeStore,receiveCloud,getSync,resolveCloudConflict,listPlans} from '../src/storage';
import 'fake-indexeddb/auto';
describe('下絵・清書・互換性',()=>{
 it('v1を読み込み、保存前に元のデータを書き換えない',()=>{const old={...newPlan(),schema:1};const next=validatePlan(old);expect(next.schema).toBe(2);expect(old.schema).toBe(1);});
 it('schemaを文字列で偽装した形式を拒否する',()=>expect(()=>validatePlan({...newPlan(),schema:'2'})).toThrow());
 it('下絵の位置と回転を表示範囲に反映する',()=>{const b=underlayBounds({src:'',name:'test',width:1000,height:500,opacity:1,visible:true,x:300,y:200,rotation:90});expect(b.x).toBeCloseTo(-200);expect(b.y).toBe(200);expect(b.w).toBeCloseTo(500);expect(b.h).toBeCloseTo(1000);});
 it('非表示の下絵で出力図面が小さくならない',()=>{const d=newPlan();d.underlay={src:'',name:'test',width:100000,height:100000,opacity:1,visible:false};d.elements=[element('line',[{x:0,y:0},{x:5000,y:0}])];expect(planBounds(d,true).w).toBe(5200);});
 it('四角・楕円・多角形の面積が一致する',()=>{expect(area(element('rect',[{x:0,y:0},{x:5000,y:2000}]))).toBe(10);expect(area(element('ellipse',[{x:0,y:0},{x:2000,y:2000}]))).toBeCloseTo(Math.PI);expect(area(element('area',[{x:0,y:0},{x:5000,y:0},{x:5000,y:2000},{x:0,y:2000}]))).toBe(10);});
 it('手描きの原本を変更せず直線・四角へ整える',()=>{const e=element('stroke',[{x:0,y:0},{x:1000,y:2},{x:2000,y:0}]);expect(cleanStroke(e).kind).toBe('line');expect(e.kind).toBe('stroke');const loop=element('stroke',[{x:0,y:0},{x:1000,y:0},{x:1000,y:500},{x:0,y:500},{x:1,y:1}]);expect(cleanStroke(loop).kind).toBe('rect');});
 it('大量の一直線の点を端点だけに整理する',()=>{const pts=Array.from({length:20000},(_,i)=>({x:i,y:i}));expect(simplify(pts,1)).toEqual([pts[0],pts[19999]]);});
 it('校正で下絵の位置も同じ倍率になる',()=>{const d=newPlan();d.underlay={src:'',name:'test',width:1000,height:500,x:100,y:200,opacity:1,visible:true};const n=calibrated(d,{x:0,y:0},{x:1000,y:0},5000);expect(n.underlay?.x).toBe(500);expect(n.underlay?.height).toBe(2500);});
 it('追加部品・折れ線・円形を保存できる',()=>{const d=newPlan();d.elements=[partAt('stairs',{x:0,y:0}),partAt('bicycle',{x:2000,y:0}),element('ellipse',[{x:0,y:0},{x:1000,y:1000}]),element('polyline',[{x:0,y:0},{x:100,y:100}])];expect(validatePlan(d).elements).toEqual(d.elements);});
 it('長方形の90度回転で面積を保つ',()=>{const e=element('rect',[{x:0,y:0},{x:2000,y:1000}]);expect(area(rotateElement(e,90))).toBeCloseTo(2);});
 it('PNGとPDFの基になる描画は編集ハンドルを含まず手描きを含む',()=>{const d=newPlan();d.elements=[element('stroke',[{x:0,y:0},{x:1000,y:1000}])];expect(drawingSVG(d).svg).toContain('data-kind="stroke"');expect(drawingSVG(d).svg).not.toContain('data-editor-only');expect(drawingSVG(d,2400,false).svg).not.toContain('data-kind="stroke"');});
});
describe('既存データの退避・受信時の競合',()=>{
 it('v1を編集すると初回だけ原本を退避する',async()=>{const old={...newPlan(),schema:1,revision:1};await writeStore('plans',old);await savePlan({...old,schema:2,name:'改訂'},1);expect((await readStore<any>('legacy',old.id)).name).toBe(old.name);});
 it('クラウド受信が編集中の新しい端末版を壊さない',async()=>{const d=await savePlan(newPlan('local'),0);await savePlan({...d,name:'編集中'},1);await expect(receiveCloud({...d,name:'remote'},2,'hash',1)).rejects.toThrow();expect((await readStore<any>('plans',d.id)).name).toBe('編集中');});
 it('受信した案件と同期情報を一緒に保存する',async()=>{const d=newPlan('remote');const saved=await receiveCloud(d,4,'payload',0);expect(saved.revision).toBe(1);expect(await getSync(d.id)).toMatchObject({cloudRevision:4,syncedLocalRevision:1});});
});

describe('仕上げの回帰テスト',()=>{
 it('手描きの円を楕円として清書する',()=>{const points=Array.from({length:65},(_,i)=>({x:1000+1000*Math.cos(i*Math.PI/32),y:500+500*Math.sin(i*Math.PI/32)}));expect(cleanStroke(element('stroke',points)).kind).toBe('ellipse');});
 it('多角形を数値寸法で変更して形の比率を維持する',()=>{const e=element('area',[{x:100,y:200},{x:1100,y:200},{x:600,y:1200}]),n=resizeElement(e,4000,2000);expect(bounds(n)).toEqual({x:100,y:200,w:4000,h:2000});expect(n.points[2]).toEqual({x:2100,y:2200});expect(area(n)).toBe(4);});
 it('複数行の注記を描画・出力する',()=>{const d=newPlan();d.elements=[{...element('text',[{x:0,y:0}]),text:'植栽案\n高さ 1.2m'}];expect(bounds(d.elements[0]).h).toBe(560);expect(drawingSVG(d).svg.match(/<tspan/g)).toHaveLength(2);});
 it('競合解決時に端末版とクラウド版の両方が残る',async()=>{const local=await savePlan(newPlan('現場の変更'),0);const latest=await resolveCloudConflict({...local,name:'事務所の変更'},5,'remote',1);expect(latest.name).toBe('事務所の変更');const all=await listPlans();expect(all.find(p=>p.name==='現場の変更（この端末の別案）')?.revision).toBe(1);expect(await getSync(local.id)).toMatchObject({cloudRevision:5,syncedLocalRevision:2});});
 it('競合解決中に別タブで更新した場合は全体を取り消す',async()=>{const local=await savePlan(newPlan('直前変更'),0);await savePlan({...local,name:'作業継続'},1);await expect(resolveCloudConflict({...local,name:'remote'},5,'remote',1)).rejects.toThrow();expect((await readStore<any>('plans',local.id)).name).toBe('作業継続');expect((await listPlans()).some(p=>p.name==='作業継続（この端末の別案）')).toBe(false);});
});

it('下絵だけの縮尺補正は配置済み部品と線の実寸を変えない',()=>{const d=newPlan();d.underlay={src:'',name:'replacement',width:4000,height:2000,x:200,y:300,rotation:90,visible:true,opacity:1,scaleVerified:false};d.elements=[partAt('car',{x:1000,y:2000}),element('dimension',[{x:0,y:0},{x:5000,y:0}])];const next=calibrateUnderlay(d,{x:400,y:600},{x:1400,y:600},5000);expect(next.elements).toEqual(d.elements);expect(next.underlay).toMatchObject({width:20000,height:10000,x:-600,y:-900,rotation:90,scaleVerified:true});expect(d.underlay.scaleVerified).toBe(false);});

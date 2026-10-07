import {describe,it,expect} from 'vitest';
import {newPlan,element,partAt,calibrated,distance,withLength,moved,bounds,validatePlan,snap} from '../src/model';
describe('実寸を保持する',()=>{
 it('2点で5mへ校正し、図形と部品を同じ倍率で補正する',()=>{const p=newPlan();p.elements=[element('line',[{x:0,y:0},{x:1000,y:0}]),partAt('car',{x:500,y:100})];const n=calibrated(p,{x:0,y:0},{x:1000,y:0},5000);expect(distance(...n.elements[0].points as [{x:number;y:number},{x:number;y:number}])).toBe(5000);expect(n.elements[1].size?.w).toBe(9000);expect(p.elements[1].size?.w).toBe(1800);});
 it('斜めの線の長さを5mへ変えても向きを保持する',()=>{const e=withLength(element('line',[{x:100,y:200},{x:400,y:600}]),5000);expect(e.points[1]).toEqual({x:3100,y:4200});expect(distance(e.points[0],e.points[1])).toBe(5000);});
 it('移動とJSON保存で線の長さが変わらない',()=>{const p=newPlan();p.elements=[moved(element('dimension',[{x:0,y:0},{x:3000,y:4000}]),230,450)];const back=validatePlan(JSON.parse(JSON.stringify(p)));expect(distance(back.elements[0].points[0],back.elements[0].points[1])).toBe(5000);});
 it('車を90度回転すると外接幅と高さが入れ替わる',()=>{const e={...partAt('car',{x:0,y:0}),rotation:90};const b=bounds(e);expect(b.w).toBeCloseTo(4800);expect(b.h).toBeCloseTo(1800);});
 it('同一点・無効な長さで縮尺を壊さない',()=>{expect(()=>calibrated(newPlan(),{x:0,y:0},{x:0,y:0},5000)).toThrow();expect(()=>calibrated(newPlan(),{x:0,y:0},{x:100,y:0},NaN)).toThrow();});
 it('水平の補助と100mmグリッドが働く',()=>expect(snap({x:1021,y:34},{x:0,y:0})).toEqual({x:1000,y:0}));
});
describe('読込データの検証',()=>{
 it('外部URLの画像を読み込ませない',()=>{const p={...newPlan(),underlay:{src:'https://example.com/track.png',name:'x',width:100,height:100,visible:true,opacity:1}};expect(()=>validatePlan(p)).toThrow();});
 it('不明な形式・非数値・同じ図形IDを拒否する',()=>{expect(()=>validatePlan({...newPlan(),schema:99})).toThrow();expect(()=>validatePlan({...newPlan(),revision:'2'})).toThrow();const p=newPlan(),e=partAt('tree',{x:0,y:0});p.elements=[e,e];expect(()=>validatePlan(p)).toThrow();e.points[0].x=Infinity;p.elements=[e];expect(()=>validatePlan(p)).toThrow();});
 it('部品の負の寸法と短い多角形を拒否する',()=>{const p=newPlan();p.elements=[{...partAt('car',{x:0,y:0}),size:{w:-1,h:4800}}];expect(()=>validatePlan(p)).toThrow();p.elements=[element('area',[{x:0,y:0}])];expect(()=>validatePlan(p)).toThrow();});
});

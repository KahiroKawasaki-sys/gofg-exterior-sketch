import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {newPlan,partAt} from '../src/model';
import {savePlan,listPlans,ConflictError} from '../src/storage';
describe('端末保存と競合防止',()=>{
 it('部品の実寸と表示設定を再開できる',async()=>{const p=newPlan('復元確認');p.elements=[partAt('car',{x:3123.456,y:4000})];p.layers.draft=false;const first=await savePlan(p,0);expect(first.revision).toBe(1);const back=(await listPlans()).find(v=>v.id===p.id)!;expect(back.elements).toEqual(p.elements);expect(back.layers.draft).toBe(false);});
 it('同じ版から同時保存した片方を拒否し、勝手に上書きしない',async()=>{const p=await savePlan(newPlan(),0);const result=await Promise.allSettled([savePlan({...p,name:'A'},1),savePlan({...p,name:'B'},1)]);expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);const rejected=result.find(x=>x.status==='rejected') as PromiseRejectedResult;expect(rejected.reason).toBeInstanceOf(ConflictError);const saved=(await listPlans()).find(v=>v.id===p.id)!;expect(saved.revision).toBe(2);});
 it('古いタブは最新データを壊せず、別案なら保存できる',async()=>{const p=newPlan();await savePlan(p,0);await expect(savePlan({...p,name:'古い内容'},0)).rejects.toBeInstanceOf(ConflictError);const other={...newPlan('別案'),elements:p.elements};await expect(savePlan(other,0)).resolves.toMatchObject({name:'別案',revision:1});});
});

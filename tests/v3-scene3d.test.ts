import { it, expect } from 'vitest';
import { buildScene, groundDoc, pickRaisable, type Solid } from '../src/v3/scene3d';
import { builtinLibrary } from '../src/v3/library';
import { sampleDoc } from '../src/v3/useDoc';
import { newDoc, uid, type Doc, type Item } from '../src/v3/types';

const lib = builtinLibrary();
const withItems = (items: Item[], d: Doc = newDoc()): Doc => ({ ...d, layers: d.layers.map((l, i) => i === 1 ? { ...l, items } : l) });
const line = (pts: [number, number][], extra: Partial<Item & { type: 'line' }> = {}): Item =>
  ({ id: uid(), type: 'line', kind: 'polyline', color: '#000', width: 3, dash: 'solid', pts: pts.map(([x, y]) => ({ x, y })), ...extra }) as Item;
const obj = (ref: string, x: number, y: number): Item => {
  const l = lib.find(v => v.id === ref)!;
  return { id: uid(), type: 'obj', ref, name: l.name, x, y, w: l.w, h: l.h, rot: 0, flip: false, color: null };
};
const kinds = (s: Solid[]) => s.map(x => x.kind);

it('実線の折れ線は線分ごとに塀になり、長さはmに換算される（1px=10mm）', () => {
  const { solids } = buildScene(withItems([line([[0, 0], [300, 0], [300, 200]])]), lib);
  expect(kinds(solids)).toEqual(['wall', 'wall']);
  const w = solids[0] as Extract<Solid, { kind: 'wall' }>;
  expect(w.b.x - w.a.x).toBeCloseTo(3); expect(w.h).toBe(1.2);
});

it('点線・矢印・ごく短い線は立ち上げない', () => {
  const { solids } = buildScene(withItems([
    line([[0, 0], [500, 0]], { dash: 'dashed' }),
    line([[0, 0], [500, 0]], { kind: 'arrow' }),
    line([[0, 0], [10, 0]]),
  ]), lib);
  expect(solids).toEqual([]);
});

it('20㎡以上の閉じた実線は建物、小さい囲みは塀になる', () => {
  const big = line([[0, 0], [600, 0], [600, 500], [0, 500], [0, 0]]); // 6m×5m = 30㎡
  const small = line([[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]); // 4㎡
  expect(kinds(buildScene(withItems([big]), lib).solids)).toEqual(['building']);
  expect(kinds(buildScene(withItems([small]), lib).solids)).toEqual(['wall', 'wall', 'wall', 'wall']);
});

it('塀と建物の高さは指定どおりになる', () => {
  const d = withItems([line([[0, 0], [600, 0], [600, 500], [0, 500], [0, 0]]), line([[0, 800], [400, 800]])]);
  const s = buildScene(d, lib, { wallH: 2, buildingH: 7 }).solids;
  expect(s.find(x => x.kind === 'building')).toMatchObject({ h: 7 });
  expect(s.find(x => x.kind === 'wall')).toMatchObject({ h: 2 });
});

it('部品は種類ごとの形になり、立体にした部品は地面の絵から外れる', () => {
  const items = [obj('b-aqua', 0, 0), obj('b-wc-symbol', 500, 0), obj('b-carport1', 0, 600), obj('b-gatepost', 900, 0), obj('b-teiboku1', 900, 300)];
  const d = withItems(items), { solids, raised } = buildScene(d, lib);
  expect(kinds(solids)).toEqual(['car', 'tree', 'carport', 'gatepost', 'shrub']);
  expect(solids[0]).toMatchObject({ kind: 'car' });
  expect((solids[0] as Extract<Solid, { kind: 'car' }>).d).toBeCloseTo(4.05);
  expect(raised.size).toBe(5);
  expect(groundDoc(d, raised).layers.flatMap(l => l.items)).toEqual([]);
});

it('非表示の部品・非表示のレイヤー・自作部品は立ち上げない', () => {
  const hidden = { ...obj('b-aqua', 0, 0), hidden: true } as Item;
  const custom: Item = { id: uid(), type: 'obj', ref: 'u-mine', name: '自作', x: 0, y: 0, w: 50, h: 50, rot: 0, flip: false, color: null };
  const d = withItems([hidden, custom]);
  expect(buildScene(d, [...lib, { id: 'u-mine', name: '自作', cat: '植栽', w: 50, h: 50, vw: 50, vh: 50, svg: '' }]).solids).toEqual([]);
  const off = withItems([line([[0, 0], [500, 0]])]);
  expect(buildScene({ ...off, layers: off.layers.map(l => ({ ...l, visible: false })) }, lib).solids).toEqual([]);
});

it('サンプル邸：建物1棟・門袖の塀・フェンス・車2台・カーポートが立ち上がり、敷地の線は立たない', () => {
  const { solids } = buildScene(sampleDoc(), lib);
  expect(solids.filter(s => s.kind === 'building')).toHaveLength(1);
  expect(solids.filter(s => s.kind === 'wall')).toEqual([expect.objectContaining({ h: 1.4, mat: 'plaster' })]);
  expect(solids.filter(s => s.kind === 'fence')).toHaveLength(2);
  expect(solids.filter(s => s.kind === 'car')).toHaveLength(2);
  expect(solids.filter(s => s.kind === 'carport')).toHaveLength(1);
  expect(solids.filter(s => s.kind === 'gatepost')).toHaveLength(1);
});

it('線ごとに選んだ種類で立ち上がる：フェンス・門扉・建物・地面のまま', () => {
  const pts: [number, number][] = [[0, 0], [400, 0], [400, 300]];
  const fence = buildScene(withItems([line(pts, { role3: 'fence', h3: 1600 })]), lib).solids;
  expect(fence).toHaveLength(2);
  expect(fence[0]).toMatchObject({ kind: 'fence', h: 1.6, base: 0.2 });
  const gate = buildScene(withItems([line(pts, { role3: 'gate' })]), lib).solids;
  expect(gate).toEqual([expect.objectContaining({ kind: 'gate', h: 1.2 })]);
  const building = buildScene(withItems([line(pts, { role3: 'building' })]), lib).solids;
  expect(building).toEqual([expect.objectContaining({ kind: 'building' })]);
  expect((building[0] as Extract<Solid, { kind: 'building' }>).poly).toHaveLength(3);
  expect(buildScene(withItems([line(pts, { role3: 'ground' })]), lib).solids).toEqual([]);
});

it('点線でも種類を選べば立ち上がり、立体には元の線のIDが付く', () => {
  const l = line([[0, 0], [500, 0]], { dash: 'dashed', role3: 'wall' });
  expect(buildScene(withItems([l]), lib).solids).toEqual([expect.objectContaining({ kind: 'wall', src: l.id })]);
});

it('手描きの線は間引いてから塀にする。楕円の建物は多角形になる', () => {
  const wobbly = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: Math.sin(i) * 0.5 }));
  const stroke: Item = { id: uid(), type: 'stroke', brush: 'pen', color: '#000', width: 3, dash: 'solid', pts: wobbly, role3: 'wall' };
  expect(buildScene(withItems([stroke]), lib).solids).toHaveLength(1);
  expect(buildScene(withItems([{ ...stroke, role3: undefined }]), lib).solids).toEqual([]);
  const ellipse: Item = { id: uid(), type: 'shape', shape: 'ellipse', color: '#000', width: 3, dash: 'solid', x: 0, y: 0, w: 800, h: 600, rot: 0, role3: 'building' };
  const s = buildScene(withItems([ellipse]), lib).solids[0] as Extract<Solid, { kind: 'building' }>;
  expect(s.kind).toBe('building'); expect(s.poly.length).toBe(24);
});

it('3D画面で地面をタップした位置の近くの線を探す', () => {
  const a = line([[0, 0], [500, 0]]), b = line([[0, 300], [500, 300]]);
  const d = withItems([a, b]);
  expect(pickRaisable(d, { x: 2.5, z: 0.2 })).toBe(a.id);
  expect(pickRaisable(d, { x: 2.5, z: 2.9 })).toBe(b.id);
  expect(pickRaisable(d, { x: 2.5, z: 1.5 })).toBeNull();
});

it('箱で代用していた部品にも専用の形が付く（家具・自転車・設備）', () => {
  const pick = (ref: string) => buildScene(withItems([obj(ref, 0, 0)]), lib).solids[0];
  expect(pick('b-tableset')).toMatchObject({ kind: 'prop', type: 'tableset' });
  expect(pick('b-table')).toMatchObject({ kind: 'prop', type: 'table' });
  expect(pick('b-chair')).toMatchObject({ kind: 'prop', type: 'chair', rot: 0 });
  expect(pick('b-clickchair')).toMatchObject({ kind: 'prop', type: 'chair', rot: 45 });
  expect(pick('b-bench')).toMatchObject({ kind: 'prop', type: 'bench' });
  expect(pick('b-dryer')).toMatchObject({ kind: 'prop', type: 'dryer' });
  expect(pick('b-bicycle')).toMatchObject({ kind: 'prop', type: 'bicycle' });
  expect(pick('b-moped')).toMatchObject({ kind: 'prop', type: 'motorbike' });
  expect(pick('b-faucet')).toMatchObject({ kind: 'prop', type: 'faucet' });
  expect(pick('b-ac')).toMatchObject({ kind: 'prop', type: 'ac' });
  expect(pick('b-meter')).toMatchObject({ kind: 'prop', type: 'meter' });
});

it('組み込みの部品は全部3Dの形になる', () => {
  for (const l of lib) expect(buildScene(withItems([obj(l.id, 0, 0)]), lib).solids, l.id).toHaveLength(1);
});

it('車は車種で形が変わり、人は図面と同じ服の色・子どもは背が低い', () => {
  const pick = (ref: string) => buildScene(withItems([obj(ref, 0, 0)]), lib).solids[0];
  expect(pick('b-kei3500')).toMatchObject({ kind: 'car', body: 'kei' });
  expect(pick('b-vezel')).toMatchObject({ kind: 'car', body: 'suv' });
  expect(pick('b-car4900')).toMatchObject({ kind: 'car', body: 'sedan' });
  expect(pick('b-person0')).toMatchObject({ kind: 'person', color: '#d9534f', h: 1.65 });
  expect(pick('b-person5')).toMatchObject({ kind: 'person', h: 1.15 });
});

it('カーポートの柱は図面の記号どおり（カーポートは四隅、サイクルポートは奥の2本）、株立ちの樹種は幹が数本', () => {
  const pick = (ref: string) => buildScene(withItems([obj(ref, 0, 0)]), lib).solids[0];
  expect(pick('b-carport1')).toMatchObject({ kind: 'carport', posts: 4 });
  expect(pick('b-cycleport')).toMatchObject({ kind: 'carport', posts: 2 });
  expect(pick('b-aodamo')).toMatchObject({ kind: 'tree', form: 'multi' });
  expect(pick('b-wc-tree-m')).toMatchObject({ kind: 'tree', form: 'round' });
});

it('折れ線の塀・フェンスは角でつながる（最後の線分は、閉じた線のときだけ）', () => {
  const open = buildScene(withItems([line([[0, 0], [300, 0], [300, 200]], { role3: 'wall' })]), lib).solids as Extract<Solid, { kind: 'wall' }>[];
  expect(open.map(s => !!s.join)).toEqual([true, false]);
  const closed = buildScene(withItems([line([[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]])]), lib).solids as Extract<Solid, { kind: 'wall' }>[];
  expect(closed.map(s => !!s.join)).toEqual([true, true, true, true]);
});

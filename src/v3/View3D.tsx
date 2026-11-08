// 3Dビュー：平面図を地面に貼り、塀・建物・部品を汎用の形で立ち上げて、指やマウスで回して見る。
// three.js は重いので、このファイルごと「3D」を押したときに読み込む（Editor から lazy import）。
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Camera, RotateCcw, ImagePlus } from 'lucide-react';
import { type Role3, type Mat3, type ElevFace, type Elevation } from './types';
import { type Doc, type LibItem, rad } from './types';
import { readSource } from './source';
import { edgeFace, isClockwise, faceU, faceAxis, polyBBox, roofFace } from './elevation';
import { wallMaterial, meshFenceMaterial, grassMaterial, skyTexture, elevationTexture, WALL_MATS, FENCE_MATS } from './materials3d';
import { ElevationDialog } from './ElevationDialog';
import { type RenderCtx } from './markup';
import { contentBox, docSVG, rasterize } from './raster';
import { buildScene, groundDoc, pickRaisable, canRaise, itemOutline, withElevations, hasBuilding, footprintFromElevations, placeBuilding, ROLE_LABELS, DEFAULT_SCENE_OPTS, type Solid, type SceneOpts, type P2 } from './scene3d';
import { findFootprintOnUnderlay } from './footprint';
import { uid } from './types';
import { saveFile } from './platform';

type ViewKind = 'bird' | 'top' | 'eye';
const MAX_TEX = 2048;

function mat(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}
function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

function solidObject(s: Solid): THREE.Object3D {
  const g = new THREE.Group();
  switch (s.kind) {
    case 'wall': {
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + s.t, s.h, s.t), wallMaterial(s.mat, s.color, len, s.h));
      // 笠木（上の縁）で塀らしく
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + s.t + 0.04, 0.04, s.t + 0.04), mat(s.mat === 'alumi' ? '#4a4d50' : '#c9c4ba'));
      cap.position.set((s.a.x + s.b.x) / 2, s.h + 0.02, (s.a.z + s.b.z) / 2); cap.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x); g.add(cap);
      m.position.set((s.a.x + s.b.x) / 2, s.h / 2, (s.a.z + s.b.z) / 2);
      m.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      g.add(m); break;
    }
    case 'fence': {
      // ブロック基礎＋柱＋横板のフェンス
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, s.base, 0.15), mat('#cbc7bf'));
      base.position.y = s.base / 2; g.add(base);
      const n = Math.max(1, Math.ceil(len / 2)), postM = mat('#3f3b38'), slatM = mat('#6b4f3a');
      for (let i = 0; i <= n; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, s.h - s.base, 0.06), postM);
        p.position.set(-len / 2 + len * i / n, s.base + (s.h - s.base) / 2, 0); g.add(p);
      }
      if (s.mat === 'mesh') {
        // メッシュフェンス：網（透過テクスチャ）＋上下の横桟
        const net = new THREE.Mesh(new THREE.PlaneGeometry(len, s.h - s.base), meshFenceMaterial(len, s.h - s.base));
        net.position.set(0, s.base + (s.h - s.base) / 2, 0); g.add(net);
        for (const y of [s.base + 0.03, s.h - 0.03]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), postM); r.position.set(0, y, 0); g.add(r); }
      } else if (s.mat === 'lattice') {
        // 縦格子：細い縦桟を 60mm おき
        const bars = Math.max(2, Math.floor(len / 0.06)), barM = mat('#4a4d50', { roughness: 0.5, metalness: 0.3 });
        for (let j = 0; j <= bars; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, s.h - s.base - 0.05, 0.02), barM); b.position.set(-len / 2 + len * j / bars, s.base + (s.h - s.base) / 2, 0); g.add(b); }
        for (const y of [s.base + 0.03, s.h - 0.03]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.04), barM); r.position.set(0, y, 0); g.add(r); }
      } else {
        const rows = Math.max(1, Math.floor((s.h - s.base) / 0.12));
        for (let j = 0; j < rows; j++) {
          const sl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.02), slatM);
          sl.position.set(0, s.base + 0.06 + j * (s.h - s.base - 0.06) / rows, 0.04); g.add(sl);
        }
      }
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2);
      g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x); break;
    }
    case 'gate': {
      // 門柱2本＋両開きの扉（縦格子）
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), frameM = mat('#3d3a37', { roughness: 0.5, metalness: 0.3 });
      for (const x of [-len / 2, len / 2]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, s.h + 0.1, 0.12), frameM);
        p.position.set(x, (s.h + 0.1) / 2, 0); g.add(p);
      }
      const leaves = len > 1.4 ? 2 : 1, lw = (len - 0.16) / leaves;
      for (let i = 0; i < leaves; i++) {
        const leaf = new THREE.Group(), y0 = 0.08, lh = s.h - 0.12;
        for (const [w, h, x, y] of [[lw, 0.04, 0, y0], [lw, 0.04, 0, y0 + lh], [0.04, lh, -lw / 2, y0 + lh / 2], [0.04, lh, lw / 2, y0 + lh / 2]]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frameM); b.position.set(x, y, 0); leaf.add(b);
        }
        const bars = Math.max(2, Math.floor(lw / 0.11));
        for (let j = 1; j < bars; j++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, lh, 0.02), frameM);
          b.position.set(-lw / 2 + lw * j / bars, y0 + lh / 2, 0); leaf.add(b);
        }
        leaf.position.x = -len / 2 + 0.08 + lw * (i + 0.5); g.add(leaf);
      }
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2);
      g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x); break;
    }
    case 'building': {
      if (s.faces) { buildingWithElevations(g, s.poly, s.h, s.faces, s.wallTop ?? s.h * 0.7); break; }
      // 図面の (x, z) を XY 平面の形にして押し出し、寝かせる（z → -y なので回転で戻す）
      const shape = new THREE.Shape(s.poly.map(p => new THREE.Vector2(p.x, -p.z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: s.h, bevelEnabled: false });
      const m = new THREE.Mesh(geo, mat('#f7f6f2'));
      m.rotation.x = -Math.PI / 2;
      g.add(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#9a978f' }));
      edges.rotation.x = -Math.PI / 2; g.add(edges); break;
    }
    case 'tree': {
      const trunkH = s.form === 'palm' ? s.h * 0.85 : s.h * 0.4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, trunkH, 8), mat('#7a5a3e'));
      trunk.position.y = trunkH / 2; g.add(trunk);
      const leaf = mat(s.color, { flatShading: true });
      if (s.form === 'cone') {
        const c = new THREE.Mesh(new THREE.ConeGeometry(s.r, s.h * 0.85, 10), leaf); c.position.y = s.h * 0.15 + s.h * 0.425; g.add(c);
      } else if (s.form === 'palm') {
        for (let i = 0; i < 7; i++) {
          const f = new THREE.Mesh(new THREE.BoxGeometry(s.r * 1.1, 0.04, 0.35), leaf);
          f.position.set(Math.cos(i * 0.9) * s.r * 0.5, trunkH, Math.sin(i * 0.9) * s.r * 0.5);
          f.rotation.y = -i * 0.9; f.rotation.z = -0.3; g.add(f);
        }
      } else {
        // 丸い樹冠は2つ重ねて、少しずらす（のっぺりしないように）
        const ry = (s.h - trunkH) * 0.6;
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), leaf);
        c.scale.set(s.r, ry, s.r); c.position.y = s.h - ry; g.add(c);
        const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat(shade(s.color, 0.88), { flatShading: true }));
        c2.scale.set(s.r * 0.72, ry * 0.7, s.r * 0.72); c2.position.set(s.r * 0.25, s.h - ry * 0.55, -s.r * 0.2); c2.rotation.y = 0.7; g.add(c2);
      }
      g.position.set(s.x, 0, s.z); break;
    }
    case 'shrub': {
      const c = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(s.color, { flatShading: true }));
      c.scale.set(s.rx, s.h, s.rz); g.add(c);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'stone': {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat('#a9a49a', { flatShading: true }));
      c.scale.set(s.rx, s.h, s.rz); c.position.y = s.h * 0.45; g.add(c);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'box': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mat(s.color));
      m.position.y = (s.y0 ?? 0) + s.h / 2; g.add(m);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'car': {
      // 車体（下）＋客室（上）。図面の上側が車の前
      const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.75, s.d), mat(s.color, { roughness: 0.4 }));
      body.position.y = 0.2 + 0.375; g.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.86, 0.55, s.d * 0.5), mat('#5d6b78', { roughness: 0.3 }));
      cabin.position.set(0, 0.95 + 0.275, s.d * 0.06); g.add(cabin);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14), mat('#222'));
        w.rotation.z = Math.PI / 2; w.position.set(dx * (s.w / 2 - 0.08), 0.32, dz * s.d * 0.33); g.add(w);
      }
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'carport': {
      const post = mat('#8a8a86');
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, s.h, 0.1), post);
        p.position.set(dx * (s.w / 2 - 0.1), s.h / 2, dz * (s.d / 2 - 0.15)); g.add(p);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.06, s.d), mat('#cfe3ea', { transparent: true, opacity: 0.55, roughness: 0.2 }));
      roof.position.y = s.h; g.add(roof);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.12, 0.1), post);
      frame.position.set(0, s.h - 0.03, -s.d / 2); g.add(frame);
      const frame2 = frame.clone(); frame2.position.z = s.d / 2; g.add(frame2);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'cylinder': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.h, 18), mat(s.color));
      m.position.y = s.h / 2; g.add(m); g.position.set(s.x, 0, s.z); break;
    }
    case 'person': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, s.h - 0.62, 4, 10), mat(s.color));
      body.position.y = (s.h - 0.26) / 2; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), mat('#e8c9a8'));
      head.position.y = s.h - 0.12; g.add(head);
      g.position.set(s.x, 0, s.z); break;
    }
  }
  g.userData.src = s.src;
  return shadowed(g);
}

// 色を少し暗く／明るく
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString();
}

// 立面図を建物に貼る：各辺を向きで東西南北に振り分け、その面の絵の「壁の範囲」を軒の高さまで貼る。
// 屋根は妻側（軒と棟の差が大きい面）の輪郭を断面にして、建物の奥行きぶん押し出した立体にする（絵の屋根は使わない）
function buildingWithElevations(g: THREE.Group, poly: P2[], h: number, faces: Partial<Record<ElevFace, Elevation>>, wallTop: number) {
  const cw = isClockwise(poly), bb = polyBBox(poly);
  const plain = mat('#f1efe9');
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const face = edgeFace(a, b, cw), elev = faces[face];
    // 外向きの法線（画面座標で時計回りなら進行方向の右手側）
    const nx = (cw ? dz : -dz) / len, nz = (cw ? -dx : dx) / len;
    const rot = Math.atan2(nx, nz), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    // 壁の下地（白）
    const base = new THREE.Mesh(new THREE.PlaneGeometry(len, wallTop), plain);
    base.position.set(cx, wallTop / 2, cz); base.rotation.y = rot; g.add(base);
    if (!elev) continue;
    // 絵：壁の範囲（wallU）を辺の両端に、縦は地面から軒まで
    const [ua, ub] = elev.wallU ?? [0, 1];
    const vTop = 1 - (elev.wallTop ?? 0.3);
    let u0 = ua + faceU(face, a, bb) * (ub - ua), u1 = ua + faceU(face, b, bb) * (ub - ua);
    // 平面の local x は (nz, -nx)。辺の向きと逆なら左右を入れ替える
    if (nz * dx - nx * dz < 0) [u0, u1] = [u1, u0];
    const geo = new THREE.PlaneGeometry(len, wallTop);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    uv.setXY(0, u0, vTop); uv.setXY(1, u1, vTop); uv.setXY(2, u0, 0); uv.setXY(3, u1, 0); uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: elevationTexture(elev.src), transparent: true, alphaTest: 0.08, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.position.set(cx + nx * 0.006, wallTop / 2, cz + nz * 0.006); m.rotation.y = rot; g.add(m);
  }
  // 天井（軒の高さ）と床
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.z)));
  const capGeo = new THREE.ShapeGeometry(shape);
  const cap = new THREE.Mesh(capGeo, mat('#dcd8cf', { side: THREE.DoubleSide }));
  cap.rotation.x = -Math.PI / 2; cap.position.y = wallTop - 0.01; g.add(cap);
  const floor = new THREE.Mesh(capGeo.clone(), mat('#e7e4dd', { side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; g.add(floor);
  roofSolid(g, bb, faces, h, wallTop);
}

// 屋根：妻側の輪郭（0..1）を実寸の断面にして、直交する方向に建物の幅＋軒の出ぶん押し出す
function roofSolid(g: THREE.Group, bb: ReturnType<typeof polyBBox>, faces: Partial<Record<ElevFace, Elevation>>, h: number, wallTop: number) {
  const face = roofFace(faces), e = face ? faces[face] : undefined;
  const roofM = mat('#5e6165', { roughness: 0.8 }), eaveM = mat('#f1efe9');
  const W = bb.maxX - bb.minX, D = bb.maxZ - bb.minZ, over = 0.45;
  if (!face || !e?.roof?.length) {
    // 輪郭が無ければ薄い陸屋根
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + over, 0.18, D + over), roofM);
    slab.position.set((bb.minX + bb.maxX) / 2, wallTop + 0.09, (bb.minZ + bb.maxZ) / 2); g.add(slab); return;
  }
  const [ua, ub] = e.wallU ?? [0, 1];
  // 絵の横位置 u → 面の軸の座標（壁の範囲 ua..ub を建物の幅に合わせ、外は軒の出として外挿）
  const axis = (u: number) => faceAxis(face, (u - ua) / Math.max(1e-6, ub - ua), bb);
  const pts = e.roof.map(p => ({ s: axis(p.x), y: Math.max(wallTop - 0.05, Math.min(h, p.y * h)) }));
  const eave = Math.min(...pts.map(p => p.y), wallTop);
  // 断面の形：輪郭 → 軒の下端で閉じる（厚み 0.2m）
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].s, eave - 0.2);
  for (const p of pts) shape.lineTo(p.s, p.y);
  shape.lineTo(pts[pts.length - 1].s, eave - 0.2);
  shape.closePath();
  const alongX = face === 'N' || face === 'S'; // 断面が x 方向に広がる＝z 方向へ押し出す
  const depth = (alongX ? D : W) + over * 2;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // ExtrudeGeometry の材質：[0]=断面（妻の三角＝壁の色）、[1]=押し出した面（屋根面＝屋根の色）
  const mesh = new THREE.Mesh(geo, [eaveM, roofM]);
  // ExtrudeGeometry は XY 平面の形を +Z に押し出す。南北面の断面は x 方向なのでそのまま z へ押し出す。
  // 東西面の断面は z 方向：y 軸まわりに -90° 回すと local x → world z、押し出し（local z）→ world -x になる
  if (alongX) mesh.position.set(0, 0, bb.minZ - over);
  else { mesh.rotation.y = -Math.PI / 2; mesh.position.set(bb.maxX + over, 0, 0); }
  g.add(shadowed(mesh));
}

async function groundTexture(doc: Doc, lib: LibItem[], ctx: RenderCtx) {
  // 図面より少し広く取り、長い辺が MAX_TEX になる解像度で画像化する（iPad の上限内）
  const box = contentBox(doc, 200), scale = MAX_TEX / Math.max(box.w, box.h, 1);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const canvas = await rasterize(docSVG(doc, lib, ctx, box, { background: '#f3f2ee', pxW: w, pxH: h }), w, h);
  return { canvas, box };
}

function disposeAll(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const ms = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const x of ms) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }
  });
}

export type Raise3Change = { role3?: Role3; h3?: number; mat3?: Mat3 };
type Api = { setView: (v: ViewKind) => void; build: (d: Doc, o: SceneOpts) => Promise<void>; snap: () => Promise<Blob | null>; highlight: (id: string | null) => void };

// 選んだ線の種類ごとの高さの範囲（m）
const H_RANGE: Record<string, [number, number, number]> = { wall: [0.4, 2.4, 0.1], fence: [0.6, 2.4, 0.1], gate: [0.8, 2.0, 0.1], building: [3, 9, 0.5] };

export default function View3D({ doc, lib, ctx, onClose, onRaise, onDoc }: { doc: Doc; lib: LibItem[]; ctx: RenderCtx; onClose: () => void; onRaise?: (id: string, v: Raise3Change) => void; onDoc?: (f: (d: Doc) => Doc, label: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const [opts, setOpts] = useState<SceneOpts>(DEFAULT_SCENE_OPTS);
  const [viewKind, setViewKind] = useState<ViewKind>('bird');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  // 高さスライダーは動かしている間は表示だけ変え、離したときに図面へ反映する（毎回作り直すと重いため）
  const [dragH, setDragH] = useState<number | null>(null);
  // 立面図の取り込み（用紙の絵→4面に切り出して貼る）
  const [sheet, setSheet] = useState<{ src: string; width: number; height: number; text?: import('./elevLabels').TextItem[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragScale, setDragScale] = useState<number | null>(null);
  const pickSheet = async (f: File) => {
    setBusy(true); setErr('');
    try { const src = await readSource(f); try { const im = await src.render(1); const text = await src.text?.(1).catch(() => undefined); setSheet({ ...im, text }); } finally { await src.close(); } }
    catch (e) { setErr((e as Error).message || '立面図を読めませんでした'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setErr('この端末では3D表示を使えませんでした（WebGLに対応していません）'); setBusy(false); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog('#e6eef4', 140, 320);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.minDistance = 1.5; controls.maxDistance = 200;
    scene.add(new THREE.HemisphereLight('#dfeaf6', '#b8b2a3', 1.0));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.7);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // 敷地の外側（ぼんやりした地面）
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), grassMaterial());
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; outer.receiveShadow = true; scene.add(outer);
    let world = new THREE.Group(), ground: THREE.Mesh | null = null; scene.add(world);
    let center = new THREE.Vector3(), span = 20, eyeZ = 0, lit: string | null = null;
    let alive = true, framed = false, seq = 0;

    const setView = (v: ViewKind) => {
      const c = center;
      if (v === 'top') { camera.position.set(c.x, span * 1.25, c.z + 0.01); controls.target.copy(c); }
      else if (v === 'eye') { camera.position.set(c.x, 1.55, eyeZ + 2); controls.target.set(c.x, 1.3, c.z); }
      else { camera.position.set(c.x + span * 0.45, span * 0.55, c.z + span * 0.85); controls.target.copy(c); }
      controls.update();
    };

    // 選んだ線を少し光らせて、どれを変えているか分かるようにする
    let mark: THREE.Line | null = null;
    const highlight = (id: string | null) => {
      lit = id;
      if (mark) { scene.remove(mark); mark.geometry.dispose(); (mark.material as THREE.Material).dispose(); mark = null; }
      const pts = id ? itemOutline(docRef.current, id) : null;
      if (pts && pts.length > 1) {
        mark = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0.03, p.z))), new THREE.LineBasicMaterial({ color: '#2e9d6b' }));
        scene.add(mark);
      }
      world.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !('emissive' in m)) return;
        let src: string | undefined, p: THREE.Object3D | null = o;
        while (p && !src) { src = p.userData.src; p = p.parent; }
        m.emissive.set(id && src === id ? '#3a7d5c' : '#000000');
      });
    };

    const build = async (d: Doc, o: SceneOpts) => {
      const my = ++seq;
      const { solids, raised } = buildScene(d, lib, o);
      const { canvas, box } = await groundTexture(groundDoc(d, raised), lib, ctx);
      if (!alive || my !== seq) return;
      scene.remove(world); disposeAll(world); world = new THREE.Group();
      const k = d.mmPerPx / 1000, gw = box.w * k, gd = box.h * k;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set((box.x + box.w / 2) * k, 0, (box.y + box.h / 2) * k); ground.receiveShadow = true;
      world.add(ground);
      for (const s of solids) world.add(solidObject(s));
      scene.add(world);
      highlight(lit);
      if (framed) return;
      framed = true;
      // カメラは線・部品のある範囲（建物や外構）に寄せる。下絵しか無ければ下絵全体
      const hasItems = d.layers.some(l => l.visible && l.items.some(i => !(i.type === 'obj' && i.hidden)));
      const fb = hasItems ? contentBox({ ...d, underlay: undefined }, 300) : box;
      center = new THREE.Vector3((fb.x + fb.w / 2) * k, 0, (fb.y + fb.h / 2) * k);
      span = Math.max(fb.w * k, fb.h * k, 8); eyeZ = (fb.y + fb.h) * k;
      // 手前（図面の下側）斜め左から照らし、見る側の面が明るくなるようにする
      sun.position.set(center.x - span * 0.5, span * 1.1, center.z + span * 0.8); sun.target.position.copy(center);
      const sc = sun.shadow.camera; sc.left = sc.bottom = -span * 0.8; sc.right = sc.top = span * 0.8; sc.near = 0.5; sc.far = span * 4; sc.updateProjectionMatrix();
      setView('bird');
    };

    // タップ（ほとんど動かさずに離した）で、その場所の線・図形を選ぶ
    const ray = new THREE.Raycaster(), down = { x: 0, y: 0, t: 0 };
    const onDown = (e: PointerEvent) => { down.x = e.clientX; down.y = e.clientY; down.t = Date.now(); };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || Date.now() - down.t > 500) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
      const d = docRef.current;
      const isRaisable = (id: string) => d.layers.some(l => l.items.some(i => i.id === id && canRaise(i)));
      let id: string | null = null;
      for (const hit of ray.intersectObject(world, true)) {
        let src: string | undefined, p: THREE.Object3D | null = hit.object;
        while (p && !src) { src = p.userData.src; p = p.parent; }
        if (src) { id = isRaisable(src) ? src : null; break; }
        if (hit.object === ground) { id = pickRaisable(d, { x: hit.point.x, z: hit.point.z }); break; }
      }
      setPicked(id); highlight(id);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    const snap = () => new Promise<Blob | null>(res => { highlight(null); renderer.render(scene, camera); renderer.domElement.toBlob(res, 'image/png'); });
    api.current = { setView, build, snap, highlight };
    return () => {
      alive = false; api.current = null; ro.disconnect(); renderer.setAnimationLoop(null); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      disposeAll(scene); renderer.dispose(); renderer.domElement.remove();
    };
  }, [lib, ctx]);

  // 図面や高さ設定が変わったら作り直す（カメラの位置はそのまま）
  useEffect(() => {
    api.current?.build(doc, { ...opts, elevations: doc.elevations, elevScale: doc.elevScale }).catch(() => setErr('図面を3Dにできませんでした')).finally(() => setBusy(false));
  }, [doc, opts, lib, ctx]);

  const pick = (v: ViewKind) => { setViewKind(v); api.current?.setView(v); };
  const save = async () => { const b = await api.current?.snap(); api.current?.highlight(picked); if (b) await saveFile(b, `${doc.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'gaikou'}_3D.png`); };
  const unpick = () => { setPicked(null); api.current?.highlight(null); };

  const item = picked ? doc.layers.flatMap(l => l.items).find(i => i.id === picked) : undefined;
  const sel = item && canRaise(item) ? item : null;
  const role = sel?.role3 || 'auto';
  const range = H_RANGE[role];
  const defH = role === 'building' ? opts.buildingH : role === 'gate' ? 1.2 : opts.wallH;
  const curH = dragH ?? (sel?.h3 ? sel.h3 / 1000 : defH);
  const commitH = () => { if (sel && onRaise && dragH !== null) onRaise(sel.id, { role3: role, h3: Math.round(dragH * 1000) }); setDragH(null); };
  const hasElev = !!doc.elevations && Object.keys(doc.elevations).length > 0;
  const commitScale = () => { if (onDoc && dragScale !== null) { const v = Math.round(dragScale * 100) / 100; onDoc(d => ({ ...d, elevScale: v }), '立面図の大きさ'); } setDragScale(null); };

  return (
    <div className="v3-3d" role="dialog" aria-label="3Dビュー">
      <header className="v3-3d-top">
        <button className="v3-3d-btn" onClick={onClose} aria-label="3Dを閉じる"><X size={18} /><span>閉じる</span></button>
        <b className="v3-3d-name">{doc.name}<em>3D</em></b>
        <span className="sp" />
        <div className="v3-3d-seg" role="group" aria-label="視点">
          {([['bird', '斜め上'], ['top', '真上'], ['eye', '人の目線']] as const).map(([v, l]) => (
            <button key={v} className={viewKind === v ? 'on' : ''} onClick={() => pick(v)}>{l}</button>
          ))}
        </div>
        <button className="v3-3d-btn" onClick={() => pick(viewKind)} aria-label="視点を戻す"><RotateCcw size={17} /></button>
        <button className="v3-3d-btn" onClick={save} aria-label="画像で保存"><Camera size={17} /><span>画像で保存</span></button>
      </header>
      <div className="v3-3d-stage" ref={host} />
      {sel && onRaise ? (
        <div className="v3-3d-panel" aria-label="選んだ線の3D設定">
          <div className="v3-3d-ph"><b>選んだ線を3Dで</b><button className="v3-3d-x" onClick={unpick} aria-label="選択をやめる"><X size={15} /></button></div>
          <div className="v3-3d-roles" role="group" aria-label="3Dでの種類">
            {ROLE_LABELS.map(([r, l]) => (
              <button key={r} className={role === r ? 'on' : ''} onClick={() => onRaise(sel.id, { role3: r, h3: undefined })}>{l}</button>
            ))}
          </div>
          {range && <label>高さ <b>{curH.toFixed(1)} m</b>
            <input type="range" min={range[0]} max={range[1]} step={range[2]} value={curH} onChange={e => setDragH(+e.target.value)} onPointerUp={commitH} onKeyUp={commitH} onBlur={commitH} aria-label="選んだ線の高さ" />
          </label>}
          {(role === 'wall' || role === 'fence') && <div className="v3-3d-roles mats" role="group" aria-label="見た目">
            {(role === 'wall' ? WALL_MATS : FENCE_MATS).map(([m, l]) => (
              <button key={m} className={(sel.mat3 || (role === 'wall' ? 'plaster' : 'board')) === m ? 'on' : ''} onClick={() => onRaise(sel.id, { mat3: m })}>{l}</button>
            ))}
          </div>}
          <p>平面図の線にも保存されます（元に戻すで取り消せます）。</p>
        </div>
      ) : (
        <div className="v3-3d-panel">
          <label>塀・フェンスの高さ <b>{opts.wallH.toFixed(1)} m</b>
            <input type="range" min={0.4} max={2.4} step={0.1} value={opts.wallH} onChange={e => setOpts({ ...opts, wallH: +e.target.value })} aria-label="塀の高さ" />
          </label>
          {hasElev ? (
            <label>立面図の大きさ <b>{Math.round((dragScale ?? doc.elevScale ?? 1) * 100)}%</b>
              <input type="range" min={0.7} max={1.3} step={0.01} value={dragScale ?? doc.elevScale ?? 1} onChange={e => setDragScale(+e.target.value)}
                onPointerUp={commitScale} onKeyUp={commitScale} onBlur={commitScale} aria-label="立面図の大きさ" />
            </label>
          ) : (
            <label>建物の高さ <b>{opts.buildingH.toFixed(1)} m</b>
              <input type="range" min={3} max={9} step={0.5} value={opts.buildingH} onChange={e => setOpts({ ...opts, buildingH: +e.target.value })} aria-label="建物の高さ" />
            </label>
          )}
          {onDoc && <div className="v3-3d-elev">
            <button className="v3-btn" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />{hasElev ? '立面図を読み込み直す' : '立面図を読み込む'}</button>
            {hasElev && <button className="v3-btn" onClick={() => onDoc(d => ({ ...d, elevations: undefined, elevScale: undefined }), '立面図を外す')}>外す</button>}
            <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickSheet(f); }} />
          </div>}
          {hasElev && <p>立面図：{(['N', 'E', 'S', 'W'] as ElevFace[]).filter(f => doc.elevations?.[f]).map(f => ({ N: '北', E: '東', S: '南', W: '西' })[f]).join('・')}面を建物に貼っています（「建物」にした囲みに貼られます）。</p>}
          <p>{hasElev ? '' : '立面図（PDF）を読み込むと、実寸の家が立ち上がります。'}線をタップすると、塀・フェンス・門扉・建物・地面のままを選べます。種類を選んでいない実線は塀、20㎡以上の実線の囲みは建物になります。1本指で回転、2本指で移動・拡大。</p>
        </div>
      )}
      {busy && <div className="v3-3d-msg">3Dを準備しています…</div>}
      {err && <div className="v3-3d-msg err">{err}</div>}
      {sheet && onDoc && <ElevationDialog sheet={sheet} onCancel={() => setSheet(null)}
        onSave={e => {
          setSheet(null);
          const rectId = uid(), d0 = docRef.current, auto = !hasBuilding(d0), fp = footprintFromElevations(e), u = d0.underlay;
          onDoc(d => { const b = contentBox(d, 0); return withElevations(d, e, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, rectId); }, '立面図を取り込み');
          if (auto && fp && u) findFootprintOnUnderlay(u, fp.w, fp.d, d0.mmPerPx).then(at => { if (at) onDoc(d => placeBuilding(d, rectId, at), '建物の位置合わせ'); }).catch(() => {});
        }} />}
    </div>
  );
}

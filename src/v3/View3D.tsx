// 3Dビュー：平面図を地面に貼り、塀・建物・部品を汎用の形で立ち上げて、指やマウスで回して見る。
// three.js は重いので、このファイルごと「3D」を押したときに読み込む（Editor から lazy import）。
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Camera, RotateCcw, ImagePlus, Sparkles } from 'lucide-react';
import { type Role3, type Mat3, type ElevFace, type Elevation } from './types';
import { type Doc, type LibItem, rad } from './types';
import { readSource } from './source';
import { edgeFace, isClockwise, faceU, faceAxis, polyBBox, roofFace } from './elevation';
import { wallMaterial, outerGroundMaterial, skyTexture, elevationTexture, WALL_MATS, FENCE_MATS, WALL_COLORS, ROOF_COLORS, wallColor, roofMaterial, glassMaterial, sashMaterial } from './materials3d';
import { siteGround } from './siteGround';
import { ElevationDialog } from './ElevationDialog';
import { RenderDialog } from './RenderDialog';
import { PRO } from './edition';
import { type RenderCtx } from './markup';
import { contentBox, docSVG, rasterize } from './raster';
import { buildScene, groundDoc, pickRaisable, canRaise, itemOutline, withElevations, hasBuilding, footprintFromElevations, placeBuilding, ROLE_LABELS, DEFAULT_SCENE_OPTS, type Solid, type SceneOpts, type P2 } from './scene3d';
import { findFootprintOnUnderlay } from './footprint';
import { uid } from './types';
import { saveFile } from './platform';

type ViewKind = 'bird' | 'top' | 'eye';
const MAX_TEX = 2048, MAX_TEX_SITE = 3072; // 敷地の地面は少し高い解像度で（舗装の模様が近くで潰れないように）

import { partObject, mat, shadowed, shade } from './solids3d';
import { textureContours } from './dxf';

// 建物以外の部品は solids3d.ts
function solidObject(s: Solid): THREE.Object3D {
  if (s.kind === 'building') {
    const g = new THREE.Group();
    if (s.faces) buildingWithElevations(g, s.poly, s.h, s.faces, s.wallTop ?? s.h * 0.7);
    else {
      // 図面の (x, z) を XY 平面の形にして押し出し、寝かせる（z → -y なので回転で戻す）
      const shape = new THREE.Shape(s.poly.map(p => new THREE.Vector2(p.x, -p.z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: s.h, bevelEnabled: false });
      const m = new THREE.Mesh(geo, mat('#f7f6f2'));
      m.rotation.x = -Math.PI / 2;
      g.add(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#9a978f' }));
      edges.rotation.x = -Math.PI / 2; g.add(edges);
    }
    g.userData.src = s.src;
    return shadowed(g);
  }
  return partObject(s) || new THREE.Group();
}

// ウッドデッキ：塗った範囲（輪郭）を 0.4m の高さに持ち上げ、上面に木目
async function deckObjects(d: Doc): Promise<THREE.Object3D[]> {
  const decks = d.layers.flatMap(l => l.visible ? l.items.filter(i => i.type === 'texture' && (i.tex === 'b:deck' || i.tex === 'deck')) : []);
  if (!decks.length) return [];
  const loops = await textureContours(d, 600);
  const k = d.mmPerPx / 1000, out: THREE.Object3D[] = [];
  const top = wallMaterial('wood', '#9c7a55', 1, 1), side = mat('#7a5a3e');
  for (const it of decks) {
    for (const loop of loops.get(it.id) || []) {
      if (loop.length < 3) continue;
      const shape = new THREE.Shape(loop.map(p => new THREE.Vector2(p.x * k, -p.y * k)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
      const m = new THREE.Mesh(geo, [top, side]); m.rotation.x = -Math.PI / 2; m.position.y = 0.4; m.userData.src = it.id;
      out.push(shadowed(m));
    }
  }
  return out;
}

// 家の色（build のたびに図面から入れる）
let houseStyle: { wall?: string; roof?: string } = {};

// 立面図を建物に貼る：各辺を向きで東西南北に振り分け、その面の絵の「壁の範囲」を軒の高さまで貼る。
// 屋根は妻側（軒と棟の差が大きい面）の輪郭を断面にして、建物の奥行きぶん押し出した立体にする（絵の屋根は使わない）
function buildingWithElevations(g: THREE.Group, poly: P2[], h: number, faces: Partial<Record<ElevFace, Elevation>>, wallTop: number) {
  const cw = isClockwise(poly), bb = polyBBox(poly);
  const plain = mat(wallColor(houseStyle.wall), { roughness: 0.9 });
  const edges: { face: ElevFace; a: P2; b: P2; nx: number; nz: number; rot: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const face = edgeFace(a, b, cw), elev = faces[face];
    // 外向きの法線（画面座標で時計回りなら進行方向の右手側）
    const nx = (cw ? dz : -dz) / len, nz = (cw ? -dx : dx) / len;
    const rot = Math.atan2(nx, nz), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    edges.push({ face, a, b, nx, nz, rot });
    // 壁の下地（外壁色）
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
  windows3d(g, edges, bb, faces, h);
  // 天井（軒の高さ）と床
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.z)));
  const capGeo = new THREE.ShapeGeometry(shape);
  const cap = new THREE.Mesh(capGeo, mat('#dcd8cf', { side: THREE.DoubleSide }));
  cap.rotation.x = -Math.PI / 2; cap.position.y = wallTop - 0.01; g.add(cap);
  const floor = new THREE.Mesh(capGeo.clone(), mat('#e7e4dd', { side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; g.add(floor);
  roofSolid(g, bb, faces, h, wallTop);
}

// 窓：立面図で見つけた窓を、その面の壁の上にガラス＋サッシの立体で置く（線画の窓の上に重なる）
function windows3d(g: THREE.Group, edges: { face: ElevFace; a: P2; b: P2; nx: number; nz: number; rot: number }[], bb: ReturnType<typeof polyBBox>, faces: Partial<Record<ElevFace, Elevation>>, h: number) {
  const glass = glassMaterial(), sash = sashMaterial();
  for (const face of ['N', 'E', 'S', 'W'] as ElevFace[]) {
    const e = faces[face]; if (!e?.windows?.length) continue;
    const [ua, ub] = e.wallU ?? [0, 1], span = Math.max(1e-6, ub - ua);
    const alongX = face === 'N' || face === 'S', extent = alongX ? bb.maxX - bb.minX : bb.maxZ - bb.minZ;
    const mine = edges.filter(ed => ed.face === face);
    for (const w of e.windows) {
      const uc = (w.x + w.w / 2 - ua) / span; if (uc < 0 || uc > 1) continue;
      const sc = faceAxis(face, uc, bb), ww = w.w / span * extent, wh = w.h * h, yc = h * (1 - (w.y + w.h / 2));
      if (ww < 0.2 || wh < 0.2) continue;
      // この面の辺のうち、窓の位置を含むもの
      const ed = mine.find(d => { const lo = alongX ? Math.min(d.a.x, d.b.x) : Math.min(d.a.z, d.b.z), hi = alongX ? Math.max(d.a.x, d.b.x) : Math.max(d.a.z, d.b.z); return sc >= lo - 0.05 && sc <= hi + 0.05; }) || mine[0];
      if (!ed) continue;
      const wx = alongX ? sc : ed.a.x, wz = alongX ? ed.a.z : sc;
      const grp = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.1, wh + 0.1, 0.05), sash); frame.position.z = 0.025; grp.add(frame);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), glass); pane.position.z = 0.052; grp.add(pane);
      // 中桟（幅 1.2m 以上は縦に1本）
      if (ww >= 1.2) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, wh, 0.03), sash); bar.position.z = 0.06; grp.add(bar); }
      grp.position.set(wx + ed.nx * 0.012, yc, wz + ed.nz * 0.012); grp.rotation.y = ed.rot;
      g.add(grp);
    }
  }
}

// 屋根：妻側の輪郭（0..1）を実寸の断面にして、直交する方向に建物の幅＋軒の出ぶん押し出す
function roofSolid(g: THREE.Group, bb: ReturnType<typeof polyBBox>, faces: Partial<Record<ElevFace, Elevation>>, h: number, wallTop: number) {
  const face = roofFace(faces), e = face ? faces[face] : undefined;
  const roofM = roofMaterial(houseStyle.roof), eaveM = mat('#f4f2ec'), capM = mat(shade(roofM.color.getHexString() ? '#' + roofM.color.getHexString() : '#5a5d61', 0.8));
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
  shape.moveTo(pts[0].s, eave - 0.15);
  for (const p of pts) shape.lineTo(p.s, p.y);
  shape.lineTo(pts[pts.length - 1].s, eave - 0.15);
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
  // 棟（いちばん高い所）に棟包み
  const apex = pts.reduce((m, p) => p.y > m.y ? p : m, pts[0]);
  if (apex.y > eave + 0.3) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.3 : depth, 0.09, alongX ? depth : 0.3), capM);
    cap.position.set(alongX ? apex.s : (bb.minX + bb.maxX) / 2, apex.y + 0.02, alongX ? (bb.minZ + bb.maxZ) / 2 : apex.s);
    g.add(shadowed(cap));
  }
}

type Box = { x: number; y: number; w: number; h: number };
async function groundTexture(doc: Doc, lib: LibItem[], ctx: RenderCtx, boxOverride?: Box) {
  // 図面より少し広く取り、長い辺が MAX_TEX になる解像度で画像化する（iPad の上限内）
  const box = boxOverride || contentBox(doc, 200), scale = (boxOverride ? MAX_TEX_SITE : MAX_TEX) / Math.max(box.w, box.h, 1);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const canvas = await rasterize(docSVG(doc, lib, ctx, box, { background: boxOverride ? '#dedbd3' : '#f3f2ee', pxW: w, pxH: h }), w, h);
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
  const [renderSnap, setRenderSnap] = useState<Blob | null>(null); // AIパースに渡す3Dの写し
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
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), outerGroundMaterial());
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; outer.receiveShadow = true; scene.add(outer);
    let world = new THREE.Group(), ground: THREE.Mesh | null = null; scene.add(world);
    let center = new THREE.Vector3(), span = 20, eyeZ = 0, lit: string | null = null;
    let alive = true, framed = false, seq = 0;

    const setView = (v: ViewKind) => {
      const c = center;
      if (v === 'top') { camera.position.set(c.x, span * 1.25, c.z + 0.01); controls.target.copy(c); }
      else if (v === 'eye') { camera.position.set(c.x, 1.55, eyeZ + Math.max(6, span * 0.7)); controls.target.set(c.x, 2.0, c.z); } // 道路側から家を見る高さ・距離
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
      houseStyle = d.elevStyle || {};
      const { solids, raised } = buildScene(d, lib, o);
      // 地面：立面図のある図面では、下絵（配置図）を「敷地の図」だけに整える（文字・表題欄・用紙の枠を消す）
      let gdoc = groundDoc(d, raised), gbox: Box | undefined;
      if (d.underlay?.visible && d.elevations && Object.keys(d.elevations).length) {
        const items = contentBox({ ...d, underlay: undefined }, 0);
        const sg = await siteGround(d.underlay, items.w > 0 ? items : { x: d.underlay.x + d.underlay.w * 0.3, y: d.underlay.y + d.underlay.h * 0.3, w: d.underlay.w * 0.4, h: d.underlay.h * 0.4 });
        if (sg) {
          gdoc = { ...gdoc, underlay: { ...d.underlay, src: sg.src, opacity: 1 } };
          const ib = contentBox({ ...d, underlay: undefined }, 200);
          const x0 = Math.min(sg.box.x, ib.x), y0 = Math.min(sg.box.y, ib.y);
          gbox = { x: x0, y: y0, w: Math.max(sg.box.x + sg.box.w, ib.x + ib.w) - x0, h: Math.max(sg.box.y + sg.box.h, ib.y + ib.h) - y0 };
        }
      }
      const { canvas, box } = await groundTexture(gdoc, lib, ctx, gbox);
      if (!alive || my !== seq) return;
      scene.remove(world); disposeAll(world); world = new THREE.Group();
      const k = d.mmPerPx / 1000, gw = box.w * k, gd = box.h * k;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set((box.x + box.w / 2) * k, 0, (box.y + box.h / 2) * k); ground.receiveShadow = true;
      world.add(ground);
      for (const s of solids) world.add(solidObject(s));
      for (const o of await deckObjects(d)) { if (!alive || my !== seq) return; world.add(o); }
      scene.add(world);
      highlight(lit);
      if (framed) return;
      framed = true;
      // カメラは線・部品のある範囲（建物や外構）に寄せる。下絵しか無ければ下絵全体
      const hasItems = d.layers.some(l => l.visible && l.items.some(i => !(i.type === 'obj' && i.hidden)));
      const fb = hasItems ? contentBox({ ...d, underlay: undefined }, 300) : box;
      center = new THREE.Vector3((fb.x + fb.w / 2) * k, 0, (fb.y + fb.h / 2) * k);
      span = Math.max(fb.w * k, fb.h * k, 8) * (hasItems ? 1.6 : 1); eyeZ = (fb.y + fb.h) * k; // 建物まわりが入るよう少し引く
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
  // AIパース：今の視点の写しを撮って、パース画面へ
  const toRender = async () => { const b = await api.current?.snap(); api.current?.highlight(picked); if (b) setRenderSnap(b); };

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
        {PRO && <button className="v3-3d-btn ai" onClick={toRender} disabled={busy} aria-label="AIパースを作る"><Sparkles size={17} /><span>AIパース</span></button>}
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
          {hasElev && onDoc && <div className="v3-3d-colors">
            <span>外壁</span>{WALL_COLORS.map(([k, l, c]) => <button key={k} className={(doc.elevStyle?.wall || 'white') === k ? 'on' : ''} style={{ background: c }} title={l} aria-label={`外壁 ${l}`} onClick={() => onDoc(d => ({ ...d, elevStyle: { ...d.elevStyle, wall: k } }), '外壁の色')} />)}
            <span>屋根</span>{ROOF_COLORS.map(([k, l, c]) => <button key={k} className={(doc.elevStyle?.roof || 'dark') === k ? 'on' : ''} style={{ background: c }} title={l} aria-label={`屋根 ${l}`} onClick={() => onDoc(d => ({ ...d, elevStyle: { ...d.elevStyle, roof: k } }), '屋根の色')} />)}
          </div>}
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
      {renderSnap && <RenderDialog snap={renderSnap} doc={doc} view={viewKind} onClose={() => setRenderSnap(null)} />}
    </div>
  );
}

// 3Dビュー：平面図を地面に貼り、塀・建物・部品を汎用の形で立ち上げて、指やマウスで回して見る。
// three.js は重いので、このファイルごと「3D」を押したときに読み込む（Editor から lazy import）。
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Camera, RotateCcw } from 'lucide-react';
import { type Doc, type LibItem, rad } from './types';
import { type RenderCtx } from './markup';
import { contentBox, docSVG, rasterize } from './raster';
import { buildScene, groundDoc, DEFAULT_SCENE_OPTS, type Solid, type SceneOpts } from './scene3d';
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
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + s.t, s.h, s.t), mat(s.color));
      m.position.set((s.a.x + s.b.x) / 2, s.h / 2, (s.a.z + s.b.z) / 2);
      m.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      g.add(m); break;
    }
    case 'building': {
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
        const ry = (s.h - trunkH) * 0.6;
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), leaf);
        c.scale.set(s.r, ry, s.r); c.position.y = s.h - ry; g.add(c);
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
  return shadowed(g);
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

export default function View3D({ doc, lib, ctx, onClose }: { doc: Doc; lib: LibItem[]; ctx: RenderCtx; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setView: (v: ViewKind) => void; build: (o: SceneOpts) => Promise<void>; snap: () => Promise<Blob | null> } | null>(null);
  const [opts, setOpts] = useState<SceneOpts>(DEFAULT_SCENE_OPTS);
  const [viewKind, setViewKind] = useState<ViewKind>('bird');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setErr('この端末では3D表示を使えませんでした（WebGLに対応していません）'); setBusy(false); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe9f0');
    scene.fog = new THREE.Fog('#dfe9f0', 120, 260);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.minDistance = 1.5; controls.maxDistance = 200;
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8b2a3', 1.15));
    const sun = new THREE.DirectionalLight('#fff7e8', 1.5);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // 敷地の外側（ぼんやりした地面）
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), mat('#dcdccf'));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; outer.receiveShadow = true; scene.add(outer);
    let world = new THREE.Group(); scene.add(world);
    let center = new THREE.Vector3(), span = 20, eyeZ = 0;
    let alive = true, framed = false;

    const setView = (v: ViewKind) => {
      const c = center;
      if (v === 'top') { camera.position.set(c.x, span * 1.25, c.z + 0.01); controls.target.copy(c); }
      else if (v === 'eye') { camera.position.set(c.x, 1.55, eyeZ + 2); controls.target.set(c.x, 1.3, c.z); }
      else { camera.position.set(c.x + span * 0.45, span * 0.55, c.z + span * 0.85); controls.target.copy(c); }
      controls.update();
    };

    const build = async (o: SceneOpts) => {
      const { solids, raised } = buildScene(doc, lib, o);
      const { canvas, box } = await groundTexture(groundDoc(doc, raised), lib, ctx);
      if (!alive) return;
      scene.remove(world); disposeAll(world); world = new THREE.Group();
      const k = doc.mmPerPx / 1000, gw = box.w * k, gd = box.h * k;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set((box.x + box.w / 2) * k, 0, (box.y + box.h / 2) * k); ground.receiveShadow = true;
      world.add(ground);
      for (const s of solids) world.add(solidObject(s));
      scene.add(world);
      center = new THREE.Vector3((box.x + box.w / 2) * k, 0, (box.y + box.h / 2) * k);
      span = Math.max(gw, gd, 8); eyeZ = (box.y + box.h) * k;
      // 手前（図面の下側）斜め左から照らし、見る側の面が明るくなるようにする
      sun.position.set(center.x - span * 0.5, span * 1.1, center.z + span * 0.8); sun.target.position.copy(center);
      const sc = sun.shadow.camera; sc.left = sc.bottom = -span * 0.8; sc.right = sc.top = span * 0.8; sc.near = 0.5; sc.far = span * 4; sc.updateProjectionMatrix();
      if (!framed) { framed = true; setView('bird'); }
    };

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    const snap = () => new Promise<Blob | null>(res => { renderer.render(scene, camera); renderer.domElement.toBlob(res, 'image/png'); });
    api.current = { setView, build, snap };
    build(DEFAULT_SCENE_OPTS).catch(() => setErr('図面を3Dにできませんでした')).finally(() => setBusy(false));
    return () => {
      alive = false; api.current = null; ro.disconnect(); renderer.setAnimationLoop(null); controls.dispose();
      disposeAll(scene); renderer.dispose(); renderer.domElement.remove();
    };
  }, [doc, lib, ctx]);

  const change = (o: SceneOpts) => { setOpts(o); api.current?.build(o).catch(() => setErr('図面を3Dにできませんでした')); };
  const pick = (v: ViewKind) => { setViewKind(v); api.current?.setView(v); };
  const save = async () => { const b = await api.current?.snap(); if (b) await saveFile(b, `${doc.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'gaikou'}_3D.png`); };

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
      <div className="v3-3d-panel">
        <label>塀の高さ <b>{opts.wallH.toFixed(1)} m</b>
          <input type="range" min={0.4} max={2.4} step={0.1} value={opts.wallH} onChange={e => change({ ...opts, wallH: +e.target.value })} aria-label="塀の高さ" />
        </label>
        <label>建物の高さ <b>{opts.buildingH.toFixed(1)} m</b>
          <input type="range" min={3} max={9} step={0.5} value={opts.buildingH} onChange={e => change({ ...opts, buildingH: +e.target.value })} aria-label="建物の高さ" />
        </label>
        <p>実線の線は塀、20㎡以上の実線の囲みは建物として立ち上げています。点線・矢印・寸法は地面の絵のままです。1本指で回転、2本指で移動・拡大。</p>
      </div>
      {busy && <div className="v3-3d-msg">3Dを準備しています…</div>}
      {err && <div className="v3-3d-msg err">{err}</div>}
    </div>
  );
}

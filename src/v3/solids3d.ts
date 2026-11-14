// 外構の部品を3Dの形にする（建物以外）。植栽・門柱・カーポート・物置・車・照明・家具・設備・塀・フェンス・門扉。
// 実商品の形ではなく「外構屋がパースで見せる」程度の見た目を目指す。形はすべてコードで組む（外部の3Dモデルは使わない）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Solid, type CarBody } from './scene3d';
import { rad } from './types';
import { wallMaterial, wallPlain, meshFenceMaterial } from './materials3d';

type Geo = THREE.BufferGeometry;
type Part<K extends Solid['kind']> = Extract<Solid, { kind: K }>;

export const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
// 部品用：同じ色・質感の材質は使い回す（部品が多い図面でも軽い）。3D画面で選べる線・図形（塀など）には使わない
const shared = new Map<string, THREE.MeshStandardMaterial>();
export function cmat(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = shared.get(key);
  if (!m) { m = mat(color, extra); m.userData.shared = true; shared.set(key, m); }
  return m;
}
export function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = !c.userData.noShadow; c.receiveShadow = true; } });
  return o;
}
export function shade(hex: string, k: number): string { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
// 部品ごとに同じ「ゆらぎ」になる乱数（id から）
const seeded = (key: string | undefined) => { let h = 2166136261; for (const ch of key || 'x') { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

// ---- 形の部品 ----
const bx = (w: number, h: number, d: number, x = 0, y = 0, z = 0): Geo => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rbx = (w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0): Geo => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)).translate(x, y, z);
const cy = (rt: number, rb: number, h: number, seg = 12, x = 0, y = 0, z = 0): Geo => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// 2点を結ぶ丸棒
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): Geo {
  const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// いくつもの形を1つにまとめる（描く回数を減らす）
function merge(geos: Geo[]): Geo {
  const flat = geos.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k); return n; });
  const out = mergeGeometries(flat) || new THREE.BufferGeometry();
  for (const g of geos) g.dispose();
  return out;
}
const mesh = (g: Geo | Geo[], m: THREE.Material | THREE.Material[]) => new THREE.Mesh(Array.isArray(g) ? merge(g) : g, m);
const place = (g: THREE.Group, s: { x: number; z: number; rot?: number }) => { g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot ?? 0); return g; };

const METAL = { roughness: 0.42, metalness: 0.65 } as const;
const steel = (c = '#4a4d51') => cmat(c, METAL);

// ---- 葉のかたまり：でこぼこの球。下は暗く、出っ張りは明るく（頂点の色）。数種類を作って使い回す ----
const blobCache = new Map<string, Geo>();
function blobGeo(i: number, detail: number): Geo {
  const key = `${i % 5}/${detail}`, hit = blobCache.get(key);
  if (hit) return hit;
  const src = new THREE.IcosahedronGeometry(1, detail); src.deleteAttribute('uv'); src.deleteAttribute('normal');
  const g = mergeVertices(src, 1e-4); src.dispose();
  const p = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(p.count * 3), a = (i % 5) * 1.7 + 0.5;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const n = 1 + 0.17 * Math.sin(x * 4.1 + a) * Math.sin(y * 3.7 + a * 2) * Math.sin(z * 4.3 + a * 3)
      + 0.09 * Math.sin(x * 9.3 + a * 5) * Math.sin(z * 8.1 + a) + 0.07 * Math.sin(y * 10.7 + a * 4) * Math.sin(x * 7.9 - a);
    p.setXYZ(k, x * n, y * n, z * n);
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 0.58 + 0.46 * (y * 0.5 + 0.5) + 0.5 * (n - 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  blobCache.set(key, g);
  return g;
}
const leafMat = (color: string, k = 1) => cmat(shade(color, k), { roughness: 0.95, vertexColors: true });
function blob(g: THREE.Group, rnd: () => number, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail = 2) {
  const m = new THREE.Mesh(blobGeo(Math.floor(rnd() * 5), detail), leafMat(color, [0.9, 1, 1.1][Math.floor(rnd() * 3)]));
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.y = rnd() * Math.PI * 2;
  g.add(m);
}
// 花の点：かたまりの表面に小さな粒
function flowers(g: THREE.Group, rnd: () => number, color: string, rx: number, h: number, rz: number, n: number) {
  const dots: Geo[] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.25 + rnd() * 1.1, r = 0.045 + rnd() * 0.02;
    dots.push(new THREE.SphereGeometry(r, 6, 5).translate(Math.cos(a) * Math.sin(e) * rx * 0.98, h * (0.45 + 0.6 * Math.cos(e)), Math.sin(a) * Math.sin(e) * rz * 0.98));
  }
  g.add(mesh(dots, cmat(color, { roughness: 0.8 })));
}

// 樹木：幹（先細り）＋枝＋葉のかたまり。株立ち（multi）は細い幹を数本、葉を軽く散らす
function tree(s: Part<'tree'>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), bark = cmat('#6b5138', { roughness: 0.95 });
  if (s.form === 'cone') {
    // コニファー：下ほど広い円錐を少しずつずらして重ねる
    g.add(mesh(cy(0.05, 0.07, s.h * 0.2, 8, 0, s.h * 0.1, 0), bark));
    const n = 5;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1), r = s.r * (1 - k * 0.72), hh = s.h * 0.36, y = s.h * 0.1 + k * s.h * 0.56;
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 9), cmat(shade(s.color, 0.82 + k * 0.3), { roughness: 0.95, flatShading: true }));
      c.position.y = y + hh / 2; c.rotation.y = rnd() * Math.PI; g.add(c);
    }
  } else if (s.form === 'palm') {
    // ヤシ：少し曲がった幹に、弓なりに垂れる葉を放射状に
    const lean = s.r * 0.25, top = V(lean, s.h * 0.86, 0);
    const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(lean * 0.25, s.h * 0.45, 0), top]);
    g.add(mesh(new THREE.TubeGeometry(curve, 8, 0.11, 8), cmat('#8a745a', { roughness: 0.95 })));
    const len = s.r * 1.15, leaf = cmat(s.color, { side: THREE.DoubleSide, roughness: 0.85 }), fronds: Geo[] = [];
    for (let i = 0; i < 11; i++) {
      const f = new THREE.PlaneGeometry(len, len * 0.3, 6, 2), p = f.attributes.position as THREE.BufferAttribute, up = 0.25 + rnd() * 0.5;
      for (let k = 0; k < p.count; k++) {
        const t = p.getX(k) / len + 0.5, w = p.getY(k); // t：付け根0→先1、w：葉の幅方向
        p.setXYZ(k, t * len, t * len * up - t * t * len * 0.75 - Math.abs(w) * 0.5, w * (1 - t * 0.7));
      }
      f.computeVertexNormals(); f.rotateY(i / 11 * Math.PI * 2 + rnd() * 0.3); f.translate(top.x, top.y, top.z);
      fronds.push(f);
    }
    g.add(mesh(fronds, leaf));
    g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6).translate(top.x, top.y, top.z), cmat('#7c6a4f')));
  } else if (s.form === 'multi') {
    const stems: Geo[] = [], n = 3 + Math.floor(rnd() * 2), stemH = s.h * 0.62;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd() * 0.6, lean = s.r * (0.3 + rnd() * 0.25), r0 = 0.035 + rnd() * 0.015;
      stems.push(rod(V(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), V(Math.cos(a) * lean, stemH, Math.sin(a) * lean), r0, 6));
      // 幹の先に葉を数かたまり（上へ向かって小さく）
      for (let j = 0; j < 3; j++) {
        const t = 0.62 + j * 0.2, rr = s.r * (0.42 - j * 0.07) * (0.85 + rnd() * 0.3);
        blob(g, rnd, s.color, Math.cos(a) * lean * t * 1.25 + (rnd() - 0.5) * s.r * 0.25, s.h * (0.5 + j * 0.17), Math.sin(a) * lean * t * 1.25 + (rnd() - 0.5) * s.r * 0.25, rr, rr * 0.72, rr, 2);
      }
    }
    g.add(mesh(stems, bark));
    blob(g, rnd, s.color, 0, s.h * 0.84, 0, s.r * 0.42, s.r * 0.36, s.r * 0.42, 2);
  } else {
    const trunkH = s.h * 0.42, base = Math.min(0.15, Math.max(0.055, s.r * 0.075));
    const wood: Geo[] = [cy(base * 0.55, base, trunkH + s.r * 0.3, 10, 0, (trunkH + s.r * 0.3) / 2, 0)];
    for (let i = 0; i < 3; i++) { const a = rnd() * Math.PI * 2 + i * 2.1, l = s.r * 0.6; wood.push(rod(V(0, trunkH * 0.85, 0), V(Math.cos(a) * l, trunkH + s.r * 0.45, Math.sin(a) * l), base * 0.3, 6)); }
    g.add(mesh(wood, bark));
    // 樹冠：中心に大きなかたまり、まわりと上に小さなかたまり
    const ry = (s.h - trunkH) / 2, cyy = trunkH + ry;
    blob(g, rnd, s.color, 0, cyy, 0, s.r * 0.74, ry * 0.92, s.r * 0.74, 3);
    const n = 5 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd() * 0.5, d = s.r * (0.45 + rnd() * 0.12), rr = s.r * (0.42 + rnd() * 0.12);
      blob(g, rnd, s.color, Math.cos(a) * d, cyy + (rnd() - 0.55) * ry * 0.7, Math.sin(a) * d, rr, rr * 0.82, rr, 2);
    }
    blob(g, rnd, s.color, (rnd() - 0.5) * s.r * 0.3, cyy + ry * 0.55, (rnd() - 0.5) * s.r * 0.3, s.r * 0.46, ry * 0.5, s.r * 0.46, 2);
  }
  g.position.set(s.x, 0, s.z); g.rotation.y = rnd() * Math.PI * 2;
  return g;
}

// 低木・下草：こんもり（mound）／玉（ball）／地被（cover）／葉が立つ株（tuft）／放射状の葉（rosette）
function shrub(s: Part<'shrub'>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), form = s.form ?? 'mound';
  if (form === 'tuft' || form === 'rosette') {
    const blades: Geo[] = [], n = form === 'rosette' ? 14 : 18, r = Math.min(s.rx, s.rz);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd() * 0.5, ring = i % 2, tilt = form === 'rosette' ? 0.55 + ring * 0.55 + rnd() * 0.15 : 0.12 + rnd() * 0.55;
      const len = form === 'rosette' ? r * (1.05 - ring * 0.15) : s.h * (0.7 + rnd() * 0.5);
      const b = new THREE.ConeGeometry(form === 'rosette' ? r * 0.16 : 0.02, len, form === 'rosette' ? 5 : 3);
      if (form === 'rosette') b.scale(1, 1, 0.35);
      b.translate(0, len / 2, 0); b.rotateZ(-tilt); b.rotateY(a);
      blades.push(b);
    }
    g.add(mesh(blades, cmat(s.color, { roughness: 0.85, flatShading: form === 'rosette' })));
  } else if (form === 'ball') {
    blob(g, rnd, s.color, 0, s.h * 0.5, 0, s.rx, s.h * 0.52, s.rz, 3);
  } else {
    const n = form === 'cover' ? 3 : 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const kx = 0.62 + rnd() * 0.3, kz = 0.62 + rnd() * 0.3;
      blob(g, rnd, s.color, (rnd() - 0.5) * s.rx * 0.7, s.h * (0.36 + rnd() * 0.08), (rnd() - 0.5) * s.rz * 0.7, s.rx * kx, s.h * (0.58 + rnd() * 0.1), s.rz * kz, 2);
    }
    if (s.flower) flowers(g, rnd, s.flower, s.rx * 0.85, s.h * 0.9, s.rz * 0.85, 14);
  }
  return place(g, s);
}

// 生垣：下は刈り込んだ面、上はこんもりした葉が並ぶ
function hedge(s: Part<'hedge'>, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbx(s.w * 0.96, s.h * 0.8, s.d * 0.86, s.d * 0.3, 0, s.h * 0.4, 0), cmat(shade(s.color, 0.78), { roughness: 1 })));
  const n = Math.max(2, Math.round(s.w / (s.d * 0.7)));
  for (let i = 0; i < n; i++) {
    const x = -s.w / 2 + s.w * (i + 0.5) / n;
    blob(g, rnd, s.color, x, s.h * 0.62, (rnd() - 0.5) * s.d * 0.12, s.w / n * 0.72, s.h * 0.42, s.d * 0.56, 2);
    blob(g, rnd, s.color, x + s.w / n * 0.4, s.h * 0.32, (rnd() - 0.5) * s.d * 0.1, s.w / n * 0.6, s.h * 0.36, s.d * 0.54, 2);
  }
  if (s.flower) flowers(g, rnd, s.flower, s.w * 0.48, s.h, s.d * 0.5, Math.round(s.w * 14));
  return place(g, s);
}

// 景石：角ばった石。部品ごとに少しずつ違う形
function stone(s: Part<'stone'>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), src = new THREE.IcosahedronGeometry(1, 1); src.deleteAttribute('uv'); src.deleteAttribute('normal');
  const geo = mergeVertices(src, 1e-4), p = geo.attributes.position as THREE.BufferAttribute; src.dispose();
  for (let k = 0; k < p.count; k++) { const n = 0.74 + rnd() * 0.34; p.setXYZ(k, p.getX(k) * n, p.getY(k) * n, p.getZ(k) * n); }
  geo.computeVertexNormals();
  const c = new THREE.Mesh(geo, cmat(shade('#a39e94', 0.9 + rnd() * 0.2), { flatShading: true, roughness: 1 }));
  c.scale.set(s.rx, s.h, s.rz); c.position.y = s.h * 0.38; c.rotation.y = rnd() * Math.PI; g.add(c);
  return place(g, s);
}

// 門柱：塗り・ブロックの壁に笠木、表札・ポスト口・インターホン。機能門柱は細い金属の柱
function gatepost(s: Part<'gatepost'>): THREE.Group {
  const g = new THREE.Group(), front = s.d / 2;
  const plate = cmat('#e9e9e6', { roughness: 0.3, metalness: 0.7 }), dark = cmat('#232527', { roughness: 0.55 });
  const lamp = cmat('#fff2c8', { emissive: '#ffcf70', emissiveIntensity: 1.1 });
  if (s.variant === 'func') {
    const w = Math.min(s.w, 0.34);
    g.add(mesh(rbx(w, s.h, s.d * 0.7, 0.015, 0, s.h / 2, 0), steel('#3a3c40')));
    const f = s.d * 0.35 + 0.004;
    g.add(mesh([bx(w * 0.78, 0.09, 0.008, 0, s.h * 0.86, f)], plate));
    g.add(mesh([bx(w * 0.8, 0.035, 0.008, 0, s.h * 0.62, f), bx(w * 0.36, 0.13, 0.01, 0, s.h * 0.74, f)], dark));
    g.add(mesh(bx(w * 0.7, 0.025, 0.02, 0, s.h * 0.93, f + 0.006), lamp));
  } else {
    const tex = wallMaterial('plaster', '#e6e1d6', s.w, s.h), plain = wallPlain('plaster', '#e6e1d6');
    g.add(new THREE.Mesh(bx(s.w, s.h, s.d, 0, s.h / 2, 0), [plain, plain, plain, plain, tex, tex]));
    g.add(mesh(bx(s.w + 0.05, 0.045, s.d + 0.05, 0, s.h + 0.022, 0), cmat('#b3aea4')));
    // 図面の記号と同じく、表札は右寄り。左にポスト口、表札の下にインターホン
    const px = s.w * 0.28, f = front + 0.004;
    g.add(mesh(bx(Math.min(0.26, s.w * 0.3), 0.1, 0.008, px, s.h * 0.78, f), plate));
    g.add(mesh([bx(Math.min(0.34, s.w * 0.34), 0.05, 0.01, -s.w * 0.14, s.h * 0.62, f), bx(0.1, 0.15, 0.012, px, s.h * 0.55, f)], dark));
    g.add(mesh(bx(Math.min(0.26, s.w * 0.3), 0.022, 0.03, px, s.h * 0.88, f + 0.012), lamp));
  }
  return place(g, s);
}

// カーポート：柱は図面の記号どおり（4本＝四隅、2本＝奥だけの片持ち）。梁・垂木・屋根枠に、薄く透けるポリカ屋根
function carport(s: Part<'carport'>): THREE.Group {
  const g = new THREE.Group(), fr = steel('#56595d'), px = s.w / 2 - 0.08;
  const posts: Geo[] = [], zs = s.posts === 2 ? [-s.d / 2 + 0.09] : [-s.d / 2 + 0.14, s.d / 2 - 0.14];
  for (const z of zs) for (const dx of [-1, 1]) posts.push(bx(0.1, s.h, 0.1, dx * px, s.h / 2, z));
  g.add(mesh(posts, fr));
  // 屋根（奥へ少し下がる）：側の梁、前後の枠、垂木、パネル
  const roof = new THREE.Group(), bars: Geo[] = [];
  for (const dx of [-1, 1]) bars.push(bx(0.09, 0.15, s.d, dx * px, -0.075, 0));
  for (const dz of [-1, 1]) bars.push(bx(s.w, 0.07, 0.07, 0, 0.035, dz * (s.d / 2 - 0.035)));
  const n = Math.max(2, Math.round(s.d / 0.75));
  for (let i = 1; i < n; i++) bars.push(bx(s.w - 0.1, 0.045, 0.04, 0, 0.022, -s.d / 2 + s.d * i / n));
  roof.add(mesh(bars, fr));
  const panel = mesh(bx(s.w - 0.06, 0.012, s.d - 0.08, 0, 0.055, 0), cmat('#aebbc2', { transparent: true, opacity: 0.4, roughness: 0.08, metalness: 0 }));
  panel.userData.noShadow = true; roof.add(panel);
  roof.position.y = s.h; roof.rotation.x = -0.03;
  g.add(roof);
  return place(g, s);
}

// 物置：基礎ブロックの上に本体、引き戸3枚、庇のある屋根
function shed(s: Part<'shed'>): THREE.Group {
  const g = new THREE.Group(), f = s.d / 2, y0 = 0.08, hh = s.h - y0;
  g.add(mesh([-1, 1].flatMap(dx => [-1, 1].map(dz => bx(0.2, y0, 0.2, dx * (s.w / 2 - 0.15), y0 / 2, dz * (s.d / 2 - 0.15)))), cmat('#b5b1a8')));
  g.add(mesh(rbx(s.w, hh, s.d, 0.012, 0, y0 + hh / 2, 0), cmat('#dcdbd4', { roughness: 0.55, metalness: 0.2 })));
  const roof = mesh(bx(s.w + 0.14, 0.05, s.d + 0.16, 0, 0, 0.02), steel('#7c8085')); roof.position.y = s.h + 0.03; roof.rotation.x = 0.04; g.add(roof);
  const dw = (s.w - 0.1) / 3, doors: Geo[] = [], trims: Geo[] = [];
  for (let i = 0; i < 3; i++) {
    const x = -s.w / 2 + 0.05 + dw * (i + 0.5);
    doors.push(bx(dw - 0.012, hh * 0.86, 0.012, x, y0 + hh * 0.47, f + 0.004 + (i % 2) * 0.008));
    trims.push(bx(0.018, 0.16, 0.012, x + (i === 0 ? dw * 0.36 : -dw * 0.36), y0 + hh * 0.5, f + 0.02));
  }
  g.add(mesh(doors, cmat('#c9c9c3', { roughness: 0.5, metalness: 0.25 })));
  g.add(mesh(trims, steel('#55585c')));
  return place(g, s);
}

// 車：側面の輪郭（タイヤの収まる切り欠きつき）を幅ぶん押し出し、窓ガラス・ライト・ミラー・タイヤを付ける。
// 寸法は図面の部品（全長・全幅）から。高さと形は車種（セダン・ハッチバック・SUV・軽）で変える
const CAR: Record<CarBody, { H: number; hood: number; x1: number; y1: number; x2: number; x3: number; x4: number; y4: number; y5: number; rw: number; xf: number; xr: number; pillars: number[] }> = {
  sedan: { H: 1.45, hood: 0.74, x1: 0.27, y1: 0.9, x2: 0.42, x3: 0.7, x4: 0.86, y4: 0.95, y5: 0.9, rw: 0.31, xf: 0.19, xr: 0.2, pillars: [0.5] },
  hatch: { H: 1.5, hood: 0.76, x1: 0.25, y1: 0.92, x2: 0.4, x3: 0.8, x4: 0.95, y4: 0.98, y5: 0.92, rw: 0.3, xf: 0.19, xr: 0.19, pillars: [0.42] },
  suv: { H: 1.62, hood: 0.9, x1: 0.25, y1: 1.03, x2: 0.39, x3: 0.84, x4: 0.96, y4: 1.08, y5: 1.0, rw: 0.34, xf: 0.19, xr: 0.19, pillars: [0.36, 0.72] },
  kei: { H: 1.72, hood: 0.82, x1: 0.17, y1: 1.0, x2: 0.3, x3: 0.93, x4: 0.985, y4: 1.06, y5: 1.0, rw: 0.28, xf: 0.2, xr: 0.19, pillars: [0.36, 0.72] },
};
function car(s: Part<'car'>): THREE.Group {
  const g = new THREE.Group(), L = s.d, W = s.w, c = CAR[s.body ?? 'hatch'], clr = 0.19, b = 0.04;
  const X = (f: number) => -L / 2 + f * L; // 前（図面の上）からの割合 → 位置
  const x1 = X(c.x1), x2 = X(c.x2), x3 = X(c.x3), x4 = X(c.x4), xf = X(c.xf), xr = X(1 - c.xr);
  const ra = c.rw + 0.05, al = Math.asin((c.rw - clr) / ra), dx = Math.cos(al) * ra;
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2, clr + 0.08); sh.lineTo(-L / 2, c.hood - 0.12); sh.lineTo(X(0.035), c.hood);
  sh.lineTo(x1, c.y1); sh.lineTo(x2, c.H); sh.lineTo(x3, c.H); sh.lineTo(x4, c.y4);
  sh.lineTo(L / 2 - 0.02, c.y5); sh.lineTo(L / 2, c.y5 - 0.15); sh.lineTo(L / 2, clr + 0.08); sh.lineTo(L / 2 - 0.06, clr);
  sh.lineTo(xr + dx, clr); sh.absarc(xr, c.rw, ra, -al, Math.PI + al, false);
  sh.lineTo(xf + dx, clr); sh.absarc(xf, c.rw, ra, -al, Math.PI + al, false);
  sh.lineTo(-L / 2 + 0.06, clr); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: W - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -(W - b * 2) / 2); geo.rotateY(-Math.PI / 2); // 輪郭の横（長さ）→ 奥行き z、押し出し → 幅 x
  g.add(new THREE.Mesh(geo, cmat(s.color, { roughness: 0.28, metalness: 0.35 })));

  // ガラス：前後は傾いた面に沿った板、横は客室の形
  const glass = cmat('#5d7284', { roughness: 0.06, metalness: 0.9, side: THREE.DoubleSide });
  const quad = (za: number, ya: number, zb: number, yb: number, hw: number, t0: number, t1: number, nz: number, ny: number): Geo => {
    const o = b + 0.006, P = (t: number, sx: number) => [sx * hw, ya + (yb - ya) * t + ny * o, za + (zb - za) * t + nz * o];
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([...P(t0, -1), ...P(t0, 1), ...P(t1, 1), ...P(t0, -1), ...P(t1, 1), ...P(t1, -1)], 3));
    q.computeVertexNormals(); q.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
    return q;
  };
  const nrm = (dz: number, dy: number, up = 1) => { const l = Math.hypot(dz, dy) || 1; return [-dy / l * up, dz / l * up]; };
  const [fz, fy] = nrm(x2 - x1, c.H - c.y1), [rz, ry] = nrm(x4 - x3, c.y4 - c.H);
  const panes: Geo[] = [quad(x1, c.y1, x2, c.H, W / 2 - 0.13, 0.1, 0.93, fz, fy), quad(x3, c.H, x4, c.y4, W / 2 - 0.13, 0.08, 0.9, rz, ry)];
  const side = new THREE.Shape([new THREE.Vector2(x1 + 0.13, c.y1 + 0.03), new THREE.Vector2(x2 + 0.07, c.H - 0.085), new THREE.Vector2(x3 - 0.07, c.H - 0.085), new THREE.Vector2(x4 - 0.13, c.y4 + 0.03)]);
  for (const sx of [-1, 1]) panes.push(new THREE.ShapeGeometry(side).rotateY(-Math.PI / 2).translate(sx * (W / 2 + 0.004), 0, 0));
  g.add(mesh(panes, glass));

  // 柱・ミラー・バンパーまわり（車体色より少し暗い）、ライト、グリル
  const trim: Geo[] = [], belt = Math.max(c.y1, c.y4) + 0.03, ph = c.H - 0.085 - belt;
  for (const f of c.pillars) for (const sx of [-1, 1]) trim.push(bx(0.012, ph, 0.075, sx * (W / 2 + 0.008), belt + ph / 2, x2 + (x3 - x2) * f));
  for (const sx of [-1, 1]) trim.push(bx(0.17, 0.09, 0.07, sx * (W / 2 + 0.08), c.y1 + 0.06, x1 + 0.22));
  g.add(mesh(trim, cmat(shade(s.color, 0.8), { roughness: 0.3, metalness: 0.35 })));
  const front = -L / 2 - b, back = L / 2 + b, ly = c.hood - 0.22, ty = c.y5 - 0.26;
  g.add(mesh([-1, 1].map(sx => bx(W * 0.2, 0.1, 0.03, sx * (W / 2 - W * 0.16), ly, front)), cmat('#f4f6f8', { emissive: '#fff4d6', emissiveIntensity: 0.35, roughness: 0.15 })));
  g.add(mesh([-1, 1].map(sx => bx(W * 0.2, 0.1, 0.03, sx * (W / 2 - W * 0.16), ty, back)), cmat('#a8211b', { emissive: '#5a0c08', emissiveIntensity: 0.4, roughness: 0.25 })));
  g.add(mesh([bx(W * 0.42, 0.09, 0.03, 0, ly, front), bx(W * 0.72, 0.09, 0.03, 0, clr + 0.17, front), bx(W * 0.72, 0.09, 0.03, 0, clr + 0.17, back), bx(0.3, 0.14, 0.03, 0, ty, back)], cmat('#26282b', { roughness: 0.5 })));

  // タイヤとホイール
  const tires: Geo[] = [], hubs: Geo[] = [];
  for (const sx of [-1, 1]) for (const z of [xf, xr]) {
    tires.push(new THREE.CylinderGeometry(c.rw, c.rw, 0.2, 20).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.12), c.rw, z));
    hubs.push(new THREE.CylinderGeometry(c.rw * 0.62, c.rw * 0.62, 0.21, 14).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.12), c.rw, z));
  }
  g.add(mesh(tires, cmat('#1b1c1e', { roughness: 0.9 })));
  g.add(mesh(hubs, cmat('#c3c6ca', { metalness: 0.8, roughness: 0.25 })));
  return place(g, s);
}

// 照明：ポールライト／スポット。灯具は光って見える
function light(s: Part<'light'>): THREE.Group {
  const g = new THREE.Group(), body = steel('#34363a'), glow = cmat('#fff3d0', { emissive: '#ffcf7a', emissiveIntensity: 1.2 });
  if (s.kind2 === 'pole') {
    g.add(mesh([cy(0.028, 0.028, s.h, 10, 0, s.h / 2, 0), cy(0.05, 0.05, 0.02, 12, 0, 0.01, 0), cy(0.05, 0.05, 0.02, 12, 0, s.h + 0.17, 0)], body));
    g.add(mesh(cy(0.042, 0.042, 0.16, 12, 0, s.h + 0.08, 0), glow));
  } else {
    // スポット：短い杭に、斜め上を向いた灯具（図面の向きに合わせる）
    g.add(mesh([cy(0.015, 0.015, s.h, 6, 0, s.h / 2, 0), new THREE.CylinderGeometry(0.05, 0.035, 0.12, 12).rotateX(-0.9).translate(0, s.h + 0.03, 0)], body));
    g.add(mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.01, 12).rotateX(-0.9).translate(0, s.h + 0.03 + Math.cos(0.9) * 0.062, -Math.sin(0.9) * 0.062), glow));
  }
  return place(g, s);
}

// 人：脚・胴・頭。子どもは背を低く
function person(s: Part<'person'>): THREE.Group {
  const g = new THREE.Group(), k = s.h / 1.65;
  g.add(mesh([-1, 1].map(sx => cy(0.065 * k, 0.055 * k, 0.8 * k, 8, sx * 0.085 * k, 0.4 * k, 0)), cmat('#3d4452')));
  g.add(mesh(new THREE.CapsuleGeometry(0.17 * k, 0.36 * k, 4, 12).translate(0, 1.08 * k, 0).scale(1, 1, 0.72), cmat(s.color, { roughness: 0.9 })));
  g.add(mesh([-1, 1].map(sx => new THREE.CapsuleGeometry(0.05 * k, 0.42 * k, 3, 8).rotateZ(sx * 0.12).translate(sx * 0.24 * k, 1.02 * k, 0)), cmat(shade(s.color, 0.88), { roughness: 0.9 })));
  g.add(mesh(new THREE.SphereGeometry(0.115 * k, 14, 10).translate(0, 1.52 * k, 0), cmat('#e6c6a5')));
  g.add(mesh(new THREE.SphereGeometry(0.122 * k, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.535 * k, -0.012 * k), cmat('#3a2e28')));
  return place(g, s);
}

// 家具・自転車・設備など（図面の大きさ w×d に合わせて組む）
function chairGeo(w: number, d: number): { frame: Geo[]; seat: Geo[] } {
  const lx = w / 2 - 0.04, lz = d / 2 - 0.04;
  const frame = [-1, 1].flatMap(sx => [bx(0.03, 0.43, 0.03, sx * lx, 0.215, lz), bx(0.03, 0.82, 0.03, sx * lx, 0.41, -lz)]);
  return { frame, seat: [bx(w * 0.92, 0.04, d * 0.92, 0, 0.44, 0), bx(w * 0.92, 0.26, 0.03, 0, 0.7, -lz)] };
}
function prop(s: Part<'prop'>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = s.w, d = s.d, col = s.color;
  const wood = cmat('#b98d5f', { roughness: 0.75 }), concrete = cmat('#bcb6aa', { roughness: 0.95 }), black = cmat('#1c1d1f', { roughness: 0.85 });
  switch (s.type) {
    case 'table': {
      const r = Math.min(w, d) / 2;
      g.add(mesh(cy(r, r, 0.035, 28, 0, 0.72, 0), cmat(col || '#2a2a2a', { roughness: 0.5 })));
      g.add(mesh([cy(0.03, 0.03, 0.7, 10, 0, 0.35, 0), cy(r * 0.42, r * 0.46, 0.025, 20, 0, 0.012, 0)], steel('#3a3c3f')));
      break;
    }
    case 'chair': {
      const c = chairGeo(w * 0.86, d * 0.86);
      g.add(mesh(c.frame, steel('#3a3c3f'))); g.add(mesh(c.seat, cmat(col || '#55585c', { roughness: 0.7 })));
      break;
    }
    case 'tableset': {
      // 丸テーブルを4脚の椅子が囲む
      const S = Math.min(w, d), r = S * 0.24, frame: Geo[] = [], seat: Geo[] = [];
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, c = chairGeo(0.44, 0.44), phi = Math.atan2(-Math.cos(a), -Math.sin(a));
        for (const q of c.frame) frame.push(q.rotateY(phi).translate(Math.cos(a) * S * 0.37, 0, Math.sin(a) * S * 0.37));
        for (const q of c.seat) seat.push(q.rotateY(phi).translate(Math.cos(a) * S * 0.37, 0, Math.sin(a) * S * 0.37));
      }
      frame.push(cy(0.03, 0.03, 0.7, 10, 0, 0.35, 0), cy(r * 0.42, r * 0.46, 0.025, 20, 0, 0.012, 0));
      g.add(mesh(frame, steel('#3a3c3f'))); g.add(mesh(seat, cmat('#55585c', { roughness: 0.7 })));
      g.add(mesh(cy(r, r, 0.035, 28, 0, 0.72, 0), cmat('#2a2a2a', { roughness: 0.5 })));
      break;
    }
    case 'bench': {
      const slats = [-1, 0, 1].map(i => bx(w, 0.035, d * 0.27, 0, 0.43, i * d * 0.33));
      g.add(mesh(slats, wood));
      g.add(mesh([-1, 1].flatMap(sx => [bx(0.05, 0.41, d * 0.8, sx * (w / 2 - 0.14), 0.205, 0)]), steel('#3a3c3f')));
      break;
    }
    case 'planter': case 'planterbench': {
      // プランター（鉢に土と植え込み）。ベンチ付きは片側が腰かけ
      const pw = s.type === 'planterbench' ? w * 0.45 : w, px = s.type === 'planterbench' ? -w / 2 + pw / 2 : 0;
      g.add(mesh(rbx(pw, 0.44, d, 0.03, px, 0.22, 0), concrete));
      g.add(mesh(bx(pw - 0.08, 0.02, d - 0.08, px, 0.44, 0), cmat('#54463a', { roughness: 1 })));
      const plant = new THREE.Group(); plant.position.set(px, 0.42, 0);
      for (let i = 0; i < 2; i++) blob(plant, rnd, '#6f9a4e', (rnd() - 0.5) * pw * 0.3, 0.16, (rnd() - 0.5) * d * 0.3, pw * 0.36, 0.24, d * 0.36, 2);
      g.add(plant);
      if (s.type === 'planterbench') {
        g.add(mesh(bx(w - pw, 0.05, d * 0.96, px + pw / 2 + (w - pw) / 2, 0.42, 0), wood));
        g.add(mesh(bx(0.08, 0.395, d * 0.9, w / 2 - 0.06, 0.1975, 0), concrete));
      }
      break;
    }
    case 'bicycle': case 'motorbike': {
      // 車輪2つ・フレーム・ハンドル・サドル。前は図面の上（-z）
      const moto = s.type === 'motorbike', k = d / (moto ? 2.0 : 1.82), R = (moto ? 0.3 : 0.33) * k, tube = (moto ? 0.055 : 0.018) * k, ax = d / 2 - R - tube;
      const wheel = (z: number) => new THREE.TorusGeometry(R, tube, 8, 22).rotateY(Math.PI / 2).translate(0, R + tube, z);
      g.add(mesh([wheel(ax), wheel(-ax)], black));
      const y0 = R + tube, P = (y: number, z: number) => V(0, y * k, z * k), fr: Geo[] = [], t = (moto ? 0.03 : 0.016) * k;
      const seatP = P(0.84, 0.2), head = P(0.92, -0.42), bb = P(0.3, 0.08), rear = V(0, y0, ax), frontA = V(0, y0, -ax);
      fr.push(rod(rear, bb, t), rod(bb, seatP, t), rod(seatP, rear, t * 0.8), rod(P(0.76, 0.17), head, t), rod(bb, P(0.8, -0.4), t), rod(head, frontA, t), rod(head, P(1.0, -0.4), t));
      fr.push(rod(V(-0.23 * k, 1.0 * k, -0.4 * k), V(0.23 * k, 1.0 * k, -0.4 * k), t));
      g.add(mesh(fr, cmat(col || (moto ? '#2c2f33' : '#3f5263'), { roughness: 0.4, metalness: 0.5 })));
      if (moto) {
        g.add(mesh([rbx(0.26 * k, 0.3 * k, 0.75 * k, 0.05, 0, 0.5 * k, 0.05 * k), rbx(0.24 * k, 0.16 * k, 0.4 * k, 0.05, 0, 0.74 * k, -0.2 * k)], cmat(col || '#394048', { roughness: 0.35, metalness: 0.4 })));
        g.add(mesh(rbx(0.24 * k, 0.08 * k, 0.6 * k, 0.03, 0, 0.8 * k, 0.32 * k), black));
        g.add(mesh(new THREE.SphereGeometry(0.08 * k, 10, 8).translate(0, 0.86 * k, -0.52 * k), cmat('#f4f6f8', { emissive: '#fff4d6', emissiveIntensity: 0.3 })));
      } else {
        g.add(mesh(bx(0.13 * k, 0.045 * k, 0.25 * k, 0, 0.87 * k, 0.22 * k), black));
        g.add(mesh(new THREE.BoxGeometry(0.24 * k, 0.2 * k, 0.3 * k).translate(0, 0.85 * k, -0.62 * k), cmat('#6e7276', { roughness: 0.6, metalness: 0.5 }))); // 前かご
      }
      break;
    }
    case 'faucet': {
      const pw = Math.min(0.11, w * 0.5);
      g.add(mesh([rbx(pw, 0.85, pw, 0.008, 0, 0.425, -d * 0.15), bx(w * 0.95, 0.05, d * 0.95, 0, 0.025, 0)], cmat('#c9c5bc', { roughness: 0.9 })));
      g.add(mesh([rod(V(0, 0.7, -d * 0.15 + pw / 2), V(0, 0.7, -d * 0.15 + pw / 2 + 0.08), 0.012, 8), rod(V(0, 0.7, -d * 0.15 + pw / 2 + 0.075), V(0, 0.64, -d * 0.15 + pw / 2 + 0.075), 0.011, 8), cy(0.022, 0.022, 0.012, 10, 0, 0.726, -d * 0.15 + pw / 2 + 0.03)], cmat('#d9dbde', { metalness: 0.9, roughness: 0.2 })));
      break;
    }
    case 'ac': {
      // 室外機：白い箱、前面に丸い吹出口と羽、脚
      const h = 0.58, f = d / 2;
      g.add(mesh(rbx(w, h, d, 0.02, 0, 0.06 + h / 2, 0), cmat('#eceeed', { roughness: 0.6, metalness: 0.1 })));
      g.add(mesh([-1, 1].map(sx => bx(0.06, 0.06, d * 0.9, sx * (w / 2 - 0.1), 0.03, 0)), black));
      const fr = Math.min(h * 0.38, w * 0.3), fx = -w * 0.14, fy = 0.06 + h / 2, grille: Geo[] = [];
      grille.push(new THREE.CircleGeometry(fr, 24).translate(fx, fy, f + 0.002), new THREE.TorusGeometry(fr, 0.012, 6, 28).translate(fx, fy, f + 0.004));
      for (let i = 0; i < 6; i++) grille.push(new THREE.BoxGeometry(fr * 2, 0.008, 0.008).rotateZ(i * Math.PI / 6).translate(fx, fy, f + 0.008));
      for (let i = 0; i < 5; i++) grille.push(bx(w * 0.2, 0.012, 0.006, w * 0.32, fy - 0.12 + i * 0.06, f + 0.003));
      g.add(mesh(grille, cmat('#5d6368', { roughness: 0.6, metalness: 0.3 })));
      break;
    }
    case 'dryer': {
      // 物干し：両端に土台と支柱、腕木に竿を2本
      const px = w / 2 - 0.09, poles: Geo[] = [], rods: Geo[] = [];
      for (const sx of [-1, 1]) poles.push(cy(0.02, 0.02, 1.75, 10, sx * px, 0.875, 0), bx(0.03, 0.03, Math.max(0.5, d), sx * px, 1.72, 0));
      for (const dz of [-1, 1]) rods.push(rod(V(-w / 2, 1.75, dz * 0.18), V(w / 2, 1.75, dz * 0.18), 0.013, 8));
      g.add(mesh([-1, 1].map(sx => bx(0.2, 0.1, 0.2, sx * px, 0.05, 0)), concrete));
      g.add(mesh(poles, steel('#8a8d91'))); g.add(mesh(rods, cmat('#d2d5d8', { metalness: 0.85, roughness: 0.25 })));
      break;
    }
    case 'meter': g.add(mesh(rbx(w, 0.02, d, 0.008, 0, 0.01, 0), cmat('#5f7186', { roughness: 0.6, metalness: 0.3 }))); break;
  }
  return place(g, s);
}

// 線の角のつなぎ（丸い柱）。線分どうしが重ならず、すき間も出ない
const joint = (r: number, h: number, x: number, z: number, m: THREE.Material) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), m); c.position.set(x, h / 2, z); return c; };

export function partObject(s: Solid): THREE.Object3D | null {
  const rnd = seeded(s.src);
  let g: THREE.Object3D;
  switch (s.kind) {
    case 'wall': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), rot = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x), cx = (s.a.x + s.b.x) / 2, cz = (s.a.z + s.b.z) / 2;
      // 模様は長い面だけに貼る（小口・上面は無地）。線分は端から端までにして、角は丸い柱でつなぐ
      const tex = wallMaterial(s.mat ?? 'plaster', s.color, len, s.h), plain = wallPlain(s.mat ?? 'plaster', s.color), capM = mat(s.mat === 'alumi' ? '#4a4d50' : '#c9c4ba');
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, s.h, s.t), [plain, plain, plain, plain, tex, tex]);
      m.position.set(cx, s.h / 2, cz); m.rotation.y = rot; g.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, s.t + 0.04), capM);
      cap.position.set(cx, s.h + 0.02, cz); cap.rotation.y = rot; g.add(cap);
      if (s.join) { g.add(joint(s.t / 2, s.h, s.b.x, s.b.z, plain)); const jc = joint(s.t / 2 + 0.02, 0.04, s.b.x, s.b.z, capM); jc.position.y = s.h + 0.02; g.add(jc); }
      break;
    }
    case 'fence': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), hh = s.h - s.base, ym = s.base + hh / 2;
      const baseTex = wallMaterial('block', '#cbc7bf', len, s.base), basePlain = wallPlain('block', '#cbc7bf');
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, s.base, 0.15), [basePlain, basePlain, basePlain, basePlain, baseTex, baseTex]); base.position.y = s.base / 2; g.add(base);
      const n = Math.max(1, Math.ceil(len / 2)), postM = mat('#3f3b38', { roughness: 0.5, metalness: 0.5 }), posts: Geo[] = [];
      for (let i = 0; i <= n; i++) posts.push(bx(0.06, hh, 0.06, -len / 2 + len * i / n, ym, 0));
      if (s.mat === 'mesh') {
        const net = new THREE.Mesh(new THREE.PlaneGeometry(len, hh), meshFenceMaterial(len, hh)); net.position.set(0, ym, 0); g.add(net);
        for (const y of [s.base + 0.03, s.h - 0.03]) posts.push(bx(len, 0.04, 0.04, 0, y, 0));
      } else if (s.mat === 'lattice') {
        const bars = Math.max(2, Math.floor(len / 0.06));
        for (let j = 0; j <= bars; j++) posts.push(bx(0.02, hh - 0.05, 0.02, -len / 2 + len * j / bars, ym, 0));
        for (const y of [s.base + 0.03, s.h - 0.03]) posts.push(bx(len, 0.05, 0.04, 0, y, 0));
      } else {
        const rows = Math.max(1, Math.floor(hh / 0.12)), slats: Geo[] = [];
        for (let j = 0; j < rows; j++) slats.push(bx(len, 0.09, 0.02, 0, s.base + 0.06 + j * (hh - 0.06) / rows, 0.04));
        g.add(mesh(slats, mat('#7a5a40', { roughness: 0.75 })));
      }
      g.add(mesh(posts, postM));
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2); g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      if (s.join) { const j = joint(0.075, s.base, len / 2, 0, basePlain); g.add(j); }
      break;
    }
    case 'gate': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), frameM = mat('#3d3a37', { roughness: 0.5, metalness: 0.5 }), parts: Geo[] = [];
      for (const x of [-len / 2, len / 2]) parts.push(bx(0.12, s.h + 0.1, 0.12, x, (s.h + 0.1) / 2, 0));
      const leaves = len > 1.4 ? 2 : 1, lw = (len - 0.16) / leaves, y0 = 0.08, lh = s.h - 0.12;
      for (let i = 0; i < leaves; i++) {
        const lx = -len / 2 + 0.08 + lw * (i + 0.5);
        parts.push(bx(lw, 0.04, 0.04, lx, y0, 0), bx(lw, 0.04, 0.04, lx, y0 + lh, 0), bx(0.04, lh, 0.04, lx - lw / 2 + 0.02, y0 + lh / 2, 0), bx(0.04, lh, 0.04, lx + lw / 2 - 0.02, y0 + lh / 2, 0));
        const bars = Math.max(2, Math.floor(lw / 0.11));
        for (let j = 1; j < bars; j++) parts.push(bx(0.02, lh, 0.02, lx - lw / 2 + lw * j / bars, y0 + lh / 2, 0));
        // 取っ手（両開きは中央の合わせ目、片開きは右端）
        parts.push(bx(0.03, 0.14, 0.09, leaves === 2 ? (i ? 0.05 : -0.05) : len / 2 - 0.16, y0 + lh * 0.55, 0));
      }
      g.add(mesh(parts, frameM));
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2); g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      break;
    }
    case 'tree': g = tree(s, rnd); break;
    case 'shrub': g = shrub(s, rnd); break;
    case 'hedge': g = hedge(s, rnd); break;
    case 'gatepost': g = gatepost(s); break;
    case 'carport': g = carport(s); break;
    case 'shed': g = shed(s); break;
    case 'car': g = car(s); break;
    case 'light': g = light(s); break;
    case 'stone': g = stone(s, rnd); break;
    case 'person': g = person(s); break;
    case 'prop': g = prop(s, rnd); break;
    case 'box': {
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), cmat(s.color)); m.position.y = (s.y0 ?? 0) + s.h / 2; g.add(m);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'cylinder': {
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.h, 18), cmat(s.color)); m.position.y = s.h / 2; g.add(m); g.position.set(s.x, 0, s.z); break;
    }
    default: return null;
  }
  g.userData.src = s.src;
  return shadowed(g);
}

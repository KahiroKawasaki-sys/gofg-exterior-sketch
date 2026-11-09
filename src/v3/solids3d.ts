// 外構の部品を3Dの形にする（建物以外）。植栽・門柱・カーポート・物置・車・照明・塀・フェンス・門扉。
// 実商品の形ではなく「外構屋がパースで見せる」程度の見た目を目指す
import * as THREE from 'three';
import { type Solid } from './scene3d';
import { rad } from './types';
import { wallMaterial, meshFenceMaterial } from './materials3d';

export const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
export function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = !c.userData.noShadow; c.receiveShadow = true; } });
  return o;
}
export function shade(hex: string, k: number): string { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
// 部品ごとに同じ「ゆらぎ」になる乱数（id から）
const seeded = (key: string | undefined) => { let h = 2166136261; for (const ch of key || 'x') { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };

// 樹木：幹（先細り）＋枝＋葉の塊（球を3〜5個、色を少しずつ変えて重ねる）。下側は暗く
function tree(s: Extract<Solid, { kind: 'tree' }>, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkH = s.form === 'palm' ? s.h * 0.85 : s.h * 0.42;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, trunkH, 10), mat('#6f5236', { roughness: 0.95 }));
  trunk.position.y = trunkH / 2; g.add(trunk);
  if (s.form === 'cone') {
    // コニファー：3段の円錐
    const m = mat(s.color, { roughness: 0.95 });
    for (let i = 0; i < 3; i++) { const r = s.r * (1 - i * 0.22), hh = s.h * 0.42, y = s.h * 0.22 + i * s.h * 0.2; const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 12), m); c.position.y = y + hh / 2; g.add(c); }
  } else if (s.form === 'palm') {
    const leaf = mat(s.color, { side: THREE.DoubleSide, roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 1.3, 0.35), leaf);
      f.position.set(Math.cos(i * 0.7) * s.r * 0.55, trunkH + 0.1 - (i % 3) * 0.08, Math.sin(i * 0.7) * s.r * 0.55);
      f.rotation.y = -i * 0.7; f.rotation.z = -0.35 - (i % 2) * 0.15; g.add(f);
    }
  } else {
    // 丸い樹冠：球を重ねる。上は明るく、下は暗く
    const n = 3 + Math.floor(rnd() * 3), top = s.h, ry = (s.h - trunkH) * 0.55;
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1), r = s.r * (0.55 + rnd() * 0.3), ang = rnd() * Math.PI * 2, off = s.r * 0.35 * rnd();
      const col = shade(s.color, 0.85 + rnd() * 0.3);
      const c = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(col, { roughness: 0.95 }));
      c.scale.set(r, r * 0.9, r);
      c.position.set(Math.cos(ang) * off, top - ry - r * 0.2 + (k - 0.5) * ry * 0.6, Math.sin(ang) * off); g.add(c);
    }
    // 枝を2本
    const br = mat('#6f5236');
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, s.r * 0.9, 6), br); b.position.set(0, trunkH + s.r * 0.25, 0); b.rotation.z = (i ? -1 : 1) * 0.8; b.rotation.y = rnd() * Math.PI; g.add(b); }
  }
  g.position.set(s.x, 0, s.z); g.rotation.y = rnd() * Math.PI * 2;
  return g;
}

// 低木：半球を2〜3個重ねる。花木は色の点
function shrub(s: Extract<Solid, { kind: 'shrub' }>, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const kx = 0.6 + rnd() * 0.5, kz = 0.6 + rnd() * 0.5, kh = 0.75 + rnd() * 0.35;
    const c = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(shade(s.color, 0.85 + rnd() * 0.3), { roughness: 0.95 }));
    c.scale.set(s.rx * kx, s.h * kh, s.rz * kz); c.position.set((rnd() - 0.5) * s.rx * 0.6, 0, (rnd() - 0.5) * s.rz * 0.6); g.add(c);
  }
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// 生垣：角を丸めた箱に葉の色。上面は少し明るく
function hedge(s: Extract<Solid, { kind: 'hedge' }>): THREE.Group {
  const g = new THREE.Group();
  const m = mat(s.color, { roughness: 1 });
  const b = box(s.w, s.h, s.d, m, 0, s.h / 2, 0); g.add(b);
  const top = box(s.w * 0.96, 0.08, s.d * 0.96, mat(shade(s.color, 1.15), { roughness: 1 }), 0, s.h + 0.04, 0); g.add(top);
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// 門柱：柱＋笠木、表札・ポスト口・インターホン。機能門柱は細い柱に照明
function gatepost(s: Extract<Solid, { kind: 'gatepost' }>): THREE.Group {
  const g = new THREE.Group();
  const front = s.d / 2 + 0.01;
  if (s.variant === 'func') {
    const body = box(s.w, s.h, s.d, mat('#3f4144', { roughness: 0.5, metalness: 0.4 }), 0, s.h / 2, 0); g.add(body);
    const plate = box(Math.min(0.28, s.w * 0.8), 0.09, 0.01, mat('#f3f1ea'), 0, s.h * 0.82, front); g.add(plate);
    const slot = box(Math.min(0.3, s.w * 0.85), 0.03, 0.01, mat('#1c1d1f'), 0, s.h * 0.6, front); g.add(slot);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff2c8', emissive: '#ffd27a', emissiveIntensity: 0.9 })); lamp.position.set(0, s.h + 0.02, 0); g.add(lamp);
  } else {
    const body = box(s.w, s.h, s.d, wallMaterial('block', '#d8d5cf', s.w, s.h), 0, s.h / 2, 0); g.add(body);
    const cap = box(s.w + 0.06, 0.05, s.d + 0.06, mat('#b8b3aa'), 0, s.h + 0.025, 0); g.add(cap);
    const plate = box(Math.min(0.3, s.w * 0.6), 0.1, 0.012, mat('#f6f4ee'), 0, s.h * 0.78, front); g.add(plate);
    const slot = box(Math.min(0.34, s.w * 0.7), 0.04, 0.012, mat('#2a2b2d'), 0, s.h * 0.55, front); g.add(slot);
    const phone = box(0.09, 0.14, 0.012, mat('#4a4c50'), s.w * 0.25, s.h * 0.68, front); g.add(phone);
  }
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// カーポート：片側2本柱＋梁、少し傾いたポリカ屋根（薄い茶の半透明）＋前後の枠
function carport(s: Extract<Solid, { kind: 'carport' }>): THREE.Group {
  const g = new THREE.Group();
  const post = mat('#6b6d70', { roughness: 0.5, metalness: 0.35 });
  const back = s.d / 2 - 0.25;
  for (const dx of [-1, 1]) g.add(box(0.1, s.h, 0.1, post, dx * (s.w / 2 - 0.12), s.h / 2, back));
  g.add(box(s.w, 0.14, 0.12, post, 0, s.h - 0.07, back)); // 梁
  const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.03, s.d), mat('#bfb4a4', { transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0.1 }));
  roof.position.set(0, s.h + 0.06, 0); roof.rotation.x = 0.045; roof.userData.noShadow = true; g.add(roof);
  for (const dz of [-1, 1]) { const f = box(s.w, 0.07, 0.07, post, 0, s.h + 0.06 + (dz > 0 ? 0 : s.d * 0.045), dz * s.d / 2); g.add(f); }
  for (const dx of [-1, 1]) { const f = box(0.07, 0.07, s.d, post, dx * s.w / 2, s.h + 0.07, 0); f.rotation.x = 0.045; g.add(f); }
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// 物置：本体＋扉の筋＋屋根の庇
function shed(s: Extract<Solid, { kind: 'shed' }>): THREE.Group {
  const g = new THREE.Group();
  g.add(box(s.w, s.h, s.d, mat('#e9e8e3', { roughness: 0.7 }), 0, s.h / 2, 0));
  g.add(box(s.w + 0.1, 0.06, s.d + 0.1, mat('#8e9094'), 0, s.h + 0.03, 0));
  const front = s.d / 2 + 0.006, doorM = mat('#cfcfca');
  for (const dx of [-0.25, 0.25]) g.add(box(s.w * 0.44, s.h * 0.86, 0.01, doorM, dx * s.w, s.h * 0.47, front));
  g.add(box(0.02, s.h * 0.86, 0.012, mat('#7a7c80'), 0, s.h * 0.47, front));
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// 車：側面の輪郭（バンパー→ボンネット→フロントガラス→屋根→リア）を押し出し、窓・タイヤ
function car(s: Extract<Solid, { kind: 'car' }>): THREE.Group {
  const g = new THREE.Group();
  const L = s.d, W = s.w, h0 = 0.28;
  const sh = new THREE.Shape();
  // z を横軸（図面の上＝前）、y を高さに。前が -L/2
  const P: [number, number][] = [[-L / 2, h0], [-L / 2, h0 + 0.5], [-L / 2 + L * 0.2, h0 + 0.62], [-L / 2 + L * 0.36, h0 + 1.18], [L / 2 - L * 0.22, h0 + 1.22], [L / 2 - L * 0.05, h0 + 0.78], [L / 2, h0 + 0.62], [L / 2, h0]];
  sh.moveTo(P[0][0], P[0][1]); for (const [z, y] of P.slice(1)) sh.lineTo(z, y); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  const body = new THREE.Mesh(geo, mat(s.color, { roughness: 0.35, metalness: 0.25 }));
  // 回転で shape の x（長さ）が世界の z に、押し出し（0..W）が世界の -x になる。中央に寄せる
  body.rotation.y = -Math.PI / 2; body.position.x = W / 2 - 0.05; g.add(body);
  // 窓（暗いガラス）：客室部分に薄い箱
  const glass = mat('#2d3b48', { roughness: 0.2, metalness: 0.5 });
  g.add(box(W + 0.12, 0.34, L * 0.4, glass, 0, h0 + 0.98, L * 0.04)); // 窓の帯（車体より少し外に出して見せる）
  for (const dx of [-1, 1]) for (const dz of [-0.31, 0.31]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 16), mat('#1f2022', { roughness: 0.9 }));
    t.rotation.z = Math.PI / 2; t.position.set(dx * (W / 2 - 0.1), 0.31, dz * L); g.add(t);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.23, 12), mat('#b9bcc0', { metalness: 0.6, roughness: 0.3 }));
    hub.rotation.z = Math.PI / 2; hub.position.copy(t.position); g.add(hub);
  }
  g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot);
  return g;
}

// 照明：ポールライト／スポット。灯具は少し光る
function light(s: Extract<Solid, { kind: 'light' }>): THREE.Group {
  const g = new THREE.Group();
  const pole = mat('#3a3c3f', { roughness: 0.5, metalness: 0.3 });
  g.add(box(s.kind2 === 'pole' ? 0.07 : 0.05, s.h, s.kind2 === 'pole' ? 0.07 : 0.05, pole, 0, s.h / 2, 0));
  const head = new THREE.Mesh(s.kind2 === 'pole' ? new THREE.BoxGeometry(0.11, 0.14, 0.11) : new THREE.CylinderGeometry(0.05, 0.035, 0.12, 10), new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd58a', emissiveIntensity: 0.8 }));
  head.position.y = s.h + 0.06; if (s.kind2 !== 'pole') head.rotation.x = 0.9; g.add(head);
  g.position.set(s.x, 0, s.z);
  return g;
}

export function partObject(s: Solid): THREE.Object3D | null {
  const rnd = seeded(s.src);
  let g: THREE.Object3D;
  switch (s.kind) {
    case 'wall': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + s.t, s.h, s.t), wallMaterial(s.mat ?? 'plaster', s.color, len, s.h));
      m.position.set((s.a.x + s.b.x) / 2, s.h / 2, (s.a.z + s.b.z) / 2); m.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x); g.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + s.t + 0.04, 0.04, s.t + 0.04), mat(s.mat === 'alumi' ? '#4a4d50' : '#c9c4ba'));
      cap.position.set((s.a.x + s.b.x) / 2, s.h + 0.02, (s.a.z + s.b.z) / 2); cap.rotation.y = m.rotation.y; g.add(cap);
      break;
    }
    case 'fence': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, s.base, 0.15), wallMaterial('block', '#cbc7bf', len, s.base)); base.position.y = s.base / 2; g.add(base);
      const n = Math.max(1, Math.ceil(len / 2)), postM = mat('#3f3b38', { roughness: 0.5, metalness: 0.3 }), slatM = mat('#6b4f3a');
      for (let i = 0; i <= n; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, s.h - s.base, 0.06), postM); p.position.set(-len / 2 + len * i / n, s.base + (s.h - s.base) / 2, 0); g.add(p); }
      if (s.mat === 'mesh') {
        const net = new THREE.Mesh(new THREE.PlaneGeometry(len, s.h - s.base), meshFenceMaterial(len, s.h - s.base)); net.position.set(0, s.base + (s.h - s.base) / 2, 0); g.add(net);
        for (const y of [s.base + 0.03, s.h - 0.03]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), postM); r.position.set(0, y, 0); g.add(r); }
      } else if (s.mat === 'lattice') {
        const bars = Math.max(2, Math.floor(len / 0.06)), barM = mat('#4a4d50', { roughness: 0.5, metalness: 0.3 });
        for (let j = 0; j <= bars; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, s.h - s.base - 0.05, 0.02), barM); b.position.set(-len / 2 + len * j / bars, s.base + (s.h - s.base) / 2, 0); g.add(b); }
        for (const y of [s.base + 0.03, s.h - 0.03]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.04), barM); r.position.set(0, y, 0); g.add(r); }
      } else {
        const rows = Math.max(1, Math.floor((s.h - s.base) / 0.12));
        for (let j = 0; j < rows; j++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.02), slatM); sl.position.set(0, s.base + 0.06 + j * (s.h - s.base - 0.06) / rows, 0.04); g.add(sl); }
      }
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2); g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      break;
    }
    case 'gate': {
      g = new THREE.Group();
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), frameM = mat('#3d3a37', { roughness: 0.5, metalness: 0.3 });
      for (const x of [-len / 2, len / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, s.h + 0.1, 0.12), frameM); p.position.set(x, (s.h + 0.1) / 2, 0); g.add(p); }
      const leaves = len > 1.4 ? 2 : 1, lw = (len - 0.16) / leaves;
      for (let i = 0; i < leaves; i++) {
        const leaf = new THREE.Group(), y0 = 0.08, lh = s.h - 0.12;
        for (const [w, h, x, y] of [[lw, 0.04, 0, y0], [lw, 0.04, 0, y0 + lh], [0.04, lh, -lw / 2, y0 + lh / 2], [0.04, lh, lw / 2, y0 + lh / 2]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frameM); b.position.set(x, y, 0); leaf.add(b); }
        const bars = Math.max(2, Math.floor(lw / 0.11));
        for (let j = 1; j < bars; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, lh, 0.02), frameM); b.position.set(-lw / 2 + lw * j / bars, y0 + lh / 2, 0); leaf.add(b); }
        leaf.position.x = -len / 2 + 0.08 + lw * (i + 0.5); g.add(leaf);
      }
      g.position.set((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2); g.rotation.y = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      break;
    }
    case 'tree': g = tree(s, rnd); break;
    case 'shrub': g = shrub(s, rnd); break;
    case 'hedge': g = hedge(s); break;
    case 'gatepost': g = gatepost(s); break;
    case 'carport': g = carport(s); break;
    case 'shed': g = shed(s); break;
    case 'car': g = car(s); break;
    case 'light': g = light(s); break;
    case 'stone': {
      g = new THREE.Group();
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), mat('#9e998f', { flatShading: true, roughness: 1 }));
      c.scale.set(s.rx, s.h, s.rz); c.position.y = s.h * 0.45; c.rotation.y = rnd() * Math.PI; g.add(c);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'box': {
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mat(s.color)); m.position.y = (s.y0 ?? 0) + s.h / 2; g.add(m);
      g.position.set(s.x, 0, s.z); g.rotation.y = -rad(s.rot); break;
    }
    case 'cylinder': {
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.h, 18), mat(s.color)); m.position.y = s.h / 2; g.add(m); g.position.set(s.x, 0, s.z); break;
    }
    case 'person': {
      g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, s.h - 0.62, 4, 10), mat(s.color)); body.position.y = (s.h - 0.26) / 2; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), mat('#e8c9a8')); head.position.y = s.h - 0.12; g.add(head);
      g.position.set(s.x, 0, s.z); break;
    }
    default: return null;
  }
  g.userData.src = s.src;
  return shadowed(g);
}

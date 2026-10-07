// 標準の登録オブジェクト（平面図記号）。寸法は図面px（1px=10mm）。線は currentColor で色替えできる。
import { type LibItem } from './types';
import { rng } from './textures';

export const CATEGORIES = ['未分類', '植栽', '乗り物', 'カーポート', '照明', 'その他', 'ガーデンファニチャー', '下草', '低木', '景石', 'キャラクター'];

const f = (v: number) => Math.round(v * 10) / 10;
const LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

function item(id: string, name: string, cat: string, vw: number, vh: number, svg: string, tint = true): LibItem {
  return { id: 'b-' + id, name, cat, w: vw, h: vh, vw, vh, svg, builtin: true, tint };
}

// ---------- 乗り物 ----------
type CarKind = 'sedan' | 'hatch' | 'suv' | 'kei';
function car(id: string, name: string, wmm: number, hmm: number, kind: CarKind): LibItem {
  const W = wmm / 10, H = hmm / 10, m = W * 0.07, vw = W + 2 * m, vh = H;
  const p = (x: number, y: number) => `${f(m + x * W)} ${f(y * H)}`;
  const hood = kind === 'hatch' || kind === 'kei' ? 0.26 : 0.31;
  const roofEnd = kind === 'suv' ? 0.8 : kind === 'kei' ? 0.83 : kind === 'hatch' ? 0.78 : 0.72;
  const sw = 2.1;
  let s = `<g ${LINE} stroke-width="${sw}">`;
  s += `<path fill="#fff" d="M${p(0.1, 0.035)}C${p(0.3, -0.004)} ${p(0.7, -0.004)} ${p(0.9, 0.035)}C${p(0.97, 0.06)} ${p(0.995, 0.12)} ${p(0.995, 0.2)}L${p(0.995, 0.86)}C${p(0.995, 0.95)} ${p(0.93, 0.997)} ${p(0.5, 0.997)}C${p(0.07, 0.997)} ${p(0.005, 0.95)} ${p(0.005, 0.86)}L${p(0.005, 0.2)}C${p(0.005, 0.12)} ${p(0.03, 0.06)} ${p(0.1, 0.035)}Z"/>`;
  // フロントガラス・屋根・リアガラス
  s += `<path d="M${p(0.13, hood)}C${p(0.35, hood - 0.026)} ${p(0.65, hood - 0.026)} ${p(0.87, hood)}L${p(0.8, hood + 0.1)}C${p(0.6, hood + 0.086)} ${p(0.4, hood + 0.086)} ${p(0.2, hood + 0.1)}Z"/>`;
  s += `<path stroke-width="${sw * 0.5}" d="M${p(0.18, hood + 0.012)}C${p(0.4, hood - 0.008)} ${p(0.6, hood - 0.008)} ${p(0.82, hood + 0.012)}"/>`;
  s += `<rect x="${f(m + 0.2 * W)}" y="${f((hood + 0.11) * H)}" width="${f(0.6 * W)}" height="${f((roofEnd - hood - 0.11) * H)}" rx="${f(0.07 * W)}"/>`;
  s += `<path d="M${p(0.19, roofEnd + 0.012)}L${p(0.81, roofEnd + 0.012)}L${p(0.86, roofEnd + 0.085)}C${p(0.62, roofEnd + 0.1)} ${p(0.38, roofEnd + 0.1)} ${p(0.14, roofEnd + 0.085)}Z"/>`;
  // サイドウィンドウ・ドア
  for (const side of [0, 1]) {
    const x = (v: number) => side ? 1 - v : v;
    s += `<path d="M${p(x(0.08), hood + 0.02)}L${p(x(0.15), hood + 0.115)}L${p(x(0.15), roofEnd)}L${p(x(0.09), roofEnd + 0.075)}"/>`;
    s += `<path stroke-width="${sw * 0.6}" d="M${p(x(0.03), 0.47)}L${p(x(0.1), 0.47)}M${p(x(0.03), kind === 'kei' ? 0.66 : 0.62)}L${p(x(0.08), kind === 'kei' ? 0.66 : 0.62)}"/>`;
    s += `<path stroke-width="${sw * 0.6}" d="M${p(x(0.24), 0.05)}C${p(x(0.29), 0.14)} ${p(x(0.29), 0.21)} ${p(x(0.27), hood - 0.02)}"/>`;
    s += `<path d="M${p(x(0.05), 0.075)}C${p(x(0.12), 0.05)} ${p(x(0.2), 0.048)} ${p(x(0.27), 0.052)}"/>`;
    s += `<path fill="#fff" d="M${p(x(0.005), hood + 0.015)}L${p(x(-0.06), hood + 0.03)}Q${p(x(-0.075), hood + 0.06)} ${p(x(-0.04), hood + 0.064)}L${p(x(0.005), hood + 0.058)}"/>`;
    s += `<path d="M${p(x(0.06), 0.955)}L${p(x(0.2), 0.975)}"/>`;
    if (kind === 'suv') s += `<path stroke-width="${sw * 0.8}" d="M${p(x(0.24), hood + 0.13)}L${p(x(0.24), roofEnd - 0.02)}"/>`;
  }
  s += `<path stroke-width="${sw * 0.6}" d="M${p(0.42, 0.012)}L${p(0.58, 0.012)}"/>`;
  s += '</g>';
  return item(id, name, '乗り物', vw, vh, s);
}

function bicycle(id: string, name: string): LibItem {
  const W = 41, H = 182; let s = `<g ${LINE} stroke-width="1.7">`;
  s += `<rect x="${W / 2 - 2.6}" y="1" width="5.2" height="62" rx="2.6" fill="#fff"/><rect x="${W / 2 - 2.6}" y="${H - 63}" width="5.2" height="62" rx="2.6" fill="#fff"/>`;
  s += `<path d="M${W / 2} 62L${W / 2} ${H - 62}"/>`;
  s += `<path stroke-width="1.6" d="M2 40L${W - 2} 40"/><path stroke-width="3.2" d="M2 40L7 40M${W - 7} 40L${W - 2} 40"/>`;
  s += `<rect x="9" y="8" width="${W - 18}" height="24" rx="2" fill="#fff"/><path stroke-width="0.6" d="M9 16L${W - 9} 16M9 24L${W - 9} 24M${W / 2} 8L${W / 2} 32"/>`;
  s += `<path fill="#fff" d="M${W / 2 - 5} 112C${W / 2 - 6} 100 ${W / 2 + 6} 100 ${W / 2 + 5} 112L${W / 2 + 3} 126L${W / 2 - 3} 126Z"/>`;
  s += `<path d="M8 92L${W - 8} 92"/><rect x="5" y="89" width="6" height="6" rx="1"/><rect x="${W - 11}" y="89" width="6" height="6" rx="1"/>`;
  s += `<rect x="${W / 2 - 9}" y="${H - 52}" width="18" height="30" rx="2" stroke-width="0.8"/>`;
  return item(id, name, '乗り物', W, H, s + '</g>');
}

function motorbike(id: string, name: string, W: number, H: number, scooter = false): LibItem {
  let s = `<g ${LINE} stroke-width="1.8">`;
  s += `<rect x="${W / 2 - 4.5}" y="1" width="9" height="${H * 0.28}" rx="4.5" fill="#fff"/><rect x="${W / 2 - 5}" y="${H * 0.7}" width="10" height="${H * 0.29}" rx="5" fill="#fff"/>`;
  s += `<path fill="#fff" d="M${W / 2 - (scooter ? 15 : 13)} ${H * 0.3}C${W / 2 - 16} ${H * 0.5} ${W / 2 - 14} ${H * 0.72} ${W / 2} ${H * 0.76}C${W / 2 + 14} ${H * 0.72} ${W / 2 + 16} ${H * 0.5} ${W / 2 + (scooter ? 15 : 13)} ${H * 0.3}Z"/>`;
  s += `<path stroke-width="1.8" d="M3 ${H * 0.24}L${W - 3} ${H * 0.24}"/><circle cx="6" cy="${H * 0.2}" r="3"/><circle cx="${W - 6}" cy="${H * 0.2}" r="3"/>`;
  s += scooter ? `<rect x="${W / 2 - 9}" y="${H * 0.36}" width="18" height="${H * 0.16}" rx="2" stroke-width="0.7"/>` : `<ellipse cx="${W / 2}" cy="${H * 0.38}" rx="10" ry="${H * 0.07}" fill="#fff"/>`;
  s += `<path fill="#fff" d="M${W / 2 - 8} ${H * 0.48}L${W / 2 + 8} ${H * 0.48}L${W / 2 + 7} ${H * 0.7}L${W / 2 - 7} ${H * 0.7}Z"/>`;
  return item(id, name, '乗り物', W, H, s + '</g>');
}

// ---------- 植栽 ----------
const LEAF_PALETTES = {
  light: ['#a8c98a', '#bcd79c', '#93b977', '#cfe2b6', '#85ad66'],
  mid: ['#6f9d4f', '#86b262', '#5d8a40', '#9cc178', '#4f7c37'],
  dark: ['#4e7a3a', '#5e8b45', '#3f6a2f', '#6f9a52', '#375f2a'],
  june: ['#7ea86b', '#99bf83', '#6a955a', '#b4d39f'],
};

function leafPath(x: number, y: number, len: number, wid: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (u: number, v: number) => `${f(x + u * c - v * s)} ${f(y + u * s + v * c)}`;
  return `M${P(0, 0)}Q${P(len * 0.5, -wid)} ${P(len, 0)}Q${P(len * 0.5, wid)} ${P(0, 0)}Z`;
}

function broadleaf(id: string, name: string, cat: string, size: number, seed: number, pal: string[], opts: { star?: boolean; density?: number; leaf?: number; alpha?: number } = {}): LibItem {
  const r = rng(seed), R = size / 2, cx = R, cy = R, count = Math.round((opts.density ?? 1) * Math.min(200, 40 + size * 0.9));
  let s = '';
  // 葉の塊（クラスター）を数か所に置き、その周りに葉を散らす
  const clusters = Array.from({ length: 6 + Math.floor(r() * 4) }, () => { const a = r() * Math.PI * 2, d = R * (0.15 + r() * 0.55); return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d }; });
  clusters.push({ x: cx, y: cy });
  const op = opts.alpha ?? 0.88;
  for (let i = 0; i < count; i++) {
    const cl = clusters[Math.floor(r() * clusters.length)], a = r() * Math.PI * 2, d = R * 0.42 * Math.sqrt(r());
    let x = cl.x + Math.cos(a) * d, y = cl.y + Math.sin(a) * d;
    const dd = Math.hypot(x - cx, y - cy); if (dd > R * 0.93) { x = cx + (x - cx) * R * 0.93 / dd; y = cy + (y - cy) * R * 0.93 / dd; }
    const len = R * (opts.leaf ?? 0.2) * (0.7 + r() * 0.6), ang = Math.atan2(y - cy, x - cx) + (r() - 0.5) * 1.6;
    const col = pal[Math.floor(r() * pal.length)];
    s += `<path d="${leafPath(x - Math.cos(ang) * len / 2, y - Math.sin(ang) * len / 2, len, len * 0.32, ang)}" fill="${col}" fill-opacity="${op}" stroke="#4d7536" stroke-opacity="0.55" stroke-width="${f(Math.max(0.3, R * 0.008))}"/>`;
  }
  if (opts.star) {
    const n = 6 + Math.floor(r() * 3);
    let d = '';
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r() * 0.4, l = R * (0.35 + r() * 0.25); d += `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a) * l)} ${f(cy + Math.sin(a) * l)}`; const b = a + 0.5, l2 = l * 0.55; d += `M${f(cx + Math.cos(a) * l * 0.5)} ${f(cy + Math.sin(a) * l * 0.5)}L${f(cx + Math.cos(b) * l2)} ${f(cy + Math.sin(b) * l2)}`; }
    s += `<path d="${d}" stroke="#fff" stroke-opacity="0.85" stroke-width="${f(R * 0.035)}" stroke-linecap="round" fill="none"/><path d="${d}" stroke="#7d8f73" stroke-opacity="0.6" stroke-width="${f(R * 0.01)}" fill="none"/>`;
  }
  return item(id, name, cat, size, size, s, false);
}

function radiating(id: string, name: string, cat: string, size: number, seed: number, kind: 'palm' | 'agave' | 'grass' | 'tuft' | 'conifer'): LibItem {
  const r = rng(seed), R = size / 2, cx = R, cy = R; let s = '';
  if (kind === 'palm') {
    const n = 9 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3, l = R * (0.8 + r() * 0.18), ex = cx + Math.cos(a) * l, ey = cy + Math.sin(a) * l;
      let d = `M${f(cx)} ${f(cy)}L${f(ex)} ${f(ey)}`;
      for (let k = 2; k < 14; k++) { const t = k / 14, px = cx + Math.cos(a) * l * t, py = cy + Math.sin(a) * l * t, w = R * 0.16 * Math.sin(Math.PI * t); for (const sg of [-1, 1]) d += `M${f(px)} ${f(py)}L${f(px + Math.cos(a + sg * 1.1) * w)} ${f(py + Math.sin(a + sg * 1.1) * w)}`; }
      s += `<path d="${d}" stroke="${['#5e8f45', '#7aa85a', '#4c7a37'][i % 3]}" stroke-width="${f(R * 0.025)}" fill="none" stroke-linecap="round"/>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="${f(R * 0.08)}" fill="#8a6c4c"/>`;
  } else if (kind === 'agave') {
    const n = 14;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r() * 0.2, l = R * (0.7 + r() * 0.28); s += `<path d="${leafPath(cx, cy, l, l * 0.17, a)}" fill="${['#87aaa3', '#9cbcb4', '#739790'][i % 3]}" stroke="#4f716b" stroke-width="${f(R * 0.015)}"/>`; }
  } else if (kind === 'conifer') {
    for (let ring = 0; ring < 3; ring++) { const n = 12 - ring * 3, l = R * (0.95 - ring * 0.28); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + ring * 0.3; s += `<path d="${leafPath(cx, cy, l, l * 0.22, a)}" fill="${['#4d7a46', '#5f8d55', '#6e9c62'][ring]}" stroke="#355a30" stroke-width="${f(R * 0.012)}"/>`; } }
  } else {
    const n = kind === 'grass' ? 40 : 26;
    let d = '';
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, l = R * (0.55 + r() * 0.45), bend = (r() - 0.5) * 0.8; const mx = cx + Math.cos(a) * l * 0.5 + Math.cos(a + 1.57) * l * bend * 0.3, my = cy + Math.sin(a) * l * 0.5 + Math.sin(a + 1.57) * l * bend * 0.3; d += `M${f(cx)} ${f(cy)}Q${f(mx)} ${f(my)} ${f(cx + Math.cos(a + bend * 0.4) * l)} ${f(cy + Math.sin(a + bend * 0.4) * l)}`; }
    s += `<path d="${d}" stroke="${kind === 'grass' ? '#8aa55a' : '#5f8c43'}" stroke-width="${f(R * 0.03)}" fill="none" stroke-linecap="round"/>`;
    if (kind === 'tuft') s += `<circle cx="${cx}" cy="${cy}" r="${f(R * 0.15)}" fill="#7da35a" fill-opacity="0.7"/>`;
  }
  return item(id, name, cat, size, size, s, false);
}

function stone(id: string, name: string, w: number, h: number, seed: number): LibItem {
  const r = rng(seed), n = 9, cx = w / 2, cy = h / 2; let d = '';
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, k = 0.78 + r() * 0.2; d += (i ? 'L' : 'M') + `${f(cx + Math.cos(a) * w / 2 * k)} ${f(cy + Math.sin(a) * h / 2 * k)}`; }
  const crack = `M${f(cx - w * 0.2)} ${f(cy - h * 0.1)}L${f(cx)} ${f(cy + h * 0.05)}L${f(cx + w * 0.15)} ${f(cy - h * 0.12)}`;
  return item(id, name, '景石', w, h, `<path d="${d}Z" fill="#c2c0b9" stroke="#4f4d48" stroke-width="1.2" stroke-linejoin="round"/><path d="${crack}" stroke="#77746c" stroke-width="0.8" fill="none"/><path d="${d}Z" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="0.6" transform="translate(${f(w * 0.06)} ${f(h * 0.06)}) scale(0.88)"/>`, false);
}

// ---------- ガーデンファニチャー ----------
function chair(id: string, name: string, dark: string, light: string, size = 55, diamond = false): LibItem {
  const s = size; let g = `<g transform="${diamond ? `rotate(45 ${s / 2} ${s / 2}) ` : ''}">`;
  const inset = diamond ? s * 0.15 : s * 0.04, w = s - inset * 2;
  g += `<rect x="${inset}" y="${inset}" width="${w}" height="${w}" rx="${f(w * 0.18)}" fill="${dark}"/>`;
  let d = ''; for (let i = 1; i < 7; i++) { const y = inset + (w * i) / 7; d += `M${f(inset + w * 0.1)} ${f(y)}L${f(inset + w * 0.9)} ${f(y)}`; }
  g += `<path d="${d}" stroke="${light}" stroke-width="${f(w * 0.045)}" stroke-linecap="round"/>`;
  g += `<rect x="${inset}" y="${inset}" width="${w}" height="${f(w * 0.2)}" rx="${f(w * 0.1)}" fill="${dark}"/>`;
  return item(id, name, 'ガーデンファニチャー', s, s, g + '</g>', false);
}
function roundTable(id: string, name: string, size: number, fill: string, ring?: string): LibItem {
  const R = size / 2; let s = `<circle cx="${R}" cy="${R}" r="${f(R * 0.97)}" fill="${fill}"/>`;
  if (ring) s += `<circle cx="${R}" cy="${R}" r="${f(R * 0.7)}" fill="none" stroke="${ring}" stroke-width="${f(R * 0.04)}"/><circle cx="${R}" cy="${R}" r="${f(R * 0.4)}" fill="none" stroke="${ring}" stroke-width="${f(R * 0.03)}"/>`;
  return item(id, name, 'ガーデンファニチャー', size, size, s, false);
}
function planter(id: string, name: string, w: number, h: number): LibItem {
  const s = w === h
    ? `<circle cx="${w / 2}" cy="${h / 2}" r="${f(w * 0.47)}" fill="#fff" stroke="#3a3a3a" stroke-width="1.2"/><circle cx="${w / 2}" cy="${h / 2}" r="${f(w * 0.33)}" fill="#f2f2ef" stroke="#3a3a3a" stroke-width="0.8"/>`
    : `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${f(h * 0.4)}" fill="#fff" stroke="#3a3a3a" stroke-width="1.2"/><rect x="${f(h * 0.25)}" y="${f(h * 0.25)}" width="${f(w - h * 0.5)}" height="${f(h * 0.5)}" rx="${f(h * 0.22)}" fill="#f2f2ef" stroke="#3a3a3a" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  return item(id, name, 'ガーデンファニチャー', w, h, s, false);
}

function tableSet(): LibItem {
  const S = 200, c = S / 2; let s = `<circle cx="${c}" cy="${c}" r="42" fill="#1f1f1f"/>`;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, x = c + Math.cos(a) * 70, y = c + Math.sin(a) * 70;
    s += `<g transform="rotate(${i * 90 + 90} ${f(x)} ${f(y)})"><rect x="${f(x - 24)}" y="${f(y - 22)}" width="48" height="44" rx="9" fill="#4b4b4b"/><path d="M${f(x - 18)} ${f(y - 8)}L${f(x + 18)} ${f(y - 8)}M${f(x - 18)} ${f(y + 2)}L${f(x + 18)} ${f(y + 2)}M${f(x - 18)} ${f(y + 12)}L${f(x + 18)} ${f(y + 12)}" stroke="#8a8a8a" stroke-width="2.4" stroke-linecap="round"/></g>`;
  }
  return item('tableset', 'テーブルセット', 'ガーデンファニチャー', S, S, s, false);
}

function person(id: string, name: string, color: string, seed: number): LibItem {
  const r = rng(seed), W = 56, H = 40, tilt = (r() - 0.5) * 10;
  const s = `<g transform="rotate(${f(tilt)} 28 20)"><ellipse cx="28" cy="22" rx="25" ry="13" fill="${color}" stroke="#2c2c2c" stroke-width="1"/><circle cx="28" cy="19" r="10" fill="#3b2f2a" stroke="#2c2c2c" stroke-width="0.8"/></g>`;
  return item(id, name, 'キャラクター', W, H, s, false);
}

function carport(id: string, name: string, w: number, h: number): LibItem {
  let s = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#dfe8ec" fill-opacity="0.35" stroke="currentColor" stroke-width="1.3"/>`;
  let d = ''; for (let i = 1; i < 8; i++) { const y = (h * i) / 8; d += `M3 ${f(y)}L${w - 3} ${f(y)}`; }
  s += `<path d="${d}" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>`;
  for (const [x, y] of [[8, 14], [w - 8, 14], [8, h - 14], [w - 8, h - 14]]) s += `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="currentColor"/>`;
  return item(id, name, 'カーポート', w, h, s);
}

function misc(): LibItem[] {
  const out: LibItem[] = [];
  out.push(item('gatepost', '門柱 1200', '未分類', 120, 24, `<rect x="1" y="1" width="118" height="22" fill="#d8d5cf" stroke="currentColor" stroke-width="1.2"/><rect x="88" y="6" width="22" height="12" fill="#fff" stroke="currentColor" stroke-width="0.8"/>`));
  out.push(item('funcpost', '機能門柱', '未分類', 50, 22, `<rect x="1" y="1" width="48" height="20" rx="2" fill="#4c4c4c" stroke="currentColor" stroke-width="1"/><rect x="8" y="6" width="14" height="10" fill="#fff"/><circle cx="36" cy="11" r="4" fill="#fff"/>`));
  out.push(item('faucet', '立水栓', '未分類', 22, 22, `<rect x="2" y="2" width="18" height="18" fill="#bfb9ad" stroke="currentColor" stroke-width="1"/><circle cx="11" cy="11" r="4" fill="#fff" stroke="currentColor" stroke-width="0.8"/>`));
  out.push(item('ac', '室外機', '未分類', 80, 30, `<rect x="1" y="1" width="78" height="28" fill="#fff" stroke="currentColor" stroke-width="1.2"/><circle cx="28" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="0.8"/><path d="M50 7L72 7M50 12L72 12M50 17L72 17M50 22L72 22" stroke="currentColor" stroke-width="0.6"/>`));
  out.push(item('meter', '量水器', '未分類', 30, 20, `<rect x="1" y="1" width="28" height="18" fill="#fff" stroke="currentColor" stroke-width="1"/><path d="M1 1L29 19M29 1L1 19" stroke="currentColor" stroke-width="0.6"/>`));
  out.push(item('shed', '物置 2000×900', 'その他', 200, 90, `<rect x="1" y="1" width="198" height="88" fill="#efefec" stroke="currentColor" stroke-width="1.3"/><path d="M1 1L199 89M199 1L1 89" stroke="currentColor" stroke-width="0.5"/>`));
  out.push(item('cycleport', 'サイクルポート', 'その他', 220, 200, `<rect x="1" y="1" width="218" height="198" fill="#e3ecef" fill-opacity="0.35" stroke="currentColor" stroke-width="1.3"/><path d="M1 40L219 40" stroke="currentColor" stroke-width="0.6" stroke-dasharray="4 3"/><rect x="4" y="4" width="9" height="9" fill="currentColor"/><rect x="207" y="4" width="9" height="9" fill="currentColor"/>`));
  out.push(item('dryer', '物干し', 'その他', 180, 40, `<path d="M8 20L172 20M8 12L8 28M172 12L172 28" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="0.8"/><rect x="166" y="14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="0.8"/>`));
  out.push(item('bench', 'ベンチ', 'その他', 150, 45, `<rect x="1" y="1" width="148" height="43" rx="3" fill="#c79f72" stroke="currentColor" stroke-width="1.1"/><path d="M4 12L146 12M4 22L146 22M4 32L146 32" stroke="#8a6640" stroke-width="0.8"/>`, false));
  out.push(item('light1', 'ポールライト', '照明', 26, 26, `<circle cx="13" cy="13" r="12" fill="#fff6c8" fill-opacity="0.6" stroke="#c7a43a" stroke-width="0.6"/><circle cx="13" cy="13" r="5" fill="#fff" stroke="currentColor" stroke-width="1.2"/><path d="M13 6L13 20M6 13L20 13" stroke="currentColor" stroke-width="0.8"/>`, false));
  out.push(item('light2', 'スポットライト', '照明', 40, 40, `<path d="M20 20L38 8A22 22 0 0 1 38 32Z" fill="#fff3b0" fill-opacity="0.55"/><circle cx="20" cy="20" r="5" fill="#fff" stroke="currentColor" stroke-width="1.2"/>`, false));
  return out;
}

let built: LibItem[] | null = null;
export function builtinLibrary(): LibItem[] {
  if (built) return built;
  const L: LibItem[] = [];
  L.push(motorbike('moped', '原動機付き自転車', 66, 176, true));
  L.push(car('car4900', '普通車1800×4900', 1800, 4900, 'sedan'));
  L.push(car('vezel', 'ヴェゼル', 1790, 4330, 'suv'));
  L.push(car('polo', 'POLO', 1750, 4085, 'hatch'));
  L.push(car('car4300', '普通車1800×4300', 1800, 4300, 'hatch'));
  L.push(motorbike('bike', '中型バイク', 80, 210));
  L.push(car('aqua', 'アクア（自動車）', 1695, 4050, 'hatch'));
  L.push(car('kei3500', '軽自動車1490×3500', 1490, 3500, 'kei'));
  L.push(car('car4600', '普通車1800×4600', 1800, 4600, 'sedan'));
  L.push(bicycle('bicycle', '自転車 1820×410'));
  L.push(car('kei3300', '軽自動車1490×3300', 1490, 3300, 'kei'));
  // 植栽（高木・中木）
  L.push(broadleaf('tree-top', '自然樹形の樹木上から', '植栽', 340, 11, LEAF_PALETTES.light, { star: true, density: 1.5, alpha: 0.8, leaf: 0.17 }));
  L.push(broadleaf('aodamo', 'アオダモ', '植栽', 220, 21, LEAF_PALETTES.mid, { density: 1.1 }));
  L.push(broadleaf('june', 'ジューンベリー', '植栽', 200, 31, LEAF_PALETTES.june, { density: 1.1 }));
  L.push(broadleaf('june2', 'ジューンベリーの樹冠', '植栽', 240, 37, LEAF_PALETTES.mid, { star: true }));
  L.push(broadleaf('ego', 'エゴノキ', '植栽', 230, 41, LEAF_PALETTES.light, { density: 1.3 }));
  L.push(broadleaf('shara', 'シャラ', '植栽', 210, 51, LEAF_PALETTES.mid, { leaf: 0.24 }));
  L.push(broadleaf('momiji', 'ヤマモミジ', '植栽', 250, 61, ['#9fbf6a', '#b6d07f', '#88aa58', '#c6d98f'], { leaf: 0.16, density: 1.3 }));
  L.push(broadleaf('oak', 'シマトネリコ', '植栽', 270, 71, LEAF_PALETTES.light, { leaf: 0.13, density: 1.4, star: true }));
  L.push(broadleaf('olive', 'オリーブ', '植栽', 200, 81, ['#9bb08f', '#b1c4a6', '#86a07a', '#c4d3ba'], { leaf: 0.17, density: 1.3 }));
  L.push(broadleaf('chuboku1', '中木1', '植栽', 160, 91, LEAF_PALETTES.mid));
  L.push(broadleaf('chuboku2', '中木2', '植栽', 150, 97, LEAF_PALETTES.light));
  L.push(radiating('palm', 'ヤシ', '植栽', 260, 101, 'palm'));
  L.push(radiating('conifer', 'コニファー', '植栽', 120, 111, 'conifer'));
  L.push(radiating('agave', 'アガベ', '植栽', 110, 121, 'agave'));
  // 低木
  for (let i = 1; i <= 6; i++) L.push(broadleaf('teiboku' + i, '低木' + i, '低木', 70 + i * 8, 200 + i * 7, i % 2 ? LEAF_PALETTES.dark : LEAF_PALETTES.mid, { leaf: 0.22, density: 0.9 }));
  L.push(broadleaf('tsutsuji', 'ツツジ', '低木', 90, 251, ['#5f8b45', '#6f9b52', '#e08ab1', '#4d7a37'], { leaf: 0.2 }));
  L.push(broadleaf('ajisai', 'アジサイ', '低木', 100, 257, ['#6f9b52', '#8fb4e0', '#a7c1ea', '#5d8a40'], { leaf: 0.22 }));
  L.push(radiating('boxwood', 'ツゲ玉', '低木', 80, 263, 'conifer'));
  // 下草
  for (let i = 1; i <= 5; i++) L.push(radiating('shitakusa' + i, '下草' + i, '下草', 40 + i * 6, 300 + i * 5, i % 2 ? 'tuft' : 'grass'));
  L.push(radiating('grass1', 'グラス1', '下草', 70, 331, 'grass'));
  L.push(radiating('grass2', 'グラス2', '下草', 90, 337, 'grass'));
  L.push(broadleaf('hosta', 'ギボウシ', '下草', 60, 341, ['#7aa35c', '#9fc27f', '#c9dcae'], { leaf: 0.38, density: 0.4 }));
  L.push(broadleaf('fukkiso', 'フッキソウ', '下草', 55, 347, LEAF_PALETTES.dark, { leaf: 0.3, density: 0.6 }));
  L.push(radiating('ryunohige', 'リュウノヒゲ', '下草', 45, 353, 'tuft'));
  L.push(radiating('agave2', 'アガベ（小）', '下草', 60, 359, 'agave'));
  // 景石
  L.push(stone('stone1', '景石1', 90, 70, 401));
  L.push(stone('stone2', '景石2', 130, 90, 409));
  L.push(stone('stone3', '景石3', 60, 50, 417));
  // カーポート
  L.push(carport('carport1', 'カーポート 1台用', 270, 500));
  L.push(carport('carport2', 'カーポート 2台用', 540, 500));
  // ガーデンファニチャー
  L.push(chair('chair', '椅子', '#4a4a4a', '#8c8c8c'));
  L.push(roundTable('table', 'テーブル', 80, '#1d1d1d'));
  L.push(tableSet());
  L.push(roundTable('bico', 'HOUSEビコカフェテーブル', 60, '#232323', '#4b4b4b'));
  L.push(planter('cobble', 'コブルプランター', 60, 60));
  L.push(planter('cobblebench', 'コブルベンチプランター', 130, 46));
  L.push(roundTable('housetable', 'HOUSEテーブル', 90, '#b8875a', '#9a6c42'));
  L.push(chair('clickchair', 'HOUSEクリックダイニングチェア アノーアーム', '#3d3d3d', '#7a7a7a', 60, true));
  L.push(roundTable('circletable', 'HOUSEサークルテーブル', 100, '#5a5a5a', '#9a9a9a'));
  // キャラクター
  ['#d9534f', '#3f7fbf', '#e0a43a', '#5aa36c', '#8e6cc0', '#e98aa7', '#6b6b6b'].forEach((c, i) => L.push(person('person' + i, ['大人（赤）', '大人（青）', '大人（黄）', '大人（緑）', '大人（紫）', '子ども', '大人（グレー）'][i], c, 500 + i)));
  L.push(...misc());
  built = L;
  return L;
}

export function symbolMarkup(l: LibItem) {
  return `<symbol id="lib-${l.id}" viewBox="0 0 ${f(l.vw)} ${f(l.vh)}" overflow="visible">${l.svg}</symbol>`;
}

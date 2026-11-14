// 3Dの見た目：塀・フェンスの素材感（手描きのテクスチャ）、空、立面図のテクスチャ。three.js に依存する部分
import * as THREE from 'three';
import { type Mat3 } from './types';

export const WALL_MATS: [Mat3, string][] = [['block', '化粧ブロック'], ['plaster', '塗り壁'], ['wood', '木目'], ['alumi', 'アルミ']];
export const FENCE_MATS: [Mat3, string][] = [['board', '横板'], ['lattice', '縦格子'], ['mesh', 'メッシュ']];

const cache = new Map<string, THREE.Texture>();

// 1m 四方ぶんの絵を描いて、繰り返しで貼る
function patternTexture(key: string, draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.Texture {
  const hit = cache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const noise = (g: CanvasRenderingContext2D, s: number, n: number, alpha: number, dark = true) => {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${alpha * Math.random()})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2); }
};

// 化粧ブロック：390×190（目地10）を 1m に 2.5×5 個
const blockTex = () => patternTexture('block', (g, s) => {
  g.fillStyle = '#cfcac1'; g.fillRect(0, 0, s, s);
  const bw = s / 2.5, bh = s / 5, joint = Math.max(1, s * 0.012);
  g.fillStyle = '#b9b3a8';
  for (let r = 0; r < 5; r++) {
    const off = r % 2 ? bw / 2 : 0;
    g.fillRect(0, r * bh, s, joint);
    for (let c = -1; c < 3; c++) g.fillRect(off + c * bw, r * bh, joint, bh);
  }
  noise(g, s, 1200, 0.08);
});
const plasterTex = () => patternTexture('plaster', (g, s) => { g.fillStyle = '#ece7dc'; g.fillRect(0, 0, s, s); noise(g, s, 2500, 0.07); noise(g, s, 1500, 0.25, false); });
const woodTex = () => patternTexture('wood', (g, s) => {
  g.fillStyle = '#9c7a55'; g.fillRect(0, 0, s, s);
  const pw = s / 8; // 板幅 125mm
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `hsl(${28 + Math.random() * 6}, ${38 + Math.random() * 10}%, ${36 + Math.random() * 10}%)`; g.fillRect(i * pw, 0, pw, s);
    g.fillStyle = 'rgba(40,20,5,.35)'; g.fillRect(i * pw, 0, Math.max(1, s * 0.008), s);
    g.strokeStyle = 'rgba(60,35,10,.18)'; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) { g.beginPath(); const x = i * pw + pw * (0.2 + k * 0.2); g.moveTo(x, 0); g.bezierCurveTo(x + 4, s * 0.3, x - 4, s * 0.6, x + 2, s); g.stroke(); }
  }
});
const grassTex = () => patternTexture('grass', (g, s) => { g.fillStyle = '#b7c6a1'; g.fillRect(0, 0, s, s); noise(g, s, 3000, 0.12); noise(g, s, 1200, 0.18, false); }, 128);
// メッシュフェンス：50mm 目の網（透明）
const meshTex = () => patternTexture('mesh', (g, s) => {
  g.clearRect(0, 0, s, s); g.strokeStyle = '#4a4e52'; g.lineWidth = Math.max(1, s * 0.012);
  const cell = s / 20;
  for (let i = 0; i <= 20; i++) { g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, s); g.stroke(); g.beginPath(); g.moveTo(0, i * cell); g.lineTo(s, i * cell); g.stroke(); }
});

export function wallMaterial(mat: Mat3 | undefined, fallback: string, len: number, h: number): THREE.MeshStandardMaterial {
  const base = mat === 'block' ? blockTex() : mat === 'plaster' ? plasterTex() : mat === 'wood' ? woodTex() : null;
  if (!base) return new THREE.MeshStandardMaterial(mat === 'alumi' ? { color: '#5b5e61', roughness: 0.45, metalness: 0.5 } : { color: fallback, roughness: 0.85 });
  const map = base.clone(); map.needsUpdate = true; map.repeat.set(Math.max(0.25, len), Math.max(0.25, h));
  return new THREE.MeshStandardMaterial({ map, roughness: mat === 'wood' ? 0.7 : 0.95 });
}
// 模様を貼らない面（塀の小口・上面）の色。模様を細い面に貼るとつぶれて縞になるので、同じ色味の無地にする
export function wallPlain(mat: Mat3 | undefined, fallback: string): THREE.MeshStandardMaterial {
  if (mat === 'alumi') return new THREE.MeshStandardMaterial({ color: '#5b5e61', roughness: 0.45, metalness: 0.5 });
  return new THREE.MeshStandardMaterial({ color: mat === 'block' ? '#c6c1b7' : mat === 'plaster' ? '#e6e1d6' : mat === 'wood' ? '#8f6f4d' : fallback, roughness: 0.9 });
}
export const meshFenceMaterial = (len: number, h: number) => { const map = meshTex().clone(); map.needsUpdate = true; map.repeat.set(Math.max(0.25, len), Math.max(0.25, h)); return new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }); };
export const grassMaterial = () => { const map = grassTex().clone(); map.needsUpdate = true; map.repeat.set(400, 400); return new THREE.MeshStandardMaterial({ map, roughness: 1 }); };
// 敷地の外（図面の外）の地面：芝にすると AI パースが周りを草原にしてしまうので、何でもない薄いグレーの地面にする
const outerTex = () => patternTexture('outer', (g, s) => { g.fillStyle = '#cfccc5'; g.fillRect(0, 0, s, s); noise(g, s, 1500, 0.06); noise(g, s, 600, 0.08, false); }, 128);
export const outerGroundMaterial = () => { const map = outerTex().clone(); map.needsUpdate = true; map.repeat.set(800, 800); return new THREE.MeshStandardMaterial({ map, roughness: 1 }); };

// 空：上が青、地平線が白っぽいグラデーション
export function skyTexture(): THREE.Texture {
  const t = patternTexture('sky', (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#7fb2e0'); grad.addColorStop(0.55, '#c9dff0'); grad.addColorStop(1, '#eef3f6');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }, 64);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // 繰り返すと上の端に地平線の白い筋が出る
  return t;
}

// 映り込み用の環境（全天の絵）：上半分は空、地平線は明るく、下半分は地面の色。太陽の方向に明るい光のかたまり
export function envEquirect(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#5f9bd6'); sky.addColorStop(0.7, '#bcd8ee'); sky.addColorStop(1, '#f4f7f8');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 128);
  const gr = g.createLinearGradient(0, 128, 0, 256);
  gr.addColorStop(0, '#c9c5bb'); gr.addColorStop(1, '#8f8b82');
  g.fillStyle = gr; g.fillRect(0, 128, 512, 128);
  const sun = g.createRadialGradient(150, 50, 0, 150, 50, 70);
  sun.addColorStop(0, 'rgba(255,255,250,1)'); sun.addColorStop(0.25, 'rgba(255,250,235,.7)'); sun.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = sun; g.fillRect(60, 0, 190, 128);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 立面図（白抜きPNG）のテクスチャ。同じ絵は使い回す
const elevCache = new Map<string, THREE.Texture>();
export function elevationTexture(src: string): THREE.Texture {
  const hit = elevCache.get(src); if (hit) return hit;
  const t = new THREE.TextureLoader().load(src);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (elevCache.size > 12) { const k = elevCache.keys().next().value!; elevCache.get(k)?.dispose(); elevCache.delete(k); }
  elevCache.set(src, t);
  return t;
}

// 家の色：外壁・屋根の選択肢（key はデータに保存する値）
export const WALL_COLORS: [string, string, string][] = [['white', 'ホワイト', '#f3f1ea'], ['ivory', 'アイボリー', '#ebe3d2'], ['lightgray', 'ライトグレー', '#d9dadb'], ['gray', 'グレー', '#9a9ea2'], ['beige', 'ベージュ', '#d6c4a8'], ['navy', 'ネイビー', '#3b4a5e'], ['brown', 'ダークブラウン', '#5a4536']];
export const ROOF_COLORS: [string, string, string][] = [['dark', 'ダークグレー', '#5a5d61'], ['black', 'ブラック', '#2e3033'], ['brown', 'ブラウン', '#6a4b3b'], ['green', 'グリーン', '#44584c'], ['silver', 'シルバー', '#a7abb0']];
export const wallColor = (key?: string) => WALL_COLORS.find(c => c[0] === key)?.[2] || WALL_COLORS[0][2];
export const roofColor = (key?: string) => ROOF_COLORS.find(c => c[0] === key)?.[2] || ROOF_COLORS[0][2];

// 屋根材：横の段（瓦・スレート 0.3m ピッチ）。ExtrudeGeometry の側面 UV は実寸（m）なので repeat 1
export function roofMaterial(key?: string): THREE.MeshStandardMaterial {
  const map = patternTexture('roof-rows', (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 3; i++) { const y = Math.round(s * i / 3); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y, s, Math.max(1, s * 0.014)); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y + Math.max(1, s * 0.014), s, Math.max(1, s * 0.02)); }
    noise(g, s, 1500, 0.05);
  }).clone();
  // 押し出しの面は u＝断面の横方向、v＝棟の方向。段は棟と平行に走るので、絵を90°回して貼る
  map.needsUpdate = true; map.repeat.set(1, 1); map.rotation = Math.PI / 2;
  return new THREE.MeshStandardMaterial({ color: roofColor(key), map, roughness: 0.75, metalness: key === 'silver' ? 0.5 : 0.05 });
}
export const glassMaterial = () => new THREE.MeshStandardMaterial({ color: '#8eb1c9', metalness: 0.55, roughness: 0.12, transparent: true, opacity: 0.82 });
export const sashMaterial = () => new THREE.MeshStandardMaterial({ color: '#3b3e42', roughness: 0.5, metalness: 0.3 });

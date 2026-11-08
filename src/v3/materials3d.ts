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
export const meshFenceMaterial = (len: number, h: number) => { const map = meshTex().clone(); map.needsUpdate = true; map.repeat.set(Math.max(0.25, len), Math.max(0.25, h)); return new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }); };
export const grassMaterial = () => { const map = grassTex().clone(); map.needsUpdate = true; map.repeat.set(400, 400); return new THREE.MeshStandardMaterial({ map, roughness: 1 }); };

// 空：上が青、地平線が白っぽいグラデーション
export function skyTexture(): THREE.Texture {
  return patternTexture('sky', (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#7fb2e0'); grad.addColorStop(0.55, '#c9dff0'); grad.addColorStop(1, '#eef3f6');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }, 64);
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

// 端末内で生成する素材テクスチャ（つなぎ目が目立たないタイル）
export type TexDef = { id: string; name: string; draw: (c: CanvasRenderingContext2D, s: number, r: () => number) => void };

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// タイルの端で切れないよう、はみ出した分を反対側にも描く
function wrap(s: number, x: number, y: number, rad: number, f: (x: number, y: number) => void) {
  for (const dx of [0, -s, s]) for (const dy of [0, -s, s]) {
    const X = x + dx, Y = y + dy;
    if (X + rad >= 0 && X - rad <= s && Y + rad >= 0 && Y - rad <= s) f(X, Y);
  }
}

function speckle(c: CanvasRenderingContext2D, s: number, r: () => number, bg: string, colors: string[], count: number, min: number, max: number) {
  c.fillStyle = bg; c.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s, rad = min + r() * (max - min), col = colors[Math.floor(r() * colors.length)], rot = r() * Math.PI;
    c.fillStyle = col;
    wrap(s, x, y, rad, (X, Y) => { c.beginPath(); c.ellipse(X, Y, rad, rad * (0.55 + r() * 0.45), rot, 0, Math.PI * 2); c.fill(); });
  }
}

function speckle2(c: CanvasRenderingContext2D, s: number, r: () => number, colors: string[], count: number, min: number, max: number) {
  for (let i = 0; i < count; i++) { const x = r() * s, y = r() * s, rad = min + r() * (max - min); c.fillStyle = colors[Math.floor(r() * colors.length)]; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); }
}

function noise(c: CanvasRenderingContext2D, s: number, r: () => number, amount: number) {
  const img = c.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * amount; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
  c.putImageData(img, 0, 0);
}

function blotches(c: CanvasRenderingContext2D, s: number, r: () => number, colors: string[], count: number, size: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s, rad = size * (0.4 + r());
    c.fillStyle = colors[Math.floor(r() * colors.length)];
    wrap(s, x, y, rad, (X, Y) => { const g = c.createRadialGradient(X, Y, 0, X, Y, rad); g.addColorStop(0, c.fillStyle as string); g.addColorStop(1, 'rgba(0,0,0,0)'); const keep = c.fillStyle; c.fillStyle = g; c.fillRect(X - rad, Y - rad, rad * 2, rad * 2); c.fillStyle = keep; });
  }
}

export const TEXTURES: TexDef[] = [
  { id: 'gravel-blue', name: '砂利（ブルーグレー）', draw: (c, s, r) => { speckle(c, s, r, '#c9d3da', ['#6f8496', '#9fb0bf', '#e9eef2', '#ffffff', '#3d4c5c', '#b8c4cd', '#87969f'], 2600, 1.2, 3.6); noise(c, s, r, 14); } },
  { id: 'gravel-gray', name: '砂利（グレー）', draw: (c, s, r) => { speckle(c, s, r, '#c5c4c0', ['#8c8b87', '#a9a7a2', '#e5e3de', '#ffffff', '#5e5d5a', '#bdbab3'], 2600, 1.2, 3.6); noise(c, s, r, 14); } },
  { id: 'concrete', name: '土間コンクリート', draw: (c, s, r) => { c.fillStyle = '#cfcfcc'; c.fillRect(0, 0, s, s); blotches(c, s, r, ['rgba(186,186,182,.10)', 'rgba(228,228,225,.14)'], 30, 60); noise(c, s, r, 9); speckle2(c, s, r, ['rgba(120,120,116,.35)', 'rgba(250,250,248,.5)'], 500, 0.4, 1.1); } },
  { id: 'washed', name: '洗い出し', draw: (c, s, r) => { speckle(c, s, r, '#cdbfa8', ['#a8977c', '#e7dccb', '#8a7a62', '#f3ede2', '#b9a88d'], 2400, 1.2, 3.2); noise(c, s, r, 12); } },
  { id: 'soil', name: 'ウッドチップ・土', draw: (c, s, r) => { speckle(c, s, r, '#9a6a45', ['#7b4f30', '#b98257', '#5e3a22', '#c9976a', '#8d5d3b', '#a77550'], 1900, 1.5, 5); noise(c, s, r, 20); } },
  { id: 'grass', name: '芝', draw: (c, s, r) => { c.fillStyle = '#88ad5c'; c.fillRect(0, 0, s, s); for (let i = 0; i < 3800; i++) { const x = r() * s, y = r() * s, a = -Math.PI / 2 + (r() - 0.5) * 1.2, l = 3 + r() * 5; c.strokeStyle = ['#6f9646', '#a3c374', '#5b7f38', '#b7d18c'][Math.floor(r() * 4)]; c.lineWidth = 1; wrap(s, x, y, l, (X, Y) => { c.beginPath(); c.moveTo(X, Y); c.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); c.stroke(); }); } } },
  { id: 'brick', name: 'レンガ敷き', draw: (c, s, r) => { c.fillStyle = '#e4d7c8'; c.fillRect(0, 0, s, s); const bw = s / 4, bh = s / 8; for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) { const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh; const k = r(); c.fillStyle = k < 0.33 ? '#b0623f' : k < 0.66 ? '#a2563a' : '#bf7350'; c.fillRect(x + 2, y + 2, bw - 4, bh - 4); } noise(c, s, r, 16); } },
  { id: 'tile', name: 'タイル', draw: (c, s, r) => { c.fillStyle = '#d9d6cf'; c.fillRect(0, 0, s, s); const t = s / 4; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 205 + Math.floor(r() * 20); c.fillStyle = `rgb(${v},${v - 3},${v - 9})`; c.fillRect(i * t + 2, j * t + 2, t - 4, t - 4); } noise(c, s, r, 8); } },
  { id: 'deck', name: 'ウッドデッキ', draw: (c, s, r) => { const h = s / 8; for (let i = 0; i < 8; i++) { const v = r(); c.fillStyle = v < 0.5 ? '#a8774e' : '#9a6b44'; c.fillRect(0, i * h, s, h); c.fillStyle = '#6e4a2c'; c.fillRect(0, i * h + h - 2, s, 2); for (let k = 0; k < 30; k++) { c.fillStyle = 'rgba(80,50,30,.18)'; c.fillRect(r() * s, i * h + r() * (h - 3), 20 + r() * 50, 1); } } } },
  { id: 'water', name: '水面', draw: (c, s, r) => { c.fillStyle = '#9fc6db'; c.fillRect(0, 0, s, s); for (let i = 0; i < 120; i++) { const x = r() * s, y = r() * s, l = 8 + r() * 20; c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; wrap(s, x, y, l, (X, Y) => { c.beginPath(); c.moveTo(X, Y); c.quadraticCurveTo(X + l / 2, Y - 3, X + l, Y); c.stroke(); }); } } },
];

const cache = new Map<string, string>();
export function builtinTexture(id: string): string {
  const hit = cache.get(id); if (hit) return hit;
  const def = TEXTURES.find(t => t.id === id) || TEXTURES[0];
  if (typeof document === 'undefined') return '';
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const c = cv.getContext('2d'); if (!c) return '';
  def.draw(c, s, rng(def.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)));
  const url = cv.toDataURL('image/jpeg', 0.9); cache.set(id, url); return url;
}

// テクスチャ参照は「b:素材ID」か画像のdata URL
export function textureSrc(tex: string) { return tex.startsWith('b:') ? builtinTexture(tex.slice(2)) : tex; }
export function textureName(tex: string) { return tex.startsWith('b:') ? (TEXTURES.find(t => t.id === tex.slice(2))?.name || '素材') : '読み込み画像'; }

// ボタン用の短い名前（砂利2種は色で見分ける）
export const texLabel = (name: string) => name.replace('（ブルーグレー）', '・青').replace('（グレー）', '・灰').replace(/（.*）/, '');

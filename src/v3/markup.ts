// 図形 → SVG文字列。画面表示・書き出し・塗りつぶし判定で同じ見た目を使う。
import { type Item, type Layer, type Pt, type StrokeItem, type Dash, type TextureItem, type TextItem, textSize, fmtLen } from './types';
import { textureSrc } from './textures';

export type RenderCtx = { mmPerPx: number; unit: string };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (v: number) => Math.round(v * 100) / 100;
export const FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic UI','Meiryo',sans-serif`;

function dashAttr(d: Dash, w: number) {
  if (d === 'dashed') return ` stroke-dasharray="${n(w * 4)} ${n(w * 3)}"`;
  if (d === 'dotted') return ` stroke-dasharray="0.1 ${n(w * 2.2)}"`;
  return '';
}

// 中点を通る2次ベジェで滑らかにする
export function smoothPath(pts: Pt[], closed = false): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${n(pts[0].x)} ${n(pts[0].y)}l0.01 0`;
  if (pts.length === 2) return `M${n(pts[0].x)} ${n(pts[0].y)}L${n(pts[1].x)} ${n(pts[1].y)}`;
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    d += `Q${n(p.x)} ${n(p.y)} ${n((p.x + q.x) / 2)} ${n((p.y + q.y) / 2)}`;
  }
  const l = pts[pts.length - 1];
  d += `L${n(l.x)} ${n(l.y)}`;
  return closed ? d + 'Z' : d;
}

// 筆圧（またはスピード）で太さが変わるペンの輪郭
export function penOutline(pts: Pt[], width: number): string {
  if (pts.length < 2) { const p = pts[0]; const r = width * 0.5; return p ? `M${n(p.x - r)} ${n(p.y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0` : ''; }
  const L: Pt[] = [], R: Pt[] = [];
  const total = pts.length;
  for (let i = 0; i < total; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(total - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const pr = pts[i].p ?? 0.5;
    // 始点・終点を細くして手描きらしい入り抜きを作る
    const taper = Math.min(1, (i + 1) / 4, (total - i) / 4);
    const w = width * (0.35 + 0.9 * pr) * (0.55 + 0.45 * taper) / 2;
    L.push({ x: pts[i].x - dy * w, y: pts[i].y + dx * w });
    R.push({ x: pts[i].x + dy * w, y: pts[i].y - dx * w });
  }
  const outline = [...L, ...R.reverse()];
  return smoothPath(outline, true);
}

function strokeMarkup(s: StrokeItem): string {
  const c = esc(s.color);
  if (s.brush === 'pen' && s.dash === 'solid') return `<path d="${penOutline(s.pts, s.width)}" fill="${c}"/>`;
  const d = smoothPath(s.pts);
  if (s.brush === 'marker') return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(s.width * 2.6)}" stroke-linecap="square" stroke-linejoin="round" opacity="0.5"${dashAttr(s.dash, s.width * 2.6)}/>`;
  if (s.brush === 'matte') return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(s.width * 3.2)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(s.dash, s.width * 3.2)}/>`;
  if (s.brush === 'pencil') return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(Math.max(0.6, s.width * 0.7))}" stroke-linecap="round" stroke-linejoin="round" opacity="0.78" filter="url(#fx-pencil)"${dashAttr(s.dash, s.width)}/>`;
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(s.width * 0.8)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(s.dash, s.width)}/>`;
}

function arrowHead(a: Pt, b: Pt, w: number, color: string) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = Math.max(8, w * 4);
  const p1 = { x: b.x - s * Math.cos(ang - 0.4), y: b.y - s * Math.sin(ang - 0.4) }, p2 = { x: b.x - s * Math.cos(ang + 0.4), y: b.y - s * Math.sin(ang + 0.4) };
  return `<path d="M${n(p1.x)} ${n(p1.y)}L${n(b.x)} ${n(b.y)}L${n(p2.x)} ${n(p2.y)}" fill="none" stroke="${color}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function dimMarkup(a: Pt, b: Pt, color: string, width: number, label: string, size = 13): string {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang), t = size * 0.55;
  const tick = (p: Pt) => `M${n(p.x + nx * t + Math.cos(ang) * -t * 0.6)} ${n(p.y + ny * t + Math.sin(ang) * -t * 0.6)}L${n(p.x - nx * t + Math.cos(ang) * t * 0.6)} ${n(p.y - ny * t + Math.sin(ang) * t * 0.6)}`;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let deg = ang * 180 / Math.PI; if (deg > 90 || deg < -90) deg += 180;
  const fs = size;
  return `<g class="dim"><path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}${tick(a)}${tick(b)}" stroke="${esc(color)}" stroke-width="${n(Math.max(0.8, width * 0.4))}" fill="none"/>`
    + `<text transform="translate(${n(mid.x + nx * -fs * 0.45)} ${n(mid.y + ny * -fs * 0.45)}) rotate(${n(deg)})" text-anchor="middle" font-size="${fs}" font-family="${FONT}" fill="${esc(color)}" stroke="#fff" stroke-width="${n(fs * 0.22)}" paint-order="stroke">${esc(label)}</text></g>`;
}

export function textMarkup(t: TextItem): string {
  const s = textSize(t), pad = t.bg || t.border ? t.size * 0.3 : 0, rows = t.text.split('\n');
  const c = { x: t.x + s.w / 2, y: t.y + s.h / 2 };
  let out = `<g transform="rotate(${n(t.rot)} ${n(c.x)} ${n(c.y)})">`;
  if (t.bg || t.border) out += `<rect x="${n(t.x)}" y="${n(t.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(t.size * 0.15)}" fill="${t.bg ? esc(t.bg) : 'none'}" stroke="${t.border ? esc(t.border) : 'none'}" stroke-width="${n(Math.max(1, t.size * 0.06))}"/>`;
  rows.forEach((r, i) => {
    out += `<text x="${n(t.x + pad)}" y="${n(t.y + pad * 0.66 + t.size * (1.25 * i + 0.98))}" font-size="${n(t.size)}" font-family="${FONT}" fill="${esc(t.color)}">${esc(r) || ' '}</text>`;
  });
  return out + '</g>';
}

// テクスチャ：マスク画像で切り抜いたパターン＋色調補正フィルター
export function textureDefs(t: TextureItem): string {
  const tile = 128 * t.scale, src = esc(textureSrc(t.tex));
  const sat = t.sat / 100, br = t.bright / 100, ct = t.contrast / 100, ic = n(0.5 * (1 - ct));
  return `<mask id="mk-${t.id}" maskUnits="userSpaceOnUse" x="${n(t.x)}" y="${n(t.y)}" width="${n(t.w)}" height="${n(t.h)}"><image href="${esc(t.mask)}" x="${n(t.x)}" y="${n(t.y)}" width="${n(t.w)}" height="${n(t.h)}" preserveAspectRatio="none"/></mask>`
    + `<pattern id="pt-${t.id}" patternUnits="userSpaceOnUse" width="${n(tile)}" height="${n(tile)}" patternTransform="rotate(${n(t.rot)})"><image href="${src}" width="${n(tile)}" height="${n(tile)}" preserveAspectRatio="none"/></pattern>`
    + `<filter id="ft-${t.id}" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="${n(t.hue)}"/><feColorMatrix type="saturate" values="${n(sat)}"/>`
    + `<feComponentTransfer><feFuncR type="linear" slope="${n(br * ct)}" intercept="${ic}"/><feFuncG type="linear" slope="${n(br * ct)}" intercept="${ic}"/><feFuncB type="linear" slope="${n(br * ct)}" intercept="${ic}"/></feComponentTransfer></filter>`;
}

export function itemMarkup(it: Item, ctx: RenderCtx): string {
  switch (it.type) {
    case 'stroke': return strokeMarkup(it);
    case 'line': {
      const w = n(it.width * 0.8);
      let d = `<path d="M${it.pts.map(p => `${n(p.x)} ${n(p.y)}`).join('L')}" fill="none" stroke="${esc(it.color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(it.dash, it.width)}/>`;
      if (it.kind === 'arrow' && it.pts.length > 1) d += arrowHead(it.pts[it.pts.length - 2], it.pts[it.pts.length - 1], it.width * 0.8, esc(it.color));
      return d;
    }
    case 'shape': {
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2, common = `fill="none" stroke="${esc(it.color)}" stroke-width="${n(it.width * 0.8)}"${dashAttr(it.dash, it.width)} transform="rotate(${n(it.rot)} ${n(cx)} ${n(cy)})"`;
      if (it.shape === 'rect') return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" ${common}/>`;
      return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(it.w / 2)}" ry="${n(it.h / 2)}" ${common}/>`;
    }
    case 'dim': return dimMarkup(it.a, it.b, it.color, it.width, fmtLen(Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y), ctx.mmPerPx, ctx.unit), it.size);
    case 'text': return textMarkup(it);
    case 'obj': {
      if (it.hidden) return '';
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const tf = `rotate(${n(it.rot)} ${n(cx)} ${n(cy)})${it.flip ? ` translate(${n(2 * cx)} 0) scale(-1 1)` : ''}`;
      return `<use href="#lib-${esc(it.ref)}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" transform="${tf}"${it.color ? ` style="color:${esc(it.color)}"` : ''}/>`;
    }
    case 'texture':
      return `<defs>${textureDefs(it)}</defs><g mask="url(#mk-${it.id})"><rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="url(#pt-${it.id})" filter="url(#ft-${it.id})"/></g>`;
  }
}

export function layerMarkup(layer: Layer, ctx: RenderCtx): string {
  let s = '';
  for (const it of layer.items) s += itemMarkup(it, ctx);
  return s;
}

export const SHARED_DEFS = `<filter id="fx-pencil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>`;

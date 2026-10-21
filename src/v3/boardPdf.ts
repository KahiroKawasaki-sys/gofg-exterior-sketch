// 仕様書（マテリアルボード）PDF。見積書と同じく canvas に描いて画像としてPDFに貼る（estimatePdf の部品を使う）
import { type LibItem } from './types';
import { textureSrc } from './textures';
import { rasterize } from './raster';
import { W, H, MM, page, font, text, hline, footer, honorific, jpDate, type PdfInfo } from './estimatePdf';
import { type BoardCard, BOARD, cardW, picH, layoutBoard, symbolSvg } from './materialBoard';

type Pic = CanvasImageSource & { width: number; height: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(Error('画像を読めませんでした')); img.src = src; });
}

// カードの絵を先に読み込んでおく（読めないものは null のまま「写真なし」で描く）
export async function loadBoardPics(cards: BoardCard[], lib: LibItem[]): Promise<Map<string, Pic | null>> {
  const libs = new Map(lib.map(l => [l.id, l])), out = new Map<string, Pic | null>();
  await Promise.all(cards.map(async c => {
    try {
      const p = c.pic;
      if (p.kind === 'photo') out.set(c.key, await loadImage(p.src));
      else if (p.kind === 'texture') out.set(c.key, await loadImage(textureSrc(p.tex)));
      else if (p.kind === 'symbol') {
        const l = libs.get(p.lib); if (!l) return;
        const k = 480 / Math.max(l.vw, l.vh);
        out.set(c.key, await rasterize(symbolSvg(l), l.vw * k, l.vh * k));
      }
    } catch { out.set(c.key, null); }
  }));
  return out;
}

// 塀・フェンス・門扉の簡単な立面の絵
function drawLineGlyph(g: CanvasRenderingContext2D, role: string, x: number, y: number, w: number, h: number) {
  g.save(); g.fillStyle = '#f3f4f1'; g.fillRect(x, y, w, h);
  const gx = y + h * 0.82; g.strokeStyle = '#9a9a8e'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w * 0.06, gx); g.lineTo(x + w * 0.94, gx); g.stroke();
  g.strokeStyle = '#3d4a45'; g.fillStyle = '#c9cbc3'; g.lineWidth = 2.5;
  if (role === 'wall') {
    const bh = h * 0.12; for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
      const bw = w * 0.88 / 5.5, bx = x + w * 0.06 + k * bw - (r % 2 ? bw / 2 : 0), by = gx - (r + 1) * bh;
      const cx = Math.max(bx, x + w * 0.06), cw = Math.min(bx + bw, x + w * 0.94) - cx; if (cw <= 0) continue;
      g.fillRect(cx + 1.5, by + 1.5, cw - 3, bh - 3); g.strokeRect(cx + 1.5, by + 1.5, cw - 3, bh - 3);
    }
  } else if (role === 'fence') {
    const top = gx - h * 0.5; g.fillRect(x + w * 0.06, gx - h * 0.1, w * 0.88, h * 0.1);
    for (let k = 0; k < 14; k++) { const sx = x + w * 0.08 + k * w * 0.84 / 13; g.beginPath(); g.moveTo(sx, gx - h * 0.1); g.lineTo(sx, top); g.stroke(); }
    g.beginPath(); g.moveTo(x + w * 0.06, top); g.lineTo(x + w * 0.94, top); g.stroke();
  } else {
    const pw = w * 0.07, top = gx - h * 0.6;
    g.fillRect(x + w * 0.2, top, pw, gx - top); g.fillRect(x + w * 0.73, top, pw, gx - top);
    g.strokeRect(x + w * 0.2 + pw + 4, top + h * 0.08, w * 0.53 - pw - 8, gx - top - h * 0.12);
    for (let k = 1; k < 6; k++) { const sx = x + w * 0.2 + pw + 4 + k * (w * 0.53 - pw - 8) / 6; g.beginPath(); g.moveTo(sx, top + h * 0.08); g.lineTo(sx, gx - h * 0.04); g.stroke(); }
  }
  g.restore();
}

// 枠いっぱいに写真・質感を敷く（はみ出しは中央で切る）。記号は余白を取って収める
function drawPic(g: CanvasRenderingContext2D, c: BoardCard, img: Pic | null | undefined, x: number, y: number, w: number, h: number) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (c.pic.kind === 'line') drawLineGlyph(g, c.pic.role, x, y, w, h);
  else if (img && img.width && img.height) {
    if (c.pic.kind === 'symbol') {
      g.fillStyle = '#f3f4f1'; g.fillRect(x, y, w, h);
      const k = Math.min(w * 0.82 / img.width, h * 0.82 / img.height); g.drawImage(img, x + (w - img.width * k) / 2, y + (h - img.height * k) / 2, img.width * k, img.height * k);
    } else {
      const k = Math.max(w / img.width, h / img.height); g.drawImage(img, x + (w - img.width * k) / 2, y + (h - img.height * k) / 2, img.width * k, img.height * k);
    }
  } else {
    g.fillStyle = '#efefec'; g.fillRect(x, y, w, h);
    font(g, 2.8 * MM); g.fillStyle = '#9a9a92'; text(g, '写真なし', x + w / 2, y + h / 2 + 1 * MM, 'center');
  }
  g.restore();
  g.strokeStyle = '#d8d8d2'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
}

// 品名は2行まで折り返す（入りきらなければ2行目の最後を…に）
function wrap2(g: CanvasRenderingContext2D, s: string, w: number): string[] {
  if (g.measureText(s).width <= w) return [s];
  let i = 1; while (i < s.length && g.measureText(s.slice(0, i + 1)).width <= w) i++;
  let rest = s.slice(i);
  if (g.measureText(rest).width > w) { while (rest.length > 1 && g.measureText(rest + '…').width > w) rest = rest.slice(0, -1); rest += '…'; }
  return [s.slice(0, i), rest];
}

export function drawBoardPages(cards: BoardCard[], info: PdfInfo, pics: Map<string, Pic | null>): HTMLCanvasElement[] {
  const L = BOARD.left * MM, R = BOARD.right * MM, cw = cardW * MM, ph = picH * MM;
  const pages = layoutBoard(cards);
  const out = pages.map((slots, pi) => {
    const [c, g] = page();
    font(g, 6 * MM, true); text(g, '仕様書（マテリアルボード）', L, 20 * MM);
    font(g, 3.6 * MM, true); text(g, honorific(info.client), R, 15 * MM, 'right', 90 * MM);
    font(g, 3 * MM); g.fillStyle = '#555'; text(g, [jpDate(info.date), info.company].filter(Boolean).join('　'), R, 21 * MM, 'right', 90 * MM); g.fillStyle = '#222';
    if (pi === 0) { font(g, 3 * MM); g.fillStyle = '#555'; text(g, '図面でご提案している素材・設備の一覧です。', L, 27 * MM, 'left', R - L); g.fillStyle = '#222'; }
    hline(g, L, R, 30 * MM, 2, '#2f5d4e');
    for (const s of slots) {
      if (s.kind === 'head') { font(g, 3.6 * MM, true); g.fillStyle = '#2f5d4e'; text(g, '■ ' + s.text, L, (s.y + 5.5) * MM); g.fillStyle = '#222'; continue; }
      const x = s.x * MM, y = s.y * MM, cd = s.card;
      drawPic(g, cd, pics.get(cd.key), x, y, cw, ph);
      let ty = y + ph + 4.2 * MM;
      font(g, 2.5 * MM); g.fillStyle = '#7a7a72'; text(g, cd.cat + (cd.qty ? `　${cd.qty}` : ''), x, ty, 'left', cw); ty += 4.6 * MM;
      font(g, 3.3 * MM, true); g.fillStyle = '#222'; text(g, cd.title, x, ty, 'left', cw); ty += 4.4 * MM;
      font(g, 2.7 * MM); g.fillStyle = '#333';
      if (cd.product) for (const ln of wrap2(g, cd.product, cw)) { text(g, ln, x, ty); ty += 3.6 * MM; }
      else { g.fillStyle = '#9a9a92'; text(g, '品目未設定', x, ty); ty += 3.6 * MM; }
      if (cd.spec) { font(g, 2.5 * MM); g.fillStyle = '#2f5d4e'; text(g, cd.spec, x, ty, 'left', cw); }
      g.fillStyle = '#222';
    }
    return c;
  });
  const last = out[out.length - 1].getContext('2d')!;
  font(last, 2.6 * MM); last.fillStyle = '#888';
  text(last, '※写真・色味は実物と異なる場合があります。写真のない項目は図面の質感・記号で表示しています。', L, H - 16 * MM, 'left', W - 2 * L);
  out.forEach((c, i) => footer(c.getContext('2d')!, i + 1, out.length));
  return out;
}

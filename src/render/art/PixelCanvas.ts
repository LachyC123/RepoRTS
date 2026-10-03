/**
 * Pixel-level drawing surface used by every procedural art generator.
 * Works on an offscreen canvas (browser) and keeps a Uint32 view for speed.
 * Colours are '#rrggbb' strings or packed 0xAABBGGRR little-endian ints.
 */
export type Col = string | number;

const cache = new Map<string, number>();

export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function pack(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export function toPacked(c: Col): number {
  if (typeof c === 'number') return c;
  let v = cache.get(c);
  if (v === undefined) {
    const [r, g, b] = rgb(c);
    v = pack(r, g, b, c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255);
    cache.set(c, v);
  }
  return v;
}

export function unpack(v: number): [number, number, number, number] {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
}

/** mix two hex colours */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return '#' + [r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** lighten (amt>0) toward warm white or darken (amt<0) toward cool purple-black — consistent lighting */
export function shade(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, '#fff6e0', amt) : mix(hex, '#1a1020', -amt);
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class PixelCanvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  private _canvas: HTMLCanvasElement | null = null;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.bytes = new Uint8ClampedArray(w * h * 4);
    this.data = new Uint32Array(this.bytes.buffer);
  }

  get canvas(): HTMLCanvasElement {
    if (!this._canvas) this._canvas = makeCanvas(this.w, this.h);
    return this._canvas;
  }

  /** push pixel buffer to a canvas (browser only) */
  flush(): HTMLCanvasElement {
    const c = this.canvas;
    const ctx = c.getContext('2d')!;
    ctx.putImageData(new ImageData(this.bytes, this.w, this.h), 0, 0);
    return c;
  }

  clear() {
    this.data.fill(0);
  }

  get(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  px(x: number, y: number, c: Col) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = toPacked(c);
  }

  /** draw pixel only if empty */
  under(x: number, y: number, c: Col) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.data[i] >>> 24 === 0) this.data[i] = toPacked(c);
  }

  /** alpha blend a colour onto the pixel */
  blend(x: number, y: number, c: Col, a: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const dst = this.data[i];
    const [sr, sg, sb] = unpack(toPacked(c));
    const da = dst >>> 24;
    if (da === 0) {
      this.data[i] = pack(sr, sg, sb, Math.round(a * 255));
      return;
    }
    const [dr, dg, db] = unpack(dst);
    this.data[i] = pack(dr + (sr - dr) * a, dg + (sg - dg) * a, db + (sb - db) * a, Math.max(da, Math.round(a * 255)));
  }

  rect(x: number, y: number, w: number, h: number, c: Col) {
    const v = toPacked(c);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    if (x1 <= x0) return;
    for (let yy = y0; yy < y1; yy++) this.data.fill(v, yy * this.w + x0, yy * this.w + x1);
  }

  hline(x0: number, x1: number, y: number, c: Col) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    this.rect(x0, y, x1 - x0 + 1, 1, c);
  }

  vline(x: number, y0: number, y1: number, c: Col) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    this.rect(x, y0, 1, y1 - y0 + 1, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Col) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 2000; guard++) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Col) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
    }
  }

  ellipseBlend(cx: number, cy: number, rx: number, ry: number, c: Col, a: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.blend(x, y, c, a);
      }
    }
  }

  /** soft drop shadow ellipse (only on empty pixels) */
  shadow(cx: number, cy: number, rx: number, ry: number, a = 0.35) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d <= 1) {
          const i = y * this.w + x;
          if (this.data[i] >>> 24 === 0) this.data[i] = pack(20, 16, 24, Math.round(255 * a * (d < 0.55 ? 1 : 0.65)));
        }
      }
    }
  }

  /**
   * Selective outline: every transparent pixel touching an opaque one becomes a dark
   * version of that neighbour. Gives the hand-pixelled sprite look.
   */
  outline(dark = '#1b1420', strength = 0.7, minAlpha = 200) {
    const { w, h, data } = this;
    const src = data.slice();
    const [dr, dg, db] = unpack(toPacked(dark));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] >>> 24 !== 0) continue;
        let n = 0;
        if (x > 0 && src[i - 1] >>> 24 >= minAlpha) n = src[i - 1];
        else if (x < w - 1 && src[i + 1] >>> 24 >= minAlpha) n = src[i + 1];
        else if (y > 0 && src[i - w] >>> 24 >= minAlpha) n = src[i - w];
        else if (y < h - 1 && src[i + w] >>> 24 >= minAlpha) n = src[i + w];
        if (n) {
          const [r, g, b] = unpack(n);
          data[i] = pack(r + (dr - r) * strength, g + (dg - g) * strength, b + (db - b) * strength, 255);
        }
      }
    }
  }

  /** copy another surface in at offset (opaque pixels only) */
  draw(src: PixelCanvas, ox: number, oy: number, flip = false) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const v = src.data[y * src.w + (flip ? src.w - 1 - x : x)];
        if (v >>> 24 === 0) continue;
        const tx = x + ox;
        const ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.data[ty * this.w + tx] = v;
      }
    }
  }

  /** replace one exact colour with another (palette swap) */
  swap(from: Col, to: Col) {
    const f = toPacked(from);
    const t = toPacked(to);
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === f) this.data[i] = t;
  }
}

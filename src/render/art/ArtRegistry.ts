import type Phaser from 'phaser';
import type { PixelCanvas } from './PixelCanvas';

/**
 * Central art registry. Generators register named frames (with ground anchors); `build` packs them
 * into atlas pages and registers Phaser textures. Gameplay/render code only ever asks for frames by
 * name, so procedural placeholders can be swapped for hand-made spritesheets by registering
 * images under the same names (see `addImageFrames`).
 */
export interface FrameRef {
  key: string;
  frame: string;
  w: number;
  h: number;
  /** origin (0..1) of the ground anchor */
  ox: number;
  oy: number;
}

interface Pending {
  name: string;
  pc: PixelCanvas;
  ax: number;
  ay: number;
}

const PAGE = 2048;
const PAD = 1;

export class ArtRegistry {
  private pending: Pending[] = [];
  private frames = new Map<string, FrameRef>();
  private pageCount = 0;

  add(name: string, pc: PixelCanvas, ax: number, ay: number) {
    this.pending.push({ name, pc, ax, ay });
  }

  has(name: string) {
    return this.frames.has(name) || this.pending.some((p) => p.name === name);
  }

  get(name: string): FrameRef {
    const f = this.frames.get(name);
    if (!f) throw new Error('missing art frame ' + name);
    return f;
  }

  tryGet(name: string): FrameRef | undefined {
    return this.frames.get(name);
  }

  /** pack pending frames into pages and upload */
  build(scene: Phaser.Scene, prefix = 'atlas') {
    if (!this.pending.length) return;
    // tallest first for better shelf packing
    const list = this.pending.sort((a, b) => b.pc.h - a.pc.h || b.pc.w - a.pc.w);
    this.pending = [];
    let page: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let key = '';
    let x = 0;
    let y = 0;
    let shelfH = 0;
    let placed: { p: Pending; x: number; y: number }[] = [];
    const flush = () => {
      if (!page) return;
      const tex = scene.textures.addCanvas(key, page)!;
      for (const it of placed) {
        tex.add(it.p.name, 0, it.x, it.y, it.p.pc.w, it.p.pc.h);
        this.frames.set(it.p.name, { key, frame: it.p.name, w: it.p.pc.w, h: it.p.pc.h, ox: it.p.ax / it.p.pc.w, oy: it.p.ay / it.p.pc.h });
      }
      placed = [];
    };
    const newPage = () => {
      flush();
      page = document.createElement('canvas');
      page.width = PAGE;
      page.height = PAGE;
      ctx = page.getContext('2d')!;
      key = `${prefix}${this.pageCount++}`;
      x = 0;
      y = 0;
      shelfH = 0;
    };
    newPage();
    for (const p of list) {
      const w = p.pc.w + PAD;
      const h = p.pc.h + PAD;
      if (x + w > PAGE) {
        x = 0;
        y += shelfH;
        shelfH = 0;
      }
      if (y + h > PAGE) newPage();
      ctx!.putImageData(new ImageData(p.pc.bytes, p.pc.w, p.pc.h), x, y);
      placed.push({ p, x, y });
      x += w;
      if (h > shelfH) shelfH = h;
    }
    flush();
  }

  /**
   * Replace/define frames from a loaded image texture: frames = [{name, x,y,w,h, ax, ay}].
   * This is the hook for professional sprite sheets.
   */
  addImageFrames(scene: Phaser.Scene, key: string, defs: { name: string; x: number; y: number; w: number; h: number; ax: number; ay: number }[]) {
    const tex = scene.textures.get(key);
    for (const d of defs) {
      tex.add(d.name, 0, d.x, d.y, d.w, d.h);
      this.frames.set(d.name, { key, frame: d.name, w: d.w, h: d.h, ox: d.ax / d.w, oy: d.ay / d.h });
    }
  }
}

export const art = new ArtRegistry();

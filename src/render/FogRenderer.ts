import Phaser from 'phaser';
import { canvasTexture } from './texUtil';
import { TILE } from '../data/constants';
import type { World } from '../sim/World';
import { BAYER4 } from './art/palette';

const PX = 8; // canvas px per tile (2 world px per fog pixel)

/**
 * Pixel-art fog of war: unexplored land is hidden under dark, softly textured fog; explored but
 * unwatched land is dimmed. Edges are dithered (ordered Bayer) rather than blurred, and only tiles
 * whose state changed are repainted.
 */
export class FogRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: Phaser.GameObjects.Image;
  private data: ImageData;
  private px32: Uint32Array;
  private state: Uint8Array; // 0 unexplored, 1 explored, 2 visible
  private key = 'fog_overlay';
  private lastVersion = -1;
  private noise: Float32Array;
  enabled = true;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private faction: number,
    layer: Phaser.GameObjects.Layer,
  ) {
    const m = world.map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = m.w * PX;
    this.canvas.height = m.h * PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.data = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    this.px32 = new Uint32Array(this.data.data.buffer);
    this.state = new Uint8Array(m.w * m.h).fill(255);
    this.noise = new Float32Array(this.canvas.width * this.canvas.height);
    for (let y = 0; y < this.canvas.height; y++)
      for (let x = 0; x < this.canvas.width; x++) {
        const v = Math.sin(x * 0.055 + Math.sin(y * 0.035) * 2) * 0.5 + Math.sin(y * 0.065 + Math.sin(x * 0.025) * 3) * 0.5;
        this.noise[y * this.canvas.width + x] = v;
      }
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
    canvasTexture(scene, this.key, this.canvas);
    this.img = scene.make.image({ x: 0, y: 0, key: this.key }, false).setOrigin(0, 0).setScale(TILE / PX);
    layer.add(this.img);
    if (faction < 0) {
      this.enabled = false;
      this.img.setVisible(false);
    }
  }

  private tileState(i: number): number {
    const vis = this.world.vis;
    if (vis.revealAll) return 2;
    if (vis.visible[this.faction][i]) return 2;
    if (vis.explored[this.faction][i]) return 1;
    return 0;
  }

  update(force = false) {
    if (!this.enabled) return;
    const vis = this.world.vis;
    if (!force && vis.version === this.lastVersion) return;
    this.lastVersion = vis.version;
    const m = this.world.map;
    const dirty: number[] = [];
    for (let i = 0; i < m.w * m.h; i++) {
      const s = this.tileState(i);
      if (s !== this.state[i]) {
        this.state[i] = s;
        dirty.push(i);
      }
    }
    if (!dirty.length) return;
    // repaint dirty tiles and their neighbours (edges blend across tiles)
    const mark = new Uint8Array(m.w * m.h);
    for (const i of dirty) {
      const tx = i % m.w;
      const ty = Math.floor(i / m.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx;
          const y = ty + dy;
          if (x >= 0 && y >= 0 && x < m.w && y < m.h) mark[y * m.w + x] = 1;
        }
    }
    let minX = m.w;
    let minY = m.h;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < mark.length; i++) {
      if (!mark[i]) continue;
      const tx = i % m.w;
      const ty = Math.floor(i / m.w);
      this.paintTile(tx, ty);
      if (tx < minX) minX = tx;
      if (ty < minY) minY = ty;
      if (tx > maxX) maxX = tx;
      if (ty > maxY) maxY = ty;
    }
    this.ctx.putImageData(this.data, 0, 0, minX * PX, minY * PX, (maxX - minX + 1) * PX, (maxY - minY + 1) * PX);
    this.scene.textures.get(this.key).source[0].update();
  }

  private val(tx: number, ty: number) {
    const m = this.world.map;
    tx = Math.max(0, Math.min(m.w - 1, tx));
    ty = Math.max(0, Math.min(m.h - 1, ty));
    const s = this.state[ty * m.w + tx];
    return s === 2 ? 0 : s === 1 ? 0.5 : 1;
  }

  private paintTile(tx: number, ty: number) {
    const W = this.canvas.width;
    for (let py = 0; py < PX; py++) {
      for (let px = 0; px < PX; px++) {
        // bilinear sample of fog density at this canvas pixel
        const fx = tx + (px + 0.5) / PX - 0.5;
        const fy = ty + (py + 0.5) / PX - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const ax = fx - x0;
        const ay = fy - y0;
        const v =
          (this.val(x0, y0) * (1 - ax) + this.val(x0 + 1, y0) * ax) * (1 - ay) + (this.val(x0, y0 + 1) * (1 - ax) + this.val(x0 + 1, y0 + 1) * ax) * ay;
        const gx = tx * PX + px;
        const gy = ty * PX + py;
        const d = BAYER4[(gx & 3) + ((gy & 3) << 2)];
        // quantise into 3 bands with dithered transitions
        const q = v * 2 + d * 0.9;
        let a: number;
        let r = 14;
        let g = 10;
        let b = 22;
        if (q < 0.5) a = 0;
        else if (q < 1.5) {
          a = 118;
          r = 20;
          g = 16;
          b = 34;
        } else {
          const n = this.noise[gy * W + gx];
          a = 236;
          r = 22 + n * 6;
          g = 18 + n * 5;
          b = 34 + n * 8;
        }
        this.px32[gy * W + gx] = (a << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
      }
    }
  }

  setVisible(v: boolean) {
    this.img.setVisible(v && this.enabled);
  }

  /** Thin the fog (cinematics) or restore it; tweened so the reveal never pops. */
  fadeTo(alpha: number, ms = 800) {
    this.scene.tweens.killTweensOf(this.img);
    if (ms <= 0) this.img.setAlpha(alpha);
    else this.scene.tweens.add({ targets: this.img, alpha, duration: ms, ease: 'Sine.easeInOut' });
  }
}

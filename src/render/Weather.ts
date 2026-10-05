import Phaser from 'phaser';
import { audio } from '../audio';
import type { CameraController } from './CameraController';
import type { Particles } from './Particles';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'mist';

const CLOUD_KEYS = ['wx_cloud0', 'wx_cloud1', 'wx_cloud2'];

/** a lumpy cloud silhouette at low resolution, three stepped alpha bands so it reads as pixel art */
function cloudCanvas(seed: number): HTMLCanvasElement {
  const W = 48;
  const H = 26;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const blobs: [number, number, number][] = [];
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) blobs.push([8 + rnd() * (W - 16), 7 + rnd() * (H - 14), 5 + rnd() * 7]);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (const [bx, by, r] of blobs) {
        const d = Math.hypot((x - bx) * 0.8, y - by) / r;
        v = Math.max(v, 1 - d);
      }
      // ordered dither on the edge band keeps it crunchy rather than smooth
      const dith = ((x & 1) ^ (y & 1)) * 0.06;
      const a = v + dith > 0.45 ? 1 : v + dith > 0.22 ? 0.66 : v + dith > 0.06 ? 0.33 : 0;
      const k = (y * W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface Shadow {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  w: number;
  a: number;
  fade: number;
}

/**
 * Atmospheric weather (no gameplay penalties): pixel cloud shadows sailing over the valley with the
 * wind, rain with splashes, thunderstorms (lightning strikes, a white flash and thunder rolling in a
 * moment later), morning mist, and a gentle colour grade. The simulation decides the weather.
 */
export class Weather {
  kind: WeatherKind = 'sunny';
  private next: number;
  private t = 0;
  private overlay: Phaser.GameObjects.Rectangle;
  private flash: Phaser.GameObjects.Rectangle;
  private bolt: Phaser.GameObjects.Graphics;
  private shade = 0;
  private targetShade = 0;
  private tint = 0x000000;
  private shadows: Shadow[] = [];
  private stormT = 6;
  private flashes: { at: number; a: number }[] = [];
  private flashA = 0;
  private boltPts: number[] = [];
  private boltT = 0;
  private storm = false;
  enabled = true;
  wind = 1;
  /** the simulation decides the weather; this only draws it */
  source?: () => WeatherKind;
  onChange?: (k: WeatherKind) => void;
  /** 0..1 how much of a misty dawn it is */
  dawn?: () => number;
  /** a lightning strike landed here (for ground scorch / scared birds) */
  onStrike?: (x: number, y: number) => void;

  constructor(
    private scene: Phaser.Scene,
    private cam: CameraController,
    private fx: Particles,
    private layer: Phaser.GameObjects.Layer,
    seed: number,
  ) {
    CLOUD_KEYS.forEach((k, i) => {
      if (!scene.textures.exists(k)) scene.textures.addCanvas(k, cloudCanvas(seed * 7 + i * 131 + 3));
    });
    this.overlay = new Phaser.GameObjects.Rectangle(scene, 0, 0, 10, 10, 0x000000, 1).setOrigin(0, 0).setAlpha(0);
    layer.add(this.overlay);
    this.bolt = scene.make.graphics({}, false).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(this.bolt);
    this.flash = new Phaser.GameObjects.Rectangle(scene, 0, 0, 10, 10, 0xc8d4ff, 1).setOrigin(0, 0).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(this.flash);
    this.next = 120 + (seed % 60);
  }

  get raining() {
    return this.kind === 'rain';
  }

  /** how lit-up the sky is right now by lightning (0..1), for the night grade */
  get lightning() {
    return this.flashA;
  }

  set(k: WeatherKind) {
    this.kind = k;
    this.targetShade = k === 'rain' ? 0.16 : k === 'cloudy' ? 0.06 : k === 'mist' ? 0.14 : 0;
    this.tint = k === 'mist' ? 0xd8dce8 : k === 'rain' ? 0x101828 : 0x101420;
    this.wind = k === 'rain' ? 1.8 : k === 'cloudy' ? 1.3 : 1;
    // about half of all rain comes with thunder
    this.storm = k === 'rain' && Math.random() < 0.6;
    this.stormT = 3 + Math.random() * 6;
    this.onChange?.(k);
  }

  update(dt: number) {
    if (!this.enabled) {
      this.overlay.setAlpha(0);
      this.flash.setAlpha(0);
      this.bolt.clear();
      for (const sh of this.shadows) sh.img.setVisible(false);
      return;
    }
    this.t += dt;
    if (this.source) {
      const k = this.source();
      if (k !== this.kind) this.set(k);
    } else if (this.t > this.next) {
      this.t = 0;
      this.next = 150 + Math.random() * 120;
      const r = Math.random();
      this.set(r < 0.45 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.88 ? 'rain' : 'mist');
    }
    const stormy = this.storm && this.kind === 'rain';
    this.shade += ((this.targetShade + (stormy ? 0.06 : 0)) - this.shade) * Math.min(1, dt * 0.4);
    const v = this.cam.view(40);
    this.overlay.setPosition(v.x0, v.y0).setSize(v.x1 - v.x0, v.y1 - v.y0);
    this.overlay.setFillStyle(this.tint, 1);
    this.overlay.setAlpha(this.shade);
    const close = this.cam.zoom > 1.1;
    // rain
    if (this.kind === 'rain' && close) {
      const area = ((v.x1 - v.x0) * (v.y1 - v.y0)) / 40000;
      const n = Math.min(stormy ? 20 : 14, area * (stormy ? 7 : 5)) * dt * 30;
      const slant = stormy ? -55 : -30;
      for (let i = 0; i < n; i++) {
        const x = v.x0 + Math.random() * (v.x1 - v.x0);
        const y = v.y0 + Math.random() * (v.y1 - v.y0);
        this.fx.emit({ frame: 'fx/drop', x, y, z: 40, vz: -260, vx: slant, g: 0, life: 0.16, alpha: 0.55, ground: 'die' });
        if (Math.random() < 0.25) this.fx.emit({ frame: 'fx/dot', x: x - 5, y, life: 0.2, s0: 1, s1: 2, alpha: 0.5, tint: 0xc8e0f0 });
      }
    }
    // mist wisps
    if (this.kind === 'mist' && close && Math.random() < dt * 3) {
      const x = v.x0 + Math.random() * (v.x1 - v.x0);
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      this.fx.emit({ frame: 'fx/puff6', x, y, vx: 6, life: 6, s0: 3, s1: 6, alpha: 0.12, tint: 0xe8ecf4 });
    }
    // low morning mist that burns off as the sun gets up
    const dm = this.dawn?.() ?? 0;
    if (dm > 0.05 && this.kind !== 'rain' && this.cam.zoom > 0.8 && Math.random() < dt * 5 * dm) {
      const x = v.x0 + Math.random() * (v.x1 - v.x0);
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      this.fx.emit({ frame: 'fx/puff6', x, y, vx: 5 * this.wind, life: 7, s0: 3, s1: 5.5, alpha: 0.07 * dm + 0.03, tint: 0xf0ecf4 });
    }
    this.updateShadows(dt, v);
    this.updateStorm(dt, v, stormy);
  }

  /** cloud shadows: a few even on fine days, a sky-full when it's grey */
  private updateShadows(dt: number, v: { x0: number; y0: number; x1: number; y1: number }) {
    const vw = v.x1 - v.x0;
    const vh = v.y1 - v.y0;
    const density = this.kind === 'sunny' ? 1.3 : this.kind === 'cloudy' ? 4.2 : this.kind === 'rain' ? 5.5 : 0.6;
    const want = Math.min(18, Math.max(this.kind === 'mist' ? 0 : 1, Math.round(((vw * vh) / 1e6) * density)));
    const alpha = this.kind === 'sunny' ? 0.1 : this.kind === 'rain' ? 0.15 : 0.13;
    let live = 0;
    for (const sh of this.shadows) if (sh.fade >= 0) live++;
    while (live < want) {
      const k = CLOUD_KEYS[Math.floor(Math.random() * CLOUD_KEYS.length)];
      const img = this.scene.make.image({ x: 0, y: 0, key: k }, false).setTint(0x0c0c1c).setAlpha(0);
      this.layer.addAt(img, 0);
      const w = 220 + Math.random() * 300;
      // new clouds start anywhere at first, afterwards drift in from upwind
      const fresh = this.shadows.length === 0;
      this.shadows.push({ img, x: fresh ? v.x0 + Math.random() * vw : v.x0 - w * 0.6 - Math.random() * vw * 0.3, y: v.y0 - 60 + Math.random() * (vh + 120), w, a: alpha * (0.7 + Math.random() * 0.5), fade: fresh ? 1 : 0.01 });
      live++;
    }
    // too many for the sky: let some fade
    let extra = live - want;
    for (const sh of this.shadows) {
      if (extra <= 0) break;
      if (sh.fade > 0) {
        sh.fade = -sh.fade;
        extra--;
      }
    }
    const speed = 9 + 7 * this.wind;
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const sh = this.shadows[i];
      sh.x += speed * dt;
      sh.y += speed * 0.18 * dt;
      if (sh.fade > 0) sh.fade = Math.min(1, sh.fade + dt * 0.35);
      else sh.fade = Math.min(-0.001, sh.fade + dt * 0.35);
      const gone = sh.fade > -0.01 && sh.fade < 0;
      // blown out of view: recycle upwind rather than pop
      if (sh.x - sh.w / 2 > v.x1 + 80 || sh.y - sh.w > v.y1 + 200 || sh.x + sh.w * 2 < v.x0 - 600) {
        sh.x = v.x0 - sh.w * 0.6 - Math.random() * 200;
        sh.y = v.y0 - 60 + Math.random() * (vh + 120);
      }
      if (gone) {
        sh.img.destroy();
        this.shadows.splice(i, 1);
        continue;
      }
      sh.img
        .setVisible(true)
        .setPosition(sh.x, sh.y)
        .setDisplaySize(sh.w, sh.w * 0.54)
        .setAlpha(sh.a * Math.abs(sh.fade));
    }
  }

  private updateStorm(dt: number, v: { x0: number; y0: number; x1: number; y1: number }, stormy: boolean) {
    if (stormy) {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = 7 + Math.random() * 16;
        this.strike(v);
      }
    }
    // flicker sequence
    let target = 0;
    for (const f of this.flashes) {
      f.at -= dt;
      if (f.at <= 0 && f.at > -0.09) target = Math.max(target, f.a);
    }
    this.flashes = this.flashes.filter((f) => f.at > -0.1);
    this.flashA = Math.max(target, this.flashA - dt * 5);
    this.flash.setPosition(v.x0, v.y0).setSize(v.x1 - v.x0, v.y1 - v.y0).setAlpha(this.flashA * 0.42);
    // the bolt itself
    this.bolt.clear();
    if (this.boltT > 0) {
      this.boltT -= dt;
      const a = Math.min(1, this.boltT / 0.12) * (0.6 + this.flashA * 0.4);
      const p = this.boltPts;
      const z = 1 / this.cam.zoom;
      this.bolt.lineStyle(9 * z, 0x6a80ff, 0.3 * a);
      this.drawBolt(p);
      this.bolt.lineStyle(4 * z, 0xb8c8ff, 0.8 * a);
      this.drawBolt(p);
      this.bolt.lineStyle(2 * z, 0xffffff, a);
      this.drawBolt(p);
    }
  }

  private drawBolt(p: number[]) {
    this.bolt.beginPath();
    this.bolt.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) {
      if (p[i] === -1e9) {
        this.bolt.strokePath();
        this.bolt.beginPath();
        this.bolt.moveTo(p[i + 2], p[i + 3]);
        i += 2;
        continue;
      }
      this.bolt.lineTo(p[i], p[i + 1]);
    }
    this.bolt.strokePath();
  }

  /** a bolt lands somewhere on (or near) the screen */
  private strike(v: { x0: number; y0: number; x1: number; y1: number }) {
    const vw = v.x1 - v.x0;
    const vh = v.y1 - v.y0;
    const onScreen = Math.random() < 0.55;
    const pulses = 1 + Math.floor(Math.random() * 3);
    let at = 0;
    for (let i = 0; i < pulses; i++) {
      this.flashes.push({ at, a: (onScreen ? 0.8 : 0.45) * (i === 0 ? 1 : 0.6 + Math.random() * 0.4) });
      at += 0.07 + Math.random() * 0.12;
    }
    const dist = onScreen ? 0.25 + Math.random() * 0.4 : 1 + Math.random() * 2.5;
    // sound travels slower than light
    setTimeout(() => audio.play('thunder', { volume: Math.min(1, 0.95 / dist + 0.15), rate: dist > 1.5 ? 0.8 : 1 }), dist * 900);
    if (!onScreen) return;
    const gx = v.x0 + vw * (0.15 + Math.random() * 0.7);
    const gy = v.y0 + vh * (0.3 + Math.random() * 0.6);
    // jagged path from above the top of the screen, with a fork or two
    const pts: number[] = [];
    let x = gx + (Math.random() - 0.5) * vw * 0.3;
    let y = v.y0 - 20;
    const steps = 14;
    const dx = (gx - x) / steps;
    const dy = (gy - y) / steps;
    pts.push(x, y);
    const forks: [number, number][] = [];
    for (let i = 1; i <= steps; i++) {
      x += dx + (Math.random() - 0.5) * vw * 0.035;
      y += dy;
      if (i === steps) {
        x = gx;
        y = gy;
      }
      pts.push(x, y);
      if (i > 3 && i < steps - 2 && Math.random() < 0.18) forks.push([x, y]);
    }
    for (const [fx, fy] of forks) {
      pts.push(-1e9, 0, fx, fy);
      let ux = fx;
      let uy = fy;
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 4; k++) {
        ux += dir * (6 + Math.random() * 14);
        uy += dy * (0.5 + Math.random() * 0.5);
        pts.push(ux, uy);
      }
    }
    this.boltPts = pts;
    this.boltT = 0.28;
    // sparks where it lands
    this.fx.burst(10, { frame: 'fx/spark', x: gx, y: gy, z: 2, life: 0.5, g: 300, ground: 'die', tint: 0xd8e4ff }, 90, 80);
    this.fx.burst(6, { frame: 'fx/puff4', x: gx, y: gy, life: 1.4, s0: 1, s1: 2.6, tint: 0x6a6a70, alpha: 0.6, drag: 2 }, 20, 12);
    this.onStrike?.(gx, gy);
  }
}

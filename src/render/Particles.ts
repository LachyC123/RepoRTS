import type Phaser from 'phaser';
import { art } from './art/ArtRegistry';

interface P {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
  drag: number;
  spin: number;
  frames?: string[];
  fps?: number;
  ground: 'stop' | 'die' | 'bounce' | 'none';
  /** vertical scale relative to horizontal (rings lie flat in perspective) */
  sy: number;
  /** alpha fades from the start instead of only at the end */
  fadeIn: boolean;
}

export interface Emit {
  frame: string;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  g?: number;
  life: number;
  s0?: number;
  s1?: number;
  alpha?: number;
  tint?: number;
  drag?: number;
  spin?: number;
  frames?: string[];
  fps?: number;
  ground?: P['ground'];
  add?: boolean;
  /** initial rotation (rad) */
  rot?: number;
  /** vertical scale factor (default 1) */
  sy?: number;
  flipX?: boolean;
  /** fade out across the whole life (flashes, rings) */
  fadeAll?: boolean;
}

/**
 * Lightweight pooled particle system with pseudo-3D height (z) so debris arcs and lands, smoke rises,
 * and sparks scatter. Count is capped and scaled by the graphics quality setting.
 */
export class Particles {
  private live: P[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  max = 700;
  quality = 1;

  constructor(
    private scene: Phaser.Scene,
    private layer: Phaser.GameObjects.Layer,
  ) {}

  get count() {
    return this.live.length;
  }

  emit(e: Emit) {
    if (this.live.length >= this.max * this.quality) return;
    const f = art.tryGet(e.frame);
    if (!f) return;
    let img = this.pool.pop();
    if (!img) {
      img = this.scene.make.image({ x: 0, y: 0, key: f.key, frame: f.frame }, false);
      this.layer.add(img);
    } else img.setTexture(f.key, f.frame).setVisible(true);
    img.setOrigin(0.5, 0.5);
    img.setBlendMode(e.add ? 1 : 0);
    if (e.tint !== undefined) img.setTint(e.tint);
    else img.clearTint();
    img.setRotation(e.rot ?? 0);
    img.setFlipX(!!e.flipX);
    const p: P = {
      img,
      x: e.x,
      y: e.y,
      z: e.z ?? 0,
      vx: e.vx ?? 0,
      vy: e.vy ?? 0,
      vz: e.vz ?? 0,
      g: e.g ?? 0,
      life: 0,
      max: e.life,
      s0: e.s0 ?? 1,
      s1: e.s1 ?? e.s0 ?? 1,
      a0: e.alpha ?? 1,
      drag: e.drag ?? 0,
      spin: e.spin ?? 0,
      frames: e.frames,
      fps: e.fps,
      ground: e.ground ?? 'none',
      sy: e.sy ?? 1,
      fadeIn: !!e.fadeAll,
    };
    this.live.push(p);
  }

  burst(n: number, base: Omit<Emit, 'vx' | 'vy' | 'vz'>, speed: number, up = 0, spread = Math.PI * 2, dir = 0) {
    const cnt = Math.max(1, Math.round(n * this.quality));
    for (let i = 0; i < cnt; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit({ ...base, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: up * (0.5 + Math.random() * 0.7), life: base.life * (0.7 + Math.random() * 0.5) });
    }
  }

  update(dt: number) {
    let k = 0;
    for (const p of this.live) {
      p.life += dt;
      if (p.life >= p.max) {
        p.img.setVisible(false);
        this.pool.push(p.img);
        continue;
      }
      const t = p.life / p.max;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy *= d;
        p.vz *= d;
      }
      p.vz -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0 && p.ground !== 'none') {
        if (p.ground === 'die') {
          p.life = p.max;
        } else if (p.ground === 'bounce' && Math.abs(p.vz) > 20) {
          p.z = 0;
          p.vz = -p.vz * 0.35;
          p.vx *= 0.5;
          p.vy *= 0.5;
        } else {
          p.z = 0;
          p.vz = 0;
          p.vx = 0;
          p.vy = 0;
          p.spin = 0;
        }
      }
      p.img.setPosition(Math.round(p.x), Math.round(p.y - p.z));
      const sc = p.s0 + (p.s1 - p.s0) * t;
      p.img.setScale(sc, sc * p.sy);
      p.img.setAlpha(p.a0 * (p.fadeIn ? 1 - t : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1));
      if (p.spin) p.img.rotation += p.spin * dt;
      if (p.frames && p.fps) {
        const fr = art.get(p.frames[Math.floor(p.life * p.fps) % p.frames.length]);
        p.img.setTexture(fr.key, fr.frame);
      }
      this.live[k++] = p;
    }
    this.live.length = k;
  }
}

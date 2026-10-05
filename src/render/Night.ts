import Phaser from 'phaser';
import { hash2 } from '../core/Random';
import { TILE } from '../data/constants';
import { T } from '../sim/map/GameMap';
import type { World } from '../sim/World';
import type { CameraController } from './CameraController';

const GLOW_KEY = 'night_glow';

interface Fly {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  bx: number;
  by: number;
  ph: number;
  sp: number;
}

/** 0..1 bump centred on `c` with half-width `w` */
const bump = (p: number, c: number, w: number) => {
  const k = Math.max(0, 1 - Math.abs(p - c) / w);
  return k * k * (3 - 2 * k);
};

/**
 * Light through the day: a warm golden grade at sunrise and sunset, a cool moonlit grade at night
 * (multiplied, so colours stay rich instead of going grey), warm light pooling from windows,
 * cottages, campfires and anything on fire, and fireflies over the meadows after dark.
 */
export class NightLight {
  private night: Phaser.GameObjects.Rectangle;
  private warm: Phaser.GameObjects.Rectangle;
  private haze: Phaser.GameObjects.Rectangle;
  private pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private flies: Fly[] = [];
  /** street lamps (modern) or lantern posts (medieval) along roads in towns: x, y pairs */
  private lamps: number[] | null = null;
  enabled = true;
  /** lightning lights up the night for a moment (0..1, from Weather) */
  lightning: () => number = () => 0;
  /** units the player can see (fog) */
  unitVisible: (id: number) => boolean = () => true;
  /** buildings the player can see (fog) */
  visible: (x: number, y: number) => boolean = () => true;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private cam: CameraController,
    private layer: Phaser.GameObjects.Layer,
  ) {
    if (!scene.textures.exists(GLOW_KEY)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      scene.textures.addCanvas(GLOW_KEY, c);
    }
    const rect = (color: number, blend: Phaser.BlendModes) => {
      const r = new Phaser.GameObjects.Rectangle(scene, 0, 0, 10, 10, color, 1).setOrigin(0, 0).setAlpha(0).setBlendMode(blend);
      layer.add(r);
      return r;
    };
    this.warm = rect(0xffb070, Phaser.BlendModes.MULTIPLY);
    this.haze = rect(0x3a1c08, Phaser.BlendModes.ADD);
    this.night = rect(0x3c4c8a, Phaser.BlendModes.MULTIPLY);
  }

  private light(x: number, y: number, r: number, color: number, a: number) {
    let img = this.pool[this.used];
    if (!img) {
      img = this.scene.make.image({ x, y, key: GLOW_KEY }, false).setBlendMode(Phaser.BlendModes.ADD);
      this.layer.add(img);
      this.pool.push(img);
    }
    this.used++;
    img.setPosition(x, y).setScale(r / 32, (r / 32) * 0.75).setTint(color).setAlpha(a).setVisible(true);
  }

  /** sunrise and sunset, 0..1 */
  get golden() {
    const p = this.world.sky.phase;
    return Math.max(bump(p, 0.1, 0.08), bump(p, 0.585, 0.085));
  }

  update(time: number, dt = 1 / 60) {
    const sky = this.world.sky;
    const dark = this.enabled ? sky.darkness : 0;
    const gold = this.enabled ? this.golden * (sky.weather === 'rain' ? 0.35 : sky.weather === 'cloudy' ? 0.7 : 1) : 0;
    const evening = sky.phase > 0.4;
    const v = this.cam.view(60);
    const w0 = v.x1 - v.x0;
    const h0 = v.y1 - v.y0;
    for (const r of [this.night, this.warm, this.haze]) r.setPosition(v.x0, v.y0).setSize(w0, h0);
    const flash = this.lightning();
    this.night.setAlpha(dark * 0.62 * (1 - flash * 0.8));
    this.warm.setFillStyle(evening ? 0xff9e62 : 0xffc48a, 1).setAlpha(gold * 0.5);
    this.haze.setAlpha(gold * 0.55);
    this.used = 0;
    // windows start glowing as the sun goes down
    const glow = Math.max(dark, gold * 0.35);
    if (glow > 0.05) {
      const w = this.world;
      const on = (x: number, y: number) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
      for (const b of w.buildings) {
        if (b.destroyed || !b.built || !on(b.x, b.y) || !this.visible(b.x, b.y)) continue;
        const cat = b.def.category;
        if (cat === 'landmark') continue;
        // torches along the walls, on the gates and on the towers
        const id = b.def.id;
        if (id === 'wall' || id === 'gatehouse' || id === 'watchtower' || id === 'outpost_tower') {
          if (id === 'wall' && b.id % 3 !== 0) continue;
          const tf = 0.75 + Math.sin(time * 9 + b.id * 1.7) * 0.15 + Math.sin(time * 17 + b.id) * 0.1;
          const ty = b.y - (id === 'wall' ? 10 : b.size * 9);
          this.light(b.x, ty, id === 'wall' ? 16 : 26, 0xffa040, dark * 0.75 * tf);
          this.light(b.x, ty, 5, 0xfff0b0, dark * 0.9 * tf);
          continue;
        }
        const flick = 0.85 + Math.sin(time * 7 + b.id) * 0.08 + Math.sin(time * 13.1 + b.id * 3) * 0.05;
        const r = b.size * TILE * (cat === 'core' ? 1.1 : 0.8);
        this.light(b.x, b.y - b.size * 4, r, cat === 'core' ? 0xffc070 : 0xffa858, glow * 0.5 * flick);
        if (b.burnT > 0) this.light(b.x, b.y - 6, r * 1.6, 0xff7a30, Math.max(0.3, glow) * 0.9 * flick);
      }
      for (const s of w.settlements) {
        if (!on(s.cx, s.cy) || !this.visible(s.cx, s.cy)) continue;
        for (let k = 0; k < s.cottages.length; k += 2) {
          const i = s.cottages[k];
          const x = (i % w.map.w) * TILE + 8;
          const y = Math.floor(i / w.map.w) * TILE + 6;
          if (!on(x, y)) continue;
          this.light(x, y, 18, 0xffb060, glow * 0.45 * (0.9 + Math.sin(time * 5 + i) * 0.1));
        }
      }
      for (const c of w.social.campfires) {
        if (!on(c.x, c.y)) continue;
        this.light(c.x, c.y - 4, 46, 0xff9040, Math.max(0.25, glow) * 0.95 * (0.85 + Math.sin(time * 11 + c.id) * 0.15));
      }
      const modern = w.setup.era === 'modern';
      if (dark > 0.2) {
        const lamps = this.lamps ?? (this.lamps = this.findLamps());
        for (let k = 0; k < lamps.length; k += 2) {
          const x = lamps[k];
          const y = lamps[k + 1];
          if (!on(x, y) || !this.visible(x, y)) continue;
          const f = modern ? 1 : 0.85 + Math.sin(time * 8 + k) * 0.1;
          this.light(x, y + 4, modern ? 30 : 22, modern ? 0xffe6b0 : 0xffa848, dark * (modern ? 0.5 : 0.55) * f);
          this.light(x, y - 8, 4, 0xfff4d0, dark * 0.9);
        }
      }
      for (const u of w.units) {
        if (!u.alive || !on(u.x, u.y)) continue;
        if (u.burnT > 0) this.light(u.x, u.y - 6, 22, 0xff7030, Math.max(0.3, glow) * 0.9);
        if (dark < 0.35 || !this.unitVisible(u.id)) continue;
        const look = u.def.look;
        if (look.body === 'vehicle' || look.body === 'engine') {
          // headlamps throw a pool of light ahead of whatever is driving
          if (!modern || look.body !== 'vehicle') continue;
          const sp = Math.hypot(u.vx, u.vy);
          const fx = sp > 1 ? u.vx / sp : u.facing < 0 ? -1 : 1;
          const fy = sp > 1 ? u.vy / sp : 0;
          this.light(u.x + fx * 20, u.y - 2 + fy * 16, 26, 0xe8f0ff, dark * 0.55);
          continue;
        }
        // one in four soldiers carries a torch (a torch-lit column on the march) or a flashlight
        if (u.id % 4 !== 0 || u.def.special === 'worker') continue;
        const tf = 0.8 + Math.sin(time * 10 + u.id) * 0.12 + Math.sin(time * 23 + u.id * 2) * 0.08;
        if (modern) this.light(u.x + (u.facing < 0 ? -8 : 8), u.y - 2, 14, 0xdce8ff, dark * 0.5);
        else this.light(u.x + 3, u.y - 14, 20, 0xffa048, dark * 0.75 * tf);
      }
    }
    for (let k = this.used; k < this.pool.length; k++) this.pool[k].setVisible(false);
    this.updateFlies(time, dt, dark, v);
  }

  private findLamps(): number[] {
    const w = this.world;
    const m = w.map;
    const out: number[] = [];
    const reach = (w.setup.era === 'modern' ? 9 : 6) * TILE;
    for (const st of w.settlements) {
      const r0 = Math.ceil(reach / TILE);
      const cx = Math.floor(st.cx / TILE);
      const cy = Math.floor(st.cy / TILE);
      for (let ty = cy - r0; ty <= cy + r0; ty++)
        for (let tx = cx - r0; tx <= cx + r0; tx++) {
          if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
          if (m.terrain[ty * m.w + tx] !== T.ROAD) continue;
          if ((hash2(tx, ty, 77) >>> 0) % 7 !== 0) continue;
          const x = tx * TILE + 8;
          const y = ty * TILE + 8;
          if (Math.hypot(x - st.cx, y - st.cy) > reach || Math.hypot(x - st.cx, y - st.cy) < 3 * TILE) continue;
          out.push(x, y);
        }
    }
    return out;
  }

  /** fireflies drift over grass and meadow on dry nights, blinking slowly */
  private updateFlies(time: number, dt: number, dark: number, v: { x0: number; y0: number; x1: number; y1: number }) {
    const sky = this.world.sky;
    const want = this.enabled && dark > 0.5 && sky.weather !== 'rain' && this.cam.zoom >= 0.95 ? Math.min(46, Math.round((((v.x1 - v.x0) * (v.y1 - v.y0)) / 1e5) * 5 * (dark - 0.4))) : 0;
    const m = this.world.map;
    let tries = 0;
    while (this.flies.length < want && tries++ < 12) {
      const x = v.x0 + Math.random() * (v.x1 - v.x0);
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
      const t = m.terrain[ty * m.w + tx];
      if (t !== T.GRASS && t !== T.MEADOW && t !== T.FOREST && t !== T.MARSH) continue;
      if (!this.visible(x, y)) continue;
      const img = this.scene.make.image({ x, y, key: GLOW_KEY }, false).setBlendMode(Phaser.BlendModes.ADD).setTint(0xd8ff6a);
      this.layer.add(img);
      this.flies.push({ img, x, y, bx: x, by: y, ph: Math.random() * 10, sp: 0.4 + Math.random() * 0.6 });
    }
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      const out = f.x < v.x0 - 40 || f.x > v.x1 + 40 || f.y < v.y0 - 40 || f.y > v.y1 + 40;
      if (this.flies.length > want || out) {
        f.img.destroy();
        this.flies.splice(i, 1);
        continue;
      }
      const t = time * f.sp + f.ph;
      f.x = f.bx + Math.sin(t * 0.9) * 14 + Math.sin(t * 2.3) * 4;
      f.y = f.by + Math.cos(t * 0.7) * 9 + Math.sin(t * 1.9) * 3 - 4;
      f.bx += Math.sin(t * 0.13) * dt * 3;
      const blink = Math.max(0, Math.sin(time * 1.7 * f.sp + f.ph * 3));
      const a = blink * blink * blink * dark;
      f.img.setPosition(f.x, f.y).setScale(0.07 + blink * 0.04).setAlpha(a);
    }
  }
}

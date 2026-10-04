import Phaser from 'phaser';
import { TILE } from '../data/constants';
import type { World } from '../sim/World';
import type { CameraController } from './CameraController';

const GLOW_KEY = 'night_glow';

/**
 * Day and night: as the sim's clock turns, a cool dark grade settles over the valley and warm light
 * pools appear in windows, cottages, campfires and anything on fire.
 */
export class NightLight {
  private overlay: Phaser.GameObjects.Rectangle;
  private pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  enabled = true;
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
    this.overlay = new Phaser.GameObjects.Rectangle(scene, 0, 0, 10, 10, 0x0a1030, 1).setOrigin(0, 0).setAlpha(0);
    layer.add(this.overlay);
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

  update(time: number) {
    const dark = this.enabled ? this.world.sky.darkness : 0;
    const v = this.cam.view(60);
    this.overlay.setPosition(v.x0, v.y0).setSize(v.x1 - v.x0, v.y1 - v.y0);
    this.overlay.setAlpha(dark * 0.42);
    this.used = 0;
    if (dark > 0.05) {
      const w = this.world;
      const on = (x: number, y: number) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
      for (const b of w.buildings) {
        if (b.destroyed || !b.built || !on(b.x, b.y) || !this.visible(b.x, b.y)) continue;
        const cat = b.def.category;
        if (cat === 'landmark' || b.def.id === 'wall' || b.def.id === 'gatehouse') continue;
        const flick = 0.85 + Math.sin(time * 7 + b.id) * 0.08 + Math.sin(time * 13.1 + b.id * 3) * 0.05;
        const r = b.size * TILE * (cat === 'core' ? 1.1 : 0.8);
        this.light(b.x, b.y - b.size * 4, r, cat === 'core' ? 0xffc070 : 0xffa858, dark * 0.5 * flick);
        if (b.burnT > 0) this.light(b.x, b.y - 6, r * 1.6, 0xff7a30, dark * 0.9 * flick);
      }
      for (const s of w.settlements) {
        if (!on(s.cx, s.cy) || !this.visible(s.cx, s.cy)) continue;
        for (let k = 0; k < s.cottages.length; k += 2) {
          const i = s.cottages[k];
          const x = (i % w.map.w) * TILE + 8;
          const y = Math.floor(i / w.map.w) * TILE + 6;
          if (!on(x, y)) continue;
          this.light(x, y, 18, 0xffb060, dark * 0.45 * (0.9 + Math.sin(time * 5 + i) * 0.1));
        }
      }
      for (const c of w.social.campfires) {
        if (!on(c.x, c.y)) continue;
        this.light(c.x, c.y - 4, 46, 0xff9040, dark * 0.95 * (0.85 + Math.sin(time * 11 + c.id) * 0.15));
      }
      for (const u of w.units) {
        if (u.burnT > 0 && u.alive && on(u.x, u.y)) this.light(u.x, u.y - 6, 22, 0xff7030, dark * 0.9);
      }
    }
    for (let k = this.used; k < this.pool.length; k++) this.pool[k].setVisible(false);
  }
}

import Phaser from 'phaser';
import type { CameraController } from './CameraController';
import type { Particles } from './Particles';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'mist';

/**
 * Atmospheric weather (no gameplay penalties): drifting cloud shadows, light rain with splashes
 * and puddle glints, morning mist, and a gentle colour grade. Changes every few minutes.
 */
export class Weather {
  kind: WeatherKind = 'sunny';
  private next: number;
  private t = 0;
  private overlay: Phaser.GameObjects.Rectangle;
  private shade = 0;
  private targetShade = 0;
  private tint = 0x000000;
  private shadows: { img: Phaser.GameObjects.Image; x: number; y: number; s: number }[] = [];
  enabled = true;
  wind = 1;
  /** the simulation decides the weather; this only draws it */
  source?: () => WeatherKind;
  onChange?: (k: WeatherKind) => void;

  constructor(
    private scene: Phaser.Scene,
    private cam: CameraController,
    private fx: Particles,
    private layer: Phaser.GameObjects.Layer,
    seed: number,
  ) {
    this.overlay = new Phaser.GameObjects.Rectangle(scene, 0, 0, 10, 10, 0x000000, 1).setOrigin(0, 0).setAlpha(0);
    layer.add(this.overlay);
    this.next = 120 + (seed % 60);
  }

  get raining() {
    return this.kind === 'rain';
  }

  set(k: WeatherKind) {
    this.kind = k;
    this.targetShade = k === 'rain' ? 0.16 : k === 'cloudy' ? 0.08 : k === 'mist' ? 0.14 : 0;
    this.tint = k === 'mist' ? 0xd8dce8 : k === 'rain' ? 0x101828 : 0x101420;
    this.wind = k === 'rain' ? 1.8 : k === 'cloudy' ? 1.3 : 1;
    this.onChange?.(k);
  }

  update(dt: number) {
    if (!this.enabled) {
      this.overlay.setAlpha(0);
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
    this.shade += (this.targetShade - this.shade) * Math.min(1, dt * 0.4);
    const v = this.cam.view(40);
    this.overlay.setPosition(v.x0, v.y0).setSize(v.x1 - v.x0, v.y1 - v.y0);
    this.overlay.setFillStyle(this.tint, 1);
    this.overlay.setAlpha(this.shade);
    const close = this.cam.zoom > 1.1;
    // rain
    if (this.kind === 'rain' && close) {
      const area = ((v.x1 - v.x0) * (v.y1 - v.y0)) / 40000;
      const n = Math.min(14, area * 5) * dt * 30;
      for (let i = 0; i < n; i++) {
        const x = v.x0 + Math.random() * (v.x1 - v.x0);
        const y = v.y0 + Math.random() * (v.y1 - v.y0);
        this.fx.emit({ frame: 'fx/drop', x, y, z: 40, vz: -260, vx: -30, g: 0, life: 0.16, alpha: 0.55, ground: 'die' });
        if (Math.random() < 0.25) this.fx.emit({ frame: 'fx/dot', x: x - 5, y, life: 0.2, s0: 1, s1: 2, alpha: 0.5, tint: 0xc8e0f0 });
      }
    }
    // mist wisps
    if (this.kind === 'mist' && close && Math.random() < dt * 3) {
      const x = v.x0 + Math.random() * (v.x1 - v.x0);
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      this.fx.emit({ frame: 'fx/puff6', x, y, vx: 6, life: 6, s0: 3, s1: 6, alpha: 0.12, tint: 0xe8ecf4 });
    }
    // drifting cloud shadows (cloudy or rain)
    const wantShadows = (this.kind === 'cloudy' || this.kind === 'rain') && close ? 4 : 0;
    while (this.shadows.length < wantShadows) {
      const f = this.scene.textures.getFrame('__WHITE');
      void f;
      const img = this.scene.make.image({ x: 0, y: 0, key: '__WHITE' }, false).setTint(0x101018).setAlpha(0.07);
      this.layer.add(img);
      this.shadows.push({ img, x: v.x0 - 200 + Math.random() * (v.x1 - v.x0), y: v.y0 + Math.random() * (v.y1 - v.y0), s: 60 + Math.random() * 80 });
    }
    while (this.shadows.length > wantShadows) this.shadows.pop()!.img.destroy();
    for (const sh of this.shadows) {
      sh.x += 10 * this.wind * dt;
      if (sh.x > v.x1 + sh.s) sh.x = v.x0 - sh.s * 2;
      sh.img.setPosition(sh.x, sh.y).setDisplaySize(sh.s * 2.4, sh.s);
    }
  }
}

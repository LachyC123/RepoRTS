import Phaser from 'phaser';
import type { Unit } from '../sim/units/Unit';
import type { World } from '../sim/World';
import { art } from './art/ArtRegistry';
import { unitFrameName } from './art/buildArt';
import type { SortObj, YSortLayer } from './YSortLayer';

type USprite = Phaser.GameObjects.Image & { sy: number; uid: number; lastFrame: string };

/**
 * Draws every unit and corpse as a pooled image in the y-sorted world layer, picking animation
 * frames from the sim state (walk cycle speed from velocity, attack wind-up/strike/recover,
 * death collapse) and applying hit flashes. Interpolates between sim ticks for smooth motion.
 */
export class UnitRenderer {
  private sprites = new Map<number, USprite>();
  private pool: USprite[] = [];
  private corpseSprites = new Map<number, USprite>();
  /** faction visibility test (fog) */
  visible: (u: Unit) => boolean = () => true;
  hidden = false;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private ylayer: YSortLayer,
  ) {}

  private take(): USprite {
    const s = this.pool.pop();
    if (s) {
      s.setVisible(true).setAlpha(1).clearTint();
      return s;
    }
    const f = art.get(unitFrameName('militia', 'blue', 0).replace('blue', this.world.factions[0].color.id));
    const o = this.scene.make.image({ x: 0, y: 0, key: f.key, frame: f.frame }, false) as USprite;
    o.lastFrame = '';
    return o;
  }

  private release(s: USprite) {
    this.ylayer.remove(s as SortObj);
    s.setVisible(false);
    this.pool.push(s);
  }

  frameFor(u: Unit): number {
    const t = this.world.time;
    if (!u.alive) {
      const d = t - u.deathT;
      return d < 0.12 ? 9 : d < 0.3 ? 10 : 11;
    }
    if (u.def.deploy && u.deploy < 1) return u.deploy > 0.5 ? 13 : 12;
    if (u.windup > 0) return 6;
    if (u.anim === 'attack') {
      if (u.animT < 0.16) return 7;
      if (u.animT < 0.34) return 8;
    }
    if (u.anim === 'cheer') return Math.floor(u.animT * 6) % 2 ? 6 : 0;
    const spd = Math.hypot(u.vx, u.vy);
    if (spd > 6) {
      const rate = u.def.tags.includes('cavalry') ? 0.055 : 0.07;
      const phase = (t * spd * rate + u.id * 0.37) % 4;
      return 2 + Math.floor(phase);
    }
    return 0 + (Math.floor(t * 1.4 + u.id * 0.31) % 2);
  }

  update(alpha: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const w = this.world;
    const seen = new Set<number>();
    for (const u of w.units) {
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      const onScreen = x > view.x0 - 30 && x < view.x1 + 30 && y > view.y0 - 10 && y < view.y1 + 50;
      if (!onScreen || this.hidden || !this.visible(u)) continue;
      seen.add(u.id);
      let s = this.sprites.get(u.id);
      if (!s) {
        s = this.take();
        s.uid = u.id;
        s.lastFrame = '';
        this.sprites.set(u.id, s);
        this.ylayer.add(s as SortObj);
      }
      this.apply(s, u, x, y);
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        this.release(s);
        this.sprites.delete(id);
      }
    }
    // corpses
    const cseen = new Set<number>();
    for (const c of w.corpses) {
      const onScreen = c.x > view.x0 - 30 && c.x < view.x1 + 30 && c.y > view.y0 - 10 && c.y < view.y1 + 50;
      if (!onScreen || this.hidden || !this.visible(c)) continue;
      cseen.add(c.id);
      let s = this.corpseSprites.get(c.id);
      if (!s) {
        s = this.take();
        s.uid = c.id;
        s.lastFrame = '';
        this.corpseSprites.set(c.id, s);
        this.ylayer.add(s as SortObj);
      }
      this.apply(s, c, c.x, c.y);
      const age = w.time - c.deathT;
      // corpses leave the sim's update loop, so their hit flash never decays: flash only briefly
      if (age < 0.08) s.setTintFill(0xffffff);
      else s.clearTint();
      s.sy = c.y - (age > 0.4 ? 10 : 0);
      s.setAlpha(age > 9 ? Math.max(0, 1 - (age - 9) / 3) : 1);
    }
    for (const [id, s] of this.corpseSprites) {
      if (!cseen.has(id)) {
        this.release(s);
        this.corpseSprites.delete(id);
      }
    }
  }

  private apply(s: USprite, u: Unit, x: number, y: number) {
    const fr = this.frameFor(u);
    const color = this.world.factions[u.faction].color.id;
    const name = unitFrameName(u.def.id, color, fr);
    if (name !== s.lastFrame) {
      const f = art.tryGet(name);
      if (f) {
        s.setTexture(f.key, f.frame);
        s.setOrigin(f.ox, f.oy);
      }
      s.lastFrame = name;
    }
    s.setPosition(Math.round(x), Math.round(y));
    s.sy = y;
    s.setFlipX(u.facing < 0);
    if (u.hitFlash > 0.06) s.setTintFill(0xffffff);
    else if (u.hitFlash > 0) s.setTint(0xff9a8a);
    else if (u.routing > 0) s.setTint(0xd8d0e8);
    else s.clearTint();
  }

  spriteOf(id: number) {
    return this.sprites.get(id);
  }
}

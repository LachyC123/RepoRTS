import Phaser from 'phaser';
import { audio } from '../audio';
import type { SfxName } from '../audio';
import { TILE } from '../data/constants';
import type { World } from '../sim/World';
import { art } from './art/ArtRegistry';
import type { CameraController } from './CameraController';
import type { Particles } from './Particles';

interface Stuck {
  img: Phaser.GameObjects.Image;
  t: number;
}

interface Floater {
  txt: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  t: number;
  x: number;
  y: number;
}

const DUST = 0xc8b898;

/**
 * Turns simulation events into feel: impact sparks, dust, debris, stuck arrows, projectile flight,
 * screen shake, floating resource numbers and positional sound. Everything is culled to the view
 * and throttled so a 100-unit melee stays readable and cheap.
 */
export class FxDirector {
  private projImgs = new Map<number, { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }>();
  private projPool: { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }[] = [];
  private stuck: Stuck[] = [];
  private floaters: Floater[] = [];
  private floaterPool: Floater[] = [];
  reduced = false;
  shakeScale = 1;
  playerFaction = -1;
  /** optional: shake a tree being chopped */
  onChop?: (tileIdx: number) => void;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private fx: Particles,
    private cam: CameraController,
    private layer: Phaser.GameObjects.Layer,
    private groundLayer: Phaser.GameObjects.Layer,
  ) {
    const e = world.events;
    e.on('unitHit', (ev) => this.onHit(ev));
    e.on('unitDied', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, s0: 0.6, s1: 1.2, tint: DUST, alpha: 0.7, drag: 3 }, 18, 6);
      if (ev.type.startsWith('worker')) return;
      this.sfx(ev.type === 'wolf' ? 'unit_death' : 'unit_death', ev.x, ev.y, 0.5);
    });
    e.on('projectileFired', (ev) => {
      if (!this.near(ev.x, ev.y, 260)) return;
      const k = ev.kind;
      this.sfx(k === 'arrow' ? 'arrow_shoot' : k === 'bolt' ? 'bolt_shoot' : k === 'ballista' ? 'ballista_shoot' : 'catapult_launch', ev.x, ev.y, k === 'arrow' ? 0.35 : 0.7);
    });
    e.on('projectileLanded', (ev) => this.onLand(ev));
    e.on('charge', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      this.fx.burst(8, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.8, s0: 0.5, s1: 1.4, tint: DUST, alpha: 0.75, drag: 2.5 }, 40, 10);
      this.sfx('horse_gallop', ev.x, ev.y, 0.8);
      this.shake(1.2, ev.x, ev.y);
    });
    e.on('buildingHit', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      if (ev.siege) {
        this.fx.burst(10, { frame: 'fx/stonechip', x: ev.x, y: ev.y, z: 10, life: 0.9, g: 260, ground: 'stop' }, 70, 90);
        this.fx.burst(5, { frame: 'fx/puff6', x: ev.x, y: ev.y, life: 1.1, s0: 0.6, s1: 1.5, tint: DUST, alpha: 0.7, drag: 2 }, 30, 8);
        this.shake(2.2, ev.x, ev.y);
        this.sfx('ram_hit', ev.x, ev.y, 0.8);
      } else if (Math.random() < 0.3) {
        this.fx.burst(2, { frame: 'fx/woodchip', x: ev.x + (Math.random() - 0.5) * 16, y: ev.y, z: 8, life: 0.6, g: 240, ground: 'stop' }, 40, 50);
      }
    });
    e.on('buildingDestroyed', (ev) => {
      if (!this.near(ev.x, ev.y, 200)) return;
      const r = ev.size * 8;
      for (let k = 0; k < 14 * ev.size; k++)
        this.fx.emit({
          frame: Math.random() < 0.5 ? 'fx/puff6' : 'fx/puff4',
          x: ev.x + (Math.random() - 0.5) * r * 2,
          y: ev.y + (Math.random() - 0.3) * r,
          vz: 6 + Math.random() * 14,
          vx: (Math.random() - 0.5) * 20,
          life: 1.4 + Math.random(),
          s0: 0.8,
          s1: 2,
          tint: 0xa89c8c,
          alpha: 0.85,
          drag: 1.5,
        });
      this.fx.burst(10 * ev.size, { frame: Math.random() < 0.5 ? 'fx/woodchip' : 'fx/stonechip', x: ev.x, y: ev.y, z: 12, life: 1.2, g: 220, ground: 'stop' }, 90, 110);
      this.shake(ev.type === 'wall' ? 1 : 3.5, ev.x, ev.y);
      this.sfx('building_collapse', ev.x, ev.y, ev.type === 'wall' ? 0.5 : 1);
    });
    e.on('buildingPlaced', (ev) => {
      if (ev.faction !== this.playerFaction || this.world.time < 1) return;
      this.dustRing(ev.x, ev.y + 8, 14);
      this.sfx('build_place', ev.x, ev.y, 0.8);
    });
    e.on('buildingCompleted', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      this.dustRing(ev.x, ev.y + 8, 20);
      this.fx.burst(8, { frame: 'fx/star', x: ev.x, y: ev.y - 10, z: 6, life: 0.7, g: 60, add: true }, 40, 40);
      if (ev.faction === this.playerFaction) this.sfx('build_complete', ev.x, ev.y, 0.9);
    });
    e.on('treeFelled', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      this.fx.burst(10, { frame: 'fx/leaf', x: ev.x, y: ev.y - 10, z: 14, life: 1.6, g: 30, drag: 1.5, ground: 'stop', spin: 3 }, 30, 10);
      this.sfx('tree_fall', ev.x, ev.y, 0.45);
    });
    e.on('workerAction', (ev) => {
      if (!this.near(ev.x, ev.y, 40)) return;
      if (ev.action.startsWith('chop')) {
        this.fx.burst(3, { frame: 'fx/woodchip', x: ev.x + 5, y: ev.y - 4, z: 4, life: 0.5, g: 200, ground: 'stop' }, 30, 40);
        const idx = Number(ev.action.split(':')[1]);
        if (!isNaN(idx)) this.onChop?.(idx);
        this.sfx('axe_chop', ev.x, ev.y, 0.35);
      } else if (ev.action === 'mine') {
        this.fx.burst(3, { frame: 'fx/stonechip', x: ev.x + 5, y: ev.y - 3, z: 4, life: 0.5, g: 200, ground: 'stop' }, 30, 40);
        this.sfx('mining', ev.x, ev.y, 0.3);
      } else if (ev.action === 'farm') {
        this.fx.burst(2, { frame: 'fx/dirt', x: ev.x + 4, y: ev.y, z: 2, life: 0.4, g: 160, ground: 'stop' }, 20, 25);
      } else if (ev.action === 'build') {
        this.fx.burst(2, { frame: 'fx/woodchip', x: ev.x + 4, y: ev.y - 6, z: 4, life: 0.4, g: 200, ground: 'stop' }, 20, 30);
        this.sfx('construction_hammer', ev.x, ev.y, 0.35);
      }
    });
    e.on('resourceGained', (ev) => {
      if (ev.faction !== this.playerFaction || !ev.amount || !this.near(ev.x, ev.y, 0)) return;
      if (this.cam.zoom < 1.4) return;
      this.floatText(ev.x, ev.y, `+${ev.amount}`, ev.res);
    });
    e.on('unitSpawned', (ev) => {
      if (!ev.fromBuilding || !this.near(ev.x, ev.y)) return;
      this.dustRing(ev.x, ev.y, 6);
      if (ev.faction === this.playerFaction && !ev.type.startsWith('worker')) this.sfx('door', ev.x, ev.y, 0.5);
    });
    e.on('regionCaptured', (ev) => {
      this.captureBurst(ev.x, ev.y, ev.to);
      if (ev.to === this.playerFaction) {
        audio.play('capture_complete');
        this.shake(1.5, ev.x, ev.y, true);
      } else if (ev.from === this.playerFaction) audio.play('region_lost');
    });
    e.on('settlementUpgraded', (ev) => {
      const s = this.world.settlements[ev.regionId];
      this.fireworks(s.cx, s.cy - 20, 3);
      if (ev.faction === this.playerFaction) audio.play('upgrade_complete');
    });
  }

  private near(x: number, y: number, margin = 60) {
    const v = this.cam.view(margin);
    return x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
  }

  private sfx(name: SfxName, x: number, y: number, vol = 1) {
    audio.play(name, { x, y, volume: vol });
  }

  shake(mag: number, x: number, y: number, force = false) {
    if (!force && !this.near(x, y, 0)) return;
    this.cam.shake(mag * this.shakeScale);
  }

  dustRing(x: number, y: number, r: number) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.fx.emit({ frame: 'fx/puff3', x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.35, vx: Math.cos(a) * r * 1.4, vy: Math.sin(a) * r * 0.8, vz: 4, life: 0.8, s0: 0.7, s1: 1.4, tint: DUST, alpha: 0.75, drag: 3 });
    }
  }

  private onHit(ev: { id: number; x: number; y: number; kind: string; blocked: boolean; fromX: number; fromY: number; heavy: boolean }) {
    if (!this.near(ev.x, ev.y)) return;
    const dir = Math.atan2(ev.y - ev.fromY, ev.x - ev.fromX);
    if (ev.blocked) {
      this.fx.burst(4, { frame: 'fx/spark', x: ev.x, y: ev.y - 7, z: 0, life: 0.25, add: true }, 60, 0, 1.6, dir + Math.PI);
      this.sfx('shield_block', ev.x, ev.y, 0.6);
      return;
    }
    if (ev.kind === 'melee') {
      if (Math.random() < 0.55) this.fx.burst(3, { frame: 'fx/spark', x: ev.x, y: ev.y - 7, life: 0.2, add: true }, 50, 0, 1.2, dir);
      this.fx.emit({ frame: 'fx/star', x: ev.x, y: ev.y - 7, life: 0.12, s0: 0.8, s1: 0.4, add: true });
      this.fx.burst(1, { frame: 'fx/puff2', x: ev.x, y: ev.y, life: 0.4, tint: DUST, alpha: 0.6, s0: 0.8, s1: 1.3 }, 10, 0);
      this.sfx(Math.random() < 0.6 ? 'sword_clash' : 'sword_hit', ev.x, ev.y, 0.55);
    } else if (ev.kind === 'pierce') {
      this.fx.emit({ frame: 'fx/dot2', x: ev.x, y: ev.y - 6, life: 0.15, add: true });
      this.sfx('arrow_hit', ev.x, ev.y, 0.4);
    } else {
      this.fx.burst(4, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.8, tint: DUST, alpha: 0.8, s0: 0.6, s1: 1.4, drag: 2 }, 30, 10);
    }
    if (ev.heavy) this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, tint: DUST, alpha: 0.7 }, 30, 6);
  }

  private onLand(ev: { kind: string; x: number; y: number; hit: boolean; splash: number }) {
    if (!this.near(ev.x, ev.y, 100)) return;
    if (ev.kind === 'rock' || ev.kind === 'bigrock') {
      const big = ev.kind === 'bigrock';
      for (let k = 0; k < (big ? 14 : 9); k++)
        this.fx.emit({ frame: 'fx/puff6', x: ev.x + (Math.random() - 0.5) * 10, y: ev.y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 30, vz: 10 + Math.random() * 20, life: 1 + Math.random() * 0.6, s0: 0.6, s1: big ? 2.2 : 1.6, tint: 0xb8a888, alpha: 0.85, drag: 2.2 });
      this.fx.burst(big ? 16 : 10, { frame: 'fx/stonechip', x: ev.x, y: ev.y, z: 2, life: 1, g: 260, ground: 'bounce' }, 90, 120);
      this.fx.burst(8, { frame: 'fx/dirt', x: ev.x, y: ev.y, z: 2, life: 0.9, g: 260, ground: 'stop' }, 70, 100);
      this.shake(big ? 4 : 2.6, ev.x, ev.y);
      this.sfx('catapult_impact', ev.x, ev.y, 1);
      return;
    }
    if (!ev.hit && (ev.kind === 'arrow' || ev.kind === 'bolt')) {
      // embed in the ground for a while
      if (!this.reduced) this.addStuck(ev.x, ev.y);
      if (Math.random() < 0.5) this.sfx('arrow_ground', ev.x, ev.y, 0.25);
      this.fx.emit({ frame: 'fx/dirt', x: ev.x, y: ev.y, z: 1, vz: 30, vx: (Math.random() - 0.5) * 20, g: 200, life: 0.3, ground: 'stop' });
    }
    if (ev.kind === 'ballista') this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, tint: DUST, alpha: 0.7 }, 30, 6);
  }

  private addStuck(x: number, y: number) {
    const f = art.get('fx/stuck');
    let s = this.stuck.length > 140 ? this.stuck.shift() : undefined;
    if (!s) {
      const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false).setOrigin(f.ox, f.oy);
      this.groundLayer.add(img);
      s = { img, t: 0 };
    }
    s.img.setPosition(Math.round(x), Math.round(y)).setAlpha(1).setVisible(true).setFlipX(Math.random() < 0.5);
    s.t = 0;
    this.stuck.push(s);
  }

  private captureBurst(x: number, y: number, faction: number) {
    const f = this.world.factions[faction];
    if (!f || !this.near(x, y, 100)) return;
    const tint = Phaser.Display.Color.HexStringToColor(f.color.light).color;
    this.fx.burst(18, { frame: 'fx/dot2', x, y: y - 6, z: 8, life: 1.2, g: 50, tint, drag: 1 }, 70, 70);
    this.fx.burst(10, { frame: 'fx/star', x, y: y - 10, z: 10, life: 0.9, g: 40, add: true }, 50, 60);
    this.dustRing(x, y, 22);
  }

  fireworks(x: number, y: number, n: number) {
    if (this.reduced) n = 1;
    const cols = [0xf8d860, 0xe85040, 0x60a8f0, 0x80e060, 0xf0f0f0, 0xd080f0];
    for (let k = 0; k < n; k++) {
      const delay = k * 350;
      this.scene.time.delayedCall(delay, () => {
        const cx = x + (Math.random() - 0.5) * 60;
        const cy = y - 30 - Math.random() * 30;
        const tint = cols[Math.floor(Math.random() * cols.length)];
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const s = 40 + Math.random() * 25;
          this.fx.emit({ frame: 'fx/dot2', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0, life: 1.1, tint, add: true, drag: 1.6 });
        }
        audio.play('ui_open', { x: cx, y: cy, volume: 0.4, rate: 0.6 });
      });
    }
  }

  private floatText(x: number, y: number, text: string, res: string) {
    let f = this.floaterPool.pop();
    if (!f) {
      const txt = this.scene.make.text({ x, y, text, style: { fontFamily: 'Pixelify Sans', fontSize: '24px', color: '#fff6d8', stroke: '#1b1420', strokeThickness: 5 } }, false);
      txt.setScale(0.25).setOrigin(0, 0.5);
      txt.setResolution(1);
      const icon = this.scene.make.image({ x, y, key: art.get('icon/gold').key, frame: 'icon/gold' }, false).setScale(0.6);
      this.layer.add([txt, icon]);
      f = { txt, icon, t: 0, x, y };
    }
    const ic = art.tryGet(`icon/${res}`);
    if (ic) f.icon.setTexture(ic.key, ic.frame);
    f.txt.setText(text).setVisible(true).setAlpha(1);
    f.icon.setVisible(true).setAlpha(1);
    f.t = 0;
    f.x = x;
    f.y = y;
    this.floaters.push(f);
  }

  private dustT = 0;

  update(dt: number, alpha: number) {
    // hooves kick up dust
    this.dustT += dt;
    if (this.dustT > 0.12 && this.cam.zoom > 1.1) {
      this.dustT = 0;
      const v = this.cam.view(10);
      for (const u of this.world.units) {
        if (!u.alive || !u.def.look.mount) continue;
        if (u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
        const spd = Math.hypot(u.vx, u.vy);
        if (spd < 25 || Math.random() > 0.6) continue;
        this.fx.emit({ frame: 'fx/puff2', x: u.x - u.facing * 6, y: u.y, vx: -u.vx * 0.15, vy: -u.vy * 0.1, vz: 4, life: 0.6, s0: 0.6, s1: 1.3, tint: DUST, alpha: 0.55, drag: 2 });
      }
    }
    // projectiles
    const live = new Set<number>();
    for (const p of this.world.combat.projectiles) {
      const t = Math.min(1, (p.t + dt * alpha * 0) / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const yGround = p.y0 + (p.y1 - p.y0) * t;
      const h = p.arc * 4 * t * (1 - t);
      const y = yGround - h;
      if (!this.near(x, y, 30)) continue;
      live.add(p.id);
      let r = this.projImgs.get(p.id);
      if (!r) {
        r = this.projPool.pop();
        const f = art.get(`fx/${p.kind}`);
        const sh = art.get('fx/shadow');
        if (!r) {
          r = {
            img: this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false),
            shadow: this.scene.make.image({ x, y, key: sh.key, frame: sh.frame }, false).setAlpha(0.35),
          };
          this.layer.add(r.shadow);
          this.layer.add(r.img);
        }
        r.img.setTexture(f.key, f.frame).setVisible(true);
        r.shadow.setVisible(true);
        this.projImgs.set(p.id, r);
      }
      // orientation follows the arc's tangent
      const dx = p.x1 - p.x0;
      const dyG = p.y1 - p.y0;
      const dh = p.arc * 4 * (1 - 2 * t);
      const ang = Math.atan2(dyG - dh, dx);
      r.img.setPosition(x, y);
      if (p.kind === 'rock' || p.kind === 'bigrock') {
        r.img.rotation += dt * 8;
        if (Math.random() < 0.4) this.fx.emit({ frame: 'fx/puff2', x, y, life: 0.5, tint: 0xb8a888, alpha: 0.5, s0: 0.8, s1: 1.4 });
      } else r.img.setRotation(ang);
      r.shadow.setPosition(x, yGround).setScale(p.kind === 'rock' || p.kind === 'bigrock' ? 1.4 : 0.8, 0.8);
    }
    for (const [id, r] of this.projImgs) {
      if (!live.has(id)) {
        r.img.setVisible(false);
        r.shadow.setVisible(false);
        this.projPool.push(r);
        this.projImgs.delete(id);
      }
    }
    // stuck arrows fade
    for (const s of this.stuck) {
      s.t += dt;
      if (s.t > 10) s.img.setAlpha(Math.max(0, 1 - (s.t - 10) / 3));
    }
    while (this.stuck.length && this.stuck[0].t > 13) {
      const s = this.stuck.shift()!;
      s.img.destroy();
    }
    // floating numbers
    let k = 0;
    for (const f of this.floaters) {
      f.t += dt;
      const y = f.y - f.t * 14;
      f.icon.setPosition(Math.round(f.x - 4), Math.round(y));
      f.txt.setPosition(Math.round(f.x + 0), Math.round(y));
      const a = f.t > 0.9 ? Math.max(0, 1 - (f.t - 0.9) / 0.5) : 1;
      f.icon.setAlpha(a);
      f.txt.setAlpha(a);
      if (f.t > 1.4) {
        f.txt.setVisible(false);
        f.icon.setVisible(false);
        this.floaterPool.push(f);
      } else this.floaters[k++] = f;
    }
    this.floaters.length = k;
    void TILE;
  }
}

import Phaser from 'phaser';
import { audio } from '../audio';
import type { SfxName } from '../audio';
import { TILE } from '../data/constants';
import { UNITS } from '../data/units';
import { T } from '../sim/map/GameMap';
import type { World } from '../sim/World';
import { art } from './art/ArtRegistry';
import type { CameraController } from './CameraController';
import type { Particles } from './Particles';

interface Stuck {
  img: Phaser.GameObjects.Image;
  t: number;
  life: number;
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
  private cryT = -99;
  private bubbleAt = new Map<number, number>();
  private lastBubble = -99;
  private stepT = 0;
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
    e.on('unitDied', (ev) => this.onDeath(ev));
    e.on('unitEngaged', (ev) => {
      if (!this.near(ev.x, ev.y, 0) || this.cam.zoom < 1.1) return;
      // a few soldiers in each clash shout as they close in
      if (Math.random() < 0.35) this.bubble(ev.id, ev.x, ev.y, 'fight');
      const now = this.world.time;
      if (now - this.cryT > 3.5) {
        this.cryT = now;
        this.sfx('battle_cry', ev.x, ev.y, 0.45);
      }
    });
    e.on('unitRouted', (ev) => {
      if (!this.near(ev.x, ev.y, 0)) return;
      this.bubble(ev.id, ev.x, ev.y, 'flee', true);
      this.fx.burst(3, { frame: 'fx/drop', x: ev.x, y: ev.y - 14, z: 2, life: 0.5, g: 120, tint: 0xe8f4ff }, 25, 30);
    });
    e.on('unitRallied', (ev) => {
      if (!this.near(ev.x, ev.y, 0)) return;
      this.bubble(ev.id, ev.x, ev.y, 'cheer', true);
    });
    e.on('research', (ev) => {
      if (!this.near(ev.x, ev.y, 40)) return;
      this.beam(ev.x, ev.y, 0xffe8a0);
      this.fx.burst(12, { frame: 'fx/star', x: ev.x, y: ev.y - 8, z: 4, life: 1.2, g: -30, add: true, s0: 0.7, s1: 0.3 }, 18, 50);
    });
    e.on('projectileFired', (ev) => {
      if (!this.near(ev.x, ev.y, 260)) return;
      const k = ev.kind;
      this.sfx(k === 'arrow' ? 'arrow_shoot' : k === 'bolt' ? 'bolt_shoot' : k === 'ballista' ? 'ballista_shoot' : 'catapult_launch', ev.x, ev.y, k === 'arrow' ? 0.35 : 0.7);
      if (k === 'rock' || k === 'bigrock') {
        // the engine bucks: dust kicks out from under it
        this.fx.burst(k === 'bigrock' ? 10 : 6, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.9, s0: 0.5, s1: 1.4, tint: DUST, alpha: 0.7, drag: 2.5 }, 45, 6);
        this.ring(ev.x, ev.y, 18, DUST, 0.5, 0.5);
        this.shake(k === 'bigrock' ? 1.2 : 0.6, ev.x, ev.y);
      } else if (k === 'ballista') this.fx.burst(3, { frame: 'fx/spark', x: ev.x, y: ev.y - 8, life: 0.2, add: true }, 40, 0);
    });
    e.on('projectileLanded', (ev) => this.onLand(ev));
    e.on('charge', (ev) => {
      if (!this.near(ev.x, ev.y)) return;
      this.fx.burst(8, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.8, s0: 0.5, s1: 1.4, tint: DUST, alpha: 0.75, drag: 2.5 }, 40, 10);
      // the impact wave of a cavalry charge
      this.ring(ev.x, ev.y, 34, 0xfff0c8, 0.45, 0.75);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        this.fx.emit({ frame: 'fx/puff3', x: ev.x, y: ev.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 38, vz: 6, life: 0.7, s0: 0.6, s1: 1.5, tint: DUST, alpha: 0.7, drag: 3.5 });
      }
      if (this.cam.zoom > 1.3) this.floatText(ev.x, ev.y - 22, 'CHARGE!', null, '#ffd870');
      this.sfx('horse_gallop', ev.x, ev.y, 0.8);
      this.sfx('horse_neigh', ev.x, ev.y, 0.5);
      this.shake(1.6, ev.x, ev.y);
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
      this.ring(ev.x, ev.y + 4, ev.type === 'wall' ? 20 : 26 * ev.size, 0xd8c8b0, 0.6, 0.8);
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
      this.ring(ev.x, ev.y + 8, 26, 0xfff0c0, 0.5, 0.7);
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
      if (!ev.type.startsWith('worker')) this.fx.burst(3, { frame: 'fx/star', x: ev.x, y: ev.y - 10, z: 4, life: 0.5, g: -20, add: true, s0: 0.6, s1: 0.2 }, 20, 20);
      if (ev.faction === this.playerFaction && !ev.type.startsWith('worker')) this.sfx('door', ev.x, ev.y, 0.5);
    });
    e.on('regionCaptured', (ev) => {
      this.captureBurst(ev.x, ev.y, ev.to);
      // the victors cheer
      if (this.near(ev.x, ev.y, 0)) {
        let n = 0;
        this.world.unitHash.query(ev.x, ev.y, 70, (u) => {
          if (n >= 5 || !u.alive || u.faction !== ev.to || Math.random() < 0.4) return;
          n++;
          this.bubble(u.id, u.x, u.y, 'cheer', true);
        });
      }
      if (ev.to === this.playerFaction) {
        audio.play('capture_complete');
        this.shake(1.5, ev.x, ev.y, true);
      } else if (ev.from === this.playerFaction) audio.play('region_lost');
    });
    e.on('settlementUpgraded', (ev) => {
      const s = this.world.settlements[ev.regionId];
      this.fireworks(s.cx, s.cy - 20, 3);
      if (this.near(s.cx, s.cy, 60)) {
        this.beam(s.cx, s.cy, 0xffe090, 1.6);
        this.ring(s.cx, s.cy, 50, 0xffe8a0, 0.9, 0.8);
      }
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

  private onHit(ev: { id: number; x: number; y: number; kind: string; blocked: boolean; fromX: number; fromY: number; heavy: boolean; by: string }) {
    if (!this.near(ev.x, ev.y)) return;
    const dir = Math.atan2(ev.y - ev.fromY, ev.x - ev.fromX);
    const target = this.world.unitById.get(ev.id);
    const armour = target?.def.look.armor;
    const metal = armour === 'mail' || armour === 'plate' || target?.def.look.body === 'engine';
    const hy = ev.y - (target?.def.look.mount ? 12 : 7);
    if (ev.blocked) {
      // the shield takes it: splinters and a bright clang
      this.fx.burst(4, { frame: 'fx/spark', x: ev.x, y: hy, z: 0, life: 0.25, add: true }, 60, 0, 1.6, dir + Math.PI);
      this.fx.burst(3, { frame: 'fx/woodchip', x: ev.x, y: hy, z: 2, life: 0.5, g: 220, ground: 'stop' }, 35, 40, 1.4, dir + Math.PI);
      this.fx.emit({ frame: 'fx/star', x: ev.x + Math.cos(dir + Math.PI) * 3, y: hy, life: 0.14, s0: 1.1, s1: 0.5, add: true });
      this.sfx('shield_block', ev.x, ev.y, 0.6);
      return;
    }
    const weapon = UNITS[ev.by]?.look.weapon;
    const wolf = UNITS[ev.by]?.look.body === 'beast';
    if (ev.kind === 'melee') {
      const blade = weapon === 'sword' || weapon === 'greatsword' || weapon === 'axe';
      const blunt = weapon === 'club' || weapon === 'hammer' || weapon === 'pick' || weapon === 'hoe' || weapon === 'none' || weapon === 'pitchfork';
      if (wolf) {
        // claw rake: two thin slashes
        for (const o of [-2, 2]) this.fx.emit({ frame: 'fx/slash2', frames: ['fx/slash1', 'fx/slash2'], fps: 14, x: ev.x + o, y: hy + o, life: 0.16, rot: dir + 1.2, add: true, s0: 0.7, s1: 0.8 });
      } else if (blade) {
        // a slash arc swept across the target
        const big = weapon === 'greatsword';
        this.fx.emit({ frame: 'fx/slash0', frames: ['fx/slash0', 'fx/slash1', 'fx/slash2'], fps: 16, x: ev.x - Math.cos(dir) * 2, y: hy, life: 0.19, rot: dir, add: true, s0: big ? 1.3 : 0.95, s1: big ? 1.5 : 1.1, flipX: Math.random() < 0.5 });
      } else if (blunt) {
        // a heavy thump: dust jolts out, no sparks
        this.fx.emit({ frame: 'fx/star', x: ev.x, y: hy, life: 0.16, s0: 1.2, s1: 0.4, add: true });
        this.ring(ev.x, ev.y, 9, DUST, 0.25, 0.6);
      } else {
        // thrust: sparks streak through along the line of the blow
        this.fx.burst(4, { frame: 'fx/dot2', x: ev.x, y: hy, life: 0.18, add: true, tint: 0xfff4c0 }, 90, 0, 0.5, dir);
      }
      if (metal) this.fx.burst(3, { frame: 'fx/spark', x: ev.x, y: hy, life: 0.22, add: true }, 55, 0, 1.4, dir);
      else this.fx.burst(2, { frame: 'fx/dot', x: ev.x, y: hy + 1, z: 2, life: 0.35, g: 160, tint: 0x8a2a2a, ground: 'die' }, 30, 25, 1.2, dir);
      this.fx.burst(1, { frame: 'fx/puff2', x: ev.x, y: ev.y, life: 0.4, tint: DUST, alpha: 0.6, s0: 0.8, s1: 1.3 }, 10, 0);
      this.sfx(metal && Math.random() < 0.7 ? 'sword_clash' : 'sword_hit', ev.x, ev.y, 0.55);
    } else if (ev.kind === 'pierce') {
      if (metal) {
        // arrowhead skips off armour
        this.fx.burst(2, { frame: 'fx/spark', x: ev.x, y: hy, life: 0.18, add: true }, 50, 10, 1.8, dir + Math.PI);
      } else {
        this.fx.emit({ frame: 'fx/dot2', x: ev.x, y: hy, life: 0.15, add: true });
        this.fx.burst(2, { frame: 'fx/dot', x: ev.x, y: hy, z: 2, life: 0.3, g: 160, tint: 0x8a2a2a, ground: 'die' }, 20, 20);
      }
      this.sfx('arrow_hit', ev.x, ev.y, 0.4);
    } else {
      this.fx.burst(4, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.8, tint: DUST, alpha: 0.8, s0: 0.6, s1: 1.4, drag: 2 }, 30, 10);
    }
    if (ev.heavy) {
      this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, tint: DUST, alpha: 0.7 }, 30, 6);
      this.ring(ev.x, ev.y, 14, 0xfff0c8, 0.3, 0.7);
    }
  }

  private onDeath(ev: { id: number; x: number; y: number; faction: number; type: string; killerFaction: number }) {
    if (!this.near(ev.x, ev.y)) return;
    const def = UNITS[ev.type];
    this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, s0: 0.6, s1: 1.2, tint: DUST, alpha: 0.7, drag: 3 }, 18, 6);
    if (!def || ev.type.startsWith('worker')) return;
    const look = def.look;
    if (look.body === 'engine') {
      // timbers burst apart
      this.fx.burst(14, { frame: 'fx/woodchip', x: ev.x, y: ev.y - 6, z: 8, life: 1, g: 240, ground: 'bounce', spin: 10 }, 70, 90);
      this.ring(ev.x, ev.y, 24, DUST, 0.5, 0.7);
      this.sfx('building_collapse', ev.x, ev.y, 0.45);
      this.shake(1, ev.x, ev.y);
      return;
    }
    if (def.special === 'commander') {
      // the crown falls: a gold flash the whole field notices
      this.ring(ev.x, ev.y, 60, 0xffd860, 1.0, 0.9);
      this.beam(ev.x, ev.y, 0xffd860, 1.4);
      this.fx.burst(16, { frame: 'fx/coin', x: ev.x, y: ev.y - 12, z: 10, life: 1.3, g: 240, ground: 'bounce', spin: 8 }, 60, 110);
      this.shake(3, ev.x, ev.y, true);
      audio.play('horn_warning', { x: ev.x, y: ev.y, volume: 0.6 });
    }
    // helmets and caps get knocked loose
    const hat = look.helmet === 'kettle' || look.helmet === 'nasal' || look.helmet === 'great' || look.helmet === 'cap';
    if (hat && !this.reduced && Math.random() < 0.55)
      this.fx.emit({ frame: 'fx/helm', x: ev.x, y: ev.y - (look.mount ? 18 : 12), z: 0, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 10, vz: 50 + Math.random() * 30, g: 300, life: 1.6, ground: 'bounce', spin: 14 });
    if (look.mount) this.sfx('horse_neigh', ev.x, ev.y, 0.45);
    this.sfx('unit_death', ev.x, ev.y, 0.5);
  }

  /** a speech bubble over a soldier (throttled per unit and overall) */
  private bubble(id: number, x: number, y: number, kind: 'fight' | 'flee' | 'cheer' | 'alert', force = false) {
    const now = this.world.time;
    if ((this.bubbleAt.get(id) ?? -99) > now - 4) return;
    if (!force && now - this.lastBubble < 0.12) return;
    this.bubbleAt.set(id, now);
    this.lastBubble = now;
    if (this.bubbleAt.size > 400) this.bubbleAt.clear();
    const u = this.world.unitById.get(id);
    const h = u?.def.look.mount ? 30 : u?.def.look.body === 'engine' ? 28 : 21;
    this.fx.emit({ frame: `fx/bub_${kind}`, x, y: y - h, z: 0, vz: 6, life: 1.1, s0: 0.6, s1: 1, alpha: 1 });
  }

  /** a flat expanding ring on the ground */
  ring(x: number, y: number, radius: number, tint: number, life: number, alpha: number) {
    if (this.reduced && radius < 20) return;
    this.fx.emit({ frame: 'fx/ring', x, y, life, s0: 0.1, s1: radius / 12, sy: 0.5, tint, alpha, add: true, fadeAll: true });
  }

  /** a soft column of light rising from (x, y) */
  beam(x: number, y: number, tint: number, scale = 1) {
    const h = 48 * scale;
    this.fx.emit({ frame: 'fx/beam', x, y: y - h / 2, life: 1.3, s0: 0.9 * scale, s1: 1.05 * scale, tint, alpha: 0.7, add: true, fadeAll: true });
    this.fx.burst(8, { frame: 'fx/dot2', x, y: y - 4, z: 2, life: 1.2, g: -40, tint, add: true, drag: 1 }, 12, 30);
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
      this.ring(ev.x, ev.y, big ? 40 : 28, 0xe8d8b8, 0.5, 0.8);
      if (!this.reduced) this.addDecal('fx/crater', ev.x, ev.y, big ? 1.2 : 0.85, 25);
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
    this.addDecal('fx/stuck', x, y, 1, 13, Math.random() < 0.5);
  }

  /** a mark on the ground (stuck arrows, craters) that fades after `life` seconds */
  private addDecal(frame: string, x: number, y: number, scale: number, life: number, flip = false) {
    const f = art.get(frame);
    let s = this.stuck.length > 160 ? this.stuck.shift() : undefined;
    if (!s) {
      const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false);
      this.groundLayer.add(img);
      s = { img, t: 0, life };
    }
    s.img.setTexture(f.key, f.frame).setOrigin(f.ox, f.oy).setScale(scale);
    s.img.setPosition(Math.round(x), Math.round(y)).setAlpha(1).setVisible(true).setFlipX(flip);
    s.t = 0;
    s.life = life;
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

  private floatText(x: number, y: number, text: string, res: string | null, color = '#fff6d8') {
    let f = this.floaterPool.pop();
    if (!f) {
      const txt = this.scene.make.text({ x, y, text, style: { fontFamily: 'Pixelify Sans', fontSize: '24px', color: '#fff6d8', stroke: '#1b1420', strokeThickness: 5 } }, false);
      txt.setScale(0.25).setOrigin(0, 0.5);
      txt.setResolution(1);
      const icon = this.scene.make.image({ x, y, key: art.get('icon/gold').key, frame: 'icon/gold' }, false).setScale(0.6);
      this.layer.add([txt, icon]);
      f = { txt, icon, t: 0, x, y };
    }
    const ic = res ? art.tryGet(`icon/${res}`) : undefined;
    if (ic) f.icon.setTexture(ic.key, ic.frame);
    f.txt.setText(text).setVisible(true).setAlpha(1).setColor(color).setOrigin(ic ? 0 : 0.5, 0.5);
    f.icon.setVisible(!!ic).setAlpha(1);
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
    // footfalls: dust on dry ground, splashes and ripples in fords
    this.stepT += dt;
    if (this.stepT > 0.18 && this.cam.zoom > 1.4 && !this.reduced) {
      this.stepT = 0;
      const v = this.cam.view(10);
      const m = this.world.map;
      let budget = 24;
      for (const u of this.world.units) {
        if (!u.alive || budget <= 0) continue;
        if (u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
        const spd = Math.hypot(u.vx, u.vy);
        if (spd < 12) continue;
        const ti = Math.floor(u.y / TILE) * m.w + Math.floor(u.x / TILE);
        const wet = m.terrain[ti] === T.SHALLOW;
        if (wet) {
          if (Math.random() > 0.5) continue;
          budget--;
          this.fx.burst(2, { frame: 'fx/drop', x: u.x, y: u.y, z: 1, life: 0.45, g: 160, tint: 0xd8ecff, ground: 'die' }, 18, 34);
          this.ring(u.x, u.y, 6 + u.radius, 0xc8e0f8, 0.5, 0.5);
        } else if (!u.def.look.mount && (u.def.look.body === 'engine' || Math.random() < 0.18)) {
          budget--;
          this.fx.emit({ frame: 'fx/puff2', x: u.x - u.facing * 2, y: u.y, vx: -u.vx * 0.1, vy: 0, vz: 3, life: 0.45, s0: 0.5, s1: 1, tint: DUST, alpha: 0.4, drag: 2 });
        }
      }
    }
    // projectiles
    const live = new Set<number>();
    const trails = this.cam.zoom > 1.3 && !this.reduced;
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
      } else {
        r.img.setRotation(ang);
        // faint fletching trail
        if (trails && Math.random() < 0.4) this.fx.emit({ frame: 'fx/dot', x, y, life: 0.22, tint: 0xf8f0e0, alpha: 0.45, fadeAll: true });
      }
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
    // ground marks fade
    let k0 = 0;
    for (const s of this.stuck) {
      s.t += dt;
      if (s.t > s.life - 3) s.img.setAlpha(Math.max(0, (s.life - s.t) / 3));
      if (s.t > s.life) s.img.destroy();
      else this.stuck[k0++] = s;
    }
    this.stuck.length = k0;
    // floating numbers
    let k = 0;
    for (const f of this.floaters) {
      f.t += dt;
      const y = f.y - f.t * 14;
      f.icon.setPosition(Math.round(f.x - 4), Math.round(y));
      f.txt.setPosition(Math.round(f.x + 0), Math.round(y));
      const a = f.t > 0.9 ? Math.max(0, 1 - (f.t - 0.9) / 0.5) : 1;
      if (f.icon.visible) f.icon.setAlpha(a);
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

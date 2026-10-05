import Phaser from 'phaser';
import { isModern } from '../data/era';
import { STRIKE_RADIUS } from '../sim/Superweapon';
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
  /** resting alpha */
  a0: number;
  /** seconds of fade-out at the end of life */
  fade: number;
}

interface DecalOpts {
  /** which pool: short-lived fx marks (default), battle aftermath, or faint tracks */
  pool?: 'fx' | 'after' | 'track';
  rot?: number;
  alpha?: number;
  tint?: number;
}

/** a burnt-out spot that keeps smoking (ruins, wrecks) */
interface Smoulder {
  x: number;
  y: number;
  r: number;
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

/** projectiles of the modern era (FX handled by onGunFired) */
const GUN_KINDS = new Set(['bullet', 'rocket', 'grenade', 'shell', 'tankshell', 'flame']);
const DUST = 0xc8b898;
/** pool caps: short fx marks, battle aftermath (gear, trample, wrecks, rubble), tracks */
const DECAL_CAP = { fx: 160, after: 350, track: 220 };
const MAX_SMOULDER = 40;

/**
 * Turns simulation events into feel: impact sparks, dust, debris, stuck arrows, projectile flight,
 * screen shake, floating resource numbers and positional sound. Everything is culled to the view
 * and throttled so a 100-unit melee stays readable and cheap.
 */
export class FxDirector {
  private projImgs = new Map<number, { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }>();
  private projPool: { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }[] = [];
  private stuck: Stuck[] = [];
  /** lasting battlefield aftermath (dropped gear, trampled earth, wrecks, rubble) */
  private after: Stuck[] = [];
  /** faint tread marks and hoofprints */
  private tracks: Stuck[] = [];
  /** ground decals live in these, slotted under the selection rings and territory borders */
  private trackC: Phaser.GameObjects.Container;
  private decalC: Phaser.GameObjects.Container;
  private smoulders: Smoulder[] = [];
  /** last place each moving vehicle / horse left a mark */
  private trackAt = new Map<number, { x: number; y: number }>();
  private trackGcT = 0;
  private moveT = 0;
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
    this.trackC = scene.make.container({ x: 0, y: 0 }, false);
    this.decalC = scene.make.container({ x: 0, y: 0 }, false);
    groundLayer.addAt(this.trackC, 0);
    groundLayer.addAt(this.decalC, 1);
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
      if (GUN_KINDS.has(k)) return this.onGunFired(ev);
      this.sfx(k === 'arrow' ? 'arrow_shoot' : k === 'bolt' ? 'bolt_shoot' : k === 'ballista' ? 'ballista_shoot' : 'catapult_launch', ev.x, ev.y, k === 'arrow' ? 0.35 : 0.7);
      if (k === 'firepot') {
        this.sfx('arrow_shoot', ev.x, ev.y, 0.2);
        return;
      }
      if (k === 'bolt' && UNITS[ev.by]?.look.engine === 'volleygun') {
        const now = this.world.time;
        if ((this.salvoAt.get(ev.by + ev.x) ?? -9) < now - 2) {
          this.salvoAt.set(ev.by + ev.x, now);
          this.sfx('volley', ev.x, ev.y, 0.7);
          this.fx.burst(8, { frame: 'fx/puff4', x: ev.x + 8, y: ev.y - 6, life: 1.2, s0: 0.6, s1: 1.8, tint: 0xd8d0c0, alpha: 0.7, drag: 2, g: -8 }, 30, 6);
        }
        return;
      }
      if (k === 'rock' || k === 'bigrock') {
        // the engine bucks: dust kicks out from under it
        this.fx.burst(k === 'bigrock' ? 10 : 6, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.9, s0: 0.5, s1: 1.4, tint: DUST, alpha: 0.7, drag: 2.5 }, 45, 6);
        this.ring(ev.x, ev.y, 18, DUST, 0.5, 0.5);
        this.shake(k === 'bigrock' ? 1.2 : 0.6, ev.x, ev.y);
      } else if (k === 'ballista') this.fx.burst(3, { frame: 'fx/spark', x: ev.x, y: ev.y - 8, life: 0.2, add: true }, 40, 0);
    });
    e.on('projectileLanded', (ev) => this.onLand(ev));
    // ---- support troops, fire, building levels and the superweapon
    e.on('healPulse', (ev) => {
      if (!this.near(ev.x, ev.y, 0) || this.cam.zoom < 1.1) return;
      this.fx.burst(3, { frame: 'fx/heart', x: ev.x, y: ev.y - 10, z: 2, life: 1.1, g: -26, s0: 0.9, s1: 0.5 }, 10, 12);
      if (Math.random() < 0.3) this.sfx('heal', ev.x, ev.y, 0.25);
    });
    e.on('music', (ev) => {
      if (!this.near(ev.x, ev.y, 0)) return;
      for (let k = 0; k < 5; k++)
        this.fx.emit({ frame: k & 1 ? 'fx/note1' : 'fx/note0', x: ev.x + (Math.random() - 0.5) * 8, y: ev.y - 14, vx: (Math.random() - 0.5) * 16, vz: 0, vy: -14 - Math.random() * 10, life: 1.5 + Math.random() * 0.6, tint: ev.awful ? 0x9ab070 : [0xffe08a, 0xa8e8ff, 0xffb0d8][k % 3], s0: 1, s1: 0.6 });
      if (this.cam.zoom > 1) this.sfx(isModern() ? 'bagpipe' : 'lute', ev.x, ev.y, ev.awful ? 0.5 : 0.35);
    });
    e.on('buildingLevel', (ev) => {
      if (!this.near(ev.x, ev.y, 40)) return;
      if (ev.started) {
        this.fx.burst(6, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.9, s0: 0.5, s1: 1.3, tint: DUST, alpha: 0.6, drag: 2 }, 30, 8);
        this.sfx('build_place', ev.x, ev.y, 0.5);
        return;
      }
      this.beam(ev.x, ev.y, 0xf0c84a, 1.1);
      this.fx.burst(10, { frame: 'fx/star', x: ev.x, y: ev.y - 10, z: 4, life: 1.1, g: -30, add: true, tint: 0xffe08a, s0: 0.8, s1: 0.3 }, 20, 40);
      this.floatText(ev.x, ev.y - 26, `LEVEL ${ev.level}`, null, '#f0c84a');
      this.sfx('upgrade_complete', ev.x, ev.y, 0.5);
    });
    e.on('happening', (ev) => {
      if (!this.near(ev.x, ev.y, 40)) return;
      switch (ev.kind) {
        case 'goose':
          this.fx.burst(14, { frame: 'fx/dot2', x: ev.x, y: ev.y - 6, z: 4, life: 1.6, g: 30, tint: 0xf8f8f0, drag: 1.5 }, 50, 30);
          this.floatText(ev.x, ev.y - 24, 'HONK!', null, '#fff8e0');
          break;
        case 'river':
          this.fx.burst(10, { frame: 'fx/drop', x: ev.x, y: ev.y - 4, z: 2, life: 0.7, g: 240, tint: 0xa8d8ff }, 40, 70);
          this.ring(ev.x, ev.y, 12, 0xa8d8ff, 0.5, 0.7);
          this.floatText(ev.x, ev.y - 22, ev.text, null, '#a8d8ff');
          break;
        case 'treasure':
          this.fx.burst(12, { frame: 'fx/coin', x: ev.x, y: ev.y - 8, z: 6, life: 1.2, g: 240, ground: 'bounce', spin: 8 }, 50, 90);
          this.floatText(ev.x, ev.y - 22, ev.text, null, '#ffd860');
          this.sfx('coins', ev.x, ev.y, 0.6);
          break;
        case 'surrender':
          this.floatText(ev.x, ev.y - 26, 'I SURRENDER!', null, '#f8f8f0');
          this.fx.burst(4, { frame: 'fx/dot2', x: ev.x, y: ev.y - 14, z: 2, life: 1, g: 60, tint: 0xffffff }, 20, 20);
          break;
        case 'sighting':
          this.floatText(ev.x, ev.y, '?!', null, '#c8e8ff');
          break;
        default:
          break;
      }
    });
    e.on('superLaunch', (ev) => this.onSuperLaunch(ev));
    e.on('superWarning', (ev) => {
      if (this.near(ev.x, ev.y, 200)) this.floatText(ev.x, ev.y - 30, 'INCOMING!', null, '#ff6a5a');
    });
    e.on('superImpact', (ev) => this.onSuperImpact(ev));
    // a jumpy soldier fires at a bush
    e.on('potshot', (ev) => {
      if (!this.near(ev.x, ev.y, 0)) return;
      const k = ev.kind;
      this.sfx(k === 'arrow' ? 'arrow_shoot' : k === 'bolt' ? 'bolt_shoot' : 'catapult_launch', ev.x, ev.y, 0.3);
      this.fx.burst(4, { frame: 'fx/puff4', x: ev.tx, y: ev.ty, life: 0.6, s0: 0.4, s1: 1, tint: DUST, alpha: 0.7, drag: 3 }, 20, 6);
      this.fx.burst(3, { frame: 'fx/leaf', x: ev.tx, y: ev.ty, z: 6, life: 1, g: 60 }, 30, 20);
    });
    // back on their feet: a little green lift
    e.on('unitRevived', (ev) => {
      if (!this.near(ev.x, ev.y, 0)) return;
      this.ring(ev.x, ev.y, 16, 0x9af07a, 0.45, 0.6);
      this.fx.burst(8, { frame: 'fx/star', x: ev.x, y: ev.y - 6, z: 2, life: 0.9, g: -40, add: true, tint: 0xa8f088, s0: 0.6, s1: 0.2 }, 16, 30);
      this.sfx('select', ev.x, ev.y, 0.4);
    });
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
      this.ruin(ev);
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
      if (metal || target?.def.look.body === 'vehicle') {
        // arrowhead skips off armour
        this.fx.burst(2, { frame: 'fx/spark', x: ev.x, y: hy, life: 0.18, add: true }, 50, 10, 1.8, dir + Math.PI);
      } else {
        this.fx.emit({ frame: 'fx/dot2', x: ev.x, y: hy, life: 0.15, add: true });
        this.fx.burst(2, { frame: 'fx/dot', x: ev.x, y: hy, z: 2, life: 0.3, g: 160, tint: 0x8a2a2a, ground: 'die' }, 20, 20);
      }
      if (UNITS[ev.by]?.projectile === 'bullet') {
        if (target?.def.look.body === 'vehicle' && Math.random() < 0.3) this.sfx('ricochet', ev.x, ev.y, 0.3);
      } else this.sfx('arrow_hit', ev.x, ev.y, 0.4);
    } else {
      this.fx.burst(4, { frame: 'fx/puff4', x: ev.x, y: ev.y, life: 0.8, tint: DUST, alpha: 0.8, s0: 0.6, s1: 1.4, drag: 2 }, 30, 10);
    }
    if (ev.heavy) {
      this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, tint: DUST, alpha: 0.7 }, 30, 6);
      this.ring(ev.x, ev.y, 14, 0xfff0c8, 0.3, 0.7);
    }
  }

  private onDeath(ev: { id: number; x: number; y: number; faction: number; type: string; killerFaction: number }) {
    this.aftermath(ev);
    if (!this.near(ev.x, ev.y)) return;
    const def = UNITS[ev.type];
    this.fx.burst(4, { frame: 'fx/puff3', x: ev.x, y: ev.y, life: 0.6, s0: 0.6, s1: 1.2, tint: DUST, alpha: 0.7, drag: 3 }, 18, 6);
    if (!def || ev.type.startsWith('worker')) return;
    const look = def.look;
    if (look.body === 'vehicle' || (isModern() && look.body === 'engine')) {
      // the vehicle brews up
      this.explosion(ev.x, ev.y - 4, look.vehicle === 'tank' ? 1.7 : 1.2);
      this.fx.burst(10, { frame: 'fx/stonechip', x: ev.x, y: ev.y - 8, z: 8, life: 1.1, g: 260, ground: 'bounce', spin: 12, tint: 0x5a5a50 }, 80, 100);
      return;
    }
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

  /** modern weapons: muzzle flash, brass, smoke and the right report */
  private onGunFired(ev: { kind: string; x: number; y: number; tx: number; ty: number; by: string }) {
    const k = ev.kind;
    const look = UNITS[ev.by]?.look;
    const dir = Math.atan2(ev.ty - ev.y, ev.tx - ev.x);
    const right = Math.cos(dir) >= 0 ? 1 : -1;
    // muzzle offsets (px, facing right) from the unit sheets
    let mx = 7;
    let my = -6;
    if (look?.vehicle === 'tank') [mx, my] = [16, -14];
    else if (look?.body === 'vehicle') [mx, my] = [6, -15];
    else if (look?.engine === 'atgun') [mx, my] = [11, -8];
    else if (look?.engine === 'howitzer') [mx, my] = [13, -17];
    else if (look?.engine === 'mortar') [mx, my] = [4, -12];
    else if (!look) [mx, my] = [0, 0];
    const x = ev.x + mx * right;
    const y = ev.y + my;
    if (k === 'flame') {
      // a roaring jet: a stream of fire tongues along the line of fire
      for (let n = 0; n < 9; n++) {
        const sp = 110 + Math.random() * 60;
        const a = dir + (Math.random() - 0.5) * 0.25;
        this.fx.emit({ frame: 'fx/jet0', frames: ['fx/jet0', 'fx/jet1', 'fx/jet2', 'fx/jet3'], fps: 12, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.15, rot: a, add: true, s0: 0.8, s1: 1.6, drag: 3 });
      }
      this.fx.burst(2, { frame: 'fx/puff4', x: ev.tx, y: ev.ty, life: 1, s0: 0.5, s1: 1.4, tint: 0x5a5050, alpha: 0.5, g: -14 }, 10, 4);
      this.sfx('flame', ev.x, ev.y, 0.5);
      return;
    }
    if (k === 'rocket' && look?.vehicle === 'mlrs') {
      // one salvo sound per launcher volley
      const now = this.world.time;
      if ((this.salvoAt.get(ev.by + ev.x) ?? -9) < now - 2) {
        this.salvoAt.set(ev.by + ev.x, now);
        this.sfx('salvo', ev.x, ev.y, 0.7);
      }
      this.fx.burst(3, { frame: 'fx/puff4', x: ev.x - 8 * right, y: y + 2, life: 0.9, s0: 0.6, s1: 1.8, tint: 0xe8e0d0, alpha: 0.7, drag: 2.5 }, 30, 4, 0.8, dir + Math.PI);
      return;
    }
    const big = k === 'tankshell' || k === 'shell' || look?.engine === 'atgun';
    const near = this.cam.zoom > 1.1;
    if (near || big) {
      const up = look?.engine === 'mortar' || look?.engine === 'howitzer';
      this.fx.emit({ frame: 'fx/muzzle0', frames: ['fx/muzzle0', 'fx/muzzle1'], fps: 30, x, y, life: big ? 0.12 : 0.07, rot: up ? (right > 0 ? -1 : -Math.PI + 1) : dir, flipX: false, add: true, s0: big ? 1.6 : 0.8, s1: big ? 1.2 : 0.6 });
    }
    if (k === 'bullet') {
      const w = look?.weapon;
      // brass flicks out of rifles and machine guns
      if (near && !this.reduced && (w === 'rifle' || w === 'mg' || w === 'smg' || w === 'sniper' || look?.body === 'vehicle'))
        this.fx.emit({ frame: 'fx/casing', x: ev.x + 2 * right, y: y + 1, z: 2, vx: -right * (20 + Math.random() * 20), vy: (Math.random() - 0.5) * 10, vz: 40, g: 300, life: 0.7, ground: 'bounce', spin: 20 });
      const snd = !look ? 'mg_burst' : w === 'mg' || look.body === 'vehicle' ? 'mg_burst' : w === 'smg' ? 'smg_burst' : w === 'sniper' ? 'sniper_shot' : w === 'shotgun' ? 'shotgun' : 'rifle_shot';
      this.sfx(snd, ev.x, ev.y, w === 'pistol' ? 0.25 : snd === 'sniper_shot' ? 0.6 : 0.4);
      return;
    }
    // heavy weapons: a cough of smoke and a thump
    this.fx.burst(big ? 6 : 3, { frame: 'fx/puff4', x, y, life: 0.9, s0: 0.5, s1: big ? 1.8 : 1.2, tint: 0xc8c0b0, alpha: 0.7, drag: 2.5, g: -10 }, 25, 4);
    if (k === 'rocket') {
      // backblast
      this.fx.burst(4, { frame: 'fx/puff4', x: ev.x - 8 * right, y: y + 1, life: 0.8, s0: 0.6, s1: 1.6, tint: 0xe8e0d0, alpha: 0.75, drag: 3 }, 40, 4, 0.8, dir + Math.PI);
      this.sfx('rocket_launch', ev.x, ev.y, 0.6);
    } else if (k === 'grenade') this.sfx('mortar_launch', ev.x, ev.y, 0.3);
    else if (k === 'shell') {
      this.sfx(look?.engine === 'howitzer' ? 'tank_fire' : 'mortar_launch', ev.x, ev.y, 0.7);
      // the incoming whistle, heard where it will land
      if (!this.reduced) this.sfx('shell_whistle', ev.tx, ev.ty, 0.35);
      if (look?.engine === 'howitzer') this.shake(1.2, ev.x, ev.y);
    } else if (k === 'tankshell') {
      this.sfx('tank_fire', ev.x, ev.y, 0.8);
      this.ring(ev.x, ev.y, 22, DUST, 0.4, 0.5);
      this.shake(0.8, ev.x, ev.y);
    }
  }

  private salvoAt = new Map<string, number>();
  private strikeImgs = new Map<number, { img: Phaser.GameObjects.Image; warn: Phaser.GameObjects.Image }>();
  private burnT = 0;

  /** a lick of flames at a point */
  fireBurst(x: number, y: number, n: number) {
    for (let k = 0; k < n; k++)
      this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2', 'fx/fire3'], fps: 10, x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 6, life: 0.6 + Math.random() * 0.6, s0: 0.8, s1: 0.4, add: true });
    if (!this.reduced) this.fx.burst(Math.ceil(n / 2), { frame: 'fx/puff4', x, y: y - 6, life: 1.2, s0: 0.5, s1: 1.4, tint: 0x4a4048, alpha: 0.55, g: -16, drag: 1 }, 8, 6);
  }

  /** the superweapon fires: a flash, a column of smoke and a long roar */
  private onSuperLaunch(ev: { id: number; faction: number; x: number; y: number; tx: number; ty: number; kind: 'missile' | 'fireball' }) {
    const nearLaunch = this.near(ev.x, ev.y, 200);
    const mine = ev.faction === this.playerFaction;
    const targetMine = this.playerFaction >= 0 && this.world.map.region[Math.floor(ev.ty / TILE) * this.world.map.w + Math.floor(ev.tx / TILE)] >= 0 && this.world.settlements[this.world.map.region[Math.floor(ev.ty / TILE) * this.world.map.w + Math.floor(ev.tx / TILE)]]?.owner === this.playerFaction;
    if (ev.kind === 'missile' && (targetMine || this.near(ev.tx, ev.ty, 300))) audio.play('siren', { volume: 0.55 });
    if (nearLaunch || mine) this.sfx(ev.kind === 'missile' ? 'missile_launch' : 'bombard_fire', nearLaunch ? ev.x : this.cam.x, nearLaunch ? ev.y : this.cam.y, nearLaunch ? 1 : 0.4);
    if (!nearLaunch) return;
    for (let k = 0; k < 16; k++)
      this.fx.emit({ frame: 'fx/smokecol', x: ev.x + (Math.random() - 0.5) * 20, y: ev.y + 4, vx: (Math.random() - 0.5) * 30, vz: 10 + Math.random() * 30, life: 2 + Math.random() * 1.5, s0: 1, s1: 3, alpha: 0.75, drag: 1, tint: 0xd8d0c8 });
    this.fx.emit({ frame: 'fx/bigblast0', frames: ['fx/bigblast0', 'fx/bigblast1'], fps: 10, x: ev.x, y: ev.y - 10, life: 0.25, s0: 0.8, s1: 1.2, add: true });
    this.ring(ev.x, ev.y, 50, 0xfff0c8, 0.6, 0.8);
    this.shake(ev.kind === 'missile' ? 3 : 4, ev.x, ev.y);
  }

  /** the strike lands: the biggest bang in the valley */
  private onSuperImpact(ev: { x: number; y: number; kind: 'missile' | 'fireball'; kills: number }) {
    const near = this.near(ev.x, ev.y, 260);
    audio.play('big_explosion', { x: ev.x, y: ev.y, volume: near ? 1 : 0.5 });
    if (!near) return;
    const frames = ['fx/bigblast0', 'fx/bigblast1', 'fx/bigblast2', 'fx/bigblast3', 'fx/bigblast4', 'fx/bigblast5'];
    this.fx.emit({ frame: 'fx/bigblast0', frames, fps: 7, x: ev.x, y: ev.y - 30, life: 6 / 7, s0: 2.4, s1: 2.9 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.fx.emit({ frame: 'fx/bigblast3', frames: ['fx/bigblast3', 'fx/bigblast4', 'fx/bigblast5'], fps: 2.5, x: ev.x + Math.cos(a) * 40, y: ev.y + Math.sin(a) * 20 - 10, vx: Math.cos(a) * 30, vy: Math.sin(a) * 15, vz: 8, life: 1.4, s0: 1, s1: 1.8, alpha: 0.85, drag: 1 });
    }
    for (let k = 0; k < 3; k++) this.ring(ev.x, ev.y, 70 + k * 45, k === 0 ? 0xffffff : 0xffd8a0, 0.5 + k * 0.25, 0.9 - k * 0.2);
    this.fx.burst(40, { frame: 'fx/dirt', x: ev.x, y: ev.y, z: 4, life: 1.6, g: 260, ground: 'stop' }, 200, 220);
    this.fx.burst(24, { frame: 'fx/stonechip', x: ev.x, y: ev.y, z: 6, life: 1.6, g: 260, ground: 'bounce', spin: 10 }, 180, 200);
    this.fireBurst(ev.x, ev.y, 18);
    for (let k = 0; k < 10; k++) this.fx.emit({ frame: 'fx/smokecol', x: ev.x + (Math.random() - 0.5) * 60, y: ev.y, vz: 16 + Math.random() * 20, life: 3 + Math.random() * 2, s0: 1.4, s1: 3.6, alpha: 0.7, drag: 0.6, tint: 0x5a5058 });
    if (!this.reduced) {
      this.addDecal('fx/crater', ev.x, ev.y, 2.6, 90);
      this.addDecal('fx/scorch', ev.x, ev.y + 2, 4, 90);
    }
    this.shake(8, ev.x, ev.y, true);
    this.scene.cameras.main.flash(260, 255, 240, 220, true);
    if (ev.kills > 0) this.floatText(ev.x, ev.y - 50, `${ev.kills} DOWN`, null, '#ff9a6a');
  }

  private fireImgs = new Map<number, Phaser.GameObjects.Image>();
  private dogImgs = new Map<number, Phaser.GameObjects.Image & { sy?: number }>();

  /** flying strikes, their warning markers, and everything that is on fire */
  private updateStrikes(dt: number) {
    const w = this.world;
    // campfires: a ring of stones and logs, flames and drifting smoke
    const fireLive = new Set<number>();
    for (const c of w.social.campfires) {
      if (!this.near(c.x, c.y, 20)) continue;
      fireLive.add(c.id);
      let img = this.fireImgs.get(c.id);
      if (!img) {
        const f = art.tryGet('prop/campfire/0');
        if (!f) continue;
        img = this.scene.make.image({ x: c.x, y: c.y, key: f.key, frame: f.frame }, false).setOrigin(f.ox, f.oy);
        this.groundLayer.add(img);
        this.fireImgs.set(c.id, img);
      }
      if (Math.random() < dt * 9) this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2', 'fx/fire3'], fps: 10, x: c.x + (Math.random() - 0.5) * 3, y: c.y - 2, vy: -6, life: 0.5, s0: 0.8, s1: 0.4, add: true });
      if (Math.random() < dt * 2) this.fx.emit({ frame: 'fx/puff2', x: c.x, y: c.y - 8, vx: 4, life: 1.6, tint: 0x8a8088, alpha: 0.4, s0: 0.5, s1: 1.4, g: -10 });
    }
    for (const [id, img] of this.fireImgs) {
      if (fireLive.has(id)) continue;
      img.destroy();
      this.fireImgs.delete(id);
    }
    // squad mascots trot at their person's heel
    const dogLive = new Set<number>();
    for (const m of w.happenings.mascots) {
      const o = w.unitById.get(m.ownerId);
      if (!o || !this.near(o.x, o.y, 20) || this.cam.zoom < 0.95) continue;
      dogLive.add(m.id);
      let img = this.dogImgs.get(m.id);
      const moving = Math.hypot(o.vx, o.vy) > 4;
      const f = art.tryGet(`amb/dog/${moving ? Math.floor(w.time * 8) % 2 : 2}`);
      if (!f) continue;
      if (!img) {
        img = this.scene.make.image({ x: o.x, y: o.y, key: f.key, frame: f.frame }, false) as Phaser.GameObjects.Image & { sy?: number };
        this.layer.add(img);
        this.dogImgs.set(m.id, img);
      }
      img.setTexture(f.key, f.frame).setOrigin(f.ox, f.oy);
      const tx = o.x - o.facing * 9;
      const ty = o.y + 3;
      img.x += (tx - img.x) * Math.min(1, dt * 6);
      img.y += (ty - img.y) * Math.min(1, dt * 6);
      img.setFlipX(o.facing < 0);
      img.setDepth(img.y);
    }
    for (const [id, img] of this.dogImgs) {
      if (dogLive.has(id)) continue;
      img.destroy();
      this.dogImgs.delete(id);
    }
    const live = new Set<number>();
    for (const s of w.superweapons.strikes) {
      live.add(s.id);
      let r = this.strikeImgs.get(s.id);
      if (!r) {
        const f = art.get(s.kind === 'missile' ? 'fx/missile' : 'fx/fireball');
        const wf = art.get('fx/warn');
        const img = this.scene.make.image({ x: 0, y: 0, key: f.key, frame: f.frame }, false).setOrigin(f.ox, f.oy).setScale(1.6);
        const warn = this.scene.make.image({ x: s.x, y: s.y, key: wf.key, frame: wf.frame }, false).setOrigin(wf.ox, wf.oy).setVisible(false);
        this.groundLayer.add(warn);
        this.layer.add(img);
        r = { img, warn };
        this.strikeImgs.set(s.id, r);
      }
      const t = Math.min(1, (w.time - s.launchT) / (s.impactT - s.launchT));
      const arc = 520;
      const x = s.fromX + (s.x - s.fromX) * t;
      const yl = s.fromY + (s.y - s.fromY) * t;
      const y = yl - arc * 4 * t * (1 - t);
      const dx = s.x - s.fromX;
      const dy = s.y - s.fromY - arc * 4 * (1 - 2 * t);
      r.img.setPosition(x, y).setRotation(Math.atan2(dy, dx));
      if (Math.random() < 0.8) this.fx.emit({ frame: 'fx/puff4', x, y, life: 1.4, s0: 0.6, s1: 1.8, tint: s.kind === 'missile' ? 0xe8e4e0 : 0x6a5a50, alpha: 0.6, drag: 1 });
      if (s.kind === 'fireball' && Math.random() < 0.5) this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2'], fps: 10, x, y, life: 0.4, add: true });
      // warning: a pulsing target ring for the last stretch
      const warnOn = w.time > s.impactT - 6;
      r.warn.setVisible(warnOn);
      if (warnOn) {
        const pulse = 1 + Math.sin(w.time * 12) * 0.12;
        r.warn.setScale((STRIKE_RADIUS / 12) * pulse, (STRIKE_RADIUS / 12) * pulse).setAlpha(0.55 + 0.35 * Math.sin(w.time * 12));
      }
    }
    for (const [id, r] of this.strikeImgs) {
      if (live.has(id)) continue;
      r.img.destroy();
      r.warn.destroy();
      this.strikeImgs.delete(id);
    }
    // burning soldiers and buildings
    this.burnT += dt;
    if (this.burnT < 0.12) return;
    this.burnT = 0;
    const v = this.cam.view(20);
    for (const u of w.units) {
      if (!u.alive || u.burnT <= 0 || u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
      this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2', 'fx/fire3'], fps: 12, x: u.x + (Math.random() - 0.5) * 4, y: u.y - 4, vy: -8, life: 0.45, s0: 0.9, s1: 0.4, add: true });
      if (Math.random() < 0.3) this.fx.emit({ frame: 'fx/puff2', x: u.x, y: u.y - 12, life: 0.8, tint: 0x4a4048, alpha: 0.5, s0: 0.6, s1: 1.2, g: -16 });
    }
    for (const b of w.buildings) {
      if (b.burnT <= 0 || b.destroyed || b.x < v.x0 - 30 || b.x > v.x1 + 30 || b.y < v.y0 || b.y > v.y1 + 40) continue;
      const half = (b.size * TILE) / 2;
      for (let k = 0; k < b.size; k++)
        this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2', 'fx/fire3'], fps: 10, x: b.x + (Math.random() - 0.5) * half * 1.6, y: b.y + (Math.random() - 0.2) * half, vy: -10, life: 0.7, s0: 1.3, s1: 0.6, add: true });
      if (Math.random() < 0.5) this.fx.emit({ frame: 'fx/smokecol', x: b.x + (Math.random() - 0.5) * half, y: b.y - half, vz: 14, life: 2.4, s0: 0.8, s1: 2.2, alpha: 0.55, tint: 0x3a3238, drag: 0.6 });
    }
  }

  /** a modern explosion: flash, fireball, smoke, dirt and a scorch mark */
  explosion(x: number, y: number, size: number) {
    const frames = ['fx/blast0', 'fx/blast1', 'fx/blast2', 'fx/blast3', 'fx/blast4', 'fx/blast5'];
    this.fx.emit({ frame: 'fx/blast0', frames, fps: 14, x, y: y - 6 * size, life: 6 / 14, s0: size, s1: size * 1.15 });
    if (!this.reduced) {
      for (let k = 0; k < Math.round(3 * size); k++)
        this.fx.emit({ frame: 'fx/blast4', frames: ['fx/blast4', 'fx/blast5'], fps: 3, x: x + (Math.random() - 0.5) * 12 * size, y: y - 4 - Math.random() * 6, vz: 10 + Math.random() * 10, vx: (Math.random() - 0.5) * 12, life: 0.9 + Math.random() * 0.6, s0: 0.5 * size, s1: 1.1 * size, alpha: 0.8, drag: 1.5 });
      this.addDecal('fx/scorch', x, y, size, 30);
    }
    this.fx.burst(Math.round(8 * size), { frame: 'fx/dirt', x, y, z: 2, life: 0.9, g: 260, ground: 'stop' }, 60 * size, 90 * size);
    this.fx.burst(Math.round(4 * size), { frame: 'fx/spark', x, y: y - 4, life: 0.35, add: true }, 80 * size, 40);
    this.ring(x, y, 22 * size, 0xffd8a0, 0.35, 0.7);
    this.shake(1.6 * size, x, y);
    this.sfx('explosion', x, y, Math.min(1, 0.55 + size * 0.2));
  }

  private onLand(ev: { kind: string; x: number; y: number; hit: boolean; splash: number }) {
    if (!this.near(ev.x, ev.y, 100)) return;
    if (ev.kind === 'firepot' || ev.kind === 'flame') {
      // pitch splashes and catches
      this.fireBurst(ev.x, ev.y, ev.kind === 'firepot' ? 7 : 3);
      if (ev.kind === 'firepot') {
        this.sfx('firepot_smash', ev.x, ev.y, 0.55);
        this.fx.burst(5, { frame: 'fx/stonechip', x: ev.x, y: ev.y, z: 2, life: 0.6, g: 240, ground: 'stop', tint: 0xa86a4a }, 50, 50);
        this.ring(ev.x, ev.y, 14, 0xffa040, 0.3, 0.6);
      }
      return;
    }
    if (ev.kind === 'rocket' || ev.kind === 'grenade' || ev.kind === 'shell' || ev.kind === 'tankshell') {
      const size = ev.kind === 'shell' ? (ev.splash > 30 ? 1.6 : 1.2) : ev.kind === 'grenade' ? 0.7 : ev.kind === 'tankshell' ? 1.1 : 0.9;
      this.explosion(ev.x, ev.y, size);
      return;
    }
    if (ev.kind === 'bullet') {
      if (!ev.hit && this.cam.zoom > 1.2) {
        this.fx.emit({ frame: 'fx/dirt', x: ev.x, y: ev.y, z: 1, vz: 40, vx: (Math.random() - 0.5) * 30, g: 260, life: 0.3, ground: 'stop' });
        this.fx.emit({ frame: 'fx/puff2', x: ev.x, y: ev.y, life: 0.35, s0: 0.4, s1: 0.8, tint: DUST, alpha: 0.6 });
        if (Math.random() < 0.08) this.sfx('ricochet', ev.x, ev.y, 0.25);
      }
      return;
    }
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

  /**
   * A mark on the ground (stuck arrows, craters, dropped gear, wrecks, tracks) that fades after
   * `life` seconds. Each pool is capped: past the cap the oldest mark is recycled, so long matches
   * never pile up images.
   */
  private addDecal(frame: string, x: number, y: number, scale: number, life: number, flip = false, o?: DecalOpts) {
    const f = art.tryGet(frame);
    if (!f) return;
    const pool = o?.pool ?? 'fx';
    const list = pool === 'after' ? this.after : pool === 'track' ? this.tracks : this.stuck;
    const box = pool === 'track' ? this.trackC : this.decalC;
    let s = list.length >= DECAL_CAP[pool] ? list.shift() : undefined;
    if (!s) {
      const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false);
      box.add(img);
      s = { img, t: 0, life, a0: 1, fade: 3 };
    } else box.bringToTop(s.img);
    const a0 = o?.alpha ?? 1;
    s.img.setTexture(f.key, f.frame).setOrigin(f.ox, f.oy).setScale(scale).setRotation(o?.rot ?? 0);
    s.img.setPosition(Math.round(x), Math.round(y)).setAlpha(a0).setVisible(true).setFlipX(flip);
    if (o?.tint !== undefined) s.img.setTint(o.tint);
    else s.img.clearTint();
    s.t = 0;
    s.life = life;
    s.a0 = a0;
    s.fade = Math.min(10, Math.max(3, life * 0.12));
    list.push(s);
  }

  private terrainAt(x: number, y: number): number {
    const m = this.world.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return T.WATER;
    return m.terrain[ty * m.w + tx];
  }

  /** dust roughly the colour of the ground it comes off */
  private dustTint(ter: number) {
    return ter === T.SAND ? 0xe0d0a8 : ter === T.ROAD || ter === T.DIRT ? 0xd0bc98 : ter === T.FARMLAND ? 0xb8a080 : DUST;
  }

  /** what a fallen soldier leaves lying on the field */
  private gearFor(look: (typeof UNITS)[string]['look']): string[] {
    const out: string[] = [];
    const w = look.weapon;
    if (isModern()) {
      const gun = w === 'rifle' || w === 'smg' || w === 'mg' || w === 'sniper' || w === 'shotgun' || w === 'grenadier' || w === 'rocket' || w === 'flamethrower' || w === 'pistol';
      if (gun && Math.random() < 0.85) out.push('fx/drop_rifle');
      if ((look.helmet === 'combat' || look.helmet === 'patrol') && Math.random() < 0.45) out.push('fx/drop_helmet');
      if (Math.random() < (look.backpack || w === 'medkit' ? 0.55 : 0.15)) out.push('fx/drop_pack');
      return out;
    }
    if (Math.random() < 0.85) {
      if (w === 'sword' || w === 'greatsword' || w === 'axe' || w === 'club' || w === 'hammer') out.push('fx/drop_sword');
      else if (w === 'spear' || w === 'pike' || w === 'lance' || w === 'pitchfork') out.push('fx/drop_spear');
      else if (w === 'bow' || w === 'longbow' || w === 'crossbow') out.push('fx/drop_bow');
    }
    if (look.shield !== 'none' && Math.random() < 0.6) out.push(look.shield === 'kite' || look.shield === 'tower' || look.shield === 'riot' ? 'fx/drop_shield_kite' : 'fx/drop_shield');
    return out;
  }

  /** lasting marks where a soldier or machine fell: trampled earth, dropped gear, wrecks */
  private aftermath(ev: { x: number; y: number; faction: number; type: string }) {
    const def = UNITS[ev.type];
    if (!def || !this.near(ev.x, ev.y, 360)) return;
    const ter = this.terrainAt(ev.x, ev.y);
    if (ter === T.WATER || ter === T.SHALLOW) return;
    const red = this.reduced;
    const L = red ? 0.5 : 1;
    const look = def.look;
    const { x, y } = ev;
    const rnd = (m: number) => (Math.random() - 0.5) * m;
    const flip = Math.random() < 0.5;
    if (look.body === 'vehicle' || (isModern() && look.body === 'engine')) {
      // a blackened hulk on a scorched patch that smokes for a while
      const big = look.vehicle === 'tank' || look.vehicle === 'mlrs';
      const sc = big ? 1.1 : look.body === 'engine' ? 0.6 : 0.8;
      this.addDecal('fx/scorch', x, y + 1, big ? 1.6 : 1.25, 240 * L, flip, { pool: 'after', alpha: 0.7 });
      this.addDecal('fx/wreck', x, y + 1, sc, 240 * L, flip, { pool: 'after', rot: rnd(0.12) });
      this.addSmoulder(x, y - 3, 5 * sc, red ? 10 : 30);
      return;
    }
    if (look.body === 'engine') {
      // broken timbers where the engine stood
      if (!red) this.addDecal('fx/trample', x, y + 1, 1.4, 150, flip, { pool: 'after', alpha: 0.9 });
      this.addDecal('fx/rubble', x, y, 0.65, 150 * L, flip, { pool: 'after', tint: 0xe0c8a8 });
      return;
    }
    if (!red) this.addDecal('fx/trample', x + rnd(3), y + 1, look.mount ? 1.35 : 1, 150, flip, { pool: 'after', alpha: 0.9, rot: rnd(0.3) });
    if (ev.type.startsWith('worker')) return;
    const fc = this.world.factions[ev.faction]?.color;
    const shieldTint = fc ? Phaser.Display.Color.HexStringToColor(fc.light).color : undefined;
    for (const g of this.gearFor(look))
      this.addDecal(g, x + rnd(10), y + rnd(5), g === 'fx/drop_spear' && look.weapon === 'lance' ? 1 : 0.8, 150 * L, Math.random() < 0.5, {
        pool: 'after',
        rot: rnd(0.7),
        tint: g.startsWith('fx/drop_shield') ? shieldTint : undefined,
      });
    const infantry = !look.mount && (look.body === 'soldier' || look.body === 'heavy' || look.body === 'peasant');
    if (!red && infantry && Math.random() < 0.35) this.addDecal('fx/bloodspot', x + rnd(6), y + rnd(3), 1, 90, flip, { pool: 'after', alpha: 0.7 });
  }

  /** a building falls: rubble across its footprint, a scorch, and a smoulder that dies down */
  private ruin(ev: { id: number; x: number; y: number; type: string; size: number }) {
    if (!this.near(ev.x, ev.y, 360)) return;
    const b = this.world.buildingById.get(ev.id);
    const wall = ev.type === 'wall' || ev.type === 'gatehouse';
    const L = this.reduced ? 0.5 : 1;
    const half = (ev.size * TILE) / 2;
    // a breached core still stands: no rubble under it, only the smoke
    if (!b || b.destroyed) {
      if (!wall) this.addDecal('fx/scorch', ev.x, ev.y + half * 0.3, ev.size * 0.95, 300 * L, Math.random() < 0.5, { pool: 'after', alpha: 0.8 });
      const n = ev.size <= 1 ? 1 : ev.size === 2 ? 3 : ev.size * 2;
      for (let k = 0; k < n; k++) {
        const px = n === 1 ? ev.x : ev.x + (Math.random() - 0.5) * half * 1.5;
        const py = n === 1 ? ev.y + 2 : ev.y + (Math.random() - 0.35) * half * 1.2;
        this.addDecal('fx/rubble', px, py, wall ? 0.75 : 0.9 + Math.random() * 0.35, 300 * L, Math.random() < 0.5, { pool: 'after', rot: (Math.random() - 0.5) * 0.25 });
      }
    }
    if (ev.type === 'wall') return;
    this.addSmoulder(ev.x, ev.y + half * 0.2, half * 0.8, this.reduced ? 20 : 45);
  }

  private addSmoulder(x: number, y: number, r: number, life: number) {
    if (this.smoulders.length >= MAX_SMOULDER) this.smoulders.shift();
    this.smoulders.push({ x, y, r, t: 0, life });
  }

  /** ruins and wrecks keep smoking: slow grey puffs drifting off, the odd ember, dying down */
  private updateSmoulders(dt: number) {
    if (!this.smoulders.length) return;
    const v = this.cam.view(40);
    let k = 0;
    for (const s of this.smoulders) {
      s.t += dt;
      if (s.t >= s.life) continue;
      this.smoulders[k++] = s;
      if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1 + 40) continue;
      const f = 1 - s.t / s.life;
      if (Math.random() < dt * (0.9 + s.r * 0.07) * (0.3 + 0.7 * f) * (this.reduced ? 0.5 : 1)) {
        const big = Math.random() < 0.4;
        this.fx.emit({
          frame: big ? 'fx/puff6' : 'fx/puff4',
          x: s.x + (Math.random() - 0.5) * s.r * 2,
          y: s.y + (Math.random() - 0.5) * s.r * 0.8,
          z: 3,
          vx: 4 + Math.random() * 6,
          vy: -1,
          vz: 9 + Math.random() * 8,
          g: -3,
          life: 2.6 + Math.random() * 1.4,
          s0: 0.35,
          s1: big ? 1.7 : 2.2,
          tint: f > 0.6 ? 0x5a5258 : 0x8a8488,
          alpha: 0.26 + 0.26 * f,
          drag: 0.4,
        });
      }
      if (this.reduced) continue;
      // embers wink up out of the ashes
      if (Math.random() < dt * 1.8 * f * f)
        this.fx.emit({ frame: 'fx/dot', x: s.x + (Math.random() - 0.5) * s.r * 1.6, y: s.y + (Math.random() - 0.5) * s.r * 0.6, vx: (Math.random() - 0.5) * 10, vz: 16 + Math.random() * 16, g: -4, life: 0.9 + Math.random() * 0.6, tint: Math.random() < 0.5 ? 0xffb040 : 0xff7028, add: true, drag: 1 });
      // early on, a last lick of flame among the beams
      if (s.t < s.life * 0.25 && Math.random() < dt * 1.2)
        this.fx.emit({ frame: 'fx/fire0', frames: ['fx/fire0', 'fx/fire1', 'fx/fire2', 'fx/fire3'], fps: 10, x: s.x + (Math.random() - 0.5) * s.r * 1.4, y: s.y + (Math.random() - 0.5) * s.r * 0.5, vy: -4, life: 0.5, s0: 0.6, s1: 0.3, add: true, alpha: 0.8 });
    }
    this.smoulders.length = k;
  }

  /**
   * Moving troops kick up dust: horses and vehicles often, engines now and then, running infantry
   * rarely. Vehicles (modern) lay faint tread marks and horses hoofprints. View-culled, zoom-gated,
   * budgeted per tick.
   */
  private motion(tick: number) {
    const v = this.cam.view(10);
    const modern = isModern();
    const red = this.reduced;
    let budget = red ? 4 : 14;
    for (const u of this.world.units) {
      if (!u.alive) continue;
      if (u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
      const look = u.def.look;
      const mounted = !!look.mount;
      const vehicle = look.body === 'vehicle';
      const engine = look.body === 'engine';
      const runner = !mounted && !vehicle && !engine;
      if (runner && !(u.routing > 0 || (u.targetId && !u.isRanged) || u.chargeRun > 50)) continue;
      const spd = Math.hypot(u.vx, u.vy);
      if (spd < (runner ? 18 : engine ? 8 : 14)) continue;
      const ter = this.terrainAt(u.x, u.y);
      if (ter === T.WATER || ter === T.SHALLOW || ter === T.MARSH) continue;
      if (!red && ((vehicle && modern) || mounted)) this.leaveTrack(u, ter, vehicle, spd);
      const interval = mounted ? (spd > 35 ? 0.15 : 0.22) : vehicle ? 0.2 : engine ? 0.35 : 2.2;
      if (budget <= 0 || Math.random() > tick / interval) continue;
      budget--;
      const nx = u.vx / spd;
      const ny = u.vy / spd;
      const back = vehicle ? 8 : mounted ? 6 : 2;
      const tint = this.dustTint(ter);
      const n = vehicle && !red ? 2 : 1;
      for (let i = 0; i < n; i++)
        this.fx.emit({
          frame: runner ? 'fx/puff2' : 'fx/puff3',
          x: u.x - nx * back + (Math.random() - 0.5) * 4,
          y: u.y - ny * back * 0.5 + (i === 0 ? 0 : -2),
          vx: -u.vx * 0.15 + (Math.random() - 0.5) * 8,
          vy: -u.vy * 0.08,
          vz: 3 + Math.random() * 5,
          life: runner ? 0.45 : 0.7 + Math.random() * 0.25,
          s0: 0.5,
          s1: runner ? 1 : vehicle ? 1.7 : 1.4,
          tint,
          alpha: runner ? 0.4 : 0.5,
          drag: 2,
        });
    }
  }

  private leaveTrack(u: { id: number; x: number; y: number; def: (typeof UNITS)[string] }, ter: number, vehicle: boolean, spd: number) {
    if (ter === T.BRIDGE || ter === T.ROCK || (!vehicle && ter === T.ROAD)) return;
    const p = this.trackAt.get(u.id);
    if (!p) {
      this.trackAt.set(u.id, { x: u.x, y: u.y });
      return;
    }
    const dx = u.x - p.x;
    const dy = u.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < (vehicle ? 11 : 15)) return;
    p.x = u.x;
    p.y = u.y;
    // a jump (back on screen, teleport): restart the trail
    if (d > 40) return;
    if (!vehicle && (spd < 25 || Math.random() < 0.4)) return;
    const big = u.def.look.vehicle === 'tank' || u.def.look.vehicle === 'mlrs';
    this.addDecal(vehicle ? 'fx/tread' : 'fx/hoof', u.x - dx * 0.5, u.y - dy * 0.5 + 1, vehicle ? (big ? 1.15 : 0.9) : 1, vehicle ? 40 : 30, false, {
      pool: 'track',
      rot: Math.atan2(dy, dx),
      alpha: vehicle ? 0.75 : 0.8,
    });
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

  private fadeDecals(list: Stuck[], dt: number) {
    let k0 = 0;
    for (const s of list) {
      s.t += dt;
      if (s.t > s.life - s.fade) s.img.setAlpha(s.a0 * Math.max(0, (s.life - s.t) / s.fade));
      if (s.t > s.life) s.img.destroy();
      else list[k0++] = s;
    }
    list.length = k0;
  }

  update(dt: number, alpha: number) {
    this.updateStrikes(dt);
    this.updateSmoulders(dt);
    // hooves, wheels and running feet kick up dust (and leave tracks)
    this.moveT += dt;
    if (this.moveT >= 0.05) {
      if (this.cam.zoom >= 1) this.motion(Math.min(0.25, this.moveT));
      this.moveT = 0;
    }
    this.trackGcT += dt;
    if (this.trackGcT > 4) {
      this.trackGcT = 0;
      for (const id of this.trackAt.keys()) if (!this.world.unitById.get(id)?.alive) this.trackAt.delete(id);
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
        } else if (!u.def.look.mount && u.def.look.body !== 'engine' && u.def.look.body !== 'vehicle' && Math.random() < 0.18) {
          budget--;
          this.fx.emit({ frame: 'fx/puff2', x: u.x - u.facing * 2, y: u.y, vx: -u.vx * 0.1, vy: 0, vz: 3, life: 0.45, s0: 0.5, s1: 1, tint: DUST, alpha: 0.4, drag: 2 });
        }
      }
    }
    // projectiles
    const live = new Set<number>();
    const trails = this.cam.zoom > 1.3 && !this.reduced;
    for (const p of this.world.combat.projectiles) {
      // salvo rounds still waiting in the tubes; flame jets are drawn as particles
      if (p.t < 0 || p.kind === 'flame') continue;
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
        if (p.kind === 'rocket' || p.kind === 'shell') {
          // smoke trail
          if (Math.random() < (p.kind === 'rocket' ? 0.9 : 0.35)) this.fx.emit({ frame: 'fx/puff2', x, y, life: 0.6, tint: 0xe0d8d0, alpha: 0.55, s0: 0.5, s1: 1.2, drag: 2 });
        } else if (p.kind === 'bullet' || p.kind === 'tankshell') {
          // tracer
          if (trails && Math.random() < 0.5) this.fx.emit({ frame: 'fx/dot2', x, y, life: 0.08, tint: 0xfff0a0, add: true });
        } else if (trails && Math.random() < 0.4) this.fx.emit({ frame: 'fx/dot', x, y, life: 0.22, tint: 0xf8f0e0, alpha: 0.45, fadeAll: true });
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
    this.fadeDecals(this.stuck, dt);
    this.fadeDecals(this.after, dt);
    this.fadeDecals(this.tracks, dt);
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

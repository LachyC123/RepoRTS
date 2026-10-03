import Phaser from 'phaser';
import { canvasTexture } from './texUtil';
import { hash2 } from '../core/Random';
import { NEUTRAL, TILE } from '../data/constants';
import type { KingdomColor } from '../data/factions';
import type { Building } from '../sim/buildings/Building';
import type { Settlement } from '../sim/territory/Settlement';
import type { World } from '../sim/World';
import { drawBuilding, drawCottage, drawFlag, drawRubble, drawWall, type BuildingSprite, type BuildingState } from './art/buildingArt';
import type { Particles } from './Particles';
import type { SortObj, YSortLayer } from './YSortLayer';

type BObj = SortObj & { bkey?: string; flash?: number };

interface Rec {
  img: BObj;
  flag?: BObj;
  flagLift: number;
  owner: number;
}

/**
 * Draws settlements: core halls and castles, plot buildings (with construction and damage states),
 * walls and gatehouses that connect to their neighbours, decorative cottages that multiply as a
 * settlement grows, rubble, waving team flags (with a lowering/raising animation on capture), and
 * fire/smoke on damaged buildings. Sprites are generated lazily per variant and cached as textures.
 */
export class BuildingRenderer {
  private recs = new Map<number, Rec>();
  private cottageObjs = new Map<number, { objs: BObj[]; sig: string }>();
  private smokeT = 0;
  playerFaction = -1;
  visibleTest: (b: Building) => boolean = () => true;
  exploredTest: (x: number, y: number) => boolean = () => true;
  reduced = false;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private ylayer: YSortLayer,
    private fx: Particles,
  ) {
    world.events.on('buildingHit', (e) => {
      const r = this.recs.get(e.id);
      if (r) r.img.flash = 0.08;
    });
    world.events.on('regionCaptured', (e) => {
      const s = world.settlements[e.regionId];
      const r = this.recs.get(s.coreId);
      if (r) r.flagLift = 1; // lower old flag, raise new one
    });
  }

  private team(f: number): KingdomColor | null {
    if (f === NEUTRAL) return null;
    return this.world.factions[f]?.color ?? null;
  }

  private tex(key: string, make: () => BuildingSprite): { key: string; ox: number; oy: number } {
    const tm = this.scene.textures;
    const meta = this.meta.get(key);
    if (meta && tm.exists(key)) return meta;
    const spr = make();
    const canvas = spr.pc.flush();
    // copy to a fresh canvas: PixelCanvas canvases are reused by nobody but keep it safe
    canvasTexture(this.scene, key, canvas);
    const m = { key, ox: spr.ax / spr.pc.w, oy: spr.ay / spr.pc.h };
    this.meta.set(key, m);
    return m;
  }
  private meta = new Map<string, { key: string; ox: number; oy: number }>();

  private stateOf(b: Building): BuildingState {
    if (b.progress < 0.5) return 'construction1';
    if (b.progress < 1) return 'construction2';
    if (b.breached) return 'ruined';
    if (b.hp < b.maxHp * 0.5) return 'damaged';
    return 'built';
  }

  private keyFor(b: Building): { key: string; ox: number; oy: number } {
    const w = this.world;
    const s = w.settlements[b.settlementId];
    const team = this.team(b.faction);
    const cid = team?.id ?? 'n';
    if (b.destroyed) {
      const v = b.id % 3;
      return this.tex(`bld:rubble:${b.size}:${v}`, () => drawRubble(b.size, v));
    }
    if (b.def.id === 'wall' || b.def.id === 'gatehouse') {
      const m = w.map;
      let mask = 0;
      const isW = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
        const o = w.buildingById.get(m.occ[y * m.w + x]);
        return !!o && !o.destroyed && (o.def.id === 'wall' || o.def.id === 'gatehouse');
      };
      if (isW(b.tx, b.ty - 1)) mask |= 1;
      if (isW(b.tx + 1, b.ty)) mask |= 2;
      if (isW(b.tx, b.ty + 1)) mask |= 4;
      if (isW(b.tx - 1, b.ty)) mask |= 8;
      const kind = s.fortify >= 2 ? 'stone' : 'palisade';
      const dmg = b.hp < b.maxHp * 0.5;
      const gate = b.def.id === 'gatehouse';
      return this.tex(`bld:wall:${kind}:${mask}:${gate ? 1 : 0}:${cid}:${dmg ? 1 : 0}`, () => drawWall(kind, mask, gate, team, dmg));
    }
    const st = this.stateOf(b);
    const variant = Math.floor(hash2(b.id, 7, 3) * 4);
    const tier = s.tier;
    const landmark = b.def.id === 'landmark' ? s.region.landmark : null;
    const deposit = b.def.id === 'mine' || landmark === 'mine' ? b.depositKind ?? (s.region.features.includes('gold') ? 'gold' : 'stone') : null;
    const key = `bld:${b.def.id}:${b.size}:${cid}:${st}:${variant}:${tier}:${landmark ?? ''}:${deposit ?? ''}`;
    return this.tex(key, () => drawBuilding(b.def.id, b.size, team, st, { tier, variant, landmark, deposit }));
  }

  private flagKey(team: KingdomColor, frame: number) {
    return this.tex(`flag:${team.id}:${frame}`, () => drawFlag(team, frame));
  }

  private hasFlag(b: Building) {
    return b.def.category === 'core' || b.def.id === 'watchtower' || b.def.id === 'barracks' || b.def.id === 'landmark';
  }

  update(dt: number, time: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const w = this.world;
    const seen = new Set<number>();
    for (const b of w.buildings) {
      const x0 = b.tx * TILE;
      const y0 = b.ty * TILE;
      const on = x0 + b.size * TILE > view.x0 - 32 && x0 < view.x1 + 32 && y0 > view.y0 - 80 && y0 < view.y1 + 40;
      if (!on) continue;
      if (b.faction !== this.playerFaction && b.faction !== NEUTRAL && !this.exploredTest(b.x, b.y)) continue;
      if (b.destroyed && w.time - b.destroyedT > 30) continue;
      seen.add(b.id);
      let r = this.recs.get(b.id);
      const k = this.keyFor(b);
      if (!r) {
        const img = this.scene.make.image({ x: b.x, y: (b.ty + b.size) * TILE, key: k.key }, false) as BObj;
        img.setOrigin(k.ox, k.oy);
        img.bkey = k.key;
        img.sy = (b.ty + b.size) * TILE - (b.destroyed ? 14 : 2);
        this.ylayer.add(img);
        r = { img, flagLift: 0, owner: b.faction };
        this.recs.set(b.id, r);
      } else if (r.img.bkey !== k.key) {
        r.img.setTexture(k.key);
        r.img.setOrigin(k.ox, k.oy);
        r.img.bkey = k.key;
        r.img.sy = (b.ty + b.size) * TILE - (b.destroyed ? 14 : 2);
      }
      r.img.setPosition(Math.round(b.x), (b.ty + b.size) * TILE);
      if (r.img.flash && r.img.flash > 0) {
        r.img.flash -= dt;
        r.img.setTintFill(0xffe8d0);
        if (r.img.flash <= 0) r.img.clearTint();
      }
      // flags
      const team = this.team(b.faction);
      const wantFlag = !b.destroyed && b.built && this.hasFlag(b) && (team || r.flagLift > 0);
      if (wantFlag) {
        if (!r.flag) {
          const fk = this.flagKey(team ?? this.world.factions[0].color, 0);
          r.flag = this.scene.make.image({ x: 0, y: 0, key: fk.key }, false) as BObj;
          r.flag.setOrigin(fk.ox, fk.oy);
          this.ylayer.add(r.flag);
        }
        const frame = Math.floor(time * 6 + b.id) % 4;
        // flag swap animation on capture: lower (0.5s) then raise in new colours
        let lift = 0;
        if (r.flagLift > 0) {
          r.flagLift = Math.max(0, r.flagLift - dt / 1.2);
          const t = 1 - r.flagLift;
          lift = t < 0.5 ? t * 2 : (1 - t) * 2;
        }
        const showTeam = r.flagLift > 0.5 ? this.team(r.owner) : team;
        if (r.flagLift <= 0.5) r.owner = b.faction;
        if (showTeam) {
          const fk = this.flagKey(showTeam, frame);
          r.flag.setTexture(fk.key).setVisible(true);
        } else r.flag.setVisible(false);
        const fx = b.x + b.size * TILE * 0.32;
        const fy = b.ty * TILE - (b.def.category === 'core' ? b.size * 4 + 6 : 4) + lift * 10;
        r.flag.setPosition(Math.round(fx), Math.round(fy));
        r.flag.sy = (b.ty + b.size) * TILE - 1;
      } else if (r.flag) {
        r.flag.setVisible(false);
      }
    }
    for (const [id, r] of this.recs) {
      if (seen.has(id)) continue;
      this.ylayer.remove(r.img);
      r.img.destroy();
      if (r.flag) {
        this.ylayer.remove(r.flag);
        r.flag.destroy();
      }
      this.recs.delete(id);
    }
    this.updateCottages(view);
    this.emitters(dt, view);
  }

  private updateCottages(view: { x0: number; y0: number; x1: number; y1: number }) {
    const w = this.world;
    const m = w.map;
    for (const s of w.settlements) {
      const on = s.cx > view.x0 - 200 && s.cx < view.x1 + 200 && s.cy > view.y0 - 200 && s.cy < view.y1 + 200;
      let rec = this.cottageObjs.get(s.id);
      if (!on) {
        if (rec) {
          for (const o of rec.objs) {
            this.ylayer.remove(o);
            o.destroy();
          }
          this.cottageObjs.delete(s.id);
        }
        continue;
      }
      const team = this.team(s.owner);
      const sig = `${s.cottages.length}:${s.tier}:${team?.id ?? 'n'}`;
      if (rec && rec.sig === sig) continue;
      if (rec) for (const o of rec.objs) {
        this.ylayer.remove(o);
        o.destroy();
      }
      rec = { objs: [], sig };
      for (const i of s.cottages) {
        const tx = i % m.w;
        const ty = Math.floor(i / m.w);
        const v = Math.floor(hash2(tx, ty, 41) * 6);
        const k = this.tex(`cottage:${v}:${team?.id ?? 'n'}:${s.tier}`, () => drawCottage(v, team, s.tier));
        const o = this.scene.make.image({ x: tx * TILE + 8, y: (ty + 1) * TILE, key: k.key }, false) as BObj;
        o.setOrigin(k.ox, k.oy);
        o.sy = (ty + 1) * TILE - 2;
        this.ylayer.add(o);
        rec.objs.push(o);
      }
      this.cottageObjs.set(s.id, rec);
    }
  }

  /** fire on damaged buildings, chimney smoke on homes and forges */
  private emitters(dt: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    this.smokeT += dt;
    if (this.smokeT < 0.12) return;
    const step = this.smokeT;
    this.smokeT = 0;
    const fx = this.fx;
    const w = this.world;
    const q = this.reduced ? 0.4 : 1;
    for (const b of w.buildings) {
      if (b.destroyed || !b.built) continue;
      if (b.x < view.x0 - 40 || b.x > view.x1 + 40 || b.y < view.y0 - 60 || b.y > view.y1 + 60) continue;
      const top = b.ty * TILE;
      const frac = b.hp / b.maxHp;
      const burning = b.breached || frac < 0.5;
      if (burning && b.def.id !== 'wall' && b.def.category !== 'landmark') {
        const intensity = (b.breached ? 1 : (0.5 - frac) * 2 + 0.25) * b.size * q;
        if (Math.random() < intensity * step * 6) {
          const x = b.x + (Math.random() - 0.5) * b.size * 11;
          const y = top + b.size * 6 + Math.random() * b.size * 5;
          fx.emit({ frame: 'fx/flame0', frames: ['fx/flame0', 'fx/flame1', 'fx/flame2', 'fx/flame3'], fps: 10, x, y, life: 0.6 + Math.random() * 0.4, s0: 0.9, s1: 0.5, vz: 6 });
        }
        if (Math.random() < intensity * step * 4) {
          const x = b.x + (Math.random() - 0.5) * b.size * 10;
          fx.emit({ frame: 'fx/puff4', x, y: top + b.size * 5, vz: 14 + Math.random() * 8, vx: 6 + Math.random() * 4, life: 2.2, s0: 0.6, s1: 2.2, tint: 0x3a3440, alpha: 0.55, drag: 0.3 });
        }
      }
      // chimneys
      const chimney = b.def.id === 'house' || b.def.id === 'blacksmith' || b.def.id === 'village_hall' || b.def.id === 'town_hall';
      if (chimney && Math.random() < step * (b.def.id === 'blacksmith' ? 2.2 : 0.7) * q) {
        fx.emit({ frame: 'fx/puff2', x: b.x - b.size * 3 + 2, y: top + 2, vz: 8, vx: 3 + Math.random() * 3, life: 2.4, s0: 0.6, s1: 2, tint: 0xd8d4dc, alpha: 0.45, drag: 0.2 });
      }
      if (b.def.id === 'blacksmith' && Math.random() < step * 3 * q) {
        fx.emit({ frame: 'fx/dot', x: b.x + 6 + (Math.random() - 0.5) * 4, y: b.y + 6, vz: 20 + Math.random() * 20, vx: (Math.random() - 0.5) * 20, g: 60, life: 0.6, tint: 0xffb040, add: true });
      }
    }
    // cottage chimneys
    const m = w.map;
    for (const s of w.settlements) {
      if (!s.cottages.length) continue;
      if (s.cx < view.x0 - 150 || s.cx > view.x1 + 150 || s.cy < view.y0 - 150 || s.cy > view.y1 + 150) continue;
      for (const i of s.cottages) {
        if (Math.random() > step * 0.35 * q) continue;
        const x = (i % m.w) * TILE + 5;
        const y = Math.floor(i / m.w) * TILE - 2;
        fx.emit({ frame: 'fx/puff2', x, y, vz: 7, vx: 3, life: 2.2, s0: 0.5, s1: 1.7, tint: 0xd8d4dc, alpha: 0.4, drag: 0.2 });
      }
    }
  }

  /** used by picking */
  recOf(id: number) {
    return this.recs.get(id);
  }

  settlementOf(s: Settlement) {
    return s;
  }
}

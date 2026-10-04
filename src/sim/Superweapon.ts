import { NEUTRAL, TILE, type FactionId } from '../data/constants';
import { eraState } from '../data/era';
import { T } from './map/GameMap';
import type { Building } from './buildings/Building';
import type { Unit } from './units/Unit';
import type { World } from './World';

export interface Strike {
  id: number;
  faction: FactionId;
  siloId: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  launchT: number;
  impactT: number;
  warned: boolean;
  kind: 'missile' | 'fireball';
}

/** seconds to load / fuel after building or firing */
export const SILO_CHARGE = { medieval: 210, modern: 260 };
const FLIGHT = { medieval: 8, modern: 12 };
export const STRIKE_RADIUS = 7 * TILE;

/**
 * The superweapon: a Missile Silo (or, a thousand years earlier, a Great Bombard) loads one shot at
 * a time and can hit anywhere in the valley. Soldiers near the aim point get a few seconds of
 * warning (and mostly use them to scream and run), then everything nearby is flattened, burned
 * and cratered. Whoever is in command decides where it lands.
 */
export class SuperweaponSystem {
  strikes: Strike[] = [];
  /** silo building id -> load progress 0..1 */
  charge = new Map<number, number>();

  constructor(private w: World) {}

  silos(f: FactionId): Building[] {
    return this.w.buildings.filter((b) => b.def.id === 'silo' && b.faction === f && !b.destroyed && b.progress >= 1);
  }

  ready(b: Building) {
    return (this.charge.get(b.id) ?? 0) >= 1;
  }

  /** fire a loaded silo at a point */
  launch(f: FactionId, siloId: number, x: number, y: number): { ok: boolean; reason?: string } {
    const w = this.w;
    const b = w.buildingById.get(siloId);
    if (!b || b.destroyed || b.faction !== f || b.def.id !== 'silo') return { ok: false, reason: 'No silo' };
    if (!this.ready(b)) return { ok: false, reason: 'Still loading' };
    const m = w.map;
    x = Math.max(TILE, Math.min((m.w - 1) * TILE, x));
    y = Math.max(TILE, Math.min((m.h - 1) * TILE, y));
    this.charge.set(b.id, 0);
    const modern = eraState.era === 'modern';
    const s: Strike = {
      id: w.newId(),
      faction: f,
      siloId,
      fromX: b.x,
      fromY: b.y - b.size * 8,
      x,
      y,
      launchT: w.time,
      impactT: w.time + FLIGHT[eraState.era],
      warned: false,
      kind: modern ? 'missile' : 'fireball',
    };
    this.strikes.push(s);
    w.events.emit('superLaunch', { id: s.id, faction: f, x: s.fromX, y: s.fromY, tx: x, ty: y, kind: s.kind, flight: s.impactT - s.launchT });
    const p = w.setup.player;
    const tr = w.map.region[Math.floor(y / TILE) * w.map.w + Math.floor(x / TILE)];
    const owner = tr >= 0 ? w.settlements[tr]?.owner : -1;
    const fac = w.factions[f];
    const what = modern ? 'MISSILE LAUNCH' : 'THE GREAT BOMBARD FIRES';
    w.notify({
      kind: 'war',
      text: `${what}: ${fac.name.toUpperCase()}`,
      sub: owner === p && f !== p ? 'It is coming for YOUR land!' : tr >= 0 ? `Aimed at ${w.settlements[tr].name}` : undefined,
      factions: [f, owner as FactionId],
      x,
      y,
      priority: 2,
      alarm: owner === p && f !== p,
      world: true,
    });
    // firing the big gun at someone is a declaration of war in itself
    if (owner !== undefined && owner >= 0 && owner !== NEUTRAL && owner !== f && !w.diplomacy.atWar(f, owner as FactionId)) w.diplomacy.declareWar(f, owner as FactionId, 'attack');
    return { ok: true };
  }

  update(dt: number) {
    const w = this.w;
    const rate = 1 / SILO_CHARGE[eraState.era];
    for (const b of w.buildings) {
      if (b.def.id !== 'silo' || b.destroyed || b.progress < 1 || !b.active) continue;
      const c = this.charge.get(b.id) ?? 0;
      if (c < 1) {
        const n = Math.min(1, c + dt * rate * (1 + (b.level - 1) * 0.25));
        this.charge.set(b.id, n);
        if (n >= 1) w.events.emit('siloReady', { id: b.id, x: b.x, y: b.y, faction: b.faction });
      }
    }
    if (!this.strikes.length) return;
    const keep: Strike[] = [];
    for (const s of this.strikes) {
      if (!s.warned && w.time >= s.impactT - 5) {
        s.warned = true;
        this.warn(s);
      }
      if (w.time >= s.impactT) this.impact(s);
      else keep.push(s);
    }
    this.strikes = keep;
  }

  /** a few seconds out: everyone near the aim point looks up */
  private warn(s: Strike) {
    const w = this.w;
    w.events.emit('superWarning', { id: s.id, x: s.x, y: s.y, kind: s.kind });
    let spoke = 0;
    w.unitHash.query(s.x, s.y, STRIKE_RADIUS * 1.3, (u) => {
      if (!u.alive || u.def.special === 'worker' || u.def.look.body === 'engine') return;
      // most people run; the brave and the berserk do not
      const brave = u.persona?.trait === 'brave' || u.persona?.state === 'berserk';
      if (!brave && u.routing <= 0 && w.rng.next() < 0.75) this.flee(u, s);
      if (u.persona && spoke < 3 && w.rng.next() < 0.4) {
        spoke++;
        w.living?.speak(u, 'incoming');
      }
    });
  }

  private flee(u: Unit, s: Strike) {
    const w = this.w;
    w.morale.rout(u);
    // run straight away from the aim point
    const dx = u.x - s.x;
    const dy = u.y - s.y;
    const l = Math.hypot(dx, dy) || 1;
    const tx = u.x + (dx / l) * STRIKE_RADIUS * 1.4;
    const ty = u.y + (dy / l) * STRIKE_RADIUS * 1.4;
    w.setDestination(u, tx, ty, 0);
  }

  private impact(s: Strike) {
    const w = this.w;
    const r = STRIKE_RADIUS;
    const shooter = w.factions[s.faction];
    let kills = 0;
    w.unitHash.query(s.x, s.y, r, (u) => {
      if (!u.alive) return;
      const d = Math.hypot(u.x - s.x, u.y - s.y);
      if (d > r) return;
      const fall = 1 - (d / r) * 0.75;
      const dmg = (s.kind === 'missile' ? 180 : 140) * fall;
      u.hp -= dmg;
      u.hitFlash = 0.2;
      u.lastHitT = w.time;
      if (u.hp <= 0) {
        if (!w.living?.shrugOff(u)) {
          w.combat.kill(u, s.faction, null, dmg * 2);
          kills++;
        }
      } else if (u.def.look.body !== 'vehicle' && u.def.look.body !== 'engine') {
        u.burnT = Math.max(u.burnT, 2 + w.rng.next() * 2);
        u.burnBy = s.faction;
      }
    });
    w.buildingHash.query(s.x, s.y, r + 40, (b) => {
      if (b.destroyed) return;
      const d = b.edgeDist(s.x, s.y);
      if (d > r) return;
      const fall = 1 - (d / r) * 0.6;
      w.combat.damageBuilding(b, (s.kind === 'missile' ? 1100 : 850) * fall, 'siege', 1, s.faction);
      if (!b.destroyed && w.rng.next() < 0.6) {
        b.burnT = 10;
        b.burnBy = s.faction;
      }
    });
    // flatten the woods
    const m = w.map;
    const tcx = Math.floor(s.x / TILE);
    const tcy = Math.floor(s.y / TILE);
    const tr = 4;
    let felled = false;
    for (let y = tcy - tr; y <= tcy + tr; y++)
      for (let x = tcx - tr; x <= tcx + tr; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h || (x - tcx) ** 2 + (y - tcy) ** 2 > tr * tr) continue;
        const i = y * m.w + x;
        if (m.tree[i]) {
          m.tree[i] = 0;
          m.treeHp[i] = 0;
          m.stump[i] = 1;
          felled = true;
          w.regrowth.push({ i, t: w.time + 240 + w.rng.next() * 200 });
        }
        if (m.terrain[i] === T.FARMLAND && w.rng.next() < 0.6) m.crop[i] = 0;
      }
    if (felled) {
      m.version++;
      w.events.emit('mapChanged', { tx: tcx - tr, ty: tcy - tr, w: tr * 2 + 1, h: tr * 2 + 1 });
    }
    w.events.emit('superImpact', { id: s.id, x: s.x, y: s.y, kind: s.kind, faction: s.faction, kills });
    w.leaders.think(s.faction, kills > 6 ? 'won' : 'muse', { target: 'that' }, {});
    if (kills > 0)
      w.notify({ kind: 'war', text: `${s.kind === 'missile' ? 'MISSILE' : 'BOMBARD'} STRIKE: ${kills} KILLED`, sub: `Fired by ${shooter.name}`, factions: [s.faction], x: s.x, y: s.y, priority: 1, world: true, quiet: true });
  }

  // ------------------------------------------------------------------ targeting (AI and the "auto target" button)
  /** the best place to drop it: big hostile armies, or failing that a hostile town */
  bestTarget(f: FactionId, eccentric = false): { x: number; y: number; score: number; name: string } | null {
    const w = this.w;
    if (eccentric && w.rng.next() < 0.2) {
      // "for science": somewhere random, ideally not on our own people
      const x = (4 + w.rng.next() * (w.map.w - 8)) * TILE;
      const y = (4 + w.rng.next() * (w.map.h - 8)) * TILE;
      let own = false;
      w.unitHash.query(x, y, STRIKE_RADIUS, (u) => {
        if (u.alive && u.faction === f) own = true;
      });
      if (!own) return { x, y, score: 1, name: 'an empty field' };
    }
    const cell = 6 * TILE;
    const grid = new Map<number, { p: number; x: number; y: number; n: number }>();
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker' || u.faction === NEUTRAL || u.faction === f || !w.diplomacy.atWar(f, u.faction)) continue;
      if (!(u.seenBy & (1 << f))) continue;
      const k = Math.floor(u.x / cell) + Math.floor(u.y / cell) * 1000;
      const g = grid.get(k) ?? { p: 0, x: 0, y: 0, n: 0 };
      g.p += u.def.power;
      g.x += u.x;
      g.y += u.y;
      g.n++;
      grid.set(k, g);
    }
    let best: { x: number; y: number; score: number; name: string } | null = null;
    for (const g of grid.values()) {
      const x = g.x / g.n;
      const y = g.y / g.n;
      // never on our own soldiers
      let ownP = 0;
      w.unitHash.query(x, y, STRIKE_RADIUS, (u) => {
        if (u.alive && u.faction === f) ownP += u.def.power;
      });
      // gather the whole blast area
      let p = 0;
      w.unitHash.query(x, y, STRIKE_RADIUS, (u) => {
        if (u.alive && u.faction !== f && u.faction !== NEUTRAL && w.diplomacy.atWar(f, u.faction)) p += u.def.power;
      });
      const score = p - ownP * 3;
      if (!best || score > best.score) {
        const ri = w.map.region[Math.floor(y / TILE) * w.map.w + Math.floor(x / TILE)];
        best = { x, y, score, name: ri >= 0 ? w.settlements[ri].name : 'the field' };
      }
    }
    // no army worth it: a hostile town's core
    if (!best || best.score < 8) {
      for (const s of w.settlements) {
        if (s.owner === f || s.owner === NEUTRAL || !w.diplomacy.atWar(f, s.owner)) continue;
        const sc = 6 + s.tier * 2 + (s.isCapital ? 6 : 0);
        if (!best || sc > best.score) best = { x: s.px, y: s.py - 8, score: sc, name: s.name };
      }
    }
    return best;
  }
}

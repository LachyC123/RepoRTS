import { NEUTRAL, TILE } from '../../data/constants';
import type { World } from '../World';
import type { Unit } from './Unit';

/**
 * Light morale: casualties, being outnumbered, cavalry charges, lost settlements and fallen
 * commanders wear units down; rest and commanders restore them. Broken units rout briefly toward
 * safety, then rally. It shapes believable battles without micromanagement.
 */
export class MoraleSystem {
  private t = 0;
  constructor(private w: World) {}

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    // routing movement every tick
    for (const u of w.units) {
      if (!u.alive || u.routing <= 0) continue;
      u.routing -= dt;
      if (u.routing <= 0) {
        u.routing = 0;
        u.morale = 45;
        w.events.emit('unitRallied', { id: u.id, x: u.x, y: u.y, faction: u.faction });
        u.order = { kind: 'idle' };
        u.homeX = u.x;
        u.homeY = u.y;
        u.path = null;
        u.arrived = true;
      }
    }
    if (this.t < 0.5) return;
    const step = this.t;
    this.t = 0;
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker') continue;
      if (u.def.tags.includes('siege') || u.def.special === 'commander') {
        u.morale = 100;
        continue;
      }
      const f = w.factions[u.faction];
      let friends = 0;
      let foes = 0;
      w.unitHash.query(u.x, u.y, 6 * TILE, (o) => {
        if (!o.alive || o.def.special === 'worker') return;
        if (o.faction === u.faction) friends += o.def.power;
        else if (w.isHostile(u.faction, o.faction)) foes += o.def.power;
      });
      const inCombat = w.time - u.lastHitT < 3 || foes > 0;
      let delta = inCombat ? 1.5 : 7;
      if (foes > friends * 2 && foes > 2) delta -= 4 + Math.min(4, (foes / Math.max(1, friends) - 2) * 1.5);
      if (u.hp < u.maxHp * 0.3 && inCombat) delta -= 1.5;
      const inspired = w.inspired(u);
      if (inspired) delta += 3;
      // personalities: the brave and the steady hold, the nervous wobble
      const tr = u.persona?.trait;
      if (delta < 0) delta *= tr === 'brave' ? 0.5 : tr === 'steady' ? 0.75 : tr === 'coward' ? 1.4 : 1;
      if (u.persona?.state === 'berserk') delta = Math.max(delta, 2);
      const devotion = f.upgrades.has('devotion') ? 15 : 0;
      u.morale = Math.min(100, u.morale + delta * step);
      const floor = inspired ? 30 : 0;
      if (u.morale < floor) u.morale = floor;
      if (u.morale < 15 - devotion * 0.5 && inCombat && u.routing <= 0) this.rout(u);
    }
  }

  rout(u: Unit) {
    const w = this.w;
    u.routing = 4 + w.rng.next() * 2;
    if (u.persona) u.persona.routs++;
    u.targetId = 0;
    w.events.emit('unitRouted', { id: u.id, x: u.x, y: u.y, faction: u.faction });
    u.windup = 0;
    // flee toward the nearest friendly settlement, else directly away from enemies
    let tx = u.x;
    let ty = u.y;
    let best = Infinity;
    for (const s of w.settlements) {
      if (s.owner !== u.faction) continue;
      const d = Math.hypot(s.px - u.x, s.py - u.y);
      if (d < best && d > 3 * TILE) {
        best = d;
        tx = s.px;
        ty = s.py;
      }
    }
    if (best === Infinity || u.faction === NEUTRAL) {
      let ax = 0;
      let ay = 0;
      w.unitHash.query(u.x, u.y, 7 * TILE, (o) => {
        if (o.alive && w.isHostile(u.faction, o.faction)) {
          ax += u.x - o.x;
          ay += u.y - o.y;
        }
      });
      const l = Math.hypot(ax, ay) || 1;
      tx = u.x + (ax / l) * 8 * TILE;
      ty = u.y + (ay / l) * 8 * TILE;
      if (u.faction === NEUTRAL) {
        tx = u.homeX;
        ty = u.homeY;
      }
    } else {
      // don't run all the way home: a few tiles toward it
      const dx = tx - u.x;
      const dy = ty - u.y;
      const l = Math.hypot(dx, dy) || 1;
      const run = Math.min(l, 9 * TILE);
      tx = u.x + (dx / l) * run;
      ty = u.y + (dy / l) * run;
    }
    u.order = { kind: 'flee', x: tx, y: ty };
    w.setDestination(u, tx, ty, 0);
  }

  /** settlement fell: defenders in the region lose heart */
  settlementLost(regionId: number, faction: number) {
    const w = this.w;
    for (const u of w.units) {
      if (!u.alive || u.faction !== faction) continue;
      const tx = Math.floor(u.x / TILE);
      const ty = Math.floor(u.y / TILE);
      if (w.map.region[ty * w.map.w + tx] === regionId) u.morale -= 15;
    }
  }
}

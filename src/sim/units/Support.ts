import { NEUTRAL, TILE } from '../../data/constants';
import type { World } from '../World';
import type { Unit } from './Unit';

/**
 * Support troops and fire: medics heal the people around them and walk over to the hurt,
 * musicians keep spirits up (and occasionally play something awful), and anything set alight by
 * firepots or flamethrowers burns for a while. Burning soldiers run about and shout about it.
 */
export class SupportSystem {
  private t = 0;
  private musicT = 0;

  constructor(private w: World) {}

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    this.musicT += dt;
    if (this.t < 0.5) return;
    const step = this.t;
    this.t = 0;
    const playing = this.musicT > 7;
    if (playing) this.musicT = 0;
    for (const u of w.units) {
      if (!u.alive) continue;
      if (u.burnT > 0) this.burnUnit(u, step);
      const d = u.def;
      if (d.healer) this.heal(u, step);
      if (d.inspire) this.inspire(u, step, playing);
    }
    for (const b of w.buildings) {
      if (b.burnT <= 0 || b.destroyed) continue;
      b.burnT -= step;
      w.combat.damageBuilding(b, 7 * step, 'siege', 1, b.burnBy as never);
      // the fire spreads to the building next door, now and then
      if (w.rng.next() < 0.015 * step * 2) {
        w.buildingHash.query(b.x, b.y, b.size * 16 + 20, (o) => {
          if (o !== b && !o.destroyed && o.burnT <= 0 && o.def.category !== 'core' && w.rng.next() < 0.5) {
            o.burnT = 6;
            o.burnBy = b.burnBy;
          }
        });
      }
    }
  }

  private burnUnit(u: Unit, step: number) {
    const w = this.w;
    u.burnT -= step;
    const dmg = 4 * step;
    u.hp -= dmg;
    u.hitFlash = 0.1;
    u.lastHitT = w.time;
    if (u.hp <= 0) {
      if (!w.living?.shrugOff(u)) w.combat.kill(u, u.burnBy as never, null, dmg);
      return;
    }
    // running around on fire
    if (u.routing <= 0 && u.def.look.body !== 'engine' && w.rng.next() < 0.35) {
      w.morale.rout(u);
      if (u.persona) w.living?.speak(u, 'burn', {}, false);
    }
  }

  private heal(m: Unit, step: number) {
    const w = this.w;
    const amount = (m.def.healer ?? 0) * step;
    let worst: Unit | null = null;
    let wd = 1;
    let healed = 0;
    w.unitHash.query(m.x, m.y, 8 * TILE, (o) => {
      if (!o.alive || o.faction !== m.faction || o.def.look.body === 'vehicle' || o.def.look.body === 'engine') return;
      const frac = o.hp / o.maxHp;
      const d = Math.hypot(o.x - m.x, o.y - m.y);
      if (d < 4 * TILE && frac < 1) {
        o.hp = Math.min(o.maxHp, o.hp + amount);
        if (o.burnT > 0) o.burnT = Math.max(0, o.burnT - step * 2);
        healed++;
      } else if (frac < 0.7 && frac < wd && o !== m) {
        wd = frac;
        worst = o;
      }
    });
    if (healed && w.rng.next() < 0.25) w.events.emit('healPulse', { id: m.id, x: m.x, y: m.y, faction: m.faction });
    // idle medics walk over to whoever needs them most
    const target = worst as Unit | null;
    if (target && m.auto && !m.targetId && m.arrived && m.order.kind !== 'hold' && m.persona?.state !== 'rescue') {
      w.setDestination(m, target.x + 6, target.y + 4, 0);
      m.order = { kind: 'move', x: target.x, y: target.y, attackMove: false };
    }
  }

  private inspire(b: Unit, step: number, playing: boolean) {
    const w = this.w;
    const amount = (b.def.inspire ?? 0) * step;
    let n = 0;
    w.unitHash.query(b.x, b.y, 5 * TILE, (o) => {
      if (!o.alive || o.faction !== b.faction || o === b) return;
      o.morale = Math.min(100, o.morale + amount);
      n++;
    });
    if (playing && b.faction !== NEUTRAL && w.rng.next() < 0.5) {
      // one song in ten is so bad that everyone nearby (friend and foe) winces
      const awful = w.rng.next() < 0.1;
      w.events.emit('music', { id: b.id, x: b.x, y: b.y, faction: b.faction, awful });
      if (awful) {
        w.unitHash.query(b.x, b.y, 5 * TILE, (o) => {
          if (o.alive && o !== b) o.morale = Math.max(0, o.morale - 6);
        });
        if (b.persona) w.living?.speak(b, 'awful');
      } else if (n > 2 && b.persona && w.rng.next() < 0.3) w.living?.speak(b, 'song');
    }
  }
}

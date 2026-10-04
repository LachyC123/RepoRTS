import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import type { World } from '../World';
import type { Persona, Trait } from './Persona';
import type { Unit } from './Unit';

/** a gathering around a fire in quiet moments */
export interface Campfire {
  id: number;
  x: number;
  y: number;
  faction: FactionId;
  until: number;
}

/** traits that grate on each other (and ones that get on) */
const CLASH: Partial<Record<Trait, Trait[]>> = {
  hothead: ['joker', 'steady', 'lazy', 'hothead'],
  joker: ['hothead', 'steady'],
  lazy: ['steady', 'brave'],
  trigger: ['coward', 'steady'],
  brave: ['coward', 'lazy'],
  coward: ['brave', 'trigger'],
};
const ADORE: Partial<Record<Trait, Trait[]>> = {
  joker: ['joker', 'lazy', 'wanderer'],
  loyal: ['loyal', 'brave', 'steady'],
  brave: ['brave', 'loyal'],
  wanderer: ['wanderer', 'joker'],
  steady: ['steady', 'loyal'],
  lucky: ['lucky', 'joker'],
};

const FRIEND_AT = 55;
const RIVAL_AT = -45;

/**
 * Soldiers' social lives. Fighting side by side, being dragged out of a fight, and simply standing
 * around together build friendships; clashing personalities build grudges. Friends rush to each
 * other's aid, grieve when one falls and swear revenge on the killer; rivals sometimes settle it
 * with their fists. Victories mean a party (and a few unsteady soldiers afterwards), quiet evenings
 * mean campfires and stories about home, and long marches make everyone tired and grumpy.
 */
export class SocialSystem {
  campfires: Campfire[] = [];
  private t = 0;

  constructor(private w: World) {}

  private bond(a: Persona, idB: number, d: number) {
    const v = Math.max(-100, Math.min(100, (a.bonds[idB] ?? 0) + d));
    a.bonds[idB] = v;
    return v;
  }

  /** mutual change in how two soldiers feel about each other */
  private relate(a: Unit, b: Unit, d: number) {
    if (!a.persona || !b.persona || a === b) return;
    const va = this.bond(a.persona, b.id, d);
    this.bond(b.persona, a.id, d);
    const w = this.w;
    const lv = w.living;
    if (!lv) return;
    if (va >= FRIEND_AT && !a.persona.friends.includes(b.id) && a.persona.friends.length < 3 && b.persona.friends.length < 3) {
      a.persona.friends.push(b.id);
      b.persona.friends.push(a.id);
      if (a.persona.rival === b.id) a.persona.rival = 0;
      if (b.persona.rival === a.id) b.persona.rival = 0;
      lv.speak(a, 'friend', { buddy: b.persona.first }, false);
      if (w.rng.next() < 0.4) lv.note(a, 'quirk', `${lv.name(a, true)} and ${lv.name(b, true)} are now inseparable.`);
    } else if (va <= RIVAL_AT && !a.persona.rival && !b.persona.rival && !a.persona.friends.includes(b.id)) {
      a.persona.rival = b.id;
      b.persona.rival = a.id;
      lv.speak(a, 'rivalry', { buddy: b.persona.first }, false);
      if (w.rng.next() < 0.4) lv.note(a, 'quirk', `${lv.name(a, true)} cannot stand ${lv.name(b, true)}.`);
    }
  }

  /** called when a rescuer drags someone back to their feet */
  onRescue(by: Unit, saved: Unit) {
    this.relate(by, saved, 45);
  }

  /** someone fell for good: their friends react (grief, rage, despair) and remember who did it */
  onDeath(u: Unit, killer: Unit | null) {
    const w = this.w;
    const lv = w.living;
    const p = u.persona;
    if (!lv || !p) return;
    for (const fid of p.friends) {
      const f = w.unitById.get(fid);
      const fp = f?.persona;
      if (!f || !f.alive || !fp) continue;
      fp.friends = fp.friends.filter((x) => x !== u.id);
      const near = Math.hypot(f.x - u.x, f.y - u.y) < 12 * TILE;
      if (killer && killer.alive) {
        fp.nemesis = killer.id;
        fp.nemesisFor = p.first;
      }
      if (!near) {
        // they hear about it later
        if (w.rng.next() < 0.5) lv.note(f, 'death', `${lv.name(f, true)} heard that ${p.first} ${p.last} didn't make it.`);
        f.morale = Math.max(0, f.morale - 15);
        continue;
      }
      const t = fp.trait;
      const rage = t === 'brave' || t === 'hothead' || t === 'loyal' || t === 'trigger' || (t === 'steady' && w.rng.next() < 0.4);
      if (rage && killer?.alive) {
        lv.speak(f, 'revenge', { buddy: p.first });
        lv.note(f, 'berserk', `${lv.name(f, true)} saw ${p.first} fall and swore revenge on the one who did it.`);
        f.persona!.state = 'berserk';
        f.persona!.stateT = 10;
        f.order = { kind: 'attack', targetId: killer.id };
        f.targetId = killer.id;
        f.quirkAtk = 1.5;
        f.quirkSpeed = 1.3;
      } else {
        lv.speak(f, 'grief', { buddy: p.first });
        f.morale = Math.max(0, f.morale - 30);
        if ((t === 'coward' || t === 'lazy') && w.rng.next() < 0.5) w.morale.rout(f);
        lv.note(f, 'death', `${lv.name(f, true)} watched ${p.first} ${p.last} die.`);
      }
    }
  }

  /** a soldier killed someone: was it the one they swore revenge on? */
  onKill(killer: Unit, victim: Unit) {
    const p = killer.persona;
    const lv = this.w.living;
    if (!p || !lv || p.nemesis !== victim.id) return;
    lv.speak(killer, 'avenged', { buddy: p.nemesisFor });
    lv.note(killer, 'hero', `${lv.name(killer, true)} avenged ${p.nemesisFor}.`);
    p.nemesis = 0;
    killer.morale = 100;
  }

  /** a town was taken: the soldiers there celebrate (some too much) */
  onCapture(faction: FactionId, x: number, y: number) {
    const w = this.w;
    const lv = w.living;
    if (!lv) return;
    let n = 0;
    w.unitHash.query(x, y, 9 * TILE, (u) => {
      if (!u.alive || u.faction !== faction || !u.persona || u.persona.state !== 'normal' || u.routing > 0) return;
      u.persona.state = 'party';
      u.persona.stateT = 6 + w.rng.next() * 5;
      u.anim = 'cheer';
      u.cheerT = 3;
      if (n++ < 3) lv.speak(u, 'party', {}, false);
    });
  }

  update(dt: number) {
    const w = this.w;
    if (!w.living) return;
    this.t += dt;
    if (this.t < 1) return;
    const step = this.t;
    this.t = 0;
    // fires burn down
    this.campfires = this.campfires.filter((c) => c.until > w.time);
    const lv = w.living;
    const food = w.factions.map((f) => (f ? f.res.food : 0));
    for (const u of w.units) {
      const p = u.persona;
      if (!u.alive || !p || u.faction === NEUTRAL) continue;
      // ---- fatigue: marching and fighting tire, rest restores
      const moving = Math.hypot(u.vx, u.vy) > 4;
      const fighting = w.time - u.lastHitT < 4 || u.targetId !== 0;
      p.fatigue = Math.max(0, Math.min(100, p.fatigue + step * (fighting ? 0.6 : moving ? 0.25 : p.state === 'camp' ? -3 : p.state === 'nap' ? -4 : -0.6)));
      if (p.fatigue > 85 && moving && w.rng.next() < 0.005) lv.speak(u, 'tired', {}, false);
      if (food[u.faction] < 5 && w.rng.next() < 0.006) {
        lv.speak(u, 'hungry', {}, false);
        u.morale = Math.max(0, u.morale - 4);
      }
      this.states(u, p, step);
      // ---- bonds: who you spend time with
      if (w.rng.next() < 0.35) this.mingle(u, p, fighting, step);
      // ---- revenge: the nemesis is in sight
      if (p.nemesis && p.state === 'normal' && u.routing <= 0 && !u.def.special) {
        const n = w.unitById.get(p.nemesis);
        if (!n || !n.alive) p.nemesis = 0;
        else if (Math.hypot(n.x - u.x, n.y - u.y) < u.def.vision * TILE && u.targetId !== n.id && w.rng.next() < 0.3) {
          u.order = { kind: 'attack', targetId: n.id };
          u.targetId = n.id;
          lv.speak(u, 'revenge', { buddy: p.nemesisFor }, false);
        }
      }
    }
    this.gatherings();
  }

  private states(u: Unit, p: Persona, step: number) {
    const w = this.w;
    const lv = w.living!;
    if (p.state === 'party' || p.state === 'drunk' || p.state === 'brawl' || p.state === 'camp') {
      p.stateT -= step;
      const danger = w.time - u.lastHitT < 2 || u.routing > 0;
      if (p.state === 'party' && (w.rng.next() < 0.3 || p.stateT <= 0)) {
        u.anim = 'cheer';
        u.cheerT = 1.2;
      }
      if (p.state === 'drunk') {
        u.quirkSpeed = 0.7;
        if (w.rng.next() < 0.035) lv.speak(u, 'drunk', {}, false);
      }
      if (p.state === 'camp' && w.rng.next() < 0.05) lv.speak(u, 'story', {}, false);
      if (p.state === 'brawl') {
        const r = w.unitById.get(p.rival);
        if (!r || !r.alive || danger) p.stateT = 0;
        else {
          u.facing = r.x > u.x ? 1 : -1;
          if (w.rng.next() < 0.6) {
            u.anim = 'attack';
            u.animT = 0;
            r.hp = Math.max(r.maxHp * 0.3, r.hp - 1.5);
            r.hitFlash = 0.08;
          }
          if (w.rng.next() < 0.18) lv.speak(u, 'brawl', {}, false);
        }
      }
      if (p.stateT <= 0 || danger || (u.order.kind !== 'idle' && u.order.kind !== 'hold' && p.state !== 'drunk')) {
        const was = p.state;
        p.state = 'normal';
        p.stateT = 0;
        u.quirkSpeed = 1;
        // a few revellers overdo it
        if (was === 'party' && !danger && p.stateT <= 0 && w.rng.next() < 0.14) {
          p.state = 'drunk';
          p.stateT = 25 + w.rng.next() * 25;
          lv.speak(u, 'drunk', {}, true);
          if (w.rng.next() < 0.3) lv.note(u, 'quirk', `${lv.name(u, true)} celebrated a bit too hard.`);
        }
        if (was === 'brawl') {
          const r = w.unitById.get(p.rival);
          if (r?.persona && w.rng.next() < 0.25) {
            // punched it out: friends now
            this.relate(u, r, 120);
            lv.speak(u, 'makeup', {}, true);
            lv.note(u, 'quirk', `${lv.name(u, true)} and ${lv.name(r, true)} punched it out and are friends now.`);
          }
        }
      }
    }
  }

  private mingle(u: Unit, p: Persona, fighting: boolean, step: number) {
    const w = this.w;
    let other: Unit | null = null;
    w.unitHash.query(u.x, u.y, 3 * TILE, (o) => {
      if (!other && o !== u && o.alive && o.faction === u.faction && o.persona && w.rng.next() < 0.5) other = o;
    });
    const o = other as Unit | null;
    if (!o?.persona) return;
    const op = o.persona;
    let d = fighting ? 2.2 : 0.5;
    if (ADORE[p.trait]?.includes(op.trait)) d += 1.2;
    if (CLASH[p.trait]?.includes(op.trait)) d = fighting ? 0.4 : -2.2;
    this.relate(u, o, d * step);
    // rivals left idle next to each other: it comes to blows
    if (!fighting && p.rival === o.id && p.state === 'normal' && op.state === 'normal' && u.arrived && o.arrived && w.rng.next() < 0.04) {
      const lv = w.living!;
      p.state = 'brawl';
      op.state = 'brawl';
      p.stateT = op.stateT = 5 + w.rng.next() * 4;
      lv.speak(u, 'brawl', {}, true);
      lv.note(u, 'quirk', `${lv.name(u, true)} and ${lv.name(o, true)} got into a fistfight.`);
      // spectators
      let n = 0;
      w.unitHash.query(u.x, u.y, 5 * TILE, (s) => {
        if (n < 2 && s !== u && s !== o && s.alive && s.faction === u.faction && s.persona?.state === 'normal') {
          n++;
          lv.speak(s, 'cheerfight', {}, false);
        }
      });
    }
  }

  /** quiet, safe, idle soldiers in their own land light a fire and swap stories */
  private gatherings() {
    const w = this.w;
    if (w.rng.next() > 0.25) return;
    for (const u of w.units) {
      const p = u.persona;
      if (!u.alive || !p || p.state !== 'normal' || p.idleT < 25 || u.routing > 0) continue;
      if (this.campfires.some((c) => c.faction === u.faction && Math.hypot(c.x - u.x, c.y - u.y) < 8 * TILE)) continue;
      const m = w.map;
      const ri = m.region[Math.floor(u.y / TILE) * m.w + Math.floor(u.x / TILE)];
      if (ri < 0 || w.settlements[ri].owner !== u.faction) continue;
      const group: Unit[] = [];
      let enemy = false;
      w.unitHash.query(u.x, u.y, 8 * TILE, (o) => {
        if (!o.alive) return;
        if (o.faction !== u.faction && w.isHostile(u.faction, o.faction)) enemy = true;
        else if (o.faction === u.faction && o.persona?.state === 'normal' && o.persona.idleT > 15 && Math.hypot(o.x - u.x, o.y - u.y) < 4 * TILE) group.push(o);
      });
      if (enemy || group.length < 3) continue;
      const c: Campfire = { id: w.newId(), x: u.x + 6, y: u.y + 4, faction: u.faction, until: w.time + 60 + w.rng.next() * 60 };
      this.campfires.push(c);
      for (const g of group.slice(0, 6)) {
        g.persona!.state = 'camp';
        g.persona!.stateT = c.until - w.time;
      }
      w.living?.speak(group[0], 'story', {}, true);
      return;
    }
  }
}

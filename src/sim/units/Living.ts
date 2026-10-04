import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { eraState } from '../../data/era';
import type { World } from '../World';
import type { Unit } from './Unit';
import { line, newPersona, personaName, RANK_KILLS, TRAITS, type LineKind } from './Persona';

export interface JournalEntry {
  t: number;
  faction: FactionId;
  text: string;
  x: number;
  y: number;
  kind: 'down' | 'death' | 'rescue' | 'panic' | 'berserk' | 'promote' | 'quirk' | 'hero';
}

export interface Fallen {
  name: string;
  trait: string;
  kills: number;
  rescues: number;
  t: number;
}

const BLEED = 30; // seconds a downed soldier lasts without help
const RESCUE_R = 9 * TILE;

/**
 * Living soldiers: everyone in a kingdom's army is a named person with a trait. Traits drive small
 * stories (the coward who bolts, the hothead who charges alone, the joker, the napper, the one who
 * wanders off after a butterfly), soldiers who fall can be wounded rather than killed and dragged
 * back to their feet by friends, the wounded heal in friendly land, and survivors earn ranks.
 * Deterministic: all randomness comes from the world RNG.
 */
export class LivingSystem {
  journal: JournalEntry[] = [];
  fallen = new Map<FactionId, Fallen[]>();
  private t = 0;

  constructor(private w: World) {}

  private get era() {
    return eraState.era;
  }

  private eligible(u: Unit) {
    const s = u.def.special;
    return s !== 'worker' && s !== 'neutral' && u.def.look.body !== 'beast' && u.faction !== NEUTRAL;
  }

  /** a new soldier joins */
  onSpawn(u: Unit) {
    if (u.persona || !this.eligible(u)) return;
    const vehicle = u.def.look.body === 'vehicle' || u.def.look.body === 'engine';
    u.persona = newPersona(this.w.rng, this.era, vehicle);
  }

  name(u: Unit, full = false) {
    return u.persona ? personaName(u.persona, this.era, full) : u.def.name;
  }

  /** a soldier says a line now (orders acknowledged, squads setting off) */
  speak(u: Unit, kind: LineKind) {
    this.say(u, kind, {}, true);
  }

  /** the player gave direct orders: whatever this soldier was up to, they snap out of it */
  commanded(u: Unit) {
    const p = u.persona;
    if (!p) return;
    p.idleT = 0;
    if (p.state === 'nap') this.say(u, 'wake', {}, true);
    if (p.state === 'nap' || p.state === 'wander' || p.state === 'rescue') {
      const c = p.state === 'rescue' ? this.w.corpses.find((k) => k.id === p.rescueTarget) : undefined;
      if (c) c.rescuer = 0;
      p.rescueTarget = 0;
      this.setState(u, 'normal', 0);
    }
  }

  private say(u: Unit, kind: LineKind, vars: { name?: string; buddy?: string } = {}, force = false) {
    const p = u.persona;
    if (!p) return;
    if (!force && p.sayT > 0) return;
    p.sayT = 7 + this.w.rng.next() * 6;
    const text = line(this.w.rng, this.era, kind, vars);
    this.w.events.emit('unitSay', { id: u.id, x: u.x, y: u.y, faction: u.faction, text, kind });
  }

  private log(u: Unit, kind: JournalEntry['kind'], text: string) {
    const e: JournalEntry = { t: this.w.time, faction: u.faction, text, x: u.x, y: u.y, kind };
    this.journal.push(e);
    if (this.journal.length > 300) this.journal.splice(0, this.journal.length - 300);
    this.w.events.emit('journal', e);
  }

  /** lucky soldiers survive one blow that should have killed them */
  shrugOff(u: Unit): boolean {
    const p = u.persona;
    if (!this.w.setup.living || !p || p.trait !== 'lucky' || p.luckUsed) return false;
    p.luckUsed = true;
    u.hp = Math.max(1, u.maxHp * 0.12);
    this.say(u, 'lucky', {}, true);
    this.log(u, 'quirk', `${this.name(u, true)} took a hit that should have killed them. Lucky.`);
    return true;
  }

  /** called as a soldier falls: wounded (can be saved) or killed outright */
  onFall(u: Unit, killer: Unit | null, dmg: number) {
    const w = this.w;
    if (killer?.persona && this.eligible(killer)) this.creditKill(killer, u);
    if (!w.setup.living || !u.persona) return;
    const p = u.persona;
    const infantry = u.def.look.body !== 'vehicle' && u.def.look.body !== 'engine' && u.def.special !== 'commander';
    // big blows (shells, tank rounds, overkill) kill outright; most others leave someone to save
    const overkill = dmg > u.maxHp * 0.9;
    if (infantry && !overkill && w.rng.next() < 0.75) {
      u.downed = BLEED;
      p.wounds++;
      this.say(u, 'down', {}, true);
      this.log(u, 'down', `${this.name(u, true)} is down and bleeding.`);
      // friends nearby call for help
      let caller: Unit | null = null;
      w.unitHash.query(u.x, u.y, 6 * TILE, (o) => {
        if (!caller && o.alive && o.faction === u.faction && o.persona && o.id !== u.id) caller = o;
      });
      if (caller) this.say(caller, 'medic', { name: p.last });
      return;
    }
    this.die(u);
  }

  private die(u: Unit, how = 'was killed') {
    const p = u.persona;
    if (!p) return;
    const list = this.fallen.get(u.faction) ?? [];
    list.push({ name: this.name(u, true), trait: TRAITS[p.trait].label, kills: p.kills, rescues: p.rescues, t: this.w.time });
    this.fallen.set(u.faction, list);
    const notable = p.rank >= 1 || p.kills >= 3 || p.rescues >= 1;
    this.log(u, 'death', `${this.name(u, true)} ${how}${p.kills ? ` (${p.kills} kill${p.kills > 1 ? 's' : ''})` : ''}.`);
    if (notable && u.faction === this.w.setup.player)
      this.w.notify({ kind: 'lost', text: `${this.name(u, true).toUpperCase()} HAS FALLEN`, sub: `${TRAITS[p.trait].label} · ${p.kills} kills${p.rescues ? ` · saved ${p.rescues}` : ''}`, factions: [u.faction], x: u.x, y: u.y, priority: 1 });
  }

  private creditKill(killer: Unit, victim: Unit) {
    const p = killer.persona!;
    p.kills++;
    const w = this.w;
    if (w.rng.next() < 0.3) this.say(killer, 'kill', { buddy: victim.persona ? victim.persona.last : undefined });
    // promotion
    const next = RANK_KILLS[p.rank + 1];
    if (next !== undefined && p.kills >= next && !p.nick) {
      p.rank++;
      killer.maxHp *= 1.08;
      killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.2);
      this.refreshMul(killer);
      this.say(killer, 'promote', {}, true);
      this.log(killer, 'promote', `${killer.persona!.first} ${killer.persona!.last} was promoted to ${this.name(killer)}.`);
      if (killer.faction === w.setup.player) w.notify({ kind: 'unit', text: `PROMOTED: ${this.name(killer, true).toUpperCase()}`, sub: `${p.kills} kills`, factions: [killer.faction], x: killer.x, y: killer.y, priority: 0, quiet: true });
    }
    if (p.kills === 10) this.log(killer, 'hero', `${this.name(killer, true)} has ten kills. A legend in the making.`);
  }

  private refreshMul(u: Unit) {
    const p = u.persona;
    if (!p) return;
    let atk = 1 + p.rank * 0.08;
    let spd = 1;
    if (p.state === 'berserk') {
      atk *= 1.45;
      spd = 1.3;
    } else if (p.state === 'tired') spd = 0.8;
    u.quirkAtk = atk;
    u.quirkSpeed = spd;
  }

  private setState(u: Unit, st: NonNullable<Unit['persona']>['state'], dur: number) {
    const p = u.persona!;
    p.state = st;
    p.stateT = dur;
    this.refreshMul(u);
  }

  // ------------------------------------------------------------------ per tick
  update(dt: number) {
    const w = this.w;
    if (!w.setup.living) return;
    // the wounded bleed; near home or a hospital they are stabilised and patched up
    for (const c of w.corpses) {
      if (c.downed <= 0) continue;
      const safe = this.nearCare(c);
      if (safe) {
        c.downed = Math.min(BLEED, c.downed + dt * 0.5);
        if (w.time - c.deathT > 10) this.revive(c, null);
        continue;
      }
      c.downed -= dt;
      if (c.downed <= 0) {
        c.downed = 0;
        c.deathT = w.time; // the body starts to fade now
        this.die(c, "didn't make it");
      }
    }
    for (const u of w.units) if (u.persona && u.persona.sayT > 0) u.persona.sayT -= dt;
    this.t += dt;
    if (this.t < 0.5) return;
    const step = this.t;
    this.t = 0;
    this.rescues(step);
    for (const u of w.units) {
      if (!u.alive || !u.persona) continue;
      this.mind(u, step);
      this.heal(u, step);
    }
  }

  /** is this spot cared for: inside an own settlement or by a field hospital / outpost */
  private nearCare(u: Unit) {
    const w = this.w;
    const m = w.map;
    const tx = Math.floor(u.x / TILE);
    const ty = Math.floor(u.y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
    const s = w.settlements[m.region[ty * m.w + tx]];
    if (s && s.owner === u.faction && s.tier >= 2 && Math.hypot(s.px - u.x, s.py - u.y) < 5 * TILE) return true;
    let care = false;
    w.buildingHash.query(u.x, u.y, 6 * TILE, (b) => {
      if (!care && !b.destroyed && b.built && b.faction === u.faction && (b.def.id === 'chapel' || b.def.id === 'outpost_tower')) care = true;
    });
    return care;
  }

  private heal(u: Unit, step: number) {
    if (u.hp >= u.maxHp || this.w.time - u.lastHitT < 8) return;
    const m = this.w.map;
    const tx = Math.floor(u.x / TILE);
    const ty = Math.floor(u.y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
    const s = this.w.settlements[m.region[ty * m.w + tx]];
    if (!s || s.owner !== u.faction) return;
    const rate = this.nearCare(u) ? 3 : 1;
    u.hp = Math.min(u.maxHp, u.hp + rate * step * (u.def.look.body === 'vehicle' ? 0.5 : 1));
  }

  private enemyNear(u: Unit, r: number) {
    let n = 0;
    this.w.unitHash.query(u.x, u.y, r, (o) => {
      if (o.alive && o.faction !== u.faction && this.w.isHostile(u.faction, o.faction)) n++;
    });
    return n;
  }

  /** what is on this soldier's mind */
  private mind(u: Unit, step: number) {
    const w = this.w;
    const rng = w.rng;
    const p = u.persona!;
    if (p.quirkT > 0) p.quirkT -= step;
    // states run out
    if (p.state !== 'normal' && p.state !== 'rescue') {
      p.stateT -= step;
      if (p.state === 'nap' && (w.time - u.lastHitT < 2 || !u.arrived || u.targetId || this.enemyNear(u, 7 * TILE))) {
        this.say(u, 'wake', {}, true);
        this.setState(u, 'normal', 0);
      } else if (p.stateT <= 0) {
        if (p.state === 'berserk') {
          this.setState(u, 'tired', 8);
          u.morale = Math.max(20, u.morale - 10);
        } else this.setState(u, 'normal', 0);
      }
    }
    if (u.routing > 0) return;
    // a soldier who has run once too often may simply walk away from the war
    if (p.trait === 'coward' && p.routs >= 3 && u.faction !== NEUTRAL && u.def.special !== 'commander' && rng.next() < 0.02) {
      this.desert(u);
      return;
    }
    const fighting = w.time - u.lastHitT < 4 || u.targetId !== 0;
    const enemies = fighting || p.state === 'berserk' ? this.enemyNear(u, u.def.vision * TILE) : this.enemyNear(u, 7 * TILE);
    const idle = !fighting && enemies === 0 && u.arrived && (u.order.kind === 'idle' || u.order.kind === 'hold');
    p.idleT = idle ? p.idleT + step : 0;

    // berserk: charge the nearest enemy, orders be damned
    if (p.state === 'berserk') {
      let best: Unit | null = null;
      let bd = Infinity;
      w.unitHash.query(u.x, u.y, u.def.vision * TILE * 1.3, (o) => {
        if (!o.alive || o.faction === u.faction || !w.isHostile(u.faction, o.faction)) return;
        const d = Math.hypot(o.x - u.x, o.y - u.y);
        if (d < bd) {
          bd = d;
          best = o;
        }
      });
      if (best) {
        u.order = { kind: 'attack', targetId: (best as Unit).id };
        u.targetId = (best as Unit).id;
      }
      if (rng.next() < 0.15) this.say(u, 'berserk');
      return;
    }
    if (p.state === 'nap') {
      if (rng.next() < 0.12) this.say(u, 'nap');
      return;
    }
    if (p.state === 'wander') {
      if (u.arrived) {
        // back to where they were meant to be
        w.setDestination(u, u.homeX, u.homeY, 0);
        u.order = { kind: 'move', x: u.homeX, y: u.homeY, attackMove: true };
        this.setState(u, 'normal', 0);
      }
      return;
    }

    if (fighting && enemies > 0) {
      // under fire: the nervous bolt, hotheads lose it, anyone can snap
      if (p.trait === 'coward' && u.morale < 55 && p.quirkT <= 0 && rng.next() < 0.3) {
        p.quirkT = 30;
        w.morale.rout(u);
        this.say(u, 'panic', {}, true);
        this.log(u, 'panic', `${this.name(u, true)} panicked and ran for it.`);
        return;
      }
      if (p.trait === 'hothead' && u.morale > 35 && p.quirkT <= 0 && rng.next() < 0.06) {
        p.quirkT = 40;
        this.setState(u, 'berserk', 10);
        this.say(u, 'berserk', {}, true);
        this.log(u, 'berserk', `${this.name(u, true)} went berserk and charged in alone!`);
        return;
      }
      if (u.morale < 12 && p.quirkT <= 0 && rng.next() < 0.04) {
        p.quirkT = 40;
        if (rng.next() < 0.5) {
          this.setState(u, 'berserk', 8);
          this.say(u, 'snap', {}, true);
          this.log(u, 'berserk', `${this.name(u, true)} snapped and charged the enemy, screaming.`);
        } else {
          w.morale.rout(u);
          this.say(u, 'snap', {}, true);
          this.log(u, 'panic', `${this.name(u, true)} snapped and fled.`);
        }
        return;
      }
      if (p.trait === 'brave' && rng.next() < 0.05) {
        this.say(u, 'brave');
        w.unitHash.query(u.x, u.y, 5 * TILE, (o) => {
          if (o.alive && o.faction === u.faction) o.morale = Math.min(100, o.morale + 6);
        });
      }
      return;
    }

    if (!idle) return;
    // peace and quiet: personalities come out
    if (p.trait === 'joker' && p.idleT > 8 && rng.next() < 0.06) {
      this.say(u, 'joke');
      w.unitHash.query(u.x, u.y, 5 * TILE, (o) => {
        if (o.alive && o.faction === u.faction) o.morale = Math.min(100, o.morale + 4);
      });
      return;
    }
    if (p.trait === 'lazy' && p.idleT > 25 && p.quirkT <= 0 && rng.next() < 0.1) {
      p.quirkT = 60;
      this.setState(u, 'nap', 30 + rng.next() * 40);
      this.say(u, 'nap', {}, true);
      if (rng.next() < 0.3) this.log(u, 'quirk', `${this.name(u, true)} fell asleep on duty.`);
      return;
    }
    if (p.trait === 'wanderer' && p.idleT > 18 && p.quirkT <= 0 && rng.next() < 0.08) {
      for (let k = 0; k < 6; k++) {
        const a = rng.next() * Math.PI * 2;
        const r = (2 + rng.next() * 3) * TILE;
        const x = u.x + Math.cos(a) * r;
        const y = u.y + Math.sin(a) * r;
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        if (tx < 0 || ty < 0 || tx >= w.map.w || ty >= w.map.h || !w.pathfinder.passable(ty * w.map.w + tx, u.faction)) continue;
        p.quirkT = 45;
        this.setState(u, 'wander', 30);
        w.setDestination(u, x, y, 0);
        this.say(u, 'wander', {}, true);
        break;
      }
      return;
    }
    if (p.trait === 'trigger' && p.idleT > 10 && p.quirkT <= 0 && u.def.projectile && rng.next() < 0.05) {
      p.quirkT = 50;
      const a = rng.next() * Math.PI * 2;
      w.events.emit('potshot', { id: u.id, x: u.x, y: u.y, tx: u.x + Math.cos(a) * 60, ty: u.y + Math.sin(a) * 40, kind: u.def.projectile });
      u.anim = 'attack';
      u.animT = 0;
      this.say(u, 'potshot', {}, true);
      return;
    }
    if (p.idleT > 12 && rng.next() < 0.012) this.say(u, 'chatter');
  }

  /** quits the army and goes it alone in the wilds (as a neutral bandit) */
  private desert(u: Unit) {
    const w = this.w;
    this.say(u, 'desert', {}, true);
    this.log(u, 'panic', `${this.name(u, true)} deserted! Last seen heading for the hills.`);
    if (u.faction === w.setup.player) w.notify({ kind: 'lost', text: `${this.name(u, true).toUpperCase()} DESERTED`, sub: 'Ran one time too many', factions: [u.faction], x: u.x, y: u.y, priority: 0, quiet: true });
    const f = w.factions[u.faction];
    f.pop -= u.def.pop;
    u.faction = NEUTRAL;
    u.army = 0;
    u.squad = 0;
    u.auto = true;
    u.targetId = 0;
    u.morale = 60;
    // walk off somewhere quiet
    const a = w.rng.next() * Math.PI * 2;
    const x = Math.max(TILE * 2, Math.min((w.map.w - 2) * TILE, u.x + Math.cos(a) * 14 * TILE));
    const y = Math.max(TILE * 2, Math.min((w.map.h - 2) * TILE, u.y + Math.sin(a) * 14 * TILE));
    w.setDestination(u, x, y, 0);
    u.order = { kind: 'move', x, y, attackMove: false };
    u.homeX = x;
    u.homeY = y;
  }

  // ------------------------------------------------------------------ rescues
  private rescues(step: number) {
    const w = this.w;
    // drop rescuers whose patient is gone, carry on the others
    for (const u of w.units) {
      const p = u.persona;
      if (!u.alive || !p || p.state !== 'rescue') continue;
      const c = w.corpses.find((k) => k.id === p.rescueTarget);
      if (!c || c.downed <= 0 || u.routing > 0) {
        this.setState(u, 'normal', 0);
        p.rescueTarget = 0;
        continue;
      }
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < 9) {
        p.stateT += step;
        u.vx = u.vy = 0;
        if (p.stateT >= (u.def.healer ? 0.8 : 2.5)) this.revive(c, u);
      } else if (u.arrived || !u.path) {
        w.setDestination(u, c.x, c.y, 0);
        u.order = { kind: 'move', x: c.x, y: c.y, attackMove: false };
      }
    }
    // the wounded call; the nearest willing friend answers
    for (const c of w.corpses) {
      if (c.downed <= 0 || !c.persona) continue;
      const helper = w.unitById.get(c.rescuer);
      if (helper && helper.alive && helper.persona?.state === 'rescue') continue;
      c.rescuer = 0;
      const danger = this.enemyNear(c, 4 * TILE) > 0;
      let best: Unit | null = null;
      let bs = Infinity;
      w.unitHash.query(c.x, c.y, RESCUE_R, (o) => {
        const p = o.persona;
        if (!o.alive || o.faction !== c.faction || !p || p.state !== 'normal' || o.routing > 0) return;
        if (o.def.look.body === 'vehicle' || o.def.look.body === 'engine' || o.def.special === 'commander') return;
        // the player's soldiers under direct orders only help when they've finished the order
        if (!o.auto && !o.arrived) return;
        const brave = p.trait === 'loyal' || p.trait === 'brave' || !!o.def.healer;
        if (danger && !brave) return;
        if (o.targetId && !brave) return;
        const d = Math.hypot(o.x - c.x, o.y - c.y) * (o.def.healer ? 0.3 : p.trait === 'loyal' ? 0.5 : 1);
        if (d < bs) {
          bs = d;
          best = o;
        }
      });
      if (!best) continue;
      const r = best as Unit;
      r.persona!.state = 'rescue';
      r.persona!.stateT = 0;
      r.persona!.rescueTarget = c.id;
      r.targetId = 0;
      c.rescuer = r.id;
      w.setDestination(r, c.x, c.y, 0);
      r.order = { kind: 'move', x: c.x, y: c.y, attackMove: false };
      this.say(r, 'rescue', { name: c.persona.first }, true);
    }
  }

  /** back on their feet (same soldier, same name) */
  private revive(c: Unit, by: Unit | null) {
    const w = this.w;
    w.corpses = w.corpses.filter((k) => k !== c);
    const u = w.spawnUnit(c.def.id, c.faction, c.x, c.y, undefined, c.id);
    u.persona = c.persona;
    if (u.persona) {
      u.persona.state = 'normal';
      u.persona.stateT = 0;
    }
    u.maxHp = c.maxHp;
    u.hp = c.maxHp * 0.35;
    u.morale = 35;
    u.army = c.army;
    u.squad = c.squad;
    u.auto = true;
    u.atkBonus = c.atkBonus;
    u.rangeBonus = c.rangeBonus;
    u.speedMul = c.speedMul;
    u.armorBonus = c.armorBonus;
    this.refreshMul(u);
    const f = w.factions[c.faction];
    f.pop += c.def.pop;
    f.stats.unitsLost = Math.max(0, f.stats.unitsLost - 1);
    if (by?.persona) {
      by.persona.rescues++;
      by.persona.state = 'normal';
      by.persona.rescueTarget = 0;
      by.order = { kind: 'idle' };
      by.homeX = by.x;
      by.homeY = by.y;
      this.say(u, 'saved', { buddy: by.persona.first }, true);
      this.log(by, 'rescue', `${this.name(by, true)} dragged ${this.name(u, true)} out of the fight.`);
    } else {
      this.say(u, 'rally', {}, true);
      this.log(u, 'rescue', `Medics patched up ${this.name(u, true)}.`);
    }
    w.events.emit('unitRevived', { id: u.id, x: u.x, y: u.y, faction: u.faction });
  }
}

import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { eraState, resName } from '../../data/era';
import { T } from '../map/GameMap';
import type { Unit } from '../units/Unit';
import type { World } from '../World';

/** a dog that adopted a squad */
export interface Mascot {
  id: number;
  name: string;
  faction: FactionId;
  ownerId: number;
  since: number;
}

type Kind = 'goose' | 'mascot' | 'lost' | 'river' | 'treasure' | 'brawl' | 'omen' | 'sighting' | 'visit' | 'stew' | 'letter' | 'chicken';

const WEIGHTS: Record<Kind, number> = {
  goose: 1,
  mascot: 0.8,
  lost: 1,
  river: 1.1,
  treasure: 0.8,
  brawl: 1,
  omen: 0.7,
  sighting: 0.7,
  visit: 0.9,
  stew: 0.7,
  letter: 1.2,
  chicken: 1,
};

const DOG_NAMES = ['Biscuit', 'Sergeant Woof', 'Pickles', 'Major Fluff', 'Turnip', 'Bones', 'Captain Barksworth', 'Muddy', 'Sausage', 'Lord Wigglebottom'];

/**
 * Little things that happen in a living valley: a goose routs a garrison, a stray dog adopts a
 * squad, a patrol gets lost, someone falls in the river, finds a chest, gets a letter from home,
 * eats the bad stew. Most have a small real effect; all of them get talked about.
 */
export class Happenings {
  mascots: Mascot[] = [];
  private nextT: number;
  private t = 0;

  constructor(private w: World) {
    this.nextT = 50 + w.rng.next() * 30;
  }

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    if (this.t >= 1) {
      this.tickMascots(this.t);
      this.t = 0;
    }
    if (w.time < this.nextT || !w.living) return;
    this.nextT = w.time + 22 + w.rng.next() * 30;
    let total = 0;
    for (const v of Object.values(WEIGHTS)) total += v;
    for (let tries = 0; tries < 4; tries++) {
      let r = w.rng.next() * total;
      let kind: Kind = 'letter';
      for (const [k, v] of Object.entries(WEIGHTS) as [Kind, number][]) {
        r -= v;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      if (this.run(kind)) return;
    }
  }

  private soldiers(pred: (u: Unit) => boolean = () => true): Unit[] {
    return this.w.units.filter((u) => u.alive && u.persona && u.faction !== NEUTRAL && !u.def.special && u.routing <= 0 && pred(u));
  }

  private idle(u: Unit) {
    return u.persona!.state === 'normal' && u.arrived && !u.targetId && this.w.time - u.lastHitT > 10;
  }

  private regionName(x: number, y: number) {
    const m = this.w.map;
    const ri = m.region[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)];
    return ri >= 0 ? this.w.settlements[ri].name : 'the wilds';
  }

  private emit(kind: string, x: number, y: number, text = '', faction: FactionId | -1 = -1) {
    this.w.events.emit('happening', { kind, x, y, text, faction });
  }

  private run(kind: Kind): boolean {
    const w = this.w;
    const lv = w.living!;
    const rng = w.rng;
    const modern = eraState.era === 'modern';
    switch (kind) {
      case 'goose': {
        const pool = this.soldiers((u) => this.idle(u));
        if (pool.length < 3) return false;
        const a = rng.pick(pool);
        let n = 0;
        w.unitHash.query(a.x, a.y, 5 * TILE, (o) => {
          if (o.alive && o.faction === a.faction && o.persona && o.routing <= 0 && o.persona.trait !== 'brave') {
            w.morale.rout(o);
            if (n++ < 3) lv.speak(o, 'goose');
          }
        });
        if (n < 2) return false;
        const where = this.regionName(a.x, a.y);
        lv.note(a, 'panic', `A furious goose routed ${n} soldiers at ${where}. Nobody will talk about it.`);
        this.emit('goose', a.x + 10, a.y, 'HONK!', a.faction);
        w.notify({ kind: 'event', text: `A GOOSE HAS ROUTED THE GARRISON AT ${where.toUpperCase()}`, sub: `${n} soldiers fled. The goose holds the field.`, factions: [a.faction], x: a.x, y: a.y, priority: 0, world: true, quiet: a.faction !== w.setup.player });
        return true;
      }
      case 'mascot': {
        const pool = this.soldiers((u) => this.idle(u) && !this.mascots.some((m) => m.ownerId === u.id));
        if (!pool.length || this.mascots.length >= 6) return false;
        const a = rng.pick(pool);
        const name = rng.pick(DOG_NAMES);
        this.mascots.push({ id: w.newId(), name, faction: a.faction, ownerId: a.id, since: w.time });
        lv.speak(a, 'mascot');
        lv.note(a, 'quirk', `A stray dog has adopted ${lv.name(a, true)}. They named him ${name}.`);
        w.notify({ kind: 'event', text: `A STRAY DOG JOINS ${w.factions[a.faction].name.toUpperCase()}`, sub: `${lv.name(a, true)} named him ${name}. Morale is up.`, factions: [a.faction], x: a.x, y: a.y, priority: 0, quiet: true });
        return true;
      }
      case 'lost': {
        const pool = this.soldiers((u) => this.idle(u) && u.auto && u.persona!.trait !== 'steady');
        if (pool.length < 3) return false;
        const a = rng.pick(pool);
        const group: Unit[] = [];
        w.unitHash.query(a.x, a.y, 4 * TILE, (o) => {
          if (group.length < 4 && o.alive && o.faction === a.faction && o.persona && pool.includes(o)) group.push(o);
        });
        if (group.length < 2) return false;
        const ang = rng.next() * Math.PI * 2;
        const d = (9 + rng.next() * 7) * TILE;
        const tx = Math.max(2 * TILE, Math.min((w.map.w - 2) * TILE, a.x + Math.cos(ang) * d));
        const ty = Math.max(2 * TILE, Math.min((w.map.h - 2) * TILE, a.y + Math.sin(ang) * d));
        for (const u of group) {
          u.persona!.state = 'wander';
          u.persona!.stateT = 40;
          w.setDestination(u, tx + (rng.next() - 0.5) * 20, ty + (rng.next() - 0.5) * 20, 0);
          u.order = { kind: 'move', x: tx, y: ty, attackMove: true };
        }
        lv.speak(a, 'lost');
        lv.note(a, 'quirk', `${lv.name(a, true)} led a patrol of ${group.length} the wrong way. Confidently.`);
        return true;
      }
      case 'river': {
        const m = w.map;
        const pool = this.soldiers((u) => {
          const tx = Math.floor(u.x / TILE);
          const ty = Math.floor(u.y / TILE);
          for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && (m.terrain[y * m.w + x] === T.WATER || m.terrain[y * m.w + x] === T.SHALLOW)) return true;
          return false;
        });
        if (!pool.length) return false;
        const a = rng.pick(pool);
        a.hp = Math.max(1, a.hp - a.maxHp * 0.12);
        a.burnT = 0;
        lv.speak(a, 'river');
        if (rng.next() < 0.5) lv.note(a, 'quirk', `${lv.name(a, true)} fell in the river.`);
        this.emit('river', a.x, a.y, 'SPLASH!', a.faction);
        return true;
      }
      case 'treasure': {
        const pool = this.soldiers((u) => this.idle(u) || Math.hypot(u.vx, u.vy) > 4);
        if (!pool.length) return false;
        const a = rng.pick(pool);
        const gold = 40 + Math.floor(rng.next() * 110);
        w.factions[a.faction].res.gold += gold;
        const what = modern ? rng.pick(['a briefcase of cash', 'a lost payroll', 'an unscratched lottery ticket (it won)', 'a stash of watches']) : rng.pick(['a buried chest', 'a purse in a hollow log', 'a dragon’s IOU (it paid out)', 'a goblet nobody will miss']);
        lv.note(a, 'hero', `${lv.name(a, true)} found ${what}: +${gold} ${resName('gold').toLowerCase()}.`);
        this.emit('treasure', a.x, a.y, `+${gold}`, a.faction);
        return true;
      }
      case 'brawl': {
        const towns = w.settlements.filter((s) => s.owner !== NEUTRAL && s.tier >= 2);
        if (!towns.length) return false;
        const s = rng.pick(towns);
        const here: Unit[] = [];
        w.unitHash.query(s.px, s.py, 7 * TILE, (o) => {
          if (o.alive && o.faction === s.owner && o.persona && this.idle(o)) here.push(o);
        });
        if (here.length < 4) return false;
        const a = here[0];
        const b = here[1 + Math.floor(rng.next() * (here.length - 1))];
        a.persona!.rival = b.id;
        b.persona!.rival = a.id;
        a.persona!.state = b.persona!.state = 'brawl';
        a.persona!.stateT = b.persona!.stateT = 6;
        lv.speak(a, 'brawl');
        lv.speak(here[2] ?? b, 'cheerfight');
        lv.note(a, 'quirk', `Tavern brawl in ${s.name}: ${lv.name(a, true)} vs ${lv.name(b, true)}. ${modern ? 'Over the last can of beans.' : 'Over the last pie.'}`);
        return true;
      }
      case 'omen': {
        const fs = w.factions.filter((f) => f && f.alive && f.leader?.quirks.includes('superstitious'));
        if (!fs.length) return false;
        return w.leaders.omen(rng.pick(fs).id);
      }
      case 'sighting': {
        const pool = this.soldiers((u) => this.idle(u));
        if (pool.length < 2) return false;
        const a = rng.pick(pool);
        let n = 0;
        w.unitHash.query(a.x, a.y, 4 * TILE, (o) => {
          if (!o.alive || o.faction !== a.faction || !o.persona) return;
          n++;
          if (o.persona.trait === 'coward' || rng.next() < 0.25) w.morale.rout(o);
        });
        const what = modern ? 'a UFO' : 'a ghost';
        lv.speak(a, 'incoming', {}, true);
        lv.note(a, 'panic', `${n} soldiers at ${this.regionName(a.x, a.y)} swear they saw ${what}.`);
        this.emit('sighting', a.x, a.y - 30, '?!', a.faction);
        w.notify({ kind: 'event', text: `SOLDIERS SWEAR THEY SAW ${what.toUpperCase()}`, sub: `Near ${this.regionName(a.x, a.y)}. Officers blame the stew.`, factions: [a.faction], x: a.x, y: a.y, priority: 0, quiet: true, world: true });
        return true;
      }
      case 'visit': {
        const fs = w.factions.filter((f) => f && f.alive && f.commanderId && f.id !== NEUTRAL);
        if (!fs.length) return false;
        const f = rng.pick(fs);
        const c = w.unitById.get(f.commanderId);
        if (!c || !c.alive || w.time - c.lastHitT < 10) return false;
        let n = 0;
        w.unitHash.query(c.x, c.y, 7 * TILE, (o) => {
          if (o.alive && o.faction === f.id && o.persona && o !== c) {
            o.morale = Math.min(100, o.morale + 20);
            if (n++ < 2) lv.speak(o, 'salute');
          }
        });
        if (n < 2) return false;
        w.leaders.think(f.id, 'muse', {}, { force: true });
        return true;
      }
      case 'stew': {
        const fs = w.factions.filter((f) => f && f.alive && f.id !== NEUTRAL);
        const f = rng.pick(fs);
        const pool = this.soldiers((u) => u.faction === f.id && this.idle(u));
        if (pool.length < 4) return false;
        const sick = pool.slice(0, 5);
        for (const u of sick) {
          u.hp = Math.max(1, u.hp - u.maxHp * 0.15);
          u.persona!.fatigue = Math.min(100, u.persona!.fatigue + 40);
          u.morale = Math.max(0, u.morale - 15);
        }
        lv.speak(sick[0], 'hungry');
        lv.note(sick[0], 'quirk', `Bad ${modern ? 'beans' : 'stew'} in ${f.name}'s camp: ${sick.length} soldiers are very unwell.`);
        return true;
      }
      case 'letter': {
        const pool = this.soldiers();
        if (!pool.length) return false;
        const a = rng.pick(pool);
        const p = a.persona!;
        a.morale = Math.min(100, a.morale + 25);
        const what = modern ? rng.pick(['socks', 'a cake (squashed)', 'a photo of the dog', 'a parking fine', 'a very long poem']) : rng.pick(['socks', 'a pie (squashed)', 'a lock of goat hair', 'a tax demand', 'a very long poem']);
        this.w.events.emit('unitSay', { id: a.id, x: a.x, y: a.y, faction: a.faction, text: `A letter from ${p.home.replace(/^an? /, '')}! They sent ${what}.`, kind: 'normal' });
        if (rng.next() < 0.35) lv.note(a, 'quirk', `${lv.name(a, true)} got a letter from home. It contained ${what}.`);
        return true;
      }
      case 'chicken': {
        const pool = this.soldiers((u) => this.idle(u) && (u.persona!.trait === 'wanderer' || u.persona!.trait === 'joker' || u.persona!.trait === 'lazy'));
        if (!pool.length) return false;
        const a = rng.pick(pool);
        const ang = rng.next() * Math.PI * 2;
        const tx = a.x + Math.cos(ang) * 6 * TILE;
        const ty = a.y + Math.sin(ang) * 6 * TILE;
        a.persona!.state = 'wander';
        a.persona!.stateT = 25;
        w.setDestination(a, tx, ty, 0);
        this.w.events.emit('unitSay', { id: a.id, x: a.x, y: a.y, faction: a.faction, text: modern ? 'Come back here, chicken!' : 'Come here, you feathery devil!', kind: 'normal' });
        this.emit('chicken', a.x, a.y, '', a.faction);
        return true;
      }
    }
    return false;
  }

  /** dogs follow their people, cheer the squad up, and find a new friend if their person falls */
  private tickMascots(step: number) {
    const w = this.w;
    const lv = w.living;
    for (const m of this.mascots) {
      const o = w.unitById.get(m.ownerId);
      if (!o || !o.alive) {
        // stay with the nearest friend of the fallen
        let best: Unit | null = null;
        let bd = 12 * TILE;
        const last = w.corpses.find((c) => c.id === m.ownerId) ?? null;
        const x = last?.x ?? 0;
        const y = last?.y ?? 0;
        if (last)
          w.unitHash.query(x, y, bd, (u) => {
            const d = Math.hypot(u.x - x, u.y - y);
            if (u.alive && u.faction === m.faction && u.persona && d < bd) {
              bd = d;
              best = u;
            }
          });
        if (best) {
          m.ownerId = (best as Unit).id;
          if (lv) {
            lv.speak(best, 'grief', { buddy: m.name });
            lv.note(best, 'death', `${m.name} the dog would not leave the body. ${lv.name(best, true)} took him in.`);
          }
        } else m.ownerId = 0;
        continue;
      }
      w.unitHash.query(o.x, o.y, 4 * TILE, (u) => {
        if (u.alive && u.faction === m.faction) u.morale = Math.min(100, u.morale + 1.5 * step);
      });
    }
    this.mascots = this.mascots.filter((m) => m.ownerId);
  }
}

import { NEUTRAL, type FactionId } from '../data/constants';
import type { Stance } from './Faction';
import type { World } from './World';

/**
 * Light diplomacy: kingdoms begin at peace (neutral), border friction turns relations hostile,
 * and wars are declared by AI strategy or by the player's actions. Temporary ceasefires exist,
 * but never permanent alliances — there can only be one ruler of the valley.
 */
export class Diplomacy {
  private t = 0;
  tension: number[][] = [];
  nextOfferId = 1;
  pendingOffers: { id: number; from: FactionId; against: FactionId; duration: number; expires: number }[] = [];

  constructor(private w: World) {
    for (let a = 0; a <= NEUTRAL; a++) this.tension[a] = [0, 0, 0, 0, 0];
  }

  stance(a: FactionId, b: FactionId): Stance {
    if (a === b) return 'neutral';
    return this.w.factions[a].stance[b];
  }

  private set(a: FactionId, b: FactionId, s: Stance) {
    const fa = this.w.factions[a];
    const fb = this.w.factions[b];
    if (!fa || !fb) return;
    const prev = fa.stance[b];
    fa.stance[b] = s;
    fb.stance[a] = s;
    if (prev !== s) this.w.events.emit('stanceChanged', { a, b, stance: s });
  }

  isHostile(a: FactionId, b: FactionId): boolean {
    if (a === b) return false;
    if (a === NEUTRAL || b === NEUTRAL) return true;
    const s = this.w.factions[a].stance[b];
    return s === 'war' || s === 'hostile';
  }

  atWar(a: FactionId, b: FactionId) {
    return a !== b && (a === NEUTRAL || b === NEUTRAL || this.w.factions[a].stance[b] === 'war');
  }

  declareWar(a: FactionId, b: FactionId, reason: 'ai' | 'capture' | 'attack' | 'ceasefire_broken' = 'ai') {
    if (a === NEUTRAL || b === NEUTRAL || a === b) return;
    if (this.stance(a, b) === 'war') return;
    const w = this.w;
    if (!w.factions[a].alive || !w.factions[b].alive) return;
    const broke = this.stance(a, b) === 'ceasefire';
    this.set(a, b, 'war');
    w.factions[b].grudge[a] += broke ? 60 : 20;
    const fa = w.factions[a];
    const fb = w.factions[b];
    const p = w.setup.player;
    if (b === p) w.notify({ kind: 'war', text: `⚔ ${fa.name.toUpperCase()} DECLARES WAR ON YOU`, sub: `${fa.setup.commanderName} ${fa.setup.commanderTitle} marches`, factions: [a, b], priority: 2, alarm: true });
    else if (a === p) w.notify({ kind: 'war', text: `⚔ YOU ARE AT WAR WITH ${fb.name.toUpperCase()}`, sub: reason === 'capture' ? 'Your troops crossed into their lands' : undefined, factions: [a, b], priority: 2 });
    else w.notify({ kind: 'war', text: `⚔ ${fa.name.toUpperCase()} DECLARES WAR ON ${fb.name.toUpperCase()}`, factions: [a, b], priority: 1, world: true });
  }

  makeHostile(a: FactionId, b: FactionId) {
    if (this.stance(a, b) !== 'neutral') return;
    this.set(a, b, 'hostile');
    const w = this.w;
    const p = w.setup.player;
    if (a === p || b === p) {
      const o = a === p ? b : a;
      w.notify({ kind: 'diplomacy', text: `BORDER TENSIONS WITH ${w.factions[o].name.toUpperCase()}`, sub: 'Their soldiers will now fight yours on sight', factions: [a, b], priority: 1 });
    }
  }

  ceasefire(a: FactionId, b: FactionId, duration: number) {
    this.set(a, b, 'ceasefire');
    this.w.factions[a].ceasefireT[b] = this.w.time + duration;
    this.w.factions[b].ceasefireT[a] = this.w.time + duration;
    // units stop fighting each other
    for (const u of this.w.units) {
      if (!u.targetId) continue;
      const t = this.w.unitById.get(u.targetId) ?? this.w.buildingById.get(u.targetId);
      if (t && ((u.faction === a && t.faction === b) || (u.faction === b && t.faction === a))) {
        u.targetId = 0;
        if (u.order.kind === 'attack') u.order = { kind: 'idle' };
      }
    }
    const w = this.w;
    const p = w.setup.player;
    if (a !== p && b !== p) w.notify({ kind: 'diplomacy', text: `${w.factions[a].name.toUpperCase()} AND ${w.factions[b].name.toUpperCase()} AGREE A CEASEFIRE`, factions: [a, b], priority: 0, world: true });
  }

  /** an AI offers the player a temporary ceasefire against a common threat */
  offerCeasefire(from: FactionId, against: FactionId, duration: number) {
    const w = this.w;
    if (this.pendingOffers.some((o) => o.from === from)) return;
    const id = this.nextOfferId++;
    this.pendingOffers.push({ id, from, against, duration, expires: w.time + 25 });
    w.events.emit('ceasefireOffer', { from, against, duration, id });
  }

  answerOffer(id: number, accept: boolean) {
    const o = this.pendingOffers.find((p) => p.id === id);
    if (!o) return;
    this.pendingOffers = this.pendingOffers.filter((p) => p !== o);
    const p = this.w.setup.player as FactionId;
    if (accept) {
      this.ceasefire(o.from, p, o.duration);
      this.w.notify({ kind: 'diplomacy', text: `CEASEFIRE WITH ${this.w.factions[o.from].name.toUpperCase()}`, sub: `${Math.round(o.duration / 60)} minutes of peace`, factions: [o.from, p], priority: 1 });
    } else {
      this.w.factions[o.from].grudge[p] += 10;
    }
  }

  /** do two kingdoms share a border? */
  bordering(a: FactionId, b: FactionId) {
    const w = this.w;
    for (const s of w.settlements) {
      if (s.owner !== a) continue;
      for (const n of s.region.neighbors) if (w.settlements[n].owner === b) return true;
    }
    return false;
  }

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    if (this.t < 2) return;
    this.t = 0;
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL) continue;
      for (let o = 0; o < NEUTRAL; o++) {
        if (o === f.id) continue;
        if (f.stance[o] === 'ceasefire' && w.time > f.ceasefireT[o]) {
          f.stance[o] = 'hostile';
          w.factions[o].stance[f.id] = 'hostile';
          w.events.emit('stanceChanged', { a: f.id, b: o as FactionId, stance: 'hostile' });
          if (f.id === w.setup.player || o === w.setup.player) w.notify({ kind: 'diplomacy', text: `CEASEFIRE WITH ${w.factions[f.id === w.setup.player ? o : f.id].name.toUpperCase()} HAS ENDED`, factions: [f.id, o as FactionId], priority: 1 });
        }
        // grudges fade slowly
        f.grudge[o] *= 0.995;
      }
    }
    // border friction
    for (let a = 0; a < NEUTRAL; a++)
      for (let b = a + 1; b < NEUTRAL; b++) {
        const fa = w.factions[a];
        const fb = w.factions[b];
        if (!fa?.alive || !fb?.alive) continue;
        if (fa.stance[b] !== 'neutral') continue;
        if (this.bordering(a as FactionId, b as FactionId)) {
          this.tension[a][b] += 2;
          if (this.tension[a][b] > 40 + w.rng.next() * 30) this.makeHostile(a as FactionId, b as FactionId);
        }
      }
    this.pendingOffers = this.pendingOffers.filter((o) => o.expires > w.time);
  }
}

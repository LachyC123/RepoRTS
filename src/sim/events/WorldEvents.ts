import { isModern, resName } from '../../data/era';
import { BUILDINGS } from '../../data/buildings';
import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { MERCENARY_UNITS } from '../../data/units';
import { Building } from '../buildings/Building';
import { T } from '../map/GameMap';
import type { World } from '../World';

export type WorldEventKind = 'gold_vein' | 'bandit_raid' | 'harvest' | 'fair' | 'mercenaries' | 'fort' | 'treasure';

export interface MercCamp {
  buildingId: number;
  expires: number;
  stock: Record<string, number>;
}

/**
 * Random world events that keep matches unpredictable: gold veins, bandit raids, bountiful
 * harvests, market fairs, travelling mercenary companies and treasure in abandoned forts.
 */
export class WorldEvents {
  private nextT: number;
  camps: MercCamp[] = [];
  history: { t: number; kind: WorldEventKind; text: string }[] = [];
  /** capture bounties (region -> gold) */
  bounties = new Map<number, number>();

  constructor(private w: World) {
    this.nextT = 140 + w.rng.next() * 40;
    w.events.on('regionCaptured', (e) => {
      const b = this.bounties.get(e.regionId);
      if (b && e.to !== NEUTRAL) {
        this.bounties.delete(e.regionId);
        w.factions[e.to].res.gold += b;
        if (e.to === w.setup.player) w.notify({ kind: 'event', text: `${isModern() ? 'SUPPLY CACHE FOUND' : 'TREASURE FOUND'}: +${b} ${resName('gold').toUpperCase()}`, sub: w.settlements[e.regionId].name, factions: [e.to], x: e.x, y: e.y, priority: 2 });
      }
    });
  }

  update(dt: number) {
    const w = this.w;
    // mercenary camps expire
    for (const c of this.camps) {
      if (w.time > c.expires) {
        const b = w.buildingById.get(c.buildingId);
        if (b) w.settlementSys.destroy(b, -1, true);
        w.notify({ kind: 'event', text: isModern() ? 'THE CONTRACTORS PULL OUT' : 'THE MERCENARY COMPANY MOVES ON', factions: [], priority: 0, world: true, quiet: true });
      }
    }
    this.camps = this.camps.filter((c) => w.time <= c.expires);
    this.aiHire();
    if (w.time < this.nextT) return;
    this.nextT = w.time + 85 + w.rng.next() * 60;
    const kinds: WorldEventKind[] = ['gold_vein', 'bandit_raid', 'harvest', 'fair', 'mercenaries', 'fort', 'gold_vein', 'bandit_raid', 'mercenaries'];
    const k = kinds[Math.floor(w.rng.next() * kinds.length)];
    this.fire(k);
  }

  fire(k: WorldEventKind) {
    const w = this.w;
    switch (k) {
      case 'gold_vein': {
        // a rich temporary vein near a free plot of some region (prefer contested middle ground)
        const cands = w.settlements.filter((s) => s.plots.some((p) => !p.buildingId) && !s.isCapital);
        for (let tries = 0; tries < 20; tries++) {
          const s = cands[Math.floor(w.rng.next() * cands.length)];
          const plot = s.plots.find((p) => !p.buildingId);
          if (!plot) continue;
          const spot = this.freeSpot(plot.def.x + 1, plot.def.y + 1, 2, 5);
          if (!spot) continue;
          const m = w.map;
          for (let y = spot[1]; y < spot[1] + 2; y++) for (let x = spot[0]; x < spot[0] + 2; x++) m.ore[y * m.w + x] = 1;
          m.version++;
          m.deposits.push({ kind: 'gold', x: (spot[0] + 1) * TILE, y: (spot[1] + 1) * TILE, amount: 900, regionId: s.id, temporary: true });
          w.events.emit('worldEvent', { kind: 'gold_vein', x: (spot[0] + 1) * TILE, y: (spot[1] + 1) * TILE, regionId: s.id });
          w.events.emit('mapChanged', { tx: spot[0], ty: spot[1], w: 2, h: 2 });
          this.log(k, `GOLD VEIN DISCOVERED AT ${s.name.toUpperCase()}`);
          w.notify({ kind: 'event', text: `⛏ ${isModern() ? 'OIL STRIKE' : 'GOLD VEIN DISCOVERED'} AT ${s.name.toUpperCase()}`, sub: 'Build a mine beside it for double output', factions: [s.owner], x: (spot[0] + 1) * TILE, y: (spot[1] + 1) * TILE, priority: 1, world: true });
          return;
        }
        return;
      }
      case 'bandit_raid': {
        // bandits strike a kingdom's outlying settlement
        const targets = w.settlements.filter((s) => s.owner !== NEUTRAL && !s.isCapital && s.tier >= 1);
        if (!targets.length) return;
        const s = targets[Math.floor(w.rng.next() * targets.length)];
        const a = w.rng.next() * Math.PI * 2;
        const sx = s.px + Math.cos(a) * 11 * TILE;
        const sy = s.py + Math.sin(a) * 11 * TILE;
        const n = 4 + Math.floor(w.time / 300);
        const ids: number[] = [];
        for (let i = 0; i < Math.min(10, n); i++) {
          const u = w.spawnUnit(i % 3 === 2 ? 'bandit_archer' : 'bandit', NEUTRAL, sx + (i % 3) * 10, sy + Math.floor(i / 3) * 10);
          ids.push(u.id);
        }
        w.orderMove(ids, s.px, s.py, { attackMove: true });
        for (const id of ids) {
          const u = w.unitById.get(id)!;
          u.leash = 0;
          u.squad = -1;
        }
        w.events.emit('worldEvent', { kind: 'bandit_raid', x: s.px, y: s.py, regionId: s.id });
        this.log(k, `${isModern() ? 'RAIDERS HIT' : 'BANDITS RAID'} ${s.name.toUpperCase()}`);
        const p = w.setup.player;
        w.notify({ kind: 'attack', text: `⚔ ${isModern() ? 'RAIDER ATTACK' : 'BANDIT RAID'} ON ${s.name.toUpperCase()}`, factions: [s.owner], x: s.px, y: s.py, priority: s.owner === p ? 2 : 0, alarm: s.owner === p, world: s.owner !== p });
        return;
      }
      case 'harvest': {
        const alive = w.factions.filter((f) => f && f.id !== NEUTRAL && f.alive);
        const f = alive[Math.floor(w.rng.next() * alive.length)];
        if (!f) return;
        w.mods.harvest[f.id] = w.time + 120;
        this.log(k, `BOUNTIFUL HARVEST IN ${f.name.toUpperCase()}`);
        w.notify({ kind: 'event', text: `🌾 BOUNTIFUL HARVEST IN ${f.name.toUpperCase()}`, sub: `+50% ${resName('food').toLowerCase()} for 2 minutes`, factions: [f.id], priority: f.isPlayer ? 1 : 0, world: true });
        w.events.emit('worldEvent', { kind: 'harvest', x: 0, y: 0 });
        return;
      }
      case 'fair': {
        const alive = w.factions.filter((f) => f && f.id !== NEUTRAL && f.alive);
        const f = alive[Math.floor(w.rng.next() * alive.length)];
        if (!f) return;
        w.mods.fair[f.id] = w.time + 120;
        this.log(k, `MARKET FAIR IN ${f.name.toUpperCase()}`);
        w.notify({ kind: 'event', text: `🎪 ${isModern() ? 'TRADE BOOM' : 'MARKET FAIR'} IN ${f.name.toUpperCase()}`, sub: 'Trade income boosted for 2 minutes', factions: [f.id], priority: f.isPlayer ? 1 : 0, world: true });
        w.events.emit('worldEvent', { kind: 'fair', x: 0, y: 0 });
        return;
      }
      case 'mercenaries': {
        if (this.camps.length) return;
        // camp on open ground in the middle ring
        const mid = w.settlements.filter((s) => s.owner === NEUTRAL || s.region.value >= 1.2);
        for (let tries = 0; tries < 20; tries++) {
          const s = mid[Math.floor(w.rng.next() * mid.length)];
          const spot = this.freeSpot(s.region.cx + (w.rng.next() - 0.5) * 16, s.region.cy + (w.rng.next() - 0.5) * 16, 3, 6);
          if (!spot) continue;
          const b = new Building(w.newId(), BUILDINGS.merc_camp, NEUTRAL, s.id, spot[0], spot[1], 3);
          w.buildings.push(b);
          w.buildingById.set(b.id, b);
          const m = w.map;
          for (let y = spot[1]; y < spot[1] + 3; y++) for (let x = spot[0]; x < spot[0] + 3; x++) m.occ[y * m.w + x] = b.id;
          m.version++;
          const stock: Record<string, number> = {};
          const offer = MERCENARY_UNITS.slice().sort(() => w.rng.next() - 0.5).slice(0, 3);
          for (const u of offer) stock[u.id] = u.id === 'foreign_knight' ? 3 : 5;
          this.camps.push({ buildingId: b.id, expires: w.time + 200, stock });
          w.events.emit('buildingPlaced', { id: b.id, x: b.x, y: b.y, type: 'merc_camp', faction: NEUTRAL });
          this.log(k, `${isModern() ? 'CONTRACTORS SET UP' : 'MERCENARY COMPANY CAMPS'} NEAR ${s.name.toUpperCase()}`);
          w.notify({ kind: 'event', text: `⚔ ${isModern() ? 'CONTRACTOR CAMP' : 'MERCENARY COMPANY'} NEAR ${s.name.toUpperCase()}`, sub: `Bring troops to the camp to hire ${isModern() ? 'contractors for funds' : 'swords for gold'}`, factions: [], x: b.x, y: b.y, priority: 1, world: true });
          return;
        }
        return;
      }
      case 'fort':
      case 'treasure': {
        const forts = w.settlements.filter((s) => s.owner === NEUTRAL && !this.bounties.has(s.id));
        if (!forts.length) return;
        const s = forts.sort((a, b) => b.region.value - a.region.value)[Math.floor(w.rng.next() * Math.min(5, forts.length))];
        const gold = 250 + Math.floor(w.time / 3);
        this.bounties.set(s.id, gold);
        this.log(k, `TREASURE RUMOURED AT ${s.name.toUpperCase()}`);
        w.notify({ kind: 'event', text: `🏰 ${isModern() ? 'ABANDONED BASE' : 'ABANDONED STRONGHOLD'}: ${s.name.toUpperCase()}`, sub: `Rumours of ${gold} ${resName('gold').toLowerCase()} for whoever captures it`, factions: [], x: s.px, y: s.py, priority: 1, world: true });
        w.events.emit('worldEvent', { kind: 'fort', x: s.px, y: s.py, regionId: s.id });
        return;
      }
    }
  }

  private log(kind: WorldEventKind, text: string) {
    this.history.push({ t: this.w.time, kind, text });
  }

  private freeSpot(cx: number, cy: number, size: number, r: number): [number, number] | null {
    const m = this.w.map;
    for (let k = 0; k < 40; k++) {
      const x = Math.round(cx + (this.w.rng.next() - 0.5) * r * 2);
      const y = Math.round(cy + (this.w.rng.next() - 0.5) * r * 2);
      let ok = true;
      for (let yy = y - 1; yy < y + size + 1 && ok; yy++)
        for (let xx = x - 1; xx < x + size + 1 && ok; xx++) {
          if (xx < 1 || yy < 1 || xx >= m.w - 1 || yy >= m.h - 1) ok = false;
          else {
            const i = yy * m.w + xx;
            const t = m.terrain[i];
            if (m.occ[i] || m.tree[i] || m.ore[i] || t === T.WATER || t === T.ROCK || t === T.ROAD || t === T.BRIDGE) ok = false;
            // keep off settlement plots
            for (const s of this.w.settlements) for (const p of s.plots) if (xx >= p.def.x && yy >= p.def.y && xx < p.def.x + p.def.size && yy < p.def.y + p.def.size) ok = false;
          }
        }
      if (ok) return [x, y];
    }
    return null;
  }

  // ------------------------------------------------------------------ hiring
  campNear(faction: FactionId, buildingId: number): boolean {
    const w = this.w;
    const b = w.buildingById.get(buildingId);
    if (!b) return false;
    let near = false;
    w.unitHash.query(b.x, b.y, 6 * TILE, (u) => {
      if (u.alive && u.faction === faction && u.def.special !== 'worker') near = true;
      return near;
    });
    return near;
  }

  hire(faction: FactionId, buildingId: number, type: string): { ok: boolean; reason?: string } {
    const w = this.w;
    const camp = this.camps.find((c) => c.buildingId === buildingId);
    if (!camp) return { ok: false, reason: 'The company has moved on' };
    if (!camp.stock[type]) return { ok: false, reason: 'None left for hire' };
    if (!this.campNear(faction, buildingId)) return { ok: false, reason: 'Move troops next to the camp first' };
    const def = w.unitDef(type);
    const f = w.factions[faction];
    if (f.pop + def.pop > f.popCap) return { ok: false, reason: 'Population limit' };
    if (!w.settlementSys.canAfford(faction, def.cost)) return { ok: false, reason: `Not enough ${resName('gold').toLowerCase()}` };
    w.settlementSys.pay(faction, def.cost);
    camp.stock[type]--;
    const b = w.buildingById.get(buildingId)!;
    const u = w.spawnUnit(type, faction, b.doorX, b.doorY, b.id);
    w.applyUpgradesToUnit(u);
    f.pop += def.pop;
    u.order = { kind: 'idle' };
    w.setDestination(u, b.doorX + (w.rng.next() - 0.5) * 30, b.doorY + 18, 0);
    return { ok: true };
  }

  /** AI kingdoms with troops at a camp and spare gold hire too */
  private aiHire() {
    const w = this.w;
    if (w.tick % 60 !== 0) return;
    for (const c of this.camps) {
      for (const f of w.factions) {
        if (!f || f.id === NEUTRAL || f.isPlayer || !f.alive) continue;
        if (f.res.gold < 300 || !this.campNear(f.id as FactionId, c.buildingId)) continue;
        const types = Object.keys(c.stock).filter((t) => c.stock[t] > 0);
        if (types.length) this.hire(f.id as FactionId, c.buildingId, types[Math.floor(w.rng.next() * types.length)]);
      }
    }
  }
}

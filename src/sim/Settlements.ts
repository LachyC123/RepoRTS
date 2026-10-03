import { hash2 } from '../core/Random';
import { BUILDINGS, FORTIFY, type BuildingDef } from '../data/buildings';
import { NEUTRAL, RES_KEYS, TILE, type Cost, type FactionId } from '../data/constants';
import { CAPITAL_UPGRADE, TIERS } from '../data/settlements';
import { UNITS } from '../data/units';
import { UPGRADES } from '../data/upgrades';
import { Building } from './buildings/Building';
import { markDirty, T } from './map/GameMap';
import { Settlement } from './territory/Settlement';
import type { World } from './World';

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

const FOREST_R = 7;

/** Core building type for a settlement's tier. */
export function coreTypeFor(s: Settlement): string {
  if (s.region.tier === 0 && !s.isCapital) return 'landmark';
  if (s.isCapital) return s.tier >= 4 ? 'capital_castle' : 'capital_castle';
  return TIERS[s.tier].core;
}

/**
 * Settlements, plots and buildings: placement, construction, training, research, settlement upgrades,
 * repairs, tower defence, destruction/rubble and ownership transfer.
 */
export class SettlementSystem {
  constructor(private w: World) {}

  // ------------------------------------------------------------------ setup
  init() {
    const w = this.w;
    for (const r of w.map.regions) {
      const owner: FactionId = r.capitalSlot !== null && w.factions[r.capitalSlot] ? (r.capitalSlot as FactionId) : NEUTRAL;
      const s = new Settlement(r, owner);
      w.settlements.push(s);
      const cs = r.coreSize;
      const tx = r.cx - Math.floor(cs / 2);
      const ty = r.cy - Math.floor(cs / 2);
      const core = this.place(coreTypeFor(s), owner, s, tx, ty, cs, -1, true);
      s.coreId = core.id;
      if (s.isCapital) {
        const f = w.factions[owner];
        if (f) f.capitalSettlement = s.id;
      }
    }
    // pre-built buildings: capitals get a house + farm; villages a farm (and maybe a house)
    for (const s of w.settlements) {
      if (s.isCapital) {
        this.prebuild(s, 'house');
        this.prebuild(s, 'farm');
      } else if (s.tier === 2) {
        if (s.region.features.includes('farmland') || hash2(s.id, 1, 9) < 0.5) this.prebuild(s, 'farm');
        if (hash2(s.id, 2, 9) < 0.5) this.prebuild(s, 'house');
      } else if (s.tier === 4) {
        this.prebuild(s, 'watchtower');
        this.prebuild(s, 'barracks');
      }
      this.updateCottages(s);
    }
  }

  private prebuild(s: Settlement, type: string) {
    for (let i = 0; i < s.unlockedPlots; i++) {
      if (s.plots[i].buildingId) continue;
      if (!this.meetsRequirement(s, i, BUILDINGS[type]).ok) continue;
      this.placeOnPlot(type, s.owner, s, i, true);
      return;
    }
  }

  // ------------------------------------------------------------------ placement
  private place(type: string, faction: FactionId, s: Settlement, tx: number, ty: number, size: number, plotIndex: number, instant: boolean): Building {
    const w = this.w;
    const def = BUILDINGS[type];
    const b = new Building(w.newId(), def, faction, s.id, tx, ty, size);
    b.plotIndex = plotIndex;
    if (!instant) {
      b.progress = 0;
      b.hp = Math.max(1, b.maxHp * 0.1);
    }
    w.buildings.push(b);
    w.buildingById.set(b.id, b);
    const m = w.map;
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        const i = y * m.w + x;
        m.occ[i] = b.id;
        // clear any stray trees under the footprint
        if (m.tree[i]) {
          m.tree[i] = 0;
          m.stump[i] = 0;
          w.events.emit('treeFelled', { x: x * TILE + 8, y: y * TILE + 8 });
        }
      }
    m.version++;
    // units standing inside get pushed out by collision; reroute movers
    if (def.id === 'mine') b.depositKind = this.nearestDeposit(s, tx + size / 2, ty + size / 2)?.kind ?? 'gold';
    w.events.emit('buildingPlaced', { id: b.id, x: b.x, y: b.y, type, faction });
    if (instant) this.onCompleted(b, true);
    return b;
  }

  placeWall(s: Settlement, tx: number, ty: number, type: 'wall' | 'gatehouse'): Building {
    return this.place(type, s.owner, s, tx, ty, 1, -1, true);
  }

  placeOnPlot(type: string, faction: FactionId, s: Settlement, plotIndex: number, instant = false): Building {
    const p = s.plots[plotIndex];
    const def = BUILDINGS[type];
    const size = Math.min(def.size, p.def.size);
    const off = Math.floor((p.def.size - size) / 2);
    // clear rubble on this plot
    for (const b of this.w.buildings) if (b.destroyed && b.settlementId === s.id && b.plotIndex === plotIndex) b.destroyedT = -999;
    const b = this.place(type, faction, s, p.def.x + off, p.def.y + off, size, plotIndex, instant);
    p.buildingId = b.id;
    return b;
  }

  nearestDeposit(s: Settlement, tcx: number, tcy: number) {
    let best = null;
    let bd = Infinity;
    for (const d of this.w.map.deposits) {
      if (d.amount <= 0) continue;
      const dd = Math.hypot(d.x / TILE - tcx, d.y / TILE - tcy);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return bd <= 7 ? best : null;
    void s;
  }

  countTrees(tcx: number, tcy: number, r = FOREST_R) {
    const m = this.w.map;
    let n = 0;
    for (let y = Math.floor(tcy - r); y <= tcy + r; y++)
      for (let x = Math.floor(tcx - r); x <= tcx + r; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        if (m.tree[y * m.w + x] && (x - tcx) ** 2 + (y - tcy) ** 2 <= r * r) n++;
      }
    return n;
  }

  meetsRequirement(s: Settlement, plotIndex: number, def: BuildingDef): CheckResult {
    const p = s.plots[plotIndex].def;
    const cx = p.x + p.size / 2;
    const cy = p.y + p.size / 2;
    switch (def.requires) {
      case 'forest':
        return this.countTrees(cx, cy) >= 5 ? { ok: true } : { ok: false, reason: 'Needs forest nearby' };
      case 'mineral':
      case 'gold':
      case 'stone':
        return this.nearestDeposit(s, cx, cy) ? { ok: true } : { ok: false, reason: 'Needs a gold or stone deposit nearby' };
      case 'fertile': {
        const m = this.w.map;
        const t = m.terrain[Math.floor(cy) * m.w + Math.floor(cx)];
        return t === T.HILL || t === T.MARSH ? { ok: false, reason: 'Soil too poor' } : { ok: true };
      }
      default:
        return { ok: true };
    }
  }

  canAfford(faction: FactionId, cost: Cost) {
    const f = this.w.factions[faction];
    for (const k of RES_KEYS) if ((cost[k] ?? 0) > f.res[k] + 1e-6) return false;
    return true;
  }

  pay(faction: FactionId, cost: Cost) {
    const f = this.w.factions[faction];
    for (const k of RES_KEYS) f.res[k] -= cost[k] ?? 0;
  }

  refund(faction: FactionId, cost: Cost, frac = 1) {
    const f = this.w.factions[faction];
    for (const k of RES_KEYS) f.res[k] += (cost[k] ?? 0) * frac;
  }

  canBuild(faction: FactionId, sid: number, plotIndex: number, type: string): CheckResult {
    const s = this.w.settlements[sid];
    const def = BUILDINGS[type];
    if (!s || !def || def.system) return { ok: false, reason: 'Invalid' };
    if (s.owner !== faction) return { ok: false, reason: 'Not your settlement' };
    if (plotIndex < 0 || plotIndex >= s.unlockedPlots) return { ok: false, reason: 'Plot locked — upgrade the settlement' };
    if (s.plots[plotIndex].buildingId) return { ok: false, reason: 'Plot occupied' };
    const tier = s.isCapital ? s.tier : s.tier;
    if (tier < def.tier) return { ok: false, reason: `Requires ${def.tier >= 4 ? 'Castle Town' : def.tier === 3 ? 'Town' : 'Village'}` };
    if (s.region.tier === 0 && !s.isCapital && def.category !== 'economy' && def.id !== 'watchtower') return { ok: false, reason: 'Landmarks only support resource buildings' };
    if (s.tier === 1 && !s.isCapital && def.id !== 'watchtower' && def.category !== 'economy') return { ok: false, reason: 'Outposts only support towers and resource buildings' };
    const req = this.meetsRequirement(s, plotIndex, def);
    if (!req.ok) return req;
    if (!this.canAfford(faction, def.cost)) return { ok: false, reason: 'Not enough resources' };
    if (this.underAttack(s)) return { ok: false, reason: 'Enemies nearby' };
    return { ok: true };
  }

  underAttack(s: Settlement) {
    return this.w.time - s.lastAttackedT < 6;
  }

  build(faction: FactionId, sid: number, plotIndex: number, type: string): CheckResult {
    const c = this.canBuild(faction, sid, plotIndex, type);
    if (!c.ok) return c;
    const s = this.w.settlements[sid];
    this.pay(faction, BUILDINGS[type].cost);
    this.placeOnPlot(type, faction, s, plotIndex, false);
    return { ok: true };
  }

  demolish(faction: FactionId, buildingId: number): CheckResult {
    const b = this.w.buildingById.get(buildingId);
    if (!b || b.faction !== faction || b.plotIndex < 0) return { ok: false, reason: 'Cannot demolish' };
    // refund half if still under construction
    if (!b.built) this.refund(faction, b.def.cost, 0.75);
    this.destroy(b, -1, true);
    return { ok: true };
  }

  // ------------------------------------------------------------------ training
  trainableAt(b: Building): string[] {
    const s = this.w.settlements[b.settlementId];
    return Object.values(UNITS)
      .filter((u) => !u.special && u.trainedAt.includes(b.def.id) && s.tier >= u.tier)
      .map((u) => u.id);
  }

  /** units shown in the build menu even if not yet unlocked (greyed with reason) */
  allTrainableAt(b: Building): string[] {
    return Object.values(UNITS)
      .filter((u) => !u.special && u.trainedAt.includes(b.def.id))
      .map((u) => u.id);
  }

  canRecruit(faction: FactionId, buildingId: number, type: string): CheckResult {
    const b = this.w.buildingById.get(buildingId);
    const def = UNITS[type];
    if (!b || !def) return { ok: false, reason: 'Invalid' };
    if (b.faction !== faction) return { ok: false, reason: 'Not yours' };
    if (!b.active) return { ok: false, reason: b.breached ? 'Building is breached' : 'Under construction' };
    if (!def.trainedAt.includes(b.def.id)) return { ok: false, reason: 'Cannot train here' };
    const s = this.w.settlements[b.settlementId];
    if (s.tier < def.tier) return { ok: false, reason: `Requires ${def.tier >= 4 ? 'Castle Town' : def.tier === 3 ? 'Town' : 'Village'}` };
    if (b.queue.length >= 6) return { ok: false, reason: 'Queue full' };
    const f = this.w.factions[faction];
    if (f.pop + def.pop > f.popCap) return { ok: false, reason: 'Population limit — build houses or capture settlements' };
    if (!this.canAfford(faction, def.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  recruit(faction: FactionId, buildingId: number, type: string): CheckResult {
    const c = this.canRecruit(faction, buildingId, type);
    if (!c.ok) return c;
    const b = this.w.buildingById.get(buildingId)!;
    const def = UNITS[type];
    this.pay(faction, def.cost);
    b.queue.push({ type, t: 0, total: def.trainTime });
    this.w.factions[faction].pop += def.pop;
    return { ok: true };
  }

  cancelTrain(faction: FactionId, buildingId: number, index: number) {
    const b = this.w.buildingById.get(buildingId);
    if (!b || b.faction !== faction || !b.queue[index]) return;
    const job = b.queue.splice(index, 1)[0];
    this.refund(faction, UNITS[job.type].cost, 1);
    this.w.factions[faction].pop -= UNITS[job.type].pop;
  }

  setRally(faction: FactionId, buildingId: number, x: number, y: number) {
    const b = this.w.buildingById.get(buildingId);
    if (!b || b.faction !== faction) return;
    b.rallyX = x;
    b.rallyY = y;
    b.hasRally = true;
  }

  // ------------------------------------------------------------------ research
  canResearch(faction: FactionId, buildingId: number, id: string): CheckResult {
    const b = this.w.buildingById.get(buildingId);
    const up = UPGRADES[id];
    const f = this.w.factions[faction];
    if (!b || !up || b.faction !== faction) return { ok: false, reason: 'Invalid' };
    if (!b.active) return { ok: false, reason: 'Under construction' };
    if (b.def.id !== up.at) return { ok: false, reason: 'Wrong building' };
    if (f.upgrades.has(id)) return { ok: false, reason: 'Already researched' };
    if (this.w.buildings.some((o) => o.faction === faction && o.research?.id === id)) return { ok: false, reason: 'In progress' };
    if (up.requires && !f.upgrades.has(up.requires)) return { ok: false, reason: `Requires ${UPGRADES[up.requires].name}` };
    const s = this.w.settlements[b.settlementId];
    if (s.tier < up.tier) return { ok: false, reason: `Requires ${up.tier >= 4 ? 'Castle Town' : 'Town'}` };
    if (b.research) return { ok: false, reason: 'Busy' };
    if (!this.canAfford(faction, up.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  research(faction: FactionId, buildingId: number, id: string): CheckResult {
    const c = this.canResearch(faction, buildingId, id);
    if (!c.ok) return c;
    const b = this.w.buildingById.get(buildingId)!;
    const up = UPGRADES[id];
    this.pay(faction, up.cost);
    b.research = { id, t: 0, total: up.time };
    return { ok: true };
  }

  // ------------------------------------------------------------------ market trade
  marketCount(faction: FactionId) {
    return this.w.buildings.filter((b) => b.faction === faction && b.def.id === 'market' && b.active).length;
  }

  /** a market, or failing that the capital's royal caravans (poor rates) */
  canTrade(faction: FactionId): boolean {
    if (this.marketCount(faction) > 0) return true;
    const cap = this.w.factions[faction]?.capitalSettlement ?? -1;
    return cap >= 0 && this.w.settlements[cap]?.owner === faction;
  }

  trade(faction: FactionId, res: 'wood' | 'food' | 'stone', buy: boolean): CheckResult {
    const n = this.marketCount(faction);
    if (!this.canTrade(faction)) return { ok: false, reason: 'Requires a Market' };
    const f = this.w.factions[faction];
    const r = tradeRates(n);
    if (buy) {
      if (f.res.gold < r.buy) return { ok: false, reason: 'Not enough gold' };
      f.res.gold -= r.buy;
      f.res[res] += TRADE_LOT;
    } else {
      if (f.res[res] < TRADE_LOT) return { ok: false, reason: `Not enough ${res}` };
      f.res[res] -= TRADE_LOT;
      f.res.gold += r.sell;
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ settlement upgrades
  upgradeCost(s: Settlement): Cost | null {
    if (!s.canUpgrade) return null;
    if (s.isCapital) return CAPITAL_UPGRADE.cost;
    return TIERS[s.tier].upgradeCost ?? null;
  }

  canUpgrade(faction: FactionId, sid: number): CheckResult {
    const s = this.w.settlements[sid];
    if (!s || s.owner !== faction) return { ok: false, reason: 'Not yours' };
    if (!s.canUpgrade) return { ok: false, reason: s.tier >= 4 ? 'Fully upgraded' : 'Cannot upgrade' };
    if (s.upgrading) return { ok: false, reason: 'Upgrading' };
    const core = this.w.buildingById.get(s.coreId);
    if (core?.breached) return { ok: false, reason: 'Repair the core first' };
    const cost = this.upgradeCost(s)!;
    if (!this.canAfford(faction, cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  upgrade(faction: FactionId, sid: number): CheckResult {
    const c = this.canUpgrade(faction, sid);
    if (!c.ok) return c;
    const s = this.w.settlements[sid];
    this.pay(faction, this.upgradeCost(s)!);
    s.upgrading = { to: s.tier + 1, t: 0, total: s.isCapital ? CAPITAL_UPGRADE.time : TIERS[s.tier].upgradeTime ?? 40 };
    return { ok: true };
  }

  canFortify(faction: FactionId, sid: number): CheckResult {
    const s = this.w.settlements[sid];
    if (!s || s.owner !== faction) return { ok: false, reason: 'Not yours' };
    const next = FORTIFY.find((f) => f.level === s.fortify + 1);
    if (!next) return { ok: false, reason: 'Fully fortified' };
    if (s.tier < next.minTier) return { ok: false, reason: next.minTier >= 3 ? 'Requires Town' : 'Requires Village' };
    if (s.fortifying) return { ok: false, reason: 'In progress' };
    if (!this.canAfford(faction, next.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  fortifyCmd(faction: FactionId, sid: number): CheckResult {
    const c = this.canFortify(faction, sid);
    if (!c.ok) return c;
    const s = this.w.settlements[sid];
    const next = FORTIFY.find((f) => f.level === s.fortify + 1)!;
    this.pay(faction, next.cost);
    s.fortifying = { level: next.level, t: 0, total: next.time };
    return { ok: true };
  }

  // ------------------------------------------------------------------ per tick
  update(dt: number) {
    const w = this.w;
    for (const b of w.buildings) {
      if (b.destroyed) continue;
      // construction
      if (b.progress < 1) {
        const prev = b.progress;
        b.progress = Math.min(1, b.progress + dt / Math.max(1, b.def.buildTime));
        b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.9 * (b.progress - prev)));
        if (b.progress >= 1) this.onCompleted(b, false);
        continue;
      }
      // training
      if (b.queue.length && b.active) {
        const job = b.queue[0];
        job.t += dt;
        if (job.t >= job.total) {
          b.queue.shift();
          this.spawnTrained(b, job.type);
        }
      }
      // research
      if (b.research && b.active) {
        b.research.t += dt;
        if (b.research.t >= b.research.total) {
          const id = b.research.id;
          b.research = null;
          w.factions[b.faction].upgrades.add(id);
          w.applyUpgrades(b.faction);
          w.events.emit('research', { faction: b.faction, id });
          w.notify({ kind: 'build', text: `${UPGRADES[id].name.toUpperCase()} RESEARCHED`, factions: [b.faction], x: b.x, y: b.y, priority: 1 });
        }
      }
      // repairs when left in peace
      if (b.hp < b.maxHp && w.time - b.lastHitT > 12 && b.def.category !== 'landmark') {
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.012 * dt);
        if (b.breached && b.hp > b.maxHp * 0.3) b.breached = false;
      }
      // defensive fire
      if (b.def.defence && b.active && b.faction !== NEUTRAL + 99) {
        b.attackCd -= dt;
        if (b.attackCd <= 0) this.towerFire(b);
      }
    }
    // settlement upgrades / fortification
    for (const s of w.settlements) {
      if (s.upgrading) {
        s.upgrading.t += dt;
        if (s.upgrading.t >= s.upgrading.total) this.completeUpgrade(s);
      }
      if (s.fortifying) {
        s.fortifying.t += dt;
        if (s.fortifying.t >= s.fortifying.total) {
          const lvl = s.fortifying.level;
          s.fortifying = null;
          w.walls.buildRing(s, lvl);
        }
      }
    }
    // rubble cleanup
    if (w.tick % 30 === 0) {
      const keep = [];
      for (const b of w.buildings) {
        if (b.destroyed && w.time - b.destroyedT > 30) {
          w.buildingById.delete(b.id);
          continue;
        }
        keep.push(b);
      }
      w.buildings = keep;
    }
  }

  private towerFire(b: Building) {
    const w = this.w;
    const d = b.def.defence!;
    const range = d.range + b.size * 6;
    let best = null;
    let bd = Infinity;
    w.unitHash.query(b.x, b.y, range, (u, d2) => {
      if (!u.alive || !w.isHostile(b.faction, u.faction) || u.def.special === 'worker' && b.faction === NEUTRAL) return;
      if (d2 < bd) {
        bd = d2;
        best = u;
      }
    });
    if (!best) {
      b.attackCd = 0.4;
      return;
    }
    const target = best as import('./units/Unit').Unit;
    b.attackCd = d.cooldown;
    // capitals and keeps fire volleys
    const shots = b.def.id === 'capital_castle' ? 2 : 1;
    for (let k = 0; k < shots; k++) {
      w.combat.fireProjectile({
        kind: 'arrow',
        faction: b.faction,
        shooterId: 0,
        fromBuilding: b.id,
        x: b.x + (k - 0.5) * 8,
        y: b.y - b.size * 8,
        target,
        attack: d.attack,
        attackType: 'pierce',
        accuracy: 0.75,
        bonus: undefined,
        armorPen: 0,
        splash: 0,
      });
    }
  }

  private spawnTrained(b: Building, type: string) {
    const w = this.w;
    const u = w.spawnUnit(type, b.faction, b.doorX, b.doorY, b.id);
    w.factions[b.faction].stats.unitsTrained++;
    w.applyUpgradesToUnit(u);
    // pop was reserved at enqueue time; recount next economy tick
    let rx: number;
    let ry: number;
    if (b.hasRally) {
      rx = b.rallyX;
      ry = b.rallyY;
    } else {
      const s = w.settlements[b.settlementId];
      const a = hash2(u.id, 3, 1) * Math.PI * 2;
      rx = s.px + Math.cos(a) * 26;
      ry = s.py + 24 + Math.sin(a) * 14;
    }
    w.setDestination(u, rx, ry, 0);
    u.order = { kind: 'move', x: rx, y: ry, attackMove: true };
    if (b.faction === w.setup.player) w.notify({ kind: 'unit', text: `${UNITS[type].name} ready`, factions: [b.faction], x: b.doorX, y: b.doorY, priority: 0, quiet: true });
  }

  private onCompleted(b: Building, instant: boolean) {
    const w = this.w;
    if (b.def.id === 'farm') this.paintFields(b);
    if (!instant) {
      w.factions[b.faction].stats.buildingsBuilt++;
      w.events.emit('buildingCompleted', { id: b.id, x: b.x, y: b.y, type: b.def.id, faction: b.faction });
      if (b.faction === w.setup.player) w.notify({ kind: 'build', text: `${b.def.name.toUpperCase()} COMPLETED`, sub: w.settlements[b.settlementId].name, factions: [b.faction], x: b.x, y: b.y, priority: 0 });
    }
  }

  /** a farm ploughs the free ground around it into fields */
  private paintFields(b: Building) {
    const m = this.w.map;
    const s = this.w.settlements[b.settlementId];
    const p = s.plots[b.plotIndex]?.def;
    const x0 = (p ? p.x : b.tx) - 1;
    const y0 = (p ? p.y : b.ty) - 1;
    const size = (p ? p.size : b.size) + 2;
    const pattern = Math.floor(hash2(b.id, 5, 5) * 4);
    let changed = false;
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const i = y * m.w + x;
        const t = m.terrain[i];
        if (m.occ[i] || m.tree[i] || m.ore[i]) continue;
        if (t !== T.GRASS && t !== T.MEADOW && t !== T.DIRT && t !== T.FOREST) continue;
        // keep other plots clear
        if (this.inOtherPlot(s, b.plotIndex, x, y)) continue;
        m.terrain[i] = T.FARMLAND;
        m.crop[i] = pattern;
        b.fields.push(i);
        markDirty(m, x, y);
        changed = true;
      }
    if (changed) this.w.events.emit('mapChanged', { tx: x0, ty: y0, w: size, h: size });
  }

  private inOtherPlot(s: Settlement, idx: number, x: number, y: number) {
    for (let k = 0; k < s.plots.length; k++) {
      if (k === idx) continue;
      const p = s.plots[k].def;
      if (x >= p.x && y >= p.y && x < p.x + p.size && y < p.y + p.size) return true;
    }
    return false;
  }

  private completeUpgrade(s: Settlement) {
    const w = this.w;
    const to = s.upgrading!.to;
    s.upgrading = null;
    s.tier = to;
    const core = w.buildingById.get(s.coreId);
    if (core) {
      const frac = core.hp / core.maxHp;
      core.def = BUILDINGS[coreTypeFor(s)];
      core.maxHp = core.def.hp * (s.isCapital && to >= 4 ? 1.35 : 1);
      core.hp = Math.max(frac, 0.6) * core.maxHp;
    }
    this.updateCottages(s);
    w.events.emit('settlementUpgraded', { regionId: s.id, tier: to, faction: s.owner });
    w.notify({ kind: 'build', text: `${s.name.toUpperCase()} GROWS INTO A ${s.tierName.toUpperCase()}`, factions: [s.owner], x: s.cx, y: s.cy, priority: s.owner === w.setup.player ? 1 : 0, world: s.owner !== w.setup.player });
  }

  /** decorative cottages fill in as a settlement prospers (blocking 1-tile homes) */
  updateCottages(s: Settlement) {
    const w = this.w;
    const m = w.map;
    if (s.region.tier === 0 && !s.isCapital) return;
    const want = s.isCapital ? (s.tier >= 4 ? 13 : 9) : s.tier >= 4 ? 11 : s.tier === 3 ? 7 : s.tier === 2 ? 3 : 0;
    if (s.cottages.length >= want) return;
    const r = s.region;
    const cands: { i: number; d: number }[] = [];
    const R = s.isCapital ? 13 : s.tier >= 3 ? 11 : 9;
    for (let y = r.cy - R; y <= r.cy + R; y++)
      for (let x = r.cx - R; x <= r.cx + R; x++) {
        if (x < 2 || y < 2 || x >= m.w - 2 || y >= m.h - 2) continue;
        const d = Math.hypot(x - r.cx, y - r.cy);
        if (d < r.coreSize / 2 + 2 || d > R) continue;
        const i = y * m.w + x;
        if (m.region[i] !== r.id) continue;
        cands.push({ i, d: d + hash2(x, y, 31) * 3 });
      }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (s.cottages.length >= want) break;
      const x = c.i % m.w;
      const y = Math.floor(c.i / m.w);
      if (!this.cottageOk(s, x, y)) continue;
      s.cottages.push(c.i);
      m.occ[c.i] = -1;
    }
    m.version++;
  }

  private cottageOk(s: Settlement, x: number, y: number) {
    const m = this.w.map;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const i = ny * m.w + nx;
        const t = m.terrain[i];
        if (m.occ[i]) return false;
        if (dx === 0 && dy === 0 && (m.tree[i] || m.ore[i])) return false;
        if (t === T.WATER || t === T.ROCK || t === T.BRIDGE || t === T.SHALLOW) return false;
        if (dx === 0 && dy === 0 && t === T.ROAD) return false;
        // keep roads lined but never walled off: a cottage may touch a road only orthogonally
        if (t === T.ROAD && dx !== 0 && dy !== 0) return false;
        if (dx === 0 && dy === 0 && (t === T.FARMLAND || t === T.MARSH)) return false;
        if (dx === 0 && dy === 0) {
          // never on a plot; keep a one-tile lane around plots
          for (const p of s.plots) {
            const pd = p.def;
            if (nx >= pd.x - 1 && ny >= pd.y - 1 && nx < pd.x + pd.size + 1 && ny < pd.y + pd.size + 1) return false;
          }
        }
      }
    // don't block the plaza / capture point
    const d = Math.hypot(x + 0.5 - s.region.px, y + 0.5 - s.region.py);
    return d > 2.5;
  }

  // ------------------------------------------------------------------ damage
  damage(b: Building, dmg: number, attacker: FactionId | -1) {
    const w = this.w;
    if (b.destroyed || b.def.category === 'landmark' || b.def.id === 'merc_camp') return;
    b.hp -= dmg;
    b.lastHitT = w.time;
    b.lastAttacker = attacker;
    const s = w.settlements[b.settlementId];
    s.lastAttackedT = w.time;
    if (b.faction === w.setup.player && b.def.id !== 'wall' && b.def.id !== 'gatehouse') w.alertBuilding(b);
    if (b.hp <= 0) {
      if (b.id === s.coreId || b.def.category === 'core') {
        b.hp = 0;
        if (!b.breached) {
          b.breached = true;
          b.queue.forEach((j) => this.refund(b.faction, UNITS[j.type].cost, 0.5));
          b.queue = [];
          w.events.emit('buildingDestroyed', { id: b.id, x: b.x, y: b.y, type: b.def.id, size: b.size, faction: b.faction });
          if (s.isCapital && b.faction !== NEUTRAL && attacker !== -1) w.onCapitalDestroyed(s, attacker as FactionId);
          else w.notify({ kind: 'war', text: `${s.name.toUpperCase()} BREACHED`, factions: [b.faction, attacker as FactionId], x: b.x, y: b.y, priority: 1 });
        }
      } else this.destroy(b, attacker, false);
    }
  }

  destroy(b: Building, attacker: FactionId | -1, quiet: boolean) {
    const w = this.w;
    if (b.destroyed) return;
    b.destroyed = true;
    b.destroyedT = w.time;
    b.hp = 0;
    const m = w.map;
    for (let y = b.ty; y < b.ty + b.size; y++)
      for (let x = b.tx; x < b.tx + b.size; x++) {
        const i = y * m.w + x;
        if (m.occ[i] === b.id) {
          m.occ[i] = 0;
          m.gateOwner[i] = 0;
          w.walls.clearMask(i);
        }
      }
    m.version++;
    const s = w.settlements[b.settlementId];
    if (b.plotIndex >= 0 && s.plots[b.plotIndex]?.buildingId === b.id) s.plots[b.plotIndex].buildingId = 0;
    if (b.queue.length) {
      for (const j of b.queue) w.factions[b.faction].pop -= UNITS[j.type].pop;
      b.queue = [];
    }
    if (b.def.id === 'wall' || b.def.id === 'gatehouse') s.wallIds = s.wallIds.filter((id) => id !== b.id);
    w.events.emit('buildingDestroyed', { id: b.id, x: b.x, y: b.y, type: b.def.id, size: b.size, faction: b.faction });
    if (!quiet && b.faction === w.setup.player && b.def.id !== 'wall') w.notify({ kind: 'lost', text: `${b.def.name.toUpperCase()} DESTROYED`, sub: s.name, factions: [b.faction], x: b.x, y: b.y, priority: 1 });
    void attacker;
  }

  /** hand a settlement and all its buildings to a new owner */
  transfer(s: Settlement, to: FactionId) {
    const w = this.w;
    const from = s.owner;
    s.owner = to;
    s.capProgress = 0;
    s.capFaction = -1;
    s.capturedT = w.time;
    s.upgrading = null;
    s.fortifying = null;
    for (const b of w.buildings) {
      if (b.settlementId !== s.id || b.destroyed) continue;
      if (b.queue.length) {
        for (const j of b.queue) w.factions[from].pop -= UNITS[j.type].pop;
        b.queue = [];
      }
      b.research = null;
      b.faction = to;
      b.hasRally = false;
      if (b.id === s.coreId) {
        if (s.isCapital && b.breached) {
          // the old capital becomes a captured castle town
          s.isCapital = false;
          s.tier = 4;
          b.def = BUILDINGS.keep;
          b.maxHp = b.def.hp;
        }
        b.hp = Math.max(b.hp, b.maxHp * 0.3);
        b.breached = false;
      }
      if (b.isGate) w.walls.setGateOwner(b);
    }
    w.map.version++;
  }
}

/**
 * Market trading: convert between gold and goods. Better rates with more markets; with none, the
 * capital's royal caravans still trade at poor rates so a kingdom cut off from a resource can recover.
 */
export const TRADE_LOT = 100;
export function tradeRates(markets: number) {
  if (markets <= 0) return { buy: 210, sell: 38 };
  const bonus = Math.min(0.25, (markets - 1) * 0.08);
  return { buy: Math.round(150 * (1 - bonus)), sell: Math.round(55 * (1 + bonus)) };
}

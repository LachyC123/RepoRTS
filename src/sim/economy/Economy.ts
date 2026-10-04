import { emptyRes, NEUTRAL, RES_KEYS, TILE, type Resources } from '../../data/constants';
import { DIFFICULTIES } from '../../data/factions';
import { REGION_YIELD } from '../../data/settlements';
import { T } from '../map/GameMap';
import type { World } from '../World';

/**
 * Income per minute from settlement taxes, region features, staffed production buildings and
 * world events; resources accrue continuously each tick. Also maintains population caps.
 */
export class EconomySystem {
  private t = 0;
  private effT = 0;
  constructor(private w: World) {}

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    this.effT += dt;
    if (this.effT > 4) {
      this.effT = 0;
      this.updateEfficiency();
    }
    if (this.t >= 1 || w.tick === 1) {
      this.t = 0;
      this.recompute();
    }
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL || !f.alive) continue;
      for (const k of RES_KEYS) {
        const gain = (f.income[k] / 60) * dt;
        f.res[k] += gain;
        if (gain > 0) {
          f.stats.resourcesEarned += gain;
          if (k === 'gold') f.stats.goldEarned += gain;
        }
      }
    }
  }

  /** forest density / deposits drive production efficiency */
  private updateEfficiency() {
    const w = this.w;
    for (const b of w.buildings) {
      if (!b.built) continue;
      if (b.def.id === 'lumber_camp') {
        const n = w.settlementSys.countTrees(b.tx + b.size / 2, b.ty + b.size / 2);
        const prev = b.efficiency;
        b.efficiency = n <= 0 ? 0 : Math.max(0.2, Math.min(1, n / 14));
        if (prev > 0 && b.efficiency === 0 && b.faction === w.setup.player) w.notify({ kind: 'economy', text: 'FOREST EXHAUSTED', sub: `${w.settlements[b.settlementId].name} lumber camp is idle`, factions: [b.faction], x: b.x, y: b.y, priority: 1 });
      } else if (b.def.id === 'mine') {
        const s = w.settlements[b.settlementId];
        const d = w.settlementSys.nearestDeposit(s, b.tx + b.size / 2, b.ty + b.size / 2);
        if (!d) {
          if (b.efficiency > 0 && b.faction === w.setup.player) w.notify({ kind: 'economy', text: '⛏ MINE DEPLETED', sub: s.name, factions: [b.faction], x: b.x, y: b.y, priority: 1 });
          b.efficiency = 0;
        } else {
          b.efficiency = d.temporary ? 2 : 1;
          b.depositKind = d.kind;
        }
      } else if (b.def.id === 'farm') {
        // farms on fertile farmland regions do a bit better
        const m = w.map;
        const i = Math.floor(b.y / TILE) * m.w + Math.floor(b.x / TILE);
        const s = w.settlements[b.settlementId];
        b.efficiency = (s.region.features.includes('farmland') ? 1.15 : 1) * (m.terrain[i] === T.FARMLAND ? 1 : 1);
      }
    }
  }

  recompute() {
    const w = this.w;
    const inc: Resources[] = [];
    const popCap: number[] = [];
    const markets: number[] = [];
    for (let f = 0; f <= NEUTRAL; f++) {
      inc[f] = emptyRes();
      popCap[f] = 0;
      markets[f] = 0;
    }
    for (const s of w.settlements) {
      const o = s.owner;
      if (o === NEUTRAL) continue;
      const core = w.buildingById.get(s.coreId);
      const working = !core?.breached;
      if (working) {
        inc[o].gold += s.tax.gold;
        inc[o].food += s.tax.food;
        popCap[o] += s.popCap;
      }
      for (const feat of s.region.features) {
        const y = REGION_YIELD[feat];
        if (!y) continue;
        for (const k of RES_KEYS) inc[o][k] += y[k] ?? 0;
      }
      if (s.region.name === 'Crownkeep') inc[o].gold += 4;
    }
    for (const b of w.buildings) {
      if (!b.active || b.faction === NEUTRAL) continue;
      const o = b.faction;
      if (b.def.popCap) popCap[o] += b.def.popCap + (b.level - 1) * 2;
      if (b.def.id === 'market') markets[o]++;
      const p = b.def.produces;
      if (!p) continue;
      // upgraded buildings produce more: +35% per level
      const k = b.staffed * b.efficiency * (1 + (b.level - 1) * 0.35);
      if (b.def.id === 'mine') {
        if (b.depositKind === 'stone') inc[o].stone += 20 * k;
        else inc[o].gold += 26 * k;
        continue;
      }
      for (const key of RES_KEYS) inc[o][key] += (p[key] ?? 0) * k;
    }
    for (let f = 0; f < NEUTRAL; f++) {
      const fac = w.factions[f];
      if (!fac) continue;
      // trade network bonus: each market beyond the first +10% market income
      if (markets[f] > 1) inc[f].gold += markets[f] * 24 * Math.min(0.5, (markets[f] - 1) * 0.1);
      // Crownkeep taxation
      const holdsCrown = w.settlements.some((s) => s.owner === f && s.region.name === 'Crownkeep');
      if (holdsCrown) inc[f].gold *= 1.1;
      // world event modifiers
      const mods = w.mods;
      if (mods.harvest[f] > w.time) inc[f].food *= 1.5;
      if (mods.fair[f] > w.time) inc[f].gold += markets[f] * 24 + 10;
      // AI difficulty (Warlord gets a small documented bonus; Casual a small malus)
      if (!fac.isPlayer) {
        const d = DIFFICULTIES[w.setup.difficulty].incomeBonus;
        for (const k of RES_KEYS) inc[f][k] *= d;
      }
      fac.income = inc[f];
      fac.popCap = Math.min(200, popCap[f]);
    }
    // population recount (units + queued)
    const pop = [0, 0, 0, 0, 0];
    for (const u of w.units) if (u.alive) pop[u.faction] += u.def.pop;
    for (const b of w.buildings) for (const j of b.queue) pop[b.faction] += w.unitDef(j.type).pop;
    for (let f = 0; f < NEUTRAL; f++) {
      const fac = w.factions[f];
      if (!fac) continue;
      fac.pop = pop[f];
      let army = 0;
      for (const u of w.units) if (u.alive && u.faction === f && u.def.special !== 'worker') army++;
      if (army > fac.stats.largestArmy) fac.stats.largestArmy = army;
    }
  }
}

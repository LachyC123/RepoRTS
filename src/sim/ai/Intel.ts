import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { unitClass } from '../../data/units';
import type { World } from '../World';

/**
 * What an AI kingdom knows. Enemy positions come only from its own fog-of-war vision, remembered
 * with decay. Overall enemy strength is estimated (with difficulty-dependent noise) the way a real
 * ruler would hear rumours of armies; resources are never shared.
 */
export class Intel {
  /** remembered hostile power near each region, per faction */
  regionThreat: Float32Array[]; // [faction][region]
  /** estimated total army power per faction */
  power = [0, 0, 0, 0, 0];
  /** observed composition per faction (class counts, decayed) */
  comp: Record<string, number>[] = [];
  /** neutral garrison power per region (static-ish, visible on the map) */
  garrison: Float32Array;
  private noise = [1, 1, 1, 1, 1];
  private cur: Float32Array[] = [];

  constructor(
    private w: World,
    private me: FactionId,
    private accuracy: number,
  ) {
    const n = w.settlements.length || w.map.regions.length;
    this.regionThreat = [];
    for (let f = 0; f <= NEUTRAL; f++) {
      this.regionThreat.push(new Float32Array(n));
      this.comp.push({ melee: 0, ranged: 0, cavalry: 0, siege: 0 });
    }
    this.garrison = new Float32Array(n);
    for (let f = 0; f <= NEUTRAL; f++) this.cur.push(new Float32Array(n));
  }

  update(dt: number) {
    const w = this.w;
    const me = this.me;
    const vis = w.vis.visible[me];
    const m = w.map;
    const decay = Math.pow(0.9, dt);
    for (let f = 0; f <= NEUTRAL; f++) {
      const rt = this.regionThreat[f];
      for (let i = 0; i < rt.length; i++) rt[i] *= decay;
      const c = this.comp[f];
      for (const k in c) c[k] *= Math.pow(0.97, dt);
    }
    this.garrison.fill(0);
    const totals = [0, 0, 0, 0, 0];
    const cur: Float32Array[] = this.cur;
    for (const c of cur) c.fill(0);
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker') continue;
      const p = u.def.power * (0.4 + 0.6 * (u.hp / u.maxHp));
      totals[u.faction] += p;
      if (u.faction === me) continue;
      const ti = Math.floor(u.y / TILE) * m.w + Math.floor(u.x / TILE);
      const r = m.region[ti];
      if (u.faction === NEUTRAL) {
        this.garrison[r] += p;
        continue;
      }
      if (!vis[ti]) continue;
      cur[u.faction][r] += p;
      this.comp[u.faction][unitClass(u.def)] += 0.05 * dt * 3;
    }
    // memory = max(decayed memory, what we can see right now)
    for (let f = 0; f < NEUTRAL; f++) {
      const rt = this.regionThreat[f];
      const c = cur[f];
      for (let i = 0; i < rt.length; i++) if (c[i] > rt[i]) rt[i] = c[i];
    }
    // rumours of total strength with noise
    for (let f = 0; f < NEUTRAL; f++) {
      if (this.w.rng.next() < 0.05) this.noise[f] = 1 + (this.w.rng.next() - 0.5) * 0.5 * (1 - this.accuracy);
      this.power[f] = totals[f] * this.noise[f];
    }
    this.power[me] = totals[me];
  }

  /** hostile power threatening a region (sum over hostile factions) */
  threatAt(region: number): number {
    let t = 0;
    for (let f = 0; f < NEUTRAL; f++) {
      if (f === this.me || !this.w.isHostile(this.me, f as FactionId)) continue;
      t += this.regionThreat[f][region];
      for (const n of this.w.graph.adj[region]) t += this.regionThreat[f][n] * 0.35;
    }
    return t;
  }

  /** estimated defence of a target region: units remembered there + structures */
  defenceOf(region: number): number {
    const w = this.w;
    const s = w.settlements[region];
    let d = 0;
    if (s.owner === NEUTRAL) d += this.garrison[region];
    else {
      d += this.regionThreat[s.owner][region] * 1.1;
      // rumoured reserves: kingdoms defend their towns and capital with part of their army
      const share = s.isCapital ? 0.35 : s.tier >= 3 ? 0.15 : 0.06;
      d = Math.max(d, this.power[s.owner] * share);
    }
    for (const b of w.buildings) {
      if (b.settlementId !== region || b.destroyed || !b.active || !b.def.defence) continue;
      if (b.faction === this.me) continue;
      d += b.def.id === 'capital_castle' ? 10 : b.def.id === 'keep' ? 7 : b.def.id === 'town_hall' ? 3 : 2.5;
    }
    return d;
  }
}

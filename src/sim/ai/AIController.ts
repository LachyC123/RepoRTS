import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { DIFFICULTIES, type DifficultyDef, type Personality } from '../../data/factions';
import { unitClass } from '../../data/units';
import type { Faction } from '../Faction';
import type { Settlement } from '../territory/Settlement';
import type { Unit } from '../units/Unit';
import type { World } from '../World';
import { aiEconomy } from './AIEconomy';
import { aiMilitary } from './AIMilitary';
import { Intel } from './Intel';

export type SquadKind = 'capture' | 'attack' | 'defend' | 'raid' | 'scout';

export interface Squad {
  id: number;
  kind: SquadKind;
  units: Set<number>;
  target: number;
  targetFaction: FactionId;
  state: 'gather' | 'move' | 'siege' | 'hold' | 'retreat';
  started: number;
  lastOrder: number;
  holdUntil: number;
  bestDist: number;
  lastProgress: number;
  /** power needed when formed */
  need: number;
}

export interface AIDebug {
  goal: string;
  econ: string;
  threat: Record<string, number>;
  army: number;
  power: number;
  wars: string[];
  squads: string[];
  lastBuild: string;
  target: string;
}

/**
 * One AI kingdom. Thinks like an RTS player on a cadence set by difficulty:
 * economy (build orders, upgrades), production (composition + counters), strategy (where to expand,
 * whom to fight, when to declare war or seek a ceasefire) and squads (capture, attack, defend, raid,
 * retreat). Personality biases every weight but never hard-locks behaviour.
 */
export class AIController {
  readonly f: Faction;
  readonly pers: Personality;
  readonly diff: DifficultyDef;
  readonly intel: Intel;
  squads: Squad[] = [];
  private nextSquad = 1;
  private thinkT: number;
  private tacticT: number;
  private warT = 0;
  private scoutT = 0;
  /** regions we failed to take recently → cooldown until */
  failed = new Map<number, number>();
  debug: AIDebug = { goal: '', econ: '', threat: {}, army: 0, power: 0, wars: [], squads: [], lastBuild: '', target: '' };
  savingFor: string | null = null;
  saveKey = '';
  saveSince = 0;
  musterRegion = -1;

  constructor(
    readonly w: World,
    readonly id: FactionId,
  ) {
    this.f = w.factions[id];
    this.pers = this.f.personality;
    this.diff = DIFFICULTIES[w.setup.difficulty];
    this.intel = new Intel(w, id, this.diff.counterPlay);
    // stagger AIs
    this.thinkT = 0.5 + id * 0.37;
    this.tacticT = 0.2 + id * 0.21;
  }

  get aggression() {
    return Math.min(1.2, this.pers.aggression * this.diff.aggression);
  }

  myUnits(): Unit[] {
    return this.w.units.filter((u) => u.alive && u.faction === this.id && u.def.special !== 'worker');
  }

  owned(): Settlement[] {
    return this.w.settlements.filter((s) => s.owner === this.id);
  }

  capital(): Settlement | null {
    const c = this.f.capitalSettlement;
    return c >= 0 && this.w.settlements[c].owner === this.id ? this.w.settlements[c] : this.owned().sort((a, b) => b.tier - a.tier)[0] ?? null;
  }

  power(units: Iterable<Unit>) {
    let p = 0;
    for (const u of units) p += u.def.power * (0.4 + 0.6 * (u.hp / u.maxHp));
    return p;
  }

  update(dt: number) {
    if (!this.f.alive) return;
    this.thinkT -= dt;
    this.tacticT -= dt;
    if (this.tacticT <= 0) {
      this.tacticT = this.diff.tacticInterval;
      this.intel.update(this.diff.tacticInterval);
      this.updateSquads();
      this.manageCommander();
    }
    if (this.thinkT <= 0) {
      this.thinkT = this.diff.thinkInterval * (0.85 + this.w.rng.next() * 0.3);
      // low efficiency AIs sometimes dither
      if (this.w.rng.next() > this.diff.efficiency + 0.15) return;
      aiEconomy(this);
      aiMilitary(this);
      this.strategy();
      this.warT -= this.diff.thinkInterval;
      if (this.warT <= 0) {
        this.warT = 18 + this.w.rng.next() * 14;
        this.diplomacy();
      }
      this.scout();
      this.updateDebug();
    }
  }

  // ------------------------------------------------------------------ strategy
  private strategy() {
    const w = this.w;
    const owned = this.owned();
    if (!owned.length) return;
    const all = this.myUnits();
    const inSquad = new Set<number>();
    for (const s of this.squads) for (const id of s.units) inSquad.add(id);
    const pool = all.filter((u) => !inSquad.has(u.id) && u.def.special !== 'commander' && u.routing <= 0);

    // 1) defence: threatened settlements first
    const threatened = owned
      .map((s) => ({ s, t: this.intel.threatAt(s.id) + (w.time - s.lastAttackedT < 8 ? 3 + s.threat * 1.5 : 0) }))
      .filter((x) => x.t > 1.5)
      .sort((a, b) => b.t * (b.s.isCapital ? 3 : b.s.tier + 1) - a.t * (a.s.isCapital ? 3 : a.s.tier + 1));
    for (const { s, t } of threatened.slice(0, 2)) {
      if (this.squads.some((q) => q.kind === 'defend' && q.target === s.id)) continue;
      const need = t * 1.3;
      const picked = this.pick(pool, s.px, s.py, need);
      if (!picked.length && s.isCapital) {
        // recall the field army to save the capital
        for (const q of this.squads) if (q.kind === 'attack' || q.kind === 'capture') this.retreat(q, s.id);
        continue;
      }
      if (picked.length) this.form('defend', picked, s.id, s.owner, need);
    }

    const inSquadNow = () => {
      const set = new Set<number>();
      for (const q of this.squads) for (const id of q.units) set.add(id);
      return set;
    };
    let busy = inSquadNow();
    const avail = pool.filter((u) => !busy.has(u.id));
    const availPower = this.power(avail);
    // keep a home guard only when hostile kingdoms are actually near
    let exposed = 0;
    for (const s of owned) for (const n of w.graph.adj[s.id]) {
      const o = w.settlements[n].owner;
      if (o !== this.id && o !== NEUTRAL && w.isHostile(this.id, o)) exposed++;
    }
    const homeGuard = this.pers.homeGuard * this.intel.power[this.id] * Math.min(1, exposed / 3);

    // 2) objectives: one main army for war, small detachments for neutral captures
    const targets = this.scoreTargets(availPower);
    this.debug.target = targets[0] ? `${w.settlements[targets[0].id].name} (${targets[0].score.toFixed(1)})` : '-';
    const offense = () => this.squads.filter((q) => q.kind === 'capture' || q.kind === 'attack');
    const maxCaptures = 1 + (this.pers.expansion > 0.8 ? 1 : 0) + (w.time < 300 ? 1 : 0);
    let spare = availPower - homeGuard;
    const main = this.squads.find((q) => q.kind === 'attack' && q.state !== 'retreat' && q.state !== 'hold');
    if (main && spare > 2) {
      // reinforce the main army with idle troops
      const s = w.settlements[main.target];
      const reinf = this.pick(avail.filter((u) => !busy.has(u.id)), s.px, s.py, spare, true);
      if (reinf.length >= 3) {
        for (const u of reinf) {
          main.units.add(u.id);
          u.squad = main.id;
        }
        spare -= this.power(reinf);
        busy = inSquadNow();
      }
    }
    for (const t of targets) {
      const s = w.settlements[t.id];
      if (this.squads.some((q) => q.target === t.id && q.kind !== 'defend')) continue;
      if (t.neutral) {
        if (offense().filter((q) => q.kind === 'capture').length >= maxCaptures) continue;
      } else if (offense().some((q) => q.kind === 'attack')) continue;
      const ratio = t.neutral ? 1.6 : this.pers.attackRatio * 1.05;
      // war armies are never token forces; they grow over the match
      const minWar = Math.min(this.intel.power[this.id] * 0.45, 5 + (w.time / 60) * 1.3 * (0.6 + this.aggression * 0.5));
      const need = Math.max(t.neutral ? 2.5 : minWar, t.defence * ratio + 1);
      if (spare < need) {
        // a prize worth waiting for: hold our strength instead of frittering it on small captures
        if (!t.neutral && t === targets[0] && spare > need * 0.55) break;
        continue;
      }
      const stillAvail = avail.filter((u) => !busy.has(u.id));
      const wantSiege = !t.neutral && (s.breachFrac > 0 || s.isCapital);
      // capture parties take what they need; the main army takes most of what is spare
      let picked = this.pick(stillAvail, s.px, s.py, t.neutral ? need * 1.3 : Math.max(need * 1.2, spare * 0.85), wantSiege);
      if (this.power(picked) < need) continue;
      if (!t.neutral && this.f.commanderId) {
        const c = w.unitById.get(this.f.commanderId);
        if (c && c.alive && !busy.has(c.id) && c.hp > c.maxHp * 0.6) picked = [...picked, c];
      }
      this.form(t.neutral ? 'capture' : 'attack', picked, t.id, s.owner, need);
      spare -= this.power(picked);
      busy = inSquadNow();
      this.debug.goal = `${t.neutral ? 'Capture' : 'Attack'} ${s.name}`;
    }

    // 3) raids by fast cavalry on exposed enemy economy
    if (this.aggression > 0.5 && !this.squads.some((q) => q.kind === 'raid')) {
      const cav = avail.filter((u) => u.def.tags.includes('cavalry') && u.def.tags.includes('light') && !this.squads.some((q) => q.units.has(u.id)));
      if (cav.length >= 3) {
        const tgt = this.raidTarget();
        if (tgt >= 0) this.form('raid', cav.slice(0, 6), tgt, w.settlements[tgt].owner, 0);
      }
    }

    // 4) station idle units at the muster point (most threatened frontier, else capital)
    this.musterRegion = this.chooseMuster(owned);
    const muster = w.settlements[this.musterRegion];
    for (const u of avail) {
      if (this.squads.some((q) => q.units.has(u.id))) continue;
      const d = Math.hypot(u.x - muster.px, u.y - (muster.py + 30));
      if (d > 9 * TILE && u.arrived && u.order.kind !== 'move') {
        const a = (u.id * 2.39) % (Math.PI * 2);
        w.orderMove([u.id], muster.px + Math.cos(a) * 30, muster.py + 30 + Math.sin(a) * 18, { attackMove: true });
      }
    }
  }

  private chooseMuster(owned: Settlement[]): number {
    const w = this.w;
    let best = this.capital()?.id ?? owned[0].id;
    let bs = -Infinity;
    for (const s of owned) {
      // frontier: adjacent to hostile kingdom territory
      let front = 0;
      for (const n of w.graph.adj[s.id]) {
        const o = w.settlements[n].owner;
        if (o !== this.id && o !== NEUTRAL && w.isHostile(this.id, o)) front += 1;
      }
      const sc = front * 2 + this.intel.threatAt(s.id) * 0.5 + (s.isCapital ? 1.5 : 0) + s.tier * 0.3;
      if (sc > bs) {
        bs = sc;
        best = s.id;
      }
    }
    return best;
  }

  /** score candidate regions to capture or attack */
  scoreTargets(availPower: number) {
    const w = this.w;
    const out: { id: number; score: number; defence: number; neutral: boolean }[] = [];
    const owned = this.owned();
    const ownedIds = new Set(owned.map((s) => s.id));
    const cap = this.capital();
    for (const s of w.settlements) {
      if (s.owner === this.id) continue;
      const neutral = s.owner === NEUTRAL;
      if (!neutral && !w.diplomacy.atWar(this.id, s.owner)) continue;
      if ((this.failed.get(s.id) ?? 0) > w.time) continue;
      // distance from our territory
      let dist = Infinity;
      let adjacent = false;
      for (const o of owned) {
        const d = w.graph.d(o.id, s.id);
        if (d < dist) dist = d;
        if (w.graph.adj[o.id].includes(s.id)) adjacent = true;
      }
      if (!isFinite(dist)) continue;
      const capD = cap ? w.graph.d(cap.id, s.id) : dist;
      let value = s.region.value * (1 + s.tier * 0.35 + (s.isCapital ? 2 : 0));
      for (const f of s.region.features) value += f === 'gold' ? 0.8 : f === 'stone' ? 0.4 : f === 'forest' ? 0.3 : f === 'farmland' ? 0.35 : f === 'fortress' ? 0.6 : 0.15;
      const defence = this.intel.defenceOf(s.id) + (neutral ? 0 : s.tier * 0.6);
      let score = (value * (adjacent ? 1.8 : 1)) / (1 + dist / 40 + capD / 120);
      score /= 1 + defence / Math.max(2, availPower);
      if (neutral) score *= 0.6 + this.pers.expansion * 0.9;
      else {
        score *= 0.5 + this.aggression;
        // opportunism: their army is busy elsewhere / they are weak
        const theirPower = this.intel.power[s.owner];
        if (theirPower < this.intel.power[this.id] * 0.7) score *= 1.35;
        score *= 1 + w.factions[this.id].grudge[s.owner] / 200;
        if (w.factions[s.owner].isPlayer) score *= this.diff.playerBias;
        if (s.isCapital) {
          score *= w.time > 660 ? 2 : w.time > 480 ? 1.3 : 0.6;
          // go for the throat of a collapsing kingdom
          if (this.intel.power[s.owner] < this.intel.power[this.id] * 0.45 && w.time > 360) score *= 3;
        }
        // finishing off a kingdom in crisis
        if (w.factions[s.owner].critical > 0) score *= 1.6;
      }
      if (ownedIds.has(s.id)) continue;
      out.push({ id: s.id, score, defence, neutral });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  private raidTarget(): number {
    const w = this.w;
    let best = -1;
    let bs = 0;
    for (const s of w.settlements) {
      if (s.owner === this.id || s.owner === NEUTRAL || !w.diplomacy.atWar(this.id, s.owner)) continue;
      const def = this.intel.defenceOf(s.id);
      const prod = w.buildings.filter((b) => b.settlementId === s.id && b.active && b.def.produces).length;
      if (!prod) continue;
      const sc = prod / (1 + def);
      if (sc > bs) {
        bs = sc;
        best = s.id;
      }
    }
    return best;
  }

  /** pick nearest units until power reached; optionally bring siege */
  private pick(pool: Unit[], x: number, y: number, need: number, wantSiege = false): Unit[] {
    const sorted = pool
      .filter((u) => u.def.special !== 'commander')
      .map((u) => ({ u, d: Math.hypot(u.x - x, u.y - y) }))
      .sort((a, b) => a.d - b.d);
    const out: Unit[] = [];
    let p = 0;
    for (const { u } of sorted) {
      if (p >= need) break;
      if (unitClass(u.def) === 'siege' && !wantSiege) continue;
      out.push(u);
      p += u.def.power;
    }
    if (wantSiege) {
      for (const { u } of sorted) if (unitClass(u.def) === 'siege' && !out.includes(u)) out.push(u);
    }
    return out;
  }

  form(kind: SquadKind, units: Unit[], target: number, targetFaction: FactionId, need: number): Squad {
    const q: Squad = {
      id: this.nextSquad++,
      kind,
      units: new Set(units.map((u) => u.id)),
      target,
      targetFaction,
      state: kind === 'defend' || kind === 'raid' ? 'move' : 'gather',
      started: this.w.time,
      lastOrder: -99,
      holdUntil: 0,
      bestDist: Infinity,
      lastProgress: this.w.time,
      need,
    };
    for (const u of units) u.squad = q.id;
    this.squads.push(q);
    return q;
  }

  disband(q: Squad) {
    for (const id of q.units) {
      const u = this.w.unitById.get(id);
      if (u) u.squad = 0;
    }
    this.squads = this.squads.filter((s) => s !== q);
  }

  retreat(q: Squad, toRegion?: number) {
    const w = this.w;
    const units = [...q.units].map((id) => w.unitById.get(id)).filter((u): u is Unit => !!u && u.alive);
    if (!units.length) return this.disband(q);
    const [cx, cy] = this.centroid(units);
    let dest: Settlement | null = toRegion !== undefined ? w.settlements[toRegion] : null;
    if (!dest) {
      let bd = Infinity;
      for (const s of this.owned()) {
        const d = Math.hypot(s.px - cx, s.py - cy);
        if (d < bd) {
          bd = d;
          dest = s;
        }
      }
    }
    if (q.kind !== 'defend') this.failed.set(q.target, w.time + 90 + this.w.rng.next() * 60);
    q.state = 'retreat';
    q.lastOrder = w.time;
    if (dest) w.orderMove(units.map((u) => u.id), dest.px, dest.py + 24, { attackMove: false });
  }

  centroid(units: Unit[]): [number, number] {
    let x = 0;
    let y = 0;
    for (const u of units) {
      x += u.x;
      y += u.y;
    }
    return [x / units.length, y / units.length];
  }

  // ------------------------------------------------------------------ squads
  private updateSquads() {
    const w = this.w;
    for (const q of [...this.squads]) {
      const units = [...q.units].map((id) => w.unitById.get(id)).filter((u): u is Unit => !!u && u.alive);
      q.units = new Set(units.map((u) => u.id));
      if (!units.length) {
        this.disband(q);
        continue;
      }
      const s = w.settlements[q.target];
      const ids = units.map((u) => u.id);
      const [cx, cy] = this.centroid(units);
      const myPow = this.power(units);
      // local enemy strength
      let enemyPow = 0;
      w.unitHash.query(cx, cy, 9 * TILE, (o) => {
        if (o.alive && o.def.special !== 'worker' && w.isHostile(this.id, o.faction) && (o.seenBy & (1 << this.id))) enemyPow += o.def.power * (0.4 + 0.6 * (o.hp / o.maxHp));
      });
      w.buildingHash.query(cx, cy, 9 * TILE, (b) => {
        if (!b.destroyed && b.active && b.def.defence && w.isHostile(this.id, b.faction)) enemyPow += b.def.id === 'capital_castle' ? 8 : 2.5;
      });
      const distT = Math.hypot(cx - s.px, cy - s.py);
      if (distT < q.bestDist - 2 * TILE) {
        q.bestDist = distT;
        q.lastProgress = w.time;
      }
      switch (q.state) {
        case 'retreat': {
          const all = units.every((u) => u.arrived || u.routing > 0);
          if (all || w.time - q.lastOrder > 40) this.disband(q);
          continue;
        }
        case 'hold': {
          if (w.time > q.holdUntil) this.disband(q);
          continue;
        }
        default:
          break;
      }
      // success / irrelevance
      if (q.kind !== 'defend' && q.kind !== 'raid' && s.owner === this.id) {
        q.state = 'hold';
        q.holdUntil = w.time + 15;
        continue;
      }
      if (q.kind === 'attack' && s.owner !== NEUTRAL && !w.diplomacy.atWar(this.id, s.owner)) {
        this.retreat(q);
        continue;
      }
      if (q.kind === 'defend') {
        if (s.owner !== this.id || (this.intel.threatAt(s.id) < 1 && w.time - s.lastAttackedT > 10 && w.time - q.started > 12)) {
          this.disband(q);
          continue;
        }
      }
      // retreat if outmatched (not when defending the capital)
      const ratio = myPow / Math.max(0.1, enemyPow);
      const mustHold = q.kind === 'defend' && s.isCapital;
      const sieging = q.state === 'siege';
      if (!mustHold && enemyPow > 3 && ratio < this.pers.retreatRatio * (0.8 + this.diff.micro * 0.4) * (sieging ? 0.6 : 1)) {
        this.retreat(q);
        continue;
      }
      if (w.time - q.lastProgress > 120 && q.kind !== 'defend') {
        this.retreat(q);
        continue;
      }
      // gather stragglers before marching far
      if (q.state === 'gather') {
        let spread = 0;
        for (const u of units) spread = Math.max(spread, Math.hypot(u.x - cx, u.y - cy));
        if (spread > 7 * TILE && w.time - q.started < 25) {
          if (w.time - q.lastOrder > 6) {
            w.orderMove(ids, cx, cy, { attackMove: true });
            q.lastOrder = w.time;
          }
          continue;
        }
        q.state = 'move';
        q.lastOrder = -99;
      }
      // breach: once near a fortified target, hammer the core
      const core = w.buildingById.get(s.coreId);
      const needsBreach = s.owner !== this.id && core && !core.breached && (s.isCapital || (s.breachFrac > 0 && core.hp > core.maxHp * s.breachFrac));
      if (needsBreach && distT < 11 * TILE && q.kind !== 'raid') {
        if (w.time - q.lastOrder > 5) {
          const siegeAndMelee = units.filter((u) => !u.isRanged || u.def.tags.includes('siege'));
          const ranged = units.filter((u) => u.isRanged && !u.def.tags.includes('siege'));
          // fight defenders first if any are near
          if (enemyPow > myPow * 0.35) w.orderMove(ids, s.px, s.py, { attackMove: true });
          else {
            if (siegeAndMelee.length) w.orderAttack(siegeAndMelee.map((u) => u.id), core!.id);
            // archers keep defenders off the engines
            if (ranged.length) w.orderMove(ranged.map((u) => u.id), (s.px + cx) / 2, (s.py + cy) / 2, { attackMove: true });
          }
          q.lastOrder = w.time;
          q.state = 'siege';
        }
        continue;
      }
      if (q.kind === 'raid') {
        // hit workers/production buildings, avoid fights
        if (w.time - q.lastOrder > 6) {
          const prod = w.buildings.filter((b) => b.settlementId === s.id && b.active && b.def.produces && w.isHostile(this.id, b.faction));
          const tgt = prod[Math.floor(this.w.rng.next() * prod.length)];
          if (tgt) w.orderMove(ids, tgt.doorX, tgt.doorY + 8, { attackMove: true });
          else this.disband(q);
          q.lastOrder = w.time;
        }
        if (w.time - q.started > 70) this.retreat(q);
        continue;
      }
      // march / re-issue attack-move to the capture point periodically
      const idleCount = units.filter((u) => u.arrived && !u.targetId).length;
      if (w.time - q.lastOrder > 10 || (idleCount > units.length / 2 && w.time - q.lastOrder > 3)) {
        const formation = units.length > 8 ? 'line' : 'loose';
        // final approach: stand on the capture square
        w.orderMove(ids, s.px, s.py + 4, { attackMove: true, formation });
        q.lastOrder = w.time;
      }
    }
  }

  private manageCommander() {
    const w = this.w;
    const c = this.f.commanderId ? w.unitById.get(this.f.commanderId) : undefined;
    if (!c || !c.alive) return;
    if (c.hp < c.maxHp * 0.35 && c.order.kind !== 'move') {
      const cap = this.capital();
      for (const q of this.squads) if (q.units.has(c.id)) q.units.delete(c.id);
      if (cap) w.orderMove([c.id], cap.px, cap.py + 20, { attackMove: false });
      return;
    }
    // follow the strongest field squad, otherwise wait at muster
    if (!this.squads.some((q) => q.units.has(c.id))) {
      const q = this.squads.filter((s) => s.kind === 'attack' || s.kind === 'defend').sort((a, b) => b.units.size - a.units.size)[0];
      if (q && c.hp > c.maxHp * 0.6) {
        q.units.add(c.id);
        c.squad = q.id;
      } else if (this.musterRegion >= 0 && c.arrived) {
        const m = w.settlements[this.musterRegion];
        if (Math.hypot(c.x - m.px, c.y - m.py) > 8 * TILE) w.orderMove([c.id], m.px, m.py + 34, { attackMove: true });
      }
    }
  }

  // ------------------------------------------------------------------ diplomacy
  private diplomacy() {
    const w = this.w;
    const minT = 125 - this.aggression * 50;
    if (w.time < minT) return;
    const wars = [0, 1, 2, 3].filter((k) => k !== this.id && w.factions[k]?.alive && w.diplomacy.stance(this.id, k as FactionId) === 'war');
    const myPow = this.intel.power[this.id];
    // leader detection
    let leader = -1;
    for (let k = 0; k < 4; k++) if (w.factions[k]?.alive && w.factions[k].territoryShare > 0.38 && (leader < 0 || w.factions[k].territoryShare > w.factions[leader].territoryShare)) leader = k;
    for (let k = 0; k < 4; k++) {
      if (k === this.id) continue;
      const other = w.factions[k];
      if (!other?.alive) continue;
      const st = w.diplomacy.stance(this.id, k as FactionId);
      if (st === 'war' || st === 'ceasefire') continue;
      const bordering = w.diplomacy.bordering(this.id, k as FactionId);
      const near = bordering || this.owned().some((s) => w.settlements.some((o) => o.owner === k && w.graph.h(s.id, o.id) <= 2));
      if (!near) continue;
      const theirPow = Math.max(1, this.intel.power[k]);
      let score = 0;
      score += bordering ? 22 : 8;
      score += Math.max(-30, Math.min(40, (myPow / theirPow - 1) * 30));
      score += this.f.grudge[k] * 0.5;
      score += k === leader ? 35 : 0;
      score += ((w.time - minT) / 60) * 5;
      score -= wars.length * 36;
      score += st === 'hostile' ? 10 : 0;
      score *= 0.6 + this.aggression * 0.8;
      if (other.isPlayer) score *= this.diff.playerBias;
      if (wars.length >= 2 && k !== leader) continue;
      if (score > 52) {
        w.diplomacy.declareWar(this.id, k as FactionId, 'ai');
        return;
      }
    }
    // overstretched: seek peace with a strong enemy to finish a weak one
    const mainTargets = new Set(this.squads.filter((q) => q.kind === 'attack').map((q) => q.targetFaction));
    if (wars.length >= 2 && !wars.every((k) => mainTargets.has(k as FactionId))) {
      const enemyPow = wars.reduce((a, k) => a + this.intel.power[k], 0);
      if (myPow < enemyPow * 0.75) {
        const strongest = wars.filter((k) => !mainTargets.has(k as FactionId)).sort((a, b) => this.intel.power[b] - this.intel.power[a])[0];
        if (strongest === undefined) return;
        const other = w.factions[strongest];
        if (other.isPlayer) {
          if (this.w.rng.next() < 0.3) w.diplomacy.offerCeasefire(this.id, wars.find((k) => k !== strongest) as FactionId, 180);
        } else {
          const theirWars = [0, 1, 2, 3].filter((k) => k !== strongest && w.factions[k]?.alive && w.diplomacy.stance(strongest as FactionId, k as FactionId) === 'war').length;
          if (theirWars >= 2 || this.w.rng.next() < 0.3) w.diplomacy.ceasefire(this.id, strongest as FactionId, 150 + this.w.rng.next() * 90);
        }
        return;
      }
    }
    // ceasefire: stretched on several fronts while someone runs away with the valley
    if (leader >= 0 && leader !== this.id) {
      for (const k of wars) {
        if (k === leader) continue;
        const other = w.factions[k];
        if (other.isPlayer) {
          if (this.w.rng.next() < 0.35 && w.time > 360) w.diplomacy.offerCeasefire(this.id, leader as FactionId, 180);
        } else {
          const theirAI = (w.ai as { controllers?: Map<number, AIController> } | null)?.controllers?.get(k);
          if (theirAI && this.w.rng.next() < 0.5) w.diplomacy.ceasefire(this.id, k as FactionId, 180);
        }
      }
    }
  }

  // ------------------------------------------------------------------ scouting
  private scout() {
    const w = this.w;
    this.scoutT -= this.diff.thinkInterval;
    if (this.scoutT > 0) return;
    this.scoutT = 20;
    const scouts = this.myUnits().filter((u) => u.def.id === 'scout' && !this.squads.some((q) => q.units.has(u.id)));
    const exp = w.vis.explored[this.id];
    for (const sc of scouts) {
      if (!sc.arrived) continue;
      // nearest unexplored region centre
      let best = null;
      let bd = Infinity;
      for (const s of w.settlements) {
        const i = Math.floor(s.cy / TILE) * w.map.w + Math.floor(s.cx / TILE);
        if (exp[i]) continue;
        const d = Math.hypot(s.cx - sc.x, s.cy - sc.y) + this.w.rng.next() * 80;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best) w.orderMove([sc.id], best.cx + 30, best.cy + 30, { attackMove: false });
    }
  }

  private updateDebug() {
    const d = this.debug;
    d.army = this.myUnits().length;
    d.power = Math.round(this.intel.power[this.id]);
    d.threat = {};
    for (let k = 0; k < 4; k++) {
      if (k === this.id || !this.w.factions[k]) continue;
      let t = 0;
      for (const s of this.owned()) t += this.intel.regionThreat[k][s.id];
      d.threat[this.w.factions[k].name] = Math.round(t * 10) / 10;
    }
    d.wars = [0, 1, 2, 3].filter((k) => k !== this.id && this.w.factions[k] && this.w.diplomacy.stance(this.id, k as FactionId) === 'war').map((k) => this.w.factions[k].name);
    d.squads = this.squads.map((q) => `${q.kind}→${this.w.settlements[q.target].name} [${q.units.size}] ${q.state}`);
  }
}

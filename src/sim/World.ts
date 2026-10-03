import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { NEUTRAL, SIM_DT, TILE, type FactionId, type Resources } from '../data/constants';
import type { Difficulty, FactionSetup } from '../data/factions';
import { CROWNSHIRE, type MapDef } from '../data/map_crownshire';
import { UNITS } from '../data/units';
import { Faction } from './Faction';
import type { SimEvents } from './events';
import type { GameMap } from './map/GameMap';
import { generateMap } from './map/MapGen';
import { Pathfinder } from './map/Pathfinder';
import { SpatialHash } from './SpatialHash';
import { computeSlots, type FormationKind } from './units/Formation';
import { Movement } from './units/Movement';
import { Unit } from './units/Unit';

export interface MatchSetup {
  seed: number;
  map?: MapDef;
  difficulty: Difficulty;
  factions: FactionSetup[];
  /** player's kingdom id (or -1 for spectator / headless AI-only) */
  player: FactionId | -1;
  tutorial?: boolean;
  startRes?: Resources;
}

export const START_RES: Resources = { gold: 300, wood: 250, food: 220, stone: 100 };

/**
 * The whole simulation. Pure logic: no DOM, no Phaser. Runs headless in Node for AI testing.
 * Render/UI layers read its state and subscribe to `events`.
 */
export class World {
  readonly setup: MatchSetup;
  readonly map: GameMap;
  readonly mapDef: MapDef;
  readonly rng: Random;
  readonly events = new EventBus<SimEvents>();
  readonly pathfinder: Pathfinder;
  readonly unitHash: SpatialHash<Unit>;
  readonly movement: Movement;
  readonly factions: Faction[] = [];
  units: Unit[] = [];
  readonly unitById = new Map<number, Unit>();
  /** sim time in seconds */
  time = 0;
  tick = 0;
  private nextId = 1;
  private nextGroup = 1;
  /** units waiting on a path, processed with a per-tick budget */
  private pathQueue: Unit[] = [];
  /** dead units linger briefly for the renderer */
  corpses: Unit[] = [];
  over = false;
  winner: FactionId | -1 = -1;

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.mapDef = setup.map ?? CROWNSHIRE;
    this.rng = new Random(setup.seed);
    this.map = generateMap(this.mapDef, setup.seed);
    this.pathfinder = new Pathfinder(this.map);
    this.unitHash = new SpatialHash<Unit>(this.map.w * TILE, this.map.h * TILE, 32);
    this.movement = new Movement(this);
    const startRes = setup.startRes ?? START_RES;
    for (const fs of setup.factions) this.factions[fs.id] = new Faction(fs, startRes);
    // neutral faction (bandits, rebels, garrisons)
    this.factions[NEUTRAL] = new Faction(
      {
        id: NEUTRAL,
        name: 'Free Folk',
        house: 'Free Folk',
        commanderName: '',
        commanderTitle: '',
        color: 'neutral',
        crest: 'tower',
        isPlayer: false,
        personality: 'balanced',
      },
      { gold: 0, wood: 0, food: 0, stone: 0 },
    );
    for (const f of this.factions) {
      if (!f) continue;
      f.stance = [];
      f.ceasefireT = [];
      f.grudge = [];
      for (let k = 0; k <= NEUTRAL; k++) {
        f.stance[k] = k === NEUTRAL || f.id === NEUTRAL ? 'war' : 'neutral';
        f.ceasefireT[k] = 0;
        f.grudge[k] = 0;
      }
    }
  }

  /** region info for a kingdom's capital (by current settlement or the starting slot) */
  capitalRegion(f: FactionId) {
    return this.map.regions.find((r) => r.capitalSlot === f) ?? null;
  }

  /** initial placement: starting armies, commanders, neutral garrisons */
  initMatch() {
    for (const f of this.factions) {
      if (!f || f.id === NEUTRAL) continue;
      const r = this.capitalRegion(f.id);
      if (!r) continue;
      const x = r.px * TILE;
      const y = r.py * TILE + 24;
      const cmd = this.spawnUnit('commander', f.id, x, y + 10);
      f.commanderId = cmd.id;
      for (let k = 0; k < 4; k++) this.spawnUnit('militia', f.id, x - 20 + k * 12, y);
      this.spawnUnit('scout', f.id, x + 30, y + 6);
      this.spawnUnit('archer', f.id, x - 30, y + 6);
    }
    for (const r of this.map.regions) {
      if (!r.def.garrison) continue;
      let k = 0;
      for (const [type, n] of r.def.garrison) {
        for (let j = 0; j < n; j++) {
          const a = (k++ / 6) * Math.PI * 2;
          const u = this.spawnUnit(type, NEUTRAL, r.px * TILE + Math.cos(a) * 18, r.py * TILE + Math.sin(a) * 14);
          u.leash = 7 * TILE;
          u.stance = 'defensive';
        }
      }
    }
  }

  get player(): Faction | null {
    return this.setup.player >= 0 ? this.factions[this.setup.player] : null;
  }

  newId() {
    return this.nextId++;
  }

  // ------------------------------------------------------------------ units
  spawnUnit(type: string, faction: FactionId, x: number, y: number, fromBuilding?: number): Unit {
    const def = UNITS[type];
    if (!def) throw new Error('unknown unit ' + type);
    const u = new Unit(this.newId(), def, faction, x, y);
    u.born = this.time;
    // place on a passable tile
    const pf = this.pathfinder;
    const ti = Math.floor(y / TILE) * this.map.w + Math.floor(x / TILE);
    if (!pf.passable(ti, faction)) {
      const ni = pf.nearestPassable(Math.floor(x / TILE), Math.floor(y / TILE), faction, 10);
      if (ni >= 0) {
        u.x = u.px = (ni % this.map.w) * TILE + 8;
        u.y = u.py = Math.floor(ni / this.map.w) * TILE + 8;
      }
    }
    u.homeX = u.x;
    u.homeY = u.y;
    u.destX = u.x;
    u.destY = u.y;
    this.units.push(u);
    this.unitById.set(u.id, u);
    this.events.emit('unitSpawned', { id: u.id, x: u.x, y: u.y, faction, type, fromBuilding });
    return u;
  }

  removeDead() {
    let w = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.alive) this.units[w++] = u;
      else {
        this.unitById.delete(u.id);
        this.corpses.push(u);
      }
    }
    this.units.length = w;
    // corpses fade after a while
    if (this.corpses.length) this.corpses = this.corpses.filter((c) => this.time - c.deathT < 12);
  }

  // ------------------------------------------------------------------ orders
  /** Move a set of units in formation. */
  orderMove(ids: number[], x: number, y: number, opts: { attackMove?: boolean; formation?: FormationKind; queueFlee?: boolean } = {}) {
    const units = ids.map((id) => this.unitById.get(id)).filter((u): u is Unit => !!u && u.alive);
    if (!units.length) return;
    const byFaction = new Map<FactionId, Unit[]>();
    for (const u of units) {
      let arr = byFaction.get(u.faction);
      if (!arr) byFaction.set(u.faction, (arr = []));
      arr.push(u);
    }
    for (const [faction, list] of byFaction) {
      const group = this.nextGroup++;
      const slots = computeSlots(list, x, y, opts.formation ?? 'line', this.pathfinder, faction, group);
      for (const u of list) {
        const s = slots.get(u.id) ?? { x, y };
        u.order = { kind: 'move', x, y, attackMove: !!opts.attackMove };
        u.targetId = 0;
        u.routing = 0;
        this.setDestination(u, s.x, s.y, group);
      }
    }
  }

  orderAttack(ids: number[], targetId: number) {
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (!u || !u.alive) continue;
      u.order = { kind: 'attack', targetId };
      u.targetId = targetId;
      u.retargetT = 0;
    }
  }

  orderHold(ids: number[]) {
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (!u || !u.alive) continue;
      u.order = { kind: 'hold', x: u.x, y: u.y };
      u.path = null;
      u.arrived = true;
      u.targetId = 0;
    }
  }

  orderStop(ids: number[]) {
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (!u || !u.alive) continue;
      u.order = { kind: 'idle' };
      u.path = null;
      u.arrived = true;
      u.targetId = 0;
    }
  }

  /** set a movement destination; path is resolved via the queue */
  setDestination(u: Unit, x: number, y: number, group = 0) {
    u.destX = x;
    u.destY = y;
    u.groupId = group;
    u.arrived = false;
    u.pathFails = 0;
    u.stuckT = 0;
    u.progX = u.x;
    u.progY = u.y;
    // short hops with clear line of sight need no A*
    if (Math.hypot(x - u.x, y - u.y) < 160 && this.pathfinder.losWorld(u.x, u.y, x, y, u.faction)) {
      u.path = [x, y];
      u.pathIdx = 0;
      u.needPath = false;
      return;
    }
    if (!u.needPath) this.pathQueue.push(u);
    u.needPath = true;
  }

  private groupPaths = new Map<number, { pts: number[]; t: number }>();

  private processPaths() {
    const t0 = performance.now();
    const budgetMs = 4;
    let processed = 0;
    // re-queue units flagged by movement (stuck)
    for (const u of this.units) if (u.needPath && !this.pathQueue.includes(u) && u.alive) this.pathQueue.push(u);
    while (this.pathQueue.length && (processed < 6 || performance.now() - t0 < budgetMs)) {
      const u = this.pathQueue.shift()!;
      if (!u.alive || !u.needPath) continue;
      processed++;
      u.needPath = false;
      // group sharing: reuse the corridor of a group-mate when this unit can see its start
      const gp = u.groupId && u.pathFails === 0 ? this.groupPaths.get(u.groupId) : undefined;
      if (gp && gp.pts.length >= 2) {
        const pts = gp.pts;
        // find furthest of the first few waypoints in LOS
        let join = -1;
        for (let k = Math.min(pts.length / 2 - 1, 4); k >= 0; k--) {
          if (Math.hypot(pts[k * 2] - u.x, pts[k * 2 + 1] - u.y) < 220 && this.pathfinder.losWorld(u.x, u.y, pts[k * 2], pts[k * 2 + 1], u.faction)) {
            join = k;
            break;
          }
        }
        if (join >= 0) {
          const path = pts.slice(join * 2);
          // final leg to own slot
          const lx = path[path.length - 2];
          const ly = path[path.length - 1];
          if (this.pathfinder.losWorld(lx, ly, u.destX, u.destY, u.faction) || Math.hypot(lx - u.destX, ly - u.destY) < 20) {
            path[path.length - 2] = u.destX;
            path[path.length - 1] = u.destY;
          } else path.push(u.destX, u.destY);
          u.path = path;
          u.pathIdx = 0;
          continue;
        }
      }
      const res = this.pathfinder.find(u.x, u.y, u.destX, u.destY, u.faction);
      if (!res) {
        u.path = null;
        u.arrived = true;
        continue;
      }
      u.path = res.pts;
      u.pathIdx = 0;
      if (u.groupId) this.groupPaths.set(u.groupId, { pts: res.pts, t: this.time });
    }
    if (this.tick % 90 === 0) for (const [k, v] of this.groupPaths) if (this.time - v.t > 20) this.groupPaths.delete(k);
  }

  // ------------------------------------------------------------------ main loop
  step(dt = SIM_DT) {
    if (this.over) return;
    this.time += dt;
    this.tick++;
    // spatial hash
    this.unitHash.clear();
    for (const u of this.units) if (u.alive) this.unitHash.insert(u);
    this.processPaths();
    this.movement.update(dt);
    for (const u of this.units) {
      u.animT += dt;
      if (u.hitFlash > 0) u.hitFlash -= dt;
    }
    this.removeDead();
  }

  /** helper used by systems/tests: is (x,y) a passable world point for faction */
  isPassable(x: number, y: number, faction: number) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
    return this.pathfinder.passable(ty * this.map.w + tx, faction);
  }
}

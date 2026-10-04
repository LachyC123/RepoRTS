import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { NEUTRAL, SIM_DT, TILE, type FactionId, type Resources } from '../data/constants';
import type { Difficulty, FactionSetup } from '../data/factions';
import { CROWNSHIRE, type MapDef } from '../data/map_crownshire';
import { UNITS } from '../data/units';
import { setEra, type Era } from '../data/era';
import { Faction } from './Faction';
import type { Notice, SimEvents } from './events';
import type { Building } from './buildings/Building';
import { SettlementSystem } from './Settlements';
import type { Settlement } from './territory/Settlement';
import { CaptureSystem } from './territory/Capture';
import { CombatSystem } from './units/Combat';
import { MoraleSystem } from './units/Morale';
import { EconomySystem } from './economy/Economy';
import { WorkerSystem } from './economy/Workers';
import { Visibility } from './fog/Visibility';
import { Diplomacy } from './Diplomacy';
import { VictorySystem } from './Victory';
import { WallSystem } from './Walls';
import { UPGRADES } from '../data/upgrades';
import type { UnitDef } from '../data/units';
import type { Deposit } from './map/GameMap';
import type { GameMap } from './map/GameMap';
import { generateMap } from './map/MapGen';
import { Pathfinder } from './map/Pathfinder';
import { RegionGraph } from './map/RegionGraph';
import { SpatialHash } from './SpatialHash';
import { computeSlots, type FormationKind } from './units/Formation';
import { Movement } from './units/Movement';
import { Unit } from './units/Unit';
import { LivingSystem } from './units/Living';
import { SupportSystem } from './units/Support';
import { SocialSystem } from './units/Social';
import { Happenings } from './events/Happenings';
import { Sky } from './Sky';
import { SuperweaponSystem } from './Superweapon';
import { LeaderSystem } from './ai/Leaders';
import type { DoctrineId } from '../data/doctrines';

export interface MatchSetup {
  seed: number;
  map?: MapDef;
  difficulty: Difficulty;
  factions: FactionSetup[];
  /** player's kingdom id (or -1 for spectator / headless AI-only) */
  player: FactionId | -1;
  tutorial?: boolean;
  startRes?: Resources;
  /** medieval (default) or modern: re-dresses units, buildings and art */
  era?: Era;
  /** named soldiers with personalities, wounds and rescues */
  living?: boolean;
  /** the player's soldiers act on their own unless given direct orders */
  autoArmies?: boolean;
  /** no domination or elimination victory: play as long as you like */
  sandbox?: boolean;
  /** the player's own realm is run by its leader (build, train, fight, diplomacy) */
  realmAuto?: boolean;
  /** the player's founding leader's doctrine */
  doctrine?: DoctrineId | 'random';
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
  readonly settlementSys: SettlementSystem;
  readonly walls: WallSystem;
  readonly combat: CombatSystem;
  readonly morale: MoraleSystem;
  readonly capture: CaptureSystem;
  readonly economy: EconomySystem;
  readonly workers: WorkerSystem;
  readonly vis: Visibility;
  readonly diplomacy: Diplomacy;
  readonly victory: VictorySystem;
  /** named soldiers, wounds and rescues, quirks (null when living soldiers are off) */
  readonly living: LivingSystem | null;
  /** who runs each realm, their moods and their running commentary */
  readonly leaders: LeaderSystem;
  /** medics, musicians and fires */
  readonly support: SupportSystem;
  /** friendships, rivalries, grief, parties and campfires */
  readonly social: SocialSystem;
  /** geese, stray dogs, lost patrols, letters from home */
  readonly happenings: Happenings;
  /** time of day and weather */
  readonly sky: Sky;
  /** missile silos / great bombards and their strikes */
  readonly superweapons: SuperweaponSystem;
  readonly buildingHash: SpatialHash<Building>;
  readonly graph: RegionGraph;
  private buildingHashCount = -1;
  private buildingHashVersion = -1;
  settlements: Settlement[] = [];
  buildings: Building[] = [];
  readonly buildingById = new Map<number, Building>();
  /** temporary economic modifiers from world events (expiry time per faction) */
  mods = { harvest: [0, 0, 0, 0, 0], fair: [0, 0, 0, 0, 0] };
  regrowth: { i: number; t: number }[] = [];
  endReason: 'domination' | 'elimination' | 'defeat' | '' = '';
  /** commander positions per faction this tick (aura checks) */
  private cmdPos: ({ x: number; y: number } | null)[] = [null, null, null, null, null];
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
    // the era re-dresses the shared data tables before anything reads them
    setEra(setup.era ?? 'medieval');
    this.setup = setup;
    this.mapDef = setup.map ?? CROWNSHIRE;
    this.rng = new Random(setup.seed);
    this.map = generateMap(this.mapDef, setup.seed);
    this.pathfinder = new Pathfinder(this.map);
    this.unitHash = new SpatialHash<Unit>(this.map.w * TILE, this.map.h * TILE, 32);
    this.movement = new Movement(this);
    this.buildingHash = new SpatialHash<Building>(this.map.w * TILE, this.map.h * TILE, 64);
    this.graph = new RegionGraph(this.map);
    this.walls = new WallSystem(this);
    this.settlementSys = new SettlementSystem(this);
    this.combat = new CombatSystem(this);
    this.morale = new MoraleSystem(this);
    this.capture = new CaptureSystem(this);
    this.economy = new EconomySystem(this);
    this.workers = new WorkerSystem(this);
    this.vis = new Visibility(this);
    this.diplomacy = new Diplomacy(this);
    this.victory = new VictorySystem(this);
    this.living = setup.living ? new LivingSystem(this) : null;
    this.leaders = new LeaderSystem(this);
    this.support = new SupportSystem(this);
    this.social = new SocialSystem(this);
    this.happenings = new Happenings(this);
    this.sky = new Sky(this);
    this.superweapons = new SuperweaponSystem(this);
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
    this.settlementSys.init();
    this.leaders.init();
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
  spawnUnit(type: string, faction: FactionId, x: number, y: number, fromBuilding?: number, reuseId?: number): Unit {
    const def = UNITS[type];
    if (!def) throw new Error('unknown unit ' + type);
    const u = new Unit(reuseId ?? this.newId(), def, faction, x, y);
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
    this.living?.onSpawn(u);
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
        if (!(u as Unit & { despawned?: boolean }).despawned) this.corpses.push(u);
      }
    }
    this.units.length = w;
    // corpses fade after a while
    if (this.corpses.length) this.corpses = this.corpses.filter((c) => c.downed > 0 || this.time - c.deathT < 12);
  }

  // ------------------------------------------------------------------ orders
  /**
   * The player commands these soldiers directly: they stop thinking for themselves until they have
   * finished and stood idle a while (or, on hold, until handed back).
   */
  takeCommand(ids: number[]) {
    let spoke = false;
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (!u || !u.alive) continue;
      u.auto = false;
      u.manualT = this.time;
      u.squad = 0;
      this.living?.commanded(u);
      if (!spoke && u.persona && this.rng.next() < 0.5) {
        spoke = true;
        this.living?.speak(u, 'order');
      }
    }
  }

  /** hand soldiers back to their own judgement */
  releaseCommand(ids: number[]) {
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (!u || !u.alive || u.def.special === 'worker') continue;
      u.auto = true;
      if (u.order.kind === 'hold') u.order = { kind: 'idle' };
    }
  }

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
        if (Math.abs(s.x - u.x) > 4 && u.windup <= 0) u.facing = s.x > u.x ? 1 : -1;
        u.order = { kind: 'move', x, y, attackMove: !!opts.attackMove };
        u.targetId = 0;
        u.routing = 0;
        this.setDestination(u, s.x, s.y, group);
      }
    }
  }

  orderAttack(ids: number[], targetId: number) {
    const tgt = this.unitById.get(targetId) ?? this.buildingById.get(targetId);
    const first = ids.length ? this.unitById.get(ids[0]) : undefined;
    if (tgt && first && tgt.faction !== first.faction && !this.isHostile(first.faction, tgt.faction)) this.diplomacy.declareWar(first.faction, tgt.faction, 'attack');
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
      let res = this.pathfinder.find(u.x, u.y, u.destX, u.destY, u.faction);
      if (res && !res.complete && u.def.special !== 'worker' && this.wallsAround(u.destX, u.destY, u.faction)) {
        // the goal is sealed behind hostile walls: path to the wall and batter through it
        const br = this.pathfinder.find(u.x, u.y, u.destX, u.destY, u.faction, { breach: true });
        if (br && br.blockers && br.blockers.length) {
          const wallId = this.map.occ[br.blockers[0]];
          const wb = this.buildingById.get(wallId);
          if (wb && !wb.destroyed && this.isHostile(u.faction, wb.faction)) {
            res = br;
            if (u.order.kind !== 'attack' || !this.buildingById.get((u.order as { targetId: number }).targetId)?.isGate) {
              u.targetId = wb.id;
              u.retargetT = 3;
            }
          }
        }
      }
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
    // spatial indices
    this.unitHash.clear();
    for (const u of this.units) if (u.alive) this.unitHash.insert(u);
    if (this.buildings.length !== this.buildingHashCount || this.map.version !== this.buildingHashVersion) {
      this.buildingHash.clear();
      for (const b of this.buildings) if (!b.destroyed) this.buildingHash.insert(b);
      this.buildingHashCount = this.buildings.length;
      this.buildingHashVersion = this.map.version;
    }
    for (let f = 0; f <= NEUTRAL; f++) {
      const fac = this.factions[f];
      const c = fac?.commanderId ? this.unitById.get(fac.commanderId) : undefined;
      this.cmdPos[f] = c && c.alive ? { x: c.x, y: c.y } : null;
    }
    if (this.tick % 8 === 1) this.vis.update();
    this.ai?.update(dt);
    this.processPaths();
    this.combat.update(dt);
    this.morale.update(dt);
    this.movement.update(dt);
    this.settlementSys.update(dt);
    this.economy.update(dt);
    this.workers.update(dt);
    this.capture.update(dt);
    this.diplomacy.update(dt);
    this.events2?.update(dt);
    this.victory.update(dt);
    this.living?.update(dt);
    this.leaders.update(dt);
    this.support.update(dt);
    this.social.update(dt);
    this.happenings.update(dt);
    this.sky.update();
    this.superweapons.update(dt);
    for (const u of this.units) {
      u.animT += dt;
      if (u.hitFlash > 0) u.hitFlash -= dt;
      if (u.blockT > 0) u.blockT -= dt;
      if (u.cheerT > 0) {
        u.cheerT -= dt;
        if (u.cheerT <= 0 && u.anim === 'cheer') u.anim = 'idle';
      }
    }
    if (this.tick % 30 === 0) this.regrow();
    this.removeDead();
  }

  /** optional AI controller and world events hook (set by game setup) */
  ai: { update(dt: number): void } | null = null;
  events2: { update(dt: number): void } | null = null;

  // ------------------------------------------------------------------ helpers used by systems
  isHostile(a: FactionId, b: FactionId) {
    return this.diplomacy.isHostile(a, b);
  }

  unitDef(type: string): UnitDef {
    return UNITS[type];
  }

  inspired(u: Unit) {
    const c = this.cmdPos[u.faction];
    return !!c && Math.abs(c.x - u.x) < 6 * TILE && Math.abs(c.y - u.y) < 6 * TILE;
  }

  notify(n: Notice) {
    this.events.emit('notice', n);
  }

  private alertT = new Map<number, number>();
  /** one of a kingdom's settlements is threatened: raise the alarm (rate limited) */
  alertAttack(s: Settlement) {
    const last = this.alertT.get(s.id) ?? -999;
    if (this.time - last < 40) return;
    this.alertT.set(s.id, this.time);
    if (s.owner === this.setup.player) this.notify({ kind: 'attack', text: `⚔ ${s.name.toUpperCase()} UNDER ATTACK`, factions: [s.owner], x: s.cx, y: s.cy, priority: 2, alarm: true, regionId: s.id });
  }

  /** a player's building is being hit (rate limited per settlement) */
  alertBuilding(b: Building) {
    const key = 100000 + b.settlementId;
    const last = this.alertT.get(key) ?? -999;
    if (this.time - last < 35) return;
    this.alertT.set(key, this.time);
    const s = this.settlements[b.settlementId];
    const what = b.def.category === 'core' ? s.name.toUpperCase() : `${b.def.name.toUpperCase()} AT ${s.name.toUpperCase()}`;
    this.notify({ kind: 'attack', text: `🔥 ${what} UNDER ATTACK`, factions: [b.faction], x: b.x, y: b.y, priority: 2, alarm: true, regionId: s.id });
  }

  despawn(u: Unit) {
    if (!u.alive) return;
    u.alive = false;
    (u as Unit & { despawned?: boolean }).despawned = true;
    u.deathT = this.time;
  }

  depleteDeposit(d: Deposit) {
    d.amount = 0;
    const m = this.map;
    const tx = Math.floor(d.x / TILE) - 1;
    const ty = Math.floor(d.y / TILE) - 1;
    for (let y = ty; y < ty + 2; y++) for (let x = tx; x < tx + 2; x++) if (m.ore[y * m.w + x] !== 3) m.ore[y * m.w + x] = 0;
    m.version++;
    m.deposits = m.deposits.filter((o) => o !== d);
    this.events.emit('worldEvent', { kind: 'depleted', x: d.x, y: d.y, regionId: d.regionId });
    const s = this.settlements[d.regionId];
    this.notify({ kind: 'economy', text: '⛏ GOLD VEIN DEPLETED', sub: s?.name, factions: s ? [s.owner] : [], x: d.x, y: d.y, priority: 1, world: true });
  }

  applyUpgrades(f: FactionId) {
    for (const u of this.units) if (u.alive && u.faction === f) this.applyUpgradesToUnit(u);
  }

  applyUpgradesToUnit(u: Unit) {
    const fac = this.factions[u.faction];
    if (!fac) return;
    let atk = 0;
    const arm = { melee: 0, pierce: 0 };
    let rng = 0;
    let hpMul = 1;
    let spd = 1;
    for (const id of fac.upgrades) {
      const e = UPGRADES[id]?.effect;
      if (!e) continue;
      const has = (tags: string[]) => tags.some((t) => u.def.tags.includes(t as never));
      if (e.attack && has(e.attack.tags)) atk += e.attack.add;
      if (e.armor && has(e.armor.tags)) {
        arm.melee += e.armor.melee;
        arm.pierce += e.armor.pierce;
      }
      if (e.range && has(e.range.tags)) rng += e.range.add;
      if (e.hp && has(e.hp.tags)) hpMul *= e.hp.mult;
      if (e.speed && has(e.speed.tags)) spd *= e.speed.mult;
    }
    if (u.def.special === 'worker') return;
    u.atkBonus = atk;
    u.armorBonus = arm;
    u.rangeBonus = rng;
    u.speedMul = spd;
    const newMax = u.def.hp * hpMul;
    if (newMax !== u.maxHp) {
      u.hp = (u.hp / u.maxHp) * newMax;
      u.maxHp = newMax;
    }
  }

  onCapitalDestroyed(s: Settlement, by: FactionId) {
    this.victory.onCapitalDestroyed(s, by);
  }

  onCommanderDeath(u: Unit, by: FactionId | -1) {
    this.victory.onCommanderDeath(u, by);
  }

  private regrow() {
    const m = this.map;
    const keep = [];
    for (const r of this.regrowth) {
      if (r.t > this.time) {
        keep.push(r);
        continue;
      }
      if (m.occ[r.i] || m.terrain[r.i] === 8) continue;
      let blocked = false;
      this.unitHash.query((r.i % m.w) * TILE + 8, Math.floor(r.i / m.w) * TILE + 8, 12, () => {
        blocked = true;
        return true;
      });
      if (blocked) {
        r.t = this.time + 30;
        keep.push(r);
        continue;
      }
      m.tree[r.i] = 1 + Math.floor(this.rng.next() * 3);
      m.treeHp[r.i] = 60;
      m.stump[r.i] = 0;
      m.version++;
      this.events.emit('treeGrown', { x: (r.i % m.w) * TILE + 8, y: Math.floor(r.i / m.w) * TILE + 8, i: r.i });
    }
    this.regrowth = keep;
  }

  /** is there a hostile fortified settlement around this point? */
  wallsAround(x: number, y: number, faction: FactionId) {
    const r = this.map.region[Math.floor(y / TILE) * this.map.w + Math.floor(x / TILE)];
    const s = this.settlements[r];
    return !!s && s.wallIds.length > 0 && s.owner !== faction;
  }

  /** helper used by systems/tests: is (x,y) a passable world point for faction */
  isPassable(x: number, y: number, faction: number) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
    return this.pathfinder.passable(ty * this.map.w + tx, faction);
  }
}

import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import type { AttackType, ProjectileKind, UnitTag } from '../../data/units';
import type { Building } from '../buildings/Building';
import type { World } from '../World';
import type { Unit } from './Unit';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  faction: FactionId;
  shooterId: number;
  fromBuilding: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  arc: number;
  targetId: number;
  willHit: boolean;
  attack: number;
  attackType: AttackType;
  bonus?: Partial<Record<UnitTag, number>>;
  armorPen: number;
  splash: number;
  buildingsOnly: boolean;
}

export interface FireSpec {
  kind: ProjectileKind;
  faction: FactionId;
  shooterId: number;
  fromBuilding?: number;
  x: number;
  y: number;
  target: Unit | Building;
  attack: number;
  attackType: AttackType;
  accuracy: number;
  bonus?: Partial<Record<UnitTag, number>>;
  armorPen: number;
  splash: number;
  buildingsOnly?: boolean;
}

const SPEED: Record<ProjectileKind, number> = { arrow: 230, bolt: 330, rock: 130, bigrock: 120, ballista: 300, bullet: 620, rocket: 210, grenade: 150, shell: 150, tankshell: 520 };
const ARC: Record<ProjectileKind, number> = { arrow: 0.22, bolt: 0.06, rock: 0.4, bigrock: 0.5, ballista: 0.05, bullet: 0.01, rocket: 0.04, grenade: 0.35, shell: 0.55, tankshell: 0.02 };

function isUnit(t: Unit | Building): t is Unit {
  return (t as Unit).def !== undefined && (t as Unit).radius !== undefined;
}

/**
 * Targeting, engagement movement, attack wind-ups, melee hits, projectiles, splash, counters,
 * cavalry charges, shield blocks and deaths.
 */
export class CombatSystem {
  projectiles: Projectile[] = [];
  private tmp: Unit[] = [];

  constructor(private w: World) {}

  /** resolve a target id to a live unit or building */
  target(id: number): Unit | Building | null {
    if (!id) return null;
    const u = this.w.unitById.get(id);
    if (u) return u.alive ? u : null;
    const b = this.w.buildingById.get(id);
    if (b && !b.destroyed && !(b.breached && b.def.category === 'core' && !this.w.settlements[b.settlementId].isCapital)) return b;
    if (b && !b.destroyed && b.breached && b.def.category !== 'core') return b;
    return null;
  }

  private distTo(u: Unit, t: Unit | Building): number {
    if (isUnit(t)) return Math.hypot(u.x - t.x, u.y - t.y) - u.radius - t.radius;
    return t.edgeDist(u.x, u.y) - u.radius;
  }

  private canSee(u: Unit, t: Unit | Building) {
    if (u.faction === NEUTRAL) return true;
    return (t.seenBy & (1 << u.faction)) !== 0;
  }

  update(dt: number) {
    const w = this.w;
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker') continue;
      if (u.attackCd > 0) u.attackCd -= dt;
      u.retargetT -= dt;
      if (u.anim === 'attack') {
        u.animT += 0; // animT advanced in world step
        if (u.animT > 0.4) u.anim = 'idle';
      }
      if (u.routing > 0) continue;
      // wind-up resolves into a strike
      if (u.windup > 0) {
        u.windup -= dt;
        if (u.windup <= 0) this.strike(u);
        continue;
      }
      let tgt = this.target(u.targetId);
      const order = u.order;
      const explicit = order.kind === 'attack';
      if (explicit) {
        const ot = this.target(order.targetId);
        const wallTgt = tgt && !isUnit(tgt) && (tgt.def.id === 'wall' || tgt.def.id === 'gatehouse') && tgt.id !== order.targetId;
        if (!ot) {
          // explicit target died: fall back to aggressive idle around here
          u.order = { kind: 'idle' };
          u.homeX = u.x;
          u.homeY = u.y;
          u.targetId = 0;
          tgt = null;
        } else if (!wallTgt) tgt = ot;
      }
      if (tgt && !explicit && !w.isHostile(u.faction, tgt.faction)) tgt = null;
      // pure move: ignore enemies until arrival
      const pureMove = order.kind === 'move' && !order.attackMove && !u.arrived;
      if (pureMove) {
        u.targetId = 0;
        continue;
      }
      // drop auto targets that wandered off / out of sight
      if (tgt && !explicit) {
        const d = this.distTo(u, tgt);
        const leash = u.leash || (order.kind === 'hold' ? u.range + 4 : 12 * TILE);
        const fromHome = Math.hypot(u.x - u.homeX, u.y - u.homeY);
        if (d > u.def.vision * TILE * 1.3 || (order.kind !== 'move' && fromHome > leash) || !this.canSee(u, tgt)) tgt = null;
      }
      const breaching = tgt && !isUnit(tgt) && (tgt.def.id === 'wall' || tgt.def.id === 'gatehouse');
      if ((!tgt || (u.retargetT <= 0 && !explicit && !breaching)) && u.retargetT <= 0) {
        u.retargetT = 0.35 + (u.id % 7) * 0.03;
        const found = this.acquire(u, tgt);
        if (found) tgt = found;
      }
      const newId = tgt ? (tgt as { id: number }).id : 0;
      if (newId && !u.targetId && isUnit(tgt!)) w.events.emit('unitEngaged', { id: u.id, x: u.x, y: u.y, faction: u.faction, tx: tgt!.x, ty: tgt!.y });
      u.targetId = newId;
      if (!tgt) {
        this.idleBehaviour(u);
        continue;
      }
      this.engage(u, tgt, dt);
    }
    this.updateProjectiles(dt);
  }

  /** what an untargeted unit does: resume attack-move, return to leash anchor */
  private idleBehaviour(u: Unit) {
    const w = this.w;
    const o = u.order;
    if (u.def.deploy && u.deploy > 0) u.deployWant = 0;
    if (o.kind === 'move') {
      if (u.arrived) {
        u.order = { kind: 'idle' };
        u.homeX = u.x;
        u.homeY = u.y;
      } else if (!u.path && !u.needPath) {
        w.setDestination(u, u.destX, u.destY, u.groupId);
      }
      return;
    }
    if (o.kind === 'idle' || o.kind === 'hold') {
      const ax = o.kind === 'hold' ? o.x : u.homeX;
      const ay = o.kind === 'hold' ? o.y : u.homeY;
      const d = Math.hypot(u.x - ax, u.y - ay);
      if (d > (u.leash ? 20 : 28) && u.arrived && !u.needPath) w.setDestination(u, ax, ay, 0);
    }
  }

  private acquire(u: Unit, current: Unit | Building | null): Unit | Building | null {
    const w = this.w;
    const o = u.order;
    const def = u.def;
    if (o.kind === 'attack') return current;
    let range: number;
    if (o.kind === 'hold') range = u.range + 6;
    else if (o.kind === 'move' && o.attackMove) range = def.vision * TILE;
    else range = Math.min(def.vision * TILE, Math.max(u.range + 24, 6 * TILE));
    if (u.leash) range = Math.min(range, 6 * TILE);
    let best: Unit | Building | null = null;
    let bs = Infinity;
    if (!def.buildingsOnly) {
      w.unitHash.query(u.x, u.y, range, (e, d2) => {
        if (!e.alive || e.faction === u.faction || !w.isHostile(u.faction, e.faction)) return;
        if (e.routing > 0 && def.tags.includes('siege')) return;
        if (!this.canSee(u, e)) return;
        let s = Math.sqrt(d2);
        if (e.targetId === u.id) s *= 0.6;
        if (e.def.special === 'worker') s *= def.bonus?.worker ? 0.5 : 2.2;
        if (def.bonus) {
          for (const t of e.def.tags) if ((def.bonus[t] ?? 1) > 1.2) {
            s *= 0.7;
            break;
          }
        }
        if (def.minRange && s < def.minRange) return;
        if (current && e === current) s *= 0.85; // stickiness
        if (s < bs) {
          bs = s;
          best = e;
        }
      });
    }
    // buildings: siege always, others when attack-moving or already near
    const wantBuildings = def.buildingsOnly || def.tags.includes('siege') || (o.kind === 'move' && o.attackMove) || u.squad > 0;
    if (wantBuildings && (!best || def.tags.includes('siege'))) {
      const br = def.buildingsOnly ? Math.max(range, u.range + 40) : Math.min(range, u.range + 3 * TILE);
      w.buildingHash.query(u.x, u.y, br + 40, (b) => {
        if (b.destroyed || b.faction === u.faction || !w.isHostile(u.faction, b.faction)) return;
        if (b.def.category === 'landmark' || b.def.id === 'merc_camp') return;
        if (b.breached && b.def.category === 'core' && !w.settlements[b.settlementId].isCapital) return;
        if (b.breached && b.def.category === 'core' && b.hp <= 0) return;
        const d = b.edgeDist(u.x, u.y);
        if (d > br) return;
        if (def.minRange && d < def.minRange) return;
        let s = d + (def.tags.includes('siege') ? 0 : 60);
        // defensive structures and gates first, then cores
        if (b.def.defence) s *= 0.7;
        if (b.isGate) s *= def.look.engine === 'ram' || def.buildingsOnly ? 0.4 : 0.8;
        if (b.def.id === 'wall') s *= 1.4;
        if (s < bs) {
          bs = s;
          best = b;
        }
      });
    }
    return best;
  }

  private engage(u: Unit, t: Unit | Building, dt: number) {
    const w = this.w;
    const d = this.distTo(u, t);
    const reach = u.isRanged ? u.range : u.range + 2;
    if (d <= reach) {
      if (u.def.minRange && d < u.def.minRange - 8) {
        // too close for a catapult: back off a little
        const ax = u.x - (t.x - u.x);
        const ay = u.y - (t.y - u.y);
        if (u.arrived) w.setDestination(u, ax, ay, 0);
        return;
      }
      // stop and fight
      if (!u.arrived || u.path) {
        u.path = null;
        u.arrived = true;
      }
      u.facing = t.x >= u.x ? 1 : -1;
      if (u.def.deploy) {
        u.deployWant = 1;
        if (u.deploy < 1) {
          u.deploy = Math.min(1, u.deploy + dt / u.def.deploy);
          return;
        }
      }
      if (u.attackCd <= 0) {
        u.windup = u.def.windup;
        // vary the animation: archers loft long shots, crossbows kneel when holding, melee alternates
        const wc = u.def.look.weapon;
        if (wc === 'bow' || wc === 'longbow') u.atkVar = d > u.range * 0.55 ? 1 : 0;
        else if (wc === 'crossbow') u.atkVar = u.order.kind === 'hold' ? 1 : 0;
        else if (wc === 'rifle' || wc === 'sniper' || wc === 'mg' || wc === 'rocket') u.atkVar = u.order.kind === 'hold' || d > u.range * 0.7 ? 1 : 0;
        else u.atkVar = (u.swings + u.id) & 1;
        u.swings++;
        w.events.emit('unitAttack', { id: u.id, x: u.x, y: u.y, type: u.def.id, targetX: t.x, targetY: t.y });
      }
      return;
    }
    if (u.order.kind === 'hold') {
      u.targetId = 0;
      return;
    }
    // chase
    if (u.def.deploy && u.deploy > 0) {
      u.deployWant = 0;
      u.deploy = Math.max(0, u.deploy - dt / u.def.deploy);
      return;
    }
    let tx: number;
    let ty: number;
    if (isUnit(t)) {
      tx = t.x;
      ty = t.y;
      if (!u.isRanged && d > 2) {
        // aim for a spot on the target's rim, fanned out per attacker, so a crowd wraps
        // around its enemy instead of piling onto the same point
        const a = Math.atan2(u.y - t.y, u.x - t.x) + ((u.id % 5) - 2) * 0.32;
        const rr = t.radius + u.radius + 1;
        tx += Math.cos(a) * rr;
        ty += Math.sin(a) * rr;
      }
    } else {
      [tx, ty] = t.closestPoint(u.x, u.y);
      // aim slightly outside the wall
      const dx = u.x - tx;
      const dy = u.y - ty;
      const l = Math.hypot(dx, dy) || 1;
      tx += (dx / l) * (u.radius + 2);
      ty += (dy / l) * (u.radius + 2);
    }
    if (u.isRanged) {
      // stand off at range
      const dx = u.x - tx;
      const dy = u.y - ty;
      const l = Math.hypot(dx, dy) || 1;
      const want = Math.max(0, u.range * 0.85);
      tx += (dx / l) * want;
      ty += (dy / l) * want;
    }
    const moved = Math.hypot(tx - u.destX, ty - u.destY);
    if ((u.arrived && !u.needPath) || moved > 20 || (!u.path && !u.needPath)) {
      if (Math.hypot(tx - u.x, ty - u.y) < 150 && w.pathfinder.losWorld(u.x, u.y, tx, ty, u.faction)) {
        u.destX = tx;
        u.destY = ty;
        u.path = [tx, ty];
        u.pathIdx = 0;
        u.arrived = false;
      } else if (moved > 20 || u.arrived) {
        w.setDestination(u, tx, ty, 0);
      }
    }
  }

  /** the moment of impact */
  private strike(u: Unit) {
    const w = this.w;
    const t = this.target(u.targetId);
    u.anim = 'attack';
    u.animT = 0;
    const aura = w.inspired(u) ? 0.9 : 1;
    u.attackCd = u.def.cooldown * aura;
    if (!t) return;
    const def = u.def;
    if (def.projectile) {
      this.fireProjectile({
        kind: def.projectile,
        faction: u.faction,
        shooterId: u.id,
        x: u.x + u.facing * 4,
        y: u.y - (def.look.body === 'engine' ? 10 : 8),
        target: t,
        attack: (def.attack + u.atkBonus) * u.quirkAtk,
        attackType: def.attackType,
        accuracy: def.accuracy ?? 0.8,
        bonus: def.bonus,
        armorPen: def.armorPen ?? 0,
        splash: def.splash ?? 0,
        buildingsOnly: def.buildingsOnly,
      });
      return;
    }
    const d = this.distTo(u, t);
    if (d > u.range + 6) return;
    let mult = 1;
    let charge = false;
    if (def.charge && u.chargeRun > 3 * TILE) {
      charge = true;
      mult *= def.charge;
      u.chargeRun = 0;
    }
    if (isUnit(t)) {
      // braced spears negate the charge and punish it
      if (charge && t.def.tags.includes('spear') && t.windup <= 0) {
        mult /= def.charge!;
        charge = false;
      }
      this.damageUnit(t, (def.attack + u.atkBonus) * u.quirkAtk, def.attackType, def.bonus, def.armorPen ?? 0, mult, u.faction, u.x, u.y, u, charge);
      if (charge) {
        w.events.emit('charge', { id: u.id, x: t.x, y: t.y });
        t.morale -= 6;
      }
    } else {
      this.damageBuilding(t, (def.attack + u.atkBonus) * u.quirkAtk, def.attackType, mult, u.faction);
    }
  }

  damageUnit(
    t: Unit,
    attack: number,
    type: AttackType,
    bonus: Partial<Record<UnitTag, number>> | undefined,
    pen: number,
    mult: number,
    faction: FactionId,
    fromX: number,
    fromY: number,
    attacker: Unit | null,
    heavy = false,
  ) {
    const w = this.w;
    if (!t.alive) return;
    let m = mult;
    if (bonus) {
      let best = 1;
      for (const tag of t.def.tags) best = Math.max(best, bonus[tag] ?? 1);
      m *= best;
    }
    const armorBase = type === 'siege' ? Math.floor(t.def.armor.pierce * 0.3) : type === 'pierce' ? t.def.armor.pierce + t.armorBonus.pierce : t.def.armor.melee + t.armorBonus.melee;
    const armor = Math.max(0, armorBase - pen);
    let dmg = Math.max(1, attack * m - armor) * (0.88 + w.rng.next() * 0.24);
    let blocked = false;
    // shield block vs missiles from the front
    if (type === 'pierce' && t.def.look.shield !== 'none') {
      const chance = t.def.look.shield === 'tower' || t.def.look.shield === 'riot' ? 0.45 : t.def.look.shield === 'kite' ? 0.25 : t.def.look.shield === 'round' ? 0.18 : 0.06;
      const facingShot = (fromX - t.x) * t.facing > 0 || t.arrived;
      if (facingShot && w.rng.next() < chance) {
        dmg *= 0.2;
        blocked = true;
        t.blockT = 0.35;
      }
    }
    if (t.def.special === 'worker' && faction !== NEUTRAL) dmg *= 1.2;
    t.hp -= dmg;
    t.hitFlash = 0.12;
    t.lastHitT = w.time;
    if (attacker) t.lastAttackerId = attacker.id;
    // knockback
    const dx = t.x - fromX;
    const dy = t.y - fromY;
    const l = Math.hypot(dx, dy) || 1;
    const kb = (heavy ? 1.6 : type === 'siege' ? 2 : type === 'melee' ? 0.35 : 0.15) / Math.max(1, t.radius / 4);
    if (!t.def.tags.includes('siege')) {
      t.knockX += (dx / l) * kb;
      t.knockY += (dy / l) * kb;
    }
    // retaliation: idle units fight back
    if (attacker && !t.targetId && t.order.kind !== 'move' && w.isHostile(t.faction, attacker.faction)) {
      t.targetId = attacker.id;
      t.retargetT = 0.6;
    }
    w.events.emit('unitHit', { id: t.id, x: t.x, y: t.y, dmg, kind: type, blocked, fromX, fromY, heavy, by: attacker ? attacker.def.id : '' });
    if (t.hp <= 0 && !w.living?.shrugOff(t)) this.kill(t, faction, attacker, dmg);
  }

  damageBuilding(b: Building, attack: number, type: AttackType, mult: number, faction: FactionId) {
    const w = this.w;
    const arm = b.def.armor[type];
    const dmg = Math.max(type === 'siege' ? 1 : 0.2, attack * mult * arm);
    w.settlementSys.damage(b, dmg, faction);
    w.events.emit('buildingHit', { id: b.id, x: b.x, y: b.y, dmg, siege: type === 'siege' });
  }

  kill(t: Unit, killerFaction: FactionId | -1, killer: Unit | null, dmg = 0) {
    const w = this.w;
    if (!t.alive) return;
    t.alive = false;
    t.hp = 0;
    t.deathT = w.time;
    t.path = null;
    if (killer) killer.kills++;
    w.living?.onFall(t, killer, dmg);
    const vf = w.factions[t.faction];
    if (t.def.special !== 'worker') {
      vf.stats.unitsLost++;
      if (killerFaction >= 0 && killerFaction !== NEUTRAL) w.factions[killerFaction].stats.unitsKilled++;
      vf.pop -= t.def.pop;
      // morale ripple
      w.unitHash.query(t.x, t.y, 5 * TILE, (o) => {
        if (o.alive && o.faction === t.faction) o.morale -= 3.5;
      });
    }
    w.events.emit('unitDied', { id: t.id, x: t.x, y: t.y, faction: t.faction, type: t.def.id, killerFaction: killerFaction as FactionId | -1 });
    if (t.def.special === 'commander') w.onCommanderDeath(t, killerFaction);
  }

  // ------------------------------------------------------------------ projectiles
  fireProjectile(s: FireSpec) {
    const w = this.w;
    let tx = s.target.x;
    let ty = s.target.y;
    const tu = isUnit(s.target) ? s.target : null;
    if (tu) ty -= 4;
    const dist0 = Math.hypot(tx - s.x, ty - s.y);
    const dur = Math.max(0.18, dist0 / SPEED[s.kind]);
    if (tu) {
      // lead the target
      tx += tu.vx * dur * 0.8;
      ty += tu.vy * dur * 0.8;
    } else {
      const b = s.target as Building;
      tx = b.x + (w.rng.next() - 0.5) * b.size * 10;
      ty = b.y + (w.rng.next() - 0.5) * b.size * 8;
    }
    let acc = s.accuracy;
    if (tu) {
      const spd = Math.hypot(tu.vx, tu.vy);
      acc -= Math.min(0.35, spd / 140);
      if (tu.def.tags.includes('cavalry')) acc -= 0.05;
      if (tu.def.look.engine) acc += 0.15;
    } else acc = 1;
    const willHit = w.rng.next() < acc;
    if (!willHit) {
      const a = w.rng.next() * Math.PI * 2;
      const r = 6 + w.rng.next() * 12;
      tx += Math.cos(a) * r;
      ty += Math.sin(a) * r * 0.7;
    }
    const p: Projectile = {
      id: w.newId(),
      kind: s.kind,
      faction: s.faction,
      shooterId: s.shooterId,
      fromBuilding: s.fromBuilding ?? 0,
      x0: s.x,
      y0: s.y,
      x1: tx,
      y1: ty,
      t: 0,
      dur,
      arc: ARC[s.kind] * dist0,
      targetId: (s.target as { id: number }).id,
      willHit,
      attack: s.attack,
      attackType: s.attackType,
      bonus: s.bonus,
      armorPen: s.armorPen,
      splash: s.splash,
      buildingsOnly: !!s.buildingsOnly,
    };
    this.projectiles.push(p);
    w.events.emit('projectileFired', { id: p.id, kind: p.kind, x: p.x0, y: p.y0, tx, ty, faction: p.faction });
  }

  private updateProjectiles(dt: number) {
    const w = this.w;
    let k = 0;
    for (const p of this.projectiles) {
      p.t += dt;
      if (p.t < p.dur) {
        this.projectiles[k++] = p;
        continue;
      }
      this.land(p);
    }
    this.projectiles.length = k;
    void w;
  }

  private land(p: Projectile) {
    const w = this.w;
    const shooter = p.shooterId ? w.unitById.get(p.shooterId) ?? null : null;
    let hit = false;
    if (p.splash > 0) {
      // area damage
      const r = p.splash;
      if (!p.buildingsOnly) {
        this.tmp.length = 0;
        w.unitHash.within(p.x1, p.y1, r + 6, this.tmp);
        for (const u of this.tmp) {
          if (!u.alive || !w.isHostile(p.faction, u.faction)) continue;
          const d = Math.hypot(u.x - p.x1, u.y - p.y1);
          if (d > r + u.radius) continue;
          const fall = 1 - Math.min(1, d / (r + u.radius)) * 0.6;
          this.damageUnit(u, p.attack * 0.6, p.attackType, p.bonus, p.armorPen, fall, p.faction, p.x1, p.y1, shooter, true);
          hit = true;
        }
      }
      w.buildingHash.query(p.x1, p.y1, r + 40, (b) => {
        if (b.destroyed || !w.isHostile(p.faction, b.faction)) return;
        if (b.edgeDist(p.x1, p.y1) > r * 0.6) return;
        this.damageBuilding(b, p.attack, p.attackType, 1, p.faction);
        hit = true;
      });
    } else {
      const t = this.target(p.targetId);
      if (t && p.willHit) {
        if (isUnit(t)) {
          if (Math.hypot(t.x - p.x1, t.y - 4 - p.y1) < 14 + t.radius) {
            this.damageUnit(t, p.attack, p.attackType, p.bonus, p.armorPen, 1, p.faction, p.x0, p.y0, shooter);
            hit = true;
          }
        } else if (t.edgeDist(p.x1, p.y1) < 10) {
          this.damageBuilding(t, p.attack, p.attackType, 1, p.faction);
          hit = true;
        }
      }
      if (!hit && !p.buildingsOnly) {
        // stray shot can still strike someone standing there
        let victim: Unit | null = null;
        w.unitHash.query(p.x1, p.y1 + 4, 6, (u) => {
          if (!victim && u.alive && w.isHostile(p.faction, u.faction)) victim = u;
        });
        if (victim && w.rng.next() < 0.5) {
          this.damageUnit(victim, p.attack, p.attackType, p.bonus, p.armorPen, 1, p.faction, p.x0, p.y0, shooter);
          hit = true;
        }
      }
    }
    w.events.emit('projectileLanded', { id: p.id, kind: p.kind, x: p.x1, y: p.y1, hit, splash: p.splash });
  }
}

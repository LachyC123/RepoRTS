import type { FactionId } from '../../data/constants';
import type { UnitDef } from '../../data/units';

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number; attackMove: boolean }
  | { kind: 'attack'; targetId: number }
  | { kind: 'hold'; x: number; y: number }
  | { kind: 'flee'; x: number; y: number };

export type Anim = 'idle' | 'walk' | 'attack' | 'die' | 'work' | 'cheer';

export class Unit {
  readonly id: number;
  readonly def: UnitDef;
  faction: FactionId;
  x: number;
  y: number;
  /** previous-tick position for render interpolation */
  px: number;
  py: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  hp: number;
  maxHp: number;
  morale = 100;
  radius: number;

  order: Order = { kind: 'idle' };
  /** formation slot destination for current move (world px) */
  destX = 0;
  destY = 0;
  path: number[] | null = null;
  pathIdx = 0;
  needPath = false;
  pathFails = 0;
  stuckT = 0;
  progX = 0;
  progY = 0;
  arrived = true;
  /** group move id: units sharing it share a path request */
  groupId = 0;

  targetId = 0;
  attackCd = 0;
  windup = 0;
  retargetT = 0;
  /** running distance at speed — fuels cavalry charges */
  chargeRun = 0;
  lastHitT = -99;
  lastAttackerId = 0;
  kills = 0;

  anim: Anim = 'idle';
  animT = 0;
  hitFlash = 0;
  knockX = 0;
  knockY = 0;
  /** dying → dead; corpse lingers for the renderer */
  alive = true;
  deathT = 0;
  routing = 0;
  cheerT = 0;

  /** player control group (0 = none) */
  army = 0;
  /** AI squad id */
  squad = 0;
  /** neutral garrison leash */
  homeX: number;
  homeY: number;
  leash = 0;
  /** trebuchet deploy state 0 packed .. 1 deployed */
  deploy = 0;
  deployWant = 0;
  /** bitmask of kingdoms that currently see this unit */
  seenBy = 0;
  /** mercenary/upgrade derived stats */
  atkBonus = 0;
  armorBonus = { melee: 0, pierce: 0 };
  rangeBonus = 0;
  speedMul = 1;
  /** time this unit was spawned (sim seconds) */
  born = 0;
  /** stance: aggressive units chase, defensive return home */
  stance: 'aggressive' | 'defensive' = 'aggressive';

  constructor(id: number, def: UnitDef, faction: FactionId, x: number, y: number) {
    this.id = id;
    this.def = def;
    this.faction = faction;
    this.x = this.px = x;
    this.y = this.py = y;
    this.hp = this.maxHp = def.hp;
    this.radius = def.radius;
    this.homeX = x;
    this.homeY = y;
  }

  get range() {
    return this.def.range + this.rangeBonus;
  }

  get isRanged() {
    return !!this.def.projectile;
  }

  get speed() {
    return this.def.speed * this.speedMul * (this.routing > 0 ? 1.25 : 1) * (this.hp < this.maxHp * 0.35 ? 0.88 : 1);
  }
}

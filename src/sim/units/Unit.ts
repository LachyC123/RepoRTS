import type { Persona } from './Persona';
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
  /** which attack animation the current swing uses (0 = A, 1 = B) */
  atkVar = 0;
  swings = 0;
  /** shield raised against a blocked missile (seconds left) */
  blockT = 0;
  hitFlash = 0;
  knockX = 0;
  knockY = 0;
  /** dying → dead; corpse lingers for the renderer */
  alive = true;
  deathT = 0;
  routing = 0;
  cheerT = 0;
  /** living soldiers: who this is (name, rank, trait, mood state) */
  persona: Persona | null = null;
  /** downed and bleeding: seconds left before they die where they lie (corpses only) */
  downed = 0;
  /** the friend coming to drag this soldier out (corpses only) */
  rescuer = 0;
  /** quirk/rank multipliers (berserk, tired, promotions) */
  quirkAtk = 1;
  /** on fire: seconds left, and who lit it */
  burnT = 0;
  burnBy: FactionId | -1 = -1;
  /** who struck the blow that put this soldier down */
  killerId = 0;
  quirkSpeed = 1;
  /** autonomy: true = acts on its own; false = following the player's direct order */
  auto = true;
  /** time of the player's last direct order */
  manualT = -999;
  /** autopilot task this unit belongs to (0 = free) */
  task = 0;

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
    return this.def.speed * this.speedMul * this.quirkSpeed * (this.routing > 0 ? 1.25 : 1) * (this.hp < this.maxHp * 0.35 ? 0.88 : 1);
  }
}

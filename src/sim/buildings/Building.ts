import { TILE, type FactionId } from '../../data/constants';
import type { BuildingDef } from '../../data/buildings';

export interface TrainJob {
  type: string;
  t: number;
  total: number;
}

export class Building {
  readonly id: number;
  def: BuildingDef;
  faction: FactionId;
  readonly settlementId: number;
  /** top-left tile */
  readonly tx: number;
  readonly ty: number;
  readonly size: number;
  hp: number;
  maxHp: number;
  /** construction progress 0..1 */
  progress = 1;
  queue: TrainJob[] = [];
  research: { id: string; t: number; total: number } | null = null;
  rallyX = 0;
  rallyY = 0;
  hasRally = false;
  attackCd = 0;
  /** mine: which deposit it works */
  depositKind: 'gold' | 'stone' | null = null;
  plotIndex = -1;
  /** core HP reached 0 (cores can't be removed, only breached) */
  breached = false;
  /** destroyed plot buildings leave rubble for a while */
  destroyed = false;
  destroyedT = 0;
  lastHitT = -99;
  lastAttacker: FactionId | -1 = -1;
  seenBy = 0;
  /** staffing fraction 0..1 set by worker system */
  staffed = 1;
  /** fields painted by a farm (tile indices) */
  fields: number[] = [];
  /** wall: which settlement ring it belongs to; gates are passable for owner */
  isGate = false;
  /** production efficiency multiplier (forest density etc.) */
  efficiency = 1;

  constructor(id: number, def: BuildingDef, faction: FactionId, settlementId: number, tx: number, ty: number, size: number) {
    this.id = id;
    this.def = def;
    this.faction = faction;
    this.settlementId = settlementId;
    this.tx = tx;
    this.ty = ty;
    this.size = size;
    this.hp = this.maxHp = def.hp;
  }

  /** world centre */
  get x() {
    return (this.tx + this.size / 2) * TILE;
  }
  get y() {
    return (this.ty + this.size / 2) * TILE;
  }
  /** door point on the south edge */
  get doorX() {
    return (this.tx + this.size / 2) * TILE;
  }
  get doorY() {
    return (this.ty + this.size) * TILE + 6;
  }

  get built() {
    return this.progress >= 1 && !this.destroyed;
  }

  get active() {
    return this.built && !this.breached;
  }

  /** distance from point to building rect edge (world px) */
  edgeDist(px: number, py: number) {
    const x0 = this.tx * TILE;
    const y0 = this.ty * TILE;
    const x1 = x0 + this.size * TILE;
    const y1 = y0 + this.size * TILE;
    const dx = Math.max(x0 - px, 0, px - x1);
    const dy = Math.max(y0 - py, 0, py - y1);
    return Math.hypot(dx, dy);
  }

  /** closest point on rect to (px,py) */
  closestPoint(px: number, py: number): [number, number] {
    const x0 = this.tx * TILE;
    const y0 = this.ty * TILE;
    return [Math.max(x0, Math.min(px, x0 + this.size * TILE)), Math.max(y0, Math.min(py, y0 + this.size * TILE))];
  }
}

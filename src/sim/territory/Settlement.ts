import { TILE, type FactionId } from '../../data/constants';
import { CAPITAL_TIERS, TIERS } from '../../data/settlements';
import type { PlotDef, RegionInfo } from '../map/GameMap';

export interface PlotState {
  def: PlotDef;
  buildingId: number;
}

/** One settlement (or landmark site) per region. Owns the region's capture point and plots. */
export class Settlement {
  readonly id: number;
  readonly region: RegionInfo;
  owner: FactionId;
  tier: number;
  isCapital: boolean;
  /** this was a kingdom's starting capital (for flavour / AI) */
  readonly originalCapitalOf: number | null;
  coreId = 0;
  plots: PlotState[];
  /** capture state */
  capFaction: FactionId | -1 = -1;
  capProgress = 0;
  contested = false;
  /** blocked from capture because the core must be breached first */
  needsBreach = false;
  upgrading: { to: number; t: number; total: number } | null = null;
  fortify = 0;
  fortifying: { level: number; t: number; total: number } | null = null;
  wallIds: number[] = [];
  lastAttackedT = -99;
  lastAlertT = -99;
  /** decorative cottages (tile indices) that grow with tier */
  cottages: number[] = [];
  /** time of last ownership change */
  capturedT = -99;
  /** units present per faction this tick (capture system) */
  presence: number[] = [0, 0, 0, 0, 0];
  /** villagers fleeing etc. for renderer */
  threat = 0;

  constructor(region: RegionInfo, owner: FactionId) {
    this.id = region.id;
    this.region = region;
    this.owner = owner;
    this.tier = region.capitalSlot !== null ? 3 : region.tier;
    this.isCapital = region.capitalSlot !== null;
    this.originalCapitalOf = region.capitalSlot;
    this.plots = region.plots.map((p) => ({ def: p, buildingId: 0 }));
  }

  get name() {
    return this.region.name;
  }
  /** capture point (world px) */
  get px() {
    return this.region.px * TILE;
  }
  get py() {
    return this.region.py * TILE;
  }
  /** settlement centre (core building centre) */
  get cx() {
    return (this.region.cx + 0.5) * TILE;
  }
  get cy() {
    return (this.region.cy + 0.5) * TILE;
  }

  get tierName() {
    if (this.isCapital) return CAPITAL_TIERS[this.tier]?.name ?? 'Capital';
    return TIERS[this.tier].name;
  }

  get unlockedPlots() {
    if (this.isCapital) return Math.min(this.plots.length, CAPITAL_TIERS[this.tier]?.plots ?? 7);
    return Math.min(this.plots.length, TIERS[this.tier].plots);
  }

  get popCap() {
    if (this.isCapital) return CAPITAL_TIERS[this.tier]?.popCap ?? 16;
    return TIERS[this.tier].popCap;
  }

  get tax() {
    if (this.isCapital) return CAPITAL_TIERS[this.tier]?.tax ?? { gold: 16, food: 10 };
    return TIERS[this.tier].tax;
  }

  get captureTime() {
    return TIERS[Math.min(4, this.tier)].captureTime * (this.isCapital ? 1.3 : 1);
  }

  get breachFrac() {
    if (this.isCapital) return 0; // capital castles must fall
    return TIERS[this.tier].breach;
  }

  get canUpgrade() {
    if (this.isCapital) return this.tier < 4;
    return this.tier >= 2 && this.tier < 4;
  }
}

import type { Leader } from './ai/Leaders';
import { emptyRes, type FactionId, type Resources } from '../data/constants';
import { KINGDOM_COLORS, NEUTRAL_COLOR, PERSONALITIES, type FactionSetup, type KingdomColor, type Personality } from '../data/factions';

export type Stance = 'neutral' | 'hostile' | 'war' | 'ceasefire';

export interface FactionStats {
  unitsTrained: number;
  unitsLost: number;
  unitsKilled: number;
  regionsCaptured: number;
  regionsLost: number;
  buildingsBuilt: number;
  largestArmy: number;
  goldEarned: number;
  resourcesEarned: number;
  enemiesDefeated: number;
  peakTerritory: number;
  /** territory share sampled every 10s for the end-screen graph */
  history: number[];
}

export class Faction {
  readonly id: FactionId;
  readonly setup: FactionSetup;
  readonly color: KingdomColor;
  readonly personality: Personality;
  res: Resources;
  /** per-minute income, recomputed by the economy system */
  income: Resources = emptyRes();
  /** fractional accumulators */
  popCap = 0;
  pop = 0;
  alive = true;
  /** capital lost; seconds until promotion of a new capital */
  critical = 0;
  capitalSettlement = -1;
  commanderId = 0;
  commanderRespawn = 0;
  upgrades = new Set<string>();
  /** relation per other faction */
  stance: Stance[] = [];
  ceasefireT: number[] = [];
  /** grievance / aggression memory per faction (AI) */
  grudge: number[] = [];
  stats: FactionStats = {
    unitsTrained: 0,
    unitsLost: 0,
    unitsKilled: 0,
    regionsCaptured: 0,
    regionsLost: 0,
    buildingsBuilt: 0,
    largestArmy: 0,
    goldEarned: 0,
    resourcesEarned: 0,
    enemiesDefeated: 0,
    peakTerritory: 0,
    history: [],
  };
  regionsOwned = 0;
  territoryShare = 0;
  eliminatedAt = -1;
  /** whoever is in command right now */
  leader: Leader | null = null;
  /** recent losses by the class of the unit that killed them (decays): what keeps beating us */
  lossesBy: Record<string, number> = { melee: 0, ranged: 0, cavalry: 0, siege: 0 };
  /** the lesson the leader last drew from them */
  lesson = '';

  constructor(setup: FactionSetup, startRes: Resources) {
    this.id = setup.id;
    this.setup = setup;
    this.color = KINGDOM_COLORS.find((c) => c.id === setup.color) ?? NEUTRAL_COLOR;
    this.personality = PERSONALITIES[setup.personality];
    this.res = { ...startRes };
  }

  get name() {
    return this.setup.name;
  }
  get isPlayer() {
    return this.setup.isPlayer;
  }
  get isNeutral() {
    return this.id === 4;
  }
}

import type { Cost } from './constants';

export interface TierDef {
  tier: number;
  name: string;
  core: string;
  plots: number;
  popCap: number;
  /** passive income per minute */
  tax: { gold: number; food: number };
  /** capture time (seconds) for a single unit */
  captureTime: number;
  /** minimum core HP fraction before capture is possible (0 = no breach required) */
  breach: number;
  upgradeCost?: Cost;
  upgradeTime?: number;
  vision: number;
  /** wall ring radius in tiles if fortified */
  wallRadius: number;
}

export const TIERS: TierDef[] = [
  { tier: 0, name: 'Landmark', core: 'landmark', plots: 1, popCap: 0, tax: { gold: 0, food: 0 }, captureTime: 10, breach: 0, vision: 6, wallRadius: 0 },
  { tier: 1, name: 'Outpost', core: 'outpost_tower', plots: 1, popCap: 3, tax: { gold: 7, food: 0 }, captureTime: 12, breach: 0, vision: 11, wallRadius: 0 },
  {
    tier: 2,
    name: 'Village',
    core: 'village_hall',
    plots: 4,
    popCap: 6,
    tax: { gold: 11, food: 6 },
    captureTime: 16,
    breach: 0,
    upgradeCost: { wood: 250, stone: 180, gold: 250 },
    upgradeTime: 32,
    vision: 8,
    wallRadius: 5,
  },
  {
    tier: 3,
    name: 'Town',
    core: 'town_hall',
    plots: 7,
    popCap: 12,
    tax: { gold: 22, food: 8 },
    captureTime: 22,
    breach: 0.35,
    upgradeCost: { wood: 400, stone: 400, gold: 500, food: 200 },
    upgradeTime: 45,
    vision: 9,
    wallRadius: 7,
  },
  { tier: 4, name: 'Castle Town', core: 'keep', plots: 10, popCap: 18, tax: { gold: 34, food: 10 }, captureTime: 28, breach: 0.2, vision: 10, wallRadius: 8 },
];

export const CAPITAL_TIERS: Record<number, { name: string; popCap: number; tax: { gold: number; food: number }; plots: number }> = {
  3: { name: 'Capital', popCap: 20, tax: { gold: 32, food: 12 }, plots: 7 },
  4: { name: 'Royal Capital', popCap: 30, tax: { gold: 48, food: 16 }, plots: 10 },
};

export const CAPITAL_UPGRADE = { cost: { wood: 300, stone: 300, gold: 400, food: 150 } as Cost, time: 45 };

/** income from simply owning a region with these features (per minute) */
export const REGION_YIELD: Record<string, { gold?: number; wood?: number; food?: number; stone?: number }> = {
  forest: { wood: 14 },
  farmland: { food: 8 },
  gold: { gold: 10 },
  stone: { stone: 8 },
  river: { food: 4 },
  crossroads: { gold: 8 },
  fortress: { gold: 10 },
  ruins: { gold: 4, stone: 4 },
  hills: { stone: 4 },
  holy: { gold: 5 },
};

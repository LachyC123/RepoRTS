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
  { tier: 1, name: 'Outpost', core: 'outpost_tower', plots: 1, popCap: 2, tax: { gold: 3, food: 0 }, captureTime: 12, breach: 0, vision: 11, wallRadius: 0 },
  {
    tier: 2,
    name: 'Village',
    core: 'village_hall',
    plots: 4,
    popCap: 5,
    tax: { gold: 6, food: 6 },
    captureTime: 16,
    breach: 0,
    upgradeCost: { wood: 250, stone: 180, gold: 250 },
    upgradeTime: 40,
    vision: 8,
    wallRadius: 5,
  },
  {
    tier: 3,
    name: 'Town',
    core: 'town_hall',
    plots: 7,
    popCap: 10,
    tax: { gold: 12, food: 8 },
    captureTime: 22,
    breach: 0.35,
    upgradeCost: { wood: 400, stone: 400, gold: 500, food: 200 },
    upgradeTime: 55,
    vision: 9,
    wallRadius: 7,
  },
  { tier: 4, name: 'Castle Town', core: 'keep', plots: 10, popCap: 16, tax: { gold: 20, food: 10 }, captureTime: 28, breach: 0.2, vision: 10, wallRadius: 8 },
];

export const CAPITAL_TIERS: Record<number, { name: string; popCap: number; tax: { gold: number; food: number }; plots: number }> = {
  3: { name: 'Capital', popCap: 16, tax: { gold: 16, food: 10 }, plots: 7 },
  4: { name: 'Royal Capital', popCap: 24, tax: { gold: 24, food: 12 }, plots: 10 },
};

export const CAPITAL_UPGRADE = { cost: { wood: 400, stone: 400, gold: 500, food: 200 } as Cost, time: 55 };

/** income from simply owning a region with these features (per minute) */
export const REGION_YIELD: Record<string, { gold?: number; wood?: number; food?: number; stone?: number }> = {
  forest: { wood: 6 },
  farmland: { food: 6 },
  gold: { gold: 5 },
  stone: { stone: 5 },
  river: { food: 3 },
  crossroads: { gold: 4 },
  fortress: { gold: 6 },
  ruins: { gold: 2, stone: 2 },
  hills: { stone: 2 },
  holy: { gold: 2 },
};

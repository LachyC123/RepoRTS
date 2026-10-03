import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { CAPITAL_RECOVERY_TIME, NEUTRAL } from '../src/data/constants';
import { TRADE_LOT, tradeRates } from '../src/sim/Settlements';

function newWorld(seed: number) {
  const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed, spectate: true }));
  w.initMatch();
  return w;
}

describe('trade', () => {
  it('royal caravans trade at poor rates without a market, and only while the capital stands', () => {
    const w = newWorld(21);
    const sys = w.settlementSys;
    const f = w.factions[1];
    expect(sys.marketCount(1)).toBe(0);
    expect(sys.canTrade(1)).toBe(true);
    f.res.gold = 1000;
    const wood = f.res.wood;
    expect(sys.trade(1, 'wood', true).ok).toBe(true);
    expect(f.res.gold).toBe(1000 - tradeRates(0).buy);
    expect(f.res.wood).toBe(wood + TRADE_LOT);
    // caravans are strictly worse than any market
    expect(tradeRates(0).buy).toBeGreaterThan(tradeRates(1).buy);
    expect(tradeRates(0).sell).toBeLessThan(tradeRates(1).sell);
    // no capital, no caravans
    sys.transfer(w.settlements[f.capitalSettlement], NEUTRAL);
    expect(sys.canTrade(1)).toBe(false);
    expect(sys.trade(1, 'wood', true).ok).toBe(false);
  });
});

describe('capital recovery', () => {
  const loseCapital = (w: World, f: number) => {
    const cap = w.settlements[w.factions[f].capitalSettlement];
    w.victory.onCapitalDestroyed(cap, 0);
    w.settlementSys.transfer(cap, 0);
    for (let i = 0; i < (CAPITAL_RECOVERY_TIME + 3) * 30; i++) w.step();
  };

  it('a kingdom holding only villages falls when its capital does', () => {
    const w = newWorld(22);
    const village = w.settlements.find((s) => s.owner === NEUTRAL && s.tier === 2)!;
    w.settlementSys.transfer(village, 1);
    loseCapital(w, 1);
    expect(w.factions[1].alive).toBe(false);
  });

  it('a kingdom holding a town crowns it as the new capital', () => {
    const w = newWorld(23);
    const town = w.settlements.find((s) => s.owner === NEUTRAL && s.tier >= 2)!;
    w.settlementSys.transfer(town, 1);
    town.tier = 3;
    loseCapital(w, 1);
    expect(w.factions[1].alive).toBe(true);
    expect(w.factions[1].capitalSettlement).toBe(town.id);
    expect(town.isCapital).toBe(true);
  });
});

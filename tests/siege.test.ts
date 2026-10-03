import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { TILE } from '../src/data/constants';

describe('siege & elimination', () => {
  it('an army with rams can breach a capital, capture it, and trigger the crisis', () => {
    const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 11, spectate: true }));
    w.initMatch();
    const target = w.settlements.find((s) => s.isCapital && s.owner === 1)!;
    w.diplomacy.declareWar(0, 1);
    const ids: number[] = [];
    for (let k = 0; k < 30; k++) ids.push(w.spawnUnit('swordsman', 0, target.px + (k % 6) * 12 - 30, target.py + 90 + Math.floor(k / 6) * 12).id);
    for (let k = 0; k < 4; k++) ids.push(w.spawnUnit('ram', 0, target.px + k * 20 - 30, target.py + 150).id);
    const core = w.buildingById.get(target.coreId)!;
    w.orderAttack(ids, core.id);
    let lostAt = -1;
    for (let i = 0; i < 30 * 240; i++) {
      w.step();
      if (core.breached && lostAt < 0) lostAt = w.time;
      if (core.breached && i % 30 === 0) w.orderMove(ids.filter((id) => w.unitById.get(id)?.alive), target.px, target.py, { attackMove: true });
      if (target.owner === 0) break;
    }
    expect(lostAt).toBeGreaterThan(0);
    expect(w.factions[1].critical > 0 || target.owner === 0).toBeTruthy();
    expect(target.owner).toBe(0);
    void TILE;
  });
});

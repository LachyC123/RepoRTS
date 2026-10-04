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

describe('walls', () => {
  it('attackers batter through a palisade to reach the keep', () => {
    const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 12, spectate: true }));
    w.initMatch();
    const target = w.settlements.find((s) => s.isCapital && s.owner === 2)!;
    w.walls.buildRing(target, 1);
    expect(target.wallIds.length).toBeGreaterThan(10);
    w.diplomacy.declareWar(0, 2);
    // kill the defenders so we test walls alone
    for (const u of w.units) if (u.faction === 2) w.despawn(u);
    const ids: number[] = [];
    for (let k = 0; k < 20; k++) ids.push(w.spawnUnit('swordsman', 0, target.px + (k % 5) * 12 - 24, target.py + 260 + Math.floor(k / 5) * 12).id);
    const core = w.buildingById.get(target.coreId)!;
    w.orderAttack(ids, core.id);
    const wallHp0 = target.wallIds.reduce((a, id) => a + (w.buildingById.get(id)?.hp ?? 0), 0);
    for (let i = 0; i < 30 * 150; i++) w.step();
    const wallsLeft = target.wallIds.length;
    const coreDamaged = core.hp < core.maxHp;
    const wallHp1 = target.wallIds.reduce((a, id) => a + (w.buildingById.get(id)?.hp ?? 0), 0);
    expect(wallHp1 < wallHp0 || wallsLeft < 10).toBeTruthy();
    expect(coreDamaged).toBeTruthy();
  }, 30000);
});

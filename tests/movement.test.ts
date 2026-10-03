import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { TILE } from '../src/data/constants';

describe('movement', () => {
  it('a group reaches a distant destination in formation', () => {
    const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 42 }));
    w.initMatch();
    // no garrison fights: this test is about movement
    for (const u of w.units) if (u.faction === 4) w.despawn(u);
    const mine = w.units.filter((u) => u.faction === 0 && u.def.special !== 'worker');
    const target = w.map.regions.find((r) => r.name === 'Greyfield')!;
    const tx = target.px * TILE;
    const ty = target.py * TILE + 40;
    w.orderMove(mine.map((u) => u.id), tx, ty);
    for (let i = 0; i < 30 * 60; i++) w.step();
    // everyone reaches (close to) their own formation slot near the target
    for (const u of mine) {
      expect(Math.hypot(u.x - u.destX, u.y - u.destY)).toBeLessThan(40);
      expect(Math.hypot(u.x - tx, u.y - ty)).toBeLessThan(140);
    }
    // no two units overlap heavily
    for (let a = 0; a < mine.length; a++)
      for (let b = a + 1; b < mine.length; b++) expect(Math.hypot(mine[a].x - mine[b].x, mine[a].y - mine[b].y)).toBeGreaterThan(3);
  });

  it('every region capture point is reachable from every capital', () => {
    const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 7 }));
    for (const cap of w.map.regions.filter((r) => r.capitalSlot !== null)) {
      for (const r of w.map.regions) {
        const res = w.pathfinder.find(cap.px * TILE, cap.py * TILE, r.px * TILE, r.py * TILE, 0, { maxExpand: 60000 });
        expect(res && res.complete, `${cap.name} -> ${r.name}`).toBeTruthy();
      }
    }
  });
});

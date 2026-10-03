import { describe, expect, it } from 'vitest';
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { createMatchWorld, loadWorld, saveWorld } from '../src/sim/save/SaveGame';

describe('save games', () => {
  for (const era of ['medieval', 'modern'] as const) {
    it(`round-trips a ${era} match mid-war exactly`, () => {
      const w = createMatchWorld(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 11, spectate: true, era }));
      for (let i = 0; i < 30 * 60 * 6; i++) w.step();
      const a = saveWorld(w, 'test');
      const json = JSON.stringify(a);
      const w2 = loadWorld(JSON.parse(json));
      const b = saveWorld(w2, 'test');
      b.meta.savedAt = a.meta.savedAt;
      expect(JSON.stringify(b)).toBe(json);
      // and the loaded world keeps running
      for (let i = 0; i < 30 * 30; i++) w2.step();
      expect(w2.time).toBeGreaterThan(w.time + 29);
      expect(w2.units.length).toBeGreaterThan(20);
    }, 120000);
  }
});

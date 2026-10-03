import { NEUTRAL, type FactionId } from '../../data/constants';
import type { World } from '../World';
import { AIController } from './AIController';

/** Runs one AIController per AI kingdom (all four in spectator/headless mode). */
export class AIManager {
  readonly controllers = new Map<number, AIController>();

  constructor(private w: World) {
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL || f.isPlayer) continue;
      this.controllers.set(f.id, new AIController(w, f.id as FactionId));
    }
  }

  update(dt: number) {
    for (const c of this.controllers.values()) c.update(dt);
  }
}

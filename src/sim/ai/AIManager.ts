import { NEUTRAL, type FactionId } from '../../data/constants';
import type { World } from '../World';
import { AIController } from './AIController';

/** Runs one AIController per AI kingdom (all four in spectator/headless mode), plus the player's autopilot. */
export class AIManager {
  readonly controllers = new Map<number, AIController>();
  /** the player's self-running armies (military only), when enabled */
  readonly autopilot: AIController | null = null;

  constructor(private w: World) {
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL) continue;
      if (f.isPlayer && w.setup.realmAuto) {
        // the player's leader runs the whole realm; the player watches (and may still meddle)
        this.controllers.set(f.id, new AIController(w, f.id as FactionId));
        continue;
      }
      if (f.isPlayer) {
        if (w.setup.autoArmies) {
          this.autopilot = new AIController(w, f.id as FactionId, { autopilot: true });
          // a guided first match teaches orders: free soldiers only defend until the player changes it
          if (w.setup.tutorial) this.autopilot.policy = 'defend';
        }
        continue;
      }
      this.controllers.set(f.id, new AIController(w, f.id as FactionId));
    }
  }

  update(dt: number) {
    for (const c of this.controllers.values()) c.update(dt);
    this.autopilot?.update(dt);
  }
}

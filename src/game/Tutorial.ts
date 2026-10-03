import Phaser from 'phaser';
import { audio } from '../audio';
import { settings } from '../core/Settings';
import { TILE } from '../data/constants';
import type { HUD } from '../ui/hud/HUD';
import type { GameClient } from './GameClient';

interface Step {
  title: string;
  text: string;
  check: () => boolean;
  target?: () => { x: number; y: number } | null;
}

/**
 * Guided first match: small contextual objectives with a bouncing arrow in the world.
 * Select capital → build a lumber camp → train 3 militia → capture Greyfield.
 */
export class Tutorial {
  private steps: Step[];
  private i = 0;
  private gfx: Phaser.GameObjects.Graphics;
  private t = 0;
  private trainedStart: number;
  private doneT = -1;
  active = true;

  constructor(
    private client: GameClient,
    private hud: HUD,
  ) {
    const w = client.world;
    const pf = client.playerFaction;
    const f = w.factions[pf];
    const cap = w.settlements[f.capitalSettlement];
    const grey = w.settlements.find((s) => s.name === 'Greyfield')!;
    this.trainedStart = f.stats.unitsTrained;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.steps = [
      {
        title: 'OBJECTIVE 1 / 4',
        text: `Select your capital, <b>${cap.name}</b>. ${touch ? 'Tap' : 'Click'} the castle.`,
        check: () => {
          const sel = client.selection;
          return sel.region === cap.id || (sel.building !== 0 && w.buildingById.get(sel.building)?.settlementId === cap.id);
        },
        target: () => ({ x: cap.cx, y: cap.cy - 40 }),
      },
      {
        title: 'OBJECTIVE 2 / 4',
        text: 'Build a <b>Lumber Camp</b> near the forest: tap <b>BUILD</b>, or tap a glowing plot.',
        check: () => w.buildings.some((b) => b.faction === pf && b.def.id === 'lumber_camp'),
        target: () => {
          const s = cap;
          const p = s.plots.find((pl, i) => i < s.unlockedPlots && !pl.buildingId && w.settlementSys.meetsRequirement(s, i, { requires: 'forest' } as never).ok);
          return p ? { x: (p.def.x + 1.5) * TILE, y: p.def.y * TILE - 6 } : null;
        },
      },
      {
        title: 'OBJECTIVE 3 / 4',
        text: 'Train <b>3 Militia</b> at your castle. Select it and tap the militia portrait.',
        check: () => f.stats.unitsTrained - this.trainedStart >= 3,
        target: () => ({ x: cap.cx, y: cap.cy - 40 }),
      },
      {
        title: 'OBJECTIVE 4 / 4',
        text: `Capture <b>${grey.name}</b>, an unclaimed village (no colour on the map). Select your troops (${touch ? 'tap ARMY, or drag across them' : 'drag a box or press Q'}), then ${touch ? 'tap' : 'right-click'} the village square.`,
        check: () => grey.owner === pf,
        target: () => ({ x: grey.px, y: grey.py - 26 }),
      },
    ];
    this.gfx = client.scene!.make.graphics({}, false);
    client.scene!.overLayer.add(this.gfx);
    this.show();
  }

  private show() {
    const s = this.steps[this.i];
    if (s) this.hud.setObjective({ title: s.title, text: s.text, done: false });
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    const g = this.gfx;
    g.clear();
    if (this.doneT >= 0) {
      if (this.t - this.doneT > 6) {
        this.hud.setObjective(null);
        this.active = false;
      }
      return;
    }
    const s = this.steps[this.i];
    if (s.check()) {
      audio.play('upgrade_complete');
      this.hud.setObjective({ title: s.title, text: s.text, done: true });
      this.i++;
      if (this.i >= this.steps.length) {
        this.doneT = this.t;
        settings.set('tutorialDone', true);
        setTimeout(() => {
          this.hud.setObjective({ title: 'WELL DONE', text: 'Your kingdom is on its way. Expand, grow your towns, raise an army — and watch your rivals.', done: false });
          this.hud.banner('The valley awaits', 'Tutorial complete');
        }, 900);
        return;
      }
      setTimeout(() => this.show(), 900);
      return;
    }
    const tgt = s.target?.();
    if (tgt) {
      const zoom = this.client.scene!.camCtl.zoom;
      const k = 1 / Math.max(0.8, zoom * 0.7);
      const bob = Math.sin(this.t * 5) * 4 * k;
      const x = tgt.x;
      const y = tgt.y - 10 * k + bob;
      g.fillStyle(0x1b1420, 0.9);
      g.fillTriangle(x - 8 * k, y - 10 * k, x + 8 * k, y - 10 * k, x, y + 2 * k);
      g.fillStyle(0xf8d860, 1);
      g.fillTriangle(x - 6 * k, y - 9 * k, x + 6 * k, y - 9 * k, x, y);
      g.fillRect(x - 2.5 * k, y - 18 * k, 5 * k, 9 * k);
    }
  }
}

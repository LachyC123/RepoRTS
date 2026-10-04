import { TILE } from '../data/constants';
import type { World } from '../sim/World';
import type { CameraController } from './CameraController';

interface Spot {
  x: number;
  y: number;
  heat: number;
  caption: string;
  capHeat: number;
  zoom: number;
}

const CELL = 12 * TILE;

/**
 * Watch mode: a camera operator for the sandbox. Everything that happens leaves "heat" where it
 * happened (fighting, captures, strikes, coups, geese, brawls, leaders making speeches); the
 * director cuts to the hottest spot every few seconds, or at once for something big, and
 * captions what you are looking at.
 */
export class Director {
  enabled = false;
  private spots = new Map<number, Spot>();
  private holdT = 0;
  private current = -1;
  private onSpotT = 0;
  private lastCaption = '';
  private pending: { at: number; x: number; y: number; heat: number; caption: string; zoom: number }[] = [];
  onCaption: (text: string) => void = () => {};

  constructor(
    private world: World,
    private cam: CameraController,
  ) {
    const e = world.events;
    e.on('unitHit', (ev) => this.add(ev.x, ev.y, 0.35, '', 1.9));
    e.on('unitDied', (ev) => this.add(ev.x, ev.y, 1, '', 1.9));
    e.on('regionCaptured', (ev) => {
      const s = world.settlements[ev.regionId];
      const to = world.factions[ev.to];
      this.add(ev.x, ev.y, 14, `${to?.name ?? 'Someone'} takes ${s.name}`, 1.7);
    });
    e.on('superLaunch', (ev) => {
      this.add(ev.x, ev.y, 30, `${world.factions[ev.faction].name} fires the ${ev.kind === 'missile' ? 'missile' : 'great bombard'}!`, 1.6);
      // be at the target for the landing
      this.pending.push({ at: world.time + ev.flight - 4, x: ev.tx, y: ev.ty, heat: 90, caption: 'Incoming…', zoom: 1.5 });
    });
    e.on('superImpact', (ev) => this.add(ev.x, ev.y, 40, ev.kills ? `${ev.kills} caught in the blast` : 'A crater where a field was', 1.5));
    e.on('happening', (ev) => this.add(ev.x, ev.y, 10, '', 2.6));
    e.on('journal', (ev) => {
      const big = ev.kind === 'hero' || ev.kind === 'berserk' || ev.kind === 'quirk' || ev.kind === 'panic';
      if (big) this.add(ev.x, ev.y, ev.kind === 'quirk' ? 7 : 5, ev.text, 2.6);
    });
    e.on('leaderThought', (ev) => {
      if (ev.x !== undefined && ev.y !== undefined) this.add(ev.x, ev.y, 6, `${ev.who}: “${ev.text}”`, 1.8);
    });
    e.on('notice', (n) => {
      if (n.x !== undefined && n.y !== undefined && (n.priority ?? 0) >= 1 && n.kind === 'commander') this.add(n.x, n.y, 16, n.text.charAt(0) + n.text.slice(1).toLowerCase(), 2);
    });
    e.on('unitSay', (ev) => {
      if (ev.kind === 'brawl' || ev.kind === 'goose' || ev.kind === 'drunk' || ev.kind === 'revenge') this.add(ev.x, ev.y, 3, '', 2.8);
    });
  }

  private add(x: number, y: number, heat: number, caption: string, zoom: number) {
    const k = Math.floor(x / CELL) + Math.floor(y / CELL) * 1000;
    let s = this.spots.get(k);
    if (!s) {
      s = { x, y, heat: 0, caption: '', capHeat: 0, zoom };
      this.spots.set(k, s);
    }
    // centre drifts toward where things happen
    const wgt = heat / (s.heat + heat);
    s.x += (x - s.x) * wgt;
    s.y += (y - s.y) * wgt;
    // one endless battle shouldn't own the camera forever
    s.heat = Math.min(150, s.heat + heat);
    if (caption && heat >= s.capHeat * 0.5) {
      s.caption = caption;
      s.capHeat = heat;
      s.zoom = zoom;
    }
  }

  /** keep the camera on one unit (a leader) until they fall or the person moves the camera */
  followId = 0;
  follow(id: number) {
    const u = this.world.unitById.get(id);
    if (!u) return;
    this.followId = id;
    this.cam.flyTo(u.x, u.y - 10, Math.max(this.cam.zoom, this.cam.normalZoom() * 1.4), 0.9);
  }

  /** "Varnmark vs Eldmoor at Oakhaven" for a fight with no story of its own */
  private battleCaption(x: number, y: number): string {
    const w = this.world;
    const n = new Map<number, number>();
    w.unitHash.query(x, y, 9 * TILE, (u) => {
      if (u.alive && u.def.special !== 'worker' && w.time - u.lastHitT < 5) n.set(u.faction, (n.get(u.faction) ?? 0) + 1);
    });
    const sides = [...n.entries()].sort((a, b) => b[1] - a[1]);
    if (sides.length < 2) return '';
    const nm = (f: number) => (f === 4 ? (w.setup.era === 'modern' ? 'raiders' : 'bandits') : w.factions[f].name);
    const m = w.map;
    const ri = m.region[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)];
    return `${nm(sides[0][0])} vs ${nm(sides[1][0])}${ri >= 0 ? ' at ' + w.settlements[ri].name : ''}`;
  }

  /** forget accumulated heat (after a fast-forward) */
  reset() {
    this.spots.clear();
    this.pending = [];
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.onSpotT = 0;
    this.holdT = 0;
    this.current = -1;
  }

  update(dt: number) {
    const w = this.world;
    for (const p of this.pending) if (p.at <= w.time) this.add(p.x, p.y, p.heat, p.caption, p.zoom);
    this.pending = this.pending.filter((p) => p.at > w.time);
    // heat fades
    const decay = Math.pow(0.8, dt);
    for (const [k, s] of this.spots) {
      s.heat *= decay;
      s.capHeat *= decay;
      if (s.heat < 0.2) this.spots.delete(k);
    }
    // following one person (a leader): stay on them while they live
    if (this.followId) {
      const u = w.unitById.get(this.followId);
      if (!u || !u.alive || performance.now() - this.cam.lastUserT < 300) {
        this.followId = 0;
        if (u && !u.alive) this.onCaption('They have fallen.');
      } else {
        if (!this.cam.flying) {
          this.cam.x += (u.x - this.cam.x) * Math.min(1, dt * 3);
          this.cam.y += (u.y - 10 - this.cam.y) * Math.min(1, dt * 3);
        }
        return;
      }
    }
    if (!this.enabled) return;
    this.holdT -= dt;
    // the person is looking around themselves: wait until they stop
    if (performance.now() - this.cam.lastUserT < 6000) return;
    this.onSpotT += dt;
    // the longer we watch one place, the more we want to see something else
    const boredom = Math.exp(-this.onSpotT / 22);
    const score = (k: number, s: Spot) => s.heat * (k === this.current ? 1.4 * boredom : 1);
    let bestK = -1;
    let best: Spot | null = null;
    let bs = 0;
    for (const [k, s] of this.spots) {
      const sc = score(k, s);
      if (!best || sc > bs) {
        best = s;
        bestK = k;
        bs = sc;
      }
    }
    if (!best) return;
    const cur = this.spots.get(this.current);
    if (bestK === this.current) {
      // follow the action as it moves, and caption anything new that happens here
      if (Math.hypot(best.x - this.cam.x, best.y - this.cam.y) > 4 * TILE && !this.cam.flying) this.cam.flyTo(best.x, best.y, undefined, 1.2);
      if (best.caption && best.caption !== this.lastCaption) {
        this.lastCaption = best.caption;
    if (!best.caption) {
      const b = this.battleCaption(best.x, best.y);
      if (b) this.onCaption(b);
    }
        this.onCaption(best.caption);
      }
      return;
    }
    const urgent = !cur || best.heat > Math.max(12, cur.heat * 3);
    if (this.holdT > 0 && !urgent) return;
    this.current = bestK;
    this.onSpotT = 0;
    this.holdT = 6 + Math.min(5, best.heat / 8);
    const z = Math.max(this.cam.minZoom, Math.min(best.zoom * this.cam.normalZoom() * 0.55, this.cam.maxZoom));
    this.cam.flyTo(best.x, best.y, z, 1.6, (k) => k * k * (3 - 2 * k));
    this.lastCaption = best.caption;
    if (best.caption) this.onCaption(best.caption);
  }
}

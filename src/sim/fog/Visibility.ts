import { NEUTRAL, TILE } from '../../data/constants';
import type { World } from '../World';

/**
 * Per-kingdom fog of war on the tile grid: `visible` is refreshed a few times a second from unit,
 * building and settlement vision; `explored` remembers everything ever seen. Units and buildings get
 * a `seenBy` bitmask the renderer and AI use.
 */
export class Visibility {
  visible: Uint8Array[] = [];
  explored: Uint8Array[] = [];
  private circles = new Map<number, Int16Array>();
  version = 0;
  revealAll = false;

  constructor(private w: World) {
    const n = w.map.w * w.map.h;
    for (let f = 0; f < 4; f++) {
      this.visible[f] = new Uint8Array(n);
      this.explored[f] = new Uint8Array(n);
    }
  }

  private circle(r: number): Int16Array {
    const key = Math.round(r * 2);
    let c = this.circles.get(key);
    if (!c) {
      const pts: number[] = [];
      const rr = key / 2;
      for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++)
        for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) if (dx * dx + dy * dy <= rr * rr + 0.5) pts.push(dx, dy);
      c = new Int16Array(pts);
      this.circles.set(key, c);
    }
    return c;
  }

  private stamp(f: number, x: number, y: number, r: number) {
    const m = this.w.map;
    const vis = this.visible[f];
    const exp = this.explored[f];
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    const c = this.circle(r);
    for (let k = 0; k < c.length; k += 2) {
      const tx = cx + c[k];
      const ty = cy + c[k + 1];
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
      const i = ty * m.w + tx;
      vis[i] = 1;
      exp[i] = 1;
    }
  }

  update() {
    const w = this.w;
    const m = w.map;
    for (let f = 0; f < 4; f++) this.visible[f].fill(0);
    for (const u of w.units) {
      if (!u.alive || u.faction === NEUTRAL) continue;
      this.stamp(u.faction, u.x, u.y, u.def.vision);
    }
    for (const b of w.buildings) {
      if (b.destroyed || b.faction === NEUTRAL || !b.built) continue;
      if (b.def.id === 'wall' || b.def.id === 'gatehouse') continue;
      const v = b.def.vision ?? 4;
      this.stamp(b.faction, b.x, b.y, v + (b.size > 2 ? 1 : 0));
    }
    for (const s of w.settlements) {
      if (s.owner === NEUTRAL) continue;
      // Crownkeep grants a huge vision radius
      if (s.region.name === 'Crownkeep') this.stamp(s.owner, s.cx, s.cy, 20);
    }
    // seen-by bitmasks
    for (const u of w.units) {
      if (!u.alive) continue;
      const i = Math.floor(u.y / TILE) * m.w + Math.floor(u.x / TILE);
      let bits = 0;
      for (let f = 0; f < 4; f++) if (this.visible[f][i] || u.faction === f) bits |= 1 << f;
      u.seenBy = this.revealAll ? 15 : bits;
    }
    for (const b of w.buildings) {
      let bits = 0;
      for (let f = 0; f < 4; f++) {
        if (b.faction === f) {
          bits |= 1 << f;
          continue;
        }
        // any footprint tile visible
        let seen = false;
        for (let y = b.ty; y < b.ty + b.size && !seen; y++)
          for (let x = b.tx; x < b.tx + b.size; x++)
            if (this.visible[f][y * m.w + x]) {
              seen = true;
              break;
            }
        if (seen) bits |= 1 << f;
      }
      b.seenBy = bits;
    }
    this.version++;
  }

  isVisible(f: number, x: number, y: number) {
    if (f < 0 || f > 3 || this.revealAll) return true;
    const m = this.w.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
    return this.visible[f][ty * m.w + tx] === 1;
  }

  isExplored(f: number, x: number, y: number) {
    if (f < 0 || f > 3 || this.revealAll) return true;
    const m = this.w.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
    return this.explored[f][ty * m.w + tx] === 1;
  }
}

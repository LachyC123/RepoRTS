import { MinHeap } from '../../core/Heap';
import { TILE } from '../../data/constants';
import { T, type GameMap } from './GameMap';

const SQ2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export interface PathResult {
  /** waypoints in world px, flattened [x0,y0,x1,y1...] */
  pts: number[];
  /** true if the goal itself was reached (false = partial/closest) */
  complete: boolean;
  /** breach mode: wall/gate tiles the path goes through (in order) */
  blockers?: number[];
}

/**
 * Tile A* tuned for many requests: typed arrays, generation stamps (no clearing),
 * expansion budget with closest-node fallback, terrain-speed costs, per-faction gates,
 * optional "breach" mode where enemy walls are expensive but passable (units then attack them),
 * and line-of-sight string pulling.
 */
export class Pathfinder {
  readonly map: GameMap;
  private g: Float32Array;
  private parent: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new MinHeap(8192);
  /** cost multiplier per tile, rebuilt when map.version changes */
  private cost: Float32Array;
  private costVersion = -1;
  expansions = 0;
  requests = 0;

  constructor(map: GameMap) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.cost = new Float32Array(n);
  }

  private refreshCost() {
    const m = this.map;
    if (this.costVersion === m.version) return;
    this.costVersion = m.version;
    const n = m.w * m.h;
    for (let i = 0; i < n; i++) {
      const t = m.terrain[i];
      let c: number;
      if (t === T.WATER || t === T.ROCK || m.tree[i] || m.ore[i]) c = Infinity;
      else if (t === T.ROAD || t === T.BRIDGE) c = 0.78;
      else if (t === T.HILL) c = 1.3;
      else if (t === T.SHALLOW) c = 1.7;
      else if (t === T.MARSH) c = 1.45;
      else c = 1;
      this.cost[i] = c;
    }
  }

  /** passability for a faction (gates open for owners). Walls/buildings come from occ. */
  passable(i: number, faction: number): boolean {
    this.refreshCost();
    if (!isFinite(this.cost[i])) return false;
    if (this.map.occ[i] !== 0) {
      const go = this.map.gateOwner[i];
      return go !== 0 && go - 1 === faction;
    }
    return true;
  }

  private tileCost(i: number, faction: number, breach: boolean): number {
    const c = this.cost[i];
    if (!isFinite(c)) return Infinity;
    if (this.map.occ[i] !== 0) {
      const go = this.map.gateOwner[i];
      if (go !== 0) {
        if (go - 1 === faction) return c;
        return breach ? c + 30 : Infinity;
      }
      // wall pieces are flagged negative in gateOwner? walls: gateOwner = -(owner+1)
      if (breach && go === 0 && this.isWall(i)) return c + 45;
      return Infinity;
    }
    return c;
  }

  private wallMask: Uint8Array | null = null;
  setWallMask(mask: Uint8Array) {
    this.wallMask = mask;
  }
  private isWall(i: number) {
    return this.wallMask !== null && this.wallMask[i] === 1;
  }

  /** nearest tile to (tx,ty) passable for faction, spiral search */
  nearestPassable(tx: number, ty: number, faction: number, maxR = 12): number {
    const m = this.map;
    tx = Math.max(0, Math.min(m.w - 1, tx));
    ty = Math.max(0, Math.min(m.h - 1, ty));
    if (this.passable(ty * m.w + tx, faction)) return ty * m.w + tx;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
          const i = y * m.w + x;
          if (!this.passable(i, faction)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  find(sx: number, sy: number, gx: number, gy: number, faction: number, opts: { breach?: boolean; maxExpand?: number } = {}): PathResult | null {
    this.refreshCost();
    this.requests++;
    const m = this.map;
    const W = m.w;
    const breach = !!opts.breach;
    const maxExpand = opts.maxExpand ?? 24000;
    const stx = Math.max(0, Math.min(W - 1, Math.floor(sx / TILE)));
    const sty = Math.max(0, Math.min(m.h - 1, Math.floor(sy / TILE)));
    let start = sty * W + stx;
    if (!this.passable(start, faction)) {
      const ns = this.nearestPassable(stx, sty, faction, 4);
      if (ns >= 0) start = ns;
    }
    const gtx = Math.max(0, Math.min(W - 1, Math.floor(gx / TILE)));
    const gty = Math.max(0, Math.min(m.h - 1, Math.floor(gy / TILE)));
    let goal = gty * W + gtx;
    let goalExact = true;
    if (!isFinite(this.tileCost(goal, faction, breach))) {
      const ng = this.nearestPassable(gtx, gty, faction, 16);
      if (ng < 0) return null;
      goal = ng;
      goalExact = false;
    }
    if (start === goal) {
      return { pts: goalExact ? [gx, gy] : [(goal % W) * TILE + 8, ((goal / W) | 0) * TILE + 8], complete: true };
    }
    const gen = ++this.gen;
    const g = this.g;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const goalX = goal % W;
    const goalY = (goal / W) | 0;
    const H = (i: number) => {
      const dx = Math.abs((i % W) - goalX);
      const dy = Math.abs(((i / W) | 0) - goalY);
      return (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)) * 0.78;
    };
    g[start] = 0;
    seen[start] = gen;
    parent[start] = -1;
    heap.push(start, H(start));
    let best = start;
    let bestH = H(start);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const gc = g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        const c = this.tileCost(ni, faction, breach);
        if (!isFinite(c)) continue;
        let step = c;
        if (k >= 4) {
          // corners are never cut, even through breachable walls
          if (!isFinite(this.tileCost(cy * W + nx, faction, false)) || !isFinite(this.tileCost(ny * W + cx, faction, false))) continue;
          if (breach && (this.map.occ[ni] !== 0 || this.map.occ[cur] !== 0)) continue;
          step *= SQ2;
        }
        const ng = gc + step;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          parent[ni] = cur;
          const h = H(ni);
          heap.push(ni, ng + h);
          if (h < bestH) {
            bestH = h;
            best = ni;
          }
        }
      }
    }
    this.expansions += expanded;
    const end = found ? goal : best;
    const tiles: number[] = [];
    let c = end;
    let guard = 0;
    while (c !== -1 && guard++ < 100000) {
      tiles.push(c);
      if (c === start) break;
      c = parent[c];
    }
    tiles.reverse();
    let blockers: number[] | undefined;
    if (breach) {
      blockers = [];
      for (const ti of tiles) if (this.map.occ[ti] !== 0 && !(this.map.gateOwner[ti] !== 0 && this.map.gateOwner[ti] - 1 === faction)) blockers.push(ti);
      // walk up to the first blocker only
      if (blockers.length) {
        const cut = tiles.indexOf(blockers[0]);
        if (cut > 0) tiles.length = cut;
      }
    }
    const pts = this.smooth(tiles, faction, breach);
    if (found && goalExact) {
      pts[pts.length - 2] = gx;
      pts[pts.length - 1] = gy;
    }
    return { pts, complete: found && !(blockers && blockers.length), blockers };
  }

  /** string-pulling: keep a waypoint only when LOS to the next is blocked */
  private smooth(tiles: number[], faction: number, breach: boolean): number[] {
    const W = this.map.w;
    const out: number[] = [];
    if (tiles.length === 0) return out;
    let anchor = 0;
    const center = (i: number) => [(i % W) * TILE + TILE / 2, ((i / W) | 0) * TILE + TILE / 2];
    let i = 1;
    while (i < tiles.length) {
      if (i + 1 < tiles.length && this.losTiles(tiles[anchor], tiles[i + 1], faction, breach)) {
        i++;
        continue;
      }
      const [x, y] = center(tiles[i]);
      out.push(x, y);
      anchor = i;
      i++;
    }
    if (out.length === 0) {
      const [x, y] = center(tiles[tiles.length - 1]);
      out.push(x, y);
    }
    return out;
  }

  /** supercover line walk between tile centres, with margin so units don't clip corners */
  losTiles(a: number, b: number, faction: number, breach = false): boolean {
    const W = this.map.w;
    let x0 = a % W;
    let y0 = (a / W) | 0;
    const x1 = b % W;
    const y1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const baseCost = this.cost[a];
    let n = dx + dy + 2;
    while (n-- > 0) {
      const i = y0 * W + x0;
      const c = this.tileCost(i, faction, breach);
      if (!isFinite(c)) return false;
      // don't shortcut across slow terrain when on roads
      if (baseCost < 0.9 && c > 1.2) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        // diagonal step: require both orthogonal neighbours (supercover)
        if (!isFinite(this.tileCost(y0 * W + x0 + sx, faction, breach)) || !isFinite(this.tileCost((y0 + sy) * W + x0, faction, breach))) return false;
        err -= dy;
        x0 += sx;
        err += dx;
        y0 += sy;
      } else if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      } else {
        err += dx;
        y0 += sy;
      }
    }
    return true;
  }

  /** world-px LOS used by steering (straight line walkable?) */
  losWorld(ax: number, ay: number, bx: number, by: number, faction: number): boolean {
    this.refreshCost();
    const W = this.map.w;
    const a = Math.floor(ay / TILE) * W + Math.floor(ax / TILE);
    const b = Math.floor(by / TILE) * W + Math.floor(bx / TILE);
    return this.losTiles(a, b, faction);
  }
}

import { TILE } from '../../data/constants';
import { T, type GameMap } from './GameMap';

/**
 * Region connectivity for strategic reasoning: two regions are linked if they share a walkable land
 * border or are joined by a road (bridges/fords). Edge weights are plaza-to-plaza distances;
 * all-pairs shortest distances are precomputed (45 regions → trivial).
 */
export class RegionGraph {
  readonly n: number;
  readonly adj: number[][];
  /** shortest travel distance in tiles between region plazas */
  readonly dist: Float32Array;
  readonly hops: Uint8Array;

  constructor(map: GameMap) {
    const n = map.regions.length;
    this.n = n;
    const links = new Map<number, number>(); // key a*n+b -> shared walkable border count
    const W = map.w;
    const walk = (i: number) => {
      const t = map.terrain[i];
      return t !== T.WATER && t !== T.ROCK;
    };
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const r = map.region[i];
        if (x < W - 1) {
          const o = map.region[i + 1];
          if (o !== r && walk(i) && walk(i + 1)) links.set(r * n + o, (links.get(r * n + o) ?? 0) + 1);
        }
        if (y < map.h - 1) {
          const o = map.region[i + W];
          if (o !== r && walk(i) && walk(i + W)) links.set(r * n + o, (links.get(r * n + o) ?? 0) + 1);
        }
      }
    // roads always link their endpoints' regions along the way
    for (const path of map.roads) {
      for (let k = 1; k < path.length; k++) {
        const a = map.region[path[k - 1]];
        const b = map.region[path[k]];
        if (a !== b) links.set(a * n + b, (links.get(a * n + b) ?? 0) + 3);
      }
    }
    const adjSet: Set<number>[] = [];
    for (let i = 0; i < n; i++) adjSet.push(new Set());
    for (const [k, c] of links) {
      if (c < 2) continue;
      const a = Math.floor(k / n);
      const b = k % n;
      adjSet[a].add(b);
      adjSet[b].add(a);
    }
    this.adj = adjSet.map((s) => [...s]);
    this.dist = new Float32Array(n * n).fill(Infinity);
    this.hops = new Uint8Array(n * n).fill(255);
    const R = map.regions;
    for (let s = 0; s < n; s++) {
      const d = this.dist;
      d[s * n + s] = 0;
      this.hops[s * n + s] = 0;
      const done = new Uint8Array(n);
      for (let it = 0; it < n; it++) {
        let u = -1;
        let best = Infinity;
        for (let v = 0; v < n; v++) if (!done[v] && d[s * n + v] < best) {
          best = d[s * n + v];
          u = v;
        }
        if (u < 0) break;
        done[u] = 1;
        for (const v of this.adj[u]) {
          const w = Math.hypot(R[u].px - R[v].px, R[u].py - R[v].py);
          if (d[s * n + u] + w < d[s * n + v]) {
            d[s * n + v] = d[s * n + u] + w;
            this.hops[s * n + v] = this.hops[s * n + u] + 1;
          }
        }
      }
    }
    void TILE;
  }

  d(a: number, b: number) {
    return this.dist[a * this.n + b];
  }
  h(a: number, b: number) {
    return this.hops[a * this.n + b];
  }
}

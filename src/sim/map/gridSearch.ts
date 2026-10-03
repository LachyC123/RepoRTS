import { MinHeap } from '../../core/Heap';

const SQ2 = Math.SQRT2;

/**
 * Generic 8-way A* over a grid with a per-tile entry cost (Infinity = blocked).
 * Used by map generation (roads, carving). Unit pathfinding has its own tuned version.
 */
export function gridAStar(
  w: number,
  h: number,
  start: number,
  goal: number,
  cost: (i: number) => number,
  minCost = 0.3,
): number[] | null {
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(4096);
  const gx = goal % w;
  const gy = (goal / w) | 0;
  const hfn = (i: number) => {
    const dx = Math.abs((i % w) - gx);
    const dy = Math.abs(((i / w) | 0) - gy);
    return (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)) * minCost;
  };
  g[start] = 0;
  heap.push(start, hfn(start));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const c = cost(ni);
        if (!isFinite(c)) continue;
        const diag = dx !== 0 && dy !== 0;
        if (diag) {
          // no corner cutting
          if (!isFinite(cost(cy * w + nx)) || !isFinite(cost(ny * w + cx))) continue;
        }
        const ng = g[cur] + c * (diag ? SQ2 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          heap.push(ni, ng + hfn(ni));
        }
      }
    }
  }
  if (from[goal] === -1 && goal !== start) return null;
  const path: number[] = [];
  let c = goal;
  while (c !== -1) {
    path.push(c);
    if (c === start) break;
    c = from[c];
  }
  path.reverse();
  return path;
}

/** 4-way flood fill; returns visited mask. */
export function floodFill(w: number, h: number, start: number, pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % w;
    const y = (c / w) | 0;
    if (x > 0 && !seen[c - 1] && pass(c - 1)) (seen[c - 1] = 1), stack.push(c - 1);
    if (x < w - 1 && !seen[c + 1] && pass(c + 1)) (seen[c + 1] = 1), stack.push(c + 1);
    if (y > 0 && !seen[c - w] && pass(c - w)) (seen[c - w] = 1), stack.push(c - w);
    if (y < h - 1 && !seen[c + w] && pass(c + w)) (seen[c + w] = 1), stack.push(c + w);
  }
  return seen;
}

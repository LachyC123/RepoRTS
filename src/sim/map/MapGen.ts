import { fbm, hash2, Random } from '../../core/Random';
import { MinHeap } from '../../core/Heap';
import { clamp, distToSegment2, smoothstep } from '../../core/math';
import type { MapDef, RegionSeedDef } from '../../data/map_crownshire';
import { TILE } from '../../data/constants';
import { floodFill, gridAStar } from './gridSearch';
import { T, type Decor, type Deposit, type GameMap, type PlotDef, type RegionInfo } from './GameMap';

const RESERVED_CORE = 1;
const RESERVED_PLOT = 2;
const RESERVED_PLAZA = 3;
const RESERVED_ORE = 4;
const RESERVED_ROAD = 5;

function polyDist(x: number, y: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment2(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function coreSizeFor(def: RegionSeedDef): number {
  if (def.capital !== undefined) return 5;
  if (def.tier >= 4) return 4;
  if (def.tier >= 2) return 3;
  return 2;
}

export function plotCountFor(def: RegionSeedDef): number {
  if (def.capital !== undefined || def.tier >= 2) return 10;
  if (def.tier === 1) return 2;
  return 2;
}

export function generateMap(def: MapDef, seed: number): GameMap {
  const W = def.width;
  const H = def.height;
  const N = W * H;
  const rng = new Random(seed * 7919 + 13);
  const terrain = new Uint8Array(N);
  const height = new Float32Array(N);
  const tree = new Uint8Array(N);
  const treeHp = new Uint8Array(N);
  const stump = new Uint8Array(N);
  const ore = new Uint8Array(N);
  const crop = new Uint8Array(N);
  const region = new Int16Array(N).fill(-1);
  const reserved = new Uint8Array(N);
  const crossingZone = new Uint8Array(N); // 1 bridge 2 ford
  const riverDist = new Float32Array(N).fill(99);
  const S = 1000 + (seed % 1000); // noise seed offset, layout stays recognisable

  // ---------------------------------------------------------------- height, ridges
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let h = fbm(x / 24, y / 24, 4, S) * 0.35 + 0.18;
      let ridge = 0;
      const wob = 0.75 + 0.5 * fbm(x / 5, y / 5, 3, S + 5);
      for (const r of def.ridges) {
        const d = polyDist(x, y, r.points) * wob;
        const f = clamp(1 - d / r.radius, 0, 1);
        if (f > ridge) ridge = f;
      }
      for (const p of def.passes) {
        const d = Math.hypot(x - p.x, y - p.y);
        ridge *= smoothstep(p.r * 0.55, p.r * 1.4, d);
      }
      h += Math.pow(ridge, 0.8) * 0.75;
      height[i] = h;
      if (ridge > 0.4) terrain[i] = T.ROCK;
      else if (ridge > 0.1) terrain[i] = T.HILL;
      else {
        const m = fbm(x / 9, y / 9, 3, S + 7);
        terrain[i] = m > 0.63 ? T.MEADOW : T.GRASS;
        if (fbm(x / 6, y / 6, 2, S + 9) > 0.86) terrain[i] = T.DIRT;
      }
    }
  }

  // ---------------------------------------------------------------- rivers & lakes
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wob = (fbm(x / 5, y / 5, 2, S + 11) - 0.5) * 1.3;
      let best = 99;
      let half = 1;
      for (const r of def.rivers) {
        const d = polyDist(x + 0.5, y + 0.5, r.points);
        const rel = d - r.width / 2;
        if (rel < best) {
          best = rel;
          half = r.width / 2;
        }
      }
      riverDist[i] = best;
      const rel = best + wob * Math.min(1, half);
      if (rel < 0) {
        terrain[i] = T.WATER;
        height[i] = Math.min(height[i], 0.08);
      } else if (rel < 1.1 && terrain[i] !== T.ROCK) {
        const n = fbm(x / 4, y / 4, 2, S + 13);
        if (n > 0.62) terrain[i] = T.MARSH;
        else if (n < 0.42) terrain[i] = T.SAND;
        height[i] = Math.min(height[i], 0.15);
      }
      for (const l of def.lakes) {
        const e = Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry) + (fbm(x / 4, y / 4, 2, S + 17) - 0.5) * 0.3;
        if (e < 1) {
          terrain[i] = T.WATER;
          height[i] = Math.min(height[i], 0.06);
          riverDist[i] = Math.min(riverDist[i], -1);
        } else if (e < 1.3 && terrain[i] !== T.WATER && terrain[i] !== T.ROCK) {
          terrain[i] = fbm(x / 3, y / 3, 2, S + 19) > 0.5 ? T.SAND : T.MARSH;
          riverDist[i] = Math.min(riverDist[i], 0.5);
        }
      }
    }
  }
  for (const c of def.crossings) {
    for (let y = Math.floor(c.y - 4); y <= c.y + 4; y++) {
      for (let x = Math.floor(c.x - 4); x <= c.x + 4; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (Math.hypot(x - c.x, y - c.y) <= 3.2) crossingZone[y * W + x] = c.kind === 'bridge' ? 1 : 2;
      }
    }
  }

  // ---------------------------------------------------------------- regions (multi-source Dijkstra)
  const seeds = def.regions.map((r) => {
    let sx = r.x;
    let sy = r.y;
    // nudge off water/rock if needed
    const isBad = (x: number, y: number) => {
      const t = terrain[y * W + x];
      return t === T.WATER || t === T.ROCK;
    };
    if (isBad(sx, sy)) {
      outer: for (let rad = 1; rad < 10; rad++) {
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && !isBad(nx, ny)) {
              sx = nx;
              sy = ny;
              break outer;
            }
          }
      }
    }
    return { x: sx, y: sy };
  });
  {
    const dist = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap(8192);
    seeds.forEach((s, id) => {
      const i = s.y * W + s.x;
      dist[i] = 0;
      region[i] = id;
      heap.push(i, 0);
    });
    while (heap.size) {
      const pri = heap.peekPriority();
      const c = heap.pop();
      if (pri > dist[c]) continue;
      const cx = c % W;
      const cy = (c / W) | 0;
      const rid = region[c];
      const weight = def.regions[rid].weight ?? 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const t = terrain[ni];
        let step = 1;
        if (t === T.WATER) step = 9;
        else if (t === T.ROCK) step = 3;
        else if (t === T.HILL) step = 1.4;
        step *= 0.85 + 0.3 * hash2(nx, ny, S + 23);
        const nd = dist[c] + step / weight;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          region[ni] = rid;
          heap.push(ni, nd);
        }
      }
    }
  }

  // ---------------------------------------------------------------- settlements, plazas, deposits, plots
  const regions: RegionInfo[] = [];
  const deposits: Deposit[] = [];
  const landOk = (i: number) => {
    const t = terrain[i];
    return t !== T.WATER && t !== T.ROCK && t !== T.SHALLOW && t !== T.MARSH;
  };
  const rectFree = (x0: number, y0: number, w: number, h: number, rid: number, margin: number) => {
    for (let y = y0 - margin; y < y0 + h + margin; y++) {
      for (let x = x0 - margin; x < x0 + w + margin; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
        const i = y * W + x;
        if (reserved[i]) return false;
        const inner = x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
        if (inner) {
          if (!landOk(i)) return false;
          if (region[i] !== rid) return false;
          if (riverDist[i] < 0.8) return false;
        }
      }
    }
    return true;
  };
  const reserve = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) reserved[y * W + x] = v;
  };

  def.regions.forEach((rd, id) => {
    const cs = coreSizeFor(rd);
    const s = seeds[id];
    const x0 = s.x - Math.floor(cs / 2);
    const y0 = s.y - Math.floor(cs / 2);
    // clear the core footprint and plaza area
    for (let y = y0 - 1; y <= y0 + cs + 2; y++) {
      for (let x = x0 - 1; x <= x0 + cs; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (terrain[i] === T.ROCK || terrain[i] === T.MARSH || terrain[i] === T.SAND) terrain[i] = T.GRASS;
        if (terrain[i] === T.WATER && Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) <= cs / 2 + 2) terrain[i] = T.GRASS;
        region[i] = id;
      }
    }
    reserve(x0, y0, cs, cs, RESERVED_CORE);
    const plazaY = y0 + cs;
    const plazaX0 = s.x - 1;
    for (let y = plazaY; y < plazaY + 2; y++)
      for (let x = plazaX0; x < plazaX0 + 3; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        reserved[y * W + x] = RESERVED_PLAZA;
        if (rd.tier >= 1 || rd.capital !== undefined) terrain[y * W + x] = T.DIRT;
      }
    const info: RegionInfo = {
      id,
      name: rd.name,
      def: rd,
      cx: s.x,
      cy: s.y,
      px: s.x + 0.5,
      py: plazaY + 1,
      tier: rd.tier,
      capitalSlot: rd.capital ?? null,
      features: rd.features,
      landmark: rd.landmark ?? null,
      value: rd.value ?? 1,
      tiles: 0,
      neighbors: [],
      mx: 0,
      my: 0,
      minX: W,
      minY: H,
      maxX: 0,
      maxY: 0,
      coreSize: cs,
      plots: [],
      border: [],
    };
    regions.push(info);
  });

  // deposits
  regions.forEach((r) => {
    const kinds: ('gold' | 'stone')[] = [];
    if (r.features.includes('gold')) kinds.push('gold');
    if (r.features.includes('stone')) kinds.push('stone');
    let angle = hash2(r.id, 3, S) * Math.PI * 2;
    for (const kind of kinds) {
      let placed = false;
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const a = angle + attempt * 0.7;
        const rad = 6 + (attempt % 5);
        const dx = Math.round(Math.cos(a) * rad);
        const dy = Math.round(Math.sin(a) * rad);
        const x = r.cx + dx - 1;
        const y = r.cy + dy - 1;
        if (!rectFree(x, y, 2, 2, r.id, 1)) continue;
        reserve(x, y, 2, 2, RESERVED_ORE);
        for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) ore[yy * W + xx] = kind === 'gold' ? 1 : 2;
        deposits.push({ kind, x: (x + 1) * TILE, y: (y + 1) * TILE, amount: Infinity, regionId: r.id });
        placed = true;
      }
      angle += 2.4;
    }
  });

  // plots
  regions.forEach((r) => {
    const want = plotCountFor(r.def);
    const myDeps = deposits.filter((d) => d.regionId === r.id);
    const size = 3;
    const cands: { x: number; y: number; d: number }[] = [];
    const maxR = r.def.capital !== undefined ? 13 : 12;
    for (let y = r.cy - maxR; y <= r.cy + maxR; y++) {
      for (let x = r.cx - maxR; x <= r.cx + maxR; x++) {
        const pcx = x + size / 2;
        const pcy = y + size / 2;
        let d = Math.hypot(pcx - (r.cx + 0.5), pcy - (r.cy + 0.5));
        if (d < r.coreSize / 2 + 2.2 || d > maxR) continue;
        if (r.tier === 0 && myDeps.length) {
          // resource landmarks: cluster near deposits
          const dd = Math.min(...myDeps.map((dp) => Math.hypot(pcx - dp.x / TILE, pcy - dp.y / TILE)));
          d = dd * 1.5 + d * 0.3;
        }
        cands.push({ x, y, d: d + hash2(x, y, S + 29) * 1.2 });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    // for regions with deposits, make sure first plots are near each deposit
    const picked: PlotDef[] = [];
    const tryPick = (c: { x: number; y: number }, kind: PlotDef['kind']) => {
      if (!rectFree(c.x, c.y, size, size, r.id, 1)) return false;
      reserve(c.x, c.y, size, size, RESERVED_PLOT);
      picked.push({ x: c.x, y: c.y, size, kind, order: picked.length });
      return true;
    };
    for (const dp of myDeps) {
      const near = cands
        .map((c) => ({ ...c, dd: Math.hypot(c.x + 1.5 - dp.x / TILE, c.y + 1.5 - dp.y / TILE) }))
        .filter((c) => c.dd < 5.5)
        .sort((a, b) => a.dd - b.dd);
      for (const c of near) if (tryPick(c, 'any')) break;
    }
    for (const c of cands) {
      if (picked.length >= want) break;
      tryPick(c, 'any');
    }
    // inner plots unlock first: sort by distance to centre, but keep deposit plots early for landmarks
    if (r.tier >= 2 || r.def.capital !== undefined) {
      const dep = picked.slice(0, myDeps.length);
      const rest = picked.slice(myDeps.length).sort((a, b) => Math.hypot(a.x - r.cx, a.y - r.cy) - Math.hypot(b.x - r.cx, b.y - r.cy));
      // deposit plots go after the first 2 inner plots
      const ordered = [...rest.slice(0, 2), ...dep, ...rest.slice(2)];
      ordered.forEach((p, i) => (p.order = i));
      r.plots = ordered;
    } else {
      picked.forEach((p, i) => (p.order = i));
      r.plots = picked;
    }
  });

  // ---------------------------------------------------------------- roads
  const roads: number[][] = [];
  const byName = new Map(regions.map((r) => [r.name, r]));
  const roadMask = new Uint8Array(N);
  const routeCost = (start: number, goal: number) => (i: number) => {
    if (i === start || i === goal) return 1;
    const rv = reserved[i];
    if (rv === RESERVED_CORE || rv === RESERVED_PLOT || rv === RESERVED_ORE) return Infinity;
    const t = terrain[i];
    let c = 1;
    if (roadMask[i]) c = 0.35;
    else if (t === T.WATER) {
      if (!crossingZone[i]) return Infinity;
      c = 2.5;
    } else if (t === T.ROCK) c = 40;
    else if (t === T.HILL) c = 2.2;
    else if (t === T.MARSH) c = 2.2;
    else if (t === T.SAND) c = 1.4;
    else if (rv === RESERVED_PLAZA) c = 0.6;
    if (riverDist[i] < 1.2 && t !== T.WATER && !crossingZone[i]) c += 1.5;
    return c + hash2(i % W, (i / W) | 0, S + 31) * 0.5;
  };
  const plazaIdx = (r: RegionInfo) => Math.floor(r.py) * W + Math.floor(r.px);
  for (const [a, b] of def.roads) {
    const ra = byName.get(a);
    const rb = byName.get(b);
    if (!ra || !rb) throw new Error(`Unknown road endpoint ${a} / ${b}`);
    const s0 = plazaIdx(ra);
    const g0 = plazaIdx(rb);
    const path = gridAStar(W, H, s0, g0, routeCost(s0, g0), 0.35);
    if (!path) continue;
    roads.push(path);
    for (const i of path) {
      roadMask[i] = 1;
    }
  }
  for (let i = 0; i < N; i++) {
    if (!roadMask[i]) continue;
    const t = terrain[i];
    if (t === T.WATER) terrain[i] = crossingZone[i] === 2 ? T.SHALLOW : T.BRIDGE;
    else {
      terrain[i] = T.ROAD;
      if (!reserved[i]) reserved[i] = RESERVED_ROAD;
    }
  }
  // widen fords so they read clearly
  for (let i = 0; i < N; i++) {
    if (terrain[i] !== T.SHALLOW) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (terrain[ni] === T.WATER && crossingZone[ni] === 2) terrain[ni] = T.SHALLOW;
    }
  }

  // ---------------------------------------------------------------- farmland
  regions.forEach((r) => {
    const farm = r.features.includes('farmland');
    const nFields = farm ? rng.int(5, 8) : r.capitalSlot !== null ? 3 : r.tier >= 2 ? 2 : 0;
    let placed = 0;
    for (let attempt = 0; attempt < 120 && placed < nFields; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const rad = rng.range(r.coreSize / 2 + 5, 14);
      const fw = rng.int(3, 6);
      const fh = rng.int(2, 4);
      const x0 = Math.round(r.cx + Math.cos(a) * rad - fw / 2);
      const y0 = Math.round(r.cy + Math.sin(a) * rad - fh / 2);
      let ok = true;
      for (let y = y0; y < y0 + fh && ok; y++)
        for (let x = x0; x < x0 + fw && ok; x++) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) ok = false;
          else {
            const i = y * W + x;
            const t = terrain[i];
            if (reserved[i] || region[i] !== r.id || (t !== T.GRASS && t !== T.MEADOW && t !== T.DIRT) || ore[i]) ok = false;
          }
        }
      if (!ok) continue;
      const pattern = rng.int(0, 3);
      for (let y = y0; y < y0 + fh; y++)
        for (let x = x0; x < x0 + fw; x++) {
          terrain[y * W + x] = T.FARMLAND;
          crop[y * W + x] = pattern;
        }
      placed++;
    }
  });

  // ---------------------------------------------------------------- trees
  const forestSeeds = regions.filter((r) => r.features.includes('forest'));
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = terrain[i];
      if (t !== T.GRASS && t !== T.MEADOW && t !== T.HILL) continue;
      if (reserved[i]) continue;
      let d = fbm(x / 11, y / 11, 4, S + 33);
      for (const r of forestSeeds) {
        const dd = Math.hypot(x - r.cx, y - r.cy);
        const reach = r.capitalSlot !== null ? 20 : 17;
        const inner = r.capitalSlot !== null ? 9 : 4;
        if (dd < reach && dd > inner) d += 0.24 * (1 - dd / reach) + 0.05;
      }
      // clear around every settlement core
      let nearest = Infinity;
      for (const r of regions) {
        const dd = Math.hypot(x - r.cx, y - r.cy) - r.coreSize / 2;
        if (dd < nearest) nearest = dd;
      }
      if (nearest < 3.5) continue;
      if (nearest < 8) d -= (8 - nearest) * 0.03;
      // keep lanes beside roads mostly open
      let nearRoad = false;
      for (let dy = -1; dy <= 1 && !nearRoad; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ni = (y + dy) * W + (x + dx);
          if (roadMask[ni] || reserved[ni] === RESERVED_PLOT || reserved[ni] === RESERVED_ORE || reserved[ni] === RESERVED_PLAZA) {
            nearRoad = true;
            break;
          }
        }
      if (nearRoad) continue;
      if (riverDist[i] < 0.6) continue;
      const thresh = t === T.HILL ? 0.62 : 0.555;
      const jitter = (hash2(x, y, S + 37) - 0.5) * 0.08;
      const scatter = hash2(x, y, S + 41) < 0.012;
      if (d + jitter > thresh || scatter) {
        let sp = 1;
        const h = hash2(x, y, S + 43);
        if (t === T.HILL || y < 40 || height[i] > 0.5) sp = h < 0.8 ? 2 : 1;
        else sp = h < 0.6 ? 1 : h < 0.88 ? 3 : 2;
        if (hash2(x, y, S + 47) < 0.02) sp = 4;
        tree[i] = sp;
        treeHp[i] = 70 + Math.floor(hash2(x, y, S + 53) * 60);
        if (t !== T.HILL) terrain[i] = T.FOREST;
      }
    }
  }
  // forest floor halo
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tree[i] || (terrain[i] !== T.GRASS && terrain[i] !== T.MEADOW)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tree[(y + dy) * W + (x + dx)]) n++;
      if (n >= 4) terrain[i] = T.FOREST;
    }

  // ---------------------------------------------------------------- decor + story
  const decor: Decor[] = [];
  const solid = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    const i = ty * W + tx;
    if (reserved[i] || tree[i] || terrain[i] === T.WATER || terrain[i] === T.ROCK || roadMask[i]) return false;
    ore[i] = 3;
    return true;
  };
  const freeTile = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    const i = ty * W + tx;
    return !reserved[i] && !tree[i] && !ore[i] && terrain[i] !== T.WATER && terrain[i] !== T.ROCK;
  };
  const addDecor = (kind: string, tx: number, ty: number, blocks = false) => {
    if (!freeTile(Math.floor(tx), Math.floor(ty))) return;
    if (blocks && !solid(Math.floor(tx), Math.floor(ty))) return;
    decor.push({ kind, x: tx * TILE, y: ty * TILE, v: rng.int(0, 3), blocks });
  };
  for (const st of def.story) {
    const { x, y } = st;
    switch (st.kind) {
      case 'battlefield':
        for (let k = 0; k < 14; k++) addDecor(rng.pick(['broken_cart', 'shield', 'spear', 'helmet', 'banner_torn', 'barrel', 'bones']), x + rng.range(-5, 5), y + rng.range(-4, 4));
        break;
      case 'plague_village':
        for (let k = 0; k < 4; k++) addDecor('ruined_hut', x + rng.range(-4, 4), y + rng.range(-3, 3), true);
        addDecor('plague_cross', x, y + 2);
        for (let k = 0; k < 6; k++) addDecor(rng.pick(['bones', 'barrel', 'grave']), x + rng.range(-5, 5), y + rng.range(-4, 4));
        break;
      case 'collapsed_bridge':
        decor.push({ kind: 'bridge_ruin', x: x * TILE, y: y * TILE, v: 0 });
        break;
      case 'old_tower':
        addDecor('ruined_tower', x, y, true);
        break;
      case 'burned_farm':
        addDecor('burned_house', x, y, true);
        for (let k = 0; k < 5; k++) addDecor('charred', x + rng.range(-3, 3), y + rng.range(-3, 3));
        break;
      case 'graveyard':
        for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 4; gx++) addDecor('grave', x + gx * 1.2 - 2, y + gy * 1.3 - 1.5);
        addDecor('dead_tree', x + 3, y - 2);
        break;
      case 'stone_circle':
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          addDecor('standing_stone', x + Math.cos(a) * 3, y + Math.sin(a) * 2.4, true);
        }
        addDecor('altar_stone', x, y);
        break;
      case 'castle_ruin':
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          addDecor('ruin_wall', x + Math.cos(a) * 3.5, y + Math.sin(a) * 3, true);
        }
        addDecor('ruined_tower', x + 3, y - 3, true);
        break;
      case 'bandit_camp':
        for (let k = 0; k < 4; k++) addDecor('tent', x + rng.range(-4, 4), y + rng.range(-3, 3), true);
        addDecor('campfire', x, y);
        addDecor('crates', x + 2, y + 1);
        break;
      case 'windmill':
        addDecor('windmill', x, y, true);
        break;
      default:
        break;
    }
  }
  // scattered natural decor
  for (let k = 0; k < 900; k++) {
    const x = rng.range(1, W - 1);
    const y = rng.range(1, H - 1);
    const i = Math.floor(y) * W + Math.floor(x);
    const t = terrain[i];
    if (t === T.WATER || t === T.ROCK || reserved[i] || tree[i] || ore[i]) continue;
    if (t === T.ROAD || t === T.BRIDGE || t === T.FARMLAND) continue;
    let kind = rng.pick(['bush', 'bush', 'flowers', 'flowers', 'rock_small', 'tall_grass', 'tall_grass', 'mushrooms']);
    if (t === T.HILL) kind = rng.pick(['rock_small', 'rock_small', 'bush', 'boulder']);
    if (t === T.MARSH || t === T.SAND) kind = rng.pick(['reeds', 'reeds', 'rock_small']);
    if (t === T.FOREST) kind = rng.pick(['mushrooms', 'bush', 'log', 'fern', 'fern']);
    addDecor(kind, x, y, kind === 'boulder');
  }
  // reeds along water
  for (let k = 0; k < 600; k++) {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    const i = y * W + x;
    if (terrain[i] === T.WATER || riverDist[i] > 1.6 || reserved[i] || tree[i]) continue;
    if (terrain[i] === T.ROAD || terrain[i] === T.BRIDGE) continue;
    addDecor('reeds', x + rng.range(0, 1), y + rng.range(0, 1));
  }

  // ---------------------------------------------------------------- connectivity guarantee
  const passFn = (i: number) => {
    const t = terrain[i];
    return t !== T.WATER && t !== T.ROCK && !tree[i] && !ore[i] && reserved[i] !== RESERVED_CORE && reserved[i] !== RESERVED_ORE;
  };
  const startI = Math.floor(regions[0].py) * W + Math.floor(regions[0].px);
  for (let pass = 0; pass < 4; pass++) {
    const seen = floodFill(W, H, startI, passFn);
    let fixed = 0;
    for (const r of regions) {
      const gi = Math.floor(r.py) * W + Math.floor(r.px);
      if (seen[gi]) continue;
      const path = gridAStar(
        W,
        H,
        startI,
        gi,
        (i) => {
          const rv = reserved[i];
          if (rv === RESERVED_CORE || rv === RESERVED_ORE) return Infinity;
          const t = terrain[i];
          if (t === T.WATER) return crossingZone[i] ? 4 : 14;
          if (t === T.ROCK) return 8;
          if (tree[i]) return 3;
          if (ore[i]) return 6;
          return 1;
        },
        1,
      );
      if (!path) continue;
      for (const i of path) {
        if (terrain[i] === T.WATER) terrain[i] = T.BRIDGE;
        else if (terrain[i] === T.ROCK) terrain[i] = T.HILL;
        if (tree[i]) {
          tree[i] = 0;
          terrain[i] = T.GRASS;
        }
        if (ore[i] === 3) ore[i] = 0;
      }
      fixed++;
    }
    if (!fixed) break;
  }

  // ---------------------------------------------------------------- region stats
  const sumX = new Float64Array(regions.length);
  const sumY = new Float64Array(regions.length);
  const nb = regions.map(() => new Set<number>());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const rid = region[i];
      const r = regions[rid];
      r.tiles++;
      sumX[rid] += x;
      sumY[rid] += y;
      if (x < r.minX) r.minX = x;
      if (y < r.minY) r.minY = y;
      if (x > r.maxX) r.maxX = x;
      if (y > r.maxY) r.maxY = y;
      let isBorder = false;
      if (x < W - 1) {
        const o = region[i + 1];
        if (o !== rid) {
          nb[rid].add(o);
          nb[o].add(rid);
          isBorder = true;
        }
      }
      if (y < H - 1) {
        const o = region[i + W];
        if (o !== rid) {
          nb[rid].add(o);
          nb[o].add(rid);
          isBorder = true;
        }
      }
      if (isBorder) r.border.push(i);
    }
  }
  // ---------------------------------------------------------------- roadside furniture
  // signposts at junctions, milestones along long stretches, the odd wayside shrine (decorative only)
  {
    const ring: [number, number][] = [];
    for (let k = -2; k <= 2; k++) ring.push([k, -2]);
    for (let k = -1; k <= 2; k++) ring.push([2, k]);
    for (let k = 1; k >= -2; k--) ring.push([k, 2]);
    for (let k = 1; k >= -1; k--) ring.push([-2, k]);
    const placed: [number, number][] = [];
    const clear = (x: number, y: number, r: number) => placed.every(([px, py]) => Math.abs(px - x) + Math.abs(py - y) >= r);
    const beside = (x: number, y: number, kind: string, salt: number) => {
      const dirs: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
      const start = Math.floor(hash2(x, y, salt) * dirs.length);
      for (let k = 0; k < dirs.length; k++) {
        const [dx, dy] = dirs[(start + k) % dirs.length];
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1 || roadMask[ty * W + tx] || !freeTile(tx, ty)) continue;
        decor.push({ kind, x: tx * TILE + 8, y: ty * TILE + 12, v: Math.floor(hash2(tx, ty, salt + 1) * 4), blocks: false });
        placed.push([x, y]);
        return true;
      }
      return false;
    };
    for (let y = 3; y < H - 3; y++)
      for (let x = 3; x < W - 3; x++) {
        if (!roadMask[y * W + x] || terrain[y * W + x] === T.BRIDGE) continue;
        let arms = 0;
        let prev = roadMask[(y + ring[ring.length - 1][1]) * W + x + ring[ring.length - 1][0]];
        for (const [dx, dy] of ring) {
          const cur = roadMask[(y + dy) * W + x + dx];
          if (cur && !prev) arms++;
          prev = cur;
        }
        if (arms >= 3 && clear(x, y, 10)) beside(x, y, 'signpost', 701);
        else if (hash2(x, y, 703) < 0.02 && clear(x, y, 14)) beside(x, y, 'milestone', 705);
        else if (hash2(x, y, 707) < 0.005 && clear(x, y, 20)) beside(x, y, 'shrine', 709);
      }
  }

  regions.forEach((r) => {
    r.mx = sumX[r.id] / r.tiles;
    r.my = sumY[r.id] / r.tiles;
    r.neighbors = [...nb[r.id]].sort((a, b) => a - b);
  });

  return {
    id: def.id,
    name: def.name,
    w: W,
    h: H,
    seed,
    terrain,
    height,
    tree,
    treeHp,
    stump,
    ore,
    crop,
    region,
    occ: new Int32Array(N),
    gateOwner: new Int8Array(N),
    regions,
    deposits,
    decor,
    crossings: def.crossings,
    roads,
    story: def.story,
    version: 1,
    dirtyChunks: new Set(),
  };
}

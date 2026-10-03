import { fbm, hash2 } from '../../core/Random';
import { TILE } from '../../data/constants';
import { CHUNK, T, type GameMap } from '../../sim/map/GameMap';
import { BAYER4, RAMP } from './palette';
import { pack, rgb, toPacked } from './PixelCanvas';

/**
 * Terrain is painted per pixel into chunk canvases. Tile kinds are sampled through a smooth
 * domain warp so boundaries between grass, sand, water and rock are organic rather than square.
 * Lighting comes from the height field (light from the top-left) and colours are quantised
 * onto the master ramps with ordered dithering for a hand-pixelled look.
 */

type PRamp = Uint32Array;
const P = (r: string[]): PRamp => new Uint32Array(r.map((c) => toPacked(c)));

interface Ramps {
  grass: PRamp;
  meadow: PRamp;
  forest: PRamp;
  hill: PRamp;
  dirt: PRamp;
  road: PRamp;
  sand: PRamp;
  rock: PRamp;
  snow: PRamp;
  water: PRamp;
  shallow: PRamp;
  marsh: PRamp;
  wheat: PRamp;
  crops: PRamp;
  plowed: PRamp;
  flax: PRamp;
  wood: PRamp;
  stone: PRamp;
}

let RP: Ramps | null = null;
function ramps(): Ramps {
  if (!RP) {
    RP = {
      grass: P(RAMP.grass),
      meadow: P(RAMP.meadow),
      forest: P(RAMP.forest),
      hill: P(RAMP.hill),
      dirt: P(RAMP.dirt),
      road: P(RAMP.road),
      sand: P(RAMP.sand),
      rock: P(RAMP.rock),
      snow: P(RAMP.snow),
      water: P(RAMP.water),
      shallow: P(RAMP.shallow),
      marsh: P(RAMP.marsh),
      wheat: P(RAMP.wheat),
      crops: P(RAMP.crops),
      plowed: P(RAMP.plowed),
      flax: P(RAMP.flax),
      wood: P(RAMP.wood),
      stone: P(RAMP.stone),
    };
  }
  return RP;
}

function q(r: PRamp, v: number, x: number, y: number, dither = 1): number {
  const n = r.length;
  let i = Math.round(v * (n - 1) + BAYER4[(x & 3) + ((y & 3) << 2)] * dither);
  if (i < 0) i = 0;
  else if (i >= n) i = n - 1;
  return r[i];
}

/** Precomputed fields shared by all chunks. */
export interface TerrainFields {
  /** warp offsets sampled every 4 px */
  warpX: Float32Array;
  warpY: Float32Array;
  ww: number;
  wh: number;
  /** tileable 256² detail noise */
  noise: Float32Array;
  /** signed distance to water in tiles (positive on land) */
  shore: Float32Array;
  /** per tile bridge style 0 wood 1 stone */
  bridgeStone: Uint8Array;
  /** smoothed road polylines in world px: [x0,y0,x1,y1, ...] per segment */
  roadSegs: Float32Array;
  /** per 4px cell: lighting term, interpolated height, shore distance */
  light: Float32Array;
  hgt: Float32Array;
  shore4: Float32Array;
}

function chaikin(pts: [number, number][], iters: number): [number, number][] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) return p;
    const out: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export function buildFields(map: GameMap): TerrainFields {
  const ww = Math.ceil((map.w * TILE) / 4) + 2;
  const wh = Math.ceil((map.h * TILE) / 4) + 2;
  const warpX = new Float32Array(ww * wh);
  const warpY = new Float32Array(ww * wh);
  const s = map.seed % 977;
  for (let y = 0; y < wh; y++)
    for (let x = 0; x < ww; x++) {
      const wx = x * 4;
      const wy = y * 4;
      warpX[y * ww + x] = (fbm(wx / 30, wy / 30, 3, 501 + s) - 0.5) * 30 + (fbm(wx / 9, wy / 9, 2, 211 + s) - 0.5) * 8;
      warpY[y * ww + x] = (fbm(wx / 30, wy / 30, 3, 733 + s) - 0.5) * 30 + (fbm(wx / 9, wy / 9, 2, 377 + s) - 0.5) * 8;
    }
  const noise = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      // tileable by sampling on a torus-ish blend
      const a = fbm(x / 9, y / 9, 3, 91);
      const b = fbm((x + 256) / 9, y / 9, 3, 91);
      const c = fbm(x / 9, (y + 256) / 9, 3, 91);
      const d = fbm((x + 256) / 9, (y + 256) / 9, 3, 91);
      const u = x / 256;
      const v = y / 256;
      noise[y * 256 + x] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
  // shore distance via two-pass chamfer on tile grid
  const W = map.w;
  const H = map.h;
  const INF = 1e6;
  const dl = new Float32Array(W * H); // distance to water for land
  const dw = new Float32Array(W * H); // distance to land for water
  for (let i = 0; i < W * H; i++) {
    const water = map.terrain[i] === T.WATER || map.terrain[i] === T.SHALLOW || map.terrain[i] === T.BRIDGE;
    dl[i] = water ? 0 : INF;
    dw[i] = water ? INF : 0;
  }
  const chamfer = (d: Float32Array) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) v = Math.min(v, d[i - W] + 1);
        if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + 1.414);
        if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + 1.414);
        d[i] = v;
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = d[i];
        if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < H - 1) v = Math.min(v, d[i + W] + 1);
        if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + 1.414);
        if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + 1.414);
        d[i] = v;
      }
  };
  chamfer(dl);
  chamfer(dw);
  const shore = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) shore[i] = dl[i] > 0 ? dl[i] - 0.5 : -(dw[i] - 0.5);
  const bridgeStone = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (map.terrain[i] !== T.BRIDGE) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let best = Infinity;
    let stone = 0;
    for (const c of map.crossings) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < best) {
        best = d;
        stone = /Stone|Crown/.test(c.name) ? 1 : 0;
      }
    }
    bridgeStone[i] = stone;
  }
  const segs: number[] = [];
  for (const path of map.roads) {
    const pts: [number, number][] = [];
    for (let k = 0; k < path.length; k++) {
      if (k % 2 === 1 && k !== path.length - 1) continue;
      const i = path[k];
      pts.push([(i % W) * TILE + 8, ((i / W) | 0) * TILE + 8]);
    }
    const sm = chaikin(pts, 3);
    for (let k = 0; k < sm.length - 1; k++) segs.push(sm[k][0], sm[k][1], sm[k + 1][0], sm[k + 1][1]);
  }
  const light = new Float32Array(ww * wh);
  const hgt = new Float32Array(ww * wh);
  const shore4 = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y++)
    for (let x = 0; x < ww; x++) {
      const htx = (x * 4) / TILE - 0.5;
      const hty = (y * 4) / TILE - 0.5;
      const hr = sampleField(map.height, W, H, htx + 0.25, hty);
      const hd = sampleField(map.height, W, H, htx, hty + 0.25);
      const hl = sampleField(map.height, W, H, htx - 0.25, hty);
      const hu = sampleField(map.height, W, H, htx, hty - 0.25);
      light[y * ww + x] = (hr - hl + (hd - hu)) * 3.2;
      hgt[y * ww + x] = sampleField(map.height, W, H, htx, hty);
      shore4[y * ww + x] = sampleField(shore, W, H, htx, hty);
    }
  return { warpX, warpY, ww, wh, noise, shore, bridgeStone, roadSegs: new Float32Array(segs), light, hgt, shore4 };
}

function sampleField(f: Float32Array, fw: number, fh: number, x: number, y: number): number {
  // bilinear, x/y in field cells
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > fw - 1.001) x = fw - 1.001;
  if (y > fh - 1.001) y = fh - 1.001;
  const xi = x | 0;
  const yi = y | 0;
  const xf = x - xi;
  const yf = y - yi;
  const i = yi * fw + xi;
  const a = f[i];
  const b = f[i + 1];
  const c = f[i + fw];
  const d = f[i + fw + 1];
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

const M_WATER = 100;
const M_BRIDGE = 101;
const isW = (v: number) => v === M_WATER;

/**
 * Paint one chunk (CHUNK×CHUNK tiles) into an RGBA Uint32 buffer of size (CHUNK*TILE)².
 */
export function paintChunk(map: GameMap, f: TerrainFields, cx: number, cy: number, out: Uint32Array) {
  const R = ramps();
  const S = CHUNK * TILE;
  const W = map.w;
  const H = map.h;
  const ox = cx * S;
  const oy = cy * S;
  const B = 2; // border for neighbour checks
  const MW = S + B * 2;
  const mat = new Uint8Array(MW * MW);
  const tileOf = new Int32Array(MW * MW);
  const roadD = new Float32Array(MW * MW).fill(99);
  const roadDX = new Float32Array(MW * MW);
  const roadDY = new Float32Array(MW * MW);
  const wpx = W * TILE;
  const hpx = H * TILE;
  // ---- road distance field from smoothed polylines
  const segs = f.roadSegs;
  const ROAD_HW = 4.6;
  const reach = ROAD_HW + 3;
  for (let k = 0; k < segs.length; k += 4) {
    const ax = segs[k] - ox + B;
    const ay = segs[k + 1] - oy + B;
    const bx = segs[k + 2] - ox + B;
    const by = segs[k + 3] - oy + B;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const maxX = Math.min(MW - 1, Math.ceil(Math.max(ax, bx) + reach));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const maxY = Math.min(MW - 1, Math.ceil(Math.max(ay, by) + reach));
    if (minX > maxX || minY > maxY) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const len = Math.sqrt(l2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - (x + 0.5);
        const ey = ay + dy * t - (y + 0.5);
        const d = Math.sqrt(ex * ex + ey * ey);
        const mi = y * MW + x;
        if (d < roadD[mi]) {
          roadD[mi] = d;
          roadDX[mi] = dx / len;
          roadDY[mi] = dy / len;
        }
      }
    }
  }
  // ---- material pass
  for (let y = -B; y < S + B; y++) {
    for (let x = -B; x < S + B; x++) {
      const wx = ox + x;
      const wy = oy + y;
      const mi = (y + B) * MW + (x + B);
      if (wx < 0 || wy < 0 || wx >= wpx || wy >= hpx) {
        mat[mi] = T.GRASS;
        tileOf[mi] = 0;
        continue;
      }
      const t0x = (wx / TILE) | 0;
      const t0y = (wy / TILE) | 0;
      const i0 = t0y * W + t0x;
      const t0 = map.terrain[i0];
      const dx = sampleField(f.warpX, f.ww, f.wh, wx / 4, wy / 4);
      const dy = sampleField(f.warpY, f.ww, f.wh, wx / 4, wy / 4);
      const amp = t0 === T.FARMLAND ? 0.12 : t0 === T.SHALLOW ? 0.3 : 1;
      let tx = Math.floor((wx + dx * amp) / TILE);
      let ty = Math.floor((wy + dy * amp) / TILE);
      if (tx < 0) tx = 0;
      if (ty < 0) ty = 0;
      if (tx >= W) tx = W - 1;
      if (ty >= H) ty = H - 1;
      let ti = ty * W + tx;
      let t1: number = map.terrain[ti];
      if (t1 === T.FARMLAND && t0 !== T.FARMLAND) {
        // fields keep straight edges
        t1 = t0 === T.ROAD ? T.GRASS : t0;
        ti = i0;
      } else if (t0 === T.FARMLAND && t1 !== T.FARMLAND) {
        t1 = T.FARMLAND;
        ti = i0;
      }
      if (t1 === T.ROAD) t1 = T.GRASS;
      let m = t1 === T.WATER || t1 === T.BRIDGE ? M_WATER : t1;
      // roads overlay
      const rd = roadD[mi];
      const hw = ROAD_HW + (hash2(wx >> 2, wy >> 2, 5) - 0.5) * 1.2;
      if (rd < hw) {
        if (t0 === T.BRIDGE || t0 === T.WATER || (m === M_WATER && t0 !== T.SHALLOW)) m = rd < hw - 0.2 ? M_BRIDGE : m;
        else if (t0 === T.SHALLOW || t1 === T.SHALLOW) m = T.SHALLOW;
        else m = T.ROAD;
      }
      mat[mi] = m;
      tileOf[mi] = ti;
    }
  }
  // ---- colour pass
  const noise = f.noise;
  const foam = toPacked(RAMP.foam);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = ox + x;
      const wy = oy + y;
      const mi = (y + B) * MW + (x + B);
      const m = mat[mi];
      const ti = tileOf[mi];
      const nz = noise[(((wy >> 1) & 255) << 8) | ((wx >> 1) & 255)];
      const nzf = noise[((wy & 255) << 8) | (wx & 255)];
      const nz2 = noise[(((wy >> 3) & 255) << 8) | ((wx >> 3) & 255)];
      const fine = hash2(wx, wy, 7);
      // height-based lighting
      const fx = wx / 4;
      const fy = wy / 4;
      const hc = sampleField(f.hgt, f.ww, f.wh, fx, fy);
      const light = sampleField(f.light, f.ww, f.wh, fx, fy);
      const shoreD = sampleField(f.shore4, f.ww, f.wh, fx, fy);
      let c = 0;
      const mU = mat[mi - MW];
      const mD = mat[mi + MW];
      const mL = mat[mi - 1];
      const mR = mat[mi + 1];
      const nearWater = isW(mU) || isW(mD) || isW(mL) || isW(mR);
      switch (m) {
        case T.GRASS:
        case T.MEADOW: {
          const r = m === T.GRASS ? R.grass : R.meadow;
          let v = 0.5 + (nz - 0.5) * 1.1 + (nz2 - 0.5) * 0.7 + (nzf - 0.5) * 0.25 + light;
          if (shoreD < 1.2) v -= (1.2 - shoreD) * 0.15;
          c = q(r, v, wx, wy, 0.55);
          if (fine < 0.006) c = r[r.length - 1];
          break;
        }
        case T.FOREST: {
          const v = 0.42 + (nz - 0.5) * 1.0 + (nz2 - 0.5) * 0.4 + light * 0.6;
          c = q(R.forest, v, wx, wy, 0.6);
          if (fine < 0.015) c = R.dirt[2];
          else if (fine > 0.99) c = R.grass[3];
          break;
        }
        case T.HILL: {
          const v = 0.5 + (nz - 0.5) * 0.9 + (nz2 - 0.5) * 0.4 + light * 1.4;
          c = q(R.hill, v, wx, wy, 0.6);
          if (fine < 0.008) c = R.rock[5];
          break;
        }
        case T.DIRT: {
          const v = 0.5 + (nz - 0.5) * 0.9 + light;
          c = q(R.dirt, v, wx, wy, 0.6);
          if (fine < 0.025) c = R.dirt[fine < 0.012 ? 5 : 1];
          break;
        }
        case T.ROAD: {
          const rd = roadD[mi];
          let v = 0.62 + (nz - 0.5) * 0.5 + (nzf - 0.5) * 0.2 + light * 0.5;
          if (rd > ROAD_HW - 1.6) v -= 0.28;
          else if (Math.abs(rd - 2.2) < 0.6) v -= 0.12; // cart ruts
          c = q(R.road, v, wx, wy, 0.5);
          if (fine < 0.03) c = R.road[fine < 0.015 ? 5 : 1];
          break;
        }
        case T.SAND: {
          const v = 0.55 + (nz - 0.5) * 0.6 + light * 0.5 + Math.min(0.2, (shoreD - 0.3) * 0.15);
          c = q(R.sand, v, wx, wy, 0.6);
          if (fine < 0.01) c = R.stone[4];
          break;
        }
        case T.MARSH: {
          const pool = nz2 > 0.56 && nz > 0.5;
          if (pool) c = q(R.shallow, 0.15 + (nzf - 0.5), wx, wy);
          else c = q(R.marsh, 0.5 + (nz - 0.5) * 1.1, wx, wy, 0.6);
          if (fine < 0.03 && !pool) c = R.grass[5];
          break;
        }
        case T.ROCK: {
          let v = 0.42 + (nz - 0.5) * 0.7 + (nzf - 0.5) * 0.25 + light * 1.5 + (hc - 0.9) * 0.35;
          if (mD !== T.ROCK) v -= 0.3;
          else if (mat[mi + MW * 2] !== T.ROCK) v -= 0.15;
          if (mU !== T.ROCK) v += 0.2;
          // crack lines
          if (Math.abs(nzf - 0.5) < 0.015) v -= 0.25;
          c = q(R.rock, v, wx, wy, 0.7);
          if (hc > 1.08 && nz > 0.45 && mD === T.ROCK) c = q(R.snow, 0.4 + light * 2 + (nz - 0.5), wx, wy);
          break;
        }
        case T.FARMLAND: {
          const pat = map.crop[ti];
          const isEdge = mU !== T.FARMLAND || mD !== T.FARMLAND || mL !== T.FARMLAND || mR !== T.FARMLAND;
          if (isEdge) {
            c = (mD !== T.FARMLAND || mR !== T.FARMLAND) ? R.grass[1] : q(R.dirt, 0.25 + (nz - 0.5) * 0.4, wx, wy);
            break;
          }
          if (pat === 0) {
            const row = wy % 3;
            c = row === 0 ? R.wheat[1] : q(R.wheat, 0.45 + (row === 1 ? 0.25 : 0) + (nz - 0.5) * 0.6, wx, wy, 0.5);
          } else if (pat === 1) {
            const row = wy % 4;
            const plant = ((wx + (row === 2 ? 2 : 0)) & 3) < 3;
            c = row === 0 || row === 3 ? R.plowed[1] : plant ? q(R.crops, 0.45 + (nz - 0.5) * 0.8 + (row === 1 ? 0.25 : 0), wx, wy, 0.4) : R.plowed[2];
          } else if (pat === 2) {
            const row = wy % 3;
            c = row === 0 ? R.plowed[0] : q(R.plowed, 0.5 + (row === 1 ? 0.3 : 0) + (nz - 0.5) * 0.5, wx, wy, 0.4);
          } else {
            const row = wx % 3;
            c = row === 0 ? R.crops[0] : q(R.grass, 0.55 + (row === 1 ? 0.2 : 0) + (nz - 0.5) * 0.5, wx, wy, 0.4);
            if (fine < 0.03) c = toPacked('#e8d870');
          }
          break;
        }
        case T.SHALLOW: {
          const v = 0.5 + (nz - 0.5) * 0.7 + Math.sin((wx + wy * 0.5) * 0.45) * 0.08;
          c = q(R.shallow, v, wx, wy);
          if (nz2 > 0.58 && nzf > 0.5) c = R.stone[3 + (((fine * 10) | 0) % 3)];
          break;
        }
        case M_BRIDGE: {
          const stone = f.bridgeStone[ti] === 1 || f.bridgeStone[(((wy / TILE) | 0) * W + ((wx / TILE) | 0))] === 1;
          const dxr = roadDX[mi];
          const dyr = roadDY[mi];
          const along = wx * dxr + wy * dyr;
          const rd = roadD[mi];
          const al = Math.floor(along);
          if (rd > ROAD_HW - 1.5) {
            c = stone ? R.stone[rd > ROAD_HW - 0.8 ? 1 : 5] : R.wood[rd > ROAD_HW - 0.8 ? 1 : 5];
          } else if (stone) {
            const across = wx * -dyr + wy * dxr;
            const brick = ((al >> 2) + (((Math.floor(across) >> 2) & 1) << 1)) & 3;
            c = q(R.stone, 0.45 + brick * 0.08 + (nz - 0.5) * 0.4, wx, wy, 0.4);
            if ((al & 3) === 0) c = R.stone[2];
          } else {
            const plank = (al >> 2) & 1;
            c = q(R.wood, 0.5 + plank * 0.15 + (nzf - 0.5) * 0.3, wx, wy, 0.4);
            if ((al & 3) === 0) c = R.wood[1];
          }
          break;
        }
        case M_WATER: {
          const depth = Math.min(1, Math.max(0, -shoreD / 3));
          let v = 0.82 - depth * 0.7 + (nz - 0.5) * 0.3 + (nz2 - 0.5) * 0.2;
          const wave = Math.sin(wx * 0.3 + Math.sin(wy * 0.19) * 2.2 + nz * 7);
          if (wave > 0.94 && depth > 0.12) v += 0.25;
          c = q(R.water, v, wx, wy, 0.8);
          const edge = !isW(mU) && mU !== M_BRIDGE || !isW(mD) && mD !== M_BRIDGE || !isW(mL) && mL !== M_BRIDGE || !isW(mR) && mR !== M_BRIDGE;
          if (edge) c = foam;
          else if (!isW(mat[mi - MW * 2]) && mat[mi - MW * 2] !== M_BRIDGE) c = R.water[7];
          // bridge shadow on water
          if (mU === M_BRIDGE || mat[mi - MW * 2] === M_BRIDGE) c = R.water[1];
          break;
        }
        default:
          c = R.grass[3];
      }
      if (m !== M_WATER && m !== T.SHALLOW && m !== M_BRIDGE && nearWater) {
        c = pack((c & 255) * 0.7, ((c >>> 8) & 255) * 0.72, ((c >>> 16) & 255) * 0.8);
      }
      if (m !== T.ROCK && mU === T.ROCK) {
        c = pack((c & 255) * 0.62, ((c >>> 8) & 255) * 0.62, ((c >>> 16) & 255) * 0.72);
      }
      out[y * S + x] = c;
    }
  }
  // ---- detail pass: tufts, pebbles, flowers (deterministic per chunk)
  const put = (x: number, y: number, col: number) => {
    if (x >= 0 && y >= 0 && x < S && y < S) out[y * S + x] = col;
  };
  const grassHi = R.grass[6];
  const grassLo = R.grass[1];
  const meadowHi = R.meadow[5];
  const flowerCols = ['#f0d860', '#f4f0e8', '#e07890', '#9ab0f0', '#f09a50'].map((h) => toPacked(h));
  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      const gx = cx * CHUNK + tx;
      const gy = cy * CHUNK + ty;
      if (gx >= W || gy >= H) continue;
      const ti = gy * W + gx;
      if (map.tree[ti] || map.ore[ti]) continue;
      for (let k = 0; k < 3; k++) {
        const h = hash2(gx * 3 + k, gy, 99);
        const px = tx * TILE + ((hash2(gx, gy * 3 + k, 11) * 14) | 0) + 1;
        const py = ty * TILE + ((hash2(gx * 7 + k, gy, 13) * 13) | 0) + 2;
        const t = mat[(py + B) * MW + (px + B)];
        if (t === T.GRASS || t === T.MEADOW) {
          if (h < 0.42) {
            put(px, py, t === T.MEADOW ? meadowHi : grassHi);
            put(px - 1, py - 1, grassHi);
            put(px + 1, py - 1, grassHi);
            put(px, py + 1, grassLo);
            put(px - 1, py, grassLo);
          } else if (h < 0.5 && t === T.MEADOW) {
            const fc = flowerCols[((h * 1000) | 0) % flowerCols.length];
            put(px, py, fc);
            put(px, py + 1, grassLo);
          } else if (h < 0.52) {
            put(px, py, flowerCols[((h * 1000) | 0) % flowerCols.length]);
          }
        } else if (t === T.DIRT || t === T.ROAD) {
          if (h < 0.25) {
            put(px, py, R.stone[5]);
            put(px + 1, py, R.stone[3]);
            put(px, py + 1, R.dirt[0]);
            put(px + 1, py + 1, R.dirt[1]);
          }
        } else if (t === T.FOREST) {
          if (h < 0.35) {
            put(px, py, R.forest[4]);
            put(px + 1, py - 1, R.grass[2]);
            put(px - 1, py - 1, R.grass[2]);
          }
        } else if (t === T.HILL) {
          if (h < 0.3) {
            put(px, py, R.rock[6]);
            put(px + 1, py, R.rock[4]);
            put(px, py + 1, R.rock[2]);
            put(px + 1, py + 1, R.rock[1]);
          }
        }
      }
    }
  }
}

/** Colour for the minimap per tile. */
export function minimapColor(map: GameMap, i: number): [number, number, number] {
  const t = map.terrain[i];
  if (map.tree[i]) return rgb(map.tree[i] === 2 ? '#24452a' : '#2c5226');
  if (map.ore[i] === 1) return rgb('#d8b648');
  if (map.ore[i] === 2) return rgb('#a7a1aa');
  switch (t) {
    case T.WATER:
      return rgb('#2a4c84');
    case T.SHALLOW:
      return rgb('#4f8cb0');
    case T.ROCK:
      return rgb('#5e5763');
    case T.HILL:
      return rgb('#6b843f');
    case T.SAND:
      return rgb('#bea773');
    case T.ROAD:
      return rgb('#a9946c');
    case T.BRIDGE:
      return rgb('#8a5d38');
    case T.FARMLAND:
      return rgb('#c29f43');
    case T.MARSH:
      return rgb('#416042');
    case T.FOREST:
      return rgb('#33532b');
    case T.MEADOW:
      return rgb('#7da647');
    case T.DIRT:
      return rgb('#8d6b47');
    default:
      return rgb('#5e963e');
  }
}

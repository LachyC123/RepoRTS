/**
 * Procedural pixel-art buildings for the 3/4 top-down view.
 *
 * Every building is assembled from a small kit of material-aware primitives (walls, roofs, towers,
 * doors, windows, props) drawn back-to-front onto an object layer, which is then outlined and
 * composited over a ground layer (yard + soft lower-right shadow). The same primitives understand
 * the building state, so construction / damage / ruin variants fall out of the same drawing code:
 *   construction1 → foundations, low walls, timber frame, no roofs
 *   construction2 → full walls, rafters with partial roof covering, scaffolding
 *   damaged       → roof holes, cracks, scorch marks
 *   ruined        → jagged broken walls, roofs mostly gone (interior + rubble visible)
 *
 * Conventions: light from the top-left, shadows cool purple-black (`shade`), team colour only on
 * cloth / trims. Anchor (ax, ay) = bottom-centre of the footprint's south edge (ground line).
 * Sprite width is always size*16 + 6 (3px overhang per side); height varies (cropped on top).
 */
import type { KingdomColor } from '../../data/factions';
import type { LandmarkKind } from '../../data/map_crownshire';
import { hash2 } from '../../core/Random';
import { PixelCanvas, mix, shade } from './PixelCanvas';
import { BAYER4, OUTLINE, RAMP } from './palette';
import { blob } from './propArt';

export interface BuildingSprite {
  pc: PixelCanvas;
  ax: number;
  ay: number;
}
export type BuildingState = 'built' | 'construction1' | 'construction2' | 'damaged' | 'ruined';
export interface BuildingOpts {
  tier?: number;
  variant?: number;
  landmark?: LandmarkKind | null;
  deposit?: 'gold' | 'stone' | null;
}

export type RoofMat = 'thatch' | 'tile' | 'slate' | 'shingle' | 'lead';
export type WallMat = 'stone' | 'ashlar' | 'rough' | 'timber' | 'logs' | 'planks' | 'plaster' | 'barn' | 'charred';
export interface Team {
  main: string;
  light: string;
  dark: string;
  symbol: KingdomColor['symbol'];
}

export const TILE = 16;
const W = RAMP.wood;
const S = RAMP.stone;
const PL = RAMP.plaster;
const M = RAMP.metal;
const GD = RAMP.goldm;
const TH = RAMP.thatch;
const FI = RAMP.fire;
export const HAY = ['#6e521c', ...RAMP.hay, '#ead27a'];
export const ROCK = RAMP.rock.slice(1);
export const LEAF = ['#16301c', '#1f4022', '#2a5228', '#36652e', '#457a35', '#578f3e', '#6ca44a'];
export const BARN = ['#341816', '#4e221c', '#6a2e24', '#82392a', '#9a4a34', '#ae5e42'];
export const ASH = ['#47403f', '#5c5452', '#736a66', '#8b827b', '#a39a90', '#bab1a4', '#cfc7b8'];
export const CHAR = ['#141012', '#1e1716', '#2a201c', '#382a22', '#46362a'];
export const ROUGH = ['#463e48', '#5a5058', '#6e6468', '#847a78', '#9a908a', '#b0a69c'];
export const DARK = '#1c141e';
export const INTERIOR = '#2e2428';
export const SOOT = '#1a1216';
export const GLASS = '#252c44';
export const GLASS_HI = '#62769c';
export const LIT = ['#9a5a26', '#d89a3c', '#f6cf6a'];
export const ENDG = ['#6e4a2c', '#a07a4a', '#c8a070'];
export const CREAM = '#eadfc4';
export const NEUTRAL_TEAM: Team = { main: '#8c7f6c', light: '#c9bda6', dark: '#4a4136', symbol: 'circle' };
const BANDIT: Team = { main: '#5a3a32', light: '#8a6a58', dark: '#2e1e1c', symbol: 'triangle' };

export const ROOF: Record<RoofMat, readonly string[]> = {
  thatch: TH,
  tile: RAMP.tile,
  slate: ['#22263a', '#2e3448', '#3c4459', '#4d566d', '#616b83', '#7a849b'],
  shingle: ['#2c2422', '#3e332e', '#52453c', '#685a4c', '#7e6e5c', '#94846e'],
  lead: M.slice(1, 7),
};

// ------------------------------------------------------------------------------------ helpers
export const md = (a: number, n: number) => ((a % n) + n) % n;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** quantise v∈[0,1] onto a ramp, optional ordered dithering */
export function rv(r: readonly string[], v: number, x = 0, y = 0, d = 0): string {
  const n = r.length;
  const i = Math.round(v * (n - 1) + (d ? BAYER4[(x & 3) + ((y & 3) << 2)] * d : 0));
  return r[i < 0 ? 0 : i >= n ? n - 1 : i];
}

export function vnoise(x: number, period: number, seed: number) {
  const f0 = x / period;
  const i = Math.floor(f0);
  const f = f0 - i;
  const t = f * f * (3 - 2 * f);
  const a = hash2(i, 17, seed);
  const b = hash2(i + 1, 17, seed);
  return a + (b - a) * t;
}

export function vnoise2(x: number, y: number, period: number, seed: number) {
  const fx = x / period;
  const fy = y / period;
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  const u = fx - xi;
  const v = fy - yi;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

// ------------------------------------------------------------------------------------ context
export interface Ctx {
  size: number;
  state: BuildingState;
  team: Team | null;
  /** team or neutral cloth for banners that always show */
  tc: Team;
  seed: number;
  variant: number;
  tier: number;
  base: PixelCanvas;
  pc: PixelCanvas;
  W: number;
  H: number;
  ax: number;
  ay: number;
  /** footprint: x ∈ [L,R), y ∈ [F,G) */
  L: number;
  R: number;
  F: number;
  G: number;
  con: number;
  dmg: number;
}

export function makeCtx(size: number, top: number, team: Team | null, state: BuildingState, variant = 0, tier = 3, salt = 0): Ctx {
  const Wd = size * TILE + 6;
  const H = top + size * TILE + 4;
  const ay = H - 4;
  return {
    size,
    state,
    team,
    tc: team ?? NEUTRAL_TEAM,
    seed: (variant * 101 + size * 13 + salt * 7 + 5) | 0,
    variant,
    tier,
    base: new PixelCanvas(Wd, H),
    pc: new PixelCanvas(Wd, H),
    W: Wd,
    H,
    ax: size * 8 + 3,
    ay,
    L: 3,
    R: 3 + size * TILE,
    F: ay - size * TILE,
    G: ay,
    con: state === 'construction1' ? 1 : state === 'construction2' ? 2 : 0,
    dmg: state === 'damaged' ? 1 : state === 'ruined' ? 2 : 0,
  };
}

export function teamOf(k: KingdomColor | null): Team | null {
  return k ? { main: k.main, light: k.light, dark: k.dark, symbol: k.symbol } : null;
}

/** scorch marks on the object layer (damaged / ruined / burned) */
export function scorch(c: Ctx, n: number, strength: number) {
  const p = c.pc;
  for (let k = 0; k < n; k++) {
    let sx = -1;
    let sy = -1;
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.floor(hash2(k, tries, c.seed + 71) * p.w);
      const y = Math.floor(hash2(tries, k, c.seed + 73) * p.h);
      if (p.get(x, y) >>> 24) {
        sx = x;
        sy = y;
        break;
      }
    }
    if (sx < 0) continue;
    const r = 2.5 + hash2(k, 3, c.seed) * 3;
    for (let y = Math.floor(sy - r * 1.6); y <= sy + r; y++)
      for (let x = Math.floor(sx - r); x <= sx + r; x++) {
        if (!(p.get(x, y) >>> 24)) continue;
        // soot streaks upward
        const dy = y < sy ? (y - sy) / 1.6 : y - sy;
        const d = Math.sqrt((x - sx) ** 2 + dy * dy) / r;
        if (d > 1) continue;
        const a = (1 - d) * strength + (hash2(x, y, c.seed) - 0.5) * 0.1;
        if (a > 0.08) p.blend(x, y, SOOT, Math.min(0.85, a));
      }
  }
}

/** outline, cast the soft lower-right shadow onto the ground layer, composite, crop */
export function finish(c: Ctx, opt: { noShadow?: boolean } = {}): BuildingSprite {
  const { pc, base, W: w, H: h } = c;
  if (c.dmg === 1) scorch(c, 4, 0.55);
  if (c.dmg === 2) scorch(c, 8, 0.7);
  pc.outline(OUTLINE, 0.65);
  if (!opt.noShadow) {
    const sh = new Float32Array(w * h);
    const offs: [number, number, number][] = [
      [1, 1, 0.34],
      [2, 1, 0.3],
      [3, 2, 0.16],
    ];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!(pc.data[y * w + x] >>> 24)) continue;
        for (const [dx, dy, a] of offs) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx >= w || ty >= h) continue;
          const i = ty * w + tx;
          if (sh[i] < a) sh[i] = a;
        }
      }
    for (let i = 0; i < w * h; i++) {
      if (sh[i] <= 0 || pc.data[i] >>> 24) continue;
      base.blend(i % w, Math.floor(i / w), '#140e1c', sh[i]);
    }
  }
  base.draw(pc, 0, 0);
  // crop transparent rows on top
  let top = 0;
  outer: for (; top < h; top++) for (let x = 0; x < w; x++) if (base.data[top * w + x] >>> 24) break outer;
  top = Math.max(0, top - 1);
  if (top === 0) return { pc: base, ax: c.ax, ay: c.ay };
  const out = new PixelCanvas(w, h - top);
  out.data.set(base.data.subarray(top * w));
  return { pc: out, ax: c.ax, ay: c.ay - top };
}

// ------------------------------------------------------------------------------------ ground
export type YardKind = 'dirt' | 'cobble' | 'straw' | 'mud' | 'gravel' | 'ash' | 'flag';
const COBBLE = ['#5c5258', '#6c6266', '#7c7274', '#8c8282', '#9e9490'];
const DIRT = ['#5a4430', '#6a5238', '#7a6142', '#88704e', '#97805c'];
/** ground patch on the base layer; edges fade out (semi-transparent) so it blends with terrain */
export function yard(c: Ctx, kind: YardKind, x0: number, y0: number, w: number, h: number, rad = 4) {
  const b = c.base;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const ex = Math.min(x - x0, x0 + w - 1 - x);
      const ey = Math.min(y - y0, y0 + h - 1 - y);
      let e = Math.min(ex, ey);
      if (ex < rad && ey < rad) e = rad - Math.hypot(rad - ex, rad - ey);
      e += (vnoise2(x, y, 3, c.seed + 2) - 0.5) * 2.2;
      if (e < 0) continue;
      const alpha = e < 1 ? 0.4 : e < 2 ? 0.7 : 0.92;
      const n = vnoise2(x, y, 5, c.seed + 11);
      let col: string;
      switch (kind) {
        case 'cobble':
        case 'flag': {
          // irregular rounded cobbles on a jittered grid
          const cw = kind === 'flag' ? 5 : 4;
          const ch = kind === 'flag' ? 4 : 3;
          const row = Math.floor(y / ch);
          const xo = x + (row & 1) * Math.floor(cw / 2) + Math.floor(hash2(row, 3, c.seed) * 2);
          const col0 = Math.floor(xo / cw);
          const lx = xo - col0 * cw;
          const ly = y - row * ch;
          const gap = ly === ch - 1 || lx === cw - 1;
          const v = 0.45 + (hash2(col0, row, c.seed + 7) - 0.5) * 0.35 + (n - 0.5) * 0.3;
          if (gap) col = COBBLE[0];
          else col = rv(COBBLE, v + (ly === 0 ? 0.12 : 0) + (lx === cw - 2 && ly > 0 ? -0.1 : 0));
          break;
        }
        case 'straw':
          col = hash2(x >> 1, y, c.seed) < 0.55 ? rv(DIRT, 0.4 + n * 0.4, x, y, 0.5) : rv(HAY, 0.25 + n * 0.3);
          break;
        case 'mud':
          col = rv(RAMP.plowed, 0.35 + n * 0.4, x, y, 0.5);
          break;
        case 'gravel':
          col = rv(['#5e5650', '#6c645c', '#7a7268', '#888076', '#968e84'], 0.3 + n * 0.4 + (hash2(x, y, 3) < 0.12 ? 0.25 : 0));
          break;
        case 'ash':
          col = rv(['#28222a', '#363034', '#463e3e', '#564e4a'], 0.25 + n * 0.55, x, y, 0.6);
          break;
        default:
          col = rv(DIRT, 0.3 + n * 0.5, x, y, 0.5);
          if (hash2(x, y, c.seed + 5) < 0.015) col = DIRT[4];
      }
      b.blend(x, y, col, alpha);
    }
}
/** yard covering the footprint from row `top` down to the front edge */
export function yardFront(c: Ctx, kind: YardKind, top: number, inset = 1) {
  yard(c, c.con && (kind === 'cobble' || kind === 'flag') ? 'dirt' : kind, c.L + inset, top, c.R - c.L - inset * 2, c.G - top - 1);
}

/** warm light pool / glow on the ground layer */
export function glow(c: Ctx, cx: number, cy: number, rx: number, ry: number, a: number) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1) continue;
      if (c.base.get(x, y) >>> 24) c.base.blend(x, y, '#f8b048', a * (1 - d));
    }
}

// ------------------------------------------------------------------------------------ walls
function postsFor(w: number, spacing = 6): Set<number> {
  const n = Math.max(1, Math.round((w - 1) / spacing));
  const s = new Set<number>();
  for (let i = 0; i <= n; i++) s.add(Math.round((i * (w - 1)) / n));
  return s;
}

function wallTex(mat: WallMat, lx: number, ly: number, w: number, h: number, px: number, py: number, seed: number, posts: Set<number>, found: number): string {
  const grad = (0.5 - lx / Math.max(1, w - 1)) * 0.12;
  switch (mat) {
    case 'stone': {
      const k = Math.floor(ly / 3);
      const r = ly % 3;
      const q = lx + (k & 1) * 3 + Math.floor(hash2(k, 1, seed) * 2);
      if (r === 0 || q % 5 === 0) return mix(S[1], S[2], 0.55);
      const v = 0.5 + grad + (hash2(Math.floor(q / 5), k, seed) - 0.5) * 0.22 + (r === 2 ? 0.1 : 0) + (q % 5 === 1 ? 0.04 : 0);
      return rv(S, v);
    }
    case 'ashlar': {
      const k = Math.floor(ly / 4);
      const r = ly % 4;
      const q = lx + (k & 1) * 3 + Math.floor(hash2(k, 4, seed) * 2);
      if (r === 0 || q % 6 === 0) return ASH[2];
      const v = 0.56 + grad + (hash2(Math.floor(q / 6), k, seed + 2) - 0.5) * 0.14 + (r === 3 ? 0.08 : 0) + (q % 6 === 1 ? 0.05 : 0);
      return rv(ASH, v);
    }
    case 'rough': {
      const k = Math.floor(ly / 3);
      const r = ly % 3;
      const q = lx + (k & 1) * 2 + Math.floor(hash2(k, 2, seed) * 3);
      const e = q % 4;
      if (r === 0 || e === 0) return PL[1];
      const v = 0.5 + grad + (hash2(q >> 2, k, seed + 1) - 0.5) * 0.34 + (r === 2 ? 0.08 : 0);
      return rv(ROUGH, v);
    }
    case 'timber': {
      if (ly < found) return wallTex('rough', lx, ly, w, h, px, py, seed, posts, 0);
      const mid = h >= 13 ? Math.round(found + (h - found) * 0.5) : -1;
      if (posts.has(lx) || ly === h - 1 || ly === found || ly === mid) return ly === h - 1 ? W[2] : W[1];
      // braces in the end panels
      const ps = [...posts].sort((a, b) => a - b);
      if (ps.length >= 3) {
        const a0 = ps[0];
        const a1 = ps[1];
        const b0 = ps[ps.length - 2];
        const b1 = ps[ps.length - 1];
        const top = mid > 0 ? mid : h - 1;
        const yy = ly - found;
        if (lx > a0 && lx < a1 && ly < top && Math.round(((lx - a0) / (a1 - a0)) * (top - found)) === yy) return W[1];
        if (lx > b0 && lx < b1 && ly < top && Math.round(((b1 - lx) / (b1 - b0)) * (top - found)) === yy) return W[1];
      }
      const v = 0.6 + grad + (vnoise2(px, py, 4, seed) - 0.5) * 0.12;
      return rv(PL, v, px, py, 0.45);
    }
    case 'plaster': {
      if (ly < found) return wallTex('rough', lx, ly, w, h, px, py, seed, posts, 0);
      if (lx < 2 || lx >= w - 2) {
        const blk = ((ly >> 1) + (lx < 2 ? 0 : 1)) & 1;
        if (ly % 2 === 0 && ly > 0) return S[2];
        return blk ? S[5] : S[4];
      }
      const v = 0.62 + grad + (vnoise2(px, py, 4, seed) - 0.5) * 0.14;
      return rv(PL, v, px, py, 0.45);
    }
    case 'logs': {
      const k = Math.floor(ly / 3);
      const r = ly % 3;
      const j = (hash2(k, 7, seed) - 0.5) * 0.14;
      const v = (r === 2 ? 0.72 : r === 1 ? 0.56 : 0.3) + j + grad;
      return rv(W, v);
    }
    case 'planks':
    case 'barn':
    case 'charred': {
      const R0 = mat === 'barn' ? BARN : mat === 'charred' ? CHAR : W;
      const q = lx + 1;
      const b = Math.floor(q / 3);
      const e = q % 3;
      if (e === 0) return R0[1];
      if (ly === 1 || ly === h - 2) return R0[2];
      const v = 0.55 + (hash2(b, 3, seed) - 0.5) * 0.18 + (e === 1 ? 0.08 : 0) + grad + (mat === 'planks' ? 0 : 0.05);
      return rv(R0, v);
    }
  }
}

export interface WallOpts {
  /** gable triangle rise above the wall (matching roofNS) */
  gable?: number;
  ghw?: number;
  found?: number;
  /** log ends sticking out at corners */
  ends?: boolean;
  spacing?: number;
}

export function wall(c: Ctx, x: number, y: number, w: number, h: number, mat: WallMat, o: WallOpts = {}) {
  const p = c.pc;
  const gb = y + h - 1;
  const gh = c.con === 1 ? 0 : o.gable ?? 0;
  const ghw = o.ghw ?? w / 2;
  const cxw = x + (w - 1) / 2;
  const lim = c.con === 1 ? Math.max(2, Math.round(h * 0.35)) : 9999;
  const found = o.found ?? 0;
  const posts = postsFor(w, o.spacing ?? 6);
  const framed = mat !== 'stone' && mat !== 'rough' && mat !== 'ashlar';
  const cposts = postsFor(w, 7);
  for (let lx = 0; lx < w; lx++) {
    const px = x + lx;
    let colH = h;
    if (c.dmg === 2) {
      colH = Math.round(h * (0.38 + 0.5 * vnoise(lx, 4, c.seed + 3)));
      if (lx < 2 || lx > w - 3) colH = Math.max(colH, Math.round(h * 0.75));
    }
    const gTop = gh > 0 && c.dmg < 2 ? Math.max(0, Math.round(gh * (1 - Math.abs(px - cxw) / ghw))) : 0;
    const top = colH + gTop;
    for (let ly = 0; ly < top; ly++) {
      const py = gb - ly;
      if (ly >= lim) {
        if (cposts.has(lx)) p.px(px, py, lx === 0 ? W[5] : W[4]);
        else if (ly === h - 1 && framed) p.px(px, py, W[3]);
        continue;
      }
      let col = wallTex(mat, lx, ly, w, h, px, py, c.seed, posts, found);
      if (lx === 0) col = shade(col, 0.1);
      else if (lx === w - 1) col = shade(col, -0.18);
      if (c.dmg === 2 && ly === top - 1) col = mat === 'stone' || mat === 'rough' || mat === 'ashlar' ? shade(col, 0.18) : CHAR[2];
      p.px(px, py, col);
    }
    if (c.con === 1 && framed && lim < h) {
      // half-built: fresh timber top plate on posts only
    }
  }
  if (o.ends && c.con !== 1) {
    for (let ly = 0; ly < (c.dmg === 2 ? Math.round(h * 0.7) : h); ly += 3) {
      const py = gb - ly - 1;
      p.px(x - 1, py, ENDG[2]);
      p.px(x - 1, py - 1, ENDG[1]);
      p.px(x + w, py, ENDG[1]);
      p.px(x + w, py - 1, ENDG[0]);
    }
  }
  if (c.dmg >= 1 && w > 8) {
    // cracks
    const n = c.dmg === 2 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      let cx = x + 2 + Math.floor(hash2(k, x, c.seed + 41) * (w - 4));
      let cy = y + 1 + Math.floor(hash2(x, k, c.seed) * 2);
      const len = 3 + Math.floor(hash2(k, y, c.seed) * 4);
      for (let i = 0; i < len; i++) {
        if (p.get(cx, cy) >>> 24) p.px(cx, cy, mix(S[0], '#000000', 0.2));
        cy++;
        if (hash2(i, k, c.seed + x) < 0.5) cx += hash2(cx, cy, 1) < 0.5 ? -1 : 1;
      }
    }
  }
}

/** a vertical post (1-2px) */
export function post(c: Ctx, x: number, yTop: number, gb: number, w = 1) {
  const p = c.pc;
  p.vline(x, yTop, gb, W[4]);
  if (w > 1) p.vline(x + 1, yTop, gb, W[2]);
}

// ------------------------------------------------------------------------------------ roofs
function roofCol(mat: RoofMat, v: number, u: number, r: number, x: number, y: number, seed: number): string {
  const R0 = ROOF[mat];
  r = Math.max(0, r);
  switch (mat) {
    case 'thatch': {
      // layered straw: wavy course lines, shadowed under each lip, vertical straw strokes
      const rr = r + Math.round(Math.sin(u * 0.4 + Math.floor(r / 3) * 1.3) * 0.8);
      const k = Math.floor(rr / 3);
      const w = md(rr, 3);
      let vv = v + (w === 2 ? -0.13 : w === 0 ? 0.08 : 0.02);
      const stroke = hash2(u, k, seed + 3);
      if (w < 2 && stroke < 0.22) vv -= 0.09;
      else if (w < 2 && stroke > 0.88) vv += 0.07;
      return rv(R0, vv);
    }
    case 'tile': {
      const k = Math.floor(r / 3);
      const w = r % 3;
      const q = md(u + (k & 1) * 2, 4);
      let vv = v + (hash2(Math.floor((u + (k & 1) * 2) / 4), k, seed) - 0.5) * 0.1;
      if (w === 2) vv -= 0.17;
      else if (q === 3) vv -= 0.24;
      else if (q === 0) vv += 0.08;
      if (w === 0 && q !== 3) vv += 0.04;
      return rv(R0, vv);
    }
    case 'slate': {
      const k = r >> 1;
      const w = r & 1;
      const q = u + ((k * 5) & 3);
      let vv = v + (hash2(Math.floor(q / 4), k, seed + 3) - 0.5) * 0.12;
      if (w === 1) vv -= 0.13;
      else if (md(q, 4) === 0) vv -= 0.22;
      return rv(R0, vv);
    }
    case 'shingle': {
      const k = r >> 1;
      const w = r & 1;
      const q = u + (k & 1) * 2;
      let vv = v + (hash2(Math.floor(q / 3), k, seed + 5) - 0.5) * 0.18;
      if (w === 1) vv -= 0.11;
      else if (md(q, 3) === 0) vv -= 0.2;
      return rv(R0, vv);
    }
    case 'lead':
      return rv(R0, v + (md(u, 3) === 0 ? 0.1 : 0), x, y, 0.3);
  }
}

function ridgeCol(mat: RoofMat, px: number): string {
  switch (mat) {
    case 'thatch':
      return md(px, 3) === 0 ? TH[2] : TH[4];
    case 'tile':
      return md(px, 3) === 0 ? RAMP.tile[3] : RAMP.tile[5];
    case 'slate':
      return md(px, 4) === 0 ? M[3] : M[4];
    case 'shingle':
      return md(px, 3) === 0 ? ROOF.shingle[3] : ROOF.shingle[5];
    case 'lead':
      return M[5];
  }
}

export function ruinFloor(px: number, py: number, seed: number) {
  const n = hash2(px >> 1, py >> 1, seed + 9);
  return n < 0.55 ? '#3a2e30' : n < 0.85 ? '#4a3c38' : '#2a2024';
}

/** state-aware roof pixel: cov = 0 at the eave → 1 at the ridge */
export function putRoof(c: Ctx, px: number, py: number, col: string, cov: number, raf: 'v' | 'h', ox: number) {
  if (c.con === 2 && cov > 0.42) {
    const k = raf === 'v' ? px - ox : py;
    const m = md(k, 4);
    const bat = raf === 'v' ? md(py, 3) === 0 : md(px, 3) === 0;
    col = m === 0 ? W[5] : m === 1 ? W[3] : bat ? W[2] : INTERIOR;
  } else if (c.dmg === 2) {
    const thr = 0.22 + vnoise2(px, py, 3, c.seed + 4) * 0.3;
    if (cov > thr) col = ruinFloor(px, py, c.seed);
    else if (cov > thr - 0.08) col = CHAR[2];
  }
  c.pc.px(px, py, col);
}

/** darken the rows right under an eave (only already-drawn pixels) */
export function eaveShadow(c: Ctx, x0: number, x1: number, y: number, a0 = 0.38, a1 = 0.16) {
  for (let x = x0; x <= x1; x++) {
    if (c.pc.get(x, y) >>> 24) c.pc.blend(x, y, '#1a1020', a0);
    if (c.pc.get(x, y + 1) >>> 24) c.pc.blend(x, y + 1, '#1a1020', a1);
  }
}

export function roofHoles(c: Ctx, x: number, y: number, w: number, h: number, n: number) {
  const p = c.pc;
  for (let k = 0; k < n; k++) {
    const hx = x + 2 + hash2(k, 1, c.seed + 31) * Math.max(1, w - 4);
    const hy = y + 1 + hash2(k, 2, c.seed + 31) * Math.max(1, h - 2);
    const rx = 1.6 + hash2(k, 3, c.seed) * 1.6;
    const ry = 1.2 + hash2(k, 4, c.seed) * 0.8;
    for (let yy = Math.floor(hy - ry - 1); yy <= hy + ry + 1; yy++)
      for (let xx = Math.floor(hx - rx - 1); xx <= hx + rx + 1; xx++) {
        if (!(p.get(xx, yy) >>> 24)) continue;
        const d = Math.hypot((xx + 0.5 - hx) / rx, (yy + 0.5 - hy) / ry) + (hash2(xx, yy, c.seed) - 0.5) * 0.4;
        if (d < 1) p.px(xx, yy, Math.round(xx - hx) === 0 ? CHAR[3] : '#1e1418');
        else if (d < 1.45) p.blend(xx, yy, '#1a1020', 0.35);
      }
  }
}

export function ruinDebris(c: Ctx, x: number, y: number, w: number, h: number) {
  const p = c.pc;
  const n = Math.max(1, Math.round((w * h) / 90));
  for (let k = 0; k < n; k++) {
    const bx = x + 2 + hash2(k, 5, c.seed + 51) * (w - 4);
    const by = y + 2 + hash2(k, 6, c.seed + 51) * (h - 3);
    blob(p, bx, by, 1.6 + hash2(k, 7, c.seed) * 1.4, 1.2 + hash2(k, 8, c.seed), S, c.seed + k);
  }
  // charred beams
  for (let k = 0; k < 2; k++) {
    const bx = x + 2 + hash2(k, 9, c.seed + 52) * (w - 6);
    const by = y + 1 + hash2(k, 10, c.seed + 52) * (h - 3);
    const len = 4 + hash2(k, 11, c.seed) * 5;
    p.line(bx, by, bx + len, by + (k ? -2 : 2), CHAR[3]);
    p.line(bx, by + 1, bx + len, by + 1 + (k ? -2 : 2), CHAR[1]);
  }
}

export interface RoofOpts {
  ridge?: number;
  hip?: number;
  holes?: number;
  noShadow?: boolean;
  finial?: boolean;
}

/** roof with an east-west ridge seen from above-front. Region x..x+w-1, y..y+h-1; bottom row = eave */
export function roofEW(c: Ctx, x: number, y: number, w: number, h: number, mat: RoofMat, o: RoofOpts = {}) {
  if (c.con === 1) return;
  const yr = y + Math.max(1, Math.round((h - 1) * (o.ridge ?? 0.34)));
  const hip = Math.min(o.hip ?? 0, Math.floor(w / 2));
  const yb = y + h - 1;
  for (let py = y; py <= yb; py++) {
    for (let px = x; px < x + w; px++) {
      const front = py > yr;
      const back = py < yr;
      const t = front ? (py - yr) / Math.max(1, yb - yr) : back ? (yr - py) / Math.max(1, yr - y) : 0;
      const lb = x + hip * (1 - t);
      const rb = x + w - 1 - hip * (1 - t);
      let v: number;
      let u: number;
      let r: number;
      let cov: number;
      let raf: 'v' | 'h' = 'v';
      let col: string;
      if (hip > 0 && px < lb - 0.3) {
        v = 0.8;
        u = py;
        r = px - x;
        cov = (px - x) / hip;
        raf = 'h';
      } else if (hip > 0 && px > rb + 0.3) {
        v = 0.3;
        u = py;
        r = x + w - 1 - px;
        cov = (x + w - 1 - px) / hip;
        raf = 'h';
      } else if (!front && !back) {
        col = ridgeCol(mat, px);
        if (px === x || px === x + w - 1) col = shade(col, px === x ? 0.1 : -0.15);
        putRoof(c, px, py, col, 1, 'v', x);
        continue;
      } else if (back) {
        v = 0.3 + ((py - y) / Math.max(1, yr - y)) * 0.06;
        u = px;
        r = py - y;
        cov = (py - y) / Math.max(1, yr - y);
      } else {
        v = (mat === 'thatch' ? 0.58 : 0.64) - t * 0.08;
        u = px;
        r = yb - py;
        cov = (yb - py) / Math.max(1, yb - yr);
      }
      v += (0.5 - (px - x) / w) * 0.1;
      col = roofCol(mat, v, u, r, px, py, c.seed);
      if (hip > 0 && Math.abs(px - lb) < 0.6 && px < x + w / 2) col = shade(col, 0.16);
      else if (hip > 0 && Math.abs(px - rb) < 0.6 && px > x + w / 2) col = shade(col, 0.06);
      if (py === yr - 1) col = shade(col, -0.18);
      if (mat === 'thatch') {
        const corner = (px === x || px === x + w - 1) && (py === y || py === yb);
        if (corner) continue;
        if (py === yb) col = rv(TH, 0.12);
        else if (py === yb - 1) col = rv(TH, v + 0.22);
        else if (py === yb - 2) col = rv(TH, v + 0.08);
      } else if (py === yb) col = shade(col, -0.2);
      if (py === y) col = shade(col, -0.1);
      if (px === x) col = shade(col, 0.08);
      else if (px === x + w - 1) col = shade(col, -0.15);
      putRoof(c, px, py, col, cov, raf, x);
    }
  }
  if (mat === 'thatch' && c.con === 0 && c.dmg < 2 && h >= 8) {
    // block-cut ridge cap with a scalloped lower edge
    const p = c.pc;
    for (let px = x + hip; px <= x + w - 1 - hip; px++) {
      const edge = px === x + hip || px === x + w - 1 - hip;
      p.px(px, yr - 1, edge ? TH[1] : TH[3]);
      p.px(px, yr, edge ? TH[1] : md(px, 4) === 0 ? TH[1] : TH[2]);
      p.px(px, yr + 1, edge ? TH[0] : TH[1]);
      if (md(px, 4) === 1 || md(px, 4) === 2) {
        p.px(px, yr + 2, TH[1]);
        p.px(px, yr + 3, rv(TH, 0.3));
      }
    }
  }
  if (c.dmg === 1) roofHoles(c, x + 1, yr + 1, w - 2, yb - yr - 1, o.holes ?? (w > 20 ? 2 : 1));
  if (c.dmg === 2) ruinDebris(c, x, y, w, h);
  if (!o.noShadow) eaveShadow(c, x + 1, x + w - 2, yb + 1);
  if (o.finial && c.dmg < 2 && c.con === 0) {
    const fx = x + hip;
    const fx2 = x + w - 1 - hip;
    for (const f of hip > 0 ? [fx, fx2] : [x + 1, x + w - 2]) {
      c.pc.px(f, yr - 1, c.tc.main);
      c.pc.px(f, yr - 2, c.tc.light);
    }
  }
}

/** roof with north-south ridge: front gable chevron. Column dx∈[-hw,hw]; eave corners at yb */
export function roofNS(c: Ctx, cx: number, yb: number, hw: number, gh: number, len: number, mat: RoofMat, o: { finial?: 'team' | 'cross' | 'post' | null; trim?: boolean } = {}) {
  if (c.con === 1) return;
  const p = c.pc;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = Math.abs(dx) / hw;
    const yF = Math.round(yb - gh * (1 - t));
    const yB = yF - len;
    const px = cx + dx;
    for (let py = yB; py <= yF; py++) {
      let col: string;
      const cov = 1 - t;
      if (dx === 0) col = ridgeCol(mat, py);
      else {
        const v = (dx < 0 ? 0.74 : 0.34) + ((py - yB) / len) * 0.05;
        col = roofCol(mat, v, py - yF, hw - Math.abs(dx), px, py, c.seed);
      }
      if (py === yB) col = shade(col, -0.12);
      if (Math.abs(dx) === hw) col = shade(col, dx < 0 ? 0.06 : -0.2);
      putRoof(c, px, py, col, cov, 'h', cx);
    }
    // bargeboard along the gable
    if (c.dmg < 2 || Math.abs(dx) > hw * 0.5) {
      if (mat === 'thatch') {
        p.px(px, yF, shade(TH[4], dx < 0 ? 0 : -0.2));
        p.px(px, yF + 1, TH[1]);
      } else p.px(px, yF + 1, dx < 0 ? W[4] : dx > 0 ? W[2] : W[3]);
    }
    if (p.get(px, yF + 2) >>> 24) p.blend(px, yF + 2, '#1a1020', 0.3);
  }
  if (c.dmg === 1) roofHoles(c, cx - hw + 1, yb - gh - len + 3, hw * 2 - 2, len - 3, 1);
  if (c.dmg === 2) ruinDebris(c, cx - hw + 1, yb - gh - len + 2, hw * 2 - 1, len);
  // side eave shadows
  eaveShadow(c, cx - hw + 1, cx - hw + 2, yb + 1, 0.3, 0.12);
  eaveShadow(c, cx + hw - 2, cx + hw - 1, yb + 1, 0.3, 0.12);
  const ay = yb - gh;
  if (c.con === 0 && c.dmg < 2) {
    if (o.finial === 'team') {
      p.vline(cx, ay - 3, ay, W[2]);
      p.px(cx + 1, ay - 3, c.tc.main);
      p.px(cx + 2, ay - 3, c.tc.light);
      p.px(cx + 1, ay - 2, c.tc.dark);
    } else if (o.finial === 'cross') {
      p.vline(cx, ay - 5, ay, GD[3]);
      p.hline(cx - 1, cx + 1, ay - 4, GD[3]);
      p.px(cx, ay - 5, GD[4]);
    } else if (o.finial === 'post') {
      p.vline(cx, ay - 2, ay, W[3]);
    }
  }
}

/** square pyramid / spire. Base rect cx±hw, rows yb-d..yb; apex rise above base centre */
export function pyramid(c: Ctx, cx: number, yb: number, hw: number, d: number, rise: number, mat: RoofMat, o: { finial?: 'team' | 'cross' | 'gold' | null } = {}) {
  if (c.con === 1 || c.dmg === 2) return;
  const p = c.pc;
  const R0 = ROOF[mat];
  const ya = yb - Math.round(d / 2) - rise;
  const yBack = yb - d;
  const tex = (v: number, u: number, r: number) => {
    // simplified courses so small spires stay crisp
    let vv = v;
    if (mat === 'thatch') return roofCol(mat, v, u, r, 0, 0, c.seed);
    if (md(r, 2) === 1) vv -= 0.1;
    else if (md(u + (r >> 1) * 2, 4) === 0 && mat !== 'lead') vv -= 0.12;
    return rv(R0, vv);
  };
  for (let py = ya; py <= yb; py++)
    for (let px = cx - hw; px <= cx + hw; px++) {
      const dx = px - cx;
      const ad = Math.abs(dx);
      const yTop = ya + ((yBack - ya) * ad) / hw;
      if (py < Math.round(yTop)) continue;
      const yFront = ya + ((yb - ya) * ad) / hw;
      let col: string;
      let cov: number;
      if (py >= yFront - 0.01 || dx === 0) {
        col = tex(0.56 + (dx < 0 ? 0.04 : -0.04), px, yb - py);
        cov = 1 - (py - ya) / (yb - ya);
      } else if (dx < 0) {
        col = tex(0.86, py, px - (cx - hw));
        cov = (px - (cx - hw)) / hw;
      } else {
        col = tex(0.24, py, cx + hw - px);
        cov = (cx + hw - px) / hw;
      }
      if (Math.abs(py - yFront) < 0.75 && dx !== 0) col = dx < 0 ? rv(R0, 0.95) : rv(R0, 0.45);
      if (py === yb) col = shade(col, -0.25);
      putRoof(c, px, py, col, cov, 'v', cx - hw);
    }
  if (c.dmg === 1) roofHoles(c, cx - hw + 1, yb - 4, hw * 2 - 1, 3, 1);
  eaveShadow(c, cx - hw + 1, cx + hw - 1, yb + 1, 0.3, 0.12);
  if (c.con === 0) {
    if (o.finial === 'team') {
      p.vline(cx, ya - 6, ya - 1, W[2]);
      flagCloth(c, cx + 1, ya - 6, 4, 3, c.tc, 0);
    } else if (o.finial === 'cross') {
      p.vline(cx, ya - 4, ya - 1, GD[3]);
      p.hline(cx - 1, cx + 1, ya - 3, GD[3]);
    } else if (o.finial === 'gold') {
      p.vline(cx, ya - 2, ya - 1, GD[4]);
      p.px(cx, ya - 3, GD[3]);
    }
  }
}

/** conical roof over a round tower: base ellipse centre (cx,yb), radius r */
function cone(c: Ctx, cx: number, yb: number, r: number, h: number, mat: RoofMat, finial: 'team' | 'gold' | null = null) {
  if (c.con !== 0 || c.dmg === 2) return;
  const p = c.pc;
  const ry = Math.max(1, Math.round(r * 0.42));
  const rr = r + 0.5;
  for (let py = yb - h; py <= yb + ry; py++)
    for (let dx = -r; dx <= r; dx++) {
      const n = dx / rr;
      const eave = yb + ry * Math.sqrt(Math.max(0, 1 - n * n));
      const top = yb - h + h * Math.abs(n);
      if (py < Math.round(top) || py > Math.round(eave)) continue;
      const v = 0.6 - n * 0.42 + (n < -0.6 ? -0.08 : 0);
      const s = eave - py;
      const u = Math.round(Math.asin(clamp(n, -1, 1)) * r * 1.3);
      let col = roofCol(mat, v, u, Math.round(s), cx + dx, py, c.seed);
      if (Math.round(eave) === py) col = shade(col, -0.22);
      putRoof(c, cx + dx, py, col, s / Math.max(1, eave - top), 'v', cx);
    }
  if (c.dmg === 1) roofHoles(c, cx - r + 1, yb - 3, r * 2 - 1, 3, 1);
  if (finial === 'team') {
    p.vline(cx, yb - h - 6, yb - h - 1, W[2]);
    flagCloth(c, cx + 1, yb - h - 6, 4, 3, c.tc, (c.seed + cx) & 3);
  } else if (finial === 'gold') {
    p.vline(cx, yb - h - 2, yb - h - 1, GD[4]);
  }
}

// ------------------------------------------------------------------------------------ towers
function crenPattern(k: number, period: number) {
  return md(k, period) < (period >= 4 ? 2 : 2);
}

/** crenellated flat top of a square tower/wall. Top surface rows y..y+d-1, front wall face below */
export function crenTop(c: Ctx, x: number, y: number, w: number, d: number, o: { floor?: 'stone' | 'wood'; period?: number; ramp?: readonly string[] } = {}) {
  if (c.con !== 0) return;
  const p = c.pc;
  const S = o.ramp ?? RAMP.stone;
  const per = o.period ?? (w >= 14 ? 4 : 3);
  const broken = (k: number) => c.dmg === 1 && hash2(k, x + y, c.seed + 61) < 0.25;
  for (let ly = 0; ly < d; ly++)
    for (let lx = 0; lx < w; lx++) {
      const px = x + lx;
      const py = y + ly;
      let col: string | null;
      const fl = o.floor === 'wood' ? rv(W, 0.42 + (md(lx, 3) === 0 ? -0.12 : 0)) : rv(S, 0.36 + (md(ly + (lx >> 2), 3) === 0 ? -0.06 : 0));
      if (ly >= d - 2) {
        // front parapet merlons
        const mer = crenPattern(lx, per) && !broken(lx);
        col = mer ? (ly === d - 2 ? S[5] : S[4]) : ly === d - 1 ? S[3] : fl;
      } else if (ly <= 1) {
        const mer = crenPattern(lx, per) && !broken(lx + 50);
        col = mer ? (ly === 0 ? S[5] : S[3]) : ly === 0 ? null : S[2];
      } else if (lx === 0 || lx === w - 1) {
        const mer = crenPattern(ly, 3);
        col = mer ? (lx === 0 ? S[5] : S[3]) : lx === 0 ? S[4] : S[2];
      } else if (ly === 2) col = shade(fl, -0.25);
      else col = fl;
      if (col) p.px(px, py, col);
    }
}

/** N-S running wall walk seen from above (castle side walls) */
export function wallStrip(c: Ctx, x: number, y0: number, y1: number, w: number) {
  if (c.con !== 0) return;
  const p = c.pc;
  for (let py = y0; py <= y1; py++)
    for (let lx = 0; lx < w; lx++) {
      const px = x + lx;
      let col: string | null;
      const ly = py - y0;
      if (lx === 0 || lx === w - 1) {
        const mer = crenPattern(ly, 3) && !(c.dmg === 1 && hash2(ly, lx, c.seed) < 0.25);
        col = mer ? (lx === 0 ? S[5] : S[4]) : lx === 0 ? S[3] : null;
        if (!mer && lx === w - 1) col = S[2];
      } else col = rv(S, 0.42 + (md(ly, 3) === 0 ? -0.1 : 0) + (lx === 1 ? -0.08 : 0));
      if (c.dmg === 2) {
        if (vnoise(py, 5, c.seed + x) < 0.45) col = lx === 0 || lx === w - 1 ? S[2] : ruinFloor(px, py, c.seed);
      }
      if (col) p.px(px, py, col);
    }
}

/** hollow ruined top (interior seen from above) */
export function hollow(c: Ctx, x: number, y: number, w: number, d: number) {
  const p = c.pc;
  for (let py = y; py < y + d; py++)
    for (let px = x; px < x + w; px++) {
      const edge = px === x || px === x + w - 1 || py === y;
      const jag = py === y && vnoise(px, 3, c.seed + 8) < 0.4;
      if (jag) continue;
      p.px(px, py, edge ? (px === x + w - 1 ? S[2] : S[4]) : py === y + 1 ? '#1e1618' : ruinFloor(px, py, c.seed));
    }
  ruinDebris(c, x + 1, y + 1, w - 2, d - 1);
}

function towerTex(mat: WallMat, dx: number, n: number, r: number, ly: number, seed: number): string {
  const ang = Math.asin(clamp(n, -1, 1));
  const s = Math.round(ang * (r + 0.5) * 1.15);
  const light = 0.55 - n * 0.34 - (n < -0.8 ? 0.06 : 0);
  if (mat === 'planks' || mat === 'logs') {
    if (mat === 'logs') {
      const k = Math.floor(ly / 3);
      const rr = ly % 3;
      return rv(W, light + (rr === 2 ? 0.14 : rr === 0 ? -0.24 : 0) + (hash2(k, 7, seed) - 0.5) * 0.1);
    }
    return rv(W, light + (md(s, 3) === 0 ? -0.2 : 0));
  }
  const R0 = mat === 'ashlar' ? ASH : S;
  const k = Math.floor(ly / 3);
  const rr = ly % 3;
  const q = s + (k & 1) * 2;
  if (rr === 0 || md(q, 4) === 0) return rv(R0, light - 0.3);
  return rv(R0, light + (hash2(Math.floor(q / 4), k, seed) - 0.5) * 0.18 + (rr === 2 ? 0.08 : 0));
}

/**
 * Round tower. cx, cyG = centre of its ground ellipse. Body height h.
 * top: 'cren' crenellated, 'cone' conical roof, 'flat'
 */
export function roundTower(c: Ctx, cx: number, cyG: number, r: number, h: number, o: { top?: 'cren' | 'cone' | 'flat'; roof?: RoofMat; coneH?: number; finial?: 'team' | 'gold' | null; mat?: WallMat; slits?: boolean; jagged?: boolean } = {}) {
  const p = c.pc;
  const mat = o.mat ?? 'stone';
  const ry = Math.max(1, Math.round(r * 0.42));
  const rr = r + 0.5;
  let hh = h;
  if (c.con === 1) hh = Math.max(3, Math.round(h * 0.35));
  else if (c.con === 2) hh = Math.round(h * 0.8);
  const ruined = c.dmg === 2 || o.jagged;
  if (ruined) hh = Math.round(h * 0.62);
  const topY = cyG - hh;
  if (ruined) {
    // hollow interior first
    for (let dy = -ry; dy <= ry; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = (dx / rr) ** 2 + (dy / (ry + 0.5)) ** 2;
        if (d > 1) continue;
        p.px(cx + dx, topY + dy - 1, d > 0.55 ? (dx < 0 ? S[4] : S[2]) : '#241a1e');
      }
  }
  for (let dx = -r; dx <= r; dx++) {
    const n = dx / rr;
    const yB = cyG + Math.round(ry * Math.sqrt(Math.max(0, 1 - n * n)));
    let colH = hh + (yB - cyG);
    if (ruined) colH -= Math.round(vnoise(dx + r, 3, c.seed + cx) * hh * 0.4);
    for (let ly = 0; ly <= colH; ly++) {
      const py = yB - ly;
      let col = towerTex(mat, dx, n, r, ly, c.seed);
      if (ruined && ly === colH) col = shade(col, 0.2);
      p.px(cx + dx, py, col);
    }
  }
  if (o.slits !== false && hh > 10 && c.con === 0) {
    const sy = cyG - Math.round(hh * 0.55);
    p.vline(cx - 1, sy, sy + 2, DARK);
    if (hh > 18) p.vline(cx + Math.round(r * 0.5), sy - 7, sy - 5, DARK);
  }
  if (c.con !== 0 || ruined) return;
  const top = o.top ?? 'cren';
  if (top === 'cren') roundCren(c, cx, topY, r, ry, mat === 'ashlar' ? ASH : S);
  else if (top === 'flat') {
    p.ellipse(cx + 0.5, topY + 0.5, rr, ry + 0.5, S[3]);
  } else {
    // slight overhang ring then cone
    for (let dx = -r - 1; dx <= r + 1; dx++) p.px(cx + dx, topY + Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx / (r + 1.5)) ** 2))), dx < 0 ? S[5] : S[3]);
    cone(c, cx, topY, r + 1, o.coneH ?? Math.round(r * 2.2), o.roof ?? 'slate', o.finial ?? null);
  }
}

function roundCren(c: Ctx, cx: number, cy: number, r: number, ry: number, S: readonly string[] = RAMP.stone) {
  const p = c.pc;
  const rr = r + 0.5;
  const ryy = ry + 0.5;
  const N = Math.max(6, Math.round((Math.PI * 2 * r) / 2.6 / 2) * 2);
  const mer = (dx: number, dy: number) => {
    const a = Math.atan2(dy / ryy, dx / rr);
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * N);
    return (k & 1) === 0 && !(c.dmg === 1 && hash2(k, cx, c.seed) < 0.3);
  };
  // floor + rim
  for (let dy = -ry - 1; dy <= ry + 1; dy++)
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = (dx / rr) ** 2 + (dy / ryy) ** 2;
      if (d > 1) continue;
      const rim = d > 0.42;
      let col: string | null;
      if (!rim) col = dy <= 0 ? S[1] : S[2];
      else if (dy < 0) col = mer(dx, dy) ? (dx < 0 ? S[5] : S[4]) : d > 0.75 ? null : S[2];
      else col = dx < -r * 0.3 ? S[4] : S[3];
      if (col) p.px(cx + dx, cy + dy, col);
    }
  // front merlons rising
  for (let dx = -r; dx <= r; dx++) {
    const n = dx / rr;
    const fy = cy + Math.round(ry * Math.sqrt(Math.max(0, 1 - n * n)));
    if (mer(dx, ry)) {
      const lt = 0.58 - n * 0.34;
      p.px(cx + dx, fy - 1, rv(S, lt + 0.2));
      p.px(cx + dx, fy, rv(S, lt + 0.05));
    }
  }
}

/** square tower: front face + top (crenellated / pyramid roof) */
export function sqTower(c: Ctx, x: number, gb: number, w: number, h: number, d: number, o: { mat?: WallMat; top?: 'cren' | 'pyramid' | 'none'; roof?: RoofMat; rise?: number; finial?: 'team' | 'cross' | 'gold' | null; slits?: boolean } = {}) {
  const mat = o.mat ?? 'stone';
  let hh = h;
  if (c.con === 1) hh = Math.max(3, Math.round(h * 0.35));
  else if (c.con === 2) hh = Math.round(h * 0.85);
  const y = gb - hh + 1;
  if (c.dmg === 2) hollow(c, x, y + Math.round(h * 0.4) - d, w, d + 1);
  wall(c, x, y, w, hh, mat);
  if (c.con === 0 && c.dmg < 2 && o.slits !== false && hh > 10) {
    const cx = x + Math.floor(w / 2);
    c.pc.vline(cx, y + Math.round(hh * 0.3), y + Math.round(hh * 0.3) + 2, DARK);
  }
  if (c.con !== 0 || c.dmg === 2) return;
  const top = o.top ?? 'cren';
  if (top === 'cren') crenTop(c, x, y - d, w, d, { ramp: mat === 'ashlar' ? ASH : S });
  else if (top === 'pyramid') {
    const hw = Math.floor(w / 2) + 1;
    const cx = x + Math.floor(w / 2);
    pyramid(c, cx, y, hw, d, o.rise ?? w, o.roof ?? 'slate', { finial: o.finial ?? null });
  }
}

// ------------------------------------------------------------------------------------ openings
export function door(c: Ctx, x: number, y: number, w: number, h: number, kind: 'plank' | 'arch' | 'dark' | 'gate' | 'double' = 'plank', frame: 'stone' | 'wood' | null = null) {
  if (c.con === 1) return;
  const p = c.pc;
  const k = c.con === 2 || c.dmg === 2 ? 'dark' : kind;
  const arch = kind === 'arch' || kind === 'gate' || kind === 'double';
  const cut = (lx: number, ly: number) => {
    if (!arch) return false;
    if (ly === 0) return lx === 0 || lx === w - 1 || (w >= 6 && (lx === 1 || lx === w - 2));
    if (ly === 1 && w >= 6) return lx === 0 || lx === w - 1;
    return false;
  };
  if (frame) {
    for (let ly = -1; ly < h; ly++)
      for (let lx = -1; lx <= w; lx++) {
        const inside = lx >= 0 && lx < w && ly >= 0 && !cut(lx, ly);
        if (inside) continue;
        const near = lx >= -1 && lx <= w && ly >= -1;
        if (!near) continue;
        if (arch && ly === -1 && (lx === -1 || lx === w)) continue;
        const col = frame === 'stone' ? (lx <= 0 || ly < 1 ? S[5] : S[3]) : lx <= 0 ? W[4] : W[2];
        if (!cut(clamp(lx, 0, w - 1), clamp(ly, 0, h - 1)) || ly < 0 || lx < 0 || lx >= w) p.px(x + lx, y + ly, col);
      }
  }
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (cut(lx, ly)) continue;
      let col: string;
      if (k === 'dark') col = ly === 0 ? '#120c14' : DARK;
      else if (k === 'gate') {
        col = DARK;
        if (md(lx, 2) === 1 && ly < h - 1) col = M[2];
        if (md(ly, 3) === 1) col = M[1];
        if (ly === h - 1 && md(lx, 2) === 1) col = M[3];
      } else {
        const seam = k === 'double' ? lx === Math.floor(w / 2) : md(lx, 2) === 1 && lx < w - 1 && w > 3;
        col = seam ? W[2] : lx === 0 ? W[4] : W[3];
        if (ly === 0) col = W[1];
        if ((ly === 2 || ly === h - 2) && (lx < 2 || (k === 'double' && lx > w - 3))) col = M[2];
      }
      p.px(x + lx, y + ly, col);
    }
  if (k === 'plank' && w >= 3) p.px(x + w - 2, y + Math.floor(h / 2) + 1, GD[3]);
  if (k === 'double') {
    p.px(x + Math.floor(w / 2) - 1, y + Math.floor(h / 2) + 1, GD[3]);
    p.px(x + Math.floor(w / 2) + 1, y + Math.floor(h / 2) + 1, GD[3]);
  }
}

export type WinKind = 'glass' | 'lit' | 'shutter' | 'slit' | 'arch' | 'boarded' | 'box' | 'stained' | 'round';
export function win(c: Ctx, x: number, y: number, w: number, h: number, kind: WinKind = 'glass') {
  if (c.con === 1) return;
  const p = c.pc;
  const ruined = c.dmg === 2 || c.con === 2;
  if (kind === 'slit') {
    p.vline(x, y, y + h - 1, DARK);
    return;
  }
  if (kind === 'round') {
    // rose window
    p.rect(x, y + 1, 5, 3, S[5]);
    p.rect(x + 1, y, 3, 5, S[5]);
    if (ruined) {
      p.rect(x + 1, y + 1, 3, 3, DARK);
      return;
    }
    p.px(x + 2, y + 2, GD[4]);
    p.px(x + 1, y + 1, '#3a5ab0');
    p.px(x + 3, y + 1, '#c03a3a');
    p.px(x + 1, y + 3, '#c03a3a');
    p.px(x + 3, y + 3, '#3a5ab0');
    p.px(x + 2, y + 1, '#4a8a4a');
    p.px(x + 2, y + 3, '#4a8a4a');
    p.px(x + 1, y + 2, GD[3]);
    p.px(x + 3, y + 2, GD[3]);
    return;
  }
  const lit = kind === 'lit' && !ruined;
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (kind === 'arch' && ly === 0 && w >= 2 && (lx === 0 || lx === w - 1) && w > 2) continue;
      let col: string;
      if (ruined) col = DARK;
      else if (kind === 'boarded') col = md(ly, 2) === 0 ? W[3] : W[1];
      else if (kind === 'stained') col = ly === 0 ? '#c03a3a' : (lx + ly) & 1 ? '#3a5ab0' : GD[3];
      else if (lit) col = ly === 0 ? LIT[1] : lx === w - 1 && w > 1 ? LIT[1] : LIT[2];
      else col = lx === 0 && ly === 0 ? GLASS_HI : GLASS;
      if (!ruined && w >= 3 && lx === Math.floor(w / 2) && kind !== 'boarded' && kind !== 'stained') col = W[1];
      p.px(x + lx, y + ly, col);
    }
  if (ruined) return;
  if (kind === 'shutter' || kind === 'box') {
    p.vline(x - 1, y, y + h - 1, W[4]);
    p.vline(x + w, y, y + h - 1, W[2]);
  }
  if (kind === 'box') {
    p.hline(x - 1, x + w, y + h, W[2]);
    const fl = ['#e05a6a', '#f0d060', '#f0f0e8', '#d070c0'];
    for (let i = -1; i <= w; i++) p.px(x + i, y + h - 1 + (i & 1 ? 0 : 0), i & 1 ? LEAF[4] : fl[md(i + c.seed, 4)]);
  } else if (kind !== 'boarded' && kind !== 'stained') p.hline(x, x + w - 1, y + h, shade(PL[3], 0.1));
  if (kind === 'boarded') p.line(x - 1, y, x + w, y + h - 1, W[4]);
  if (lit) glowPx(c, x - 1, y + h, w + 2);
}

export function glowPx(c: Ctx, x: number, y: number, w: number) {
  for (let i = 0; i < w; i++) if (c.pc.get(x + i, y) >>> 24) c.pc.blend(x + i, y, LIT[2], 0.25);
}

/** stone chimney; top row = yTop (sooty opening seen from above), runs down h rows */
export function chimney(c: Ctx, x: number, yTop: number, h: number, o: { glow?: boolean; w?: number; stack?: boolean } = {}) {
  if (c.con === 1) return;
  const p = c.pc;
  const w = o.w ?? (c.size >= 2 ? 4 : 3);
  let top = yTop;
  if (c.dmg === 2) top = yTop + Math.round(h * 0.45);
  for (let py = top + 1; py < yTop + h; py++) {
    const ly = yTop + h - py;
    // broad stepped base for external stacks
    const extra = o.stack && py > yTop + h * 0.55 ? 1 : 0;
    for (let lx = -extra; lx < w + extra; lx++) {
      const k = ly >> 1;
      const seam = ly % 2 === 0 || md(lx + (k & 1) * 2, 3) === 0;
      let v = lx <= -extra ? 0.74 : lx >= w - 1 + extra ? 0.28 : 0.55;
      if (seam) v -= 0.2;
      p.px(x + lx, py, rv(ROUGH, v));
    }
  }
  // cap band + sooty opening seen from above
  for (let lx = 0; lx < w; lx++) p.px(x + lx, top + 1, lx === w - 1 ? ROUGH[2] : ROUGH[3]);
  if (c.dmg < 2) {
    for (let lx = 0; lx < w; lx++) p.px(x + lx, top, lx === 0 ? ROUGH[5] : lx === w - 1 ? ROUGH[3] : ROUGH[4]);
    for (let lx = 1; lx < w - 1; lx++) p.px(x + lx, top, o.glow ? (lx === w >> 1 ? FI[5] : FI[3]) : '#1a1216');
    if (w === 3 && !o.glow) p.px(x + 1, top, '#1a1216');
  }
}

// ------------------------------------------------------------------------------------ cloth
export function symbolAt(c: Ctx, cx: number, cy: number, sym: Team['symbol'], col: string) {
  const p = c.pc;
  switch (sym) {
    case 'cross':
      p.vline(cx, cy - 1, cy + 1, col);
      p.hline(cx - 1, cx + 1, cy, col);
      break;
    case 'diamond':
      p.px(cx, cy - 1, col);
      p.px(cx - 1, cy, col);
      p.px(cx + 1, cy, col);
      p.px(cx, cy + 1, col);
      break;
    case 'triangle':
      p.px(cx, cy - 1, col);
      p.hline(cx - 1, cx + 1, cy + 1, col);
      p.px(cx, cy, col);
      break;
    default:
      p.px(cx, cy - 1, col);
      p.px(cx - 1, cy, col);
      p.px(cx + 1, cy, col);
      p.px(cx, cy + 1, col);
      p.px(cx, cy, shade(col, -0.35));
  }
}

/** waving flag cloth attached at (x, y) to the right */
export function flagCloth(c: Ctx, x: number, y: number, w: number, h: number, t: Team, phase: number) {
  const p = c.pc;
  for (let lx = 0; lx < w; lx++) {
    const wave = Math.sin(lx * 1.1 - phase * 1.57);
    const dy = Math.round(wave * 0.6 * (lx / w + 0.2));
    const slope = Math.cos(lx * 1.1 - phase * 1.57);
    for (let ly = 0; ly < h; ly++) {
      if (lx === w - 1 && ly === Math.floor(h / 2) && h >= 3) continue;
      let col = slope > 0.35 ? t.light : slope < -0.45 ? t.dark : t.main;
      if (ly === h - 1 && col === t.light) col = t.main;
      p.px(x + lx, y + ly + dy, col);
    }
  }
}

/** flagpole with a waving banner; gb = ground row */
export function poleFlag(c: Ctx, x: number, gb: number, h: number, t: Team | null, o: { w?: number; fh?: number; phase?: number; sym?: boolean } = {}) {
  if (!t || c.con !== 0) return;
  const p = c.pc;
  const top = gb - h;
  if (c.dmg === 2) {
    // snapped pole
    p.vline(x, gb - Math.round(h * 0.4), gb, W[2]);
    return;
  }
  p.vline(x, top, gb, W[2]);
  p.px(x, top - 1, GD[4]);
  const fw = o.w ?? 5;
  const fh = o.fh ?? 4;
  flagCloth(c, x + 1, top, fw, fh, t, o.phase ?? (c.seed & 3));
  if (o.sym && fw >= 5 && fh >= 4) symbolAt(c, x + 1 + Math.floor(fw / 2), top + Math.floor(fh / 2), t.symbol, t.light === t.main ? CREAM : CREAM);
}

/** hanging wall banner: rod at row y, cloth below */
export function wallBanner(c: Ctx, x: number, y: number, w: number, h: number, t: Team | null) {
  if (!t || c.con !== 0) return;
  const p = c.pc;
  const torn = c.dmg >= 1;
  let hh = h;
  if (c.dmg === 2) hh = Math.max(2, Math.round(h * 0.45));
  p.hline(x - 1, x + w, y, W[1]);
  p.px(x - 1, y, GD[3]);
  p.px(x + w, y, GD[3]);
  for (let ly = 1; ly <= hh; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (ly === hh && w >= 3 && lx > 0 && lx < w - 1) continue; // swallowtail
      if (torn && ly > hh - 3 && hash2(lx, ly, c.seed + x) < 0.3) continue;
      let col = lx === 0 ? t.light : lx === w - 1 ? t.dark : t.main;
      if (ly === 1) col = shade(col, -0.2);
      p.px(x + lx, y + ly, col);
    }
  if (w >= 3 && hh >= 6) {
    p.hline(x, x + w - 1, y + 2, GD[3]);
    symbolAt(c, x + Math.floor((w - 1) / 2) + (w % 2 === 0 ? 0 : 0), y + Math.floor(hh / 2) + 1, t.symbol, GD[4]);
  }
}

export function shieldCrest(c: Ctx, cx: number, y: number, t: Team | null) {
  if (!t || c.con !== 0 || c.dmg === 2) return;
  const p = c.pc;
  p.rect(cx - 2, y, 5, 3, t.main);
  p.hline(cx - 1, cx + 1, y + 3, t.main);
  p.px(cx, y + 4, t.dark);
  p.vline(cx - 2, y, y + 2, t.light);
  p.vline(cx + 2, y, y + 3, t.dark);
  p.hline(cx - 2, cx + 2, y - 1, GD[3]);
  p.px(cx, y + 1, GD[4]);
}

/** striped market awning. Top edge at y (back), slopes down to front edge y+d */
export function awning(c: Ctx, x: number, y: number, w: number, d: number, t: Team) {
  if (c.con !== 0) return;
  const p = c.pc;
  for (let ly = 0; ly <= d; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (c.dmg === 2 && hash2(lx >> 1, ly, c.seed + x) < 0.45) continue;
      const stripe = md(lx >> 1, 2) === 0;
      let col = stripe ? t.main : CREAM;
      const v = 0.12 - (ly / d) * 0.25;
      col = shade(col, v);
      if (lx === 0) col = shade(col, 0.08);
      if (lx === w - 1) col = shade(col, -0.18);
      p.px(x + lx, y + ly, col);
    }
  // scalloped valance
  for (let lx = 0; lx < w; lx++) {
    if (c.dmg === 2 && lx & 1) continue;
    const stripe = md(lx >> 1, 2) === 0;
    p.px(x + lx, y + d + 1, shade(stripe ? t.main : CREAM, -0.3));
    if (md(lx, 2) === 0) p.px(x + lx, y + d + 2, shade(stripe ? t.dark : PL[2], -0.1));
  }
}

// ------------------------------------------------------------------------------------ props
export function built(c: Ctx) {
  return c.con === 0;
}
export function barrel(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 4, 4, 5, W[3]);
  p.vline(x, gb - 4, gb, W[4]);
  p.vline(x + 3, gb - 4, gb, W[2]);
  p.hline(x, x + 3, gb - 3, M[2]);
  p.hline(x, x + 3, gb - 1, M[2]);
  p.hline(x, x + 3, gb - 5, W[5]);
  p.px(x + 3, gb - 5, W[4]);
}
export function crate(c: Ctx, x: number, gb: number, s = 4) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - s + 1, s, s, W[4]);
  p.rect(x, gb - s - 1, s, 2, W[5]);
  p.vline(x + s - 1, gb - s + 1, gb, W[2]);
  p.line(x, gb, x + s - 1, gb - s + 1, W[2]);
  p.hline(x, x + s - 1, gb - s + 1, W[3]);
}
export function sack(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 2, 3, 3, '#b8a27a');
  p.px(x + 1, gb - 3, '#a08a62');
  p.vline(x + 2, gb - 2, gb, '#8a7452');
  p.px(x, gb - 2, '#d0bc94');
}
export function logPile(c: Ctx, x: number, gb: number, n: number, rows = 3, dep = 3) {
  const p = c.pc;
  const logs: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let i = 0; i < n - r; i++) logs.push([x + i * 3 + r * 1.5, gb - 2 - r * 3]);
  for (const [lx, ly] of logs) {
    p.rect(Math.round(lx), ly - dep, 3, dep, W[3]);
    p.px(Math.round(lx), ly - dep, W[4]);
    p.vline(Math.round(lx) + 2, ly - dep, ly - 1, W[2]);
  }
  for (const [lx0, ly] of logs) {
    const lx = Math.round(lx0);
    p.rect(lx, ly, 3, 3, ENDG[1]);
    p.px(lx + 1, ly + 1, ENDG[2]);
    p.px(lx, ly, W[3]);
    p.px(lx + 2, ly + 2, W[1]);
    p.px(lx + 2, ly, W[2]);
    p.px(lx, ly + 2, W[2]);
  }
}
export function haystack(c: Ctx, cx: number, gb: number, r: number) {
  if (!built(c)) return;
  blob(c.pc, cx, gb - r * 0.75, r, r * 0.85, HAY, c.seed + cx);
  c.pc.px(cx, Math.round(gb - r * 1.6), HAY[3]);
}
export function hayBale(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 2, 5, 3, HAY[3]);
  p.rect(x, gb - 4, 5, 2, HAY[5]);
  p.vline(x + 4, gb - 2, gb, HAY[1]);
  p.vline(x + 2, gb - 4, gb, HAY[2]);
}
export function fenceH(c: Ctx, x0: number, x1: number, gb: number, step = 4) {
  if (!built(c)) return;
  const p = c.pc;
  p.hline(x0, x1, gb - 3, W[4]);
  p.hline(x0, x1, gb - 1, W[3]);
  for (let x = x0; x <= x1; x += step) {
    if (c.dmg === 2 && hash2(x, gb, c.seed) < 0.35) continue;
    p.vline(x, gb - 4, gb, W[2]);
    p.px(x, gb - 4, W[5]);
  }
}
export function fenceV(c: Ctx, x: number, y0: number, y1: number, step = 4) {
  if (!built(c)) return;
  const p = c.pc;
  p.vline(x, y0 - 3, y1 - 3, W[4]);
  for (let y = y0; y <= y1; y += step) {
    p.vline(x, y - 4, y, W[2]);
    p.px(x, y - 4, W[5]);
  }
}
function anvil(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x + 1, gb - 1, 4, 2, W[2]);
  p.px(x + 1, gb - 1, W[3]);
  p.rect(x + 2, gb - 3, 2, 2, M[2]);
  p.hline(x, x + 5, gb - 4, M[3]);
  p.hline(x + 1, x + 5, gb - 5, M[5]);
  p.px(x, gb - 5, M[4]);
  p.px(x + 5, gb - 4, M[1]);
}
function well(c: Ctx, cx: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  // roof posts
  p.vline(cx - 4, gb - 11, gb - 2, W[3]);
  p.vline(cx + 4, gb - 11, gb - 2, W[2]);
  // ring
  p.ellipse(cx + 0.5, gb - 2.5, 4.5, 2.5, S[4]);
  p.ellipse(cx + 0.5, gb - 3, 3, 1.4, '#1a2a44');
  p.px(cx - 1, gb - 3, '#3a5a80');
  p.hline(cx - 4, cx + 4, gb, S[2]);
  p.hline(cx - 4, cx + 4, gb - 1, S[3]);
  p.px(cx - 4, gb - 2, S[5]);
  // crank bar + bucket
  p.hline(cx - 3, cx + 3, gb - 9, W[2]);
  p.vline(cx, gb - 8, gb - 6, '#8a7a5a');
  p.rect(cx - 1, gb - 6, 2, 2, W[3]);
  // little roof
  for (let ly = 0; ly < 4; ly++)
    for (let lx = -5 + (3 - ly); lx <= 5 - (3 - ly); lx++) p.px(cx + lx, gb - 14 + ly, rv(ROOF.shingle, lx < 0 ? 0.7 : 0.35, 0, 0) );
  p.hline(cx - 5, cx + 5, gb - 11, W[1]);
}
export function target(c: Ctx, cx: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.line(cx - 2, gb, cx, gb - 5, W[2]);
  p.line(cx + 2, gb, cx, gb - 5, W[2]);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 3.4) continue;
      const col = d > 2.5 ? (dx + dy < 0 ? HAY[4] : HAY[2]) : d > 1.6 ? CREAM : d > 0.8 ? '#c03a32' : GD[4];
      p.px(cx + dx, gb - 7 + dy, col);
    }
  if (c.dmg) p.line(cx + 1, gb - 7, cx + 4, gb - 9, W[4]);
}
function dummy(c: Ctx, cx: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.vline(cx, gb - 9, gb, W[2]);
  p.hline(cx - 3, cx + 3, gb - 7, W[3]);
  p.rect(cx - 1, gb - 7, 3, 4, '#b8a27a');
  p.vline(cx + 1, gb - 7, gb - 4, '#8a7452');
  p.rect(cx - 1, gb - 10, 3, 2, HAY[4]);
  p.px(cx + 1, gb - 9, HAY[2]);
  p.px(cx - 3, gb - 8, '#b8a27a');
  p.px(cx + 3, gb - 8, '#8a7452');
}
function rack(c: Ctx, x: number, gb: number, w: number) {
  if (!built(c)) return;
  const p = c.pc;
  for (let i = 1; i < w - 1; i += 2) {
    p.vline(x + i, gb - 9, gb - 1, W[4]);
    p.px(x + i, gb - 10, M[5]);
    p.px(x + i, gb - 11, M[4]);
  }
  p.hline(x, x + w - 1, gb - 6, W[2]);
  p.vline(x, gb - 7, gb, W[2]);
  p.vline(x + w - 1, gb - 7, gb, W[1]);
  p.hline(x, x + w - 1, gb - 2, W[2]);
}
function shieldsRow(c: Ctx, x: number, y: number, n: number, t: Team) {
  if (!built(c) || c.dmg === 2) return;
  const p = c.pc;
  for (let i = 0; i < n; i++) {
    const sx = x + i * 5;
    p.rect(sx, y, 3, 3, i & 1 ? t.main : M[4]);
    p.px(sx + 1, y + 3, i & 1 ? t.dark : M[2]);
    p.px(sx + 1, y + 1, i & 1 ? t.light : M[5]);
  }
}
export function tent(c: Ctx, cx: number, gb: number, hw: number, h: number, len: number, col: string, o: { stripe?: string; team?: Team | null; door?: boolean } = {}) {
  const p = c.pc;
  if (c.con !== 0) {
    // bare A-frame poles + folded canvas
    p.line(cx - hw + 1, gb, cx, gb - h, W[4]);
    p.line(cx + hw - 1, gb, cx, gb - h, W[2]);
    if (c.con === 2) {
      p.line(cx, gb - h, cx, gb - h - len, W[3]);
      p.line(cx - hw + 1, gb - len, cx, gb - h - len, W[3]);
      p.rect(cx - 3, gb - 1, 6, 2, shade(col, 0.1));
      p.hline(cx - 3, cx + 2, gb - 1, shade(col, 0.25));
    }
    return;
  }
  const R0 = [shade(col, -0.45), shade(col, -0.25), col, shade(col, 0.16), shade(col, 0.3)];
  const ruined = c.dmg === 2;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = Math.abs(dx) / hw;
    const yA = Math.round(gb - h * (1 - t));
    // roof running back
    for (let py = yA - len; py <= yA; py++) {
      if (ruined && hash2(dx, py, c.seed) < 0.3) continue;
      let cc = rv(R0, dx < 0 ? 0.78 : dx > 0 ? 0.32 : 0.6);
      if (o.stripe && md(py + Math.abs(dx), 4) < 2 && dx !== 0) cc = shade(o.stripe, dx < 0 ? 0.05 : -0.3);
      if (py === yA - len) cc = shade(cc, -0.15);
      p.px(cx + dx, py, cc);
    }
    // front triangle
    for (let py = yA + 1; py <= gb; py++) {
      let cc = rv(R0, 0.55 - (dx / hw) * 0.1);
      if (o.door !== false && Math.abs(dx) <= Math.max(0, Math.round((py - (gb - h * 0.75)) * 0.5))) cc = DARK;
      p.px(cx + dx, py, cc);
    }
  }
  p.vline(cx, gb - h - len - 2, gb - h - len, W[2]);
  if (o.team) flagCloth(c, cx + 1, gb - h - len - 2, 3, 2, o.team, c.seed & 3);
}
export function campfire(c: Ctx, cx: number, gb: number, lit = true) {
  if (!built(c)) return;
  const p = c.pc;
  for (let a = 0; a < 8; a++) {
    const x = cx + Math.round(Math.cos((a / 8) * Math.PI * 2) * 3);
    const y = gb - 1 + Math.round(Math.sin((a / 8) * Math.PI * 2) * 1.5);
    p.px(x, y, a < 4 ? S[3] : S[5]);
  }
  p.line(cx - 2, gb, cx + 2, gb - 2, W[2]);
  p.line(cx - 2, gb - 2, cx + 2, gb, W[3]);
  if (lit && c.dmg < 2) {
    p.px(cx, gb - 2, FI[3]);
    p.px(cx - 1, gb - 1, FI[2]);
    p.px(cx + 1, gb - 1, FI[3]);
    p.px(cx, gb - 1, FI[4]);
    p.px(cx, gb - 3, FI[4]);
    p.px(cx + 1, gb - 4, FI[3]);
    p.px(cx, gb - 4, FI[5]);
    glow(c, cx, gb - 1, 6, 3.5, 0.35);
  }
}
export function cart(c: Ctx, x: number, gb: number, load: 'hay' | 'gold' | 'stone' | 'logs' | null = null) {
  if (!built(c)) return;
  const p = c.pc;
  p.line(x - 3, gb - 2, x, gb - 3, W[2]);
  p.rect(x, gb - 5, 8, 3, W[3]);
  p.hline(x, x + 7, gb - 5, W[5]);
  p.vline(x + 7, gb - 5, gb - 3, W[1]);
  if (load === 'hay') blob(p, x + 4, gb - 6, 4, 2.2, HAY, 3);
  else if (load === 'gold' || load === 'stone') {
    const R0 = load === 'gold' ? GD : S;
    for (let i = 0; i < 4; i++) {
      p.px(x + 1 + i * 2, gb - 6, R0[3]);
      p.px(x + 2 + i * 2, gb - 6, R0[4]);
      p.px(x + 1 + i * 2, gb - 7, i & 1 ? R0[2] : R0[4]);
    }
  } else if (load === 'logs') {
    p.rect(x, gb - 7, 8, 2, W[3]);
    p.hline(x, x + 7, gb - 7, W[4]);
    p.px(x + 7, gb - 7, ENDG[2]);
    p.px(x + 7, gb - 6, ENDG[1]);
  }
  // wheel
  p.ellipse(x + 3.5, gb - 1.5, 2, 2, W[1]);
  p.px(x + 3, gb - 2, W[4]);
}
export function oreCart(c: Ctx, x: number, gb: number, gold: boolean) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 4, 6, 3, M[2]);
  p.hline(x, x + 5, gb - 4, M[4]);
  p.vline(x + 5, gb - 4, gb - 2, M[1]);
  const R0 = gold ? GD : S;
  p.hline(x + 1, x + 4, gb - 5, R0[3]);
  p.px(x + 2, gb - 6, R0[4]);
  p.px(x + 3, gb - 5, R0[4]);
  p.px(x + 1, gb - 1, M[1]);
  p.px(x + 4, gb - 1, M[1]);
}
function grave(c: Ctx, x: number, gb: number, kind: number) {
  const p = c.pc;
  if (kind % 3 === 0) {
    p.rect(x, gb - 4, 3, 4, S[4]);
    p.hline(x, x + 2, gb - 5, S[5]);
    p.px(x + 1, gb - 6, S[5]);
    p.vline(x + 2, gb - 4, gb - 1, S[2]);
  } else if (kind % 3 === 1) {
    p.vline(x + 1, gb - 6, gb - 1, W[3]);
    p.hline(x, x + 2, gb - 4, W[3]);
  } else {
    p.vline(x + 1, gb - 6, gb - 1, S[4]);
    p.hline(x, x + 2, gb - 5, S[5]);
  }
  p.hline(x - 1, x + 3, gb, RAMP.dirt[1]);
}
export function stoneBlock(c: Ctx, x: number, gb: number, w: number, h: number, d = 2) {
  const p = c.pc;
  p.rect(x, gb - h + 1, w, h, S[4]);
  p.vline(x + w - 1, gb - h + 1, gb, S[3]);
  p.rect(x, gb - h + 1 - d, w, d, S[6]);
  p.vline(x + w - 1, gb - h + 1 - d, gb - h, S[5]);
  p.hline(x, x + w - 1, gb, S[2]);
}
export function stump(c: Ctx, x: number, gb: number, axe = false) {
  const p = c.pc;
  p.rect(x, gb - 2, 4, 3, W[2]);
  p.vline(x, gb - 2, gb, W[3]);
  p.rect(x, gb - 3, 4, 1, ENDG[1]);
  p.px(x + 1, gb - 3, ENDG[2]);
  if (axe && built(c)) {
    p.line(x + 2, gb - 3, x + 4, gb - 7, W[4]);
    p.px(x + 1, gb - 4, M[5]);
    p.px(x + 2, gb - 4, M[4]);
    p.px(x + 1, gb - 3, M[3]);
  }
}
export function bush(c: Ctx, cx: number, gb: number, r = 3) {
  blob(c.pc, cx, gb - r * 0.7, r, r * 0.8, LEAF, c.seed + cx);
}
export function flowers(c: Ctx, x: number, gb: number, n: number) {
  const fl = ['#e05a6a', '#f0d060', '#f0f0e8', '#d070c0'];
  for (let i = 0; i < n; i++) {
    const fx = x + i * 2;
    c.pc.px(fx, gb, LEAF[3]);
    c.pc.px(fx + (i & 1), gb - 1, fl[md(i * 3 + c.seed, 4)]);
  }
}
function smallFlag(c: Ctx, x: number, gb: number, t: Team | null) {
  poleFlag(c, x, gb, 10, t, { w: 4, fh: 3 });
}
function torch(c: Ctx, x: number, y: number) {
  if (c.con !== 0 || c.dmg === 2) return;
  c.pc.px(x, y + 1, W[2]);
  c.pc.px(x, y, FI[4]);
  c.pc.px(x, y - 1, FI[3]);
}

// ------------------------------------------------------------------------------------ construction overlays
export function scaffold(c: Ctx, x: number, gb: number, w: number, h: number) {
  const p = c.pc;
  const top = gb - h;
  const n = Math.max(2, Math.round(w / 10) + 1);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(Math.round(x + (i * (w - 1)) / (n - 1)));
  const levels = [gb - Math.round(h * 0.35), gb - Math.round(h * 0.72)];
  for (const ly of levels) {
    p.hline(x - 1, x + w, ly, W[5]);
    p.hline(x - 1, x + w, ly + 1, W[2]);
  }
  for (let i = 0; i < xs.length - 1; i += 2) p.line(xs[i], levels[0], xs[i + 1], levels[1], W[3]);
  for (const sx of xs) {
    p.vline(sx, top - 2, gb, W[4]);
    p.px(sx, top - 3, W[3]);
  }
  // rope lashings
  for (const sx of xs) for (const ly of levels) p.px(sx, ly, CREAM);
}

/** generic construction supplies at the front corners */
export function supplies(c: Ctx) {
  const p = c.pc;
  const gb = c.G - 2;
  // plank stack
  const x = c.L + 2;
  for (let i = 0; i < 3; i++) {
    p.hline(x, x + 7, gb - i * 2, W[5 - (i & 1)]);
    p.hline(x, x + 7, gb - i * 2 - 1, W[3]);
    p.px(x + 7, gb - i * 2, ENDG[2]);
  }
  // stone pile
  if (c.size >= 2) {
    const sx = c.R - 9;
    stoneBlock(c, sx, gb, 4, 2, 2);
    stoneBlock(c, sx + 3, gb, 4, 2, 2);
    stoneBlock(c, sx + 1, gb - 3, 4, 2, 2);
  }
}

/** foundation outline (construction) on the ground layer */
export function foundation(c: Ctx, x: number, gb: number, w: number, d: number) {
  const b = c.base;
  for (let px = x; px < x + w; px++) {
    b.px(px, gb, S[3]);
    b.px(px, gb - d, S[4]);
    b.px(px, gb + 1, S[1]);
  }
  for (let py = gb - d; py <= gb; py++) {
    b.px(x, py, S[4]);
    b.px(x + w - 1, py, S[2]);
  }
}

/** standard state extras for a main body (scaffold / supplies) */
export function construct(c: Ctx, x: number, gb: number, w: number, h: number, d: number) {
  if (c.con === 0) return;
  foundation(c, x - 1, gb + 1, w + 2, d);
  scaffold(c, x, gb, w, c.con === 1 ? Math.round(h * 0.6) : h + 2);
  supplies(c);
}

// ======================================================================================== BUILDINGS
export type Drawer = (c: Ctx, o: BuildingOpts) => void;

// ---------------------------------------------------------------------------- generic houses
export interface HouseSpec {
  x: number;
  gb: number;
  w: number;
  wh: number;
  rh: number;
  wall: WallMat;
  roof: RoofMat;
  found?: number;
  hip?: number;
  ov?: number;
  door?: number | null;
  doorW?: number;
  doorKind?: 'plank' | 'arch' | 'double';
  windows?: number[];
  winKind?: WinKind;
  chimney?: number | null;
  ends?: boolean;
  ridge?: number;
  finial?: boolean;
}
/** a building with an east-west roof */
export function houseEW(c: Ctx, s: HouseSpec) {
  const y = s.gb - s.wh + 1;
  const ov = s.ov ?? 2;
  wall(c, s.x, y, s.w, s.wh, s.wall, { found: s.found ?? (s.wall === 'timber' || s.wall === 'plaster' ? 2 : 0), ends: s.ends ?? s.wall === 'logs' });
  const dh = Math.min(s.wh - 1, s.wh >= 10 ? 7 : 6);
  if (s.door !== null) door(c, s.x + (s.door ?? Math.floor(s.w / 2) - 1), s.gb - dh + 1, s.doorW ?? 3, dh, s.doorKind ?? 'plank');
  for (const wx of s.windows ?? []) win(c, s.x + wx, y + Math.max(2, Math.round(s.wh * 0.28)), 2, 2, s.winKind ?? 'glass');
  roofEW(c, s.x - ov, y - s.rh + 1, s.w + ov * 2, s.rh, s.roof, { hip: s.hip, ridge: s.ridge, finial: s.finial });
  if (s.chimney !== undefined && s.chimney !== null) chimney(c, s.x + s.chimney, y - s.rh - 1, Math.max(7, Math.round(s.rh * 0.42)));
  construct(c, s.x, s.gb, s.w, s.wh, s.rh - 4);
}

export interface GableSpec {
  cx: number;
  gb: number;
  hw: number;
  wh: number;
  gh: number;
  len: number;
  wall: WallMat;
  roof: RoofMat;
  door?: 'plank' | 'arch' | 'double' | 'barn' | null;
  windows?: number[];
  finial?: 'team' | 'cross' | 'post' | null;
  gableWin?: WinKind | null;
}
/** a building with its gable facing the viewer */
export function houseNS(c: Ctx, s: GableSpec) {
  const w = s.hw * 2 - 1;
  const x = s.cx - s.hw + 1;
  const y = s.gb - s.wh + 1;
  wall(c, x, y, w, s.wh, s.wall, { gable: s.gh, ghw: s.hw + 1, found: s.wall === 'timber' ? 2 : 0, ends: s.wall === 'logs' });
  if (s.wall === 'timber' && c.con !== 1 && c.dmg < 2) {
    // gable timbers
    const p = c.pc;
    p.vline(s.cx, y - s.gh + 2, y, W[1]);
    p.hline(x, x + w - 1, y, W[1]);
  }
  if (s.gableWin && c.con !== 1) win(c, s.cx - (s.gableWin === 'round' ? 2 : 0), y - Math.round(s.gh * 0.6) - (s.gableWin === 'round' ? 2 : 0), 1, 2, s.gableWin === 'round' ? 'round' : s.gableWin);
  if (s.door === 'barn') {
    const dw = Math.min(w - 4, 7);
    const dh = Math.min(s.wh + Math.round(s.gh * 0.4), s.wh + 2);
    if (c.con !== 1) {
      const dx = s.cx - Math.floor(dw / 2);
      const dy = s.gb - dh + 1;
      if (c.con === 2 || c.dmg === 2) c.pc.rect(dx, dy, dw, dh, DARK);
      else {
        c.pc.rect(dx, dy, dw, dh, '#2a1a18');
        c.pc.rect(dx, dy + 1, 2, dh - 1, BARN[4]);
        c.pc.rect(dx + dw - 2, dy + 1, 2, dh - 1, BARN[2]);
        c.pc.hline(dx, dx + dw - 1, dy, W[1]);
        c.pc.line(dx, dy + 1, dx + 1, dy + dh - 1, CREAM);
        c.pc.line(dx + dw - 1, dy + 1, dx + dw - 2, dy + dh - 1, PL[1]);
      }
    }
  } else if (s.door) {
    const dw = s.door === 'double' ? 4 : 3;
    const dh = Math.min(s.wh - 1, 7);
    door(c, s.cx - Math.floor(dw / 2), s.gb - dh + 1, dw, dh, s.door);
  }
  for (const wx of s.windows ?? []) win(c, s.cx + wx, y + Math.max(2, Math.round(s.wh * 0.3)), 2, 2, 'glass');
  roofNS(c, s.cx, y, s.hw + 1, s.gh, s.len, s.roof, { finial: s.finial ?? null });
  construct(c, x, s.gb, w, s.wh, s.len);
}

// ---------------------------------------------------------------------------- settlement cores
const drawCastle: Drawer = (c) => {
  const s = c.size;
  const p = c.pc;
  const { L, R, F, G } = c;
  const fw = s * TILE;
  const big = s >= 5 ? 2 : s === 4 ? 1 : 0;
  const t4 = c.tier >= 4 ? 1 : 0;
  const wh = [10, 12, 13][big] + t4;
  const th = [4, 5, 5][big];
  const tr = [5, 6, 7][big];
  const tH = wh + [8, 10, 11][big] + t4 * 3;
  const xl = L + tr;
  const xr = R - 1 - tr;
  const gyB = F + th + 2;
  const gyF = G - 2;
  const wallX = xl;
  const wallW = xr - xl + 1;
  yard(c, 'dirt', L + 2, gyB - 2, fw - 4, gyF - gyB + 1, 2);
  const tower = (cx: number, cyG: number, back = false) =>
    roundTower(c, cx, cyG, tr, tH - (back ? 1 : 0), t4 ? { top: 'cone', roof: 'slate', coneH: Math.round(tr * 2.4), finial: 'team' } : { top: 'cren' });
  // ---- back curtain wall (in shade) + towers
  if (c.dmg === 2) hollow(c, wallX, gyB - Math.round(wh * 0.6) - th, wallW, th + 1);
  wall(c, wallX, gyB - wh + 1, wallW, wh, 'stone');
  for (let y = gyB - wh + 1; y <= gyB; y++) for (let x = wallX; x < wallX + wallW; x++) if (p.get(x, y) >>> 24) p.blend(x, y, '#1a1020', 0.14);
  crenTop(c, wallX, gyB - wh + 1 - th, wallW, th);
  tower(xl, gyB - (th >> 1), true);
  tower(xr, gyB - (th >> 1), true);
  // ---- side wall walks
  const sy0 = gyB - wh + 1;
  const sy1 = gyF - wh - th;
  wallStrip(c, xl - (th >> 1), sy0, sy1, th);
  wallStrip(c, xr - (th >> 1), sy0, sy1, th);
  // ---- keep
  const kw = [18, 24, 30][big] + t4 * 2;
  const kd = [8, 10, 12][big];
  const kh = [26, 32, 36][big] + t4 * 6;
  const gyK = F + [22, 30, 38][big];
  const kx = c.ax - (kw >> 1);
  if (c.con === 0) yard(c, 'flag', c.ax - 4, gyK - 2, 8, gyF - gyK, 1);
  const turR = big >= 1 ? 3 : 2;
  const turH = kh + 5;
  const keepTur = (cx: number, cyG: number) =>
    roundTower(c, cx, cyG, turR, turH, t4 ? { top: 'cone', roof: 'slate', coneH: turR * 3 + 1, slits: false, mat: 'ashlar' } : { top: 'cren', slits: false, mat: 'ashlar' });
  keepTur(kx, gyK - kd);
  keepTur(kx + kw - 1, gyK - kd);
  const kty = gyK - kh + 1;
  if (c.dmg === 2) hollow(c, kx, kty + Math.round(kh * 0.45) - kd, kw, kd + 1);
  wall(c, kx, kty, kw, kh, 'ashlar');
  if (c.con === 0 && c.dmg < 2) {
    p.hline(kx - 1, kx + kw, gyK, ASH[2]);
    p.hline(kx - 1, kx + kw, gyK - 1, ASH[4]);
    const rows = big === 0 ? [0.22, 0.48] : t4 ? [0.16, 0.36, 0.56] : [0.2, 0.45];
    rows.forEach((fr, ri) => {
      const wy = kty + Math.round(kh * fr);
      const n = big === 0 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const wx = kx + Math.round(((i + 0.5) * kw) / n) - 1;
        win(c, wx, wy, 2, 3, (i * 2 + ri + c.seed) % 4 === 0 ? 'lit' : 'arch');
      }
    });
    const bw = big === 0 ? 3 : 4;
    const bh = Math.round(kh * 0.34);
    const by = kty + Math.round(kh * 0.58) - 3;
    wallBanner(c, kx + 2, by, bw, bh, c.tc);
    wallBanner(c, kx + kw - 2 - bw, by, bw, bh, c.tc);
    const dw = big === 0 ? 4 : 6;
    door(c, c.ax - (dw >> 1), gyK - 7 - big, dw, 7 + big, 'arch', 'stone');
    shieldCrest(c, c.ax, gyK - 13 - big * 2, c.tc);
  }
  if (c.con === 0 && c.dmg < 2) {
    crenTop(c, kx, kty - kd, kw, kd, { ramp: ASH });
    if (t4) pyramid(c, c.ax, kty - 2, (kw >> 1) - 2, kd - 4, Math.round(kw * 0.62), 'slate', { finial: 'team' });
    else poleFlag(c, c.ax, kty - kd + 4, 14, c.tc, { w: 7, fh: 5, sym: true });
  }
  keepTur(kx, gyK + 1);
  keepTur(kx + kw - 1, gyK + 1);
  // ---- courtyard buildings (in front of the keep, at the sides)
  const cyB = big === 2 ? gyK + 9 : gyF - wh - th - 2;
  if (big >= 1) {
    const lw = big === 2 ? 15 : 10;
    const lx = xl + (th >> 1) + 2;
    if (c.dmg < 2) {
      houseEW(c, { x: lx, gb: cyB, w: lw, wh: 6, rh: 9, wall: 'plaster', roof: 'tile', door: null, windows: big === 2 ? [2, 10] : [3], found: 1 });
      const rw = lw;
      const rx = xr - (th >> 1) - 2 - rw;
      houseEW(c, { x: rx, gb: cyB, w: rw, wh: 6, rh: 9, wall: 'timber', roof: 'slate', door: 2, windows: [rw - 4], found: 1 });
    }
    if (c.con === 0 && big === 2 && c.dmg < 2) {
      const fy = gyF - wh - th - 2;
      well(c, xl + 12, fy);
      barrel(c, xr - 14, fy);
      crate(c, xr - 10, fy);
      cart(c, c.ax + 6, fy, 'hay');
    }
  }
  // ---- front curtain wall
  if (c.dmg === 2) hollow(c, wallX, gyF - Math.round(wh * 0.6) - th, wallW, th + 1);
  wall(c, wallX, gyF - wh + 1, wallW, wh, 'stone');
  crenTop(c, wallX, gyF - wh + 1 - th, wallW, th);
  // ---- gatehouse
  const gw = [12, 16, 20][big];
  const gH = wh + 5 + t4 * 2;
  const gx = c.ax - (gw >> 1);
  if (c.dmg === 2) hollow(c, gx, gyF + 1 - Math.round(gH * 0.6) - th, gw, th + 1);
  wall(c, gx, gyF - gH + 1, gw, gH, 'stone');
  crenTop(c, gx, gyF - gH + 1 - th, gw, th);
  const aw = [5, 6, 8][big];
  const ah = [7, 8, 10][big];
  door(c, c.ax - (aw >> 1), gyF - ah + 1, aw, ah, 'gate', 'stone');
  if (c.con === 0) yard(c, 'flag', c.ax - (aw >> 1) - 1, gyF + 1, aw + 2, 3, 1);
  const gtr = [3, 4, 4][big];
  const gtH = gH + 4;
  const gt = t4 ? ({ top: 'cone', roof: 'slate', coneH: gtr * 3 } as const) : ({ top: 'cren' } as const);
  roundTower(c, gx - 1, gyF - 1, gtr, gtH, gt);
  roundTower(c, gx + gw, gyF - 1, gtr, gtH, gt);
  wallBanner(c, gx - 2, gyF - gtH + 4, 3, Math.round(gtH * 0.45), c.tc);
  wallBanner(c, gx + gw - 1, gyF - gtH + 4, 3, Math.round(gtH * 0.45), c.tc);
  shieldCrest(c, c.ax, gyF - ah - 5, c.tc);
  // ---- front corner towers
  tower(xl, gyF - (th >> 1));
  tower(xr, gyF - (th >> 1));
  if (!t4) {
    poleFlag(c, xl, gyF - (th >> 1) - tH - 1, 8, c.tc, { w: 4, fh: 3, phase: 1 });
    poleFlag(c, xr, gyF - (th >> 1) - tH - 1, 8, c.tc, { w: 4, fh: 3, phase: 2 });
  }
  if (c.dmg === 2) {
    for (let k = 0; k < 4 + big * 2; k++) blob(p, L + 6 + hash2(k, 1, c.seed) * (fw - 12), gyF - 1 + hash2(k, 2, c.seed) * 3, 2 + hash2(k, 3, c.seed) * 2, 1.5, S, k);
  }
  if (c.con) {
    scaffold(c, gx - 3, gyF, gw + 6, c.con === 1 ? 8 : gH);
    supplies(c);
  }
};

const drawKeep: Drawer = (c) => {
  const s = c.size;
  const { L, R, F, G } = c;
  const fw = s * TILE;
  const big = s >= 4 ? 1 : 0;
  const gyB = F + 9;
  const kw = big ? 30 : 22;
  const kd = big ? 12 : 9;
  const kh = big ? 36 : 28;
  const gyK = G - 7;
  const kx = c.ax - (kw >> 1);
  yard(c, 'dirt', L + 3, gyB - 2, fw - 6, G - gyB, 4);
  // low bailey wall behind with corner turrets
  if (c.dmg === 2) hollow(c, L + 5, gyB - 7, fw - 10, 4);
  wall(c, L + 5, gyB - 7, fw - 10, 8, 'stone');
  crenTop(c, L + 5, gyB - 10, fw - 10, 3);
  roundTower(c, L + 5, gyB - 2, big ? 4 : 3, 15, { top: 'cren' });
  roundTower(c, R - 6, gyB - 2, big ? 4 : 3, 15, { top: 'cren' });
  // keep body (warm ashlar) with corner turrets
  const tr = big ? 5 : 4;
  const kty = gyK - kh + 1;
  if (c.dmg === 2) hollow(c, kx, kty + Math.round(kh * 0.45) - kd, kw, kd + 1);
  wall(c, kx, kty, kw, kh, 'ashlar');
  if (c.con === 0 && c.dmg < 2) {
    for (const fr of [0.18, 0.42]) {
      const wy = kty + Math.round(kh * fr);
      for (let i = 0; i < 3; i++) win(c, kx + Math.round(((i + 0.5) * kw) / 3) - 1, wy, 2, 3, i === 1 && fr > 0.3 ? 'lit' : 'arch');
    }
    wallBanner(c, kx + 3, kty + Math.round(kh * 0.6) - 4, 3, Math.round(kh * 0.3), c.tc);
    wallBanner(c, kx + kw - 6, kty + Math.round(kh * 0.6) - 4, 3, Math.round(kh * 0.3), c.tc);
    p_plinth(c, kx, gyK, kw);
  }
  crenTop(c, kx, kty - kd, kw, kd, { ramp: ASH });
  if (c.con === 0 && c.dmg < 2) poleFlag(c, c.ax, kty - kd + 3, 13, c.tc, { w: 6, fh: 4, sym: true });
  // forebuilding with the entrance
  const fbw = big ? 12 : 10;
  const fbh = big ? 14 : 12;
  sqTower(c, c.ax - (fbw >> 1), G - 3, fbw, fbh, 4, { top: 'cren', slits: false, mat: 'ashlar' });
  door(c, c.ax - 2, G - 3 - 6, 4, 7, 'arch', 'stone');
  shieldCrest(c, c.ax, G - 3 - fbh + 4, c.tc);
  if (c.con === 0) yard(c, 'flag', c.ax - 3, G - 2, 6, 2, 1);
  roundTower(c, kx, gyK - 1, tr, kh + 4, { top: 'cren' });
  roundTower(c, kx + kw - 1, gyK - 1, tr, kh + 4, { top: 'cren' });
  if (c.con) {
    scaffold(c, kx, gyK, kw, c.con === 1 ? 12 : kh);
    supplies(c);
  }
};
function p_plinth(c: Ctx, x: number, gb: number, w: number) {
  c.pc.hline(x - 1, x + w, gb, S[2]);
  c.pc.hline(x - 1, x + w, gb - 1, S[4]);
}

const drawTownHall: Drawer = (c) => {
  const { L, G } = c;
  const fw = c.size * TILE;
  const x = L + 3;
  const w = fw - 6;
  const gb = G - 5;
  const lower = 8;
  const upper = 9;
  const rh = 22;
  const ry = gb - lower - upper + 1;
  yardFront(c, 'cobble', ry - rh + 8);
  // stone ground floor + jettied timber upper floor
  wall(c, x + 1, gb - lower + 1, w - 2, lower, 'stone');
  wall(c, x, ry, w, upper, 'timber', { spacing: 5 });
  if (c.con !== 1) {
    c.pc.hline(x, x + w - 1, gb - lower + 1, W[1]);
    eaveShadow(c, x + 1, x + w - 2, gb - lower + 2, 0.35, 0.12);
  }
  door(c, c.ax - 3, gb - 6, 6, 7, 'double', 'stone');
  for (const wx of [x + 5, x + w - 8]) win(c, wx, gb - 5, 3, 3, 'glass');
  for (let i = 0; i < 5; i++) win(c, x + 3 + Math.round((i * (w - 8)) / 4), ry + 3, 2, 3, i === 2 ? 'lit' : 'box');
  wallBanner(c, x + 9, ry + 1, 3, 9, c.tc);
  wallBanner(c, x + w - 12, ry + 1, 3, 9, c.tc);
  // hip tile roof
  roofEW(c, x - 2, ry - rh + 1, w + 4, rh, 'tile', { hip: 9, ridge: 0.4 });
  // clock / bell tower rising from the ridge
  if (c.con === 0) {
    const tw = 9;
    const tx = c.ax - (tw >> 1);
    const tgb = ry - 8;
    const th2 = 11;
    sqTower(c, tx, tgb, tw, th2, 3, { mat: 'plaster', top: 'pyramid', roof: 'slate', rise: 12, finial: 'team', slits: false });
    if (c.dmg < 2) {
      const cy = tgb - th2 + 4;
      c.pc.ellipse(c.ax + 0.5, cy + 0.5, 2.6, 2.6, CREAM);
      c.pc.px(c.ax + 2, cy + 1, PL[2]);
      c.pc.px(c.ax, cy - 1, W[1]);
      c.pc.px(c.ax, cy, W[1]);
      c.pc.px(c.ax + 1, cy, W[1]);
      c.pc.rect(c.ax - 1, tgb - 3, 3, 3, DARK);
      c.pc.px(c.ax, tgb - 2, GD[4]);
      c.pc.px(c.ax, tgb - 1, GD[2]);
    }
  }
  if (c.con === 0) {
    c.pc.hline(c.ax - 4, c.ax + 3, gb + 1, S[5]);
    c.pc.hline(c.ax - 5, c.ax + 4, gb + 2, S[4]);
  }
  barrel(c, x + 1, gb + 2);
  flowers(c, x + w - 9, gb + 2, 4);
  construct(c, x, gb, w, lower + upper, rh - 6);
};

const drawVillageHall: Drawer = (c) => {
  const { L, G } = c;
  const fw = c.size * TILE;
  const x = L + 5;
  const w = fw - 10;
  const gb = G - 7;
  const wh = 10;
  const y = gb - wh + 1;
  const rh = 27;
  yardFront(c, 'dirt', y - rh + 8);
  wall(c, x, y, w, wh, 'logs', { ends: true });
  door(c, c.ax - 2, gb - 6, 4, 7, 'double');
  win(c, x + 4, y + 3, 2, 2, 'shutter');
  win(c, x + w - 6, y + 3, 2, 2, 'shutter');
  win(c, x + 11, y + 3, 2, 2, 'lit');
  win(c, x + w - 13, y + 3, 2, 2, 'lit');
  roofEW(c, x - 3, y - rh + 1, w + 6, rh, 'thatch', { ridge: 0.3 });
  if (c.con === 0 && c.dmg < 2) {
    // carved crossed gable horns at the ridge ends
    const yr = y - rh + 1 + Math.round((rh - 1) * 0.3);
    for (const ex of [x - 3, x + w + 2]) {
      const dir = ex < c.ax ? -1 : 1;
      c.pc.line(ex, yr + 1, ex + dir * 3, yr - 3, W[4]);
      c.pc.line(ex + dir, yr + 1, ex - dir * 2, yr - 3, W[3]);
      c.pc.px(ex + dir * 4, yr - 4, W[5]);
      c.pc.px(ex - dir * 3, yr - 4, W[4]);
    }
    // carved door posts
    c.pc.vline(c.ax - 3, gb - 7, gb, W[5]);
    c.pc.vline(c.ax + 2, gb - 7, gb, W[3]);
    c.pc.hline(c.ax - 3, c.ax + 2, gb - 7, W[4]);
    c.pc.px(c.ax - 1, gb - 8, W[4]);
    c.pc.px(c.ax, gb - 8, W[4]);
  }
  poleFlag(c, L + 3, G - 2, 17, c.tc, { w: 5, fh: 4, sym: true });
  logPile(c, x + w - 7, G - 2, 3, 2, 2);
  barrel(c, x + 3, G - 2);
  construct(c, x, gb, w, wh, rh - 6);
};

const drawOutpost: Drawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  yard(c, 'dirt', L + 2, F + 6, fw - 4, fw - 7, 3);
  const pb = F + 9;
  const ph = 7;
  palisadeRun(c, L + 2, R - 3, pb, ph);
  // tower
  const tw = 10;
  const tx = c.ax - (tw >> 1);
  const tgb = G - 8;
  const sh = 9;
  const uh = 12;
  palisadeSide(c, L + 2, pb + 2, G - 3, ph);
  palisadeSide(c, R - 3, pb + 2, G - 3, ph);
  wall(c, tx, tgb - sh + 1, tw, sh, 'rough');
  const uy = tgb - sh - uh + 1;
  if (c.con !== 1) {
    wall(c, tx, uy, tw, uh, 'planks');
    if (c.dmg < 2 && c.con === 0) {
      win(c, tx + 2, uy + 5, 1, 3, 'slit');
      win(c, tx + tw - 3, uy + 5, 1, 3, 'slit');
      wallBanner(c, c.ax - 1, uy + 2, 3, 7, c.tc);
    }
    lookout(c, tx, uy, tw, 'shingle');
  }
  door(c, c.ax - 2, tgb - 5, 4, 6, 'plank');
  palisadeRun(c, L + 2, c.ax - 5, G - 2, ph);
  palisadeRun(c, c.ax + 4, R - 3, G - 2, ph);
  if (c.con === 0) {
    // open gate leaves
    c.pc.rect(c.ax - 5, G - 7, 2, 6, W[3]);
    c.pc.rect(c.ax + 3, G - 7, 2, 6, W[2]);
  }
  construct(c, tx, tgb, tw, sh + uh, 6);
};

/** archer platform with railing + pyramid roof on top of a tower whose top row is uy */
function lookout(c: Ctx, tx: number, uy: number, tw: number, roof: RoofMat) {
  if (c.con !== 0 || c.dmg === 2) return;
  const p = c.pc;
  const dy = uy - 1; // deck row
  const x0 = tx - 2;
  const x1 = tx + tw + 1;
  // shadowed open gallery
  p.rect(x0 + 1, dy - 5, x1 - x0 - 1, 5, '#2a2026');
  // roof
  pyramid(c, c.ax, dy - 6, (x1 - x0 + 2) >> 1, 3, Math.round(tw * 1.1), roof, { finial: 'team' });
  // corner posts
  p.vline(x0, dy - 6, dy, W[4]);
  p.vline(x1, dy - 6, dy, W[2]);
  // deck + railing
  p.hline(x0, x1, dy, W[4]);
  p.hline(x0, x1, dy + 1, W[1]);
  p.hline(x0, x1, dy - 3, W[4]);
  for (let i = x0; i <= x1; i += 2) p.vline(i, dy - 2, dy - 1, i < c.ax ? W[3] : W[2]);
  // braces under the deck
  p.line(x0, dy + 2, tx, dy + 4, W[2]);
  p.line(x1, dy + 2, tx + tw - 1, dy + 4, W[1]);
}

function palisadeRun(c: Ctx, x0: number, x1: number, gb: number, h: number) {
  const p = c.pc;
  const lim = c.con === 1 ? Math.round(h * 0.5) : h;
  for (let x = x0; x <= x1; x += 2) {
    let hh = lim;
    if (c.dmg === 2) {
      if (hash2(x, gb, c.seed) < 0.22) continue;
      hh = Math.round(h * (0.3 + 0.7 * vnoise(x, 3, c.seed)));
    }
    hh += md(x * 7, 3) === 0 ? 1 : 0;
    p.vline(x, gb - hh + 1, gb, W[4]);
    p.vline(x + 1, gb - hh + 1, gb, W[2]);
    p.px(x, gb - hh, W[5]);
    p.px(x + 1, gb - hh + 1, W[3]);
    p.px(x, gb - 2, W[3]);
    p.px(x + 1, gb - 2, W[1]);
  }
}
function palisadeSide(c: Ctx, x: number, y0: number, y1: number, h = 9) {
  const p = c.pc;
  const hh0 = c.con === 1 ? Math.round(h * 0.5) : h;
  for (let y = y0; y <= y1; y += 2) {
    let hh = hh0;
    if (c.dmg === 2) {
      if (hash2(x, y, c.seed) < 0.3) continue;
      hh = Math.round(h * (0.4 + 0.6 * vnoise(y, 3, c.seed)));
    }
    p.vline(x, y - hh + 1, y, W[4]);
    p.px(x, y - hh, W[5]);
    p.vline(x + 1, y - hh + 2, y, W[2]);
  }
}

// ---------------------------------------------------------------------------- economy / military
const drawHouse: Drawer = (c) => {
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  const v = c.variant & 3;
  const gb = G - 5;
  yardFront(c, 'dirt', F + 6);
  if (v === 0) {
    houseEW(c, { x: L + 4, gb, w: fw - 8, wh: 10, rh: 19, wall: 'timber', roof: 'thatch', door: 4, windows: [12, 18], winKind: 'box', chimney: fw - 15 });
    logPile(c, L + 1, G - 1, 2, 2, 2);
    fenceH(c, L + 16, R - 3, G - 1);
  } else if (v === 1) {
    houseNS(c, { cx: c.ax, gb, hw: 11, wh: 9, gh: 9, len: 13, wall: 'rough', roof: 'tile', door: 'arch', windows: [-7, 5], finial: 'post', gableWin: 'glass' });
    if (c.con === 0) chimney(c, c.ax + 6, gb - 9 - 16, 10);
    barrel(c, L + 1, G - 2);
    bush(c, R - 4, G - 1, 3);
  } else if (v === 2) {
    houseEW(c, { x: L + 3, gb, w: fw - 14, wh: 10, rh: 19, wall: 'plaster', roof: 'slate', door: 3, windows: [11], winKind: 'shutter', chimney: 3, hip: 5 });
    const sx = R - 12;
    wall(c, sx, gb - 6, 9, 7, 'planks');
    door(c, sx + 3, gb - 4, 3, 5, 'plank');
    roofEW(c, sx - 1, gb - 15, 11, 10, 'shingle', { ridge: 0.2 });
    crate(c, R - 6, G - 1);
  } else {
    houseEW(c, { x: L + 3, gb, w: fw - 10, wh: 9, rh: 18, wall: 'logs', roof: 'shingle', door: 9, windows: [3, 15], winKind: 'shutter', chimney: null });
    if (c.con === 0) chimney(c, R - 7, gb - 25, 25, { w: 3, stack: true });
    stump(c, L + 2, G - 2, true);
    flowers(c, L + 8, G - 2, 3);
  }
};

const drawFarm: Drawer = (c) => {
  const { L, F, G, R } = c;
  yardFront(c, 'dirt', F + 6);
  houseEW(c, { x: L + 2, gb: G - 14, w: 13, wh: 7, rh: 13, wall: 'timber', roof: 'thatch', door: 2, windows: [8], chimney: 9 });
  houseNS(c, { cx: R - 9, gb: G - 4, hw: 8, wh: 9, gh: 8, len: 14, wall: 'barn', roof: 'shingle', door: 'barn', finial: 'post' });
  haystack(c, L + 6, G - 3, 4);
  if (c.con === 0) {
    hayBale(c, L + 11, G - 2);
    fenceH(c, L + 1, L + 15, G - 1, 3);
  }
};

const drawLumber: Drawer = (c) => {
  const { L, F, G, R } = c;
  yardFront(c, 'dirt', F + 5);
  const sx = L + 2;
  const sw = 19;
  const gb = G - 8;
  if (c.con !== 1) {
    // open shed: shaded back wall
    wall(c, sx, gb - 9, sw, 8, 'planks');
    for (let py = gb - 9; py <= gb - 2; py++) for (let px = sx; px < sx + sw; px++) c.pc.blend(px, py, '#1a1020', 0.42);
    if (c.con === 0) {
      // saw-bench with a log + bow saw
      c.pc.line(sx + 4, gb, sx + 6, gb - 3, W[2]);
      c.pc.line(sx + 8, gb, sx + 6, gb - 3, W[2]);
      c.pc.line(sx + 11, gb, sx + 13, gb - 3, W[2]);
      c.pc.line(sx + 15, gb, sx + 13, gb - 3, W[2]);
      c.pc.rect(sx + 3, gb - 5, 14, 2, W[3]);
      c.pc.hline(sx + 3, sx + 16, gb - 5, W[4]);
      c.pc.rect(sx + 16, gb - 5, 1, 2, ENDG[2]);
      c.pc.line(sx + 9, gb - 9, sx + 10, gb - 4, M[4]);
      c.pc.hline(sx + 8, sx + 12, gb - 9, W[4]);
    }
  }
  post(c, sx, gb - 10, gb, 1);
  post(c, sx + sw - 1, gb - 10, gb, 1);
  roofEW(c, sx - 1, gb - 25, sw + 2, 16, 'shingle', { ridge: 0.38 });
  logPile(c, R - 12, G - 2, 3, 3, 4);
  stump(c, L + 3, G - 2, true);
  if (c.con === 0) for (let i = 0; i < 7; i++) c.base.px(L + 6 + Math.floor(hash2(i, 1, c.seed) * 10), G - 2 - Math.floor(hash2(i, 2, c.seed) * 4), ENDG[2]);
  construct(c, sx, gb, sw, 10, 8);
};

const drawMine: Drawer = (c, o) => {
  mineScene(c, o.deposit === 'gold', false);
};
function mineScene(c: Ctx, gold: boolean, landmark: boolean) {
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  yard(c, 'gravel', L + 1, F + 8, fw - 2, fw - 9, 3);
  const p = c.pc;
  // rock mound
  blob(p, L + 12, G - 16, 11, 9, ROCK, c.seed + 1, -0.02);
  blob(p, L + 23, G - 15, 9, 8, ROCK, c.seed + 2, -0.08);
  blob(p, L + 16, G - 22, 8, 6, ROCK, c.seed + 3, 0.08);
  p.px(L + 7, G - 21, LEAF[4]);
  p.px(L + 8, G - 22, LEAF[5]);
  p.px(L + 26, G - 19, LEAF[3]);
  if (gold) {
    const spots: [number, number][] = [[L + 7, G - 17], [L + 14, G - 25], [L + 21, G - 21], [L + 27, G - 14], [L + 19, G - 16]];
    for (const [x, y] of spots) {
      p.px(x, y, GD[3]);
      p.px(x + 1, y, GD[4]);
      p.px(x, y + 1, GD[2]);
    }
  } else {
    stoneBlock(c, L + 22, G - 18, 5, 3, 2);
    p.hline(L + 5, L + 9, G - 19, S[5]);
    p.hline(L + 5, L + 9, G - 18, S[3]);
  }
  // entrance with timber frame
  const ex = L + 10;
  const ey = G - 11;
  p.rect(ex, ey - 7, 8, 8, DARK);
  p.rect(ex + 1, ey - 6, 6, 1, '#120c14');
  if (c.con !== 1) {
    p.vline(ex - 1, ey - 8, ey, W[4]);
    p.vline(ex, ey - 8, ey, W[2]);
    p.vline(ex + 7, ey - 8, ey, W[3]);
    p.vline(ex + 8, ey - 8, ey, W[1]);
    if (c.dmg < 2) {
      p.hline(ex - 2, ex + 9, ey - 9, W[4]);
      p.hline(ex - 2, ex + 9, ey - 8, W[2]);
    } else p.line(ex - 2, ey - 9, ex + 6, ey - 4, W[2]);
    if (!landmark && c.con === 0 && c.dmg < 2) {
      p.px(ex + 3, ey - 7, FI[4]);
      p.px(ex + 3, ey - 6, FI[3]);
    }
  }
  // rails
  if (c.con !== 1) {
    for (let y = ey + 1; y <= G - 1; y++) {
      if (md(y, 2) === 0) p.hline(ex + 1, ex + 6, y, W[2]);
      p.px(ex + 2, y, M[3]);
      p.px(ex + 5, y, M[3]);
    }
  }
  oreCart(c, ex + 1, G - 2, gold);
  if (!landmark && c.con !== 1) {
    // headframe with pulley wheel
    const hx = R - 7;
    const hb = G - 3;
    p.line(hx - 3, hb, hx, hb - 18, W[4]);
    p.line(hx + 3, hb, hx, hb - 18, W[2]);
    p.hline(hx - 2, hx + 2, hb - 8, W[3]);
    p.vline(hx, hb - 18, hb, W[3]);
    if (c.dmg < 2) {
      p.ellipse(hx + 0.5, hb - 18.5, 2.5, 2.5, W[1]);
      p.ellipse(hx + 0.5, hb - 18.5, 1.3, 1.3, W[4]);
      p.line(hx + 2, hb - 18, hx + 4, hb - 3, '#a89a7a');
      p.rect(hx + 3, hb - 3, 3, 3, M[2]);
      p.px(hx + 3, hb - 3, M[4]);
    }
  }
  if (landmark && c.con === 0) {
    // pick + lantern
    p.line(L + 22, G - 2, L + 25, G - 6, W[4]);
    p.hline(L + 24, L + 27, G - 6, M[4]);
    p.px(L + 20, G - 3, FI[4]);
    p.px(L + 20, G - 2, M[2]);
  }
  if (c.con === 0) blob(p, L + 4, G - 3, 4, 2.5, gold ? ['#4a3a20', '#6a5428', '#8a6c2a', GD[2], GD[3], GD[4]] : S, c.seed + 7);
  if (c.con) {
    scaffold(c, ex - 2, ey, 12, 10);
    supplies(c);
  }
}

const drawMarket: Drawer = (c) => {
  const { L, F, G, R } = c;
  yardFront(c, 'cobble', F + 6);
  const t = c.tc;
  const stall = (x: number, gb: number, w: number, goods: number) => {
    if (c.con !== 1 || true) wall(c, x, gb - 3, w, 4, 'planks');
    if (c.con === 0 && c.dmg < 2) {
      const gcol = [['#c83a32', '#e05a4a'], ['#5a8a3a', '#7aaa4a'], ['#c8a060', '#e0c080'], ['#e0c050', '#f0e080']][goods & 3];
      for (let i = 1; i < w - 1; i++) c.pc.px(x + i, gb - 4, gcol[i & 1]);
      for (let i = 2; i < w - 2; i += 2) c.pc.px(x + i, gb - 5, gcol[1]);
    }
    const ph = c.con === 1 ? 5 : 11;
    post(c, x, gb - ph, gb);
    post(c, x + w - 1, gb - ph, gb);
    if (c.con === 2) {
      c.pc.hline(x, x + w - 1, gb - 11, W[4]);
      c.pc.line(x, gb - 11, x + 3, gb - 15, W[3]);
      c.pc.line(x + w - 1, gb - 11, x + w - 4, gb - 15, W[3]);
      c.pc.hline(x + 3, x + w - 4, gb - 15, W[3]);
    }
    awning(c, x - 1, gb - 16, w + 2, 4, t);
  };
  stall(L + 3, F + 22, 14, 0);
  stall(R - 17, F + 22, 14, 2);
  well(c, c.ax, G - 14);
  stall(L + 3, G - 2, 12, 1);
  stall(R - 15, G - 2, 12, 3);
  barrel(c, c.ax - 4, G - 2);
  crate(c, c.ax + 1, G - 2);
  sack(c, c.ax + 6, G - 2);
  if (c.con) supplies(c);
};

const drawBarracks: Drawer = (c) => {
  const { L, G, R } = c;
  const fw = c.size * TILE;
  const x = L + 3;
  const w = fw - 6;
  const gb = G - 8;
  const wh = 11;
  const rh = 22;
  yardFront(c, 'dirt', gb - wh - rh + 10);
  houseEW(c, { x, gb, w, wh, rh, wall: 'timber', roof: 'slate', door: Math.floor(w / 2) - 2, doorW: 4, doorKind: 'double', windows: [4, 11, w - 13, w - 6], winKind: 'glass', chimney: 5, hip: 8, found: 3, ridge: 0.38 });
  if (c.con === 0) {
    shieldCrest(c, c.ax, gb - wh + 2, c.tc);
    shieldsRow(c, x + 16, gb - 7, 1, c.tc);
    shieldsRow(c, x + w - 19, gb - 7, 1, c.tc);
  }
  rack(c, L + 3, G - 1, 9);
  dummy(c, R - 12, G - 1);
  poleFlag(c, R - 4, G - 1, 19, c.tc, { w: 6, fh: 4, sym: true });
};

const drawArchery: Drawer = (c) => {
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  yard(c, 'dirt', L + 1, F + 14, 22, fw - 15, 3);
  if (c.con === 0) for (let i = 0; i < 3; i++) yard(c, 'dirt', L + 21 + i * 7, F + 12, 5, fw - 15, 2);
  houseEW(c, { x: L + 3, gb: G - 17, w: 16, wh: 8, rh: 14, wall: 'planks', roof: 'shingle', door: 2, windows: [10], chimney: null });
  for (let i = 0; i < 3; i++) target(c, L + 23 + i * 7, F + 16);
  if (c.con === 0) {
    fenceH(c, L + 2, R - 3, G - 1, 4);
    fenceV(c, R - 3, F + 10, G - 1, 4);
    rack(c, L + 4, G - 5, 6);
    hayBale(c, L + 12, G - 4);
    // shooting line pegs
    for (let i = 0; i < 3; i++) c.pc.vline(L + 23 + i * 7, G - 8, G - 6, W[3]);
  }
  poleFlag(c, L + 20, G - 9, 12, c.tc, { w: 4, fh: 3 });
  if (c.con) supplies(c);
};

const drawStable: Drawer = (c) => {
  const { L, G, R } = c;
  const fw = c.size * TILE;
  const x = L + 3;
  const w = fw - 6;
  const gb = G - 9;
  const wh = 9;
  const y = gb - wh + 1;
  const rh = 19;
  yardFront(c, 'straw', y - rh + 8);
  wall(c, x, y, w, wh, 'planks');
  const horses = ['#5a3a24', '#e8e0d0', '#2a2024', '#8a5a34', '#b07a48'];
  if (c.con !== 1) {
    for (let i = 0; i < 6; i++) {
      const sx = x + 2 + i * 7;
      if (sx + 5 > x + w) break;
      const isDoor = i === 2;
      c.pc.rect(sx, y + 2, 5, isDoor ? wh - 2 : 3, DARK);
      if (!isDoor) {
        c.pc.rect(sx, y + 5, 5, wh - 5, W[3]);
        c.pc.line(sx, y + 5, sx + 4, gb, W[2]);
        c.pc.line(sx + 4, y + 5, sx, gb, W[2]);
        c.pc.hline(sx, sx + 4, y + 5, W[4]);
        if (c.con === 0 && c.dmg < 2 && (i + c.variant) % 4 !== 3) {
          const hc = horses[(i + c.seed) % horses.length];
          c.pc.rect(sx + 1, y + 3, 3, 3, hc);
          c.pc.rect(sx + 2, y + 5, 2, 2, hc);
          c.pc.px(sx + 3, y + 6, shade(hc, -0.3));
          c.pc.px(sx + 1, y + 2, shade(hc, -0.2));
          c.pc.px(sx + 3, y + 3, '#100c10');
          c.pc.px(sx + 1, y + 3, shade(hc, 0.15));
          c.pc.vline(sx, y + 3, y + 4, shade(hc, -0.4));
        }
      }
    }
  }
  roofEW(c, x - 2, y - rh + 1, w + 4, rh, 'thatch', { ridge: 0.32 });
  hayBale(c, R - 9, G - 5);
  hayBale(c, R - 7, G - 8);
  if (c.con === 0) {
    c.pc.rect(L + 5, G - 5, 8, 2, W[2]);
    c.pc.hline(L + 5, L + 12, G - 6, W[4]);
    c.pc.hline(L + 6, L + 11, G - 5, '#3a5a80');
    fenceH(c, L + 1, c.ax - 4, G - 1, 4);
    fenceH(c, c.ax + 4, R - 2, G - 1, 4);
  }
  construct(c, x, gb, w, wh, 10);
};

const drawSiege: Drawer = (c) => {
  const { L, F, G, R } = c;
  yardFront(c, 'dirt', F + 4);
  const x = L + 3;
  const w = 30;
  const gb = G - 14;
  const ph = 13;
  if (c.con !== 1) {
    wall(c, x, gb - ph + 2, w, ph - 1, 'planks');
    for (let py = gb - ph + 2; py <= gb; py++) for (let px = x; px < x + w; px++) c.pc.blend(px, py, '#140c18', 0.45);
    c.pc.rect(x + 3, gb - 2, 12, 2, W[3]);
    c.pc.hline(x + 3, x + 14, gb - 2, W[4]);
    c.pc.rect(x + 18, gb - 6, 2, 6, W[3]);
    c.pc.ellipse(x + 24.5, gb - 2.5, 2.5, 2.5, W[2]);
    c.pc.ellipse(x + 24.5, gb - 2.5, 1.2, 1.2, W[4]);
  }
  for (const px of [x, x + 14, x + w - 1]) post(c, px, gb - ph, gb, 1);
  roofEW(c, x - 2, gb - ph - 18, w + 4, 19, 'shingle', { ridge: 0.36 });
  if (c.con !== 1) {
    // treadwheel crane
    const cx = R - 8;
    const cb = G - 11;
    c.pc.line(cx - 3, cb, cx + 1, cb - 24, W[4]);
    c.pc.line(cx + 4, cb, cx + 1, cb - 24, W[2]);
    c.pc.line(cx + 1, cb - 24, cx - 10, cb - 28, W[3]);
    c.pc.line(cx - 10, cb - 28, cx - 10, cb - 18, '#a89a7a');
    c.pc.rect(cx - 11, cb - 18, 3, 2, S[4]);
    for (let a = 0; a < 28; a++) {
      const ang = (a / 28) * Math.PI * 2;
      c.pc.px(cx + Math.round(Math.cos(ang) * 5), cb - 5 + Math.round(Math.sin(ang) * 5), a < 14 ? W[2] : W[4]);
    }
    c.pc.line(cx - 5, cb - 5, cx + 5, cb - 5, W[3]);
    c.pc.line(cx, cb - 10, cx, cb, W[3]);
  }
  if (c.con === 0) {
    // half-built catapult in the yard
    const kx = L + 6;
    const kb = G - 3;
    c.pc.rect(kx, kb - 1, 16, 2, W[3]);
    c.pc.hline(kx, kx + 15, kb - 1, W[4]);
    c.pc.line(kx + 6, kb - 1, kx + 9, kb - 9, W[4]);
    c.pc.line(kx + 12, kb - 1, kx + 9, kb - 9, W[2]);
    c.pc.line(kx + 2, kb - 3, kx + 15, kb - 11, W[5]);
    c.pc.rect(kx + 14, kb - 13, 3, 2, '#a89a7a');
    c.pc.ellipse(kx + 2.5, kb, 2, 2, W[1]);
    c.pc.px(kx + 2, kb - 1, W[4]);
    logPile(c, R - 11, G - 2, 2, 2, 2);
  }
  construct(c, x, gb, w, ph, 12);
};

const drawSmith: Drawer = (c) => {
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  yardFront(c, 'gravel', F + 6);
  const gb = G - 6;
  const x = L + 12;
  const w = fw - 15;
  houseEW(c, { x, gb, w, wh: 10, rh: 17, wall: 'rough', roof: c.variant & 1 ? 'tile' : 'slate', door: 6, windows: [2], chimney: null });
  chimney(c, x + w - 6, gb - 32, 24, { glow: true, w: 5 });
  // open lean-to forge
  const fx = L + 2;
  const fwid = 11;
  if (c.con !== 1) {
    wall(c, fx, gb - 7, fwid, 7, 'rough');
    for (let py = gb - 7; py <= gb - 1; py++) for (let px = fx; px < fx + fwid; px++) c.pc.blend(px, py, '#140c18', 0.45);
    if (c.con === 0 && c.dmg < 2) {
      c.pc.rect(fx + 2, gb - 3, 6, 3, S[2]);
      c.pc.hline(fx + 3, fx + 6, gb - 3, FI[3]);
      c.pc.px(fx + 4, gb - 4, FI[4]);
      c.pc.px(fx + 5, gb - 4, FI[5]);
      c.pc.px(fx + 3, gb - 4, FI[2]);
      c.pc.px(fx + 5, gb - 5, FI[3]);
      c.pc.hline(fx + 2, fx + 7, gb - 2, FI[1]);
      glow(c, fx + 5, gb + 1, 8, 3, 0.45);
      for (let px = fx; px < fx + fwid; px++) for (let py = gb - 7; py <= gb; py++) if (Math.abs(px - fx - 5) < 5) c.pc.blend(px, py, FI[3], 0.14 * (1 - Math.abs(px - fx - 5) / 5));
      c.pc.vline(fx + 9, gb - 6, gb - 3, W[3]);
      c.pc.px(fx + 9, gb - 6, M[4]);
      c.pc.px(fx + 1, gb - 6, M[4]);
      c.pc.vline(fx + 1, gb - 5, gb - 3, W[3]);
    }
    post(c, fx, gb - 9, gb);
  }
  roofEW(c, fx - 1, gb - 17, fwid + 2, 10, 'shingle', { ridge: 0.15 });
  anvil(c, L + 4, G - 1);
  barrel(c, L + 11, G - 1);
  if (c.con === 0) {
    blob(c.pc, R - 5, G - 2, 3, 1.8, ['#141012', '#1e1a1c', '#2a2628', '#3a3436'], 3);
    c.pc.line(L + 2, G - 1, L + 3, G - 5, W[4]);
  }
};

const drawChapel: Drawer = (c) => {
  const { L, F, G } = c;
  const fw = c.size * TILE;
  yard(c, 'gravel', L + 3, F + 8, fw - 6, fw - 9, 3);
  const gb = G - 4;
  const hw = 9;
  const wm: WallMat = c.variant & 1 ? 'plaster' : 'rough';
  houseNS(c, { cx: c.ax, gb, hw, wh: 11, gh: 9, len: 14, wall: wm, roof: 'slate', door: 'arch', windows: [] });
  if (c.con === 0) {
    win(c, c.ax - 7, gb - 8, 2, 4, 'stained');
    win(c, c.ax + 5, gb - 8, 2, 4, 'stained');
    if (c.dmg < 2) win(c, c.ax - 2, gb - 11 - 5, 1, 1, 'round');
    if (c.dmg < 2) {
      // belfry over the front gable
      const tw = 7;
      const tx = c.ax - 3;
      const tb = gb - 11 - 9 + 1;
      wall(c, tx, tb - 9, tw, 10, wm);
      c.pc.rect(tx + 2, tb - 7, 3, 4, DARK);
      c.pc.rect(tx + 2, tb - 6, 3, 2, GD[3]);
      c.pc.px(tx + 2, tb - 6, GD[4]);
      c.pc.px(tx + 3, tb - 4, GD[2]);
      pyramid(c, c.ax, tb - 9, 4, 3, 10, 'slate', { finial: 'cross' });
    }
  }
  grave(c, c.L + 2, G - 1, 0);
  grave(c, c.R - 5, G - 1, 1);
};

const drawWatchtower: Drawer = (c) => {
  const { L, F, G } = c;
  const fw = c.size * TILE;
  yard(c, 'dirt', L + 5, F + 10, fw - 10, fw - 11, 3);
  const tw = 10;
  const tx = c.ax - (tw >> 1);
  const gb = G - 5;
  const sh = 12;
  const uh = 17;
  wall(c, tx, gb - sh + 1, tw, sh, 'stone');
  const uy = gb - sh - uh + 1;
  if (c.con === 1) {
    for (const px of [tx, tx + tw - 1]) c.pc.vline(px, uy, gb - 4, W[4]);
  } else {
    wall(c, tx, uy, tw, uh, 'planks');
    if (c.dmg < 2 && c.con === 0) {
      win(c, c.ax - 2, uy + 7, 1, 3, 'slit');
      win(c, c.ax + 2, uy + 11, 1, 3, 'slit');
      wallBanner(c, tx + tw - 4, uy + 2, 3, 9, c.tc);
    }
    lookout(c, tx, uy, tw, 'shingle');
  }
  door(c, c.ax - 2, gb - 5, 4, 6, 'arch');
  barrel(c, L + 5, G - 2);
  crate(c, c.R - 9, G - 2);
  if (c.con) {
    scaffold(c, tx - 1, gb, tw + 2, c.con === 1 ? 10 : sh + uh);
    supplies(c);
  }
};

const drawMercCamp: Drawer = (c) => {
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  yard(c, 'dirt', L + 2, F + 6, fw - 4, fw - 7, 5);
  const t = c.tc;
  tent(c, L + 11, F + 23, 8, 9, 10, '#8a7a5a', { stripe: t.main });
  tent(c, R - 12, F + 21, 7, 8, 9, '#6e6050');
  campfire(c, c.ax, G - 12);
  if (c.con === 0) {
    c.pc.rect(c.ax - 8, G - 12, 4, 2, W[3]);
    c.pc.hline(c.ax - 8, c.ax - 5, G - 12, W[4]);
    c.pc.rect(c.ax + 5, G - 11, 4, 2, W[3]);
    c.pc.hline(c.ax + 5, c.ax + 8, G - 11, W[4]);
  }
  tent(c, L + 9, G - 2, 6, 7, 7, '#7a4a3a');
  rack(c, R - 15, G - 2, 7);
  crate(c, R - 7, G - 2);
  barrel(c, R - 6, G - 8);
  poleFlag(c, c.ax + 2, G - 2, 19, t, { w: 6, fh: 5, sym: true });
  poleFlag(c, L + 2, F + 24, 12, t, { w: 4, fh: 3, phase: 2 });
  if (c.con) supplies(c);
};

// ---------------------------------------------------------------------------- landmarks
function drawLandmark(c: Ctx, o: BuildingOpts) {
  const kind = o.landmark ?? 'ruins';
  const { L, F, G, R } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  switch (kind) {
    case 'woodcutter': {
      yardFront(c, 'dirt', F + 8);
      houseEW(c, { x: L + 3, gb: G - 8, w: 17, wh: 8, rh: 15, wall: 'logs', roof: 'shingle', door: 3, windows: [11], winKind: 'shutter', chimney: 13 });
      logPile(c, R - 11, G - 6, 3, 2, 3);
      stump(c, R - 9, G - 1, true);
      if (c.con === 0) {
        // saw-horse with a log
        p.line(L + 3, G - 1, L + 5, G - 4, W[2]);
        p.line(L + 7, G - 1, L + 5, G - 4, W[2]);
        p.rect(L + 2, G - 6, 9, 2, W[3]);
        p.hline(L + 2, L + 10, G - 6, W[4]);
        p.rect(L + 10, G - 6, 1, 2, ENDG[2]);
        for (let i = 0; i < 6; i++) c.base.px(L + 12 + Math.floor(hash2(i, 3, c.seed) * 9), G - 1 - Math.floor(hash2(i, 4, c.seed) * 4), ENDG[2]);
      }
      break;
    }
    case 'shrine': {
      yard(c, 'gravel', L + 5, F + 14, fw - 10, fw - 16, 4);
      const cx = c.ax;
      const gb = G - 6;
      p.rect(cx - 8, gb - 1, 16, 3, S[3]);
      p.hline(cx - 8, cx + 7, gb - 1, S[5]);
      p.hline(cx - 8, cx + 7, gb + 1, S[2]);
      wall(c, cx - 7, gb - 11, 3, 10, 'stone');
      wall(c, cx + 4, gb - 11, 3, 10, 'stone');
      if (c.dmg < 2) {
        // saint statue on a plinth with candles
        p.rect(cx - 2, gb - 3, 5, 2, S[4]);
        p.rect(cx - 1, gb - 10, 3, 7, S[5]);
        p.vline(cx + 1, gb - 10, gb - 4, S[3]);
        p.rect(cx - 1, gb - 12, 3, 2, S[6]);
        p.px(cx + 1, gb - 11, S[4]);
        p.px(cx - 2, gb - 8, S[5]);
        p.px(cx + 2, gb - 8, S[3]);
        for (const dx of [-4, 3]) {
          p.px(cx + dx, gb - 2, CREAM);
          p.px(cx + dx, gb - 3, FI[4]);
        }
        glow(c, cx, gb, 7, 3, 0.3);
      }
      roofNS(c, cx, gb - 11, 9, 6, 9, 'tile', { finial: 'cross' });
      flowers(c, cx - 11, G - 2, 3);
      flowers(c, cx + 6, G - 2, 3);
      break;
    }
    case 'tower': {
      yard(c, 'gravel', L + 6, F + 14, fw - 12, fw - 15, 4);
      const tc: Ctx = { ...c, dmg: Math.max(1, c.dmg) };
      roundTower(tc, c.ax, G - 9, 8, 30, { top: 'cren' });
      if (c.dmg < 2 && c.con === 0) {
        for (let i = 0; i < 12; i++) {
          const ix = c.ax - 7 + (i % 4) + (i > 6 ? 1 : 0);
          p.px(ix, G - 12 - i * 2 + (i & 1), LEAF[3 + (i & 1)]);
          if (i % 3 === 0) p.px(ix + 1, G - 12 - i * 2, LEAF[5]);
        }
        p.rect(c.ax - 1, G - 14, 3, 5, DARK);
        p.px(c.ax - 1, G - 14, S[3]);
        p.px(c.ax + 1, G - 14, S[3]);
        win(c, c.ax + 2, G - 30, 1, 3, 'slit');
      }
      blob(p, R - 7, G - 2, 3, 2, S, 2);
      blob(p, L + 6, G - 2, 2, 1.5, S, 5);
      break;
    }
    case 'crossroads': {
      // crossing dirt tracks
      yard(c, 'dirt', L + 1, G - 14, fw - 2, 7, 2);
      yard(c, 'dirt', c.ax - 4, F + 6, 8, fw - 7, 2);
      const sx = L + 7;
      p.vline(sx, G - 19, G - 4, W[4]);
      p.vline(sx + 1, G - 19, G - 4, W[2]);
      const board = (x: number, y: number, w: number, dir: number) => {
        p.rect(x, y, w, 2, W[5]);
        p.hline(x, x + w - 1, y + 1, W[3]);
        p.px(dir < 0 ? x - 1 : x + w, y, W[4]);
        p.px(dir < 0 ? x - 1 : x + w, y + 1, W[3]);
        p.px(x + 1 + (w >> 1), y, W[2]);
      };
      board(sx - 5, G - 18, 5, -1);
      board(sx + 2, G - 15, 6, 1);
      board(sx - 4, G - 11, 4, -1);
      // gibbet with an iron cage
      const gx = R - 7;
      p.vline(gx, G - 26, G - 3, W[3]);
      p.vline(gx + 1, G - 26, G - 3, W[1]);
      p.hline(gx - 7, gx + 1, G - 26, W[4]);
      p.hline(gx - 7, gx + 1, G - 25, W[2]);
      p.line(gx - 3, G - 25, gx, G - 22, W[2]);
      p.vline(gx - 6, G - 24, G - 22, M[3]);
      p.rect(gx - 8, G - 21, 5, 7, '#241e26');
      for (let i = 0; i < 5; i += 2) p.vline(gx - 8 + i, G - 21, G - 15, M[3]);
      p.hline(gx - 8, gx - 4, G - 21, M[4]);
      p.hline(gx - 8, gx - 4, G - 15, M[2]);
      p.px(gx - 7, G - 18, '#d8d0c0');
      // milestone
      p.rect(c.ax - 1, G - 5, 4, 4, S[4]);
      p.hline(c.ax - 1, c.ax + 2, G - 6, S[6]);
      p.vline(c.ax + 2, G - 5, G - 2, S[2]);
      p.px(c.ax, G - 4, S[2]);
      p.px(c.ax + 1, G - 4, S[2]);
      break;
    }
    case 'mine':
      mineScene(c, o.deposit === 'gold', true);
      break;
    case 'quarry': {
      yardFront(c, 'gravel', F + 8);
      blob(p, L + 16, G - 24, 13, 6, ROCK, c.seed, 0.02);
      // stepped cut terraces
      const tiers = [
        { x: L + 3, w: 26, gb: G - 17, h: 6 },
        { x: L + 6, w: 19, gb: G - 11, h: 5 },
        { x: L + 9, w: 11, gb: G - 6, h: 4 },
      ];
      for (const t of tiers) {
        for (let py = t.gb - t.h - 3; py <= t.gb; py++)
          for (let px = t.x; px < t.x + t.w; px++) {
            const top = py < t.gb - t.h + 1;
            let col: string;
            if (top) col = rv(S, 0.78 + (px === t.x ? 0.1 : 0) + (hash2(px >> 2, py, 7) - 0.5) * 0.1);
            else {
              const drill = md(px - t.x, 3) === 1;
              col = rv(S, 0.48 + (drill ? -0.14 : 0) + (px === t.x ? 0.12 : px === t.x + t.w - 1 ? -0.15 : 0) + (py === t.gb - t.h + 1 ? 0.1 : 0));
            }
            p.px(px, py, col);
          }
      }
      stoneBlock(c, L + 2, G - 1, 6, 3, 2);
      stoneBlock(c, L + 21, G - 1, 5, 3, 2);
      stoneBlock(c, L + 22, G - 5, 4, 2, 2);
      // wooden crane
      const cx = R - 5;
      p.vline(cx, G - 24, G - 1, W[4]);
      p.vline(cx + 1, G - 24, G - 1, W[2]);
      p.line(cx, G - 24, cx - 10, G - 20, W[4]);
      p.line(cx, G - 13, cx - 6, G - 21, W[3]);
      p.vline(cx - 9, G - 20, G - 13, '#a89a7a');
      stoneBlock(c, cx - 11, G - 11, 4, 2, 2);
      break;
    }
    case 'ruins': {
      yardFront(c, 'gravel', F + 10);
      const rc: Ctx = { ...c, dmg: 2, seed: c.seed + 3 };
      // back wall with a window, side wall return, free-standing arch
      wall(rc, L + 3, G - 25, 20, 14, 'stone');
      p.rect(L + 9, G - 21, 2, 3, DARK);
      wallStrip({ ...c, dmg: 2 }, L + 3, G - 23, G - 15, 4);
      wall({ ...c, dmg: 2, seed: c.seed + 8 }, L + 3, G - 14, 4, 10, 'stone');
      const ar = (x: number, h: number) => wall({ ...c, dmg: 0 }, x, G - 3 - h, 3, h + 1, 'stone');
      ar(R - 13, 13);
      ar(R - 6, 11);
      p.hline(R - 13, R - 7, G - 17, S[5]);
      p.hline(R - 12, R - 8, G - 16, S[3]);
      p.px(R - 11, G - 15, S[3]);
      p.px(R - 9, G - 15, S[2]);
      // fallen column
      p.rect(L + 10, G - 4, 9, 3, S[4]);
      p.hline(L + 10, L + 18, G - 4, S[5]);
      p.hline(L + 10, L + 18, G - 2, S[2]);
      p.rect(L + 19, G - 4, 1, 3, S[6]);
      blob(p, c.ax + 4, G - 8, 3, 2, S, 1);
      blob(p, L + 8, G - 6, 2, 1.5, S, 2);
      for (const [gx, gy] of [[L + 5, G - 16], [L + 15, G - 13], [R - 12, G - 10], [R - 5, G - 8]] as const) {
        p.px(gx, gy, LEAF[4]);
        p.px(gx + 1, gy - 1, LEAF[5]);
      }
      break;
    }
    case 'fort': {
      yard(c, 'dirt', L + 1, F + 2, fw - 2, fw - 3);
      const rc: Ctx = { ...c, dmg: Math.max(1, c.dmg) };
      palisadeRun({ ...c, dmg: 2, seed: c.seed + 3 }, L + 1, R - 2, F + 10, 9);
      houseEW(rc, { x: L + 8, gb: G - 9, w: 16, wh: 9, rh: 12, wall: 'logs', roof: 'shingle', door: 6, windows: [], chimney: null });
      palisadeSide({ ...c, dmg: 2 }, L + 2, F + 10, G - 3);
      palisadeSide({ ...c, dmg: 2, seed: c.seed + 9 }, R - 3, F + 10, G - 3);
      palisadeRun({ ...c, dmg: 2, seed: c.seed + 5 }, L + 1, R - 2, G - 2, 9);
      break;
    }
    case 'abbey': {
      yard(c, 'gravel', L + 1, F + 4, fw - 2, fw - 5);
      houseEW(c, { x: L + 10, gb: G - 6, w: fw - 13, wh: 11, rh: 14, wall: 'rough', roof: 'slate', door: null, windows: [], chimney: null });
      if (c.con === 0) {
        win(c, L + 13, G - 13, 2, 4, 'stained');
        win(c, L + 19, G - 13, 2, 4, 'stained');
        win(c, L + 25, G - 13, 2, 4, 'stained');
      }
      // square bell tower with spire
      sqTower(c, L + 2, G - 4, 9, 22, 4, { mat: 'rough', top: 'pyramid', roof: 'slate', rise: 13, finial: 'cross', slits: false });
      if (c.con === 0 && c.dmg < 2) {
        p.rect(L + 5, G - 22, 3, 4, DARK);
        p.rect(L + 5, G - 21, 3, 2, GD[3]);
        p.px(L + 5, G - 21, GD[4]);
      }
      door(c, L + 5, G - 9, 3, 6, 'arch', 'stone');
      break;
    }
    case 'stones': {
      yard(c, 'gravel', L + 3, F + 10, fw - 6, fw - 12, 7);
      const n = 7;
      const stones: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.25;
        stones.push([c.ax + Math.cos(a) * 11, G - 12 + Math.sin(a) * 6.5, i]);
      }
      stones.sort((a, b) => a[1] - b[1]);
      const stone = (x: number, gb: number, w: number, h: number, seed: number) => {
        for (let y = 0; y < h; y++)
          for (let dx = 0; dx < w; dx++) {
            if (y === h - 1 && (dx === 0 || dx === w - 1)) continue;
            const l = 0.55 - (dx / (w - 1) - 0.5) * 0.5 + (y === h - 1 || y === h - 2 ? 0.15 : 0) + (hash2(dx, y >> 1, seed) - 0.5) * 0.12;
            p.px(x + dx, gb - y, rv(S, l));
          }
        p.px(x, gb - 2, LEAF[3]);
        p.px(x + 1, gb - 1, LEAF[4]);
      };
      let altar = false;
      for (const [sx, sy, i] of stones) {
        if (!altar && sy > G - 12) {
          p.rect(c.ax - 3, G - 13, 7, 2, S[3]);
          p.hline(c.ax - 3, c.ax + 3, G - 14, S[5]);
          p.hline(c.ax - 3, c.ax + 3, G - 15, S[6]);
          altar = true;
        }
        const x = Math.round(sx) - 2;
        const gb = Math.round(sy);
        if (i === 1 && c.dmg < 2) {
          // trilithon: two uprights + lintel
          stone(x - 3, gb, 3, 9, 4);
          stone(x + 3, gb, 3, 9, 5);
          p.rect(x - 4, gb - 11, 11, 2, S[4]);
          p.hline(x - 4, x + 6, gb - 11, S[6]);
          p.hline(x - 4, x + 6, gb - 9, S[2]);
        } else stone(x, gb, 4, 7 + Math.round(hash2(i, 3, c.seed) * 3), i);
      }
      break;
    }
    case 'camp': {
      yard(c, 'dirt', L + 1, F + 6, fw - 2, fw - 7);
      tent(c, L + 9, G - 12, 6, 7, 7, '#5a4a3a');
      tent(c, R - 9, G - 14, 6, 7, 6, '#4a3e34');
      campfire(c, c.ax, G - 5);
      crate(c, L + 3, G - 3);
      barrel(c, R - 6, G - 3);
      // torn banner
      p.line(R - 3, G - 3, R - 4, G - 18, W[2]);
      p.rect(R - 8, G - 18, 4, 5, BANDIT.main);
      p.px(R - 7, G - 13, BANDIT.main);
      p.px(R - 6, G - 16, BANDIT.light);
      break;
    }
    case 'graveyard': {
      yard(c, 'dirt', L + 1, F + 4, fw - 2, fw - 5);
      houseNS(c, { cx: L + 10, gb: G - 13, hw: 7, wh: 9, gh: 6, len: 9, wall: 'rough', roof: 'slate', door: 'arch', finial: 'cross' });
      for (let i = 0; i < 4; i++) grave(c, L + 19 + (i % 2) * 6, G - 14 + Math.floor(i / 2) * 6, i + c.variant);
      grave(c, L + 4, G - 3, 2);
      grave(c, L + 10, G - 3, 0);
      // low wall
      p.hline(L + 1, R - 2, G - 1, S[3]);
      p.hline(L + 1, R - 2, G - 2, S[5]);
      for (let x = L + 1; x < R - 1; x += 3) p.px(x, G - 1, S[2]);
      // dead tree
      p.vline(R - 4, G - 22, G - 15, W[1]);
      p.line(R - 4, G - 19, R - 8, G - 23, W[1]);
      p.line(R - 4, G - 21, R - 2, G - 24, W[1]);
      break;
    }
    case 'lodge': {
      yard(c, 'dirt', L + 1, F + 5, fw - 2, fw - 6);
      houseEW(c, { x: L + 3, gb: G - 7, w: 20, wh: 9, rh: 14, wall: 'logs', roof: 'shingle', door: 8, windows: [3, 14], winKind: 'shutter', chimney: 15 });
      if (c.con === 0 && c.dmg < 2) {
        // antlers over the door
        const ax = L + 12;
        const ay2 = G - 16;
        p.px(ax, ay2, CREAM);
        p.px(ax + 1, ay2, CREAM);
        p.line(ax - 1, ay2, ax - 3, ay2 - 2, '#d8ccb0');
        p.line(ax + 2, ay2, ax + 4, ay2 - 2, '#d8ccb0');
        p.px(ax - 2, ay2 - 2, '#d8ccb0');
        p.px(ax + 3, ay2 - 2, '#d8ccb0');
      }
      // hide stretched on a frame
      if (c.con === 0) {
        const hx = R - 7;
        p.rect(hx - 1, G - 12, 1, 10, W[2]);
        p.rect(hx + 5, G - 12, 1, 10, W[2]);
        p.rect(hx, G - 11, 5, 6, '#9a6a44');
        p.rect(hx + 1, G - 10, 3, 4, '#b48458');
        p.hline(hx - 1, hx + 5, G - 12, W[3]);
      }
      break;
    }
    case 'plague': {
      yard(c, 'mud', L + 2, F + 5, fw - 4, fw - 6);
      houseEW({ ...c, dmg: c.dmg === 0 ? 1 : c.dmg }, { x: L + 4, gb: G - 6, w: fw - 9, wh: 10, rh: 15, wall: 'timber', roof: 'thatch', door: 5, windows: [12, 18], winKind: 'boarded', chimney: null });
      if (c.con === 0 && c.dmg < 2) {
        // boarded door + red cross
        const dx = L + 9;
        p.line(dx - 1, G - 12, dx + 3, G - 7, W[4]);
        p.line(dx + 3, G - 12, dx - 1, G - 7, W[4]);
        p.line(dx, G - 13, dx + 2, G - 11, '#b82020');
        p.line(dx + 2, G - 13, dx, G - 11, '#b82020');
      }
      // cart with sacks
      cart(c, R - 11, G - 2, null);
      sack(c, R - 9, G - 6);
      break;
    }
    case 'burned': {
      yard(c, 'ash', L + 2, F + 5, fw - 4, fw - 6);
      const rc: Ctx = { ...c, dmg: 2 };
      houseEW(rc, { x: L + 4, gb: G - 6, w: fw - 9, wh: 10, rh: 15, wall: 'charred', roof: 'thatch', door: 5, windows: [13], chimney: null });
      chimney({ ...c, dmg: 0 }, L + 22, G - 24, 18);
      scorch(rc, 4, 0.6);
      break;
    }
  }
  if (c.team && c.con === 0) smallFlag(c, R - 3, G - 2, c.team);
}

const DRAWERS: Record<string, Drawer> = {
  capital_castle: drawCastle,
  keep: drawKeep,
  town_hall: drawTownHall,
  village_hall: drawVillageHall,
  outpost_tower: drawOutpost,
  landmark: (c, o) => drawLandmark(c, o),
  house: drawHouse,
  farm: drawFarm,
  lumber_camp: drawLumber,
  mine: drawMine,
  market: drawMarket,
  barracks: drawBarracks,
  archery_range: drawArchery,
  stable: drawStable,
  siege_workshop: drawSiege,
  blacksmith: drawSmith,
  chapel: drawChapel,
  watchtower: drawWatchtower,
  merc_camp: drawMercCamp,
};

const TOP: Record<string, number> = {
  capital_castle: 72,
  keep: 60,
  town_hall: 52,
  watchtower: 52,
  chapel: 44,
  outpost_tower: 40,
  siege_workshop: 40,
  landmark: 40,
};

// ======================================================================================== API
export function drawBuilding(type: string, size: number, team: KingdomColor | null, state: BuildingState, opts: BuildingOpts = {}): BuildingSprite {
  if (type === 'wall') return drawWall('stone', 2 | 8, false, team, state === 'damaged' || state === 'ruined');
  if (type === 'gatehouse') return drawWall('stone', 2 | 8, true, team, state === 'damaged' || state === 'ruined');
  const variant = opts.variant ?? 0;
  const tier = opts.tier ?? 3;
  const salt = type.length * 3 + (opts.landmark ? opts.landmark.length * 5 : 0);
  const c = makeCtx(size, TOP[type] ?? 36, teamOf(team), state, variant, tier, salt);
  const fn = DRAWERS[type] ?? drawHouse;
  fn(c, opts);
  return finish(c);
}

/** 1×1 decorative home */
export function drawCottage(variant: number, team: KingdomColor | null, tier: number): BuildingSprite {
  const c = makeCtx(1, 28, teamOf(team), 'built', variant, tier, 77);
  const { L, F, G } = c;
  const v = md(variant, 4);
  yard(c, 'dirt', L + 1, F + 4, 14, 11, 2);
  const nice = tier >= 3;
  const tall = tier >= 4;
  const walls: WallMat[] = ['timber', 'timber', 'rough', 'logs'];
  const roofs: RoofMat[] = nice ? ['tile', 'slate', 'tile', 'shingle'] : ['thatch', 'thatch', 'slate', 'shingle'];
  const wm = nice && v === 3 ? 'plaster' : walls[v];
  const x = L + 2;
  const w = 12;
  const gb = G - 3;
  const wh = tall ? 12 : 7;
  const y = gb - wh + 1;
  wall(c, x, y, w, wh, wm, { found: wm === 'timber' || wm === 'plaster' ? 1 : 0, ends: wm === 'logs', spacing: 4 });
  door(c, x + (v & 1 ? 7 : 2), gb - 4, 3, 5, 'plank');
  win(c, x + (v & 1 ? 2 : 8), gb - 4, 2, 2, nice ? 'box' : 'glass');
  if (tall) {
    win(c, x + 2, y + 2, 2, 2, 'glass');
    win(c, x + 8, y + 2, 2, 2, v & 1 ? 'lit' : 'glass');
    c.pc.hline(x, x + w - 1, y + 5, W[1]);
  }
  const rh = tall ? 11 : 10;
  roofEW(c, x - 2, y - rh + 1, w + 4, rh, roofs[v], { ridge: 0.34, hip: v === 2 && nice ? 3 : 0 });
  if (v !== 3 || nice) chimney(c, x + (v & 1 ? 2 : 8), y - rh - 1, 5);
  if (team && nice) {
    const fy = y - rh + 1 + Math.round((rh - 1) * 0.34);
    c.pc.vline(x - 1, fy - 3, fy, W[2]);
    flagCloth(c, x, fy - 3, 3, 2, teamOf(team)!, variant & 3);
  }
  if (v === 0) flowers(c, x + 6, G - 2, 3);
  if (v === 2) bush(c, L + 14, G - 1, 2);
  return finish(c);
}

/**
 * 1-tile wall piece. mask bits 1=N 2=E 4=S 8=W (neighbours that are wall/gate).
 * Pieces are drawn in oblique projection so a run of tiles joins seamlessly when the
 * renderer depth-sorts them by their anchor (ground line).
 */
export function drawWall(kind: 'palisade' | 'stone', mask: number, gate: boolean, team: KingdomColor | null, damaged: boolean): BuildingSprite {
  const c = makeCtx(1, 24, teamOf(team), 'built', mask, 3, kind === 'stone' ? 3 : 4);
  const p = c.pc;
  const ty = c.F;
  const tx = c.L;
  const N = !!(mask & 1);
  const E = !!(mask & 2);
  const Sd = !!(mask & 4);
  const Wd = !!(mask & 8);
  const ew = E || Wd || !(N || Sd);
  const brk = (k: number) => damaged && hash2(k, mask, 9) < 0.3;
  const road = (vertical: boolean) => {
    if (vertical) yard(c, 'dirt', tx + 4, ty, 8, 16, 1);
    else yard(c, 'dirt', tx, ty + 5, 16, 7, 1);
  };
  if (kind === 'stone') {
    const Hh = 10;
    const x0 = tx + 5;
    const x1 = tx + 10;
    const gy0 = ty + 6;
    const gy1 = ty + 11;
    /** wall block on ground [ax0..ax1]×[ay0..ay1]: walkway top, optional south face */
    const box = (ax0: number, ax1: number, ay0: number, ay1: number, front: boolean, nsEdges: boolean, ewEdges: boolean, hh = Hh) => {
      for (let y = ay0 - hh; y <= ay1 - hh; y++)
        for (let x = ax0; x <= ax1; x++) {
          let col = rv(S, 0.64 + (md(y, 3) === 0 ? -0.07 : 0) + (x === ax0 ? 0.06 : 0) + (x === ax1 ? -0.1 : 0));
          if (nsEdges && (x === x0 || x === x1)) {
            const mer = md(y, 3) !== 0 && !brk(y * 3 + x);
            col = mer ? (x === x0 ? S[6] : S[4]) : S[2];
          }
          p.px(x, y, col);
        }
      if (ewEdges)
        for (let x = ax0; x <= ax1; x++) {
          const mer = md(x, 3) !== 0 && !brk(x);
          p.px(x, ay0 - hh, mer ? S[5] : S[3]);
          if (mer) {
            p.px(x, ay0 - hh - 1, S[6]);
            p.px(x, ay0 - hh - 2, S[5]);
          }
        }
      if (!front) return;
      for (let y = ay1 - hh + 1; y <= ay1; y++)
        for (let x = ax0; x <= ax1; x++) {
          const ly = ay1 - y;
          const k = Math.floor(ly / 3);
          const r = ly % 3;
          const q = x + (k & 1) * 3;
          let col = r === 0 || q % 5 === 0 ? mix(S[1], S[2], 0.55) : rv(S, 0.46 + (hash2(Math.floor(q / 5), k, 2) - 0.5) * 0.2 + (r === 2 ? 0.1 : 0));
          if (ly === hh - 1) col = S[4];
          p.px(x, y, col);
        }
      if (ewEdges)
        for (let x = ax0; x <= ax1; x++)
          if (md(x, 3) !== 0 && !brk(x + 40)) {
            p.px(x, ay1 - hh, S[5]);
            p.px(x, ay1 - hh - 1, S[6]);
          }
    };
    const gateTower = (x: number, gb: number, w: number, h: number, d: number) => {
      const cc: Ctx = { ...c, dmg: damaged ? 1 : 0 };
      wall(cc, x, gb - h + 1, w, h, 'stone');
      crenTop(cc, x, gb - h + 1 - d, w, d, { period: 3 });
    };
    if (gate && ew) {
      road(true);
      if (Wd) box(tx, tx + 2, gy0, gy1, true, false, true);
      if (E) box(tx + 13, tx + 15, gy0, gy1, true, false, true);
      const th = Hh + 6;
      gateTower(tx, ty + 12, 5, th, 4);
      gateTower(tx + 11, ty + 12, 5, th, 4);
      // arch block between the towers
      const ab = ty + 11;
      for (let y = ab - Hh - 1; y <= ab; y++)
        for (let x = tx + 5; x <= tx + 10; x++) {
          const inArch = y > ab - 7 && x > tx + 5 && x < tx + 10 && !(y === ab - 6 && (x === tx + 6 || x === tx + 9));
          const col = inArch ? (md(x, 2) === 0 && y < ab - 1 ? M[2] : DARK) : y === ab - Hh - 1 ? S[6] : rv(S, 0.5 + (md(y, 3) === 0 ? -0.2 : 0));
          p.px(x, y, col);
        }
      for (let x = tx + 5; x <= tx + 10; x++) p.px(x, ab - Hh - 2, md(x, 2) ? S[6] : S[3]);
      wallBanner(c, tx + 1, ty + 1, 3, 8, c.tc);
      wallBanner(c, tx + 12, ty + 1, 3, 8, c.tc);
      shieldCrest(c, tx + 8, ab - Hh + 1, c.tc);
    } else if (gate) {
      // gate in a north-south wall: a wider roofed gatehouse straddling the wall, road crossing E-W
      road(false);
      if (N) box(x0, x1, ty, ty + 2, false, true, false);
      const cc: Ctx = { ...c, dmg: damaged ? 1 : 0 };
      const gw = 12;
      const gx = tx + 2;
      const gb = ty + 13;
      const gh = Hh + 2;
      wall(cc, gx, gb - gh + 1, gw, gh, 'stone');
      door(cc, tx + 6, gb - 6, 4, 7, 'gate', 'stone');
      pyramid(cc, tx + 7, gb - gh + 1, 7, 8, 7, 'slate', { finial: 'team' });
      wallBanner(c, gx + 1, gb - gh + 2, 2, 6, c.tc);
      wallBanner(c, gx + gw - 3, gb - gh + 2, 2, 6, c.tc);
      if (Sd) box(x0, x1, ty + 14, ty + 15, true, true, false);
    } else {
      if (N) box(x0, x1, ty, gy0 - 1, false, true, false);
      if (Wd) box(tx, x0 - 1, gy0, gy1, true, false, true);
      if (E) box(x1 + 1, tx + 15, gy0, gy1, true, false, true);
      box(x0, x1, gy0, gy1, true, (N || Sd) && !ew, ew);
      if (Sd) box(x0, x1, gy1 + 1, ty + 15, true, true, false);
    }
  } else {
    const Hh = 11;
    /** E-W palisade log (2px) */
    const log = (x: number, gb: number, h: number) => {
      let hh = h;
      if (damaged) hh = Math.round(h * (0.55 + 0.45 * hash2(x, gb, 3)));
      p.vline(x, gb - hh + 1, gb, W[4]);
      p.vline(x + 1, gb - hh + 1, gb, W[2]);
      p.px(x, gb - hh, W[5]);
      p.px(x + 1, gb - hh + 1, W[3]);
      p.px(x, gb - 3, W[3]);
      p.px(x + 1, gb - 3, W[1]);
    };
    /** log seen in a N-S run (3px), stacked so each tip shows */
    const logNS = (x: number, gb: number, h: number, wide = 3) => {
      let hh = h;
      if (damaged) hh = Math.round(h * (0.55 + 0.45 * hash2(x, gb, 5)));
      for (let y = gb - hh - 1; y <= gb; y++)
        for (let i = 0; i < wide; i++) {
          const tip = y === gb - hh - 1;
          const sub = y === gb - hh;
          if (tip && i !== 1) continue;
          let col = i === 0 ? W[4] : i === wide - 1 ? W[1] : W[3];
          if (tip) col = W[5];
          else if (sub) col = i === 0 ? W[5] : i === wide - 1 ? W[2] : W[4];
          else if (y === gb - hh + 1) col = i === wide - 1 ? W[0] : W[2];
          p.px(x + i, y, col);
        }
    };
    const cy = ty + 9;
    if (gate && ew) {
      road(true);
      if (Wd) for (let x = tx; x <= tx + 1; x += 2) log(x, cy, Hh);
      if (E) for (let x = tx + 14; x <= tx + 15; x += 2) log(x, cy, Hh);
      logNS(tx + 2, cy + 1, Hh + 5, 4);
      logNS(tx + 10, cy + 1, Hh + 5, 4);
      // lintel walkway
      p.hline(tx + 2, tx + 13, cy - Hh - 4, W[4]);
      p.hline(tx + 2, tx + 13, cy - Hh - 3, W[2]);
      p.hline(tx + 2, tx + 13, cy - Hh - 2, W[1]);
      // closed double doors
      for (let x = tx + 6; x <= tx + 9; x++) p.vline(x, cy - Hh + 2, cy, md(x, 2) ? W[2] : W[3]);
      p.hline(tx + 6, tx + 9, cy - 7, W[1]);
      p.hline(tx + 6, tx + 9, cy - 2, W[1]);
      p.line(tx + 6, cy - 2, tx + 9, cy - 7, W[4]);
      p.vline(tx + 3, cy - Hh - 10, cy - Hh - 5, W[2]);
      if (!damaged) flagCloth(c, tx + 4, cy - Hh - 10, 4, 3, c.tc, mask & 3);
    } else if (gate) {
      // wooden gatehouse straddling a N-S palisade, road crossing E-W
      road(false);
      if (N) for (let y = ty; y <= ty + 2; y += 3) logNS(tx + 6, y, Hh);
      const cc: Ctx = { ...c, dmg: damaged ? 1 : 0 };
      const gb = ty + 13;
      wall(cc, tx + 3, gb - 9, 10, 10, 'logs', { ends: true });
      door(cc, tx + 6, gb - 6, 4, 7, 'plank');
      pyramid(cc, tx + 7, gb - 9, 6, 7, 6, 'shingle', { finial: 'team' });
      if (Sd) logNS(tx + 6, ty + 15, Hh - 2);
    } else {
      if (N) for (let y = ty; y < cy - 1; y += 3) logNS(tx + 6, y, Hh);
      if (Wd) for (let x = tx; x < tx + 6; x += 2) log(x, cy, Hh + (md(x, 4) === 0 ? 1 : 0));
      if (E) for (let x = tx + 10; x <= tx + 15; x += 2) log(x, cy, Hh + (md(x, 4) === 0 ? 1 : 0));
      logNS(tx + 6, cy + 1, Hh + 1, 4);
      if (Sd) for (let y = cy + 3; y <= ty + 15; y += 3) logNS(tx + 6, y, Hh);
    }
  }
  c.dmg = damaged ? 1 : 0;
  if (damaged) scorch(c, 1, 0.45);
  c.dmg = 0;
  return finish(c);
}

/** destroyed building leftovers */
export function drawRubble(size: number, variant: number): BuildingSprite {
  const c = makeCtx(size, 10, null, 'ruined', variant, 3, 91);
  const { L, F, G } = c;
  const fw = size * TILE;
  yard(c, 'ash', L + 2, F + 3, fw - 4, fw - 5, 4);
  const p = c.pc;
  const n = size * size * 3 + 2;
  for (let k = 0; k < n; k++) {
    const x = L + 3 + hash2(k, 1, c.seed) * (fw - 6);
    const y = F + 5 + hash2(k, 2, c.seed) * (fw - 8);
    const r = 1.4 + hash2(k, 3, c.seed) * (1.5 + size * 0.4);
    const roll = hash2(k, 4, c.seed);
    if (roll < 0.62) blob(p, x, y, r, r * 0.7, S, k + variant);
    else if (roll < 0.82) {
      const len = 3 + r * 2;
      p.line(x, y, x + len, y - 1 - (k & 1) * 2, CHAR[3]);
      p.line(x, y + 1, x + len, y - (k & 1) * 2, CHAR[1]);
    } else {
      const R0 = variant & 1 ? RAMP.tile : ROOF.slate;
      p.px(x, y, R0[3]);
      p.px(x + 1, y, R0[4]);
      p.px(x + 1, y + 1, R0[2]);
    }
  }
  // standing wall stub
  if (size >= 2) {
    const rc: Ctx = { ...c, dmg: 2 };
    wall(rc, L + 3 + (variant & 1) * Math.round(fw * 0.4), G - 12, Math.round(fw * 0.4), 8, variant & 2 ? 'stone' : 'charred');
  }
  c.dmg = 0;
  return finish(c);
}

/** banner on a pole, 4 waving frames */
export function drawFlag(team: KingdomColor, frame: number): BuildingSprite {
  const pc = new PixelCanvas(10, 16);
  const t = teamOf(team)!;
  pc.vline(1, 2, 15, W[2]);
  pc.px(1, 1, GD[4]);
  pc.px(1, 15, W[1]);
  const fw = 7;
  const fh = 5;
  const ph = md(frame, 4);
  for (let lx = 0; lx < fw; lx++) {
    const ang = lx * 0.95 - ph * (Math.PI / 2);
    const dy = Math.round(Math.sin(ang) * 0.9 * (lx / fw + 0.15));
    const slope = Math.cos(ang);
    for (let ly = 0; ly < fh; ly++) {
      if (lx === fw - 1 && ly === 2) continue;
      if (lx === fw - 2 && ly === 2 && ph & 1) continue;
      let col = slope > 0.35 ? t.light : slope < -0.4 ? t.dark : t.main;
      if (ly === 0 && col === t.main) col = shade(t.main, 0.06);
      pc.px(2 + lx, 2 + ly + dy, col);
    }
  }
  // emblem
  const ey = 4 + Math.round(Math.sin(2 * 0.95 - ph * (Math.PI / 2)) * 0.4);
  pc.px(4, ey, CREAM);
  pc.px(5, ey, CREAM);
  pc.outline(OUTLINE, 0.6);
  return { pc, ax: 1, ay: 15 };
}

/** optional scaffolding overlay for a footprint (progress 0..1) */
export function drawScaffold(size: number, progress: number): BuildingSprite {
  const c = makeCtx(size, 24, null, 'built', 0, 3, 13);
  const fw = size * TILE;
  const h = Math.round(6 + clamp(progress, 0, 1) * (8 + size * 4));
  scaffold(c, c.L + 3, c.G - 3, fw - 6, h);
  if (size >= 2) {
    // side poles going back
    c.pc.vline(c.L + 3, c.G - 3 - h - Math.round(fw * 0.4), c.G - 3 - h, W[3]);
    c.pc.vline(c.R - 4, c.G - 3 - h - Math.round(fw * 0.4), c.G - 3 - h, W[2]);
  }
  return finish(c, { noShadow: true });
}

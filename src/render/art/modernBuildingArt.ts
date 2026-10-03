/**
 * Procedural pixel-art buildings for the MODERN era (fictional 1970s–80s military valley).
 *
 * Same projection, anchor and lighting conventions as `buildingArt.ts` (1 art px = 1 world px,
 * 16px tiles, light from the top-left, cool purple-black shadows, selective dark outline, soft
 * lower-right drop shadow, team colour only on flags / painted trims / vehicle markings). The
 * medieval context (`makeCtx` / `finish`) and many primitives (yards, windows, crates, fences,
 * roofs) are shared so both eras read as one coherent pixel style; this file adds the modern
 * material kit: poured concrete, cinder block, brick, render, corrugated sheet, prefab panels,
 * sandbags, lattice masts, vehicles and the like.
 *
 * States reuse the medieval semantics:
 *   construction1 → concrete pad, low block walls, bare columns with rebar, tube scaffolding
 *   construction2 → full shell with raw block, open roof decks (rebar mesh / steel purlins)
 *   damaged       → cracks, bullet pocks, broken glass, roof holes, soot
 *   ruined        → jagged walls with bent rebar, collapsed roofs, burnt-out vehicles
 */
import type { KingdomColor } from '../../data/factions';
import { hash2 } from '../../core/Random';
import { mix, shade } from './PixelCanvas';
import { RAMP } from './palette';
import { blob } from './propArt';
import {
  CHAR,
  CREAM,
  DARK,
  ENDG,
  GLASS,
  GLASS_HI,
  HAY,
  INTERIOR,
  LEAF,
  LIT,
  ROCK,
  TILE,
  bush,
  campfire,
  crate,
  drawBuilding,
  eaveShadow,
  finish,
  flagCloth,
  flowers,
  glow,
  logPile,
  makeCtx,
  md,
  oreCart,
  pyramid,
  roofEW,
  roofHoles,
  roofNS,
  ruinFloor,
  rv,
  sack,
  scorch,
  symbolAt,
  teamOf,
  tent,
  vnoise,
  vnoise2,
  yard,
  type BuildingOpts,
  type BuildingSprite,
  type BuildingState,
  type Ctx,
  type Team,
} from './buildingArt';

// ------------------------------------------------------------------------------------ palette
const CON = RAMP.concrete;
const COR = RAMP.corrugated;
const RU = RAMP.rust;
const BR = RAMP.brick;
const ASP = RAMP.asphalt;
const OL = RAMP.olive;
const CAMO = RAMP.camo;
const TARP = RAMP.tarp;
const BAG = RAMP.sandbag;
const WH = RAMP.white;
const HZ = RAMP.hazard;
const W = RAMP.wood;
const M = RAMP.metal;
const GD = RAMP.goldm;
const RED = ['#3e1414', '#5e1c1a', '#7e2620', '#a03228', '#bc4232', '#d45c44', '#e47a5c'];
const GREENP = ['#1a2e1e', '#243e28', '#2e5032', '#3a623c', '#4a7648', '#5e8a58'];
const BLUEP = ['#18243c', '#203252', '#2a4268', '#365480', '#466898', '#5e80ae'];
const RENDER = ['#7e735e', '#9a8e74', '#b4a88a', '#cabea0', '#dcd2b6', '#ebe4cc'];
const PINK = ['#6e4a44', '#8a5e56', '#a87a6c', '#c49684', '#d8b09a', '#e6c8b0'];
const YEL = ['#4e3a0e', '#7a5c14', '#a67e1c', '#cc9e26', '#e4bc3a', '#f4d868'];
const ORANGE = ['#4e200e', '#743016', '#9a421e', '#bc5826', '#d47234', '#e48e4a'];
const TEAL = ['#14282e', '#1c3a40', '#264e54', '#326468', '#427a7c', '#5a9290'];
/** warm sand-tinted concrete for civic / HQ facades */
const SANDC = ['#4e443a', '#62574a', '#7a6d5c', '#92846e', '#aa9b82', '#c0b298', '#d4c8ae', '#e4dac2'];
const TAN = ['#4a3e2a', '#655438', '#806c48', '#9a845a', '#b29c70', '#c8b488'];
const BURNT = ['#141012', '#1e1716', '#2a201c', '#3a2a22', '#4e3626', '#5e4430'];
const GRAVEL = ['#4e4a48', '#5e5956', '#6e6964', '#7e7872', '#8e8880'];
const TYRE = '#18141a';
const RCROSS = '#c8282a';
const WARN = '#ff5a3c';

type R = readonly string[];
const built = (c: Ctx) => c.con === 0;
const intact = (c: Ctx) => c.con === 0 && c.dmg < 2;

// ------------------------------------------------------------------------------------ ground
type PadKind = 'asphalt' | 'concrete' | 'gravel' | 'dirt' | 'mud' | 'ash' | 'grass';
/** modern ground patch on the base layer (same faded edge as `yard`) */
function pad(c: Ctx, kind: PadKind, x0: number, y0: number, w: number, h: number, rad = 3) {
  if (kind === 'gravel' || kind === 'dirt' || kind === 'mud' || kind === 'ash') {
    yard(c, kind, x0, y0, w, h, rad);
    return;
  }
  const b = c.base;
  // unfinished sites are bare dirt (lawns are laid last)
  if ((c.con === 1 && kind !== 'grass') || (c.con && kind === 'grass')) {
    yard(c, 'dirt', x0, y0, w, h, rad);
    return;
  }
  const k = kind;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const ex = Math.min(x - x0, x0 + w - 1 - x);
      const ey = Math.min(y - y0, y0 + h - 1 - y);
      let e = Math.min(ex, ey);
      if (ex < rad && ey < rad) e = rad - Math.hypot(rad - ex, rad - ey);
      e += (vnoise2(x, y, 3, c.seed + 2) - 0.5) * (k === 'grass' ? 2.2 : 1.2);
      if (e < 0) continue;
      const alpha = e < 1 ? 0.45 : e < 2 ? 0.8 : 0.96;
      const n = vnoise2(x, y, 5, c.seed + 11);
      let col: string;
      if (k === 'asphalt') {
        col = rv(ASP, 0.45 + (n - 0.5) * 0.35 + (hash2(x, y, c.seed + 4) < 0.06 ? 0.25 : 0), x, y, 0.5);
        if (c.dmg && hash2(x >> 1, y >> 1, c.seed + 6) < 0.04 * c.dmg) col = ASP[0];
      } else if (k === 'concrete') {
        const joint = md(x - x0, 8) === 0 || md(y - y0, 8) === 0;
        col = rv(CON, 0.5 + (n - 0.5) * 0.18 + (joint ? -0.12 : 0) + (hash2(x >> 3, y >> 3, c.seed) - 0.5) * 0.08, x, y, 0.4);
      } else col = rv(RAMP.meadow, 0.45 + (n - 0.5) * 0.5, x, y, 0.6);
      b.blend(x, y, col, alpha);
    }
}
/** painted road / parking line on the ground layer */
function paintLine(c: Ctx, x0: number, x1: number, y: number, col = '#d8d2bc', dash = 0) {
  if (!built(c)) return;
  for (let x = x0; x <= x1; x++) {
    if (dash && md(x - x0, dash * 2) >= dash) continue;
    if (c.dmg && hash2(x, y, c.seed + 3) < 0.25 * c.dmg) continue;
    if (c.base.get(x, y) >>> 24) c.base.blend(x, y, col, 0.8);
  }
}
function paintLineV(c: Ctx, x: number, y0: number, y1: number, col = '#d8d2bc') {
  if (!built(c)) return;
  for (let y = y0; y <= y1; y++) if (c.base.get(x, y) >>> 24 && !(c.dmg && hash2(x, y, c.seed + 3) < 0.25 * c.dmg)) c.base.blend(x, y, col, 0.8);
}
/** thin line on the ground layer (no outline): guy wires, cables, washing lines */
function baseLine(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string, a: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (!(c.pc.get(x, y) >>> 24)) c.base.blend(x, y, col, a);
  }
}

// ------------------------------------------------------------------------------------ walls
export type MWallMat = 'concrete' | 'bunker' | 'block' | 'brick' | 'render' | 'corr' | 'panel';
interface MWallOpts {
  ramp?: R;
  /** rows of dark concrete plinth at the bottom */
  plinth?: number;
  /** storey height: draws slab-edge bands every n rows */
  floors?: number;
  /** vertical panel seam spacing (concrete / panel) */
  seams?: number;
  /** 0..1 rust patches on corrugated sheet */
  rust?: number;
  gable?: number;
  ghw?: number;
}
function colsFor(w: number, spacing = 7): Set<number> {
  const n = Math.max(1, Math.round((w - 1) / spacing));
  const s = new Set<number>();
  for (let i = 0; i <= n; i++) s.add(Math.round((i * (w - 1)) / n));
  return s;
}
const masonryMat = (m: MWallMat) => m !== 'corr' && m !== 'panel';

function mtex(mat: MWallMat, lx: number, ly: number, w: number, h: number, px: number, py: number, seed: number, o: MWallOpts): string {
  const grad = (0.5 - lx / Math.max(1, w - 1)) * 0.12;
  if (ly < (o.plinth ?? 0)) return rv(CON, 0.36 + (ly === (o.plinth ?? 0) - 1 ? 0.2 : 0) + grad, px, py, 0.3);
  switch (mat) {
    case 'concrete':
    case 'bunker': {
      const R0 = o.ramp ?? CON;
      const seams = o.seams ?? 8;
      let v = 0.54 + grad + (vnoise2(px, py, 5, seed) - 0.5) * 0.1;
      // weather streaks run down from the top
      v -= vnoise(px, 2, seed + 9) * 0.08 * (ly / Math.max(1, h));
      if (mat === 'bunker' && ly % 3 === 0) v -= 0.06;
      if (seams && md(lx, seams) === seams - 1 && lx > 1 && lx < w - 2) v -= 0.16;
      if (o.floors && ly > 1) {
        const f = md(ly, o.floors);
        if (f === 0) v += 0.14;
        else if (f === o.floors - 1) v -= 0.1;
      }
      return rv(R0, v, px, py, 0.5);
    }
    case 'block': {
      const k = Math.floor(ly / 3);
      const r = ly % 3;
      const q = lx + (k & 1) * 3;
      if (r === 0 || md(q, 6) === 0) return rv(o.ramp ?? CON, 0.34 + grad);
      return rv(o.ramp ?? CON, 0.6 + grad + (hash2(Math.floor(q / 6), k, seed) - 0.5) * 0.12 + (r === 2 ? 0.06 : 0));
    }
    case 'brick': {
      const R0 = o.ramp ?? BR;
      const k = Math.floor(ly / 3);
      const r = ly % 3;
      const q = lx + (k & 1) * 2;
      if (r === 0) return mix(rv(R0, 0.42 + grad), '#8a8074', 0.35);
      if (md(q, 4) === 0) return rv(R0, 0.34 + grad);
      return rv(R0, 0.6 + grad + (hash2(q >> 2, k, seed) - 0.5) * 0.18 + (r === 2 ? 0.06 : 0));
    }
    case 'render': {
      const R0 = o.ramp ?? RENDER;
      return rv(R0, 0.62 + grad + (vnoise2(px, py, 4, seed) - 0.5) * 0.12, px, py, 0.45);
    }
    case 'corr': {
      const R0 = o.ramp ?? COR;
      let v = 0.56 + grad + (md(px, 2) === 0 ? 0.1 : -0.06);
      if (md(ly, 9) === 8) v -= 0.14;
      if (o.rust && vnoise2(px, py * 1.6, 4, seed + 13) > 1 - o.rust) return rv(RU, v);
      return rv(R0, v);
    }
    case 'panel': {
      const R0 = o.ramp ?? WH;
      const sp = o.seams ?? 6;
      const seam = md(lx, sp) === sp - 1 && lx < w - 2;
      return rv(R0, 0.6 + grad + (seam ? -0.2 : 0) + (ly === h - 1 ? 0.14 : 0) + (ly === 0 ? -0.16 : 0));
    }
  }
}

/** a modern wall face x..x+w-1, rows y..y+h-1 (bottom row = ground) */
function mwall(c: Ctx, x: number, y: number, w: number, h: number, mat: MWallMat, o: MWallOpts = {}) {
  const p = c.pc;
  const gb = y + h - 1;
  const mas = masonryMat(mat);
  const lim = c.con === 1 ? Math.max(2, Math.round(h * 0.35)) : 9999;
  const cols = colsFor(w, 7);
  const gh = c.con === 1 ? 0 : o.gable ?? 0;
  const ghw = o.ghw ?? w / 2;
  const cxw = x + (w - 1) / 2;
  for (let lx = 0; lx < w; lx++) {
    const px = x + lx;
    let colH = h;
    if (c.dmg === 2) {
      colH = Math.round(h * (0.36 + 0.5 * vnoise(lx, 4, c.seed + 3)));
      if (lx < 2 || lx > w - 3) colH = Math.max(colH, Math.round(h * 0.72));
    }
    const gTop = gh > 0 && c.dmg < 2 ? Math.max(0, Math.round(gh * (1 - Math.abs(px - cxw) / ghw))) : 0;
    const top = colH + gTop;
    for (let ly = 0; ly < top; ly++) {
      const py = gb - ly;
      if (ly >= lim) {
        // bare structural frame above the half-built walls
        if (cols.has(lx)) p.px(px, py, mas ? (lx === 0 ? CON[6] : CON[4]) : lx === 0 ? M[5] : M[3]);
        else if (ly === h - 1) p.px(px, py, mas ? CON[3] : M[3]);
        continue;
      }
      let col = mtex(mat, lx, ly, w, h, px, py, c.seed, o);
      if (c.con === 2) {
        if (mas && ly > h * 0.55 && mat !== 'block') col = mtex('block', lx, ly, w, h, px, py, c.seed, {});
        else if (!mas && ly > 0 && md(Math.floor(lx / 6) + c.seed, 3) === 1) col = md(lx, 6) === 0 ? M[3] : INTERIOR;
      }
      if (lx === 0) col = shade(col, 0.1);
      else if (lx === w - 1) col = shade(col, -0.18);
      if (c.dmg === 2 && ly === top - 1) col = shade(col, 0.2);
      p.px(px, py, col);
    }
    if (c.con === 1 && cols.has(lx) && mas && lim < h) {
      p.px(px, gb - h, RU[3]);
      p.px(px, gb - h - 1, RU[2]);
    }
    if (c.dmg === 2 && mas && colH < h && hash2(lx, x, c.seed + 5) < 0.22) {
      p.px(px, gb - colH, RU[3]);
      p.px(px + (hash2(lx, 2, c.seed) < 0.5 ? 1 : 0), gb - colH - 1, RU[2]);
    }
  }
  if (c.dmg >= 1 && w > 6) {
    // cracks
    const n = c.dmg === 2 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      let cx = x + 2 + Math.floor(hash2(k, x, c.seed + 41) * (w - 4));
      let cy = y + 1 + Math.floor(hash2(x, k, c.seed) * 2);
      const len = 3 + Math.floor(hash2(k, y, c.seed) * 5);
      for (let i = 0; i < len; i++) {
        if (p.get(cx, cy) >>> 24) p.px(cx, cy, '#1e1418');
        cy++;
        if (hash2(i, k, c.seed + x) < 0.5) cx += hash2(cx, cy, 1) < 0.5 ? -1 : 1;
      }
    }
    // bullet pocks
    const np = Math.round((w * h) / 70) + 1;
    for (let k = 0; k < np; k++) {
      const hx = x + 1 + Math.floor(hash2(k, 7, c.seed + x) * (w - 2));
      const hy = y + 1 + Math.floor(hash2(7, k, c.seed + y) * (h - 2));
      if (!(p.get(hx, hy) >>> 24) || !(p.get(hx - 1, hy - 1) >>> 24)) continue;
      p.px(hx, hy, '#241a1e');
      p.px(hx - 1, hy - 1, mas ? CON[6] : M[5]);
    }
  }
}

/** horizontal painted stripe (team trim, hazard band, signage band) across a wall */
function stripe(c: Ctx, x: number, y: number, w: number, col: string, rows = 1) {
  if (!built(c) || c.dmg === 2) return;
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < w; i++) {
      if (!(c.pc.get(x + i, y + r) >>> 24)) continue;
      let cc = r === 0 && rows > 1 ? shade(col, 0.12) : col;
      if (i === 0) cc = shade(cc, 0.1);
      else if (i === w - 1) cc = shade(cc, -0.2);
      if (c.dmg && hash2(i, r, c.seed + y) < 0.15) cc = shade(cc, -0.35);
      c.pc.px(x + i, y + r, cc);
    }
}
function hazard(c: Ctx, x: number, y: number, w: number, h: number) {
  if (!built(c)) return;
  for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) c.pc.px(x + lx, y + ly, md(lx + ly, 4) < 2 ? HZ[1] : HZ[0]);
}

// ------------------------------------------------------------------------------------ roofs
/** state-aware roof pixel (steel purlins while building, rubble when ruined) */
function mput(c: Ctx, px: number, py: number, col: string, cov: number, raf: 'v' | 'h', ox: number) {
  if (c.con === 2 && cov > 0.42) {
    const k = raf === 'v' ? px - ox : py;
    col = md(k, 6) === 0 ? M[4] : md(raf === 'v' ? py : px, 3) === 0 ? M[3] : INTERIOR;
  } else if (c.dmg === 2) {
    const thr = 0.22 + vnoise2(px, py, 3, c.seed + 4) * 0.3;
    if (cov > thr) col = ruinFloor(px, py, c.seed);
    else if (cov > thr - 0.08) col = CHAR[2];
  }
  c.pc.px(px, py, col);
}

/** concrete chunks + bent rebar + charred joists for ruined interiors */
function mdebris(c: Ctx, x: number, y: number, w: number, h: number) {
  const p = c.pc;
  const n = Math.max(1, Math.round((w * h) / 80));
  for (let k = 0; k < n; k++) {
    const bx = x + 2 + hash2(k, 5, c.seed + 51) * Math.max(1, w - 4);
    const by = y + 2 + hash2(k, 6, c.seed + 51) * Math.max(1, h - 3);
    blob(p, bx, by, 1.6 + hash2(k, 7, c.seed) * 1.6, 1.1 + hash2(k, 8, c.seed), CON.slice(1, 7), c.seed + k);
  }
  for (let k = 0; k < 2; k++) {
    const bx = x + 2 + hash2(k, 9, c.seed + 52) * Math.max(1, w - 6);
    const by = y + 1 + hash2(k, 10, c.seed + 52) * Math.max(1, h - 3);
    const len = 3 + hash2(k, 11, c.seed) * 5;
    p.line(bx, by, bx + len, by + (k ? -2 : 1), k ? RU[3] : CHAR[3]);
    if (!k) p.line(bx, by + 1, bx + len, by + 2, CHAR[1]);
  }
}

/** flat roof deck seen from above: back parapet row y, front lip row y+d-1 */
function slab(c: Ctx, x: number, y: number, w: number, d: number, o: { field?: 'tar' | 'gravel' | 'concrete' | 'grass' | 'metal'; parapet?: boolean; ramp?: R } = {}) {
  if (c.con === 1) return;
  const p = c.pc;
  const R0 = o.ramp ?? CON;
  const par = o.parapet !== false;
  const field = o.field ?? 'tar';
  for (let py = y; py < y + d; py++)
    for (let px = x; px < x + w; px++) {
      const lx = px - x;
      const ly = py - y;
      const n = vnoise2(px, py, 4, c.seed + 21);
      let col: string;
      switch (field) {
        case 'gravel':
          col = rv(GRAVEL, 0.45 + (n - 0.5) * 0.4 + (hash2(px, py, 3) < 0.14 ? 0.22 : 0));
          break;
        case 'concrete':
          col = rv(R0, 0.55 + (n - 0.5) * 0.12 + (md(lx, 8) === 0 || md(ly, 6) === 0 ? -0.1 : 0), px, py, 0.4);
          break;
        case 'grass':
          col = rv(RAMP.grass, 0.42 + (n - 0.5) * 0.5, px, py, 0.7);
          break;
        case 'metal':
          col = rv(COR, 0.58 + (md(px, 2) === 0 ? 0.1 : -0.05));
          break;
        default:
          col = rv(ASP, 0.62 + (n - 0.5) * 0.3, px, py, 0.6);
      }
      if (par) {
        if (ly === 0) col = rv(R0, lx === w - 1 ? 0.5 : 0.82);
        else if (ly === 1) col = rv(R0, 0.6 + (lx === 0 ? 0.12 : 0) + (lx === w - 1 ? -0.12 : 0));
        else if (ly === d - 1) col = rv(R0, lx === w - 1 ? 0.6 : lx === 0 ? 0.96 : 0.86);
        else if (lx === 0) col = rv(R0, 0.9);
        else if (lx === w - 1) col = rv(R0, 0.5);
        else if (ly === 2) col = shade(col, -0.3);
        else if (lx === 1) col = shade(col, -0.24);
      } else {
        if (ly === 0) col = shade(col, -0.12);
        if (ly === d - 1) col = shade(col, 0.16);
        if (lx === 0) col = shade(col, 0.08);
        else if (lx === w - 1) col = shade(col, -0.16);
      }
      if (c.con === 2 && ly < d * 0.6 && lx > 0 && lx < w - 1 && ly > 0) col = md(px, 3) === 0 || md(py, 3) === 0 ? RU[3] : INTERIOR;
      if (c.dmg === 2) {
        const e = Math.min(lx, w - 1 - lx, ly, d - 1 - ly) / Math.max(1, Math.min(w, d) / 2);
        const thr = 0.2 + vnoise2(px, py, 3, c.seed + 4) * 0.35;
        if (e > thr) col = ruinFloor(px, py, c.seed);
        else if (e > thr - 0.12) col = rv(R0, 0.86);
      }
      p.px(px, py, col);
    }
  if (c.dmg === 1) roofHoles(c, x + 2, y + 3, w - 4, Math.max(1, d - 5), w > 24 ? 2 : 1);
  if (c.dmg === 2) mdebris(c, x + 1, y + 1, w - 2, d - 2);
}

/** pitched corrugated-sheet roof with an E-W ridge (same geometry as `roofEW`) */
function troofEW(c: Ctx, x: number, y: number, w: number, h: number, R0: R = COR, o: { ridge?: number; rust?: number; holes?: number; noShadow?: boolean } = {}) {
  if (c.con === 1) return;
  const yr = y + Math.max(1, Math.round((h - 1) * (o.ridge ?? 0.34)));
  const yb = y + h - 1;
  for (let py = y; py <= yb; py++)
    for (let px = x; px < x + w; px++) {
      const front = py > yr;
      const back = py < yr;
      let col: string;
      let cov: number;
      if (!front && !back) {
        col = rv(R0, md(px, 4) === 0 ? 0.62 : 0.88);
        cov = 1;
      } else {
        let v: number;
        if (back) {
          v = 0.3 + ((py - y) / Math.max(1, yr - y)) * 0.06;
          cov = (py - y) / Math.max(1, yr - y);
        } else {
          const t = (py - yr) / Math.max(1, yb - yr);
          v = 0.66 - t * 0.1;
          cov = (yb - py) / Math.max(1, yb - yr);
          if (md(yb - py, 7) === 6) v -= 0.12;
        }
        v += (0.5 - (px - x) / w) * 0.1 + (md(px, 2) === 0 ? 0.07 : -0.05);
        col = rv(R0, v);
        if (o.rust) {
          const n = vnoise2(px, py * 1.5, 5, c.seed + 13);
          if (n > 1 - o.rust) col = rv(RU, v + (md(px, 2) === 0 ? 0.05 : 0));
          else if (n > 1 - o.rust - 0.07) col = mix(col, RU[3], 0.45);
        }
      }
      if (py === yr - 1) col = shade(col, -0.16);
      if (py === yb) col = shade(col, -0.22);
      if (py === y) col = shade(col, -0.1);
      if (px === x) col = shade(col, 0.08);
      else if (px === x + w - 1) col = shade(col, -0.15);
      mput(c, px, py, col, cov, 'v', x);
    }
  if (c.dmg === 1) roofHoles(c, x + 1, yr + 1, w - 2, yb - yr - 1, o.holes ?? (w > 20 ? 2 : 1));
  if (c.dmg === 2) mdebris(c, x, y, w, h);
  if (!o.noShadow) eaveShadow(c, x + 1, x + w - 2, yb + 1);
}

/** corrugated roof with its gable towards the viewer (same geometry as `roofNS`) */
function troofNS(c: Ctx, cx: number, yb: number, hw: number, gh: number, len: number, R0: R = COR, o: { rust?: number } = {}) {
  if (c.con === 1) return;
  const p = c.pc;
  for (let dx = -hw; dx <= hw; dx++) {
    const t = Math.abs(dx) / hw;
    const yF = Math.round(yb - gh * (1 - t));
    const yB = yF - len;
    const px = cx + dx;
    for (let py = yB; py <= yF; py++) {
      let col: string;
      if (dx === 0) col = rv(R0, md(py, 3) === 0 ? 0.6 : 0.82);
      else {
        const v = (dx < 0 ? 0.74 : 0.34) + ((py - yB) / len) * 0.05 + (md(py, 2) === 0 ? 0.07 : -0.05);
        col = rv(R0, v);
        if (o.rust) {
          const n = vnoise2(px * 1.5, py, 5, c.seed + 13);
          if (n > 1 - o.rust) col = rv(RU, v);
        }
      }
      if (py === yB) col = shade(col, -0.12);
      if (Math.abs(dx) === hw) col = shade(col, dx < 0 ? 0.06 : -0.2);
      mput(c, px, py, col, 1 - t, 'h', cx);
    }
    if (c.dmg < 2 || Math.abs(dx) > hw * 0.5) p.px(px, yF + 1, dx < 0 ? M[5] : dx > 0 ? M[3] : M[4]);
    if (p.get(px, yF + 2) >>> 24) p.blend(px, yF + 2, '#1a1020', 0.3);
  }
  if (c.dmg === 1) roofHoles(c, cx - hw + 1, yb - gh - len + 3, hw * 2 - 2, len - 3, 1);
  if (c.dmg === 2) mdebris(c, cx - hw + 1, yb - gh - len + 2, hw * 2 - 1, len);
  eaveShadow(c, cx - hw + 1, cx - hw + 2, yb + 1, 0.3, 0.12);
  eaveShadow(c, cx + hw - 2, cx + hw - 1, yb + 1, 0.3, 0.12);
}

/**
 * Quonset hut running N-S: the arched end wall faces the viewer, the ribbed half-cylinder hull
 * runs back `len` rows. cx = centre column, gb = ground row of the end wall, r = arch radius.
 */
function quonsetNS(c: Ctx, cx: number, gb: number, r: number, len: number, R0: R = OL, endR: R = TAN) {
  const p = c.pc;
  const rr = r + 0.5;
  for (let dx = -r; dx <= r; dx++) {
    const n = dx / rr;
    const ah = Math.round(Math.sqrt(Math.max(0, 1 - n * n)) * r);
    const px = cx + dx;
    // hull going back
    for (let k = 0; k <= len; k++) {
      const py = gb - ah - k;
      if (c.con === 1) {
        if (md(k, 5) === 0 || k === len) p.px(px, py, Math.abs(dx) === r ? M[2] : M[4]);
        continue;
      }
      let v = 0.62 - n * 0.42 - (n < -0.75 ? 0.12 : 0) + (md(k, 4) === 0 ? -0.14 : md(k, 2) === 0 ? 0.04 : 0);
      if (n > -0.55 && n < -0.25) v += 0.1;
      let col = rv(R0, v, px, py, 0.3);
      if (k === len) col = shade(col, -0.2);
      if (c.con === 2 && k > len * 0.4) col = md(k, 5) === 0 ? M[4] : INTERIOR;
      if (c.dmg === 2) {
        const thr = 0.35 + vnoise2(px, py, 3, c.seed + 4) * 0.45;
        if (1 - Math.abs(n) > thr && k > 1) col = md(k, 5) === 0 && hash2(dx, 1, c.seed) < 0.6 ? RU[2] : ruinFloor(px, py, c.seed);
      }
      p.px(px, py, col);
    }
    // arched end wall
    for (let ly = 0; ly < ah; ly++) {
      const py = gb - ly;
      if (c.con === 1 && ly > 2) {
        if (Math.abs(dx) === r || dx === 0) p.px(px, py, M[4]);
        continue;
      }
      let col = rv(endR, 0.6 - n * 0.12 + (md(dx + r, 5) === 0 ? -0.12 : 0), px, py, 0.3);
      if (ly === ah - 1) col = M[5];
      if (c.dmg === 2 && ly > ah * 0.55 + vnoise(dx, 3, c.seed) * 3) continue;
      p.px(px, py, col);
    }
  }
  if (c.dmg === 1) roofHoles(c, cx - r + 2, gb - r - len + 2, r * 2 - 3, len - 4, 1);
  if (c.dmg === 2) mdebris(c, cx - r + 1, gb - r - len + 2, r * 2 - 1, len - 2);
}

/** saw-tooth factory roof: teeth run N-S, slopes lit from the left, glazing on the steep faces */
function sawtooth(c: Ctx, x: number, yb: number, w: number, tw: number, gh: number, len: number) {
  if (c.con === 1) return;
  for (let lx = 0; lx < w; lx++) {
    const k = md(lx, tw);
    const glass = k === tw - 1;
    const rise = Math.round((gh * k) / (tw - 1));
    const yF = yb - rise;
    for (let py = yF - len; py <= yF; py++) {
      let col: string;
      if (glass) col = py === yF - len ? GLASS_HI : md(py, 3) === 0 ? M[2] : GLASS;
      else col = rv(COR, 0.5 + (k / tw) * 0.3 + (md(py, 2) === 0 ? 0.06 : -0.04));
      if (py === yF - len) col = shade(col, -0.12);
      if (py === yF) col = shade(col, -0.18);
      const cov = 1 - Math.abs(py - (yF - len / 2)) / (len / 2);
      mput(c, x + lx, py, col, cov, 'h', x);
    }
  }
  if (c.dmg === 1) roofHoles(c, x + 2, yb - gh - len + 2, w - 4, len - 2, 2);
  if (c.dmg === 2) mdebris(c, x, yb - gh - len, w, len);
  eaveShadow(c, x + 1, x + w - 2, yb + 1, 0.3, 0.12);
}

// ------------------------------------------------------------------------------------ openings
type MWin = 'glass' | 'lit' | 'blind' | 'slit' | 'barred' | 'frosted' | 'shop' | 'curtain';
function mwin(c: Ctx, x: number, y: number, w: number, h: number, kind: MWin = 'glass', frame: string | null = null) {
  if (c.con === 1) return;
  const p = c.pc;
  const open = c.con === 2 || c.dmg === 2;
  if (kind === 'slit') {
    p.hline(x, x + w - 1, y, '#120c14');
    for (let r = 1; r < h; r++) p.hline(x, x + w - 1, y + r, DARK);
    if (!open) p.hline(x, x + w - 1, y + h, frame ?? CON[6]);
    return;
  }
  const broken = !open && c.dmg === 1 && hash2(x, y, c.seed + 77) < 0.5;
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      let col: string;
      if (open || broken) col = ly === 0 ? '#120c14' : DARK;
      else
        switch (kind) {
          case 'lit':
            col = ly === 0 ? LIT[1] : LIT[2];
            break;
          case 'blind':
            col = ly < Math.ceil(h / 2) ? (md(ly, 2) === 0 ? '#d4ccb2' : '#aaa088') : lx === 0 && ly === Math.ceil(h / 2) ? GLASS_HI : GLASS;
            break;
          case 'curtain':
            col = lx === 0 || lx === w - 1 ? (lx === 0 ? '#c86a5a' : '#9a4a40') : lx === 1 && ly === 0 ? GLASS_HI : GLASS;
            break;
          case 'frosted':
            col = ly === 0 ? '#8eaab8' : lx === 0 ? '#d4e2e4' : '#b8ccd2';
            break;
          case 'barred':
            col = md(lx, 2) === 1 ? M[4] : GLASS;
            break;
          default:
            col = lx === ly || (lx === ly + 1 && lx < w - 1) ? (ly === 0 || lx === 0 ? GLASS_HI : '#3e4c6a') : GLASS;
        }
      if (!open && !broken && w >= 4 && kind !== 'shop' && kind !== 'barred' && lx === Math.floor(w / 2)) col = frame ?? WH[4];
      p.px(x + lx, y + ly, col);
    }
  if (broken) {
    p.px(x, y + h - 1, GLASS_HI);
    if (w > 2) p.px(x + w - 1, y, GLASS);
  }
  if (!open) p.hline(x, x + w - 1, y + h, frame ?? CON[6]);
  if (kind === 'lit' && !open) for (let i = -1; i <= w; i++) if (p.get(x + i, y + h + 1) >>> 24) p.blend(x + i, y + h + 1, LIT[2], 0.22);
}
/** evenly spaced windows between x0..x1 */
function winRow(c: Ctx, x0: number, x1: number, y: number, w: number, h: number, kind: MWin = 'glass', gap = 3, frame: string | null = null, skip?: (i: number, x: number) => boolean) {
  const n = Math.max(1, Math.floor((x1 - x0 + 1 + gap) / (w + gap)));
  const used = n * w + (n - 1) * gap;
  const sx = x0 + Math.floor((x1 - x0 + 1 - used) / 2);
  for (let i = 0; i < n; i++) {
    const wx = sx + i * (w + gap);
    if (skip && skip(i, wx)) continue;
    const k = kind === 'glass' && hash2(i, y, c.seed + 3) < 0.18 ? 'lit' : kind;
    mwin(c, wx, y, w, h, k, frame);
  }
}

type MDoor = 'steel' | 'glass' | 'roll' | 'open' | 'blast' | 'paint';
function mdoor(c: Ctx, x: number, y: number, w: number, h: number, kind: MDoor = 'steel', R0: R = GREENP) {
  if (c.con === 1) return;
  const p = c.pc;
  const gone = c.con === 2 || c.dmg === 2;
  if (kind === 'blast' && !gone) {
    hazard(c, x - 1, y - 1, w + 2, 1);
    for (let ly = 0; ly < h; ly++) {
      p.px(x - 1, y + ly, md(ly, 4) < 2 ? HZ[1] : HZ[0]);
      p.px(x + w, y + ly, md(ly + 2, 4) < 2 ? HZ[1] : HZ[0]);
    }
  }
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      let col: string;
      if (gone) col = ly === 0 ? '#120c14' : DARK;
      else
        switch (kind) {
          case 'glass':
            col = lx === 0 || lx === w - 1 || lx === Math.floor(w / 2) || ly === 0 ? M[4] : lx + ly === 3 || lx + ly === 4 ? GLASS_HI : GLASS;
            if (ly === h - 1) col = M[3];
            break;
          case 'roll':
            col = ly === 0 ? M[2] : md(ly, 2) === 0 ? COR[5] : COR[3];
            if (lx === 0) col = shade(col, 0.1);
            else if (lx === w - 1) col = shade(col, -0.2);
            if (ly === h - 1) col = COR[2];
            break;
          case 'open':
            col = ly < 2 ? (md(ly, 2) === 0 ? COR[4] : COR[2]) : ly === 2 ? '#120c14' : DARK;
            break;
          case 'paint':
            col = lx === 0 ? R0[4] : lx === w - 1 ? R0[1] : ly === 0 ? R0[1] : R0[3];
            if (w >= 3 && h >= 6 && (ly === 1 || ly === Math.floor(h / 2) + 1) && lx > 0 && lx < w - 1) col = R0[2];
            break;
          default:
            // steel / blast
            col = lx === 0 ? M[4] : lx === w - 1 ? M[2] : ly === 0 ? M[2] : kind === 'blast' ? (md(ly, 3) === 1 ? M[2] : M[3]) : M[3];
        }
      p.px(x + lx, y + ly, col);
    }
  if (gone) return;
  if (kind === 'steel' || kind === 'paint') p.px(x + w - 2, y + Math.floor(h / 2) + 1, kind === 'paint' ? GD[4] : M[6]);
  if (kind === 'blast') {
    p.px(x + 1, y + 1, M[5]);
    p.px(x + w - 2, y + 1, M[5]);
    p.px(x + w - 2, y + Math.floor(h / 2), M[6]);
  }
}

// ------------------------------------------------------------------------------------ team cloth
/** metal flagpole with a waving flag; gb = ground row (pole foot) */
function mflag(c: Ctx, x: number, gb: number, h: number, t: Team | null, o: { w?: number; fh?: number; phase?: number; sym?: boolean } = {}) {
  if (!t || c.con !== 0) return;
  const p = c.pc;
  if (c.dmg === 2) {
    p.vline(x, gb - Math.round(h * 0.35), gb, M[3]);
    return;
  }
  const top = gb - h;
  p.vline(x, top, gb, M[4]);
  p.px(x, top - 1, M[6]);
  p.px(x, gb, M[2]);
  const fw = o.w ?? 5;
  const fh = o.fh ?? 4;
  flagCloth(c, x + 1, top, fw, fh, t, o.phase ?? (c.seed & 3));
  if (c.dmg === 1) p.px(x + fw, top + fh - 1, '#00000000');
  if (o.sym && fw >= 5 && fh >= 4) symbolAt(c, x + 1 + Math.floor(fw / 2), top + Math.floor(fh / 2), t.symbol, CREAM);
}
/** vertical hanging banner (no rod) on a facade */
function vbanner(c: Ctx, x: number, y: number, w: number, h: number, t: Team) {
  if (!intact(c)) return;
  const p = c.pc;
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (c.dmg && ly > h - 3 && hash2(lx, ly, c.seed + x) < 0.35) continue;
      p.px(x + lx, y + ly, lx === 0 ? t.light : lx === w - 1 ? t.dark : ly === 0 ? t.dark : t.main);
    }
  if (w >= 3 && h >= 5) symbolAt(c, x + Math.floor(w / 2), y + Math.floor(h / 2), t.symbol, CREAM);
}
/** round wall plaque with the team symbol */
function plaque(c: Ctx, cx: number, cy: number, t: Team) {
  if (!intact(c)) return;
  const p = c.pc;
  p.rect(cx - 2, cy - 1, 5, 3, t.main);
  p.rect(cx - 1, cy - 2, 3, 5, t.main);
  p.px(cx - 1, cy - 1, t.light);
  p.px(cx + 1, cy + 1, t.dark);
  p.px(cx, cy, CREAM);
  p.px(cx - 2, cy - 1, GD[4]);
}

// ------------------------------------------------------------------------------------ props
function sandbags(c: Ctx, x0: number, x1: number, gb: number, rows = 2) {
  if (!built(c)) return;
  const p = c.pc;
  for (let r = 0; r < rows; r++) {
    const yb = gb - r * 2;
    const off = (r & 1) * 2;
    for (let px = x0; px <= x1; px++) {
      if (r & 1 && (px === x0 || px === x1)) continue;
      if (c.dmg === 2 && r > 0 && hash2((px - x0 + off) >> 2, r, c.seed + gb) < 0.35) continue;
      const lx = md(px - x0 + off, 5);
      const top = r === rows - 1;
      let lo = BAG[3];
      let hi = top ? BAG[5] : BAG[4];
      if (lx === 4) {
        lo = BAG[1];
        hi = BAG[2];
      } else if (lx === 0) {
        lo = BAG[4];
        hi = top ? BAG[5] : BAG[5];
      } else if (lx === 3) lo = BAG[2];
      if (px === x1) {
        lo = shade(lo, -0.2);
        hi = shade(hi, -0.2);
      }
      p.px(px, yb, lo);
      p.px(px, yb - 1, hi);
    }
  }
}
/** sandbag run going N-S (seen from above), front end at y1 */
function sandbagsV(c: Ctx, x: number, y0: number, y1: number, h = 4) {
  if (!built(c)) return;
  const p = c.pc;
  for (let y = y0; y <= y1; y++) {
    const k = md(y - y0, 3);
    if (c.dmg === 2 && hash2(x, Math.floor(y / 3), c.seed) < 0.3) continue;
    p.px(x, y - h, k === 2 ? BAG[2] : BAG[5]);
    p.px(x + 1, y - h, k === 2 ? BAG[2] : BAG[4]);
    p.px(x + 2, y - h, k === 2 ? BAG[1] : BAG[3]);
  }
  sandbags(c, x, x + 2, y1, Math.max(1, Math.floor(h / 2)));
}
/** U-shaped sandbag nest with a mounted machine gun */
function mgNest(c: Ctx, cx: number, gb: number, hw = 6, depth = 6, dir: 1 | -1 = 1) {
  if (!built(c)) return;
  const p = c.pc;
  const x0 = cx - hw;
  const x1 = cx + hw;
  sandbags(c, x0 + 1, x1 - 1, gb - depth, 2);
  for (let y = gb - depth + 1; y <= gb - 3; y++)
    for (let x = x0 + 3; x <= x1 - 3; x++) p.px(x, y - 1, md(x + y, 5) === 0 ? '#3a3026' : '#2c2420');
  sandbagsV(c, x0, gb - depth + 1, gb - 1, 3);
  sandbagsV(c, x1 - 2, gb - depth + 1, gb - 1, 3);
  if (c.dmg < 2) {
    // MG on a pintle: barrel over the front bags
    const by = gb - 5;
    p.vline(cx, by, by + 2, M[2]);
    p.hline(cx - 2 * dir, cx + 5 * dir, by, M[1]);
    p.hline(cx - 1 * dir, cx + 1 * dir, by - 1, M[2]);
    p.px(cx + 6 * dir, by, M[3]);
    p.px(cx - 2 * dir, by + 1, OL[3]);
  }
  sandbags(c, x0, x1, gb, 2);
}
function drum(c: Ctx, x: number, gb: number, R0: R = RED) {
  if (!built(c)) return;
  const p = c.pc;
  const r = c.dmg === 2 ? BURNT : R0;
  p.vline(x, gb - 4, gb, r[4]);
  p.vline(x + 1, gb - 4, gb, r[3]);
  p.vline(x + 2, gb - 4, gb, r[1]);
  p.hline(x, x + 2, gb - 1, r[2]);
  p.hline(x, x + 2, gb - 3, r[2]);
  p.hline(x, x + 2, gb - 5, r[5] ?? r[4]);
  p.px(x + 2, gb - 5, r[3]);
}
function drums(c: Ctx, x: number, gb: number, n: number, R0: R = RED) {
  for (let i = 0; i < n; i++) drum(c, x + i * 3 + (i >= 3 ? -7 : 0), gb - (i >= 3 ? 3 : 0), i === 1 && n > 2 ? BLUEP : R0);
}
function ammoBox(c: Ctx, x: number, gb: number, w = 6) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 2, w, 3, OL[3]);
  p.vline(x, gb - 2, gb, OL[4]);
  p.vline(x + w - 1, gb - 2, gb, OL[1]);
  p.rect(x, gb - 4, w, 2, OL[5]);
  p.px(x + w - 1, gb - 4, OL[3]);
  p.hline(x + 1, x + Math.min(w - 2, 3), gb - 1, YEL[4]);
  p.px(x + 1, gb - 4, OL[6]);
}
function ammoStack(c: Ctx, x: number, gb: number) {
  ammoBox(c, x, gb, 7);
  ammoBox(c, x + 7, gb, 6);
  ammoBox(c, x + 2, gb - 5, 7);
}
function jerrycan(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 3, 2, 4, OL[3]);
  p.vline(x, gb - 3, gb, OL[5]);
  p.px(x + 1, gb - 4, M[3]);
}
/** shipping container side view: front face h rows, roof `d` rows */
function container(c: Ctx, x: number, gb: number, w: number, R0: R = ORANGE, h = 8) {
  if (!built(c)) return;
  const p = c.pc;
  const r = c.dmg === 2 ? BURNT : R0;
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) {
      let col = ly === 0 || ly === h - 1 ? r[1] : md(lx, 2) === 0 ? r[4] : r[2];
      if (lx === 0) col = r[4];
      if (lx === w - 1) col = r[0];
      if (lx >= w - 5 && lx < w - 1 && (lx === w - 4 || lx === w - 2) && ly > 0 && ly < h - 1) col = M[4];
      p.px(x + lx, gb - ly, col);
    }
  p.hline(x, x + w - 1, gb - h, shade(r[4], 0.15));
  p.hline(x, x + w - 1, gb - h - 1, r[4]);
  p.px(x + w - 1, gb - h, r[2]);
  p.px(x + w - 1, gb - h - 1, r[2]);
  if (c.dmg < 2) p.hline(x + 2, x + 5, gb - h + 2, CREAM);
}
/** chain-link fence along a row: posts on the object layer, mesh blended on the ground */
function chainFence(c: Ctx, x0: number, x1: number, gb: number, h = 7, gateFrom = -1, gateTo = -1) {
  if (!built(c)) return;
  const p = c.pc;
  for (let x = x0; x <= x1; x++) {
    if (x > gateFrom && x < gateTo) continue;
    if (c.dmg === 2 && hash2(x >> 2, gb, c.seed) < 0.3) continue;
    for (let y = gb - h + 1; y <= gb; y++) if ((x + y) % 3 === 0 || (x - y + 300) % 3 === 0) c.base.blend(x, y, '#c4ccd0', 0.4);
    c.base.blend(x, gb - h, '#d0d6d8', 0.75);
    if (md(x - x0, 6) === 0 || x === x1) {
      if (x === x0 || x === x1) {
        p.vline(x, gb - h, gb, M[4]);
        p.px(x, gb - h - 1, M[5]);
      } else {
        c.base.vline(x, gb - h, gb, M[3]);
        c.base.px(x, gb - h - 1, M[5]);
      }
    }
  }
}
function chainFenceV(c: Ctx, x: number, y0: number, y1: number, h = 7) {
  if (!built(c)) return;
  for (let y = y0; y <= y1; y++) {
    if (c.dmg === 2 && hash2(x, y >> 2, c.seed) < 0.3) continue;
    for (let k = 0; k < h; k++) if ((y + k) % 3 === 0) c.base.blend(x, y - k, '#c4ccd0', 0.35);
    c.base.blend(x, y - h, '#d0d6d8', 0.7);
    if (md(y - y0, 6) === 0) {
      c.base.vline(x, y - h, y - h + 2, M[4]);
      c.base.px(x, y - h - 1, M[5]);
      c.base.px(x, y, M[2]);
    }
  }
}
function streetLamp(c: Ctx, x: number, gb: number, h = 13, dir: 1 | -1 = 1) {
  if (!built(c)) return;
  const p = c.pc;
  if (c.dmg === 2) {
    p.vline(x, gb - 5, gb, M[2]);
    return;
  }
  p.vline(x, gb - h, gb, M[3]);
  p.hline(x, x + 3 * dir, gb - h, M[3]);
  p.px(x + 3 * dir, gb - h + 1, c.dmg ? '#3a3440' : LIT[2]);
  p.px(x + 2 * dir, gb - h + 1, M[2]);
  if (!c.dmg) glow(c, x + 3 * dir, gb, 4, 2, 0.25);
}
/** TV aerial on a roof: pole foot at yb */
function aerial(c: Ctx, x: number, yb: number, h = 6) {
  if (!intact(c)) return;
  const p = c.pc;
  p.vline(x, yb - h, yb, M[4]);
  p.hline(x - 2, x + 2, yb - h, M[5]);
  p.hline(x - 1, x + 2, yb - h + 2, M[4]);
  p.px(x + 2, yb - h + 4, M[4]);
}
function acUnit(c: Ctx, x: number, y: number) {
  if (!intact(c)) return;
  const p = c.pc;
  p.rect(x, y, 5, 2, M[5]);
  p.px(x + 4, y, M[4]);
  p.px(x + 2, y, M[2]);
  p.px(x + 1, y + 1, M[3]);
  p.rect(x, y + 2, 5, 2, M[3]);
  p.hline(x + 1, x + 3, y + 3, M[1]);
  p.px(x, y + 2, M[4]);
}
function vent(c: Ctx, x: number, y: number) {
  if (!intact(c)) return;
  c.pc.rect(x, y, 2, 1, M[5]);
  c.pc.rect(x, y + 1, 2, 1, M[2]);
}
/** satellite / microwave dish facing up-left; cx,cy = dish centre */
function dish(c: Ctx, cx: number, cy: number, r = 3) {
  if (!intact(c)) return;
  const p = c.pc;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy * 1.1);
      if (d > r + 0.3) continue;
      const rim = d > r - 0.9;
      p.px(cx + dx, cy + dy, rim ? (dx + dy < 0 ? WH[5] : WH[2]) : rv(WH, 0.55 - (dx + dy) * 0.08));
    }
  p.line(cx, cy, cx - Math.round(r * 0.8), cy - Math.round(r * 0.8), M[2]);
  p.px(cx - Math.round(r * 0.8), cy - Math.round(r * 0.8), M[1]);
}
/** red/white (or steel) lattice mast; gb = foot row */
function mast(c: Ctx, x: number, gb: number, h: number, o: { bw?: number; bands?: boolean; dish?: boolean; guys?: boolean; whip?: boolean } = {}) {
  const p = c.pc;
  let hh = h;
  if (c.con === 1) hh = Math.round(h * 0.3);
  else if (c.con === 2) hh = Math.round(h * 0.65);
  if (c.dmg === 2) hh = Math.round(h * 0.42);
  const bw = o.bw ?? 2;
  for (let py = gb - hh; py <= gb; py++) {
    const t = (gb - py) / h;
    const hw = Math.max(1, Math.round(bw * (1 - t * 0.7)));
    const band = o.bands && md(Math.floor((gb - py) / 5), 2) === 1;
    const cl = band ? RED[5] : M[5];
    const cr = band ? RED[2] : M[3];
    p.px(x - hw, py, cl);
    p.px(x + hw, py, cr);
    const k = md(gb - py, 5);
    const seg = Math.floor((gb - py) / 5) & 1;
    const f = seg ? k / 5 : 1 - k / 5;
    p.px(x - hw + Math.round(hw * 2 * f), py, band ? RED[3] : M[4]);
    if (k === 0) p.hline(x - hw, x + hw, py, band ? RED[4] : M[4]);
  }
  if (c.dmg === 2) {
    // buckled top section hanging down
    p.line(x, gb - hh, x + 5, gb - hh + 4, M[3]);
    p.line(x + 1, gb - hh, x + 6, gb - hh + 4, M[2]);
    return;
  }
  if (c.con !== 0) return;
  p.vline(x, gb - hh - 5, gb - hh - 1, M[4]);
  p.px(x, gb - hh - 6, WARN);
  if (o.whip) {
    p.vline(x - 2, gb - hh - 3, gb - hh, M[3]);
    p.vline(x + 2, gb - hh - 2, gb - hh, M[3]);
  }
  if (o.dish) dish(c, x - bw - 2, gb - Math.round(hh * 0.62), 3);
  if (o.guys) {
    const a = gb - Math.round(hh * 0.72);
    const b = gb - Math.round(hh * 0.4);
    const sp = Math.round(h * 0.42);
    baseLine(c, x, a, x - sp, gb - 2, '#cfd4d8', 0.5);
    baseLine(c, x, a, x + sp, gb + 1, '#cfd4d8', 0.5);
    baseLine(c, x, b, x - Math.round(sp * 0.6), gb + 1, '#cfd4d8', 0.4);
    baseLine(c, x, b, x + Math.round(sp * 0.7), gb - 3, '#cfd4d8', 0.4);
  }
}
/** white radar dome on a short concrete drum; gb = drum foot */
function radome(c: Ctx, cx: number, gb: number, r: number) {
  const p = c.pc;
  const dh = c.con === 1 ? 2 : 4;
  for (let ly = 0; ly < dh; ly++)
    for (let dx = -r + 1; dx <= r - 1; dx++) p.px(cx + dx, gb - ly, rv(CON, 0.55 - (dx / r) * 0.3 + (ly === dh - 1 ? 0.15 : 0)));
  if (c.con === 1) return;
  const cy = gb - dh - r + 2;
  if (c.con === 2 || c.dmg === 2) {
    // bare geodesic frame / shattered shell
    for (let a = 0; a < 24; a++) {
      const ang = Math.PI + (a / 23) * Math.PI;
      p.px(cx + Math.round(Math.cos(ang) * r), cy + Math.round(Math.sin(ang) * r), M[4]);
    }
    p.line(cx - r + 1, gb - dh, cx, cy - r + 1, M[3]);
    p.line(cx + r - 1, gb - dh, cx, cy - r + 1, M[2]);
    if (c.dmg === 2) blob(p, cx + 1, gb - dh - 1, r * 0.7, 2, WH, c.seed);
    return;
  }
  blob(p, cx, cy, r + 0.4, r + 0.4, WH, c.seed + 5, 0.12);
  for (let dx = -r; dx <= r; dx++) if (p.get(cx + dx, gb - dh) >>> 24) p.px(cx + dx, gb - dh, WH[1]);
  p.px(cx, cy - r - 1, WARN);
}

function searchlight(c: Ctx, x: number, y: number, dir: 1 | -1 = 1) {
  if (!intact(c)) return;
  const p = c.pc;
  p.rect(x, y, 3, 2, M[3]);
  p.px(x, y, M[5]);
  p.vline(x + (dir > 0 ? 3 : -1), y, y + 1, c.dmg ? '#3a3440' : '#fff0c0');
  p.px(x + 1, y + 2, M[2]);
}
/** red cross on a white field; s = arm half length */
function redCross(c: Ctx, cx: number, cy: number, s = 2, bg = true) {
  if (!intact(c)) return;
  const p = c.pc;
  if (bg) p.rect(cx - s - 1, cy - s - 1, s * 2 + 3, s * 2 + 3, WH[5]);
  p.rect(cx - s, cy - Math.max(0, Math.floor(s / 2)), s * 2 + 1, s > 2 ? 2 : 1, RCROSS);
  p.rect(cx - Math.max(0, Math.floor(s / 2)), cy - s, s > 2 ? 2 : 1, s * 2 + 1, RCROSS);
}
/** painted signboard on two posts or flat on a wall */
function sign(c: Ctx, x: number, y: number, w: number, bg: R, posts = 0, text = CREAM) {
  if (!intact(c)) return;
  const p = c.pc;
  if (posts) {
    p.vline(x + 1, y + 3, y + 3 + posts, M[3]);
    p.vline(x + w - 2, y + 3, y + 3 + posts, M[2]);
  }
  p.rect(x, y, w, 3, bg[3]);
  p.hline(x, x + w - 1, y, bg[4]);
  p.vline(x + w - 1, y, y + 2, bg[1]);
  for (let i = x + 1; i < x + w - 1; i++) if (hash2(i, y, c.seed + 8) < 0.6) p.px(i, y + 1, text);
}
function helipad(c: Ctx, cx: number, cy: number, r: number) {
  if (!built(c)) return;
  const b = c.base;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 0.4) continue;
      let col = rv(ASP, 0.4 + (vnoise2(x, y, 4, c.seed) - 0.5) * 0.25, x, y, 0.4);
      if (d > r - 1.3 && d <= r - 0.3) col = YEL[4];
      b.blend(x, y, col, d > r - 0.3 ? 0.6 : 0.95);
    }
  const hh = Math.max(2, Math.round(r * 0.45));
  for (let y = cy - hh; y <= cy + hh; y++) {
    b.px(cx - hh + 1, y, '#e8e4d8');
    b.px(cx + hh - 1, y, '#e8e4d8');
  }
  b.hline(cx - hh + 1, cx + hh - 1, cy, '#e8e4d8');
}
function camoNet(c: Ctx, x: number, y: number, w: number, h: number) {
  if (!intact(c)) return;
  const p = c.pc;
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) {
      const ex = Math.min(px - x, x + w - 1 - px);
      const ey = Math.min(py - y, y + h - 1 - py);
      if (Math.min(ex, ey) + (vnoise2(px, py, 2, c.seed + 31) - 0.5) * 2.4 < 0) continue;
      const n = vnoise2(px, py, 3, c.seed + 33);
      let col = rv(CAMO, 0.15 + n * 0.85, px, py, 0.9);
      if (hash2(px, py, c.seed) < 0.06) col = '#2a2418';
      if (py === y + h - 1 || px === x + w - 1) col = shade(col, -0.2);
      p.px(px, py, col);
    }
}
function phoneBox(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  const r = c.dmg === 2 ? BURNT : RED;
  p.rect(x, gb - 8, 4, 9, r[3]);
  p.vline(x, gb - 8, gb, r[5]);
  p.vline(x + 3, gb - 8, gb, r[1]);
  p.hline(x, x + 3, gb - 9, r[4]);
  if (c.dmg < 2) {
    p.rect(x + 1, gb - 6, 2, 4, GLASS);
    p.px(x + 1, gb - 6, GLASS_HI);
    p.hline(x + 1, x + 2, gb - 8, CREAM);
  }
}
function bench(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  c.pc.hline(x, x + 5, gb - 2, W[5]);
  c.pc.hline(x, x + 5, gb - 4, W[4]);
  c.pc.px(x, gb - 1, M[2]);
  c.pc.px(x + 5, gb - 1, M[2]);
  c.pc.px(x, gb - 3, M[3]);
}
function bin(c: Ctx, x: number, gb: number, R0: R = GREENP) {
  if (!built(c)) return;
  c.pc.rect(x, gb - 3, 3, 4, R0[3]);
  c.pc.vline(x, gb - 3, gb, R0[4]);
  c.pc.hline(x, x + 2, gb - 4, R0[5]);
}
function generator(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  const r = c.dmg === 2 ? BURNT : OL;
  p.rect(x, gb - 4, 8, 5, r[3]);
  p.vline(x, gb - 4, gb, r[4]);
  p.vline(x + 7, gb - 4, gb, r[1]);
  p.rect(x, gb - 6, 8, 2, r[5]);
  p.rect(x + 2, gb - 3, 3, 2, r[1]);
  p.vline(x + 6, gb - 9, gb - 6, M[1]);
  p.px(x + 6, gb - 9, M[3]);
  if (c.dmg < 2) p.px(x + 3, gb - 4, '#7ad04a');
}
function roundBale(c: Ctx, cx: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(cx - 2, gb - 6, 6, 2, HAY[5]);
  p.ellipse(cx + 0.5, gb - 2.5, 3, 3, HAY[3]);
  p.px(cx, gb - 3, HAY[1]);
  p.px(cx + 1, gb - 2, HAY[2]);
  p.px(cx - 1, gb - 4, HAY[5]);
  p.vline(cx + 3, gb - 5, gb - 1, HAY[1]);
}
function stretcher(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.rect(x, gb - 3, 7, 2, OL[4]);
  p.hline(x, x + 6, gb - 3, OL[5]);
  p.hline(x - 1, x + 7, gb - 2, M[3]);
  p.px(x, gb - 1, M[2]);
  p.px(x + 6, gb - 1, M[2]);
  p.px(x + 1, gb - 4, WH[5]);
}
function silTarget(c: Ctx, cx: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  p.vline(cx - 2, gb - 3, gb, W[3]);
  p.vline(cx + 2, gb - 3, gb, W[2]);
  p.rect(cx - 3, gb - 11, 7, 8, TAN[5]);
  p.vline(cx + 3, gb - 11, gb - 4, TAN[3]);
  p.hline(cx - 3, cx + 3, gb - 11, CREAM);
  // olive silhouette
  p.rect(cx - 1, gb - 10, 2, 2, OL[2]);
  p.rect(cx - 2, gb - 8, 4, 4, OL[2]);
  p.px(cx, gb - 7, c.dmg ? '#120c14' : RED[4]);
  if (c.dmg) p.px(cx - 1, gb - 9, '#120c14');
}
function gunRack(c: Ctx, x: number, gb: number, w: number, n = 3) {
  if (!built(c)) return;
  const p = c.pc;
  p.vline(x + 1, gb - 4, gb, M[3]);
  p.vline(x + w - 2, gb - 4, gb, M[2]);
  p.hline(x, x + 2, gb, M[2]);
  p.hline(x + w - 3, x + w - 1, gb, M[2]);
  for (let i = 0; i < n; i++) {
    const y = gb - 5 - i * 2;
    p.hline(x - 1 + i, x + w - 1, y, OL[2]);
    p.hline(x - 1 + i, x + w - 1, y - 1, i === n - 1 ? OL[5] : OL[4]);
    p.px(x - 2 + i, y, M[1]);
    p.px(x - 2 + i, y - 1, M[2]);
  }
}
function saw(c: Ctx, x: number, gb: number) {
  if (!built(c)) return;
  const p = c.pc;
  // bench
  p.rect(x, gb - 4, 12, 2, M[3]);
  p.hline(x, x + 11, gb - 4, M[5]);
  p.vline(x + 1, gb - 2, gb, M[2]);
  p.vline(x + 10, gb - 2, gb, M[2]);
  // disc
  for (let a = 0; a < 20; a++) {
    const ang = (a / 20) * Math.PI * 2;
    p.px(x + 6 + Math.round(Math.cos(ang) * 3), gb - 6 + Math.round(Math.sin(ang) * 3), a & 1 ? M[6] : M[4]);
  }
  p.ellipse(x + 6.5, gb - 5.5, 2.2, 2.2, M[5]);
  p.px(x + 6, gb - 6, M[2]);
  // log on the bench
  p.rect(x - 3, gb - 6, 8, 2, W[3]);
  p.hline(x - 3, x + 4, gb - 6, W[5]);
  p.px(x - 3, gb - 6, ENDG[2]);
  p.px(x - 3, gb - 5, ENDG[1]);
}
function towerCrane(c: Ctx, x: number, gb: number, h: number, jibL: number, jibR: number) {
  const p = c.pc;
  if (c.dmg === 2) return;
  for (let py = gb - h; py <= gb; py++) {
    p.px(x - 1, py, YEL[4]);
    p.px(x + 1, py, YEL[2]);
    const k = md(gb - py, 3);
    p.px(x - 1 + k, py, YEL[3]);
  }
  const jy = gb - h;
  p.hline(x - jibL, x + jibR, jy, YEL[4]);
  p.hline(x - jibL, x + jibR, jy + 1, YEL[2]);
  for (let i = x - jibL; i <= x + jibR; i += 3) p.px(i, jy - 1, YEL[3]);
  p.line(x, jy - 4, x - jibL + 2, jy - 1, M[3]);
  p.line(x, jy - 4, x + jibR - 2, jy - 1, M[3]);
  p.vline(x, jy - 4, jy, YEL[3]);
  p.rect(x + jibR - 3, jy + 2, 3, 3, CON[3]);
  p.rect(x - 4, jy + 2, 3, 2, YEL[1]);
  const hx = x - jibL + 3;
  p.vline(hx, jy + 2, jy + 10, M[2]);
  p.px(hx, jy + 11, M[4]);
  p.rect(hx - 2, jy + 12, 5, 2, CON[5]);
}

// ------------------------------------------------------------------------------------ vehicles
type VehKind = 'jeep' | 'truck' | 'pickup' | 'car' | 'tractor' | 'logtruck' | 'ambulance' | 'howitzer' | 'forklift';
/** side-on vehicle, front to the right (dir 1) or left (-1); x = left edge, gb = ground row */
function vehicle(c: Ctx, x: number, gb: number, kind: VehKind, o: { dir?: 1 | -1; ramp?: R; mark?: boolean } = {}) {
  if (!built(c)) return;
  const p = c.pc;
  const wreck = c.dmg === 2;
  const dir = o.dir ?? 1;
  const LEN: Record<VehKind, number> = { jeep: 14, truck: 22, pickup: 16, car: 13, tractor: 12, logtruck: 24, ambulance: 15, howitzer: 18, forklift: 9 };
  const len = LEN[kind];
  const B = wreck ? BURNT : o.ramp ?? (kind === 'car' ? BLUEP : kind === 'tractor' ? RED : kind === 'ambulance' ? WH : kind === 'pickup' ? TAN : kind === 'forklift' ? YEL : OL);
  const glassC = wreck ? DARK : GLASS;
  const P = (xx: number, yy: number, col: string) => p.px(dir > 0 ? x + xx : x + len - 1 - xx, gb - yy, col);
  const Rr = (xx: number, yy: number, w: number, h: number, col: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(xx + i, yy + j, col);
  };
  const wheel = (xx: number, big = false) => {
    if (big) {
      Rr(xx, 0, 5, 5, TYRE);
      P(xx, 0, '#00000000');
      P(xx + 4, 4, TYRE);
      Rr(xx + 1, 1, 3, 3, '#2a2428');
      P(xx + 2, 2, wreck ? RU[2] : YEL[3]);
      P(xx + 1, 4, '#3a3438');
      return;
    }
    Rr(xx, 0, 3, 3, TYRE);
    P(xx + 1, 1, wreck ? RU[2] : M[3]);
    P(xx, 2, '#2e282c');
    P(xx + 1, 2, '#2e282c');
  };
  const mark = (xx: number, yy: number) => {
    if (o.mark === false || wreck) return;
    P(xx, yy, c.tc.main);
    P(xx + 1, yy, c.tc.light);
  };
  switch (kind) {
    case 'jeep': {
      Rr(0, 2, 14, 3, B[3]);
      Rr(0, 4, 14, 1, B[5]);
      Rr(0, 2, 14, 1, B[1]);
      P(13, 3, B[1]);
      P(13, 2, B[0]);
      P(0, 3, B[4]);
      Rr(9, 5, 5, 1, B[4]);
      P(13, 3, wreck ? B[1] : CREAM);
      // windshield frame + seats seen from above
      P(8, 5, B[2]);
      P(8, 6, glassC);
      P(8, 7, B[2]);
      Rr(1, 5, 7, 1, wreck ? B[0] : B[1]);
      P(3, 6, wreck ? B[1] : TARP[3]);
      P(6, 6, wreck ? B[1] : TARP[3]);
      // spare wheel on the tail
      P(0, 5, TYRE);
      P(0, 6, TYRE);
      mark(4, 3);
      wheel(1);
      wheel(10);
      break;
    }
    case 'truck': {
      Rr(0, 2, 22, 1, B[1]);
      Rr(0, 3, 15, 2, B[3]);
      Rr(0, 4, 15, 1, B[4]);
      // canvas tilt
      const T = wreck ? BURNT : TARP;
      if (!wreck) {
        Rr(0, 5, 15, 5, T[2]);
        Rr(0, 9, 15, 1, T[3]);
        Rr(0, 10, 15, 1, T[4]);
        for (let i = 2; i < 15; i += 4) Rr(i, 5, 1, 5, T[1]);
        Rr(0, 5, 1, 5, T[3]);
        P(14, 9, T[2]);
      } else for (let i = 1; i < 15; i += 4) Rr(i, 5, 1, 4, RU[2]);
      // cab
      Rr(16, 3, 6, 5, B[3]);
      Rr(16, 8, 5, 1, B[5]);
      Rr(16, 3, 1, 5, B[4]);
      Rr(17, 6, 3, 2, glassC);
      if (!wreck) P(17, 7, GLASS_HI);
      Rr(21, 3, 1, 3, B[1]);
      P(21, 4, wreck ? B[1] : CREAM);
      Rr(20, 6, 1, 2, B[2]);
      mark(17, 4);
      wheel(1);
      wheel(5);
      wheel(17);
      break;
    }
    case 'pickup': {
      Rr(0, 2, 16, 3, B[3]);
      Rr(0, 4, 16, 1, B[4]);
      Rr(0, 2, 16, 1, B[1]);
      Rr(0, 5, 7, 1, B[1]);
      P(0, 5, B[4]);
      Rr(7, 5, 5, 2, B[3]);
      Rr(7, 7, 4, 1, B[5]);
      Rr(8, 5, 3, 2, glassC);
      if (!wreck) P(8, 6, GLASS_HI);
      Rr(12, 5, 4, 1, B[4]);
      P(15, 3, wreck ? B[1] : CREAM);
      if (!wreck) {
        // cargo
        Rr(2, 6, 3, 2, OL[4]);
        P(2, 7, OL[5]);
        P(5, 6, BLUEP[4]);
      }
      wheel(1);
      wheel(11);
      break;
    }
    case 'car': {
      Rr(0, 2, 13, 3, B[3]);
      Rr(0, 4, 13, 1, B[4]);
      Rr(0, 2, 13, 1, B[1]);
      Rr(3, 5, 7, 2, glassC);
      Rr(4, 7, 5, 1, B[5]);
      P(3, 6, B[3]);
      P(6, 5, B[3]);
      P(6, 6, B[3]);
      P(9, 6, B[2]);
      if (!wreck) P(4, 6, GLASS_HI);
      P(12, 3, wreck ? B[1] : CREAM);
      P(0, 3, wreck ? B[1] : RED[4]);
      wheel(1);
      wheel(9);
      break;
    }
    case 'ambulance': {
      Rr(0, 2, 15, 6, B[4]);
      Rr(0, 2, 15, 1, B[2]);
      Rr(0, 8, 12, 1, B[5]);
      Rr(0, 2, 1, 6, B[5]);
      Rr(12, 5, 3, 3, glassC);
      Rr(12, 8, 2, 1, B[5]);
      Rr(14, 2, 1, 3, B[2]);
      if (!wreck) {
        Rr(1, 4, 11, 1, RCROSS);
        Rr(5, 5, 3, 1, RCROSS);
        P(6, 6, RCROSS);
        P(6, 4, RCROSS);
        P(6, 9, '#3a8ae8');
        P(7, 9, RCROSS);
        P(14, 3, CREAM);
      }
      wheel(1);
      wheel(11);
      break;
    }
    case 'tractor': {
      Rr(4, 3, 8, 3, B[3]);
      Rr(4, 5, 8, 1, B[5]);
      Rr(4, 3, 8, 1, B[1]);
      P(11, 4, B[1]);
      Rr(8, 6, 1, 3, M[1]);
      P(8, 9, M[3]);
      // roll bar + seat
      Rr(2, 5, 1, 6, M[2]);
      Rr(5, 6, 1, 5, M[2]);
      Rr(1, 11, 6, 1, B[4]);
      P(3, 6, '#2a2428');
      P(4, 6, '#2a2428');
      wheel(0, true);
      wheel(9);
      break;
    }
    case 'logtruck': {
      Rr(0, 2, 24, 1, B[1]);
      // log bundle
      for (let j = 0; j < 3; j++) {
        Rr(1, 3 + j * 2, 16, 2, W[3 + (j & 1)]);
        Rr(1, 4 + j * 2, 16, 1, W[5]);
        P(1, 3 + j * 2, ENDG[1]);
        P(1, 4 + j * 2, ENDG[2]);
      }
      for (const sx of [3, 9, 15]) Rr(sx, 3, 1, 7, M[2]);
      Rr(18, 3, 6, 5, B[3]);
      Rr(18, 8, 5, 1, B[5]);
      Rr(18, 3, 1, 5, B[4]);
      Rr(19, 6, 3, 2, glassC);
      Rr(23, 3, 1, 3, B[1]);
      P(23, 4, wreck ? B[1] : CREAM);
      Rr(17, 3, 1, 8, M[1]);
      wheel(2);
      wheel(6);
      wheel(19);
      break;
    }
    case 'howitzer': {
      p.line(dir > 0 ? x : x + len - 1, gb, dir > 0 ? x + 9 : x + len - 10, gb - 2, B[2]);
      p.line(dir > 0 ? x : x + len - 1, gb - 1, dir > 0 ? x + 9 : x + len - 10, gb - 3, B[4]);
      Rr(9, 3, 3, 5, B[4]);
      Rr(11, 3, 1, 5, B[2]);
      // barrel
      for (let i = 0; i < 8; i++) {
        P(10 + i, 6 + Math.floor(i / 3), B[2]);
        P(10 + i, 7 + Math.floor(i / 3), B[5]);
      }
      P(17, 8, M[1]);
      P(17, 9, M[1]);
      wheel(9, true);
      break;
    }
    case 'forklift': {
      Rr(0, 2, 7, 4, B[3]);
      Rr(0, 5, 7, 1, B[5]);
      Rr(1, 6, 1, 5, M[2]);
      Rr(5, 6, 1, 5, M[2]);
      Rr(1, 11, 5, 1, M[3]);
      Rr(7, 1, 1, 9, M[1]);
      Rr(7, 1, 2, 1, M[3]);
      wheel(0);
      wheel(4);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------ construction
function mfoundation(c: Ctx, x: number, gb: number, w: number, d: number) {
  const b = c.base;
  for (let py = gb - d; py <= gb; py++)
    for (let px = x; px < x + w; px++) {
      const edge = py === gb - d || py === gb || px === x || px === x + w - 1;
      b.px(px, py, edge ? (py === gb ? CON[3] : CON[5]) : rv(CON, 0.48 + (vnoise2(px, py, 4, c.seed) - 0.5) * 0.15, px, py, 0.4));
    }
  for (let px = x; px < x + w; px++) b.px(px, gb + 1, CON[1]);
  // formwork boards along the front
  if (c.con === 1) for (let px = x; px < x + w; px += 1) if (md(px, 7) !== 6) b.px(px, gb + 1, W[3]);
}
/** steel tube scaffolding with plank decks */
function mscaffold(c: Ctx, x: number, gb: number, w: number, h: number) {
  const p = c.pc;
  const top = gb - h;
  const n = Math.max(2, Math.round(w / 9) + 1);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(Math.round(x + (i * (w - 1)) / (n - 1)));
  const levels: number[] = [];
  for (let l = gb - 6; l > top + 2; l -= 7) levels.push(l);
  for (const ly of levels) {
    p.hline(x - 1, x + w, ly, W[5]);
    p.hline(x - 1, x + w, ly + 1, W[3]);
    p.hline(x - 1, x + w, ly - 3, M[4]);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const l0 = levels[i % Math.max(1, levels.length)] ?? gb;
    p.line(xs[i], l0 + 5, xs[i + 1], l0 - 1, M[3]);
  }
  for (const sx of xs) {
    p.vline(sx, top - 1, gb, M[5]);
    p.px(sx, top - 2, M[3]);
    p.px(sx, gb, M[2]);
  }
}
/** construction supplies: cement sacks on a pallet, block stack, rebar bundle (+ mixer on big sites) */
function msupplies(c: Ctx) {
  const p = c.pc;
  const gb = c.G - 2;
  const x = c.L + 2;
  // pallet of cement sacks
  p.hline(x, x + 7, gb, W[2]);
  p.hline(x, x + 7, gb - 1, W[4]);
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 2; i++) {
      const sx = x + i * 4 + r;
      p.rect(sx, gb - 4 - r * 2, 4, 2, WH[4]);
      p.px(sx + 3, gb - 4 - r * 2, WH[2]);
      p.px(sx, gb - 4 - r * 2, WH[5]);
      p.px(sx + 1, gb - 3 - r * 2, WH[3]);
    }
  // cinder blocks
  if (c.size >= 2) {
    const bx = c.R - 10;
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 2 - r; i++) {
        const sx = bx + i * 4 + r * 2;
        const sy = gb - r * 3;
        p.rect(sx, sy - 2, 4, 3, CON[4]);
        p.px(sx + 1, sy - 1, CON[1]);
        p.px(sx + 2, sy - 1, CON[1]);
        p.hline(sx, sx + 3, sy - 2, CON[6]);
        p.vline(sx + 3, sy - 2, sy, CON[2]);
      }
    // rebar bundle
    for (let i = 0; i < 3; i++) p.line(bx - 1, gb - i, bx + 9, gb - 3 - i, RU[2 + (i & 1)]);
  }
  if (c.size >= 3) {
    // cement mixer
    const mx = c.ax + 4;
    p.ellipse(mx + 3.5, gb - 5.5, 3.5, 3, ORANGE[3]);
    p.px(mx + 1, gb - 7, ORANGE[5]);
    p.px(mx + 2, gb - 8, ORANGE[4]);
    p.rect(mx + 5, gb - 7, 2, 2, DARK);
    p.line(mx, gb, mx + 3, gb - 3, M[2]);
    p.line(mx + 7, gb, mx + 4, gb - 3, M[2]);
    p.px(mx + 1, gb - 1, TYRE);
  }
}
function mconstruct(c: Ctx, x: number, gb: number, w: number, h: number, d: number) {
  if (c.con === 0) return;
  mfoundation(c, x - 1, gb + 1, w + 2, d);
  mscaffold(c, x, gb, w, c.con === 1 ? Math.round(h * 0.55) : h + 2);
  msupplies(c);
}

// ------------------------------------------------------------------------------------ composite pieces
interface BoxSpec {
  x: number;
  gb: number;
  w: number;
  wh: number;
  d: number;
  mat: MWallMat;
  ramp?: R;
  floors?: number;
  plinth?: number;
  seams?: number;
  field?: 'tar' | 'gravel' | 'concrete' | 'grass' | 'metal';
  parapet?: boolean;
  slabRamp?: R;
  rust?: number;
}
/** flat-roofed block: wall face + roof deck. Returns the wall's top row. */
function box(c: Ctx, s: BoxSpec): number {
  const wh = c.con === 1 && s.wh > 8 ? Math.round(s.wh * 0.55) : s.wh;
  const y = s.gb - s.wh + 1;
  mwall(c, s.x, s.gb - wh + 1, s.w, wh, s.mat, { ramp: s.ramp, floors: s.floors, plinth: s.plinth, seams: s.seams, rust: s.rust });
  slab(c, s.x, y - s.d, s.w, s.d, { field: s.field, parapet: s.parapet, ramp: s.slabRamp });
  return y;
}
/** concrete perimeter wall run (front face + top) with a razor-wire coping */
function compoundWall(c: Ctx, x: number, gb: number, w: number, h: number, th: number, shadeIt = false) {
  const y = gb - h + 1;
  mwall(c, x, y, w, h, 'concrete', { seams: 5 });
  if (shadeIt) for (let py = y; py <= gb; py++) for (let px = x; px < x + w; px++) if (c.pc.get(px, py) >>> 24) c.pc.blend(px, py, '#1a1020', 0.14);
  wallCap(c, x, y - th, w, th);
}
function wallCap(c: Ctx, x: number, y: number, w: number, d: number) {
  if (c.con !== 0) return;
  const p = c.pc;
  for (let ly = 0; ly < d; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (c.dmg === 2 && vnoise(x + lx, 4, c.seed + y) < 0.4) continue;
      let col = rv(CON, ly === 0 ? 0.62 : ly === d - 1 ? 0.88 : 0.74);
      if (lx === 0) col = shade(col, 0.08);
      if (lx === w - 1) col = shade(col, -0.18);
      p.px(x + lx, y + ly, col);
    }
  if (c.dmg < 2) for (let lx = 0; lx < w; lx += 2) p.px(x + lx + (md(lx, 4) ? 1 : 0), y - 1, md(lx, 4) ? M[4] : M[5]);
}
/** N-S wall top strip (seen from above) */
function wallSide(c: Ctx, x: number, y0: number, y1: number, w = 3) {
  if (c.con !== 0) return;
  const p = c.pc;
  for (let py = y0; py <= y1; py++) {
    if (c.dmg === 2 && vnoise(py, 5, c.seed + x) < 0.4) continue;
    for (let lx = 0; lx < w; lx++) p.px(x + lx, py, lx === 0 ? CON[6] : lx === w - 1 ? CON[3] : CON[5]);
    if (c.dmg < 2 && md(py, 2) === 0) p.px(x + 1, py, M[4]);
  }
}
/** square concrete guard post; t4 = tall with a sheet-metal hat + searchlight */
function guardPost(c: Ctx, cx: number, gb: number, tall: boolean, dir: 1 | -1 = 1) {
  const w = 8;
  const x = cx - 4;
  const h = tall ? 17 : 11;
  const y = box(c, { x, gb, w, wh: h, d: 4, mat: 'concrete', field: 'concrete', seams: 0 });
  if (c.con === 0 && c.dmg < 2) {
    mwin(c, x + 2, y + 2, 4, 2, 'slit');
    if (tall) {
      const cc = c;
      // posts + metal hat
      cc.pc.vline(x, y - 10, y - 4, M[4]);
      cc.pc.vline(x + w - 1, y - 10, y - 4, M[2]);
      pyramid(cc, cx, y - 9, 5, 4, 4, 'lead');
      sandbags(c, x, x + w - 1, y - 3, 1);
      searchlight(c, dir > 0 ? x + w - 3 : x, y - 7, dir);
    } else {
      sandbags(c, x, x + w - 1, y - 2, 2);
      c.pc.hline(dir > 0 ? x + 4 : x - 2, dir > 0 ? x + 9 : x + 3, y - 5, M[1]);
    }
  }
}

/** grain silo: cyG = centre of its ground ellipse */
function silo(c: Ctx, cx: number, cyG: number, r: number, h: number, R0: R = COR) {
  const p = c.pc;
  let hh = h;
  if (c.con === 1) hh = Math.round(h * 0.3);
  else if (c.con === 2) hh = Math.round(h * 0.75);
  if (c.dmg === 2) hh = Math.round(h * 0.55);
  const ry = Math.max(1, Math.round(r * 0.42));
  const rr = r + 0.5;
  for (let dx = -r; dx <= r; dx++) {
    const n = dx / rr;
    const yB = cyG + Math.round(ry * Math.sqrt(Math.max(0, 1 - n * n)));
    let colH = hh + (yB - cyG);
    if (c.dmg === 2) colH -= Math.round(vnoise(dx + r, 3, c.seed + cx) * hh * 0.35);
    for (let ly = 0; ly <= colH; ly++) {
      const light = 0.58 - n * 0.36 - (n < -0.8 ? 0.06 : 0);
      let col = rv(R0, light + (md(ly, 3) === 0 ? -0.14 : 0.02));
      if (ly === colH && c.dmg === 2) col = RU[3];
      if (c.con !== 0 && md(dx + r, 4) !== 0 && ly > colH - 3) col = M[3];
      p.px(cx + dx, yB - ly, col);
    }
  }
  if (c.con !== 0 || c.dmg === 2) return;
  const top = cyG - hh;
  // domed cap
  const dh = Math.round(r * 0.9);
  for (let dy = -dh - ry; dy <= ry; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const n = dx / rr;
      const eave = ry * Math.sqrt(Math.max(0, 1 - n * n));
      const cap = -eave - dh * Math.sqrt(Math.max(0, 1 - n * n));
      if (dy > eave || dy < cap) continue;
      const v = 0.62 - n * 0.4 + (dy < cap + 2 ? 0.1 : 0);
      p.px(cx + dx, top + dy, Math.round(eave) === dy ? rv(R0, 0.3) : rv(R0, v, cx + dx, top + dy, 0.4));
    }
  p.rect(cx - 1, top - dh - ry - 1, 2, 2, M[5]);
  // ladder
  const lx = cx + Math.round(r * 0.45);
  for (let y = top + 2; y < cyG + ry; y++) p.px(lx, y, md(y, 2) ? M[2] : M[5]);
}

/** tall brick factory chimney */
function stack(c: Ctx, x: number, gb: number, h: number, w = 4) {
  if (c.con === 1) return;
  const p = c.pc;
  let hh = h;
  if (c.con === 2) hh = Math.round(h * 0.6);
  if (c.dmg === 2) hh = Math.round(h * 0.45);
  for (let ly = 0; ly < hh; ly++)
    for (let lx = 0; lx < w; lx++) {
      const k = Math.floor(ly / 2);
      let col = rv(BR, (lx === 0 ? 0.8 : lx === w - 1 ? 0.25 : 0.55) + (md(ly, 2) === 0 ? -0.08 : 0) + (hash2(lx, k, 3) - 0.5) * 0.1);
      if (ly > hh - 5 && c.dmg < 2) col = shade(col, -0.35 * ((ly - hh + 5) / 5));
      if (md(ly, 14) === 10) col = rv(CON, lx === 0 ? 0.8 : 0.55);
      p.px(x + lx, gb - ly, col);
    }
  if (c.dmg === 2 || c.con) return;
  p.hline(x - 1, x + w, gb - hh, CON[4]);
  p.hline(x - 1, x + w, gb - hh - 1, CON[6]);
  p.hline(x, x + w - 1, gb - hh - 1, '#1a1216');
}

/** striped shop awning in a fixed colour */
function mawning(c: Ctx, x: number, y: number, w: number, d: number, col: string) {
  if (c.con !== 0) return;
  const p = c.pc;
  for (let ly = 0; ly <= d; ly++)
    for (let lx = 0; lx < w; lx++) {
      if (c.dmg === 2 && hash2(lx >> 1, ly, c.seed + x) < 0.45) continue;
      let cc = md(lx >> 1, 2) === 0 ? col : CREAM;
      cc = shade(cc, 0.12 - (ly / d) * 0.25);
      if (lx === 0) cc = shade(cc, 0.08);
      if (lx === w - 1) cc = shade(cc, -0.18);
      p.px(x + lx, y + ly, cc);
    }
  for (let lx = 0; lx < w; lx++) {
    if (c.dmg === 2 && lx & 1) continue;
    p.px(x + lx, y + d + 1, shade(md(lx >> 1, 2) === 0 ? col : CREAM, -0.3));
  }
}

/** shop window with goods on display */
function shopWindow(c: Ctx, x: number, y: number, w: number, h: number) {
  mwin(c, x, y, w, h, 'shop', M[4]);
  if (!intact(c) || c.dmg) return;
  const goods = ['#e05a4a', '#f0d060', '#5a9a4a', '#e8e4d8', '#6a8ad0'];
  for (let i = 1; i < w - 1; i++) {
    c.pc.px(x + i, y + h - 1, goods[md(i + c.seed + x, 5)]);
    if (i & 1) c.pc.px(x + i, y + h - 2, goods[md(i * 3 + x, 5)]);
  }
  c.pc.px(x, y, GLASS_HI);
}

/** an earth berm / mound */
function berm(c: Ctx, x0: number, x1: number, gb: number, h: number) {
  const p = c.pc;
  const E = ['#3e2e20', '#4e3a28', '#604832', '#72583c', '#86694a'];
  for (let px = x0; px <= x1; px++) {
    const t = (px - x0) / Math.max(1, x1 - x0);
    const hh = Math.round(h * Math.min(1, Math.min(t, 1 - t) * 5) + (vnoise(px, 4, c.seed) - 0.5) * 2);
    for (let ly = 0; ly <= hh; ly++) {
      const top = ly >= hh - 1;
      let col = top ? rv(RAMP.grass, 0.5 + (hash2(px, ly, 3) - 0.5) * 0.3) : rv(E, 0.35 + (ly / Math.max(1, hh)) * 0.5 + (hash2(px, ly, c.seed) - 0.5) * 0.2, px, gb - ly, 0.6);
      if (t < 0.12 && !top) col = shade(col, 0.1);
      p.px(px, gb - ly, col);
    }
  }
}

// ======================================================================================== BUILDINGS
type MDrawer = (c: Ctx, o: BuildingOpts) => void;

// ---------------------------------------------------------------------------- settlement cores
/** National Headquarters: walled concrete compound around a multi-storey HQ block */
const mCapital: MDrawer = (c) => {
  const s = c.size;
  const p = c.pc;
  const { L, R, F, G } = c;
  const fw = s * TILE;
  const big = s >= 5 ? 2 : s === 4 ? 1 : 0;
  const t4 = c.tier >= 4 ? 1 : 0;
  const wh = big ? 8 : 7;
  const th = 3;
  const gyB = F + th + 5;
  const gyF = G - 2;
  const xl = L + 5;
  const xr = R - 6;
  pad(c, 'grass', L + 3, gyB - 2, fw - 6, gyF - gyB + 1, 2);
  // ---- back wall (in shade) + back posts
  compoundWall(c, xl, gyB, xr - xl + 1, wh, th, true);
  guardPost(c, xl, gyB, !!t4, -1);
  guardPost(c, xr, gyB, !!t4, 1);
  wallSide(c, xl - 1, gyB - wh - th + 1, gyF - wh - th, 3);
  wallSide(c, xr - 1, gyB - wh - th + 1, gyF - wh - th, 3);
  // ---- HQ block
  const n = [2, 3, 3][big] + t4;
  const st = 6;
  const kwh = n * st + 3;
  const kw = [26, 32, 40][big] + t4 * 4;
  const kd = [9, 11, 13][big];
  const gyK = F + [26, 34, 42][big];
  const kx = c.ax - (kw >> 1);
  if (c.con === 0) pad(c, 'concrete', kx - 3, gyK - 2, kw + 6, 7, 1);
  const ky = box(c, { x: kx, gb: gyK, w: kw, wh: kwh, d: kd, mat: 'concrete', ramp: SANDC, floors: st, plinth: 2, seams: 0, field: 'gravel' });
  const roofY = ky - kd;
  if (c.con !== 1) {
    for (let f = 0; f < n; f++) {
      const wy = gyK - (f * st + 5);
      winRow(c, kx + 2, kx + kw - 3, wy, 3, 3, 'glass', 2, SANDC[7], (_i, wx) => Math.abs(wx + 1 - c.ax) < (f === 0 ? 7 : 4));
    }
  }
  stripe(c, kx, ky + 1, kw, c.tc.main);
  if (intact(c)) {
    if (n >= 3) vbanner(c, c.ax - 1, ky + 3, 3, kwh - 14, c.tc);
    else plaque(c, c.ax, ky + 4, c.tc);
  }
  // entrance canopy + glass doors + steps
  mdoor(c, c.ax - 3, gyK - 5, 6, 5, 'glass');
  if (intact(c)) {
    p.hline(c.ax - 6, c.ax + 5, gyK - 8, CON[7]);
    p.hline(c.ax - 6, c.ax + 5, gyK - 7, CON[4]);
    p.vline(c.ax - 6, gyK - 6, gyK, M[5]);
    p.vline(c.ax + 5, gyK - 6, gyK, M[3]);
    p.hline(c.ax - 6, c.ax + 5, gyK + 1, CON[6]);
    p.hline(c.ax - 7, c.ax + 6, gyK + 2, CON[5]);
  }
  // roof furniture: AC units, vents, comms mast with dish, the national flag
  if (intact(c)) {
    acUnit(c, kx + 4, roofY + 4);
    acUnit(c, kx + kw - 15, roofY + 3);
    vent(c, c.ax - 2, roofY + 4);
    if (big) vent(c, kx + 12, roofY + kd - 5);
  }
  if (c.con === 0) {
    mast(c, kx + kw - 6, roofY + kd - 3, [22, 28, 32][big] + t4 * 6, { bw: 2, dish: true, whip: true, bands: !!t4 });
    mflag(c, kx + 4, roofY + kd - 2, [14, 16, 18][big], c.tc, { w: 7, fh: 5, sym: true });
  }
  // ---- side wings (bigger compounds)
  const gyW = gyK + 5;
  if (big >= 1) {
    const lx0 = xl + 4;
    const lw = kx - 2 - lx0;
    const rx0 = kx + kw + 2;
    const rw = xr - 3 - rx0;
    if (lw >= 8) {
      box(c, { x: lx0, gb: gyW, w: lw, wh: 9, d: 8, mat: 'block', field: 'metal', parapet: false });
      mdoor(c, lx0 + 2, gyW - 6, Math.min(8, lw - 4), 6, 'roll');
      if (c.con === 0) hazard(c, lx0 + 1, gyW - 7, Math.min(10, lw - 2), 1);
    }
    if (rw >= 8) {
      const ry2 = box(c, { x: rx0, gb: gyW, w: rw, wh: 9, d: 8, mat: 'brick', field: 'tar', plinth: 1 });
      winRow(c, rx0 + 2, rx0 + rw - 3, ry2 + 2, 2, 3, 'blind', 2);
      if (intact(c)) aerial(c, rx0 + rw - 4, ry2 - 3);
    }
  }
  // ---- courtyard
  const cyF = gyF - wh - th;
  if (c.con === 0) {
    pad(c, 'asphalt', c.ax - 5, gyK + 2, 10, gyF - gyK - 2, 1);
    pad(c, 'asphalt', L + 7, cyF - 9, big === 2 ? c.ax - L - 12 : 18, 9, 1);
    if (t4 && big >= 1 && c.dmg < 2) helipad(c, R - 18 - big * 2, gyW + 5 + big, 4 + big);
    vehicle(c, L + 9, cyF - 1, 'jeep', { dir: 1 });
    if (big === 2) vehicle(c, c.ax - 22, cyF - 1, 'truck', { dir: 1 });
    if (big >= 1) drums(c, xr - 7, gyW + 3, 2, OL);
  }
  // ---- front wall with a checkpoint gate
  const gw = [10, 12, 14][big];
  const gx = c.ax - (gw >> 1);
  if (c.con === 0) pad(c, 'asphalt', gx - 1, gyF - wh - 2, gw + 2, wh + 6, 1);
  compoundWall(c, xl, gyF, gx - 3 - xl, wh, th);
  compoundWall(c, gx + gw + 3, gyF, xr - gx - gw - 2, wh, th);
  for (const px0 of [gx - 4, gx + gw]) {
    const py = box(c, { x: px0, gb: gyF, w: 4, wh: wh + 4, d: 3, mat: 'concrete', field: 'concrete', seams: 0 });
    if (c.con === 0 && c.dmg < 2) hazard(c, px0, py + 3, 4, 3);
  }
  if (intact(c)) {
    // boom barrier (raised on the right pillar, painted red/white)
    for (let i = 0; i < gw; i++) {
      p.px(gx + i, gyF - 6, md(i >> 1, 2) ? RED[4] : WH[5]);
      p.px(gx + i, gyF - 5, md(i >> 1, 2) ? RED[2] : WH[3]);
    }
    p.rect(gx + gw, gyF - 7, 2, 3, M[2]);
    if (t4) {
      mflag(c, gx - 3, gyF - wh - 6, 9, c.tc, { w: 4, fh: 3, phase: 2 });
      mflag(c, gx + gw + 2, gyF - wh - 6, 9, c.tc, { w: 4, fh: 3, phase: 3 });
    }
  }
  if (big >= 1 && c.con === 0) {
    sandbags(c, gx - 12, gx - 6, gyF + 1, 2);
    sandbags(c, gx + gw + 5, gx + gw + 11, gyF + 1, 2);
  }
  guardPost(c, xl, gyF, !!t4, -1);
  guardPost(c, xr, gyF, !!t4, 1);
  if (c.dmg === 2) for (let k = 0; k < 4 + big * 2; k++) blob(p, L + 6 + hash2(k, 1, c.seed) * (fw - 12), gyF - 1 + hash2(k, 2, c.seed) * 3, 2 + hash2(k, 3, c.seed) * 2, 1.5, CON, k);
  if (c.con) {
    mfoundation(c, kx - 1, gyK + 1, kw + 2, kd);
    towerCrane(c, Math.min(R - 8, kx + kw + 4), gyK - 2, kwh + kd + 16, Math.round(kw * 0.8), 7);
    mscaffold(c, kx, gyK, kw, c.con === 1 ? 10 : kwh + 2);
    msupplies(c);
  }
};

/** Command Post: earth-roofed bunker with an observation tower and comms antennas */
const mKeep: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const big = c.size >= 4 ? 1 : 0;
  const p = c.pc;
  pad(c, 'gravel', L + 2, F + 6, fw - 4, fw - 7, 4);
  chainFence(c, L + 3, R - 4, F + 10, 6);
  radome(c, R - (big ? 13 : 11), F + (big ? 24 : 20), big ? 7 : 6);
  // observation tower behind the bunker
  const tw = big ? 14 : 11;
  const tx = c.ax - (big ? 20 : 15);
  const tgb = G - 18;
  const th = big ? 36 : 30;
  const ty = box(c, { x: tx, gb: tgb, w: tw, wh: th, d: 5, mat: 'concrete', field: 'concrete', seams: 0, floors: 9 });
  mwin(c, tx + 1, ty + 2, tw - 2, 3, 'glass', CON[7]);
  mwin(c, tx + 3, ty + 12, tw - 6, 1, 'slit');
  if (c.con === 0) {
    sandbags(c, tx - 1, tx + tw, ty - 1, 2);
    mast(c, tx + tw - 3, ty - 3, 20, { bw: 1, whip: true });
    mflag(c, tx + 1, ty - 3, 13, c.tc, { w: 6, fh: 4, sym: true });
    searchlight(c, tx + 3, ty - 6, -1);
  }
  // the bunker
  const bw = big ? 44 : 34;
  const bx = c.ax - (bw >> 1) + (big ? 4 : 3);
  const bgb = G - 7;
  const bh = 10;
  const bd = big ? 13 : 11;
  const by = box(c, { x: bx, gb: bgb, w: bw, wh: bh, d: bd, mat: 'bunker', field: 'grass', seams: 0, parapet: false });
  const bcx = bx + (bw >> 1);
  winRow(c, bx + 3, bx + bw - 4, by + 2, 5, 2, 'slit', 5, null, (_i, wx) => Math.abs(wx + 2 - bcx) < 7);
  mdoor(c, bcx - 3, bgb - 6, 6, 6, 'blast');
  if (intact(c)) {
    p.px(bcx, bgb - 9, WARN);
    p.px(bcx - 1, bgb - 9, '#7a2a20');
  }
  camoNet(c, bx + Math.round(bw * 0.55), by - bd + 1, Math.round(bw * 0.45) - 1, bd + 4);
  if (intact(c)) {
    for (const ox of [4, 9]) p.vline(bx + ox, by - bd + 2 - 7, by - bd + 4, M[4]);
    vent(c, bx + 14, by - 6);
    dish(c, bx + 18, by - bd + 4, 2);
  }
  sandbags(c, bcx - 10, bcx - 5, G - 2, 2);
  sandbags(c, bcx + 4, bcx + 9, G - 2, 2);
  mgNest(c, L + 8, G - 1, 5, 5);
  if (big) vehicle(c, R - 16, G - 1, 'jeep', { dir: -1 });
  else jerrycan(c, R - 6, G - 2);
  drums(c, bx + bw - 3, bgb - 1, 1, OL);
  if (c.con) {
    mfoundation(c, bx - 1, bgb + 1, bw + 2, bd);
    mscaffold(c, tx, tgb, tw, c.con === 1 ? 12 : th);
    msupplies(c);
  }
};

/** civic brick town hall with a portico, clock tower and flags */
const mTownHall: MDrawer = (c) => {
  const { L, R, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  const x = L + 3;
  const w = fw - 6;
  const gb = G - 6;
  const wh = 17;
  const y = gb - wh + 1;
  const rh = 16;
  pad(c, 'concrete', L + 2, y - 4, fw - 4, G - y + 3, 2);
  mwall(c, x, y, w, wh, 'brick', { plinth: 2 });
  stripe(c, x, gb - 8, w, CON[6]);
  stripe(c, x, y, w, CON[6]);
  const lint = (wx: number, wy: number) => {
    if (c.con === 0 && c.dmg < 2) p.hline(wx - 1, wx + 2, wy - 1, CON[6]);
  };
  for (const wy of [y + 3, gb - 6]) {
    for (let i = 0; i < 3; i++) {
      const wx = x + 3 + i * 4;
      mwin(c, wx, wy, 2, 4, 'glass', CON[6]);
      lint(wx, wy);
      const wx2 = x + w - 5 - i * 4;
      mwin(c, wx2, wy, 2, 4, i === 1 && wy < gb - 8 ? 'lit' : 'glass', CON[6]);
      lint(wx2, wy);
    }
  }
  // portico: pediment + columns + glass doors
  const pw = 14;
  const px0 = c.ax - 7;
  if (c.con !== 1) {
    for (let py = gb - 12; py <= gb; py++) for (let px = px0; px < px0 + pw; px++) p.px(px, py, py === gb - 12 ? CON[6] : '#4a3a38');
    mdoor(c, c.ax - 3, gb - 6, 6, 7, 'glass');
    if (c.dmg < 2) {
      for (const cx of [px0, px0 + 4, px0 + 9, px0 + 12]) {
        p.vline(cx, gb - 11, gb, WH[5]);
        p.vline(cx + 1, gb - 11, gb, WH[2]);
      }
      p.hline(px0 - 1, px0 + pw, gb - 13, WH[4]);
      p.hline(px0 - 1, px0 + pw, gb - 12, WH[2]);
      for (let k = 0; k < 5; k++) p.hline(px0 + k * 2, px0 + pw - 1 - k * 2, gb - 14 - k, k === 4 ? WH[5] : WH[4]);
      p.px(c.ax - 1, gb - 16, c.tc.main);
      p.px(c.ax, gb - 16, c.tc.light);
    }
  }
  roofEW(c, x - 2, y - rh + 1, w + 4, rh, 'slate', { hip: 8, ridge: 0.4 });
  if (c.con === 0) {
    // clock tower on the ridge
    const tw = 9;
    const tx = c.ax - (tw >> 1);
    const tgb = y - 7;
    const tth = 12;
    mwall(c, tx, tgb - tth + 1, tw, tth, 'brick');
    if (c.dmg < 2) {
      stripe(c, tx, tgb - tth + 1, tw, CON[6]);
      const cy = tgb - tth + 6;
      p.ellipse(c.ax + 0.5, cy + 0.5, 2.7, 2.7, CREAM);
      p.px(c.ax + 2, cy + 1, PLC);
      p.px(c.ax, cy - 1, OUTL);
      p.px(c.ax, cy, OUTL);
      p.px(c.ax + 1, cy, OUTL);
      pyramid(c, c.ax, tgb - tth + 1, 5, 4, 8, 'lead');
      mflag(c, c.ax, tgb - tth - 9, 7, c.tc, { w: 5, fh: 3 });
    }
  }
  if (intact(c)) {
    p.hline(c.ax - 8, c.ax + 7, gb + 1, CON[6]);
    p.hline(c.ax - 9, c.ax + 8, gb + 2, CON[5]);
  }
  streetLamp(c, L + 4, G - 1, 11, 1);
  streetLamp(c, R - 5, G - 1, 11, -1);
  bench(c, R - 14, G - 1);
  mconstruct(c, x, gb, w, wh, rh - 6);
};
const PLC = RAMP.plaster[2];
const OUTL = '#2a2026';

/** small rendered village hall with a red tin roof, porch, notice board and phone box */
const mVillageHall: MDrawer = (c) => {
  const { L, R, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  const x = L + 6;
  const w = fw - 13;
  const gb = G - 7;
  const wh = 10;
  const y = gb - wh + 1;
  const rh = 22;
  pad(c, 'gravel', L + 3, y - 6, fw - 6, G - y + 5, 4);
  mwall(c, x, y, w, wh, 'render', { plinth: 2 });
  for (const wx of [x + 3, x + 9, x + w - 13, x + w - 7]) mwin(c, wx, y + 3, 3, 4, 'curtain', WH[5]);
  mdoor(c, c.ax - 2, gb - 6, 4, 7, 'paint', GREENP);
  troofEW(c, x - 3, y - rh + 1, w + 6, rh, RED, { ridge: 0.32, rust: 0.14 });
  if (c.con === 0 && c.dmg < 2) {
    // porch canopy
    p.vline(c.ax - 4, gb - 8, gb, W[4]);
    p.vline(c.ax + 3, gb - 8, gb, W[2]);
    troofNS(c, c.ax, gb - 8, 5, 3, 3, RED);
    aerial(c, x + w - 6, y - rh + 7, 7);
    sign(c, x + 14, y + 3, 5, BLUEP);
  }
  mflag(c, L + 3, G - 2, 18, c.tc, { w: 5, fh: 4, sym: true });
  phoneBox(c, R - 6, G - 2);
  bench(c, x + 2, G - 1);
  bin(c, R - 11, G - 1);
  mconstruct(c, x, gb, w, wh, rh - 6);
};

/** Radio Outpost: tall banded lattice mast with a prefab hut inside a fence */
const mOutpost: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  pad(c, 'gravel', L + 2, F + 8, fw - 4, fw - 9, 3);
  chainFence(c, L + 2, R - 3, F + 10, 6);
  chainFenceV(c, L + 2, F + 11, G - 2, 6);
  chainFenceV(c, R - 3, F + 11, G - 2, 6);
  mast(c, L + 10, G - 13, 56, { bw: 2, bands: true, dish: true, guys: true });
  const hx = R - 18;
  const hy = box(c, { x: hx, gb: G - 5, w: 14, wh: 9, d: 7, mat: 'panel', ramp: WH, field: 'metal', parapet: false });
  mdoor(c, hx + 2, G - 11, 3, 6, 'steel');
  mwin(c, hx + 7, hy + 3, 3, 2, 'barred', M[4]);
  if (intact(c)) {
    stripe(c, hx, hy + 1, 14, c.tc.main);
    acUnit(c, hx + 8, hy - 5);
    mflag(c, hx + 2, hy - 4, 9, c.tc, { w: 5, fh: 3 });
  }
  if (c.con === 0) {
    baseLine(c, L + 11, G - 13, hx, G - 9, '#2a2428', 0.7);
    chainFence(c, L + 2, R - 3, G - 1, 6, L + 12, L + 21);
  }
  generator(c, L + 3, G - 3);
  drum(c, hx + 11, G - 1, OL);
  mconstruct(c, hx, G - 5, 14, 9, 7);
};

/** MG guard tower: steel legs, sandbagged cabin, mounted MG and searchlight */
const mWatchtower: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'gravel', L + 4, F + 10, fw - 8, fw - 11, 3);
  const cx = c.ax;
  const gb = G - 6;
  const cb = gb - 22;
  const ruined = c.dmg === 2;
  const legTop = c.con === 1 ? gb - 9 : ruined ? gb - 10 : cb;
  // footings
  for (const fx of [cx - 7, cx + 6]) {
    p.rect(fx, gb - 1, 2, 2, CON[4]);
    p.px(fx, gb - 1, CON[6]);
  }
  // back legs
  p.vline(cx - 5, legTop, gb - 4, M[2]);
  p.vline(cx + 4, legTop, gb - 4, M[1]);
  // bracing
  if (!ruined && c.con !== 1)
    for (let y0 = gb; y0 > cb + 2; y0 -= 7) {
      const y1 = Math.max(cb, y0 - 7);
      p.line(cx - 6, y0, cx + 6, y1, M[3]);
      p.line(cx + 6, y0, cx - 6, y1, M[2]);
      p.hline(cx - 6, cx + 6, y1, M[3]);
    }
  // ladder
  if (c.con === 0 && !ruined) for (let y = cb; y <= gb; y++) {
    p.px(cx + 1, y, M[4]);
    p.px(cx + 3, y, M[3]);
    if (md(y, 2) === 0) p.px(cx + 2, y, M[4]);
  }
  // front legs
  p.vline(cx - 7, ruined ? gb - 12 : legTop, gb, M[5]);
  p.vline(cx + 6, ruined ? gb - 7 : legTop, gb, M[3]);
  if (c.con === 0 && !ruined) {
    // cabin
    p.hline(cx - 9, cx + 9, cb, M[2]);
    p.hline(cx - 9, cx + 9, cb - 1, M[4]);
    p.rect(cx - 8, cb - 11, 17, 7, '#2a2026');
    p.vline(cx - 9, cb - 12, cb - 2, M[5]);
    p.vline(cx + 9, cb - 12, cb - 2, M[3]);
    p.hline(cx + 2, cx + 11, cb - 7, M[1]);
    p.px(cx + 12, cb - 7, M[3]);
    p.px(cx - 5, cb - 8, OL[3]);
    p.px(cx - 4, cb - 9, OL[4]);
    sandbags(c, cx - 9, cx + 9, cb - 2, 2);
    troofEW(c, cx - 11, cb - 19, 23, 8, COR, { ridge: 0.45, rust: 0.2 });
    searchlight(c, cx - 8, cb - 14, -1);
    mflag(c, cx + 8, cb - 17, 9, c.tc, { w: 5, fh: 3 });
  } else if (ruined) {
    // fallen cabin roof sheet + debris at the foot
    p.line(cx - 10, gb - 3, cx + 2, gb - 8, COR[4]);
    p.line(cx - 10, gb - 2, cx + 2, gb - 7, COR[2]);
    sandbags({ ...c, dmg: 0 }, cx + 2, cx + 9, gb + 1, 1);
  }
  sandbags(c, L + 5, L + 12, G - 2, 2);
  ammoBox(c, R - 11, G - 2, 6);
  jerrycan(c, R - 5, G - 2);
  if (c.con) {
    mscaffold(c, cx - 8, gb, 17, c.con === 1 ? 10 : 24);
    msupplies(c);
  }
};

// ---------------------------------------------------------------------------- economy / military
/** Housing: terraces, bungalow + garage, small flat block, prefab semi */
const mHouse: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  const v = c.variant & 3;
  if (v === 0) {
    // brick terrace pair
    pad(c, 'grass', L + 2, F + 6, fw - 4, fw - 7, 3);
    const x = L + 3;
    const w = fw - 6;
    const gb = G - 6;
    const wh = 15;
    const y = gb - wh + 1;
    mwall(c, x, y, w, wh, 'brick', { plinth: 1 });
    if (c.con !== 1 && c.dmg < 2) p.vline(c.ax, y, gb, BR[1]);
    mdoor(c, x + 4, gb - 5, 3, 6, 'paint', RED);
    mdoor(c, x + w - 7, gb - 5, 3, 6, 'paint', BLUEP);
    mwin(c, x + 9, gb - 5, 3, 3, 'blind', WH[5]);
    mwin(c, x + w - 12, gb - 5, 3, 3, 'curtain', WH[5]);
    for (const wx of [x + 3, x + 9, x + w - 12, x + w - 6]) mwin(c, wx, y + 3, 3, 3, wx < c.ax ? 'curtain' : 'blind', WH[5]);
    roofEW(c, x - 2, y - 12, w + 4, 13, 'slate', { ridge: 0.38 });
    if (c.con === 0) {
      chimneyM(c, x + 7, y - 14, 6);
      chimneyM(c, x + w - 10, y - 14, 6);
      aerial(c, x + 8, y - 14, 6);
      aerial(c, x + w - 9, y - 14, 5);
    }
    bin(c, L + 3, G - 1);
    bush(c, c.ax, G - 1, 2);
    bin(c, R - 6, G - 1, BLUEP);
    mconstruct(c, x, gb, w, wh, 8);
  } else if (v === 1) {
    // bungalow with a garage and the family car
    pad(c, 'grass', L + 2, F + 6, fw - 4, fw - 7, 3);
    pad(c, 'concrete', R - 14, G - 8, 12, 7, 1);
    const cx = L + 11;
    const hw = 8;
    const gb = G - 5;
    const wh = 9;
    const y = gb - wh + 1;
    mwall(c, cx - hw + 1, y, hw * 2 - 1, wh, 'render', { plinth: 1, gable: 7, ghw: hw + 1 });
    mdoor(c, cx - 1, gb - 5, 3, 6, 'paint', GREENP);
    mwin(c, cx - 6, y + 3, 3, 3, 'curtain', WH[5]);
    mwin(c, cx + 3, y + 3, 3, 3, 'blind', WH[5]);
    roofNS(c, cx, y, hw + 1, 7, 13, 'tile');
    if (intact(c)) aerial(c, cx + 3, y - 12, 6);
    const gx = R - 13;
    const gy = box(c, { x: gx, gb: G - 9, w: 11, wh: 8, d: 9, mat: 'block', field: 'tar', parapet: false });
    mdoor(c, gx + 1, gy + 1, 9, 7, 'roll');
    vehicle(c, R - 15, G - 1, 'car', { dir: -1, ramp: c.seed & 1 ? RED : BLUEP });
    flowers(c, L + 3, G - 2, 3);
    mconstruct(c, cx - hw, gb, hw * 2, wh, 10);
  } else if (v === 2) {
    // small concrete flat block with balconies
    pad(c, 'concrete', L + 2, F + 8, fw - 4, fw - 9, 2);
    const x = L + 4;
    const w = fw - 8;
    const gb = G - 4;
    const st = 7;
    const wh = st * 3 + 1;
    const y = box(c, { x, gb, w, wh, d: 9, mat: 'concrete', floors: st, plinth: 1, seams: 0, field: 'tar' });
    for (let f = 0; f < 3; f++) {
      const wy = gb - f * st - 5;
      for (const wx of [x + 3, x + w - 7]) {
        mwin(c, wx, wy, 4, 3, f === 1 && wx < c.ax ? 'lit' : 'glass', CON[6]);
        if (f > 0 && intact(c)) {
          // balcony rail with washing / plants
          p.hline(wx - 1, wx + 4, wy + 3, CON[7]);
          p.hline(wx - 1, wx + 4, wy + 4, CON[3]);
          p.px(wx + (f & 1 ? 1 : 3), wy + 2, ['#e05a4a', '#f0d060', LEAF[4]][md(f + wx, 3)]);
        }
      }
    }
    mdoor(c, c.ax - 2, gb - 5, 4, 5, 'glass');
    if (intact(c)) {
      for (const ax2 of [x + 4, x + w - 6]) aerial(c, ax2, y - 3, 6);
      acUnit(c, c.ax - 2, y - 7);
    }
    bin(c, L + 2, G - 1);
    bin(c, R - 5, G - 1, BLUEP);
    mconstruct(c, x, gb, w, wh, 9);
  } else {
    // prefab semi with tin roof, shed and washing line
    pad(c, 'grass', L + 2, F + 6, fw - 4, fw - 7, 3);
    const x = L + 3;
    const w = 21;
    const gb = G - 6;
    const wh = 9;
    const y = gb - wh + 1;
    mwall(c, x, y, w, wh, 'render', { ramp: PINK, plinth: 1 });
    mdoor(c, x + 3, gb - 5, 3, 6, 'paint', BLUEP);
    mwin(c, x + 9, y + 3, 4, 3, 'curtain', WH[5]);
    mwin(c, x + 16, y + 3, 3, 3, 'blind', WH[5]);
    troofEW(c, x - 2, y - 15, w + 4, 16, COR, { ridge: 0.34, rust: 0.3 });
    if (intact(c)) aerial(c, x + 5, y - 14, 7);
    // shed
    const sx = R - 10;
    mwall(c, sx, G - 12, 8, 7, 'corr', { ramp: GREENP });
    troofEW(c, sx - 1, G - 20, 10, 9, COR, { ridge: 0.2, rust: 0.4 });
    mdoor(c, sx + 2, G - 10, 3, 5, 'steel');
    if (c.con === 0 && c.dmg < 2) {
      p.vline(L + 4, G - 7, G - 1, W[3]);
      p.vline(R - 12, G - 7, G - 1, W[2]);
      baseLine(c, L + 4, G - 7, R - 12, G - 7, '#d0d0c8', 0.7);
      const cloth = ['#e05a4a', '#f0f0e8', '#6a8ad0', '#f0d060'];
      for (let i = 0; i < 4; i++) {
        const lx = L + 7 + i * 4;
        p.rect(lx, G - 7, 2, 3, cloth[i]);
        p.px(lx + 1, G - 5, shade(cloth[i], -0.25));
      }
    }
    mconstruct(c, x, gb, w, wh, 10);
  }
};

/** small brick chimney with a pot */
function chimneyM(c: Ctx, x: number, yTop: number, h: number) {
  if (c.con === 1) return;
  const p = c.pc;
  const top = c.dmg === 2 ? yTop + Math.round(h * 0.5) : yTop;
  for (let py = top + 1; py < yTop + h; py++)
    for (let lx = 0; lx < 3; lx++) p.px(x + lx, py, rv(BR, (lx === 0 ? 0.75 : lx === 2 ? 0.3 : 0.55) + (md(py, 2) === 0 ? -0.08 : 0)));
  if (c.dmg < 2) {
    p.hline(x, x + 2, top, BR[5]);
    p.px(x + 1, top - 1, RAMP.tile[3]);
    p.px(x + 1, top, '#1a1216');
  }
}

/** Farm: red corrugated barn, grain silo, tractor, round bales */
const mFarm: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const p = c.pc;
  pad(c, 'dirt', L + 2, F + 8, 30, 23, 3);
  silo(c, L + 8, G - 15, 5, 19, COR);
  const cx = R - 12;
  const hw = 9;
  const gb = G - 5;
  const wh = 10;
  const y = gb - wh + 1;
  const x = cx - hw + 1;
  mwall(c, x, y, hw * 2 - 1, wh, 'corr', { ramp: RED, gable: 7, ghw: hw + 1 });
  if (c.con !== 1) {
    // big sliding barn door
    const dw = 7;
    const dx = cx - 3;
    if (c.con === 2 || c.dmg === 2) p.rect(dx, gb - 8, dw, 9, DARK);
    else {
      p.rect(dx, gb - 8, dw, 9, '#2a1a18');
      p.rect(dx - 3, gb - 8, 4, 9, WH[4]);
      p.vline(dx - 3, gb - 8, gb, WH[5]);
      p.line(dx - 3, gb - 8, dx, gb, WH[2]);
      p.hline(dx - 4, dx + dw, gb - 9, M[2]);
      p.px(dx + 2, gb - 3, HAY[4]);
      p.px(dx + 3, gb - 2, HAY[3]);
    }
  }
  troofNS(c, cx, y, hw + 1, 7, 15, COR, { rust: 0.14 });
  vehicle(c, L + 2, G - 1, 'tractor', { ramp: c.variant & 1 ? GREENP : RED, mark: false });
  roundBale(c, L + 17, G - 2);
  roundBale(c, L + 21, G - 5);
  if (c.con) msupplies(c);
};

/** Sawmill: open corrugated shed with a circular saw, log pile and logging truck */
const mLumber: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const p = c.pc;
  pad(c, 'dirt', L + 2, F + 5, 30, 26, 3);
  const sx = L + 2;
  const sw = 19;
  const gb = G - 11;
  if (c.con !== 1) {
    mwall(c, sx, gb - 9, sw, 8, 'corr', { rust: 0.3 });
    for (let py = gb - 9; py <= gb - 2; py++) for (let px = sx; px < sx + sw; px++) p.blend(px, py, '#1a1020', 0.42);
    saw(c, sx + 5, gb);
  }
  for (const px of [sx, sx + sw - 1]) p.vline(px, gb - 11, gb, px === sx ? M[5] : M[3]);
  troofEW(c, sx - 1, gb - 25, sw + 2, 15, COR, { ridge: 0.36, rust: 0.35 });
  logPile(c, R - 12, G - 13, 3, 3, 4);
  if (c.con === 0) for (let i = 0; i < 9; i++) c.base.px(sx + 2 + Math.floor(hash2(i, 1, c.seed) * 14), gb + 1 + Math.floor(hash2(i, 2, c.seed) * 3), ENDG[2]);
  vehicle(c, L + 2, G - 1, 'logtruck', { ramp: YEL, mark: false });
  mconstruct(c, sx, gb, sw, 10, 8);
};

/** Mine: steel headframe over the shaft, winding house, ore heap, rails */
const mMine: MDrawer = (c, o) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  const gold = o.deposit === 'gold';
  pad(c, 'gravel', L + 1, F + 8, fw - 2, fw - 9, 3);
  blob(p, L + 10, G - 17, 10, 8, ROCK, c.seed + 1, -0.02);
  blob(p, L + 20, G - 20, 9, 6, ROCK, c.seed + 3, 0.06);
  if (gold) for (const [x, y] of [[L + 6, G - 18], [L + 13, G - 22], [L + 21, G - 21], [L + 17, G - 15]] as const) {
    p.px(x, y, GD[3]);
    p.px(x + 1, y, GD[4]);
    p.px(x, y + 1, GD[2]);
  }
  // winding house
  const wx = R - 14;
  const wy = box(c, { x: wx, gb: G - 9, w: 12, wh: 9, d: 7, mat: 'brick', field: 'metal', parapet: false });
  mwin(c, wx + 2, wy + 2, 3, 3, 'glass', CON[6]);
  mdoor(c, wx + 7, G - 14, 3, 6, 'steel');
  // headframe over the shaft collar
  const hx = L + 13;
  const hb = G - 7;
  const RF = c.dmg === 2 ? BURNT : RED;
  box(c, { x: hx - 6, gb: hb, w: 12, wh: 3, d: 4, mat: 'concrete', field: 'concrete', seams: 0 });
  if (c.con === 0) p.rect(hx - 3, hb - 5, 6, 2, DARK);
  if (c.con !== 1) {
    const top = c.dmg === 2 ? hb - 14 : c.con === 2 ? hb - 18 : hb - 28;
    p.line(hx - 5, hb - 3, hx - 1, top, RF[4]);
    p.line(hx + 5, hb - 3, hx + 1, top, RF[2]);
    p.line(hx + 11, hb - 1, hx + 1, top + 3, RF[3]);
    for (let yy = hb - 8; yy > top; yy -= 6) {
      const hw = Math.round(5 - ((hb - 3 - yy) / (hb - 3 - top)) * 4);
      p.hline(hx - hw, hx + hw, yy, RF[3]);
    }
    if (c.con === 0 && c.dmg < 2) {
      for (const wcx of [hx - 1, hx + 3]) {
        p.ellipse(wcx + 0.5, top - 0.5, 2.5, 2.5, M[2]);
        p.ellipse(wcx + 0.5, top - 0.5, 1.2, 1.2, M[5]);
      }
      p.hline(hx - 3, hx + 5, top + 2, RF[4]);
      baseLine(c, hx + 4, top, wx + 2, wy - 4, '#2a2428', 0.8);
      p.vline(hx - 2, top + 2, hb - 6, '#5a5048');
      p.rect(hx - 3, hb - 10, 3, 3, M[3]);
    }
  }
  // ore heap + rails + cart
  const OR = gold ? ['#4a3a20', '#6a5428', '#8a6c2a', GD[2], GD[3], GD[4]] : [...CON.slice(1, 7)];
  if (c.con === 0) blob(p, R - 6, G - 3, 4, 2.6, OR, c.seed + 7);
  if (c.con !== 1) {
    p.hline(L + 2, R - 12, G - 1, M[3]);
    p.hline(L + 2, R - 12, G - 3, M[4]);
    for (let x = L + 3; x < R - 12; x += 3) p.vline(x, G - 3, G - 1, W[2]);
  }
  oreCart(c, L + 4, G - 2, gold);
  oreCart(c, L + 12, G - 2, gold);
  if (c.con) {
    mscaffold(c, hx - 6, hb, 12, 10);
    msupplies(c);
  }
};

/** Market / Exchange: a parade of shops with awnings, a kiosk, crates and a van */
const mMarket: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'concrete', L + 2, F + 8, fw - 4, fw - 9, 2);
  const gb = G - 17;
  const shops: { mat: MWallMat; ramp?: R; aw: string; sign: R }[] = [
    { mat: 'render', ramp: RENDER, aw: '#c83a32', sign: GREENP },
    { mat: 'brick', aw: '#3a8a4a', sign: BLUEP },
    { mat: 'render', ramp: PINK, aw: '#2f6ab0', sign: RED },
  ];
  shops.forEach((sh, i) => {
    const x = L + 3 + i * 14;
    const w = 13;
    const wh = 13 + (i === 1 ? 2 : 0);
    const y = box(c, { x, gb, w, wh, d: 8, mat: sh.mat, ramp: sh.ramp, field: 'tar', plinth: 1 });
    shopWindow(c, x + 1, gb - 6, 7, 5);
    mdoor(c, x + 9, gb - 6, 3, 7, 'glass');
    mwin(c, x + 2, y + 2, 3, 2, 'blind', WH[5]);
    mwin(c, x + 8, y + 2, 3, 2, 'curtain', WH[5]);
    if (intact(c)) {
      stripe(c, x, gb - 9, w, sh.sign[3], 2);
      for (let k = x + 2; k < x + w - 2; k++) if (hash2(k, i, 5) < 0.55) p.px(k, gb - 8, CREAM);
    }
    mawning(c, x, gb - 7, w, 2, sh.aw);
    if (i === 1 && intact(c)) aerial(c, x + 9, y - 5, 6);
    if (i === 0 && intact(c)) acUnit(c, x + 3, y - 6);
  });
  // billboard on the middle roof
  if (intact(c)) {
    const bx = L + 19;
    const by = gb - 36;
    p.vline(bx + 1, by + 5, by + 9, M[3]);
    p.vline(bx + 9, by + 5, by + 9, M[2]);
    p.rect(bx, by, 11, 5, WH[4]);
    p.rect(bx + 1, by + 1, 4, 3, c.tc.main);
    p.hline(bx + 6, bx + 9, by + 1, '#c83a32');
    p.hline(bx + 6, bx + 8, by + 3, OUTL);
    p.vline(bx + 10, by, by + 4, WH[2]);
  }
  // kiosk
  const kx = c.ax - 4;
  const ky = box(c, { x: kx, gb: G - 3, w: 9, wh: 7, d: 5, mat: 'panel', ramp: GREENP, field: 'metal', parapet: false });
  if (intact(c)) {
    p.rect(kx + 1, ky + 1, 7, 3, '#2a2026');
    for (let i = 0; i < 5; i++) p.px(kx + 2 + i, ky + 2, ['#f0f0e8', '#e05a4a', '#f0d060', '#f0f0e8', '#6a8ad0'][i]);
    mawning(c, kx - 1, ky - 1, 11, 1, '#d8a020');
  }
  crate(c, L + 3, G - 2);
  crate(c, L + 7, G - 2);
  crate(c, L + 5, G - 6, 3);
  sack(c, L + 11, G - 2);
  vehicle(c, R - 15, G - 1, 'pickup', { dir: -1, ramp: WH, mark: false });
  streetLamp(c, kx - 4, G - 4, 12, -1);
  if (c.con) msupplies(c);
};

/** Barracks: a pair of olive Quonset huts, drill yard and flagpole */
const mBarracks: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'gravel', L + 2, F + 6, fw - 4, 26, 3);
  pad(c, 'asphalt', L + 2, G - 14, fw - 4, 13, 2);
  paintLine(c, L + 6, R - 7, G - 9, '#d8d2bc', 2);
  paintLine(c, L + 6, R - 7, G - 4, '#d8d2bc', 2);
  const huts: [number, number][] = [
    [L + 11, G - 17],
    [R - 12, G - 15],
  ];
  for (const [hx, hgb] of huts) {
    quonsetNS(c, hx, hgb, 8, 17, OL);
    mdoor(c, hx - 1, hgb - 5, 3, 6, 'steel');
    mwin(c, hx - 5, hgb - 5, 2, 2, 'glass', WH[4]);
    mwin(c, hx + 4, hgb - 5, 2, 2, 'glass', WH[4]);
    if (intact(c)) {
      p.px(hx, hgb - 8, c.tc.main);
      p.px(hx + 1, hgb - 8, c.tc.light);
      p.vline(hx + 4, hgb - 28, hgb - 24, M[3]);
      p.px(hx + 4, hgb - 29, M[5]);
    }
    if (c.con === 0) pad(c, 'concrete', hx - 3, hgb + 1, 6, 3, 1);
  }
  mflag(c, c.ax, G - 5, 22, c.tc, { w: 6, fh: 4, sym: true });
  if (intact(c)) for (const [dx, dy] of [[-2, 0], [2, 0], [0, 1], [-1, -1], [1, -1]] as const) c.base.px(c.ax + dx, G - 5 + dy, CREAM);
  sandbags(c, R - 12, R - 4, G - 2, 2);
  drums(c, L + 4, G - 1, 2, OL);
  if (c.con) {
    mscaffold(c, L + 3, G - 17, 19, c.con === 1 ? 6 : 12);
    msupplies(c);
  }
};

/** Firing Range: earth berm with silhouette targets, sandbag firing line, range hut */
const mRange: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'dirt', L + 14, F + 10, fw - 17, fw - 12, 3);
  if (c.con !== 1) berm(c, L + 12, R - 3, F + 15, 11);
  for (let i = 0; i < 4; i++) {
    const tx = L + 17 + i * 7;
    paintLineV(c, tx + 4, F + 25, G - 8, '#e8e2cc');
    silTarget(c, tx, F + 25);
  }
  // firing line
  for (let i = 0; i < 4; i++) sandbags(c, L + 15 + i * 7, L + 19 + i * 7, G - 6, 2);
  ammoBox(c, L + 16, G - 1, 5);
  ammoBox(c, L + 30, G - 1, 5);
  // range hut
  const hx = L + 3;
  const hy = box(c, { x: hx, gb: G - 4, w: 10, wh: 8, d: 6, mat: 'panel', ramp: OL, field: 'metal', parapet: false });
  mdoor(c, hx + 2, G - 9, 3, 6, 'steel');
  mwin(c, hx + 6, hy + 2, 3, 2, 'glass', OL[5]);
  if (intact(c)) {
    // red range flag (danger: live firing) + team flag on the hut
    p.vline(L + 6, F + 8, F + 24, M[4]);
    flagCloth(c, L + 7, F + 8, 5, 4, { main: '#c8282a', light: '#f0604a', dark: '#701818', symbol: 'circle' }, c.seed & 3);
    mflag(c, hx + 8, hy - 4, 9, c.tc, { w: 5, fh: 3 });
  }
  if (c.con) msupplies(c);
};

/** Motor Pool: block garage with roll-up doors, asphalt apron, truck and fuel drums */
const mMotorPool: MDrawer = (c) => {
  const { L, R, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  const x = L + 3;
  const w = fw - 6;
  const gb = G - 13;
  const wh = 12;
  const y = gb - wh + 1;
  const rh = 13;
  pad(c, 'asphalt', L + 2, y - rh + 4, fw - 4, G - (y - rh + 4) - 1, 2);
  for (const px of [L + 18, L + 30]) paintLineV(c, px, gb + 2, G - 3, YEL[4]);
  mwall(c, x, y, w, wh, 'block', { plinth: 1 });
  const doors = [x + 3, x + 16, x + 29];
  doors.forEach((dx, i) => {
    if (c.con === 0 && c.dmg < 2) {
      for (let ly = 0; ly < 9; ly++) {
        p.px(dx - 1, gb - ly, md(ly, 4) < 2 ? HZ[1] : HZ[0]);
        p.px(dx + 9, gb - ly, md(ly + 2, 4) < 2 ? HZ[1] : HZ[0]);
      }
    }
    mdoor(c, dx, gb - 8, 9, 9, i === 1 ? 'open' : 'roll');
  });
  if (intact(c)) {
    // jeep nose inside the open bay
    const jx = doors[1] + 2;
    p.rect(jx, gb - 3, 5, 3, OL[3]);
    p.hline(jx, jx + 4, gb - 3, OL[5]);
    p.px(jx + 1, gb - 2, CREAM);
    p.px(jx + 3, gb - 2, CREAM);
  }
  stripe(c, x, y + 1, w, c.tc.main);
  troofEW(c, x - 2, y - rh + 1, w + 4, rh, COR, { ridge: 0.3, rust: 0.15 });
  vehicle(c, R - 25, G - 1, 'truck', { dir: -1 });
  drums(c, L + 3, G - 1, 4, RED);
  if (intact(c)) {
    // fuel pump
    p.rect(L + 15, G - 7, 3, 6, RED[4]);
    p.vline(L + 15, G - 7, G - 2, RED[5]);
    p.rect(L + 15, G - 6, 2, 2, WH[5]);
    p.line(L + 18, G - 5, L + 20, G - 2, OUTL);
  }
  jerrycan(c, L + 21, G - 2);
  mconstruct(c, x, gb, w, wh, rh - 4);
};

/** Artillery Works: saw-tooth brick factory, chimney, yellow gantry crane, gun barrels */
const mArtillery: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const p = c.pc;
  pad(c, 'gravel', L + 2, F + 8, 44, 39, 3);
  const x = L + 3;
  const w = 32;
  const gb = G - 15;
  const wh = 12;
  const y = gb - wh + 1;
  stack(c, x + w - 7, y - 10, 30, 4);
  mwall(c, x, y, w, wh, 'brick', { plinth: 1 });
  winRow(c, x + 2, x + w - 3, y + 2, 2, 3, 'glass', 2, CON[6], (_i, wx) => wx > x + 6 && wx < x + 19);
  mdoor(c, x + 8, gb - 8, 10, 9, c.variant & 1 ? 'open' : 'roll');
  if (c.con === 0 && c.dmg < 2) hazard(c, x + 7, gb - 9, 12, 1);
  sawtooth(c, x, y - 1, w, 8, 6, 12);
  // gantry crane over the yard
  if (c.con !== 1 && c.dmg < 2) {
    const g0 = R - 13;
    const g1 = R - 3;
    const gt = G - 30;
    for (const gx of [g0, g1]) {
      for (let yy = gt; yy <= G - 3; yy++) {
        p.px(gx, yy, gx === g0 ? YEL[5] : YEL[3]);
        p.px(gx + 1, yy, gx === g0 ? YEL[3] : YEL[1]);
      }
      p.rect(gx - 1, G - 3, 4, 2, CON[4]);
    }
    p.hline(g0 - 4, g1 + 2, gt, YEL[5]);
    p.hline(g0 - 4, g1 + 2, gt + 1, YEL[3]);
    p.hline(g0 - 4, g1 + 2, gt + 2, YEL[1]);
    for (let i = g0 - 4; i <= g1 + 2; i += 3) p.px(i, gt + 1, YEL[1]);
    if (c.con === 0) {
      const hx2 = g0 + 5;
      p.rect(hx2 - 1, gt + 3, 3, 2, M[2]);
      p.vline(hx2, gt + 5, gt + 12, M[1]);
      // barrel slung from the hook
      p.hline(hx2 - 6, hx2 + 5, gt + 13, OL[5]);
      p.hline(hx2 - 6, hx2 + 5, gt + 14, OL[2]);
      p.px(hx2 + 5, gt + 13, M[2]);
      p.px(hx2 + 5, gt + 14, M[1]);
    }
  }
  gunRack(c, L + 5, G - 2, 15, 3);
  vehicle(c, c.ax - 1, G - 1, 'howitzer', { dir: -1 });
  ammoBox(c, R - 9, G - 1, 6);
  mconstruct(c, x, gb, w, wh, 12);
};

/** Armory: earth-covered concrete magazine with a blast door and ammo crates */
const mArmory: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'gravel', L + 2, F + 6, fw - 4, fw - 7, 3);
  const x = L + 5;
  const w = fw - 10;
  const gb = G - 7;
  // earth berms against the sides
  if (c.con !== 1) {
    berm(c, x - 3, x + 4, gb, 9);
    berm(c, x + w - 5, x + w + 2, gb, 9);
  }
  const y = box(c, { x, gb, w, wh: 11, d: 12, mat: 'bunker', field: 'grass', seams: 0, parapet: false });
  mdoor(c, c.ax - 3, gb - 7, 6, 8, 'blast');
  stripe(c, x, y + 1, w, c.tc.main);
  if (intact(c)) {
    // warning sign + red lamp + roof vents
    p.px(c.ax + 6, gb - 7, YEL[4]);
    p.hline(c.ax + 5, c.ax + 7, gb - 6, YEL[4]);
    p.hline(c.ax + 4, c.ax + 8, gb - 5, YEL[3]);
    p.px(c.ax + 6, gb - 6, OUTL);
    p.px(c.ax, gb - 10, WARN);
    for (const vx of [x + 5, x + w - 8]) {
      p.vline(vx, y - 9, y - 6, M[3]);
      p.hline(vx - 1, vx + 1, y - 10, M[5]);
    }
  }
  ammoStack(c, L + 3, G - 1);
  ammoBox(c, R - 10, G - 1, 7);
  drum(c, R - 4, G - 1, OL);
  mconstruct(c, x, gb, w, 11, 10);
};

/** Field Hospital: white ward tent with red crosses, prefab annex, stretchers */
const mHospital: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  const p = c.pc;
  pad(c, 'gravel', L + 2, F + 6, fw - 4, fw - 7, 3);
  const tcx = L + 12;
  const tgb = G - 6;
  tent(c, tcx, tgb, 9, 9, 13, WH[4], { door: true });
  if (intact(c)) {
    redCross(c, tcx - 4, tgb - 12, 3, false);
    p.vline(tcx, tgb - 24, tgb - 22, M[4]);
  }
  const ax0 = R - 12;
  const ay0 = box(c, { x: ax0, gb: G - 4, w: 10, wh: 9, d: 6, mat: 'panel', ramp: WH, field: 'metal', parapet: false });
  mdoor(c, ax0 + 1, G - 10, 3, 6, 'steel');
  mwin(c, ax0 + 6, ay0 + 2, 3, 2, 'frosted', WH[5]);
  redCross(c, ax0 + 7, ay0 + 6, 1);
  if (intact(c)) {
    // red cross flag + team flag
    p.vline(L + 3, F + 6, G - 2, M[4]);
    flagCloth(c, L + 4, F + 6, 5, 4, { main: WH[4], light: WH[5], dark: WH[2], symbol: 'circle' }, 1);
    p.px(L + 6, F + 7, RCROSS);
    p.hline(L + 5, L + 7, F + 8, RCROSS);
    p.px(L + 6, F + 9, RCROSS);
    mflag(c, ax0 + 8, ay0 - 4, 9, c.tc, { w: 4, fh: 3 });
  }
  stretcher(c, L + 4, G - 1);
  stretcher(c, c.ax + 1, G - 1);
  if (c.con) msupplies(c);
};

/** Contractor Camp: tents, shipping containers, pickup truck, campfire */
const mContractor: MDrawer = (c) => {
  const { L, R, F, G } = c;
  const fw = c.size * TILE;
  pad(c, 'dirt', L + 2, F + 6, fw - 4, fw - 7, 5);
  container(c, L + 3, F + 17, 16, TEAL);
  container(c, R - 20, F + 19, 17, ORANGE);
  tent(c, L + 11, F + 30, 7, 7, 8, TAN[3]);
  tent(c, R - 11, G - 14, 6, 7, 7, TARP[3]);
  campfire(c, c.ax - 2, G - 12);
  if (intact(c)) {
    // camp chairs
    c.pc.rect(c.ax - 9, G - 13, 3, 2, BLUEP[3]);
    c.pc.rect(c.ax + 4, G - 12, 3, 2, RED[3]);
  }
  generator(c, L + 3, G - 3);
  crate(c, L + 13, G - 2);
  drums(c, L + 18, G - 1, 2, BLUEP);
  vehicle(c, R - 18, G - 1, 'pickup', { dir: -1, ramp: TAN });
  mflag(c, c.ax + 3, G - 3, 20, c.tc, { w: 6, fh: 5, sym: true });
  if (c.con) msupplies(c);
};

const MDRAWERS: Record<string, MDrawer> = {
  capital_castle: mCapital,
  keep: mKeep,
  town_hall: mTownHall,
  village_hall: mVillageHall,
  outpost_tower: mOutpost,
  house: mHouse,
  farm: mFarm,
  lumber_camp: mLumber,
  mine: mMine,
  market: mMarket,
  barracks: mBarracks,
  archery_range: mRange,
  stable: mMotorPool,
  siege_workshop: mArtillery,
  blacksmith: mArmory,
  chapel: mHospital,
  watchtower: mWatchtower,
  merc_camp: mContractor,
};

const MTOP: Record<string, number> = {
  capital_castle: 84,
  keep: 72,
  town_hall: 56,
  outpost_tower: 72,
  watchtower: 52,
  siege_workshop: 52,
  mine: 48,
  farm: 44,
  chapel: 40,
  village_hall: 40,
  market: 44,
};

// ======================================================================================== API
/** modern-era building sprite (same anchor / footprint conventions as `drawBuilding`) */
export function drawModernBuilding(type: string, size: number, team: KingdomColor | null, state: BuildingState, opts: BuildingOpts = {}): BuildingSprite {
  const dmg = state === 'damaged' || state === 'ruined';
  if (type === 'wall') return drawModernWall('concrete', 2 | 8, false, team, dmg);
  if (type === 'gatehouse') return drawModernWall('concrete', 2 | 8, true, team, dmg);
  // old ruins, abbeys and standing stones still dot the modern valley
  if (type === 'landmark') return drawBuilding(type, size, team, state, opts);
  const variant = opts.variant ?? 0;
  const tier = opts.tier ?? 3;
  const c = makeCtx(size, MTOP[type] ?? 40, teamOf(team), state, variant, tier, type.length * 3 + 1);
  const fn = MDRAWERS[type] ?? mHouse;
  fn(c, opts);
  return finish(c);
}

/** 1×1 decorative modern home: bungalows and sheds; tier ≥ 3 two storeys, tier ≥ 4 flat-roofed urban */
export function drawModernCottage(variant: number, team: KingdomColor | null, tier: number): BuildingSprite {
  const c = makeCtx(1, 30, teamOf(team), 'built', variant, tier, 79);
  const { L, F, G } = c;
  const p = c.pc;
  const v = md(variant, 4);
  const two = tier >= 3;
  const flat = tier >= 4 ? v !== 1 : two && v === 3;
  pad(c, flat ? 'concrete' : 'grass', L + 1, F + 4, 14, 11, 2);
  const x = L + 2;
  const w = 12;
  const gb = G - 3;
  const wh = two ? 13 : 8;
  const y = gb - wh + 1;
  const mats: [MWallMat, R | undefined][] = [
    ['brick', undefined],
    ['render', RENDER],
    ['panel', two ? WH : GREENP],
    ['render', PINK],
  ];
  const [mat, ramp] = flat && v === 0 ? (['concrete', undefined] as [MWallMat, R | undefined]) : mats[v];
  if (flat) box(c, { x, gb, w, wh, d: 7, mat, ramp, field: v & 1 ? 'gravel' : 'tar', plinth: 1, seams: 0, floors: two ? 6 : 0 });
  else mwall(c, x, y, w, wh, mat, { ramp, plinth: 1 });
  const dx = x + (v & 1 ? 8 : 1);
  mdoor(c, dx, gb - 5, 3, 6, flat && v === 0 ? 'glass' : 'paint', [RED, GREENP, BLUEP, GREENP][v]);
  mwin(c, x + (v & 1 ? 2 : 6), gb - 5, 3, 3, v & 1 ? 'blind' : 'curtain', WH[5]);
  if (two) {
    mwin(c, x + 2, y + 2, 3, 3, 'glass', WH[5]);
    mwin(c, x + 7, y + 2, 3, 3, v & 1 ? 'lit' : 'curtain', WH[5]);
  }
  if (flat) {
    aerial(c, x + 9, y - 4, 6);
    if (v === 2) acUnit(c, x + 2, y - 6);
  } else {
    const rh = 10;
    if (v === 0 || v === 3) roofEW(c, x - 2, y - rh + 1, w + 4, rh, v === 0 ? 'slate' : 'tile', { ridge: 0.34 });
    else troofEW(c, x - 2, y - rh + 1, w + 4, rh, v === 1 ? RED : COR, { ridge: 0.34, rust: v === 2 ? 0.35 : 0.1 });
    if (v !== 2) chimneyM(c, x + (v & 1 ? 2 : 8), y - rh - 1, 5);
    aerial(c, x + (v & 1 ? 9 : 3), y - rh + 3, 6);
  }
  if (team && two) {
    const t = teamOf(team)!;
    p.vline(x - 1, y - 6, y + 1, M[4]);
    flagCloth(c, x, y - 6, 3, 2, t, variant & 3);
  }
  if (v === 0) flowers(c, x + 5, G - 2, 2);
  if (v === 2 && !two) bin(c, L + 12, G - 1);
  if (v === 3) bush(c, L + 13, G - 1, 2);
  return finish(c);
}

/**
 * 1-tile modern wall piece: precast concrete T-wall or sandbag line. mask bits 1=N 2=E 4=S 8=W
 * (same semantics and oblique layout as `drawWall`, so runs join when depth-sorted by ground
 * line). gate = a checkpoint with a red/white boom barrier.
 */
export function drawModernWall(kind: 'sandbag' | 'concrete', mask: number, gate: boolean, team: KingdomColor | null, damaged: boolean): BuildingSprite {
  const c = makeCtx(1, 26, teamOf(team), 'built', mask, 3, kind === 'concrete' ? 5 : 6);
  const p = c.pc;
  const ty = c.F;
  const tx = c.L;
  const N = !!(mask & 1);
  const E = !!(mask & 2);
  const Sd = !!(mask & 4);
  const Wd = !!(mask & 8);
  const ew = E || Wd || !(N || Sd);
  const brk = (k: number) => damaged && hash2(k, mask, 9) < 0.3;
  const thin = kind === 'concrete' ? 1 : 0;
  const x0 = tx + 5 + thin;
  const x1 = tx + 10 - thin;
  const gy0 = ty + 6 + thin;
  const gy1 = ty + 11 - thin;
  const road = (vertical: boolean) => {
    if (vertical) pad(c, 'asphalt', tx + 4, ty, 8, 16, 1);
    else pad(c, 'asphalt', tx, ty + 5, 16, 7, 1);
  };
  const barrier = (bx0: number, bx1: number, y: number) => {
    if (damaged) {
      p.line(bx0, y, bx0 + 4, y + 3, RED[3]);
      return;
    }
    for (let x = bx0; x <= bx1; x++) {
      p.px(x, y, md((x - bx0) >> 1, 2) ? RED[4] : WH[5]);
      p.px(x, y + 1, md((x - bx0) >> 1, 2) ? RED[2] : WH[3]);
    }
  };
  if (kind === 'concrete') {
    const Hh = 11;
    /** precast T-wall block: top strip + optional south face with panel joints */
    const blk = (ax0: number, ax1: number, ay0: number, ay1: number, front: boolean, hh = Hh) => {
      for (let y = ay0 - hh; y <= ay1 - hh; y++)
        for (let x = ax0; x <= ax1; x++) {
          if (y === ay0 - hh && brk(x)) continue;
          let col = rv(CON, 0.74 + (x === ax0 ? 0.1 : 0) + (x === ax1 ? -0.16 : 0) + (md(y, 4) === 0 && ay1 - ay0 > 3 ? -0.12 : 0));
          if (y === ay0 - hh && ay1 - ay0 <= 6) col = shade(col, -0.08);
          p.px(x, y, col);
        }
      if (!front) return;
      for (let y = ay1 - hh + 1; y <= ay1; y++)
        for (let x = ax0; x <= ax1; x++) {
          const ly = ay1 - y;
          const joint = md(x, 4) === 3;
          let col = rv(CON, 0.5 + (joint ? -0.18 : 0) + (ly === hh - 1 ? 0.22 : 0) + (ly < 2 ? -0.1 : 0) + (vnoise2(x, y, 4, 7) - 0.5) * 0.12, x, y, 0.4);
          if (x === ax0) col = shade(col, 0.08);
          if (x === ax1) col = shade(col, -0.16);
          p.px(x, y, col);
        }
    };
    const pillar = (x: number, gb: number, w: number, h: number) => {
      const cc: Ctx = { ...c, dmg: damaged ? 1 : 0 };
      const yy = box(cc, { x, gb, w, wh: h, d: 3, mat: 'concrete', field: 'concrete', seams: 0 });
      hazard(cc, x, yy + 3, w, 3);
      return yy;
    };
    if (gate && ew) {
      road(true);
      if (Wd) blk(tx, tx + 3, gy0, gy1, true);
      if (E) blk(tx + 12, tx + 15, gy0, gy1, true);
      const py = pillar(tx + 1, ty + 12, 4, Hh + 2);
      pillar(tx + 11, ty + 12, 4, Hh + 2);
      barrier(tx + 5, tx + 10, ty + 7);
      if (!damaged) p.rect(tx + 10, ty + 6, 1, 3, M[2]);
      mflag(c, tx + 2, py - 3, 8, c.tc, { w: 4, fh: 3, phase: mask & 3 });
    } else if (gate) {
      // guard booth straddling a N-S wall; road crosses E-W under a barrier
      road(false);
      if (N) blk(x0, x1, ty, ty + 2, false);
      const cc: Ctx = { ...c, dmg: damaged ? 1 : 0 };
      const by = box(cc, { x: tx + 3, gb: ty + 13, w: 9, wh: 10, d: 5, mat: 'panel', ramp: WH, field: 'metal', parapet: false });
      mwin(cc, tx + 5, by + 2, 5, 2, 'glass', WH[5]);
      mdoor(cc, tx + 6, ty + 9, 3, 5, 'steel');
      stripe(cc, tx + 3, by, 9, c.tc.main);
      if (!damaged) {
        for (let y = ty + 4; y <= ty + 12; y++) p.px(tx + 13, y - 4, md(y >> 1, 2) ? RED[4] : WH[5]);
        p.rect(tx + 12, ty + 9, 2, 3, M[2]);
      }
      if (Sd) blk(x0, x1, ty + 14, ty + 15, true);
    } else {
      if (N) blk(x0, x1, ty, gy0 - 1, false);
      if (Wd) blk(tx, x0 - 1, gy0, gy1, true);
      if (E) blk(x1 + 1, tx + 15, gy0, gy1, true);
      blk(x0, x1, gy0, gy1, true);
      if (Sd) blk(x0, x1, gy1 + 1, ty + 15, true);
    }
  } else {
    const Hh = 6;
    /** sandbag run: top surface of bags seen from above + stacked courses on the south face */
    const run = (ax0: number, ax1: number, ay0: number, ay1: number, front: boolean, hh = Hh) => {
      for (let y = ay0 - hh; y <= ay1 - hh; y++)
        for (let x = ax0; x <= ax1; x++) {
          if (brk(x * 3 + y)) continue;
          const ns = ay1 - ay0 > ax1 - ax0;
          const k = ns ? md(y + (x & 1), 3) : md(x + (y & 1) * 2, 4);
          let col = k === (ns ? 2 : 3) ? BAG[2] : rv(BAG, 0.72 + (y === ay0 - hh ? -0.1 : 0) + (x === ax0 ? 0.1 : x === ax1 ? -0.16 : 0));
          if (y === ay1 - hh && front) col = BAG[5];
          p.px(x, y, col);
        }
      if (front) sandbags({ ...c, dmg: damaged ? 2 : 0 }, ax0, ax1, ay1, Math.floor(hh / 2));
    };
    if (gate && ew) {
      road(true);
      if (Wd) run(tx, tx + 3, gy0, gy1, true);
      if (E) run(tx + 12, tx + 15, gy0, gy1, true);
      // sandbagged posts either side + barrier
      run(tx + 1, tx + 4, gy0 - 1, gy1 + 1, true, Hh + 2);
      run(tx + 11, tx + 14, gy0 - 1, gy1 + 1, true, Hh + 2);
      barrier(tx + 5, tx + 10, ty + 8);
      p.vline(tx + 2, ty - 1, ty + 4, M[4]);
      if (!damaged) flagCloth(c, tx + 3, ty - 1, 4, 3, c.tc, mask & 3);
    } else if (gate) {
      road(false);
      if (N) run(x0, x1, ty, ty + 2, false);
      run(x0 - 1, x1 + 1, ty + 3, ty + 5, true, Hh + 1);
      run(x0 - 1, x1 + 1, ty + 12, ty + 14, true, Hh + 1);
      if (!damaged) for (let y = ty + 6; y <= ty + 11; y++) p.px(x0 + 2, y - 4, md(y >> 1, 2) ? RED[4] : WH[5]);
      p.vline(x1 + 1, ty - 5, ty, M[4]);
      if (!damaged) flagCloth(c, x1 + 2, ty - 5, 4, 3, c.tc, mask & 3);
      if (Sd) run(x0, x1, ty + 15, ty + 15, true);
    } else {
      if (N) run(x0, x1, ty, gy0 - 1, false);
      if (Wd) run(tx, x0 - 1, gy0, gy1, true);
      if (E) run(x1 + 1, tx + 15, gy0, gy1, true);
      run(x0, x1, gy0, gy1, true);
      if (Sd) run(x0, x1, gy1 + 1, ty + 15, true);
    }
  }
  c.dmg = damaged ? 1 : 0;
  if (damaged) scorch(c, 1, 0.45);
  c.dmg = 0;
  return finish(c);
}

const RUB = CON.slice(1, 7);
/** destroyed modern building: concrete slabs, rebar, glass and a standing wall stub */
export function drawModernRubble(size: number, variant: number): BuildingSprite {
  const c = makeCtx(size, 12, null, 'ruined', variant, 3, 93);
  const { L, F, G } = c;
  const fw = size * TILE;
  const p = c.pc;
  pad(c, 'ash', L + 2, F + 3, fw - 4, fw - 5, 4);
  pad(c, 'gravel', L + 4, F + 6, fw - 8, fw - 10, 3);
  if (size >= 2) {
    const rc: Ctx = { ...c, dmg: 2 };
    mwall(rc, L + 3 + (variant & 1) * Math.round(fw * 0.42), G - 13, Math.round(fw * 0.42), 10, variant & 2 ? 'brick' : 'concrete');
  }
  const n = size * size * 3 + 2;
  for (let k = 0; k < n; k++) {
    const x = L + 3 + hash2(k, 1, c.seed + variant) * (fw - 6);
    const y = F + 5 + hash2(k, 2, c.seed + variant) * (fw - 8);
    const r = 1.4 + hash2(k, 3, c.seed) * (1.5 + size * 0.4);
    const roll = hash2(k, 4, c.seed + variant);
    if (roll < 0.56) blob(p, x, y, r, r * 0.7, RUB, k + variant);
    else if (roll < 0.74) {
      // tilted slab fragment
      const len = Math.round(3 + r * 2);
      for (let i = 0; i < len; i++) {
        const yy = Math.round(y - i * (k & 1 ? 0.4 : -0.3));
        p.px(x + i, yy, CON[5]);
        p.px(x + i, yy + 1, CON[3]);
        p.px(x + i, yy + 2, CON[1]);
      }
    } else if (roll < 0.82) {
      const len = 2 + r * 1.5;
      p.line(x, y, x + len, y - 1 - (k & 1) * 3, RU[3]);
    } else if (roll < 0.94) {
      p.line(x, y, x + 4 + r, y - 2, CHAR[3]);
      p.line(x, y + 1, x + 4 + r, y - 1, CHAR[1]);
    } else {
      const R0 = variant & 1 ? BR : COR;
      p.px(x, y, R0[3]);
      p.px(x + 1, y, R0[4]);
      p.px(x + 1, y + 1, R0[2]);
    }
  }
  // glass glints
  for (let k = 0; k < size * 3; k++) c.base.px(L + 4 + Math.floor(hash2(k, 9, c.seed) * (fw - 8)), F + 6 + Math.floor(hash2(9, k, c.seed) * (fw - 10)), GLASS_HI);
  c.dmg = 0;
  return finish(c);
}

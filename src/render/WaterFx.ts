import type Phaser from 'phaser';
import { fbm, hash2, valueNoise } from '../core/Random';
import { TILE } from '../data/constants';
import { T, type GameMap } from '../sim/map/GameMap';
import type { World } from '../sim/World';

/** tiles per cache chunk (independent of the terrain renderer's CHUNK) */
const CT = 16;
/** chunk size in world px */
const CS = CT * TILE;
/** px border around a chunk's pixel mask, for neighbour / normal / depth tests */
const B = 8;
/** pixel mask width (chunk + border both sides) */
const RW = CS + B * 2;
/** terrain snapshot margin (tiles) used to detect map edits; covers the ±19 px shore warp */
const SNAP_M = 3;
const SNAP_W = CT + SNAP_M * 2;

/** foam record: x, y, nx, ny, reach, phase */
const FS = 6;
/** ripple record: x, y, dx, dy, back, fwd, speed, period, phase, len (negative = dark ripple) */
const RS = 10;

const MAX_RECTS = 1500;
/** build at most this many ms of chunk caches per frame (always at least one chunk) */
const BUILD_MS = 4;

/** shore waves per second */
const FOAM_FREQ = 0.27;
/** fraction of a ripple's cycle during which it is visible */
const RIP_VIS = 0.62;

/** alpha levels per colour bucket (rects are batched per level to keep style changes few) */
const NA = 6;
const LIGHT_MAX = 0.7;
const DARK_MAX = 0.42;

const DAY_LIGHT = 0xe8f4ff;
const NIGHT_LIGHT = 0xa8c0ff;
const DAY_DARK = 0x1b335e;
const NIGHT_DARK = 0x111a36;

interface WaterChunk {
  foam: Float32Array;
  nFoam: number;
  rip: Float32Array;
  nRip: number;
  /** terrain around the chunk when it was built (255 = off map) */
  snap: Uint8Array;
}

const isWaterT = (t: number) => t === T.WATER || t === T.BRIDGE;

function lerpColor(a: number, b: number, k: number) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * k);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * k);
  const bl = Math.round(ab + ((b & 255) - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Render-only life on the water. Terrain is baked into static chunk canvases, so this draws a thin
 * animated layer over it: foam lapping in along the painted shoreline (phase-shifted along the coast
 * so waves visibly roll in), and short pale/dark ripple streaks drifting with the current and wind
 * over open water. At night the highlights cool toward moonlight and dim.
 *
 * The shoreline is found per pixel with the same domain warp the terrain painter uses, so foam
 * hugs the painted edge rather than the tile grid. Everything is cached lazily per 16×16-tile
 * chunk; per frame we only walk the cached arrays of visible chunks and batch 1 px rects into one
 * Graphics object.
 */
export class WaterFx {
  enabled = true;
  private g: Phaser.GameObjects.Graphics;
  private map: GameMap;
  private cw: number;
  private ch: number;
  private chunks: (WaterChunk | null)[];
  private version: number;
  private windS = 1;
  private shown = true;
  /** per bucket flat [x, y, w, h, ...]; buckets 0..NA-1 light, NA..2NA-1 dark */
  private buckets: number[][] = [];
  private rects = 0;
  private warpSeed: number;
  /** scratch buffers reused across chunk builds */
  private maskBuf = new Uint8Array(RW * RW);
  private satBuf = new Int32Array((RW + 1) * (RW + 1));

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private layer: Phaser.GameObjects.Layer,
  ) {
    this.map = world.map;
    this.cw = Math.ceil(this.map.w / CT);
    this.ch = Math.ceil(this.map.h / CT);
    this.chunks = new Array(this.cw * this.ch).fill(null);
    this.version = this.map.version;
    this.warpSeed = this.map.seed % 977;
    this.g = scene.make.graphics({}, false);
    layer.add(this.g);
    for (let k = 0; k < NA * 2; k++) this.buckets.push([]);
  }

  update(dt: number, time: number, view: { x0: number; y0: number; x1: number; y1: number }, zoom: number, wind: number, darkness: number) {
    const g = this.g;
    if (!this.enabled || zoom < 0.75) {
      if (this.shown) {
        g.clear();
        g.setVisible(false);
        this.shown = false;
      }
      return;
    }
    if (!this.shown) {
      g.setVisible(true);
      this.shown = true;
    }
    g.clear();
    this.windS += (wind - this.windS) * Math.min(1, dt * 0.8);
    if (this.map.version !== this.version) {
      this.version = this.map.version;
      this.invalidateChanged();
    }
    const reduced = zoom < 1.1;
    const cx0 = Math.max(0, Math.floor(view.x0 / CS));
    const cy0 = Math.max(0, Math.floor(view.y0 / CS));
    const cx1 = Math.min(this.cw - 1, Math.floor(view.x1 / CS));
    const cy1 = Math.min(this.ch - 1, Math.floor(view.y1 / CS));
    if (cx1 < cx0 || cy1 < cy0) return;
    // nearest chunks first so the rect cap trims the view's edges, not its middle
    const mx = (view.x0 + view.x1) / 2;
    const my = (view.y0 + view.y1) / 2;
    const order: number[] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) order.push(cy * this.cw + cx);
    const dist = (id: number) => {
      const dx = ((id % this.cw) + 0.5) * CS - mx;
      const dy = (Math.floor(id / this.cw) + 0.5) * CS - my;
      return dx * dx + dy * dy;
    };
    order.sort((a, b) => dist(a) - dist(b));
    // lazily build caches within a small time budget
    const t0 = performance.now();
    let built = 0;
    for (const id of order) {
      if (this.chunks[id]) continue;
      if (built > 0 && performance.now() - t0 > BUILD_MS) break;
      this.chunks[id] = this.build(id % this.cw, Math.floor(id / this.cw));
      built++;
    }
    // idle: warm one chunk in the ring just outside the view so panning rarely builds on demand
    if (!built) this.prefetch(cx0 - 1, cy0 - 1, cx1 + 1, cy1 + 1);
    for (const b of this.buckets) b.length = 0;
    this.rects = 0;
    const v = { x0: view.x0 - 6, y0: view.y0 - 6, x1: view.x1 + 6, y1: view.y1 + 6 };
    for (const id of order) {
      const c = this.chunks[id];
      if (!c || (c.nFoam === 0 && c.nRip === 0)) continue;
      this.drawFoam(c, time, v, reduced);
      if (this.rects >= MAX_RECTS) break;
      this.drawRipples(c, time, v, reduced);
      if (this.rects >= MAX_RECTS) break;
    }
    // flush buckets: moonlit highlights are cooler and dimmer
    const d = Math.max(0, Math.min(1, darkness));
    const light = lerpColor(DAY_LIGHT, NIGHT_LIGHT, d);
    const dark = lerpColor(DAY_DARK, NIGHT_DARK, d);
    const lightMul = (reduced ? 0.8 : 1) * (1 - 0.45 * d);
    const darkMul = 1 - 0.35 * d;
    for (let k = 0; k < NA * 2; k++) {
      const arr = this.buckets[k];
      if (!arr.length) continue;
      const isDark = k >= NA;
      const lvl = (k % NA) + 1;
      const a = isDark ? (lvl / NA) * DARK_MAX * darkMul : (lvl / NA) * LIGHT_MAX * lightMul;
      g.fillStyle(isDark ? dark : light, a);
      for (let i = 0; i < arr.length; i += 4) g.fillRect(arr[i], arr[i + 1], arr[i + 2], arr[i + 3]);
    }
  }

  private prefetch(x0: number, y0: number, x1: number, y1: number) {
    for (let cy = Math.max(0, y0); cy <= Math.min(this.ch - 1, y1); cy++)
      for (let cx = Math.max(0, x0); cx <= Math.min(this.cw - 1, x1); cx++) {
        const id = cy * this.cw + cx;
        if (this.chunks[id]) continue;
        this.chunks[id] = this.build(cx, cy);
        return;
      }
  }

  destroy() {
    this.g.destroy();
    this.chunks = [];
    this.buckets = [];
  }

  // ------------------------------------------------------------------ per-frame drawing

  /** queue a rect; merges with the previous rect of the same bucket when horizontally adjacent */
  private emit(dark: boolean, alpha: number, max: number, x: number, y: number, w: number) {
    const lvl = Math.round((alpha / max) * NA);
    if (lvl <= 0) return;
    const arr = this.buckets[(dark ? NA : 0) + Math.min(NA, lvl) - 1];
    const n = arr.length;
    if (n >= 4 && arr[n - 3] === y && arr[n - 4] + arr[n - 2] === x) {
      arr[n - 2] += w;
      return;
    }
    arr.push(x, y, w, 1);
    this.rects++;
  }

  /**
   * Shore lapping: each edge pixel carries a wave cycle. A broken pale line approaches from a few
   * px out, reaches the shore at full strength, then fades and pulls back a pixel. Phases vary
   * smoothly along the coast so the waves roll along it.
   */
  private drawFoam(c: WaterChunk, time: number, v: { x0: number; y0: number; x1: number; y1: number }, reduced: boolean) {
    const f = c.foam;
    for (let k = 0; k < c.nFoam; k++) {
      if (reduced && k & 1) continue;
      const o = k * FS;
      const x = f[o];
      const y = f[o + 1];
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const ph = time * FOAM_FREQ + f[o + 5];
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      // broken foam: a different set of dashes for every wave
      if (hash2(x >> 2, y >> 2, cyc * 7 + 3) > 0.68) continue;
      const reach = f[o + 4];
      let dd: number;
      let a: number;
      if (u < 0.62) {
        const p = u / 0.62;
        dd = 1 + Math.round((reach - 1) * (1 - p));
        a = 0.3 + 0.4 * p;
      } else {
        const p = (u - 0.62) / 0.38;
        dd = p > 0.45 && reach >= 2 ? 2 : 1;
        a = 0.7 * (1 - p);
      }
      const px = x + Math.round(f[o + 2] * dd);
      const py = y + Math.round(f[o + 3] * dd);
      this.emit(false, a, LIGHT_MAX, px, py, 1);
      if (this.rects >= MAX_RECTS) return;
    }
  }

  /** short streaks drifting with the current (and the wind on still water), fading in and out */
  private drawRipples(c: WaterChunk, time: number, v: { x0: number; y0: number; x1: number; y1: number }, reduced: boolean) {
    const r = c.rip;
    const windK = 0.75 + 0.25 * this.windS;
    for (let k = 0; k < c.nRip; k++) {
      if (reduced && k & 1) continue;
      const o = k * RS;
      const x = r[o];
      const y = r[o + 1];
      if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 30 || y > v.y1 + 30) continue;
      const len0 = r[o + 9];
      const isDark = len0 < 0;
      if (isDark && reduced) continue;
      const per = r[o + 7];
      const tc = time / per + r[o + 8];
      const n = Math.floor(tc);
      const u = tc - n;
      if (u >= RIP_VIS) continue;
      const q = u / RIP_VIS;
      const env = Math.sin(Math.PI * q);
      const back = r[o + 4];
      const fwd = r[o + 5];
      const speed = r[o + 6] * windK;
      const travel = speed * per * RIP_VIS;
      const span = back + fwd;
      const s0 = -back + hash2(x, y, n) * Math.max(0, span - travel);
      const s = Math.min(fwd, s0 + travel * q);
      const dx = r[o + 2];
      const dy = r[o + 3];
      const lat = Math.round((hash2(y, x, n + 911) - 0.5) * 2.4);
      const px = x + dx * s - dy * lat;
      const py = Math.round(y + dy * s + dx * lat);
      if (px < v.x0 || px > v.x1 || py < v.y0 || py > v.y1) continue;
      const len = Math.abs(len0);
      // pixel streak grows then shrinks with its fade
      const w = Math.max(1, Math.round(len * (0.45 + 0.55 * env)));
      const sx = Math.round(px - w / 2);
      if (isDark) {
        this.emit(true, DARK_MAX * env, DARK_MAX, sx, py, w);
        // a pale crest just above the trough
        if (w > 2) this.emit(false, 0.3 * env, LIGHT_MAX, sx + 1, py - 1, w - 2);
      } else {
        this.emit(false, (0.22 + 0.24 * hash2(x, y, 5)) * env, LIGHT_MAX, sx, py, w);
      }
      if (this.rects >= MAX_RECTS) return;
    }
  }

  // ------------------------------------------------------------------ cache

  private snapshot(cx: number, cy: number): Uint8Array {
    const m = this.map;
    const s = new Uint8Array(SNAP_W * SNAP_W);
    const tx0 = cx * CT - SNAP_M;
    const ty0 = cy * CT - SNAP_M;
    for (let y = 0; y < SNAP_W; y++)
      for (let x = 0; x < SNAP_W; x++) {
        const tx = tx0 + x;
        const ty = ty0 + y;
        s[y * SNAP_W + x] = tx < 0 || ty < 0 || tx >= m.w || ty >= m.h ? 255 : m.terrain[ty * m.w + tx];
      }
    return s;
  }

  /** the map changed somewhere: drop chunks whose surrounding terrain differs */
  private invalidateChanged() {
    for (let id = 0; id < this.chunks.length; id++) {
      const c = this.chunks[id];
      if (!c) continue;
      const now = this.snapshot(id % this.cw, Math.floor(id / this.cw));
      for (let k = 0; k < now.length; k++)
        if (now[k] !== c.snap[k]) {
          this.chunks[id] = null;
          break;
        }
    }
  }

  private build(cx: number, cy: number): WaterChunk {
    const m = this.map;
    const W = m.w;
    const H = m.h;
    const snap = this.snapshot(cx, cy);
    let any = false;
    for (let k = 0; k < snap.length; k++)
      if (snap[k] === T.WATER || snap[k] === T.BRIDGE) {
        any = true;
        break;
      }
    if (!any) return { foam: new Float32Array(0), nFoam: 0, rip: new Float32Array(0), nRip: 0, snap };

    const terr = m.terrain;
    const tAt = (tx: number, ty: number) => {
      if (tx < 0) tx = 0;
      if (ty < 0) ty = 0;
      if (tx >= W) tx = W - 1;
      if (ty >= H) ty = H - 1;
      return terr[ty * W + tx];
    };
    const rx0 = cx * CS - B;
    const ry0 = cy * CS - B;
    const wpx = W * TILE;
    const hpx = H * TILE;
    const mask = this.maskBuf;
    mask.fill(0);

    // ---- warp grid (mirrors terrainArt.buildFields), evaluated lazily per 4 px cell near shores
    const gx0 = Math.floor(rx0 / 4);
    const gy0 = Math.floor(ry0 / 4);
    const GW = RW / 4 + 3;
    const warpX = new Float32Array(GW * GW);
    const warpY = new Float32Array(GW * GW);
    const warpDone = new Uint8Array(GW * GW);
    const s = this.warpSeed;
    const ensureCells = (lgx0: number, lgy0: number, lgx1: number, lgy1: number) => {
      for (let y = lgy0; y <= lgy1; y++)
        for (let x = lgx0; x <= lgx1; x++) {
          const i = y * GW + x;
          if (warpDone[i]) continue;
          warpDone[i] = 1;
          const wx = (gx0 + x) * 4;
          const wy = (gy0 + y) * 4;
          warpX[i] = (fbm(wx / 30, wy / 30, 3, 501 + s) - 0.5) * 30 + (fbm(wx / 9, wy / 9, 2, 211 + s) - 0.5) * 8;
          warpY[i] = (fbm(wx / 30, wy / 30, 3, 733 + s) - 0.5) * 30 + (fbm(wx / 9, wy / 9, 2, 377 + s) - 0.5) * 8;
        }
    };

    // ---- water mask (painted material M_WATER, roads ignored)
    const tTx0 = Math.floor(rx0 / TILE);
    const tTy0 = Math.floor(ry0 / TILE);
    const tTx1 = Math.floor((rx0 + RW - 1) / TILE);
    const tTy1 = Math.floor((ry0 + RW - 1) / TILE);
    for (let ty = tTy0; ty <= tTy1; ty++) {
      for (let tx = tTx0; tx <= tTx1; tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue; // off map: land
        // the warp moves samples < 20 px, so a tile whose 5×5 neighbourhood agrees is uniform
        let nW = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isWaterT(tAt(tx + dx, ty + dy))) nW++;
        const px0 = Math.max(rx0, tx * TILE);
        const py0 = Math.max(ry0, ty * TILE);
        const px1 = Math.min(rx0 + RW, (tx + 1) * TILE);
        const py1 = Math.min(ry0 + RW, (ty + 1) * TILE);
        if (nW === 0) continue;
        if (nW === 25) {
          for (let py = py0; py < py1; py++) mask.fill(1, (py - ry0) * RW + (px0 - rx0), (py - ry0) * RW + (px1 - rx0));
          continue;
        }
        ensureCells(Math.floor(px0 / 4) - gx0, Math.floor(py0 / 4) - gy0, Math.floor((px1 - 1) / 4) - gx0 + 1, Math.floor((py1 - 1) / 4) - gy0 + 1);
        const t0 = terr[ty * W + tx];
        const amp = t0 === T.FARMLAND ? 0.12 : t0 === T.SHALLOW ? 0.3 : 1;
        for (let py = py0; py < py1; py++) {
          const fy = py / 4;
          const yi = Math.floor(fy);
          const yf = fy - yi;
          for (let px = px0; px < px1; px++) {
            // bilinear, exactly as terrainArt.sampleField
            const fx = px / 4;
            const xi = Math.floor(fx);
            const xf = fx - xi;
            const i = (yi - gy0) * GW + (xi - gx0);
            const ddx = (warpX[i] * (1 - xf) + warpX[i + 1] * xf) * (1 - yf) + (warpX[i + GW] * (1 - xf) + warpX[i + GW + 1] * xf) * yf;
            const ddy = (warpY[i] * (1 - xf) + warpY[i + 1] * xf) * (1 - yf) + (warpY[i + GW] * (1 - xf) + warpY[i + GW + 1] * xf) * yf;
            let t1: number = tAt(Math.floor((px + ddx * amp) / TILE), Math.floor((py + ddy * amp) / TILE));
            if (t1 === T.FARMLAND && t0 !== T.FARMLAND) t1 = t0;
            else if (t0 === T.FARMLAND) t1 = T.FARMLAND;
            if (isWaterT(t1)) mask[(py - ry0) * RW + (px - rx0)] = 1;
          }
        }
      }
    }

    // ---- tiles where effects would land on a bridge deck or a road
    const excluded = (wx: number, wy: number) => {
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      if (tAt(tx, ty) === T.ROAD) return true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tAt(tx + dx, ty + dy) === T.BRIDGE) return true;
      return false;
    };
    const exclCache = new Int8Array((CT + 2) * (CT + 2)).fill(-1);
    const isExcl = (wx: number, wy: number) => {
      const lx = Math.floor(wx / TILE) - cx * CT + 1;
      const ly = Math.floor(wy / TILE) - cy * CT + 1;
      if (lx < 0 || ly < 0 || lx >= CT + 2 || ly >= CT + 2) return excluded(wx, wy);
      const i = ly * (CT + 2) + lx;
      if (exclCache[i] < 0) exclCache[i] = excluded(wx, wy) ? 1 : 0;
      return exclCache[i] === 1;
    };
    const water = (lx: number, ly: number) => lx >= 0 && ly >= 0 && lx < RW && ly < RW && mask[ly * RW + lx] === 1;

    // ---- shore foam: water pixels touching land, with an inward normal and how far in we may draw
    const foam: number[] = [];
    for (let ly = B; ly < B + CS; ly++) {
      for (let lx = B; lx < B + CS; lx++) {
        if (!mask[ly * RW + lx]) continue;
        if (water(lx - 1, ly) && water(lx + 1, ly) && water(lx, ly - 1) && water(lx, ly + 1)) continue;
        const wx = rx0 + lx;
        const wy = ry0 + ly;
        if (wx >= wpx || wy >= hpx || isExcl(wx, wy)) continue;
        let sx = 0;
        let sy = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (!water(lx + dx, ly + dy)) continue;
            sx += dx;
            sy += dy;
          }
        const l = Math.hypot(sx, sy);
        if (l < 0.5) continue;
        const nx = sx / l;
        const ny = sy / l;
        let reach = 0;
        for (let k = 1; k <= 4; k++) {
          if (!water(lx + Math.round(nx * k), ly + Math.round(ny * k))) break;
          reach = k;
        }
        if (reach < 1) continue;
        const phase = wx * 0.017 + wy * 0.011 + valueNoise(wx / 36, wy / 36, 77) * 1.4;
        foam.push(wx, wy, nx, ny, reach, phase);
      }
    }

    // ---- ripple seeds on open water (summed-area table for "all water within r px")
    const sat = this.satBuf;
    for (let y = 0; y < RW; y++) {
      let row = 0;
      for (let x = 0; x < RW; x++) {
        row += mask[y * RW + x];
        sat[(y + 1) * (RW + 1) + x + 1] = sat[y * (RW + 1) + x + 1] + row;
      }
    }
    const deep = (lx: number, ly: number, r: number) => {
      const x0 = lx - r;
      const y0 = ly - r;
      const x1 = lx + r + 1;
      const y1 = ly + r + 1;
      if (x0 < 0 || y0 < 0 || x1 > RW || y1 > RW) return false;
      const n = sat[y1 * (RW + 1) + x1] - sat[y0 * (RW + 1) + x1] - sat[y1 * (RW + 1) + x0] + sat[y0 * (RW + 1) + x0];
      return n === (2 * r + 1) * (2 * r + 1);
    };
    // local current: the long axis of nearby water tiles, signed consistently "downstream"
    const flowCache = new Map<number, [number, number, number]>();
    const flowAt = (tx: number, ty: number): [number, number, number] => {
      const key = ty * W + tx;
      const hit = flowCache.get(key);
      if (hit) return hit;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dy * dy > 18 || !isWaterT(tAt(tx + dx, ty + dy))) continue;
          sxx += dx * dx;
          syy += dy * dy;
          sxy += dx * dy;
        }
      const tr = sxx + syy || 1;
      const aniso = Math.min(1, Math.sqrt((sxx - syy) * (sxx - syy) + 4 * sxy * sxy) / tr);
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let fx = Math.cos(th);
      let fy = Math.sin(th);
      if (fx * -0.33 + fy * 0.94 < 0) {
        fx = -fx;
        fy = -fy;
      }
      // rivers follow their channel; still water drifts east with the wind
      const vx = fx * aniso * 1.6 + (1 - aniso) * 0.6;
      const vy = fy * aniso * 1.6;
      const vl = Math.hypot(vx, vy) || 1;
      const res: [number, number, number] = [vx / vl, vy / vl, aniso];
      flowCache.set(key, res);
      return res;
    };
    const rip: number[] = [];
    const CELL = 12;
    for (let gy = 0; gy < CS; gy += CELL) {
      for (let gx = 0; gx < CS; gx += CELL) {
        const wx0 = cx * CS + gx;
        const wy0 = cy * CS + gy;
        const lx = B + gx + Math.floor(hash2(wx0, wy0, 41) * CELL);
        const ly = B + gy + Math.floor(hash2(wx0, wy0, 42) * CELL);
        if (lx >= B + CS || ly >= B + CS) continue;
        const wx = rx0 + lx;
        const wy = ry0 + ly;
        if (wx >= wpx || wy >= hpx) continue;
        if (!deep(lx, ly, 3) || isExcl(wx, wy)) continue;
        const [dx, dy, aniso] = flowAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
        const along = (dir: number, max: number) => {
          let k = 0;
          for (let j = 1; j <= max; j++) {
            const qx = wx + dx * j * dir;
            const qy = wy + dy * j * dir;
            if (!deep(Math.round(qx) - rx0, Math.round(qy) - ry0, 2) || isExcl(qx, qy)) break;
            k = j;
          }
          return k;
        };
        const fwd = along(1, 28);
        const back = along(-1, 16);
        if (fwd + back < 6) continue;
        const h = hash2(wx, wy, 43);
        const speed = (2 + 6 * aniso) * (0.8 + 0.4 * hash2(wx, wy, 44));
        const period = 2.4 + 2.2 * hash2(wx, wy, 45);
        const dark = h < 0.22;
        const len = dark ? 3 + Math.floor(hash2(wx, wy, 46) * 3) : 2 + Math.floor(hash2(wx, wy, 46) * 3);
        rip.push(wx, wy, dx, dy, back, fwd, speed, period, hash2(wx, wy, 47), dark ? -len : len);
      }
    }
    return { foam: new Float32Array(foam), nFoam: foam.length / FS, rip: new Float32Array(rip), nRip: rip.length / RS, snap };
  }
}

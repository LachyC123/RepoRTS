import Phaser from 'phaser';
import { canvasTexture } from './texUtil';
import { NEUTRAL, TILE } from '../data/constants';
import { NEUTRAL_COLOR } from '../data/factions';
import type { World } from '../sim/World';
import { rgb } from './art/PixelCanvas';
import { hash2 } from '../core/Random';
import { art } from './art/ArtRegistry';
import { T } from '../sim/map/GameMap';
import type { SortObj, YSortLayer } from './YSortLayer';

const PX = 8; // canvas pixels per tile
const SUB = 4; // smoothed membership cells per tile (each 2×2 canvas pixels)

/**
 * Territory shown the way the brief asks: a faint wash of the owner's colour plus a fine dashed
 * border line on the owner's side, crisp pixel-art at close zoom and stronger at strategic zoom.
 * Redrawn per region only when ownership changes; a pulse highlights freshly captured regions.
 */
export class TerritoryRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: Phaser.GameObjects.Image;
  private key = 'territory_overlay';
  private owners: number[] = [];
  private pulses: { region: number; t: number; color: string }[] = [];
  private pulseGfx: Phaser.GameObjects.Graphics;
  /** strong low-res wash for the strategic view */
  private strat: HTMLCanvasElement;
  private stratImg: Phaser.GameObjects.Image;
  /** tiles per region for pulse drawing */
  private regionTiles: number[][] = [];
  symbols = false;
  /** border posts per region */
  private posts = new Map<number, { obj: SortObj; color: string; pop: number }[]>();
  ylayer: YSortLayer | null = null;
  private postT = 0;
  private sub!: Uint16Array;
  private subW = 0;
  private subH = 0;
  /** per-region canvas-pixel bounding boxes [x0, y0, x1, y1] */
  private bbox: number[][] = [];
  private img32: ImageData;
  private px32: Uint32Array;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    layer: Phaser.GameObjects.Layer,
  ) {
    const m = world.map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = m.w * PX;
    this.canvas.height = m.h * PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.img32 = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    this.px32 = new Uint32Array(this.img32.data.buffer);
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
    canvasTexture(scene, this.key, this.canvas);
    this.img = scene.make.image({ x: 0, y: 0, key: this.key }, false).setOrigin(0, 0).setScale(TILE / PX);
    layer.add(this.img);
    this.strat = document.createElement('canvas');
    this.strat.width = m.w;
    this.strat.height = m.h;
    canvasTexture(scene, 'territory_strat', this.strat);
    scene.textures.get('territory_strat').setFilter(0); // LINEAR: soft edges at strategic zoom
    this.stratImg = scene.make.image({ x: 0, y: 0, key: 'territory_strat' }, false).setOrigin(0, 0).setScale(TILE).setAlpha(0);
    layer.add(this.stratImg);
    this.pulseGfx = scene.make.graphics({}, false);
    layer.add(this.pulseGfx);
    for (let r = 0; r < m.regions.length; r++) this.regionTiles.push([]);
    for (let i = 0; i < m.w * m.h; i++) this.regionTiles[m.region[i]].push(i);
    this.buildSubRegions();
    this.redrawAll();
    world.events.on('regionCaptured', (e) => {
      const f = world.factions[e.to];
      this.pulses.push({ region: e.regionId, t: 0, color: (f?.color ?? NEUTRAL_COLOR).light });
      this.redrawRegion(e.regionId, true);
      const r = world.map.regions[e.regionId];
      for (const id of [e.regionId, ...r.neighbors]) this.rebuildPosts(id);
    });
    world.events.on('factionEliminated', () => this.redrawAll());
  }

  private colorOf(owner: number) {
    if (owner === NEUTRAL) return null;
    return this.world.factions[owner]?.color ?? NEUTRAL_COLOR;
  }

  redrawAll() {
    for (const st of this.world.settlements) this.owners[st.id] = st.owner;
    for (const st of this.world.settlements) this.paintRegion(st.id);
    this.ctx.putImageData(this.img32, 0, 0);
    this.refresh();
  }

  private refresh() {
    this.scene.textures.get(this.key).source[0].update();
    // strategic wash
    const w = this.world;
    const m = w.map;
    const ctx = this.strat.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const cols = w.settlements.map((s) => (s.owner === NEUTRAL ? null : rgb(w.factions[s.owner].color.main)));
    for (let i = 0; i < m.w * m.h; i++) {
      const c = cols[m.region[i]];
      if (!c) continue;
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 120;
    }
    ctx.putImageData(img, 0, 0);
    this.scene.textures.get('territory_strat').source[0].update();
  }

  redrawRegion(rid: number, refresh: boolean) {
    const w = this.world;
    const m = w.map;
    this.owners[rid] = w.settlements[rid].owner;
    // the region and its neighbours (their border lines depend on who owns this one)
    const ids = [rid, ...m.regions[rid].neighbors];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      this.paintRegion(id);
      const b = this.bbox[id];
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    this.ctx.putImageData(this.img32, 0, 0, x0, y0, x1 - x0, y1 - y0);
    if (refresh) this.refresh();
  }

  /**
   * Region membership at sub-tile resolution: each cell takes the region with the most weight
   * among nearby tile centres, so borders follow smooth diagonals and curves instead of tile
   * staircases. Computed once; regions never change shape.
   */
  private buildSubRegions() {
    const m = this.world.map;
    const W = m.w * SUB;
    const H = m.h * SUB;
    const sub = new Uint16Array(W * H);
    const wts = new Float32Array(m.regions.length);
    const touched: number[] = [];
    const R = 1.25; // vote radius in tiles
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / SUB;
      const ty = Math.floor(v);
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / SUB;
        const tx = Math.floor(u);
        const home = m.region[ty * m.w + tx];
        let best = home;
        let uniform = true;
        for (let oy = -1; oy <= 1 && uniform; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const nx = tx + ox;
            const ny = ty + oy;
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            if (m.region[ny * m.w + nx] !== home) {
              uniform = false;
              break;
            }
          }
        if (!uniform) {
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const nx = tx + ox;
              const ny = ty + oy;
              if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
              const d = Math.hypot(nx + 0.5 - u, ny + 0.5 - v);
              if (d >= R) continue;
              const r = m.region[ny * m.w + nx];
              if (wts[r] === 0) touched.push(r);
              const k = 1 - d / R;
              wts[r] += k * k;
            }
          let bw = wts[home] + 1e-4; // ties keep the tile's own region
          for (const r of touched) if (wts[r] > bw) {
            bw = wts[r];
            best = r;
          }
          for (const r of touched) wts[r] = 0;
          touched.length = 0;
        }
        sub[y * W + x] = best;
      }
    }
    this.sub = sub;
    this.subW = W;
    this.subH = H;
    for (let r = 0; r < m.regions.length; r++) this.bbox.push([Infinity, Infinity, -Infinity, -Infinity]);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const b = this.bbox[sub[y * W + x]];
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x + 1 > b[2]) b[2] = x + 1;
        if (y + 1 > b[3]) b[3] = y + 1;
      }
    // bboxes in canvas pixels
    for (const b of this.bbox) for (let k = 0; k < 4; k++) b[k] *= PX / SUB;
  }

  private paintRegion(rid: number) {
    const own = this.owners;
    const sub = this.sub;
    const W = this.subW;
    const H = this.subH;
    const px = this.px32;
    const CW = this.canvas.width;
    const owner = own[rid];
    const col = this.colorOf(owner);
    const pack = (c: [number, number, number], a: number) => ((Math.round(a * 255) << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
    let wash = 0;
    let line = 0;
    let dark = 0;
    let glow = 0;
    let faint = 0;
    if (col) {
      const main = rgb(col.main) as [number, number, number];
      const dk = rgb(col.dark) as [number, number, number];
      wash = pack(main, 0.11);
      line = pack(main, 0.85);
      dark = pack(dk, 0.55);
      glow = pack(main, 0.23);
    } else faint = pack([30, 24, 30], 0.3);
    // a cell differs if its region has another owner (owned) or is another region (neutral lines)
    const differs = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const r = sub[y * W + x];
      if (r === rid) return false;
      return col ? own[r] !== owner : true;
    };
    const b = this.bbox[rid];
    const S = PX / SUB;
    const sx0 = b[0] / S;
    const sy0 = b[1] / S;
    const sx1 = b[2] / S;
    const sy1 = b[3] / S;
    for (let y = sy0; y < sy1; y++)
      for (let x = sx0; x < sx1; x++) {
        if (sub[y * W + x] !== rid) continue;
        let c = 0;
        if (col) {
          // distance to the nearest foreign cell picks line → dark rim → glow → plain wash
          if (differs(x + 1, y) || differs(x - 1, y) || differs(x, y + 1) || differs(x, y - 1)) c = line;
          else if (differs(x + 1, y + 1) || differs(x - 1, y - 1) || differs(x + 1, y - 1) || differs(x - 1, y + 1) || differs(x + 2, y) || differs(x - 2, y) || differs(x, y + 2) || differs(x, y - 2)) c = dark;
          else if (differs(x + 3, y) || differs(x - 3, y) || differs(x, y + 3) || differs(x, y - 3) || differs(x + 2, y + 2) || differs(x - 2, y - 2) || differs(x + 2, y - 2) || differs(x - 2, y + 2)) c = glow;
          else c = wash;
        } else if (((x + y) >> 1) % 2 === 0 && (differs(x + 1, y) || differs(x, y + 1))) c = faint;
        // each sub cell covers S×S canvas pixels
        const o = y * S * CW + x * S;
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) px[o + yy * CW + xx] = c;
      }
  }

  /** bitmask of edges where the neighbour belongs to another owner (or region when !ownerOnly) */
  private edges(tx: number, ty: number, rid: number, ownerOnly: boolean) {
    const m = this.world.map;
    const owner = this.world.settlements[rid].owner;
    let e = 0;
    const check = (x: number, y: number, bit: number) => {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
      const o = m.region[y * m.w + x];
      if (o === rid) return;
      if (ownerOnly) {
        if (this.world.settlements[o].owner !== owner) e |= bit;
      } else if (o > rid || this.world.settlements[o].owner === NEUTRAL) e |= bit;
    };
    check(tx, ty - 1, 1);
    check(tx + 1, ty, 2);
    check(tx, ty + 1, 4);
    check(tx - 1, ty, 8);
    return e;
  }

  /** small banner posts along borders between different owners, on the owner's side */
  rebuildPosts(rid: number) {
    if (!this.ylayer) return;
    const old = this.posts.get(rid);
    if (old) for (const p of old) {
      this.ylayer.remove(p.obj);
      p.obj.destroy();
    }
    this.posts.delete(rid);
    const w = this.world;
    const m = w.map;
    const owner = w.settlements[rid].owner;
    if (owner === NEUTRAL) return;
    const col = w.factions[owner].color.id;
    const list: { obj: SortObj; color: string; pop: number }[] = [];
    for (const i of m.regions[rid].border) {
      // border list only has tiles bordering east/south neighbours; also check west/north from the other side
      void i;
    }
    let placed: number[] = [];
    for (const i of this.regionTiles[rid]) {
      const tx = i % m.w;
      const ty = Math.floor(i / m.w);
      const e = this.edges(tx, ty, rid, true);
      if (!e) continue;
      if (hash2(tx, ty, 61) > 0.22) continue;
      const t = m.terrain[i];
      if (t === T.WATER || t === T.ROCK || m.tree[i] || m.occ[i] || m.ore[i] || t === T.ROAD || t === T.BRIDGE) continue;
      if (placed.some((p) => Math.abs((p % m.w) - tx) + Math.abs(Math.floor(p / m.w) - ty) < 5)) continue;
      placed.push(i);
      const f = art.tryGet(`post/${col}/0/${this.symbols ? 1 : 0}`);
      if (!f) continue;
      const o = this.scene.make.image({ x: tx * TILE + 8, y: ty * TILE + 13, key: f.key, frame: f.frame }, false) as SortObj;
      o.setOrigin(f.ox, f.oy);
      o.sy = ty * TILE + 13;
      o.setScale(0.01);
      this.ylayer.add(o);
      list.push({ obj: o, color: col, pop: 0 });
    }
    placed = [];
    this.posts.set(rid, list);
  }

  rebuildAllPosts() {
    for (const s of this.world.settlements) this.rebuildPosts(s.id);
  }

  update(dt: number, zoom: number) {
    // posts pop in and wave
    this.postT += dt;
    const fr = Math.floor(this.postT * 3) % 2;
    const showPosts = zoom >= 1;
    for (const list of this.posts.values()) {
      for (const p of list) {
        if (p.pop < 1) {
          p.pop = Math.min(1, p.pop + dt * 3);
          const k = p.pop;
          p.obj.setScale(k < 0.7 ? k * 1.5 : 1.05 - (k - 0.7) * 0.17);
        }
        p.obj.setVisible(showPosts);
        const f = art.tryGet(`post/${p.color}/${(fr + (p.obj.x | 0)) % 2}/${this.symbols ? 1 : 0}`);
        if (f && p.obj.frame.name !== f.frame) p.obj.setTexture(f.key, f.frame);
      }
    }
    // stronger at strategic zoom, subtle up close
    const a = zoom < 0.9 ? 1 : zoom < 1.6 ? 0.85 : 0.65;
    this.img.setAlpha(a);
    const sa = zoom < 0.7 ? 0.75 : zoom < 1.1 ? ((1.1 - zoom) / 0.4) * 0.75 : 0;
    this.stratImg.setAlpha(sa);
    const g = this.pulseGfx;
    g.clear();
    const m = this.world.map;
    for (const p of this.pulses) {
      p.t += dt;
      const k = p.t / 1.6;
      if (k >= 1) continue;
      const c = Phaser.Display.Color.HexStringToColor(p.color).color;
      const alpha = 0.32 * (1 - k) * (0.6 + 0.4 * Math.sin(p.t * 12));
      g.fillStyle(c, alpha);
      for (const i of this.regionTiles[p.region]) g.fillRect((i % m.w) * TILE, Math.floor(i / m.w) * TILE, TILE, TILE);
    }
    this.pulses = this.pulses.filter((p) => p.t < 1.6);
  }
}

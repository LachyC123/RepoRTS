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
  /** tiles per region for pulse drawing */
  private regionTiles: number[][] = [];
  symbols = false;
  /** border posts per region */
  private posts = new Map<number, { obj: SortObj; color: string; pop: number }[]>();
  ylayer: YSortLayer | null = null;
  private postT = 0;

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
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
    canvasTexture(scene, this.key, this.canvas);
    this.img = scene.make.image({ x: 0, y: 0, key: this.key }, false).setOrigin(0, 0).setScale(TILE / PX);
    layer.add(this.img);
    this.pulseGfx = scene.make.graphics({}, false);
    layer.add(this.pulseGfx);
    for (let r = 0; r < m.regions.length; r++) this.regionTiles.push([]);
    for (let i = 0; i < m.w * m.h; i++) this.regionTiles[m.region[i]].push(i);
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
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.world.settlements) this.redrawRegion(s.id, false);
    this.refresh();
  }

  private refresh() {
    this.scene.textures.get(this.key).source[0].update();
  }

  redrawRegion(rid: number, refresh: boolean) {
    const w = this.world;
    const m = w.map;
    const ctx = this.ctx;
    const owner = w.settlements[rid].owner;
    this.owners[rid] = owner;
    const r = m.regions[rid];
    // clear region bbox tiles belonging to this region (+ neighbours' borders get redrawn below)
    const toRedraw = new Set<number>([rid, ...r.neighbors]);
    for (const id of toRedraw) {
      for (const i of this.regionTiles[id]) ctx.clearRect((i % m.w) * PX, Math.floor(i / m.w) * PX, PX, PX);
    }
    for (const id of toRedraw) this.paintRegion(id);
    if (refresh) this.refresh();
  }

  private paintRegion(rid: number) {
    const w = this.world;
    const m = w.map;
    const ctx = this.ctx;
    const owner = w.settlements[rid].owner;
    const col = this.colorOf(owner);
    if (!col) {
      // neutral: just a faint dotted boundary
      ctx.fillStyle = 'rgba(30,24,30,0.28)';
      for (const i of this.regionTiles[rid]) {
        const tx = i % m.w;
        const ty = Math.floor(i / m.w);
        const edges = this.edges(tx, ty, rid, false);
        if (!edges) continue;
        this.drawEdges(tx, ty, edges, true);
      }
      return;
    }
    const [r, g, b] = rgb(col.main);
    const [dr, dg, db] = rgb(col.dark);
    ctx.fillStyle = `rgba(${r},${g},${b},0.11)`;
    for (const i of this.regionTiles[rid]) ctx.fillRect((i % m.w) * PX, Math.floor(i / m.w) * PX, PX, PX);
    // border dashes against other owners (owner side), dark edge for depth
    for (const i of this.regionTiles[rid]) {
      const tx = i % m.w;
      const ty = Math.floor(i / m.w);
      const edges = this.edges(tx, ty, rid, true);
      if (!edges) continue;
      ctx.fillStyle = `rgba(${dr},${dg},${db},0.55)`;
      this.drawEdges(tx, ty, edges, false, 1);
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      this.drawEdges(tx, ty, edges, true, 0);
      // inner glow band
      ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
      this.drawEdges(tx, ty, edges, false, 2, 2);
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

  private drawEdges(tx: number, ty: number, e: number, dashed: boolean, inset = 0, thick = 1) {
    const ctx = this.ctx;
    const x = tx * PX;
    const y = ty * PX;
    for (let k = 0; k < PX; k++) {
      if (dashed && ((tx * PX + ty * PX + k) >> 1) % 2 === 1) continue;
      if (e & 1) ctx.fillRect(x + k, y + inset, 1, thick);
      if (e & 4) ctx.fillRect(x + k, y + PX - 1 - inset - (thick - 1), 1, thick);
      if (e & 8) ctx.fillRect(x + inset, y + k, thick, 1);
      if (e & 2) ctx.fillRect(x + PX - 1 - inset - (thick - 1), y + k, thick, 1);
    }
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

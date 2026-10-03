import Phaser from 'phaser';
import { canvasTexture } from './texUtil';
import { TILE } from '../data/constants';
import { CHUNK, type GameMap } from '../sim/map/GameMap';
import { buildFields, minimapColor, paintChunk, type TerrainFields } from './art/terrainArt';
// bundled inline so the game also runs as one self-contained HTML file (no separate worker URL)
import TerrainWorker from './terrainWorker.ts?worker&inline';

const S = CHUNK * TILE;

/**
 * Terrain chunks painted off the main thread by a small worker pool. A low-res placeholder is shown
 * instantly, then chunks nearest the camera are painted first. Chunks can be repainted when the map
 * changes (new fields, felled forests, carved roads).
 */
export class TerrainRenderer {
  private scene: Phaser.Scene;
  private map: GameMap;
  private cw: number;
  private ch: number;
  private images: (Phaser.GameObjects.Image | null)[] = [];
  private canvases: (HTMLCanvasElement | null)[] = [];
  private workers: Worker[] = [];
  private ready = 0;
  private queue: number[] = [];
  private inflight = new Set<number>();
  private busy: boolean[] = [];
  private fields: TerrainFields | null = null;
  private placeholder: Phaser.GameObjects.Image | null = null;
  painted = 0;
  get total() {
    return this.cw * this.ch;
  }
  onProgress?: (done: number, total: number) => void;

  constructor(scene: Phaser.Scene, map: GameMap, private layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.map = map;
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);
    this.makePlaceholder();
    this.startWorkers();
  }

  private makePlaceholder() {
    const m = this.map;
    const c = document.createElement('canvas');
    c.width = m.w;
    c.height = m.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    for (let i = 0; i < m.w * m.h; i++) {
      const [r, g, b] = minimapColor(m, i);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const key = 'terrain_placeholder';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    canvasTexture(this.scene, key, c);
    this.placeholder = this.scene.make.image({ x: 0, y: 0, key }, false).setOrigin(0, 0).setScale(TILE);
    this.layer.add(this.placeholder);
  }

  private startWorkers() {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const m = this.map;
    const payload = {
      w: m.w,
      h: m.h,
      seed: m.seed,
      terrain: m.terrain,
      height: m.height,
      tree: m.tree,
      ore: m.ore,
      crop: m.crop,
      crossings: m.crossings,
      roads: m.roads,
    };
    try {
      for (let i = 0; i < n; i++) {
        const w: Worker = new TerrainWorker();
        w.onmessage = (e) => this.onWorker(i, e.data);
        w.onerror = (err) => {
          console.warn('terrain worker failed, using main thread', err);
          this.fallback();
        };
        w.postMessage({ type: 'init', map: payload });
        this.workers.push(w);
        this.busy.push(true);
      }
    } catch (err) {
      console.warn('workers unavailable', err);
      this.fallback();
    }
    for (let i = 0; i < this.cw * this.ch; i++) this.queue.push(i);
  }

  private fallbackMode = false;
  private fallback() {
    if (this.fallbackMode) return;
    this.fallbackMode = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.fields = buildFields(this.map);
    for (const c of this.inflight) this.queue.unshift(c);
    this.inflight.clear();
  }

  private onWorker(i: number, msg: { type: string; cx: number; cy: number; buf: Uint32Array }) {
    if (msg.type === 'ready') {
      this.ready++;
      this.busy[i] = false;
      this.pump();
    } else if (msg.type === 'chunk') {
      this.busy[i] = false;
      const id = msg.cy * this.cw + msg.cx;
      this.inflight.delete(id);
      this.apply(msg.cx, msg.cy, msg.buf);
      this.pump();
    }
  }

  /** order queue by distance to a world point */
  prioritize(x: number, y: number) {
    this.queue.sort((a, b) => {
      const ax = ((a % this.cw) + 0.5) * S - x;
      const ay = (Math.floor(a / this.cw) + 0.5) * S - y;
      const bx = ((b % this.cw) + 0.5) * S - x;
      const by = (Math.floor(b / this.cw) + 0.5) * S - y;
      return ax * ax + ay * ay - (bx * bx + by * by);
    });
  }

  private pump() {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busy[i] || !this.queue.length) continue;
      const id = this.queue.shift()!;
      this.busy[i] = true;
      this.inflight.add(id);
      this.workers[i].postMessage({ type: 'paint', cx: id % this.cw, cy: Math.floor(id / this.cw) });
    }
  }

  /** main-thread fallback: paint one chunk per call */
  update() {
    if (this.fallbackMode && this.queue.length) {
      const id = this.queue.shift()!;
      const buf = new Uint32Array(S * S);
      paintChunk(this.map, this.fields!, id % this.cw, Math.floor(id / this.cw), buf);
      this.apply(id % this.cw, Math.floor(id / this.cw), buf);
    }
    // repaint requests from map changes
    if (this.map.dirtyChunks.size) {
      for (const id of this.map.dirtyChunks) if (!this.queue.includes(id) && !this.inflight.has(id)) this.queue.unshift(id);
      this.map.dirtyChunks.clear();
      for (const w of this.workers) w.postMessage({ type: 'update', terrain: this.map.terrain, tree: this.map.tree, ore: this.map.ore, crop: this.map.crop });
      if (this.fallbackMode) this.fields = buildFields(this.map);
      this.pump();
    }
  }

  private apply(cx: number, cy: number, buf: Uint32Array) {
    const id = cy * this.cw + cx;
    let canvas = this.canvases[id];
    const fresh = !canvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      this.canvases[id] = canvas;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer as ArrayBuffer), S, S), 0, 0);
    const key = `terrain_${cx}_${cy}`;
    if (fresh) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      canvasTexture(this.scene, key, canvas);
      const img = this.scene.make.image({ x: cx * S, y: cy * S, key }, false).setOrigin(0, 0);
      this.layer.add(img);
      this.images[id] = img;
      this.painted++;
      this.onProgress?.(this.painted, this.total);
      if (this.painted >= this.total && this.placeholder) {
        this.placeholder.destroy();
        this.placeholder = null;
      }
    } else {
      this.scene.textures.get(key).source[0].update();
    }
  }

  get done() {
    return this.painted >= this.total;
  }

  /** read terrain pixels for the minimap (downsampled) */
  getChunkCanvas(id: number) {
    return this.canvases[id];
  }

  destroy() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (let id = 0; id < this.images.length; id++) {
      this.images[id]?.destroy();
      const key = `terrain_${id % this.cw}_${Math.floor(id / this.cw)}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
  }
}

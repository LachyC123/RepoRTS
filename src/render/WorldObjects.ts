import Phaser from 'phaser';
import { hash2 } from '../core/Random';
import { TILE } from '../data/constants';
import { CHUNK } from '../sim/map/GameMap';
import type { World } from '../sim/World';
import { art } from './art/ArtRegistry';
import type { SortObj, YSortLayer } from './YSortLayer';

interface Chunk {
  built: boolean;
  visible: boolean;
  objs: SortObj[];
  trees: { obj: SortObj; i: number; sp: number; v: number; phase: number }[];
  anims: { obj: SortObj; kind: 'windmill'; t: number }[];
}

/**
 * Static world objects (trees, decor, ore, story props) created lazily per chunk and only kept in the
 * display list while their chunk is on screen. Trees sway with a travelling wind gust and are swapped
 * for stumps when felled.
 */
export class WorldObjects {
  private chunks: Chunk[] = [];
  private cw: number;
  private ch: number;
  private treeObjByTile = new Map<number, { obj: SortObj; chunk: Chunk }>();
  wind = 1;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private ylayer: YSortLayer,
  ) {
    const m = world.map;
    this.cw = Math.ceil(m.w / CHUNK);
    this.ch = Math.ceil(m.h / CHUNK);
    for (let i = 0; i < this.cw * this.ch; i++) this.chunks.push({ built: false, visible: false, objs: [], trees: [], anims: [] });
    world.events.on('treeFelled', ({ x, y }) => this.fell(x, y));
  }

  private img(frame: string, x: number, y: number): SortObj {
    const f = art.get(frame);
    const o = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false) as SortObj;
    o.setOrigin(f.ox, f.oy);
    o.sy = y;
    return o;
  }

  private build(id: number) {
    const c = this.chunks[id];
    c.built = true;
    const m = this.world.map;
    const cx = id % this.cw;
    const cy = Math.floor(id / this.cw);
    for (let ty = cy * CHUNK; ty < Math.min(m.h, (cy + 1) * CHUNK); ty++) {
      for (let tx = cx * CHUNK; tx < Math.min(m.w, (cx + 1) * CHUNK); tx++) {
        const i = ty * m.w + tx;
        const sp = m.tree[i];
        if (sp) {
          const hv = hash2(tx, ty, 77);
          const v = sp === 1 ? (hv < 0.08 ? 3 : Math.floor(hv * 3) % 3) : Math.floor(hv * 3) % 3;
          const ox = (hash2(tx, ty, 78) - 0.5) * 6;
          const oy = (hash2(tx, ty, 79) - 0.5) * 4;
          const o = this.img(`tree/${sp}/${v}/0`, tx * TILE + 8 + ox, ty * TILE + 13 + oy);
          c.objs.push(o);
          const t = { obj: o, i, sp, v, phase: hash2(tx, ty, 80) * 6.28 };
          c.trees.push(t);
          this.treeObjByTile.set(i, { obj: o, chunk: c });
        } else if (m.stump[i]) {
          c.objs.push(this.img('stump', tx * TILE + 8, ty * TILE + 12));
        }
      }
    }
    // ore deposits (one sprite per deposit centre)
    for (const d of m.deposits) {
      const tx = Math.floor(d.x / TILE);
      const ty = Math.floor(d.y / TILE);
      if (Math.floor(tx / CHUNK) !== cx || Math.floor(ty / CHUNK) !== cy) continue;
      c.objs.push(this.img(`prop/ore_${d.kind}/${d.regionId % 4}`, d.x, d.y + 10));
    }
    // decor
    for (const d of m.decor) {
      const tx = Math.floor(d.x / TILE);
      const ty = Math.floor(d.y / TILE);
      if (Math.floor(tx / CHUNK) !== cx || Math.floor(ty / CHUNK) !== cy) continue;
      if (d.kind === 'windmill') {
        const base = this.img('prop/windmill_base/0', d.x, d.y + 8);
        c.objs.push(base);
        const blades = this.img('windmill_blades/0', d.x, d.y - 6);
        blades.sy = d.y + 8.5;
        c.objs.push(blades);
        c.anims.push({ obj: blades, kind: 'windmill', t: hash2(tx, ty, 3) * 4 });
        continue;
      }
      const name = `prop/${d.kind}/${d.v % 4}`;
      if (!art.tryGet(name)) continue;
      const o = this.img(name, d.x, d.y);
      // flat ground decals sort beneath everything standing on them
      if (d.kind === 'flowers' || d.kind === 'charred' || d.kind === 'bones' || d.kind === 'bridge_ruin' || d.kind === 'shield' || d.kind === 'spear') o.sy = d.y - 12;
      c.objs.push(o);
    }
  }

  private fell(x: number, y: number) {
    const m = this.world.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const i = ty * m.w + tx;
    const rec = this.treeObjByTile.get(i);
    if (!rec) return;
    this.treeObjByTile.delete(i);
    const c = rec.chunk;
    c.trees = c.trees.filter((t) => t.obj !== rec.obj);
    c.objs = c.objs.filter((o) => o !== rec.obj);
    if (c.visible) this.ylayer.remove(rec.obj);
    rec.obj.destroy();
    const st = this.img('stump', tx * TILE + 8, ty * TILE + 12);
    c.objs.push(st);
    if (c.visible) this.ylayer.add(st);
  }

  /** shake a tree being chopped */
  shakeTree(tileIdx: number) {
    const rec = this.treeObjByTile.get(tileIdx);
    if (rec) (rec.obj as SortObj & { shake?: number }).shake = 0.25;
  }

  update(view: { x0: number; y0: number; x1: number; y1: number }, time: number, dt: number, showTrees = true) {
    const S = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor((view.x0 - 32) / S));
    const cy0 = Math.max(0, Math.floor((view.y0 - 32) / S));
    const cx1 = Math.min(this.cw - 1, Math.floor((view.x1 + 32) / S));
    const cy1 = Math.min(this.ch - 1, Math.floor((view.y1 + 48) / S));
    for (let id = 0; id < this.chunks.length; id++) {
      const c = this.chunks[id];
      const cx = id % this.cw;
      const cy = Math.floor(id / this.cw);
      const want = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
      if (want && !c.visible) {
        if (!c.built) this.build(id);
        for (const o of c.objs) this.ylayer.add(o);
        c.visible = true;
      } else if (!want && c.visible) {
        for (const o of c.objs) this.ylayer.remove(o);
        c.visible = false;
      }
      if (!c.visible) continue;
      // sway: travelling gust
      for (const t of c.trees) {
        const o = t.obj as SortObj & { shake?: number };
        const gust = Math.sin(time * 1.1 - o.x * 0.006 - o.y * 0.003 + t.phase * 0.15);
        let s = gust * this.wind > 0.55 ? 1 : 0;
        if (o.shake && o.shake > 0) {
          o.shake = Math.max(0, o.shake - dt);
          s = Math.floor(o.shake * 30) & 1;
        }
        const fr = art.get(`tree/${t.sp}/${t.v}/${s}`);
        if (o.frame.name !== fr.frame) o.setFrame(fr.frame);
        o.visible = showTrees || true;
      }
      for (const a of c.anims) {
        a.t += dt * (0.8 + this.wind * 0.8);
        const fr = art.get(`windmill_blades/${Math.floor(a.t * 3) % 4}`);
        if (a.obj.frame.name !== fr.frame) a.obj.setFrame(fr.frame);
      }
    }
  }
}

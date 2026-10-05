import type Phaser from 'phaser';
import { hash2 } from '../core/Random';
import { NEUTRAL, TILE } from '../data/constants';
import { T } from '../sim/map/GameMap';
import type { Settlement } from '../sim/territory/Settlement';
import type { World } from '../sim/World';
import { art } from './art/ArtRegistry';
import { MODERN_VILLAGER_KINDS, VILLAGER_KINDS } from './art/animalArt';
import { isModern } from '../data/era';
import type { SortObj, YSortLayer } from './YSortLayer';
import type { Particles } from './Particles';

type Kind = 'villager' | 'guard' | 'sheep' | 'cow' | 'chicken' | 'dog' | 'deer' | 'cart' | 'boat' | 'duck';

interface Agent {
  kind: Kind;
  sub: string;
  img: SortObj;
  x: number;
  y: number;
  tx: number;
  ty: number;
  path: number[] | null;
  pi: number;
  speed: number;
  wait: number;
  home: number; // settlement id or -1
  facing: number;
  t: number;
  fleeing: boolean;
  gone: boolean;
  road?: { path: number[]; i: number; dir: number };
}

interface Bird {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  crow: boolean;
  perched: boolean;
  life: number;
}

/**
 * Render-only life that makes the valley feel inhabited: villagers walking between homes and the
 * square (fleeing indoors when enemies come), guards on patrol in towns, grazing sheep and cows,
 * pecking chickens, dogs, deer that bolt from soldiers, carts trundling along roads between a
 * kingdom's settlements (more traffic when wealthy), boats and ducks on the water, bird flocks and
 * crows that scatter from armies, butterflies over meadows and glints on the water.
 */
export class Ambient {
  private agents: Agent[] = [];
  private birds: Bird[] = [];
  private flies: { img: Phaser.GameObjects.Image; x: number; y: number; t: number; k: number; bx: number; by: number }[] = [];
  private glints: { img: Phaser.GameObjects.Image; t: number; x: number; y: number }[] = [];
  private active = new Set<number>(); // settlements populated
  private t = 0;
  private flockT = 3;
  quality = 1;
  wind = 1;
  /** particle system for splashes (set by the scene) */
  fx: Particles | null = null;
  private fishT = 2;
  private chatT = -9;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private ylayer: YSortLayer,
    private fxLayer: Phaser.GameObjects.Layer,
  ) {}

  private img(frame: string, x: number, y: number): SortObj {
    const f = art.get(frame);
    const o = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false) as SortObj;
    o.setOrigin(f.ox, f.oy);
    o.sy = y;
    this.ylayer.add(o);
    return o;
  }

  private walkable(x: number, y: number) {
    const m = this.world.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
    const i = ty * m.w + tx;
    const t = m.terrain[i];
    return t !== T.WATER && t !== T.ROCK && !m.tree[i] && !m.ore[i] && m.occ[i] === 0;
  }

  private spawnFor(s: Settlement) {
    const w = this.world;
    const m = w.map;
    const q = this.quality;
    const r = s.region;
    if (r.tier === 0 && !s.isCapital) {
      // landmarks: deer in forests, nothing else
      if (r.features.includes('forest') && Math.random() < 0.7 * q) this.addAnimal('deer', s, 2);
      return;
    }
    const nVill = Math.round((s.isCapital ? 8 + (s.tier - 3) * 4 : s.tier >= 4 ? 9 : s.tier === 3 ? 6 : s.tier === 2 ? 4 : 1) * q);
    for (let k = 0; k < nVill; k++) {
      const kinds = isModern() ? MODERN_VILLAGER_KINDS : VILLAGER_KINDS;
      const sub = kinds[(s.id + k) % kinds.length];
      const [x, y] = this.randomSpot(s, 7);
      const a = this.addAgent('villager', sub, `amb/villager_${sub}/0`, x, y, s.id, 16 + Math.random() * 6);
      a.wait = Math.random() * 4;
    }
    if (s.tier >= 3 || s.isCapital) {
      const g = Math.round(2 * q);
      for (let k = 0; k < g; k++) {
        const [x, y] = this.randomSpot(s, 6);
        const sub = isModern() ? 'm_guard' : 'guard';
        this.addAgent('guard', sub, `amb/villager_${sub}/0`, x, y, s.id, 14);
      }
    }
    // livestock near farms
    const farms = w.buildings.filter((b) => b.settlementId === s.id && b.def.id === 'farm' && b.built);
    if (farms.length || r.features.includes('farmland')) {
      this.addAnimal('sheep', s, Math.round((2 + Math.random() * 3) * q));
      if (Math.random() < 0.6) this.addAnimal('cow', s, Math.round((1 + Math.random() * 2) * q));
    }
    if (s.tier >= 2) {
      this.addAnimal('chicken', s, Math.round(3 * q));
      if (Math.random() < 0.7) this.addAnimal('dog', s, 1);
    }
    void m;
  }

  private addAnimal(kind: Kind, s: Settlement, n: number) {
    for (let k = 0; k < n; k++) {
      const [x, y] = this.randomSpot(s, kind === 'chicken' ? 5 : kind === 'deer' ? 10 : 9);
      const spd = kind === 'chicken' ? 6 : kind === 'dog' ? 22 : kind === 'deer' ? 10 : 5;
      const a = this.addAgent(kind, kind, `amb/${kind}/0`, x, y, s.id, spd);
      a.wait = Math.random() * 6;
    }
  }

  private addAgent(kind: Kind, sub: string, frame: string, x: number, y: number, home: number, speed: number): Agent {
    const a: Agent = { kind, sub, img: this.img(frame, x, y), x, y, tx: x, ty: y, path: null, pi: 0, speed, wait: 0, home, facing: 1, t: Math.random() * 10, fleeing: false, gone: false };
    this.agents.push(a);
    return a;
  }

  private randomSpot(s: Settlement, r: number): [number, number] {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = (0.3 + Math.random() * 0.7) * r * TILE;
      const x = s.cx + Math.cos(a) * d;
      const y = s.cy + 20 + Math.sin(a) * d * 0.8;
      if (this.walkable(x, y)) return [x, y];
    }
    return [s.px, s.py + 8];
  }

  private despawnSettlement(sid: number) {
    for (const a of this.agents) {
      if (a.home !== sid || a.kind === 'cart') continue;
      this.ylayer.remove(a.img);
      a.img.destroy();
      a.gone = true;
    }
    this.agents = this.agents.filter((a) => !a.gone);
  }

  update(dt: number, time: number, view: { x0: number; y0: number; x1: number; y1: number }, zoom: number) {
    const w = this.world;
    this.t += dt;
    const near = (x: number, y: number, m: number) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;
    const detail = zoom >= 1.1;
    // populate settlements near the camera
    if (this.t > 0.5) {
      this.t = 0;
      for (const s of w.settlements) {
        const want = detail && near(s.cx, s.cy, 220);
        if (want && !this.active.has(s.id)) {
          this.active.add(s.id);
          this.spawnFor(s);
        } else if (!want && this.active.has(s.id)) {
          this.active.delete(s.id);
          this.despawnSettlement(s.id);
        }
      }
      this.manageCarts(view, detail);
      this.manageWaterLife(view, detail);
    }
    // agents
    for (const a of this.agents) this.tickAgent(a, dt, time);
    this.agents = this.agents.filter((a) => {
      if (a.gone) {
        this.ylayer.remove(a.img);
        a.img.destroy();
      }
      return !a.gone;
    });
    this.updateBirds(dt, view, detail);
    this.updateFlies(dt, view, detail);
    this.updateGlints(dt, view, detail);
    this.updateFish(dt, view, detail);
    this.updateLeaves(dt, view, detail);
  }

  private leafT = 0;
  /** leaves shaken loose from the woods drift across on the wind (more when it's blowing) */
  private updateLeaves(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    if (!detail || !this.fx) return;
    this.leafT += dt * (0.6 + (this.wind - 1) * 3) * this.quality;
    const m = this.world.map;
    let tries = 0;
    while (this.leafT > 0.35 && tries++ < 8) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0);
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      const i = Math.floor(y / TILE) * m.w + Math.floor(x / TILE);
      if (i < 0 || i >= m.tree.length || !m.tree[i]) continue;
      this.leafT -= 0.35;
      const autumn = Math.random() < 0.35;
      this.fx.emit({
        frame: 'fx/leaf',
        x: x + (Math.random() - 0.5) * 10,
        y,
        z: 16 + Math.random() * 10,
        vx: 14 * this.wind + Math.random() * 10,
        vy: 2 + Math.random() * 4,
        vz: 2,
        g: 9,
        life: 3 + Math.random() * 2,
        spin: 2 + Math.random() * 3,
        ground: 'stop',
        alpha: 0.95,
        tint: autumn ? (Math.random() < 0.5 ? 0xe0a040 : 0xc86a30) : undefined,
      });
    }
    if (tries >= 8) this.leafT = Math.min(this.leafT, 0.35);
  }

  private tickAgent(a: Agent, dt: number, time: number) {
    const w = this.world;
    a.t += dt;
    const s = a.home >= 0 ? w.settlements[a.home] : null;
    // threat: villagers and animals flee
    if (s && a.kind !== 'cart' && a.kind !== 'boat' && a.kind !== 'duck') {
      const threatened = s.threat > 0;
      if (threatened && !a.fleeing && (a.kind === 'villager' || a.kind === 'chicken' || a.kind === 'sheep')) {
        a.fleeing = true;
        const core = w.buildingById.get(s.coreId);
        a.tx = core ? core.doorX : s.px;
        a.ty = core ? core.doorY - 6 : s.py;
        a.path = null;
        a.wait = 0;
      }
      if (!threatened && a.fleeing) {
        a.fleeing = false;
        a.img.setVisible(true);
      }
    }
    if (a.kind === 'deer') {
      // bolt from nearby soldiers
      let threat: { x: number; y: number } | null = null;
      w.unitHash.query(a.x, a.y, 5 * TILE, (u) => {
        if (!threat && u.alive && u.def.special !== 'worker') threat = u;
      });
      if (threat) {
        const t = threat as { x: number; y: number };
        const dx = a.x - t.x;
        const dy = a.y - t.y;
        const l = Math.hypot(dx, dy) || 1;
        a.tx = a.x + (dx / l) * 60;
        a.ty = a.y + (dy / l) * 60;
        a.speed = 45;
        a.wait = 0;
      } else a.speed = 10;
    }
    if (a.kind === 'cart') return this.tickCart(a, dt);
    if (a.kind === 'boat' || a.kind === 'duck') return this.tickFloater(a, dt, time);
    if (a.wait > 0) {
      a.wait -= dt;
      this.setFrame(a, false, time);
      return;
    }
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    const spd = a.fleeing ? a.speed * 2.2 : a.speed;
    if (d < 2) {
      if (a.fleeing) {
        // hide indoors
        a.img.setVisible(false);
        return;
      }
      // pick next destination
      a.wait = a.kind === 'villager' ? 1 + Math.random() * 5 : a.kind === 'guard' ? 2 + Math.random() * 3 : 2 + Math.random() * 8;
      // neighbours stopping side by side pass the time of day
      if (a.kind === 'villager' && this.fx && time - this.chatT > 0.9) {
        const friend = this.agents.find((o) => o !== a && o.kind === 'villager' && o.wait > 0.5 && Math.abs(o.x - a.x) < 16 && Math.abs(o.y - a.y) < 10);
        if (friend) {
          this.chatT = time;
          a.wait = Math.max(a.wait, 3);
          a.facing = friend.x > a.x ? 1 : -1;
          a.img.setFlipX(a.facing < 0);
          this.fx.emit({ frame: 'fx/bub_chat', x: a.x, y: a.y - 19, vz: 3, life: 1.6, s0: 0.55, s1: 0.8 });
        }
      }
      if (s) {
        let nx: number;
        let ny: number;
        if (a.kind === 'villager' && Math.random() < 0.45) {
          // go to the square, a home or a building door
          const opts: [number, number][] = [[s.px, s.py + 6]];
          const m = w.map;
          for (const i of s.cottages) opts.push([(i % m.w) * TILE + 8, Math.floor(i / m.w) * TILE + 20]);
          for (const b of w.buildings) if (b.settlementId === s.id && b.built && !b.destroyed && b.def.id !== 'wall') opts.push([b.doorX, b.doorY + 2]);
          [nx, ny] = opts[Math.floor(Math.random() * opts.length)];
        } else [nx, ny] = this.randomSpot(s, a.kind === 'chicken' ? 5 : a.kind === 'guard' ? 8 : 8);
        if (this.walkable(nx, ny)) {
          a.tx = nx;
          a.ty = ny;
        }
      }
      this.setFrame(a, false, time);
      return;
    }
    let mx = (dx / d) * spd * dt;
    let my = (dy / d) * spd * dt;
    // simple obstacle avoidance: slide along blocked axes, else give up this target
    if (!this.walkable(a.x + mx * 3, a.y + my * 3)) {
      if (this.walkable(a.x + mx * 3, a.y)) my = 0;
      else if (this.walkable(a.x, a.y + my * 3)) mx = 0;
      else {
        a.tx = a.x;
        a.ty = a.y;
        mx = my = 0;
      }
    }
    a.x += mx;
    a.y += my;
    if (Math.abs(mx) > 0.01) a.facing = mx > 0 ? 1 : -1;
    a.img.setPosition(Math.round(a.x), Math.round(a.y));
    a.img.sy = a.y;
    a.img.setFlipX(a.facing < 0);
    this.setFrame(a, true, time);
  }

  private setFrame(a: Agent, moving: boolean, time: number) {
    let name: string;
    switch (a.kind) {
      case 'villager':
      case 'guard':
        name = `amb/villager_${a.sub}/${moving ? 2 + (Math.floor(time * 8 + a.t) & 3) : Math.floor(time * 1.5 + a.t) & 1}`;
        break;
      case 'chicken':
        name = `amb/chicken/${moving ? 0 : Math.floor(time * 3 + a.t) & 1}`;
        break;
      case 'sheep':
      case 'cow':
      case 'deer':
        name = `amb/${a.kind}/${moving ? Math.floor(time * 5 + a.t) % 2 : a.t % 7 < 4 ? 2 : 0}`;
        break;
      case 'dog':
        name = `amb/dog/${moving ? Math.floor(time * 8) % 2 : 2}`;
        break;
      default:
        return;
    }
    const f = art.tryGet(name);
    if (f && a.img.frame.name !== f.frame) a.img.setTexture(f.key, f.frame);
  }

  // ------------------------------------------------------------------ carts on roads
  private manageCarts(view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const w = this.world;
    const m = w.map;
    const carts = this.agents.filter((a) => a.kind === 'cart');
    const maxCarts = detail ? Math.round(6 * this.quality) : 0;
    if (carts.length >= maxCarts) return;
    // roads whose endpoints are owned by the same kingdom, near the view
    const cands: { path: number[]; owner: number }[] = [];
    for (const path of m.roads) {
      const a = w.settlements[m.region[path[0]]];
      const b = w.settlements[m.region[path[path.length - 1]]];
      if (!a || !b || a.owner !== b.owner || a.owner === NEUTRAL) continue;
      const mid = path[Math.floor(path.length / 2)];
      const mx = (mid % m.w) * TILE;
      const my = Math.floor(mid / m.w) * TILE;
      if (mx < view.x0 - 300 || mx > view.x1 + 300 || my < view.y0 - 300 || my > view.y1 + 300) continue;
      cands.push({ path, owner: a.owner });
    }
    if (!cands.length) return;
    const c = cands[Math.floor(Math.random() * cands.length)];
    // wealthier kingdoms trade more
    const inc = w.factions[c.owner].income.gold;
    if (Math.random() > Math.min(0.9, 0.2 + inc / 300)) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const i0 = dir > 0 ? 0 : c.path.length - 1;
    const x = (c.path[i0] % m.w) * TILE + 8;
    const y = Math.floor(c.path[i0] / m.w) * TILE + 8;
    // modern roads carry lorries and little cars, faster than carts
    const sub = isModern() ? (Math.random() < 0.45 ? 'truck' : 'car') : 'cart';
    const a = this.addAgent('cart', sub, `amb/${sub}/0`, x, y, -1, sub === 'car' ? 34 : sub === 'truck' ? 26 : 18);
    a.road = { path: c.path, i: i0, dir };
  }

  private tickCart(a: Agent, dt: number) {
    const m = this.world.map;
    const r = a.road!;
    const ni = r.i + r.dir;
    if (ni < 0 || ni >= r.path.length) {
      a.gone = true;
      return;
    }
    const tx = (r.path[ni] % m.w) * TILE + 8;
    const ty = Math.floor(r.path[ni] / m.w) * TILE + 8;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      r.i = ni;
      return;
    }
    a.x += (dx / d) * a.speed * dt;
    a.y += (dy / d) * a.speed * dt;
    if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    a.img.setPosition(Math.round(a.x), Math.round(a.y));
    a.img.sy = a.y;
    a.img.setFlipX(a.facing < 0);
    const f = art.get(`amb/${a.sub}/${Math.floor(a.t * 4) & 1}`);
    a.img.setTexture(f.key, f.frame);
  }

  // ------------------------------------------------------------------ water
  private manageWaterLife(view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const floaters = this.agents.filter((a) => a.kind === 'duck' || a.kind === 'boat');
    if (!detail || floaters.length >= 4 * this.quality) return;
    const m = this.world.map;
    for (let k = 0; k < 6; k++) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0);
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) continue;
      if (m.terrain[ty * m.w + tx] !== T.WATER) continue;
      // boats only on wide water
      let wide = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (m.terrain[(ty + dy) * m.w + tx + dx] === T.WATER) wide++;
      const kind: Kind = wide > 22 && Math.random() < 0.4 ? 'boat' : 'duck';
      const sub = kind === 'boat' && isModern() ? 'motorboat' : kind;
      const a = this.addAgent(kind, sub, `amb/${sub}/0`, x, y, -1, kind === 'boat' ? (sub === 'motorboat' ? 12 : 6) : 4);
      a.tx = x;
      a.ty = y;
      break;
    }
  }

  private tickFloater(a: Agent, dt: number, time: number) {
    const m = this.world.map;
    const isWater = (x: number, y: number) => {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && m.terrain[ty * m.w + tx] === T.WATER;
    };
    if (Math.hypot(a.tx - a.x, a.ty - a.y) < 2 || a.t > 40) {
      if (a.t > 120) {
        a.gone = true;
        return;
      }
      for (let k = 0; k < 6; k++) {
        const nx = a.x + (Math.random() - 0.5) * 60;
        const ny = a.y + (Math.random() - 0.5) * 40;
        if (isWater(nx, ny)) {
          a.tx = nx;
          a.ty = ny;
          break;
        }
      }
    }
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = a.x + (dx / d) * a.speed * dt;
    const ny = a.y + (dy / d) * a.speed * dt;
    if (isWater(nx, ny)) {
      a.x = nx;
      a.y = ny;
    } else {
      a.tx = a.x;
      a.ty = a.y;
    }
    if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    a.img.setPosition(Math.round(a.x), Math.round(a.y + Math.sin(time * 2 + a.t) * 0.5));
    a.img.sy = a.y;
    a.img.setFlipX(a.facing < 0);
    const f = art.get(`amb/${a.sub}/${Math.floor(time * (a.kind === 'boat' ? (a.sub === 'motorboat' ? 4 : 1.5) : 2) + a.t) % 2}`);
    a.img.setTexture(f.key, f.frame);
  }

  // ------------------------------------------------------------------ birds
  private updateBirds(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const w = this.world;
    this.flockT -= dt;
    // birds roost after dark
    if (this.flockT <= 0 && this.birds.length < 30 * this.quality && !w.sky.night) {
      this.flockT = 6 + Math.random() * 10;
      // a flock crossing the view
      const fromLeft = Math.random() < 0.5;
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      const x = fromLeft ? view.x0 - 20 : view.x1 + 20;
      const vx = (fromLeft ? 1 : -1) * (30 + Math.random() * 20);
      const vy = (Math.random() - 0.5) * 12;
      const n = 3 + Math.floor(Math.random() * 6 * this.quality);
      for (let k = 0; k < n; k++) this.addBird(x - Math.sign(vx) * k * 7 + (Math.random() - 0.5) * 8, y + (k % 2 ? 5 : -5) * Math.ceil(k / 2), vx, vy, false, false);
    }
    // crows perch near story spots and battlefields when the camera is close
    if (detail && Math.random() < dt * 0.2) {
      for (const st of w.map.story) {
        const x = st.x * TILE;
        const y = st.y * TILE;
        if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
        if (this.birds.filter((b) => b.crow && b.perched).length > 8) break;
        for (let k = 0; k < 3; k++) this.addBird(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, 0, 0, true, true);
        break;
      }
    }
    let k = 0;
    for (const b of this.birds) {
      b.t += dt;
      if (b.perched) {
        // take off when soldiers approach
        let scare = false;
        w.unitHash.query(b.x, b.y, 4 * TILE, (u) => {
          if (u.alive && u.def.special !== 'worker') scare = true;
          return scare;
        });
        if (scare || b.t > b.life) {
          b.perched = false;
          b.vx = (Math.random() - 0.5) * 60;
          b.vy = -20 - Math.random() * 30;
        }
        const f = art.get(`amb/crow/0`);
        b.img.setTexture(f.key, f.frame);
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.crow) b.vy -= 6 * dt;
        const f = art.get(`amb/${b.crow ? 'crow' : 'bird'}/${Math.floor(b.t * 7) & 1}`);
        b.img.setTexture(f.key, f.frame);
      }
      b.img.setPosition(Math.round(b.x), Math.round(b.y));
      const out = b.x < view.x0 - 100 || b.x > view.x1 + 100 || b.y < view.y0 - 120 || b.y > view.y1 + 100;
      if (out && !b.perched) {
        b.img.destroy();
        continue;
      }
      this.birds[k++] = b;
    }
    this.birds.length = k;
  }

  private addBird(x: number, y: number, vx: number, vy: number, crow: boolean, perched: boolean) {
    const f = art.get(`amb/${crow ? 'crow' : 'bird'}/0`);
    const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false);
    img.setOrigin(f.ox, f.oy);
    this.fxLayer.add(img);
    this.birds.push({ img, x, y, vx, vy, t: Math.random(), crow, perched, life: 20 + Math.random() * 40 });
  }

  private updateFlies(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const m = this.world.map;
    if (detail && this.flies.length < 10 * this.quality && Math.random() < dt * 2) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0);
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      const t = m.terrain[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)];
      if (t === T.MEADOW || t === T.GRASS || t === T.FARMLAND) {
        const k = Math.floor(Math.random() * 4);
        const f = art.get(`amb/fly${k}/0`);
        const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false);
        this.fxLayer.add(img);
        this.flies.push({ img, x, y, t: 0, k, bx: x, by: y });
      }
    }
    let n = 0;
    for (const f of this.flies) {
      f.t += dt;
      f.x = f.bx + Math.sin(f.t * 1.3 + f.k) * 14 + Math.sin(f.t * 3.1) * 4;
      f.y = f.by + Math.cos(f.t * 0.9 + f.k) * 8 - 6 + Math.sin(f.t * 5) * 2;
      f.bx += Math.sin(f.t * 0.3) * 6 * dt * this.wind;
      const fr = art.get(`amb/fly${f.k}/${Math.floor(f.t * 9) & 1}`);
      f.img.setTexture(fr.key, fr.frame).setPosition(Math.round(f.x), Math.round(f.y));
      if (f.t > 25 || !detail) {
        f.img.destroy();
        continue;
      }
      this.flies[n++] = f;
    }
    this.flies.length = n;
  }

  /** now and then a fish leaps from open water: splash ring out, arc, splash ring in */
  private updateFish(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const fx = this.fx;
    if (!fx || !detail) return;
    this.fishT -= dt;
    if (this.fishT > 0) return;
    this.fishT = 1.2 + Math.random() * 2.5;
    const m = this.world.map;
    for (let k = 0; k < 6; k++) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0);
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) continue;
      // deep enough: open water on all sides
      const deep = [0, 1, -1, m.w, -m.w].every((o) => m.terrain[ty * m.w + tx + o] === T.WATER);
      if (!deep) continue;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const ring = (rx: number, a: number) => fx.emit({ frame: 'fx/ring', x: rx, y, life: 0.7, s0: 0.05, s1: 0.45, sy: 0.45, tint: 0xd8ecf8, alpha: a, add: true, fadeAll: true });
      ring(x, 0.7);
      fx.burst(3, { frame: 'fx/drop', x, y, z: 1, life: 0.4, g: 160, tint: 0xe0f0ff, ground: 'die' }, 14, 30);
      fx.emit({ frame: 'amb/fish', x, y, z: 0, vx: dir * 22, vz: 48, g: 150, life: 0.62, rot: dir * -0.5, spin: dir * 2.2, flipX: dir < 0, ground: 'die' });
      this.scene.time.delayedCall(620, () => {
        ring(x + dir * 14, 0.6);
        fx.burst(2, { frame: 'fx/drop', x: x + dir * 14, y, z: 1, life: 0.35, g: 160, tint: 0xe0f0ff, ground: 'die' }, 12, 26);
      });
      break;
    }
  }

  private updateGlints(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, detail: boolean) {
    const m = this.world.map;
    if (detail && this.glints.length < 40 * this.quality) {
      for (let k = 0; k < 3; k++) {
        const x = view.x0 + Math.random() * (view.x1 - view.x0);
        const y = view.y0 + Math.random() * (view.y1 - view.y0);
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.terrain[ty * m.w + tx] !== T.WATER) continue;
        const f = art.get('amb/glint/0');
        const img = this.scene.make.image({ x, y, key: f.key, frame: f.frame }, false);
        this.fxLayer.add(img);
        this.glints.push({ img, t: 0, x, y });
      }
    }
    let n = 0;
    for (const g of this.glints) {
      g.t += dt;
      const ph = g.t / 1.6;
      if (ph >= 1 || !detail) {
        g.img.destroy();
        continue;
      }
      const fr = art.get(`amb/glint/${ph < 0.33 ? 0 : ph < 0.66 ? 1 : 2}`);
      g.img.setTexture(fr.key, fr.frame).setPosition(Math.round(g.x + g.t * 3), Math.round(g.y)).setAlpha(ph < 0.5 ? ph * 2 : (1 - ph) * 2);
      this.glints[n++] = g;
    }
    this.glints.length = n;
    void hash2;
  }
}

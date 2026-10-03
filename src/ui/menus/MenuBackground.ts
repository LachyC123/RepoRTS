import { fbm, hash2 } from '../../core/Random';
import { KINGDOM_COLORS } from '../../data/factions';
import { UNITS } from '../../data/units';
import { PixelCanvas, mix } from '../../render/art/PixelCanvas';
import { BAYER4, RAMP } from '../../render/art/palette';
import { drawTree, drawWindmillBlades } from '../../render/art/propArt';
import { buildUnitSheet } from '../../render/art/unitArt';

/**
 * Animated pixel-art title backdrop rendered on a tiny canvas and scaled up crisp: dawn sky,
 * layered hills, a castle with fluttering banners, a windmill, a winding road with marching
 * columns of soldiers, drifting clouds and birds.
 */
export class MenuBackground {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 320;
  private H = 180;
  private staticLayer: HTMLCanvasElement | null = null;
  private soldiers: { frames: HTMLCanvasElement[]; x: number; y: number; speed: number; dir: number; t: number }[] = [];
  private clouds: { x: number; y: number; w: number; s: number }[] = [];
  private birds: { x: number; y: number; t: number; v: number }[] = [];
  private blades: HTMLCanvasElement[] = [];
  private flags: { x: number; y: number; c: string }[] = [];
  private raf = 0;
  private t = 0;
  private last = 0;
  private roadPts: [number, number][] = [];

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'menu-bg';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
    for (let i = 0; i < 6; i++) this.clouds.push({ x: Math.random() * this.W, y: 8 + Math.random() * 40, w: 30 + Math.random() * 40, s: 2 + Math.random() * 3 });
    for (let k = 0; k < 4; k++) this.blades.push(drawWindmillBlades(k).pc.flush());
    this.makeSoldiers();
    this.last = performance.now();
    this.loop();
  }

  private resize = () => {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.H = 180;
    this.W = Math.max(240, Math.round(this.H * aspect));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.staticLayer = null;
  };

  private makeSoldiers() {
    const cols = KINGDOM_COLORS;
    const columns = [
      { types: ['knight', 'knight', 'swordsman', 'swordsman', 'spearman', 'spearman', 'archer', 'archer'], color: cols[0], dir: 1, offset: 0 },
      { types: ['light_cavalry', 'pikeman', 'pikeman', 'crossbowman', 'crossbowman', 'catapult'], color: cols[1], dir: -1, offset: 0.55 },
    ];
    for (const c of columns) {
      c.types.forEach((type, i) => {
        const sheet = buildUnitSheet(UNITS[type], c.color, i);
        const frames = sheet.frames.slice(2, 6).map((f) => f.flush());
        const flipped = c.dir < 0 ? frames.map((f) => flip(f)) : frames;
        this.soldiers.push({ frames: flipped, x: 0, y: 0, speed: UNITS[type].speed * 0.35, dir: c.dir, t: c.offset - i * 0.035 });
      });
    }
  }

  private road(t: number): [number, number] {
    // param 0..1 along a winding road from left-mid to right foreground
    const W = this.W;
    const H = this.H;
    const x = -20 + t * (W + 40);
    const y = H * 0.66 + Math.sin(t * 5.2) * 9 + t * 22;
    return [x, y];
  }

  private buildStatic() {
    const W = this.W;
    const H = this.H;
    const pc = new PixelCanvas(W, H);
    // sky: dawn gradient with ordered dithering
    const sky = ['#2a2048', '#3d2a58', '#5a3a62', '#8a5068', '#c87862', '#e8a070', '#f4c888'];
    for (let y = 0; y < H * 0.62; y++) {
      for (let x = 0; x < W; x++) {
        const v = (y / (H * 0.62)) * (sky.length - 1) + BAYER4[(x & 3) + ((y & 3) << 2)] * 0.9;
        pc.px(x, y, sky[Math.max(0, Math.min(sky.length - 1, Math.round(v)))]);
      }
    }
    // sun
    pc.ellipse(W * 0.72, H * 0.5, 14, 14, '#f8e0a0');
    pc.ellipse(W * 0.72, H * 0.5, 11, 11, '#fff0c0');
    // far mountains
    const ridge = (base: number, amp: number, freq: number, seed: number, col: string, colHi: string) => {
      for (let x = 0; x < W; x++) {
        const h = base - fbm(x / freq, seed, 3, seed) * amp;
        for (let y = Math.floor(h); y < H; y++) pc.px(x, y, y - h < 2 && fbm(x / 7, seed + 3, 2, seed) > 0.5 ? colHi : col);
      }
    };
    ridge(H * 0.5, 34, 40, 3, '#5a4a6a', '#7a6a88');
    ridge(H * 0.56, 22, 30, 7, '#4a5a5a', '#62746a');
    // castle on the far hill
    const cx = Math.round(W * 0.3);
    const cy = Math.round(H * 0.47);
    const stone = ['#4a4656', '#5e5a6a', '#76728a', '#908ca2'];
    pc.rect(cx - 16, cy - 10, 32, 12, stone[1]);
    pc.rect(cx - 16, cy - 10, 3, 12, stone[2]);
    for (let x = cx - 16; x < cx + 16; x += 3) pc.rect(x, cy - 12, 2, 2, stone[1]);
    pc.rect(cx - 20, cy - 20, 7, 22, stone[1]);
    pc.rect(cx - 20, cy - 20, 2, 22, stone[3]);
    pc.rect(cx + 13, cy - 20, 7, 22, stone[0]);
    pc.rect(cx - 5, cy - 28, 10, 30, stone[1]);
    pc.rect(cx - 5, cy - 28, 3, 30, stone[3]);
    for (const [x, y] of [[cx - 20, cy - 22], [cx + 13, cy - 22], [cx - 5, cy - 30]] as [number, number][]) for (let k = 0; k < 7; k += 2) pc.rect(x + k, y, 1, 2, stone[2]);
    pc.rect(cx - 2, cy - 4, 4, 6, '#1a1420');
    pc.px(cx - 17, cy - 14, '#f8d070');
    pc.px(cx + 16, cy - 14, '#f8d070');
    this.flags = [
      { x: cx - 17, y: cy - 30, c: KINGDOM_COLORS[0].main },
      { x: cx, y: cy - 38, c: KINGDOM_COLORS[3].main },
      { x: cx + 16, y: cy - 30, c: KINGDOM_COLORS[0].main },
    ];
    // mid hills
    ridge(H * 0.64, 14, 50, 11, '#3d6a34', '#4e8040');
    // fields on mid hills
    for (let y = Math.floor(H * 0.58); y < H * 0.7; y++)
      for (let x = Math.floor(W * 0.55); x < W * 0.9; x++) {
        if ((pc.get(x, y) >>> 24) === 0) continue;
        const band = Math.floor((x + y * 2) / 9) % 3;
        if (fbm(x / 20, y / 10, 2, 5) > 0.55) pc.px(x, y, band === 0 ? RAMP.wheat[3] : band === 1 ? RAMP.wheat[2] : RAMP.crops[2]);
      }
    // near ground
    for (let y = Math.floor(H * 0.68); y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = fbm(x / 14, y / 8, 3, 21);
        const v = 0.3 + (y / H) * 0.4 + (n - 0.5) * 0.6;
        const r = RAMP.grass;
        pc.px(x, y, r[Math.max(0, Math.min(r.length - 1, Math.round((1 - v) * (r.length - 1) + BAYER4[(x & 3) + ((y & 3) << 2)] * 0.7)))]);
      }
    // road
    this.roadPts = [];
    for (let i = 0; i <= 200; i++) this.roadPts.push(this.road(i / 200));
    for (const [x, y] of this.roadPts) {
      for (let dx = -5; dx <= 5; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const d = Math.abs(dx) / 5 + Math.abs(dy) / 2.5;
          if (d > 1) continue;
          pc.px(x + dx, y + dy, d > 0.75 ? RAMP.road[1] : RAMP.road[3 + (hash2(x + dx, y + dy, 2) > 0.8 ? 1 : 0)]);
        }
    }
    // river
    for (let x = 0; x < W; x++) {
      const y = H * 0.72 + Math.sin(x / 30) * 4 + x * 0.06 + 18;
      for (let dy = -2; dy <= 2; dy++) pc.px(x, y + dy, dy === -2 ? '#c8e0e8' : RAMP.water[5 - Math.abs(dy)]);
    }
    // trees (left and right clusters)
    const trees: [number, number, number, number][] = [];
    for (let i = 0; i < 26; i++) trees.push([Math.random() * W * 0.28, H * 0.66 + Math.random() * H * 0.22, Math.random() < 0.5 ? 1 : 2, Math.floor(Math.random() * 3)]);
    for (let i = 0; i < 16; i++) trees.push([W * 0.82 + Math.random() * W * 0.2, H * 0.64 + Math.random() * H * 0.25, Math.random() < 0.6 ? 1 : 3, Math.floor(Math.random() * 3)]);
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y, sp, v] of trees) {
      const t = drawTree(sp, v, 0);
      pc.draw(t.pc, Math.round(x - t.ax), Math.round(y - t.ay));
    }
    // windmill silhouette
    const wx = Math.round(W * 0.62);
    const wy = Math.round(H * 0.6);
    pc.rect(wx - 4, wy - 18, 8, 18, RAMP.plaster[2]);
    pc.rect(wx - 4, wy - 18, 2, 18, RAMP.plaster[4]);
    for (let k = 0; k < 6; k++) pc.hline(wx - 5 + k, wx + 4 - k, wy - 19 - k, k < 2 ? RAMP.thatch[3] : RAMP.thatch[2]);
    this.windmill = { x: wx, y: wy - 18 };
    this.staticLayer = pc.flush();
    void mix;
  }

  private windmill = { x: 0, y: 0 };

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.draw(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(dt: number) {
    if (!this.staticLayer) this.buildStatic();
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.staticLayer!, 0, 0);
    // clouds
    for (const c of this.clouds) {
      c.x += c.s * dt;
      if (c.x > W + 40) c.x = -c.w - 10;
      ctx.fillStyle = 'rgba(248,220,200,0.5)';
      ctx.fillRect(Math.round(c.x), Math.round(c.y), Math.round(c.w), 3);
      ctx.fillRect(Math.round(c.x + c.w * 0.2), Math.round(c.y - 2), Math.round(c.w * 0.5), 2);
      ctx.fillStyle = 'rgba(200,150,170,0.35)';
      ctx.fillRect(Math.round(c.x + 2), Math.round(c.y + 3), Math.round(c.w - 4), 1);
    }
    // flags
    for (const f of this.flags) {
      ctx.fillStyle = '#3a2a1c';
      ctx.fillRect(f.x, f.y, 1, 8);
      ctx.fillStyle = f.c;
      for (let k = 0; k < 5; k++) {
        const wave = Math.round(Math.sin(this.t * 6 + k * 0.9 + f.x) * 0.8);
        ctx.fillRect(f.x + 1 + k, f.y + wave, 1, 3);
      }
    }
    // windmill blades
    const b = this.blades[Math.floor(this.t * 3) % 4];
    ctx.drawImage(b, this.windmill.x - 13, this.windmill.y - 13);
    // marching columns
    for (const s of this.soldiers) {
      s.t += (s.speed * dt * s.dir) / (W + 40);
      if (s.t > 1.05) s.t -= 1.1;
      if (s.t < -0.05) s.t += 1.1;
      const [x, y] = this.road(Math.max(0, Math.min(1, s.t)));
      const fr = s.frames[(((Math.floor(this.t * 7 + s.t * 50) % 4) + 4) % 4)];
      ctx.drawImage(fr, Math.round(x - fr.width / 2), Math.round(y - fr.height + 3));
    }
    // birds
    if (Math.random() < dt * 0.5 && this.birds.length < 8) this.birds.push({ x: -5, y: 20 + Math.random() * 40, t: 0, v: 18 + Math.random() * 10 });
    ctx.fillStyle = '#2a2030';
    for (const bd of this.birds) {
      bd.t += dt;
      bd.x += bd.v * dt;
      const flap = Math.floor(bd.t * 8) % 2;
      const x = Math.round(bd.x);
      const y = Math.round(bd.y + Math.sin(bd.t * 2) * 2);
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x - 1, y - flap, 1, 1);
      ctx.fillRect(x + 1, y - flap, 1, 1);
      ctx.fillRect(x - 2, y - 1 + flap * 2 - 1, 1, 1);
      ctx.fillRect(x + 2, y - 1 + flap * 2 - 1, 1, 1);
    }
    this.birds = this.birds.filter((bd) => bd.x < W + 10);
    // vignette
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,6,16,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }
}

function flip(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = c.width;
  o.height = c.height;
  const x = o.getContext('2d')!;
  x.translate(c.width, 0);
  x.scale(-1, 1);
  x.drawImage(c, 0, 0);
  return o;
}

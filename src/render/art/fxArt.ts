import { PixelCanvas } from './PixelCanvas';
import { MIL, OUTLINE, RAMP } from './palette';
import { blob } from './propArt';
import { art } from './ArtRegistry';

/** Small effect sprites: particles, projectiles, resource icons. */
export function buildFxArt() {
  const add = (name: string, pc: PixelCanvas, ax = pc.w / 2, ay = pc.h / 2) => art.add(name, pc, ax, ay);
  // ---- soft puffs (white, tinted at runtime)
  for (const r of [2, 3, 4, 6]) {
    const pc = new PixelCanvas(r * 2 + 2, r * 2 + 2);
    blob(pc, r + 1, r + 1, r, r, ['#b8b0c0', '#d8d0dc', '#f0ecf4', '#ffffff'], r);
    add(`fx/puff${r}`, pc);
  }
  // ---- spark & star
  {
    const pc = new PixelCanvas(3, 3);
    pc.px(1, 1, '#ffffff');
    pc.px(0, 1, '#fff0a0');
    pc.px(2, 1, '#fff0a0');
    pc.px(1, 0, '#fff0a0');
    pc.px(1, 2, '#fff0a0');
    add('fx/spark', pc);
    const p2 = new PixelCanvas(1, 1);
    p2.px(0, 0, '#ffffff');
    add('fx/dot', p2);
    const p3 = new PixelCanvas(2, 2);
    p3.rect(0, 0, 2, 2, '#ffffff');
    add('fx/dot2', p3);
    const st = new PixelCanvas(7, 7);
    st.line(3, 0, 3, 6, '#fff8d0');
    st.line(0, 3, 6, 3, '#fff8d0');
    st.px(3, 3, '#ffffff');
    st.px(2, 2, '#fff0a0');
    st.px(4, 4, '#fff0a0');
    st.px(2, 4, '#fff0a0');
    st.px(4, 2, '#fff0a0');
    add('fx/star', st);
  }
  // ---- weapon trails: a curved slash in three beats (flash, full arc, fading tips)
  for (let k = 0; k < 3; k++) {
    const pc = new PixelCanvas(13, 13);
    const a0 = -1.1;
    const a1 = 1.1;
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((a1 - a0) * i) / 24;
      const edge = i < 4 || i > 20;
      if (k === 2 && !edge && i % 3 !== 0) continue;
      const r = 5 + (k === 1 ? 0.5 : 0);
      const x = 6 + Math.cos(a) * r;
      const y = 6 + Math.sin(a) * r;
      pc.px(x, y, edge ? '#fff0a0' : '#ffffff');
      if (k === 1 && !edge) pc.px(6 + Math.cos(a) * (r - 1), 6 + Math.sin(a) * (r - 1), '#fff8d8');
    }
    add(`fx/slash${k}`, pc);
  }
  // ---- shockwave ring (drawn round, squashed into perspective at runtime)
  {
    const pc = new PixelCanvas(25, 25);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pc.px(12 + Math.cos(a) * 11.5, 12 + Math.sin(a) * 11.5, '#ffffff');
      if (i % 2 === 0) pc.px(12 + Math.cos(a) * 10.5, 12 + Math.sin(a) * 10.5, '#e8e0f0');
    }
    add('fx/ring', pc);
  }
  // ---- light beam (capture / upgrade / research): soft vertical column, anchored at its foot
  {
    const pc = new PixelCanvas(7, 48);
    for (let y = 0; y < 48; y++) {
      const fade = y / 47;
      for (let x = 0; x < 7; x++) {
        const edge = Math.abs(x - 3) / 3.5;
        const a = Math.max(0, (1 - edge * edge) * (0.25 + 0.75 * fade));
        if (a < 0.08) continue;
        const v = Math.round(255 * a);
        pc.data[y * 7 + x] = ((v & 255) << 24) | (0xff << 16) | (0xff << 8) | 0xff;
      }
    }
    add('fx/beam', pc, 3.5, 47);
  }
  // ---- impact crater / scorch decal
  {
    const pc = new PixelCanvas(20, 9);
    pc.ellipse(10, 4.5, 9, 4, '#3a2c22');
    pc.ellipse(10, 4.5, 6.5, 2.8, '#2a1e18');
    pc.ellipse(9, 4, 3.5, 1.5, '#1e1612');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      pc.px(10 + Math.cos(a) * 9.5, 4.5 + Math.sin(a) * 4.3, '#5a4632');
    }
    add('fx/crater', pc, 10, 4.5);
  }
  // ---- gear knocked loose (helmet), spins off a fallen soldier
  {
    const pc = new PixelCanvas(5, 4);
    pc.rect(1, 0, 3, 2, RAMP.metal[4]);
    pc.hline(0, 4, 2, RAMP.metal[2]);
    pc.px(1, 0, RAMP.metal[6]);
    pc.outline(OUTLINE, 0.8);
    add('fx/helm', pc);
  }
  // ---- speech bubbles: fight (crossed swords), flee (white flag), cheer (note), alert (!)
  for (const kind of ['fight', 'flee', 'cheer', 'alert', 'chat'] as const) {
    const pc = new PixelCanvas(11, 12);
    pc.rect(1, 0, 9, 9, '#fff8e8');
    pc.hline(0, 10, 1, '#fff8e8');
    pc.hline(0, 10, 7, '#fff8e8');
    pc.rect(0, 1, 11, 7, '#fff8e8');
    pc.px(3, 9, '#fff8e8');
    pc.px(4, 9, '#fff8e8');
    pc.px(3, 10, '#fff8e8');
    const ink = '#2a2028';
    if (kind === 'fight') {
      pc.line(2, 1, 8, 7, '#7a8090');
      pc.line(8, 1, 2, 7, '#9aa0b0');
      pc.px(2, 7, '#8a5a2a');
      pc.px(8, 7, '#8a5a2a');
      pc.px(5, 4, '#ffffff');
    } else if (kind === 'flee') {
      pc.vline(3, 1, 7, '#6a4a2a');
      pc.rect(4, 1, 4, 3, '#f8f8f8');
      pc.hline(4, 7, 4, '#c8c8d0');
      pc.px(7, 1, '#d8d8e0');
    } else if (kind === 'cheer') {
      pc.vline(6, 1, 6, ink);
      pc.hline(6, 8, 1, ink);
      pc.px(8, 2, ink);
      pc.rect(4, 6, 2, 2, ink);
      pc.px(6, 6, ink);
    } else if (kind === 'chat') {
      for (const x of [2, 5, 8]) pc.px(x, 4, ink);
    } else {
      pc.vline(5, 1, 5, '#c82828');
      pc.vline(4, 2, 4, '#e83838');
      pc.px(5, 7, '#c82828');
    }
    pc.outline(OUTLINE, 0.9);
    add(`fx/bub_${kind}`, pc, 5.5, 11);
  }
  // ---- flames
  for (let k = 0; k < 4; k++) {
    const pc = new PixelCanvas(9, 13);
    const F = RAMP.fire;
    const sway = [0, 1, 0, -1][k];
    for (let y = 0; y < 12; y++) {
      const hw = Math.max(0, 3.6 * Math.sin(((y + 1) / 13) * Math.PI) * (y > 6 ? 1 : 0.9));
      for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
        if (Math.abs(x) > hw) continue;
        const d = Math.abs(x) / Math.max(1, hw);
        const hot = 1 - d * 0.6 - (12 - y) * 0.035;
        const i = Math.max(1, Math.min(5, Math.round(hot * 5)));
        pc.px(4 + x + Math.round(sway * (1 - y / 12)), y, F[i]);
      }
    }
    add(`fx/flame${k}`, pc, 4, 12);
  }
  // ---- chips & leaves
  {
    const w = new PixelCanvas(2, 2);
    w.px(0, 0, RAMP.wood[5]);
    w.px(1, 0, RAMP.wood[3]);
    w.px(0, 1, RAMP.wood[3]);
    add('fx/woodchip', w);
    const s = new PixelCanvas(2, 2);
    s.px(0, 0, RAMP.stone[5]);
    s.px(1, 1, RAMP.stone[2]);
    s.px(1, 0, RAMP.stone[3]);
    add('fx/stonechip', s);
    const l = new PixelCanvas(3, 2);
    l.px(0, 0, '#5a9a3a');
    l.px(1, 0, '#78b048');
    l.px(1, 1, '#4a8030');
    l.px(2, 1, '#5a9a3a');
    add('fx/leaf', l);
    const d = new PixelCanvas(2, 2);
    d.px(0, 0, RAMP.dirt[3]);
    d.px(1, 1, RAMP.dirt[1]);
    d.px(1, 0, RAMP.dirt[2]);
    add('fx/dirt', d);
    const g = new PixelCanvas(3, 3);
    g.px(1, 0, RAMP.goldm[4]);
    g.px(0, 1, RAMP.goldm[3]);
    g.px(1, 1, RAMP.goldm[4]);
    g.px(2, 1, RAMP.goldm[2]);
    g.px(1, 2, RAMP.goldm[1]);
    add('fx/coin', g);
    const wd = new PixelCanvas(2, 3);
    wd.px(0, 0, '#d8ecf4');
    wd.px(1, 1, '#a8d0e4');
    wd.px(0, 2, '#88b8d4');
    add('fx/drop', wd);
    const hay = new PixelCanvas(3, 1);
    hay.hline(0, 2, 0, RAMP.hay[3]);
    add('fx/straw', hay);
  }
  // ---- projectiles (drawn pointing right)
  {
    const a = new PixelCanvas(9, 3);
    a.hline(1, 6, 1, RAMP.wood[5]);
    a.px(7, 1, RAMP.metal[5]);
    a.px(8, 1, RAMP.metal[6]);
    a.px(0, 0, '#e8e0d0');
    a.px(0, 2, '#e8e0d0');
    a.px(1, 0, '#d0c8b8');
    a.px(1, 2, '#d0c8b8');
    add('fx/arrow', a, 4.5, 1.5);
    const b = new PixelCanvas(7, 3);
    b.hline(0, 5, 1, RAMP.wood[3]);
    b.px(6, 1, RAMP.metal[5]);
    b.px(5, 0, RAMP.metal[3]);
    b.px(5, 2, RAMP.metal[3]);
    add('fx/bolt', b, 3.5, 1.5);
    const bb = new PixelCanvas(15, 5);
    bb.hline(0, 12, 2, RAMP.wood[4]);
    bb.hline(0, 12, 1, RAMP.wood[5]);
    bb.rect(12, 1, 3, 3, RAMP.metal[4]);
    bb.px(14, 2, RAMP.metal[6]);
    bb.px(0, 0, '#d0c8b8');
    bb.px(0, 4, '#d0c8b8');
    bb.outline(OUTLINE, 0.5);
    add('fx/ballista', bb, 7.5, 2.5);
    for (const [n, r] of [['rock', 2.6], ['bigrock', 3.8]] as const) {
      const pc = new PixelCanvas(Math.ceil(r * 2 + 3), Math.ceil(r * 2 + 3));
      blob(pc, pc.w / 2, pc.h / 2, r, r * 0.9, RAMP.stone, 7);
      pc.outline(OUTLINE, 0.6);
      add(`fx/${n}`, pc);
    }
    // stuck arrow in ground (angled shaft + fletching)
    const s = new PixelCanvas(5, 7);
    s.line(1, 0, 3, 5, RAMP.wood[5]);
    s.px(0, 0, '#e8e0d0');
    s.px(1, 1, '#d0c8b8');
    s.px(3, 6, '#3a2a20');
    add('fx/stuck', s, 3, 6);
    const sh = new PixelCanvas(5, 3);
    sh.ellipse(2.5, 1.5, 2.5, 1.2, '#1a1020');
    add('fx/shadow', sh);
  }
  buildModernFx(add);
  // ---- resource icons (also used by the HUD via data URLs)
  for (const [name, pc] of Object.entries(resourceIcons())) add(`icon/${name}`, pc);
  // ---- rally flag / capture banner
  {
    const pc = new PixelCanvas(9, 16);
    pc.vline(1, 1, 15, RAMP.wood[2]);
    pc.rect(2, 1, 6, 5, '#ffffff');
    pc.px(8, 2, '#ffffff');
    pc.px(8, 4, '#ffffff');
    pc.outline(OUTLINE, 0.6);
    add('fx/flag', pc, 1, 15);
  }
}

let iconCache: Record<string, PixelCanvas> | null = null;
export function resourceIcons(): Record<string, PixelCanvas> {
  if (iconCache) return iconCache;
  const G = RAMP.goldm;
  const gold = new PixelCanvas(10, 10);
  // coin stack
  gold.ellipse(5, 7, 3.5, 1.8, G[1]);
  gold.ellipse(5, 6, 3.5, 1.8, G[2]);
  gold.ellipse(5, 5, 3.5, 1.8, G[3]);
  gold.ellipse(5, 4, 3.5, 1.8, G[4]);
  gold.px(4, 4, '#fff8d0');
  gold.outline(OUTLINE, 0.7);
  const wood = new PixelCanvas(10, 10);
  wood.rect(1, 5, 8, 3, RAMP.wood[3]);
  wood.rect(2, 2, 7, 3, RAMP.wood[4]);
  wood.hline(2, 8, 2, RAMP.wood[5]);
  wood.rect(8, 2, 1, 3, '#d8b080');
  wood.rect(8, 5, 1, 3, '#c09060');
  wood.px(8, 3, '#a87848');
  wood.outline(OUTLINE, 0.7);
  const food = new PixelCanvas(10, 10);
  // wheat sheaf + bread
  food.ellipse(5, 6.5, 4, 2.4, '#c88a40');
  food.ellipse(5, 6, 3.5, 1.8, '#e0a858');
  food.px(4, 5, '#f8d090');
  food.line(3, 1, 4, 4, RAMP.wheat[3]);
  food.line(6, 1, 5, 4, RAMP.wheat[3]);
  food.px(3, 1, RAMP.wheat[4]);
  food.px(6, 1, RAMP.wheat[4]);
  food.outline(OUTLINE, 0.7);
  const stone = new PixelCanvas(10, 10);
  blob(stone, 4, 6, 3.5, 2.8, RAMP.stone, 3);
  blob(stone, 6.5, 4.5, 2.6, 2.2, RAMP.stone, 5, 0.1);
  stone.outline(OUTLINE, 0.7);
  const pop = new PixelCanvas(10, 10);
  pop.rect(3, 1, 4, 4, RAMP.skin[3]);
  pop.rect(3, 1, 4, 1, '#5a3a1e');
  pop.px(5, 3, '#201820');
  pop.rect(2, 5, 6, 4, '#7a6a4a');
  pop.hline(2, 7, 5, '#9a8a64');
  pop.outline(OUTLINE, 0.7);
  const sword = new PixelCanvas(10, 10);
  sword.line(2, 8, 8, 2, RAMP.metal[5]);
  sword.line(3, 8, 8, 3, RAMP.metal[3]);
  sword.line(1, 6, 4, 9, RAMP.goldm[2]);
  sword.px(1, 9, RAMP.wood[2]);
  sword.outline(OUTLINE, 0.7);
  const crown = new PixelCanvas(10, 10);
  crown.rect(1, 4, 8, 4, G[3]);
  crown.px(1, 2, G[4]);
  crown.px(1, 3, G[3]);
  crown.px(4, 2, G[4]);
  crown.px(5, 2, G[4]);
  crown.px(4, 3, G[3]);
  crown.px(5, 3, G[3]);
  crown.px(8, 2, G[4]);
  crown.px(8, 3, G[3]);
  crown.hline(1, 8, 7, G[1]);
  crown.px(3, 5, '#c83a3a');
  crown.px(6, 5, '#3a63c8');
  crown.outline(OUTLINE, 0.7);
  iconCache = { gold, wood, food, stone, pop, sword, crown, ...modernIcons() };
  return iconCache;
}

/** PNG data URL for DOM usage (scaled with CSS pixelated) */
export function iconDataUrl(name: string): string {
  const pc = resourceIcons()[name];
  if (!pc) return '';
  return pc.flush().toDataURL();
}

// ---------------------------------------------------------------------------------------------
// modern era: tracers, rockets, shells, muzzle flashes, explosions, brass, scorch decals
type AddFn = (name: string, pc: PixelCanvas, ax?: number, ay?: number) => void;

function hashf(x: number, y: number, s: number): number {
  const r = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return r - Math.floor(r);
}

function buildModernFx(add: AddFn) {
  const F = RAMP.fire;
  const SM = RAMP.smoke;
  // ---- projectiles (pointing right)
  {
    const b = new PixelCanvas(4, 1);
    b.px(3, 0, '#ffffff');
    b.px(2, 0, '#fff4b0');
    b.blend(1, 0, '#ffd860', 0.85);
    b.blend(0, 0, '#f0a030', 0.5);
    add('fx/bullet', b, 2, 0.5);
    const r = new PixelCanvas(7, 3);
    r.hline(2, 5, 1, MIL.olive[3]);
    r.px(3, 0, MIL.olive[4]);
    r.px(6, 1, MIL.olive[1]);
    r.px(5, 1, MIL.olive[2]);
    r.px(2, 0, MIL.olive[1]);
    r.px(2, 2, MIL.olive[1]);
    r.px(1, 1, '#ffd860');
    r.blend(0, 1, '#f08a28', 0.7);
    add('fx/rocket', r, 3.5, 1.5);
    const g = new PixelCanvas(3, 3);
    g.px(1, 0, MIL.olive[3]);
    g.rect(0, 1, 3, 2, MIL.olive[2]);
    g.px(0, 1, MIL.olive[4]);
    g.px(2, 2, MIL.olive[0]);
    g.px(1, 0, '#8a8a80');
    add('fx/grenade', g);
    const sh = new PixelCanvas(3, 2);
    sh.hline(0, 1, 0, MIL.grey[4]);
    sh.hline(0, 1, 1, MIL.grey[2]);
    sh.px(2, 0, MIL.grey[5]);
    sh.px(2, 1, MIL.grey[3]);
    add('fx/shell', sh);
    const ts = new PixelCanvas(5, 2);
    ts.hline(2, 4, 0, '#fff8d8');
    ts.hline(2, 4, 1, '#ffd860');
    ts.px(4, 0, '#ffffff');
    ts.blend(1, 0, '#ffc040', 0.75);
    ts.blend(1, 1, '#f08a28', 0.65);
    ts.blend(0, 0, '#f08a28', 0.35);
    add('fx/tankshell', ts, 2.5, 1);
    const cs = new PixelCanvas(2, 1);
    cs.px(0, 0, MIL.brass[2]);
    cs.px(1, 0, MIL.brass[3]);
    add('fx/casing', cs);
  }
  // ---- muzzle flashes (additive-friendly, anchored at the muzzle, pointing right)
  {
    const m0 = new PixelCanvas(7, 7);
    m0.hline(1, 6, 3, '#ffe27a');
    m0.vline(3, 1, 5, '#ffe27a');
    m0.hline(2, 4, 3, '#ffffff');
    m0.vline(3, 2, 4, '#ffffff');
    m0.px(6, 3, '#ffc040');
    m0.px(5, 2, '#ffc040');
    m0.px(5, 4, '#ffc040');
    m0.blend(2, 2, '#fff2a8', 0.6);
    m0.blend(2, 4, '#fff2a8', 0.6);
    add('fx/muzzle0', m0, 1, 3);
    const m1 = new PixelCanvas(7, 7);
    m1.line(1, 1, 5, 5, '#ffe27a');
    m1.line(1, 5, 5, 1, '#ffe27a');
    m1.hline(2, 6, 3, '#fff2a8');
    m1.rect(2, 2, 3, 3, '#ffffff');
    m1.px(6, 3, '#ffc040');
    add('fx/muzzle1', m1, 1, 3);
  }
  // ---- explosion: flash → fireball → rolling fire under smoke → dark smoke → wisps (24×24, centred)
  for (let k = 0; k < 6; k++) {
    const pc = new PixelCanvas(24, 24);
    const c = 11.5;
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const n = hashf(x, y, k + 3);
        const dx = x - c;
        const dy = (y - c) * (k >= 3 ? 1.1 : 1);
        const d = Math.sqrt(dx * dx + dy * dy) + (n - 0.5) * 2.2;
        switch (k) {
          case 0: {
            if (d < 3.2) pc.px(x, y, '#ffffff');
            else if (d < 5.2) pc.px(x, y, F[5]);
            else if (d < 6.6) pc.blend(x, y, F[4], 0.8);
            else if (d < 8 && (Math.abs(dx) < 1 || Math.abs(dy) < 1 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1)) pc.blend(x, y, F[4], 0.7);
            break;
          }
          case 1: {
            const R = 8;
            if (d > R) break;
            const t = d / R;
            pc.px(x, y, t < 0.35 ? F[5] : t < 0.6 ? F[4] : t < 0.82 ? F[3] : F[2]);
            break;
          }
          case 2: {
            const R = 10;
            if (d > R) break;
            const t = d / R;
            const up = dy < -2 && n > 0.45;
            pc.px(x, y, up && t > 0.6 ? SM[1] : t < 0.25 ? F[4] : t < 0.55 ? F[3] : t < 0.8 ? F[2] : F[1]);
            break;
          }
          case 3: {
            const R = 10.5;
            if (d > R) break;
            const t = d / R;
            const core = Math.sqrt(dx * dx + (y - 15) * (y - 15)) < 4 + n * 1.5;
            pc.px(x, y, core ? (n > 0.5 ? F[3] : F[2]) : t < 0.6 ? (n > 0.6 ? SM[2] : SM[1]) : SM[0]);
            break;
          }
          case 4: {
            const R = 11;
            if (d > R) break;
            const t = d / R;
            pc.blend(x, y, t < 0.5 ? (n > 0.55 ? SM[2] : SM[1]) : n > 0.5 ? SM[1] : SM[0], 0.9);
            if (n > 0.975 && t < 0.7) pc.px(x, y, F[2]);
            break;
          }
          default: {
            const R = 11.5;
            if (d > R || n < 0.35) break;
            pc.blend(x, y, n > 0.7 ? SM[3] : SM[2], 0.45 * (1 - d / R) + 0.1);
          }
        }
      }
    if (k >= 1 && k <= 4) pc.outline(OUTLINE, k <= 2 ? 0.35 : 0.55);
    add(`fx/blast${k}`, pc, 12, 12);
  }
  // ---- scorch decal (dark, soft edges)
  {
    const pc = new PixelCanvas(18, 8);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 18; x++) {
        const dx = (x + 0.5 - 9) / 9;
        const dy = (y + 0.5 - 4) / 4;
        const d = Math.sqrt(dx * dx + dy * dy) + (hashf(x, y, 11) - 0.5) * 0.35;
        if (d > 1) continue;
        const a = d < 0.45 ? 0.8 : d < 0.75 ? 0.6 : 0.3;
        pc.blend(x, y, d < 0.45 ? '#120c0c' : '#241a16', a);
      }
    add('fx/scorch', pc, 9, 4);
  }
  // ---- spark burst for bullet hits on armour
  {
    const pc = new PixelCanvas(5, 5);
    pc.px(2, 2, '#ffffff');
    pc.px(1, 1, '#ffe27a');
    pc.px(3, 1, '#ffe27a');
    pc.px(0, 0, '#ffc040');
    pc.px(4, 0, '#ffc040');
    pc.px(2, 3, '#ffc040');
    pc.px(4, 3, '#f08a28');
    add('fx/sparkhit', pc);
  }
}

/** modern resource icons: cash, lumber, rations, steel, soldier */
function modernIcons(): Record<string, PixelCanvas> {
  const cash = new PixelCanvas(10, 10);
  const B = ['#2e5a32', '#4a7e48', '#6a9e60', '#9ac88a'];
  cash.rect(1, 4, 8, 4, B[1]);
  cash.rect(2, 2, 7, 4, B[2]);
  cash.hline(2, 8, 2, B[3]);
  cash.px(5, 4, B[0]);
  cash.px(5, 3, B[3]);
  cash.hline(1, 8, 7, B[0]);
  cash.vline(4, 2, 7, '#e0d4a8'); // paper band
  cash.vline(5, 2, 7, '#c8b888');
  cash.outline(OUTLINE, 0.7);
  const lumber = new PixelCanvas(10, 10);
  const P = ['#8a6a3a', '#b08a50', '#d4ae6e', '#ecd09a'];
  for (let k = 0; k < 3; k++) {
    lumber.rect(1, 2 + k * 2, 8, 2, k % 2 ? P[1] : P[2]);
    lumber.hline(1, 8, 2 + k * 2, P[3]);
    lumber.px(8, 3 + k * 2, P[0]);
  }
  lumber.vline(3, 2, 7, MIL.steel[2]); // strapping
  lumber.vline(6, 2, 7, MIL.steel[2]);
  lumber.outline(OUTLINE, 0.7);
  const ration = new PixelCanvas(10, 10);
  const O = MIL.olive;
  ration.rect(2, 3, 6, 6, O[3]);
  ration.ellipse(5, 3, 3, 1.3, MIL.grey[5]);
  ration.ellipse(5, 3, 2, 0.8, MIL.grey[4]);
  ration.rect(2, 5, 6, 2, '#d8c8a0'); // label
  ration.px(3, 5, '#a83a2a');
  ration.px(4, 5, '#a83a2a');
  ration.vline(7, 3, 8, O[1]);
  ration.hline(2, 7, 8, O[1]);
  ration.outline(OUTLINE, 0.7);
  const steel = new PixelCanvas(10, 10);
  const S = ['#3a4450', '#56626e', '#7a8794', '#a8b4c0', '#d0d8e0'];
  // I-beam end-on over a short length
  steel.rect(1, 2, 8, 2, S[3]);
  steel.hline(1, 8, 2, S[4]);
  steel.rect(4, 4, 2, 3, S[2]);
  steel.rect(1, 7, 8, 2, S[2]);
  steel.hline(1, 8, 8, S[1]);
  steel.px(5, 4, S[1]);
  steel.px(8, 3, S[2]);
  steel.outline(OUTLINE, 0.7);
  const trooper = new PixelCanvas(10, 10);
  trooper.rect(3, 3, 4, 3, RAMP.skin[3]);
  trooper.px(5, 4, '#201820');
  trooper.hline(3, 6, 1, O[4]);
  trooper.hline(2, 7, 2, O[3]);
  trooper.px(4, 1, O[5]);
  trooper.rect(2, 6, 6, 3, O[3]);
  trooper.hline(2, 7, 6, O[4]);
  trooper.px(2, 7, '#c23a32');
  trooper.outline(OUTLINE, 0.7);
  return { m_gold: cash, m_wood: lumber, m_food: ration, m_stone: steel, m_pop: trooper };
}

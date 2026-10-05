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
  buildSupportFx(add);
  buildAftermathFx(add);
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
  iconCache = { gold, wood, food, stone, pop, sword, crown, ...modernIcons(), ...superIcons() };
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

// ---------------------------------------------------------------------------------------------
// support troops and superweapons: firepots, flame jets, ground fires, missiles, great bombard
// shots, huge explosions, target warnings, smoke columns, hearts and music notes.
// (The flame-jet tongues are 'fx/jet0..3' because 'fx/flame0..3' are the building fires.)

const HEART = ['#a82030', '#e83848', '#ff9aa8'];
const NOTE = ['#c8bc9c', '#fff4d8'];

function buildSupportFx(add: AddFn) {
  const F = RAMP.fire;
  const SM = RAMP.smoke;
  // ---- firepot in flight: clay pot with a burning rag tuft
  {
    const pc = new PixelCanvas(7, 8);
    const C = ['#4a2216', '#7a3e26', '#a85a36', '#c87c4c'];
    pc.rect(2, 4, 3, 3, C[2]);
    pc.px(2, 4, C[3]);
    pc.vline(4, 4, 6, C[1]);
    pc.px(3, 6, C[1]);
    pc.px(3, 3, C[0]);
    pc.outline(OUTLINE, 0.6);
    pc.px(3, 2, F[5]);
    pc.px(2, 2, F[4]);
    pc.px(4, 2, F[3]);
    pc.px(3, 1, F[4]);
    pc.px(2, 1, F[2]);
    pc.px(3, 0, F[3]);
    add('fx/firepot', pc, 3.5, 5);
  }
  // ---- flame-jet tongues (pointing right, the way the jet flows): fresh and white-hot → ragged and red
  for (let k = 0; k < 4; k++) {
    const pc = new PixelCanvas(8, 6);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 8; x++) {
        const u = (x + 0.5) / 8; // 0 tail .. 1 tip
        const half = 2.9 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.5 + 0.15) * (1 - Math.max(0, u - 0.55) * 1.6);
        const dy = Math.abs(y + 0.5 - 3 + (k === 2 ? 0.5 : k === 3 ? -0.5 : 0) * u);
        const n = hashf(x, y, 40 + k);
        if (dy > half + (n - 0.5) * 0.9) continue;
        if (k >= 2 && n < 0.12 * k) continue;
        const heat = 1 - dy / Math.max(0.6, half) * 0.55 - u * 0.35 - k * 0.14 + (n - 0.5) * 0.2;
        const c = heat > 0.8 ? '#ffffff' : heat > 0.66 ? F[5] : heat > 0.5 ? F[4] : heat > 0.36 ? F[3] : heat > 0.2 ? F[2] : F[1];
        pc.px(x, y, c);
      }
    add(`fx/jet${k}`, pc);
  }
  // ---- small burning-ground / building fire loop (anchored at its foot)
  for (let k = 0; k < 4; k++) {
    const pc = new PixelCanvas(8, 10);
    const tongues: [number, number, number][] = [
      [2, [6, 7, 5, 6][k], [0, 1, 0, -1][k]],
      [5, [8, 6, 7, 9][k], [1, 0, -1, 0][k]],
      [4, [4, 5, 6, 4][k], [-1, 0, 1, 0][k]],
    ];
    for (const [tx, th, sway] of tongues)
      for (let j = 0; j < th; j++) {
        const t = j / th;
        const hw = 1.6 * (1 - t) + 0.3;
        const xc = tx + Math.round(sway * t);
        for (let x = Math.floor(xc - hw); x <= Math.ceil(xc + hw); x++) {
          if (Math.abs(x + 0.5 - (xc + 0.5)) > hw) continue;
          const d = Math.abs(x - xc) / Math.max(1, hw);
          const heat = 1 - t * 0.7 - d * 0.45;
          const c = heat > 0.72 ? F[5] : heat > 0.55 ? F[4] : heat > 0.38 ? F[3] : F[2];
          const y = 8 - j;
          const cur = pc.get(x, y);
          // keep the hotter of two overlapping tongues
          if (cur && heat < 0.55) continue;
          pc.px(x, y, c);
        }
      }
    // embers / charred ground at the base
    for (let x = 0; x < 8; x++) pc.px(x, 9, hashf(x, k, 9) > 0.5 ? F[1] : F[0]);
    pc.px([1, 6, 3, 5][k], 9, F[3]);
    // a spark floating off
    pc.px([6, 1, 5, 2][k], [1, 2, 0, 1][k], F[4]);
    add(`fx/fire${k}`, pc, 4, 9);
  }
  // ---- ballistic missile (pointing right): white body, red nose, dark fins
  {
    const pc = new PixelCanvas(12, 4);
    const Wt = ['#8a8e94', '#c4c6c4', '#eeece4'];
    pc.hline(2, 9, 1, Wt[2]);
    pc.hline(2, 9, 2, Wt[1]);
    pc.px(5, 2, Wt[0]);
    pc.hline(6, 7, 1, '#c03028'); // band
    pc.hline(6, 7, 2, '#8a1e1a');
    pc.px(10, 1, '#d83a2c');
    pc.px(10, 2, '#a02820');
    pc.px(11, 1, '#e8584a');
    pc.px(11, 2, '#c03028');
    pc.px(2, 0, MIL.grey[2]);
    pc.px(3, 0, MIL.grey[3]);
    pc.px(2, 3, MIL.grey[1]);
    pc.px(3, 3, MIL.grey[2]);
    pc.px(1, 1, MIL.steel[2]);
    pc.px(1, 2, MIL.steel[1]);
    pc.blend(0, 1, '#ffd860', 0.9);
    pc.blend(0, 2, '#f08a28', 0.8);
    add('fx/missile', pc, 6, 2);
  }
  // ---- great bombard shot: huge flaming stone with a fire trail behind (moving right)
  {
    const pc = new PixelCanvas(11, 8);
    for (let x = 0; x < 6; x++)
      for (let y = 1; y < 7; y++) {
        const dy = Math.abs(y + 0.5 - 4);
        const reach = (x + 1) / 6;
        if (dy > reach * 3 + (hashf(x, y, 21) - 0.5)) continue;
        const heat = reach - dy * 0.12 + (hashf(x, y, 22) - 0.5) * 0.3;
        pc.px(x, y, heat > 0.85 ? F[5] : heat > 0.6 ? F[4] : heat > 0.4 ? F[3] : heat > 0.2 ? F[2] : F[1]);
      }
    blob(pc, 7, 4, 3.1, 3.1, RAMP.stone.slice(0, 6), 13);
    // fire licking round the back of the stone, cracks glowing
    for (const [x, y, c] of [[5, 2, F[3]], [4, 3, F[4]], [5, 3, F[4]], [4, 4, F[5]], [5, 4, F[5]], [4, 5, F[4]], [5, 5, F[3]], [6, 6, F[2]], [6, 1, F[2]], [7, 4, F[3]], [8, 5, F[2]]] as [number, number, string][])
      pc.px(x, y, c);
    pc.px(9, 2, RAMP.stone[6]);
    add('fx/fireball', pc, 7, 4);
  }
  // ---- huge explosion: flash → fireball → mushroom under a smoke cap → dark rolling smoke → thinning → wisps
  for (let k = 0; k < 6; k++) {
    const S = 48;
    const pc = new PixelCanvas(S, S);
    const c = 23.5;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const n = hashf(x, y, k + 31);
        const n2 = hashf(x >> 1, y >> 1, k + 57);
        const dx = x - c;
        const dy = y - c;
        const d = Math.sqrt(dx * dx + dy * dy) + (n2 - 0.5) * 4;
        switch (k) {
          case 0: {
            if (d < 7) pc.px(x, y, '#ffffff');
            else if (d < 11) pc.px(x, y, F[5]);
            else if (d < 13.5) pc.blend(x, y, F[4], 0.85);
            else if (d < 20 && (Math.abs(dx) < 1.2 || Math.abs(dy) < 1.2 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.4)) pc.blend(x, y, F[4], 0.7 * (1 - d / 20) + 0.2);
            break;
          }
          case 1: {
            const R = 16;
            if (d > R) break;
            const t = d / R;
            pc.px(x, y, t < 0.3 ? '#ffffff' : t < 0.45 ? F[5] : t < 0.65 ? F[4] : t < 0.85 ? F[3] : F[2]);
            break;
          }
          case 2:
          case 3:
          case 4: {
            // cap (fire under smoke), stem and the ground ring
            const capY = [14, 12, 10][k - 2];
            const capRx = [14, 16, 18][k - 2];
            const capRy = [9, 10, 10][k - 2];
            const cdx = dx / capRx;
            const cdy = (y - capY) / capRy;
            const cd = Math.sqrt(cdx * cdx + cdy * cdy) + (n2 - 0.5) * 0.28;
            const sw = [3.5, 3, 2.6][k - 2] + (n - 0.5) * 1.4;
            const stem = y > capY && y < 38 && Math.abs(dx) < sw + (y > 32 ? (y - 32) * 0.8 : 0);
            const gdx = dx / [17, 20, 22][k - 2];
            const gdy = (y - 38) / 5;
            const gd = Math.sqrt(gdx * gdx + gdy * gdy) + (n2 - 0.5) * 0.3;
            const fade = k === 4 ? 0.82 : 1;
            if (cd < 1) {
              const under = cdy > 0.15;
              const smokeTop = cdy < -0.1 + (n2 - 0.5) * 0.6 + Math.abs(cdx) * 0.25;
              if (k === 2) pc.px(x, y, cd < 0.45 && under ? F[5] : cd < 0.65 && under ? F[4] : smokeTop ? (n > 0.5 ? SM[1] : SM[0]) : cd < 0.8 ? F[3] : F[2]);
              else if (k === 3) pc.px(x, y, under && cd < 0.55 ? (n > 0.5 ? F[3] : F[2]) : cdy < -0.2 ? (n > 0.6 ? SM[2] : SM[1]) : n > 0.5 ? SM[1] : SM[0]);
              else pc.blend(x, y, cd < 0.6 ? (n > 0.55 ? SM[2] : SM[1]) : n > 0.5 ? SM[1] : SM[0], fade);
            } else if (stem) {
              const t = (y - capY) / (38 - capY);
              if (k === 2) pc.px(x, y, Math.abs(dx) < sw * 0.45 ? F[5] : t > 0.7 ? F[2] : F[3]);
              else if (k === 3) pc.px(x, y, Math.abs(dx) < sw * 0.4 && n > 0.4 ? F[2] : n > 0.5 ? SM[1] : SM[0]);
              else if (n > 0.3) pc.blend(x, y, n > 0.7 ? SM[2] : SM[1], 0.75);
            } else if (gd < 1) {
              if (k === 2) pc.px(x, y, gd < 0.5 ? F[4] : gd < 0.8 ? F[2] : SM[1]);
              else if (k === 3) pc.px(x, y, gd < 0.4 && n > 0.5 ? F[2] : n > 0.5 ? SM[2] : SM[1]);
              else if (n > 0.25) pc.blend(x, y, SM[2], 0.7);
            }
            if (k >= 3 && n > 0.985 && (cd < 0.9 || gd < 0.9)) pc.px(x, y, F[3]); // embers
            break;
          }
          default: {
            // wisps drifting from where the cap was
            const wy = (y - 12) / 12;
            const wd = Math.sqrt((dx / 20) ** 2 + wy * wy) + (n2 - 0.5) * 0.4;
            if (wd > 1 || n < 0.4) break;
            pc.blend(x, y, n > 0.75 ? SM[3] : SM[2], 0.45 * (1 - wd) + 0.12);
            const gy = (y - 38) / 5;
            if (Math.sqrt((dx / 20) ** 2 + gy * gy) < 1 && n > 0.7) pc.blend(x, y, SM[1], 0.35);
          }
        }
      }
    if (k >= 1 && k <= 4) pc.outline(OUTLINE, k <= 2 ? 0.35 : 0.55);
    add(`fx/bigblast${k}`, pc, 24, 24);
  }
  // ---- target warning on the ground: red dashed ellipse with a crosshair
  {
    const pc = new PixelCanvas(24, 12);
    const red = '#e02828';
    const hot = '#ff6a50';
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      if (Math.floor((i / 120) * 16) % 2) continue; // dashes
      pc.px(11.5 + Math.cos(a) * 11, 5.5 + Math.sin(a) * 5, red);
      if (i % 3 === 0) pc.blend(11.5 + Math.cos(a) * 10, 5.5 + Math.sin(a) * 4.2, hot, 0.6);
    }
    pc.hline(5, 9, 6, red);
    pc.hline(14, 18, 6, red);
    pc.vline(12, 3, 4, red);
    pc.vline(12, 8, 9, red);
    pc.px(12, 6, hot);
    add('fx/warn', pc, 12, 6);
  }
  // ---- tall smoke column puff
  {
    const pc = new PixelCanvas(10, 14);
    blob(pc, 5, 9.5, 4, 3.8, SM.slice(1), 3);
    blob(pc, 4.5, 5.5, 3.5, 3.4, SM.slice(1), 5, 0.05);
    blob(pc, 5.5, 3, 2.6, 2.6, SM.slice(2), 7, 0.1);
    add('fx/smokecol', pc);
  }
  // ---- heart (healing)
  {
    const pc = new PixelCanvas(5, 5);
    const rows = ['.#.#.', '#####', '#####', '.###.', '..#..'];
    rows.forEach((r, y) => [...r].forEach((ch, x) => ch === '#' && pc.px(x, y, y >= 3 || x === 4 ? HEART[0] : HEART[1])));
    pc.px(1, 1, HEART[2]);
    pc.px(0, 1, HEART[1]);
    add('fx/heart', pc);
  }
  // ---- music notes (light, tinted at runtime if wanted)
  {
    const n0 = new PixelCanvas(4, 6);
    n0.rect(0, 4, 2, 2, NOTE[1]);
    n0.px(1, 5, NOTE[0]);
    n0.vline(1, 0, 3, NOTE[1]);
    n0.px(2, 1, NOTE[1]);
    n0.px(3, 2, NOTE[0]);
    add('fx/note0', n0);
    const n1 = new PixelCanvas(4, 6);
    // two quavers on a beam
    n1.px(0, 5, NOTE[1]);
    n1.px(2, 4, NOTE[1]);
    n1.px(3, 4, NOTE[0]);
    n1.vline(0, 1, 4, NOTE[1]);
    n1.vline(3, 0, 3, NOTE[1]);
    n1.hline(0, 3, 0, NOTE[1]);
    n1.px(0, 0, NOTE[0]);
    n1.px(1, 1, NOTE[0]);
    add('fx/note1', n1);
  }
}

/** HUD icons for superweapons and building levels */
function superIcons(): Record<string, PixelCanvas> {
  const missile = new PixelCanvas(10, 10);
  // climbing up-right
  missile.line(2, 7, 6, 3, '#eeece4');
  missile.line(3, 7, 7, 3, '#c4c6c4');
  missile.line(2, 6, 6, 2, '#eeece4');
  missile.px(7, 2, '#d83a2c');
  missile.px(8, 1, '#e8584a');
  missile.px(7, 1, '#c03028');
  missile.px(8, 2, '#a02820');
  missile.px(1, 6, MIL.grey[3]); // fins
  missile.px(3, 8, MIL.grey[2]);
  missile.px(1, 8, '#ffc548'); // exhaust
  missile.px(2, 8, '#f8902a');
  missile.outline(OUTLINE, 0.7);
  const bombard = new PixelCanvas(10, 10);
  const M = RAMP.metal;
  bombard.ellipse(5, 5, 3.7, 3.7, M[1]);
  bombard.ellipse(4.6, 4.6, 3, 3, M[2]);
  bombard.ellipse(4.2, 4.2, 1.9, 1.9, M[3]);
  bombard.px(3, 3, M[5]);
  bombard.px(4, 3, M[4]);
  bombard.px(3, 4, M[4]);
  bombard.outline(OUTLINE, 0.7);
  const level = new PixelCanvas(10, 10);
  const G = RAMP.goldm;
  // two rank chevrons
  for (const oy of [0, 3]) {
    level.line(1, 4 + oy, 4, 1 + oy, G[3]);
    level.line(5, 1 + oy, 8, 4 + oy, G[2]);
    level.line(1, 5 + oy, 4, 2 + oy, G[2]);
    level.line(5, 2 + oy, 8, 5 + oy, G[1]);
    level.px(4, 1 + oy, G[4]);
    level.px(5, 1 + oy, G[4]);
  }
  level.outline(OUTLINE, 0.7);
  return { missile, bombard, level };
}

// ---------------------------------------------------------------------------------------------
// battlefield aftermath: dropped gear, trampled earth, wrecks, rubble, tracks (ground decals)

/** paint a character map: each char looks up a colour, '.' / ' ' stay clear */
function paint(pc: PixelCanvas, rows: string[], pal: Record<string, string>, ox = 1, oy = 1) {
  rows.forEach((r, y) => [...r].forEach((ch, x) => pal[ch] && pc.px(ox + x, oy + y, pal[ch])));
}

function buildAftermathFx(add: AddFn) {
  const M = RAMP.metal;
  const W = RAMP.wood;
  // ---- medieval gear (lying flat, drawn horizontal; rotated a little at runtime)
  {
    const pc = new PixelCanvas(12, 5);
    paint(pc, ['..m.......', 'gwmbbbbbbt', '..mddddd..'], { g: RAMP.goldm[2], w: W[2], m: M[3], b: M[5], d: M[3], t: M[4] });
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_sword', pc);
  }
  {
    // round wooden shield: pale face so it takes the owner's colour as a tint
    const pc = new PixelCanvas(9, 7);
    paint(pc, ['.rrrrr.', 'rffffhr', 'rffbffr', 'rfffffr', '.rrrrr.'], { r: W[3], f: '#d8d0c4', h: '#f0ece4', b: M[5] });
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_shield', pc);
    // kite / tower shield lying on its back, point to the right
    const k = new PixelCanvas(10, 7);
    paint(k, ['rrrrr...', 'rffhffr.', 'rffbfffr', 'rffffr..', 'rrrrr...'], { r: M[3], f: '#d8d0c4', h: '#f0ece4', b: M[5] });
    k.outline(OUTLINE, 0.8);
    add('fx/drop_shield_kite', k);
  }
  {
    const pc = new PixelCanvas(14, 5);
    paint(pc, ['..........m.', 'dwwwwwwwwwmh', '..........m.'], { d: W[1], w: W[4], m: M[3], h: M[5] });
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_spear', pc);
  }
  {
    // an unstrung-looking bow on its side: a thin arc, its string, a soft shadow (no heavy outline)
    const pc = new PixelCanvas(12, 7);
    paint(pc, ['...hhhh...', '.ww....ww.', 'w........w', 'd........d'], { h: W[5], w: W[4], d: W[2] }, 1, 0);
    pc.line(2, 4, 9, 4, '#d8d0b8');
    for (let y = 5; y >= 0; y--)
      for (let x = 0; x < 12; x++) if ((pc.get(x, y) >>> 24) !== 0 && (pc.get(x, y + 1) >>> 24) === 0) pc.blend(x, y + 1, OUTLINE, 0.35);
    add('fx/drop_bow', pc);
  }
  // ---- modern gear
  {
    const pc = new PixelCanvas(13, 5);
    paint(pc, ['wwwrrrrbbbb', '.wwrrmr....', '.....m.....'], { w: W[3], r: MIL.steel[3], b: MIL.grey[2], m: MIL.steel[2] });
    pc.px(3, 1, MIL.grey[4]);
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_rifle', pc);
  }
  {
    const O = MIL.olive;
    const pc = new PixelCanvas(8, 6);
    paint(pc, ['.hoo..', 'hooooo', 'dddddd', '.r..r.'], { h: O[5], o: O[4], d: O[2], r: O[1] });
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_helmet', pc);
  }
  {
    const D = MIL.drab;
    const pc = new PixelCanvas(8, 7);
    paint(pc, ['.ffff.', 'fhhhhf', 'dsddsd', 'dsddsd', '.cccc.'], { f: D[4], h: D[5], d: D[3], s: D[1], c: D[2] });
    pc.outline(OUTLINE, 0.8);
    add('fx/drop_pack', pc);
  }
  // ---- trampled earth: churned dark dirt, semi-transparent, ragged edge
  {
    const pc = new PixelCanvas(14, 7);
    const D = RAMP.dirt;
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 14; x++) {
        const dx = (x + 0.5 - 7) / 7;
        const dy = (y + 0.5 - 3.5) / 3.5;
        const d = Math.sqrt(dx * dx + dy * dy) + (hashf(x, y, 71) - 0.5) * 0.5;
        if (d > 1) continue;
        const n = hashf(x, y, 72);
        if (d > 0.7 && n < 0.45) continue;
        if (n > 0.86) pc.blend(x, y, D[4], 0.4);
        else pc.blend(x, y, n < 0.3 ? D[0] : D[1], d < 0.5 ? 0.62 : 0.42);
      }
    add('fx/trample', pc);
  }
  // ---- a small, cartoony splat
  {
    const pc = new PixelCanvas(6, 4);
    paint(pc, ['.ab...', 'aabb.a', '.aaa..', '..a...'], { a: '#6a1618', b: '#8a2224' }, 0, 0);
    pc.px(1, 1, '#4a0e12');
    add('fx/bloodspot', pc);
  }
  // ---- rubble pile: stones, charred timbers and a few roof tiles on a smear of ash
  {
    const pc = new PixelCanvas(20, 10);
    pc.ellipseBlend(10, 6, 9.5, 3.8, '#2a2226', 0.45);
    const S = RAMP.stone;
    const CH = MIL.char;
    for (let k = 0; k < 9; k++) {
      const x = 3 + hashf(k, 1, 81) * 14;
      const y = 4 + hashf(k, 2, 81) * 4;
      const r = 1.2 + hashf(k, 3, 81) * 1.6;
      blob(pc, x, y, r, r * 0.75, S.slice(1, 6), k);
    }
    pc.line(2, 7, 9, 4, CH[3]);
    pc.line(2, 8, 9, 5, W[1]);
    pc.line(12, 3, 17, 6, CH[2]);
    pc.line(13, 3, 18, 6, CH[3]);
    pc.line(6, 2, 10, 2, W[2]);
    pc.px(10, 2, CH[1]);
    for (const [x, y] of [[8, 6], [14, 7], [5, 5]]) {
      pc.px(x, y, RAMP.tile[3]);
      pc.px(x + 1, y, RAMP.tile[4]);
    }
    pc.outline(OUTLINE, 0.6);
    add('fx/rubble', pc, 10, 6);
  }
  // ---- burnt-out vehicle hulk (side-on like the vehicle sprites): blackened steel, rust, a
  //      drooping gun and stripped running gear
  {
    const G = MIL.grey;
    const R = RAMP.rust;
    const K = MIL.rubber;
    const C = MIL.char;
    const pc = new PixelCanvas(28, 14);
    pc.rect(2, 9, 23, 2, K[0]);
    for (let x = 3; x <= 23; x += 3) pc.px(x, 10, K[2]);
    pc.hline(3, 23, 11, K[1]);
    pc.rect(1, 5, 25, 4, C[3]);
    pc.hline(2, 24, 5, G[2]);
    pc.vline(1, 6, 8, G[1]);
    pc.vline(25, 6, 7, G[1]);
    pc.rect(8, 2, 9, 3, G[1]);
    pc.hline(9, 12, 2, G[3]);
    pc.hline(14, 15, 2, G[3]);
    pc.px(10, 1, G[2]);
    pc.px(11, 1, G[3]);
    pc.line(17, 3, 23, 3, G[2]);
    pc.px(24, 4, G[1]);
    pc.px(25, 4, G[1]);
    for (let y = 2; y < 9; y++)
      for (let x = 1; x < 26; x++) if ((pc.get(x, y) >>> 24) !== 0 && hashf(x, y, 91) < 0.22) pc.blend(x, y, C[0], 0.55);
    for (const [x, y, i] of [[5, 6, 3], [6, 6, 2], [5, 7, 2], [17, 7, 3], [18, 6, 4], [12, 8, 2], [11, 3, 3], [21, 6, 2]]) pc.px(x, y, R[i]);
    pc.outline(OUTLINE, 0.7);
    pc.shadow(13, 12, 12.5, 1.6, 0.3);
    add('fx/wreck', pc, 13, 11);
  }
  // ---- tracks: a faint segment of tyre/tread marks (drawn along +x) and hoofprints
  {
    const pc = new PixelCanvas(12, 7);
    for (let x = 0; x < 12; x++)
      for (const y of [0, 5]) {
        pc.blend(x, y, '#2e2418', x % 2 === 0 ? 0.32 : 0.18);
        pc.blend(x, y + 1, '#2e2418', x % 2 === 0 ? 0.2 : 0.12);
      }
    add('fx/tread', pc);
    const h = new PixelCanvas(7, 5);
    // two pairs of crescent prints, staggered like a horse's gait
    for (const [x, y] of [[0, 0], [4, 1], [1, 3], [5, 3]]) {
      h.blend(x, y, '#2e2418', 0.45);
      h.blend(x + 1, y, '#2e2418', 0.45);
      h.blend(x, y + 1, '#2e2418', 0.25);
    }
    add('fx/hoof', h);
  }
}

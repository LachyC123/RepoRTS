import { PixelCanvas } from './PixelCanvas';
import { OUTLINE, RAMP } from './palette';
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
  iconCache = { gold, wood, food, stone, pop, sword, crown };
  return iconCache;
}

/** PNG data URL for DOM usage (scaled with CSS pixelated) */
export function iconDataUrl(name: string): string {
  const pc = resourceIcons()[name];
  if (!pc) return '';
  return pc.flush().toDataURL();
}

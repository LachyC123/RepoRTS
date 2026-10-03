import { hash2 } from '../../core/Random';
import { PixelCanvas, shade } from './PixelCanvas';
import { BAYER4, OUTLINE, RAMP } from './palette';

/** A drawn prop with its anchor (ground contact point) */
export interface PropSprite {
  pc: PixelCanvas;
  ax: number;
  ay: number;
}

/** Shaded blob lit from the top-left, quantised onto a ramp with dithering. */
export function blob(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, ramp: string[], seed = 0, lightBias = 0) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      // light from top-left-front
      let l = -nx * 0.45 - ny * 0.6 + nz * 0.55;
      l = l * 0.5 + 0.45 + lightBias + (hash2(x, y, seed) - 0.5) * 0.18;
      const n = ramp.length;
      let i = Math.round(l * (n - 1) + BAYER4[(x & 3) + ((y & 3) << 2)] * 0.8);
      i = Math.max(0, Math.min(n - 1, i));
      pc.px(x, y, ramp[i]);
    }
  }
}

const OAK = ['#16301c', '#1f4022', '#2a5228', '#36652e', '#457a35', '#578f3e', '#6ca44a'];
const OAK_AUTUMN = ['#3a2416', '#5a3218', '#7a4a1e', '#9a6424', '#b88030', '#d0a040'];
const PINE = ['#0f2420', '#163128', '#1d3f30', '#265039', '#2f6043', '#3b724e'];
const BIRCH = ['#2c4a22', '#3a5e2a', '#4a7232', '#5c873c', '#72a048', '#8cb858'];
const BARK = ['#2a1c14', '#3e2a1c', '#563a26', '#6e4c32'];

export function drawTree(species: number, variant: number, sway: number): PropSprite {
  const s = variant * 31 + species * 7;
  switch (species) {
    case 2: {
      // pine: stacked triangles
      const w = 18;
      const h = 30;
      const pc = new PixelCanvas(w, h);
      const cx = 9;
      const base = h - 3;
      pc.rect(cx - 1, base - 5, 2, 5, BARK[2]);
      pc.px(cx - 1, base - 5, BARK[1]);
      const tiers = 4 + (variant % 2);
      for (let t = 0; t < tiers; t++) {
        const ty = base - 5 - t * 5;
        const half = 7 - t * 1.3 - (variant === 2 ? 0.6 : 0);
        const off = t >= tiers - 2 ? sway : 0;
        for (let y = 0; y < 7; y++) {
          const hw = half * (y / 6);
          for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
            if (Math.abs(x) > hw + 0.3) continue;
            const l = 0.55 - (x / (half + 1)) * 0.45 - (y / 7) * 0.2 + (hash2(x + t * 13, y, s) - 0.5) * 0.25;
            const i = Math.max(0, Math.min(PINE.length - 1, Math.round(l * (PINE.length - 1) + BAYER4[((cx + x) & 3) + (((ty - 6 + y) & 3) << 2)] * 0.7)));
            pc.px(cx + x + off, ty - 6 + y, PINE[i]);
          }
        }
      }
      pc.px(cx + sway, base - 5 - tiers * 5 - 1, PINE[3]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(cx + 2, base + 0.5, 6, 2, 0.3);
      return { pc, ax: cx, ay: base };
    }
    case 3: {
      // birch: slender white trunk, airy canopy
      const w = 18;
      const h = 28;
      const pc = new PixelCanvas(w, h);
      const cx = 9;
      const base = h - 3;
      pc.rect(cx - 1, base - 12, 2, 12, '#e8e4d8');
      for (let y = base - 12; y < base; y += 3) pc.px(cx - 1 + ((y >> 1) & 1), y, '#2a2420');
      pc.vline(cx, base - 12, base - 1, '#b8b4a8');
      blob(pc, cx - 2 + sway, base - 16, 5, 5, BIRCH, s);
      blob(pc, cx + 3 + sway, base - 14, 4, 4, BIRCH, s + 1);
      blob(pc, cx + sway, base - 20, 4.5, 4, BIRCH, s + 2, 0.1);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(cx + 2, base + 0.5, 6, 2, 0.3);
      return { pc, ax: cx, ay: base };
    }
    case 4: {
      // dead tree
      const w = 16;
      const h = 22;
      const pc = new PixelCanvas(w, h);
      const cx = 8;
      const base = h - 3;
      pc.rect(cx - 1, base - 10, 2, 10, BARK[2]);
      pc.line(cx, base - 8, cx - 5, base - 14, BARK[2]);
      pc.line(cx, base - 10, cx + 4, base - 16, BARK[3]);
      pc.line(cx - 3, base - 12, cx - 3, base - 16, BARK[1]);
      pc.line(cx + 2, base - 13, cx + 6, base - 13, BARK[1]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(cx + 1, base + 0.5, 4, 1.5, 0.3);
      return { pc, ax: cx, ay: base };
    }
    default: {
      // oak: chunky clustered canopy
      const w = 24;
      const h = 28;
      const pc = new PixelCanvas(w, h);
      const cx = 12;
      const base = h - 3;
      const autumn = variant === 3;
      const R = autumn ? OAK_AUTUMN : OAK;
      pc.rect(cx - 1, base - 7, 3, 7, BARK[2]);
      pc.vline(cx + 1, base - 7, base - 1, BARK[1]);
      pc.px(cx - 2, base - 1, BARK[2]);
      pc.px(cx + 2, base - 1, BARK[1]);
      const big = variant === 1 ? 1 : 0;
      blob(pc, cx - 4 + sway * 0.5, base - 11, 5 + big, 4.5, R, s, -0.08);
      blob(pc, cx + 4 + sway * 0.5, base - 11, 5, 4.5, R, s + 1, -0.12);
      blob(pc, cx + sway, base - 15, 7 + big, 6, R, s + 2);
      blob(pc, cx - 3 + sway, base - 18, 4.5, 4, R, s + 3, 0.12);
      blob(pc, cx + 3 + sway, base - 17, 4, 3.5, R, s + 4, 0.05);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(cx + 2, base + 0.5, 8, 2.5, 0.3);
      return { pc, ax: cx, ay: base };
    }
  }
}

export function drawStump(): PropSprite {
  const pc = new PixelCanvas(10, 8);
  pc.rect(3, 3, 4, 3, BARK[2]);
  pc.hline(3, 6, 3, '#b08a5a');
  pc.px(4, 3, '#c8a070');
  pc.px(7, 5, BARK[1]);
  pc.px(2, 5, BARK[2]);
  pc.outline(OUTLINE, 0.6);
  pc.shadow(5, 6, 3.5, 1.2, 0.25);
  return { pc, ax: 5, ay: 6 };
}

export function drawSapling(): PropSprite {
  const pc = new PixelCanvas(10, 12);
  pc.vline(5, 6, 9, BARK[2]);
  blob(pc, 5, 5, 3, 3, OAK, 3);
  pc.outline(OUTLINE, 0.6);
  pc.shadow(5, 9.5, 3, 1, 0.25);
  return { pc, ax: 5, ay: 9 };
}

// -------------------------------------------------------------------------------- small props
function stonePile(pc: PixelCanvas, x: number, y: number, rx: number, ry: number, seed: number, ramp = RAMP.stone) {
  blob(pc, x, y, rx, ry, ramp, seed);
}

export function drawProp(kind: string, v: number): PropSprite | null {
  const W = RAMP.wood;
  const S = RAMP.stone;
  switch (kind) {
    case 'bush': {
      const pc = new PixelCanvas(14, 11);
      const berry = v === 2;
      blob(pc, 5, 6, 4, 3.5, OAK, v);
      blob(pc, 9, 6, 3.5, 3, OAK, v + 1, -0.05);
      blob(pc, 7, 4, 3.5, 3, OAK, v + 2, 0.1);
      if (berry) {
        pc.px(5, 5, '#c83a3a');
        pc.px(9, 6, '#c83a3a');
        pc.px(7, 3, '#e04848');
      }
      pc.outline(OUTLINE, 0.55);
      pc.shadow(7, 9, 5, 1.5, 0.25);
      return { pc, ax: 7, ay: 9 };
    }
    case 'flowers': {
      const pc = new PixelCanvas(9, 6);
      const cols = ['#f0d860', '#f4f0e8', '#e07890', '#9ab0f0'];
      const c = cols[v % 4];
      for (let k = 0; k < 4; k++) {
        const x = 1 + ((k * 5 + v) % 7);
        const y = 1 + ((k * 3 + v) % 3);
        pc.px(x, y + 1, RAMP.grass[2]);
        pc.px(x, y, c);
      }
      return { pc, ax: 4, ay: 5 };
    }
    case 'tall_grass': {
      const pc = new PixelCanvas(9, 8);
      for (let k = 0; k < 5; k++) {
        const x = 1 + k * 1.6;
        const hgt = 3 + ((k * 7 + v) % 3);
        pc.line(x, 7, x + (k % 2 ? 1 : -1) * 0.6, 7 - hgt, k % 2 ? RAMP.grass[5] : RAMP.grass[4]);
      }
      return { pc, ax: 4, ay: 7 };
    }
    case 'fern': {
      const pc = new PixelCanvas(11, 8);
      for (let k = -2; k <= 2; k++) pc.line(5, 7, 5 + k * 2, 3 + Math.abs(k), RAMP.grass[3 + (k & 1)]);
      pc.outline(OUTLINE, 0.4);
      return { pc, ax: 5, ay: 7 };
    }
    case 'mushrooms': {
      const pc = new PixelCanvas(8, 6);
      const cap = v % 2 ? '#c83a3a' : '#c8a070';
      pc.px(2, 4, '#e8e0d0');
      pc.rect(1, 3, 3, 1, cap);
      pc.px(5, 4, '#e8e0d0');
      pc.px(5, 3, '#e8e0d0');
      pc.rect(4, 2, 3, 1, cap);
      if (v % 2) pc.px(5, 2, '#f8f0f0');
      pc.outline(OUTLINE, 0.5);
      return { pc, ax: 4, ay: 5 };
    }
    case 'reeds': {
      const pc = new PixelCanvas(9, 10);
      for (let k = 0; k < 4; k++) {
        const x = 1 + k * 2;
        const hh = 5 + ((k + v) % 3);
        pc.vline(x, 9 - hh, 9, k % 2 ? '#6a8a3a' : '#7a9a44');
        if (k % 2 === 0) pc.vline(x, 9 - hh, 9 - hh + 1, '#5a3a22');
      }
      return { pc, ax: 4, ay: 9 };
    }
    case 'rock_small': {
      const pc = new PixelCanvas(9, 7);
      stonePile(pc, 4, 4, 3, 2.2, v);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(5, 5.5, 3.5, 1, 0.25);
      return { pc, ax: 4, ay: 5 };
    }
    case 'boulder': {
      const pc = new PixelCanvas(16, 13);
      stonePile(pc, 8, 7, 6, 4.5, v);
      stonePile(pc, 11, 9, 3, 2.5, v + 3);
      pc.px(6, 5, RAMP.grass[4]);
      pc.px(7, 4, RAMP.grass[5]);
      pc.outline(OUTLINE, 0.65);
      pc.shadow(9, 11, 7, 2, 0.3);
      return { pc, ax: 8, ay: 11 };
    }
    case 'log': {
      const pc = new PixelCanvas(14, 7);
      pc.rect(2, 2, 10, 3, BARK[2]);
      pc.hline(2, 11, 2, BARK[3]);
      pc.rect(11, 2, 2, 3, '#b08a5a');
      pc.px(12, 3, '#8a6a40');
      pc.px(5, 2, RAMP.grass[4]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(7, 5.5, 6, 1.2, 0.25);
      return { pc, ax: 7, ay: 5 };
    }
    case 'broken_cart': {
      const pc = new PixelCanvas(20, 14);
      pc.rect(3, 6, 12, 3, W[3]);
      pc.hline(3, 14, 6, W[4]);
      pc.line(14, 8, 18, 11, W[2]);
      pc.ellipse(5, 10, 2.5, 2.5, W[1]);
      pc.ellipse(5, 10, 1.4, 1.4, W[3]);
      // broken wheel lying
      pc.ellipse(15, 11, 2.5, 1.2, W[2]);
      pc.rect(6, 4, 3, 2, W[2]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(10, 12, 8, 1.8, 0.25);
      return { pc, ax: 10, ay: 12 };
    }
    case 'shield': {
      const pc = new PixelCanvas(8, 6);
      pc.ellipse(4, 3, 2.6, 1.6, ['#7a3a2a', '#3a5a8a', '#6a6a3a'][v % 3]);
      pc.px(4, 3, RAMP.metal[4]);
      pc.outline(OUTLINE, 0.5);
      return { pc, ax: 4, ay: 4 };
    }
    case 'spear': {
      const pc = new PixelCanvas(12, 6);
      pc.line(1, 4, 9, 2, W[4]);
      pc.px(10, 2, RAMP.metal[5]);
      pc.px(11, 1, RAMP.metal[5]);
      return { pc, ax: 6, ay: 4 };
    }
    case 'helmet': {
      const pc = new PixelCanvas(6, 5);
      pc.rect(1, 1, 4, 2, RAMP.metal[3]);
      pc.hline(0, 5, 3, RAMP.metal[2]);
      pc.px(1, 1, RAMP.metal[5]);
      pc.outline(OUTLINE, 0.5);
      return { pc, ax: 3, ay: 4 };
    }
    case 'banner_torn': {
      const pc = new PixelCanvas(10, 16);
      pc.line(2, 15, 4, 2, W[2]);
      pc.rect(5, 2, 4, 5, '#7a2a2a');
      pc.px(8, 7, '#7a2a2a');
      pc.px(6, 7, '#5a1a1a');
      pc.px(7, 4, '#d8c890');
      pc.outline(OUTLINE, 0.5);
      return { pc, ax: 3, ay: 15 };
    }
    case 'barrel': {
      const pc = new PixelCanvas(8, 9);
      pc.rect(2, 2, 4, 5, W[3]);
      pc.vline(2, 2, 6, W[4]);
      pc.hline(2, 5, 3, RAMP.metal[2]);
      pc.hline(2, 5, 6, RAMP.metal[2]);
      pc.hline(2, 5, 2, W[5]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(4, 7.5, 3, 1, 0.25);
      return { pc, ax: 4, ay: 7 };
    }
    case 'crates': {
      const pc = new PixelCanvas(14, 12);
      pc.rect(2, 4, 5, 5, W[4]);
      pc.rect(7, 5, 5, 4, W[3]);
      pc.rect(4, 1, 5, 4, W[5]);
      pc.line(2, 4, 6, 8, W[2]);
      pc.line(7, 5, 11, 8, W[1]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(7, 10, 6, 1.5, 0.25);
      return { pc, ax: 7, ay: 9 };
    }
    case 'bones': {
      const pc = new PixelCanvas(8, 5);
      pc.hline(1, 5, 2, '#d8d0c0');
      pc.px(1, 1, '#d8d0c0');
      pc.px(5, 3, '#d8d0c0');
      pc.px(6, 1, '#c8c0b0');
      return { pc, ax: 4, ay: 3 };
    }
    case 'grave': {
      const pc = new PixelCanvas(8, 11);
      if (v % 2) {
        pc.rect(2, 2, 4, 6, S[4]);
        pc.hline(3, 4, 1, S[5]);
        pc.vline(2, 2, 7, S[5]);
        pc.hline(3, 4, 4, S[2]);
      } else {
        pc.vline(4, 1, 8, W[3]);
        pc.hline(2, 6, 3, W[3]);
      }
      pc.rect(1, 8, 6, 1, RAMP.dirt[2]);
      pc.outline(OUTLINE, 0.6);
      return { pc, ax: 4, ay: 9 };
    }
    case 'plague_cross': {
      const pc = new PixelCanvas(10, 16);
      pc.vline(5, 2, 14, W[2]);
      pc.hline(2, 8, 5, W[2]);
      pc.rect(3, 7, 5, 3, '#c8c0a8');
      pc.px(5, 8, '#a02020');
      pc.outline(OUTLINE, 0.6);
      pc.shadow(5, 14.5, 3, 1, 0.25);
      return { pc, ax: 5, ay: 14 };
    }
    case 'dead_tree':
      return drawTree(4, v, 0);
    case 'standing_stone': {
      const pc = new PixelCanvas(10, 18);
      for (let y = 2; y < 15; y++) {
        const hw = y < 4 ? 2 : 3;
        for (let x = -hw; x < hw; x++) {
          const l = 0.6 - (x / 3) * 0.3 - y * 0.012 + (hash2(x, y, v) - 0.5) * 0.2;
          const i = Math.max(0, Math.min(S.length - 1, Math.round(l * (S.length - 1))));
          pc.px(5 + x, y, S[i]);
        }
      }
      pc.px(3, 9, RAMP.grass[4]);
      pc.px(4, 12, RAMP.grass[3]);
      pc.outline(OUTLINE, 0.65);
      pc.shadow(6, 15, 4.5, 1.5, 0.3);
      return { pc, ax: 5, ay: 15 };
    }
    case 'altar_stone': {
      const pc = new PixelCanvas(16, 9);
      pc.rect(2, 3, 12, 4, S[3]);
      pc.hline(2, 13, 3, S[5]);
      pc.hline(2, 13, 6, S[1]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(8, 7.5, 7, 1.5, 0.25);
      return { pc, ax: 8, ay: 7 };
    }
    case 'ruin_wall': {
      const pc = new PixelCanvas(18, 16);
      for (let x = 2; x < 16; x++) {
        const top = 3 + Math.round(Math.abs(Math.sin(x * 1.7 + v)) * 6);
        for (let y = top; y < 13; y++) {
          const brick = ((y >> 1) + ((x >> 2) & 1)) & 1;
          pc.px(x, y, (y & 1) === 0 ? S[1] : brick ? S[4] : S[3]);
        }
        pc.px(x, top, S[5]);
      }
      pc.px(4, 9, RAMP.grass[4]);
      pc.px(12, 11, RAMP.grass[3]);
      pc.outline(OUTLINE, 0.65);
      pc.shadow(9, 13.5, 8, 1.5, 0.3);
      return { pc, ax: 9, ay: 13 };
    }
    case 'ruined_tower': {
      const pc = new PixelCanvas(22, 30);
      for (let x = 4; x < 18; x++) {
        const top = 4 + Math.round(Math.abs(Math.sin(x * 0.9 + 1)) * 7);
        for (let y = top; y < 27; y++) {
          const brick = ((y >> 1) + ((x >> 2) & 1)) & 1;
          let c = (y & 1) === 0 ? S[1] : brick ? S[4] : S[3];
          if (x > 14) c = shade(c, -0.25);
          if (x < 6) c = shade(c, 0.12);
          pc.px(x, y, c);
        }
        pc.px(x, top, S[6]);
      }
      pc.rect(10, 15, 3, 5, '#1a1420');
      pc.rect(9, 22, 4, 5, '#1a1420');
      pc.px(6, 12, RAMP.grass[4]);
      pc.px(7, 20, RAMP.grass[3]);
      pc.px(16, 18, RAMP.grass[4]);
      pc.outline(OUTLINE, 0.65);
      pc.shadow(12, 27, 9, 2, 0.3);
      return { pc, ax: 11, ay: 27 };
    }
    case 'ruined_hut':
    case 'burned_house': {
      const burned = kind === 'burned_house';
      const pc = new PixelCanvas(24, 22);
      // walls
      pc.rect(4, 9, 16, 9, burned ? '#4a3a30' : RAMP.plaster[2]);
      pc.hline(4, 19, 17, burned ? '#2a2018' : RAMP.plaster[0]);
      for (let x = 4; x < 20; x += 5) pc.vline(x, 9, 17, burned ? '#201812' : W[2]);
      pc.rect(10, 12, 3, 6, '#1a1420');
      // collapsed roof: jagged beams
      pc.line(3, 10, 12, 3, burned ? '#201812' : W[2]);
      pc.line(12, 3, 16, 7, burned ? '#201812' : W[2]);
      pc.line(6, 9, 10, 5, burned ? '#2a1e16' : RAMP.thatch[2]);
      if (!burned) {
        for (let k = 0; k < 5; k++) pc.line(4 + k * 2, 9, 9 + k, 4 + k, RAMP.thatch[1 + (k % 3)]);
      } else {
        pc.px(14, 14, '#e05820');
        pc.px(15, 15, '#a03018');
      }
      pc.outline(OUTLINE, 0.65);
      pc.shadow(12, 18.5, 10, 2, 0.3);
      return { pc, ax: 12, ay: 18 };
    }
    case 'charred': {
      const pc = new PixelCanvas(10, 5);
      pc.ellipse(5, 2.5, 4, 1.8, '#2a2420');
      pc.px(4, 2, '#5a3020');
      return { pc, ax: 5, ay: 3 };
    }
    case 'tent': {
      const pc = new PixelCanvas(18, 14);
      const c = ['#8a7a5a', '#6a5a4a', '#7a3a2a'][v % 3];
      for (let y = 0; y < 9; y++) {
        const hw = y * 0.9 + 0.5;
        for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
          if (Math.abs(x) > hw) continue;
          pc.px(9 + x, 3 + y, x < 0 ? shade(c, 0.12) : shade(c, -0.15));
        }
      }
      pc.vline(9, 6, 11, '#1a1420');
      pc.vline(9, 1, 3, W[2]);
      pc.outline(OUTLINE, 0.6);
      pc.shadow(9, 12, 8, 1.5, 0.28);
      return { pc, ax: 9, ay: 12 };
    }
    case 'campfire': {
      const pc = new PixelCanvas(10, 7);
      pc.line(2, 5, 7, 3, W[2]);
      pc.line(2, 3, 7, 5, W[3]);
      pc.ellipse(5, 4, 3.5, 1.5, '#2a2420');
      pc.px(3, 5, S[3]);
      pc.px(7, 5, S[3]);
      return { pc, ax: 5, ay: 5 };
    }
    case 'bridge_ruin': {
      const pc = new PixelCanvas(28, 16);
      pc.rect(2, 6, 7, 6, S[3]);
      pc.hline(2, 8, 6, S[5]);
      pc.rect(19, 5, 7, 7, S[3]);
      pc.hline(19, 25, 5, S[5]);
      pc.line(9, 7, 13, 10, W[2]);
      pc.line(18, 6, 15, 9, W[2]);
      pc.outline(OUTLINE, 0.65);
      return { pc, ax: 14, ay: 11 };
    }
    case 'windmill_base': {
      const pc = new PixelCanvas(22, 30);
      // tapered tower
      for (let y = 8; y < 27; y++) {
        const hw = 4 + (y - 8) * 0.2;
        for (let x = -Math.round(hw); x <= Math.round(hw); x++) {
          const l = 0.55 - (x / hw) * 0.35;
          const i = Math.max(0, Math.min(4, Math.round(l * 4)));
          pc.px(11 + x, y, RAMP.plaster[i]);
        }
      }
      for (let y = 3; y < 9; y++) {
        const hw = (y - 2) * 0.9;
        for (let x = -Math.round(hw); x <= Math.round(hw); x++) pc.px(11 + x, y, x < 0 ? RAMP.thatch[4] : RAMP.thatch[2]);
      }
      pc.rect(10, 21, 3, 6, W[1]);
      pc.rect(9, 13, 2, 2, '#1a1420');
      pc.outline(OUTLINE, 0.65);
      pc.shadow(13, 27, 8, 2, 0.3);
      return { pc, ax: 11, ay: 27 };
    }
    case 'ore_gold':
    case 'ore_stone': {
      const gold = kind === 'ore_gold';
      const pc = new PixelCanvas(36, 30);
      const rr = gold ? ['#2e2a33', '#3d3842', '#4d4752', '#5e5763', '#716a76', '#867f8a'] : S;
      blob(pc, 12, 17, 9, 7, rr, v);
      blob(pc, 23, 18, 8, 6.5, rr, v + 1, -0.05);
      blob(pc, 17, 11, 7, 6, rr, v + 2, 0.08);
      blob(pc, 27, 23, 4, 3, rr, v + 3);
      blob(pc, 8, 23, 4, 3, rr, v + 4);
      if (gold) {
        const G = RAMP.goldm;
        const spots: [number, number][] = [[10, 15], [14, 12], [20, 10], [24, 17], [17, 19], [12, 20], [27, 21], [19, 14]];
        for (const [x, y] of spots) {
          pc.px(x, y, G[3]);
          pc.px(x + 1, y, G[4]);
          pc.px(x, y + 1, G[2]);
        }
      } else {
        // quarried flat faces
        pc.rect(13, 13, 6, 3, S[5]);
        pc.hline(13, 18, 13, S[6]);
        pc.rect(21, 16, 4, 3, S[5]);
      }
      pc.outline(OUTLINE, 0.65);
      pc.shadow(18, 25, 14, 3, 0.3);
      return { pc, ax: 18, ay: 25 };
    }
    default:
      return null;
  }
}

/** windmill blades: frame k of 4 rotations */
export function drawWindmillBlades(k: number): PropSprite {
  const pc = new PixelCanvas(26, 26);
  const cx = 13;
  const cy = 13;
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + (k / 4) * (Math.PI / 2);
    const ex = cx + Math.cos(a) * 11;
    const ey = cy + Math.sin(a) * 11;
    pc.line(cx, cy, ex, ey, RAMP.wood[2]);
    // sail cloth on one side
    const px = -Math.sin(a);
    const py = Math.cos(a);
    for (let t = 4; t <= 11; t++) {
      const sx = cx + Math.cos(a) * t;
      const sy = cy + Math.sin(a) * t;
      pc.px(sx + px * 1.5, sy + py * 1.5, '#e8e0cc');
      pc.px(sx + px * 2.5, sy + py * 2.5, '#d0c8b4');
    }
  }
  pc.px(cx, cy, RAMP.wood[1]);
  pc.outline(OUTLINE, 0.5);
  return { pc, ax: cx, ay: cy };
}

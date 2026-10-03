import type { UnitDef, UnitLook } from '../../data/units';
import type { KingdomColor } from '../../data/factions';
import { PixelCanvas, mix, shade } from './PixelCanvas';
import { OUTLINE, RAMP } from './palette';

/**
 * Procedural paper-doll soldiers. Every unit is assembled from a body, armour, helmet, weapon,
 * shield and (optionally) a mount or siege engine, then outlined. Team colour appears only on
 * tabards, shields, plumes and caparisons so soldiers still read as believable medieval troops.
 *
 * Output layout per unit type: a horizontal strip of frames:
 *   idle0 idle1 walk0 walk1 walk2 walk3 atk0 atk1 atk2 die0 die1 die2 [extra...]
 * Replacing with real art = supplying a sheet with the same frame order (see ArtRegistry).
 */

export const ANIMS = {
  idle: [0, 1],
  walk: [2, 3, 4, 5],
  attack: [6, 7, 8],
  die: [9, 10, 11],
} as const;
export const FRAME_COUNT = 12;

export interface UnitSheet {
  w: number;
  h: number;
  /** feet anchor in px */
  ax: number;
  ay: number;
  frames: PixelCanvas[];
}

interface Pose {
  bob: number;
  legF: number; // front foot x offset
  legB: number;
  liftF: number; // front foot lift (px)
  liftB: number;
  arm: number; // weapon angle (rad): 0 forward, -PI/2 up
  reach: number; // forward shove for thrust/strike
  draw: number; // bow draw 0..1
  lean: number;
}

const BASE_POSE: Pose = { bob: 0, legF: 1, legB: -1, liftF: 0, liftB: 0, arm: -0.9, reach: 0, draw: 0, lean: 0 };

interface Palette {
  skin: string[];
  cloth: string[];
  team: { main: string; light: string; dark: string };
  metal: string[];
  leather: string[];
  hair: string;
}

function teamColors(c: KingdomColor) {
  return { main: c.main, light: c.light, dark: c.dark };
}

function makePalette(look: UnitLook, kc: KingdomColor, seed: number): Palette {
  const skins = [RAMP.skin, RAMP.skin.map((s) => shade(s, -0.12)), RAMP.skin.map((s) => shade(s, 0.06))];
  const hairs = ['#3a2618', '#5a3a1e', '#2a1e18', '#8a6a3a', '#6a2a18'];
  const base = look.cloth ?? '#6b5a44';
  return {
    skin: skins[seed % skins.length],
    cloth: [shade(base, -0.45), shade(base, -0.2), base, shade(base, 0.18)],
    team: teamColors(kc),
    metal: RAMP.metal,
    leather: RAMP.leather,
    hair: hairs[seed % hairs.length],
  };
}

// ---------------------------------------------------------------------------------------------
// infantry figure, facing right, in a frame with feet bottom at (cx, fy)
function drawFigure(p: PixelCanvas, look: UnitLook, pal: Palette, pose: Pose, cx: number, fy: number, opts: { seated?: boolean } = {}) {
  const heavy = look.body === 'heavy';
  const peasant = look.body === 'peasant';
  const by = fy - pose.bob; // body baseline
  const tw = heavy ? 5 : 4; // torso width
  const tx = cx - 2 + pose.lean; // torso left x
  const legTop = by - 3;
  const torsoTop = by - 8;
  const headTop = by - 12;
  const T = pal.team;
  const hose = peasant ? pal.cloth[1] : heavy ? pal.metal[2] : '#4a3a30';
  const boot = pal.leather[1];

  // ---- legs (skip when seated)
  if (!opts.seated) {
    // back leg
    const bx = cx - 1 + pose.legB;
    p.rect(bx, legTop, 2, 3 - pose.liftB, shade(hose, -0.25));
    p.rect(bx, by - pose.liftB - 1, 2, 1, shade(boot, -0.2));
    // front leg
    const fx = cx + pose.legF - 1;
    p.rect(fx, legTop, 2, 3 - pose.liftF, hose);
    p.rect(fx, by - pose.liftF - 1, 2, 1, boot);
    p.px(fx + 2, by - pose.liftF - 1, boot);
  }

  // ---- back arm
  const shoulderX = tx + 1;
  const shoulderY = torsoTop + 1;
  // ---- torso
  const torso = (x: number, y: number, c: string) => p.px(x, y, c);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < tw; x++) {
      const yy = torsoTop + y;
      const xx = tx + x;
      let c: string;
      const top = y === 0;
      const right = x === tw - 1;
      switch (look.armor) {
        case 'mail': {
          const m = (x + y) % 2 === 0 ? pal.metal[3] : pal.metal[2];
          c = top ? pal.metal[4] : m;
          // team surcoat on lower torso
          if (y >= 2) c = right ? T.dark : x === 0 ? T.light : T.main;
          break;
        }
        case 'plate':
          c = top ? pal.metal[6] : x === 0 ? pal.metal[5] : right ? pal.metal[2] : pal.metal[4];
          if (y >= 2 && x >= 1 && x <= tw - 2) c = y === 4 ? T.dark : T.main;
          break;
        case 'gambeson':
          c = top ? '#d8ccaa' : (y % 2 === 0 ? '#c4b48e' : '#b0a07a');
          if (right) c = '#8c7c5a';
          if (x === 1 || (tw > 4 && x === 2)) c = y === 0 ? T.light : T.main;
          break;
        case 'leather':
          c = top ? pal.leather[4] : right ? pal.leather[1] : pal.leather[3];
          if (y === 0 && x < 2) c = T.main; // collar / hood trim
          break;
        case 'robe':
          c = right ? pal.cloth[0] : top ? pal.cloth[3] : pal.cloth[2];
          break;
        default:
          // tunic
          c = right ? pal.cloth[1] : top ? pal.cloth[3] : pal.cloth[2];
      }
      torso(xx, yy, c);
    }
  }
  // belt
  p.hline(tx, tx + tw - 1, torsoTop + 3, pal.leather[0]);
  if (peasant) {
    // team sash on peasants
    p.px(tx + 1, torsoTop + 1, T.main);
    p.px(tx + 2, torsoTop + 2, T.main);
    p.px(tx + 3, torsoTop + 3, T.dark);
  }
  if (look.armor === 'robe') p.rect(tx, torsoTop + 4, tw, 3, pal.cloth[1]);

  // ---- head
  const hx = tx + (heavy ? 1 : 0) + 1;
  const skin = pal.skin;
  p.rect(hx - 1, headTop, 4, 4, skin[3]);
  p.px(hx + 2, headTop, skin[4]);
  p.vline(hx - 1, headTop, headTop + 3, skin[2]);
  p.px(hx + 2, headTop + 1, '#201820'); // eye
  p.px(hx + 3, headTop + 2, skin[3]); // nose
  p.hline(hx - 1, hx + 2, headTop + 3, skin[2]);
  if (look.beard) {
    p.rect(hx, headTop + 3, 3, 2, pal.hair);
    p.px(hx + 2, headTop + 2, pal.hair);
  }
  // hair (back of head)
  p.rect(hx - 1, headTop - 1, 3, 2, pal.hair);
  p.px(hx - 1, headTop + 1, pal.hair);

  // ---- helmet
  const M = pal.metal;
  switch (look.helmet) {
    case 'cap':
      p.rect(hx - 1, headTop - 1, 4, 2, T.main);
      p.hline(hx - 1, hx + 3, headTop, T.dark);
      p.px(hx - 1, headTop - 1, T.light);
      break;
    case 'hood':
      p.rect(hx - 2, headTop - 1, 5, 2, pal.cloth[2]);
      p.vline(hx - 2, headTop, headTop + 4, pal.cloth[1]);
      p.vline(hx - 1, headTop + 1, headTop + 3, pal.cloth[2]);
      p.px(hx + 2, headTop - 1, pal.cloth[3]);
      p.hline(hx - 1, hx + 2, headTop - 1, pal.cloth[3]);
      p.px(hx + 3, headTop, T.main);
      p.px(hx - 2, headTop + 4, T.main);
      break;
    case 'kettle':
      p.rect(hx - 1, headTop - 2, 4, 2, M[4]);
      p.px(hx - 1, headTop - 2, M[5]);
      p.hline(hx - 2, hx + 3, headTop, M[3]);
      p.hline(hx - 2, hx + 3, headTop - 0, M[2]);
      p.px(hx, headTop - 2, M[6]);
      break;
    case 'nasal':
      p.rect(hx - 1, headTop - 1, 4, 2, M[4]);
      p.px(hx, headTop - 2, M[5]);
      p.px(hx + 1, headTop - 2, M[4]);
      p.px(hx - 1, headTop - 1, M[5]);
      p.px(hx + 2, headTop + 1, M[3]); // nose guard over eye area
      p.px(hx + 3, headTop + 1, M[2]);
      p.px(hx + 2, headTop + 2, '#201820');
      break;
    case 'great':
      p.rect(hx - 1, headTop - 2, 5, 6, M[4]);
      p.vline(hx - 1, headTop - 2, headTop + 3, M[5]);
      p.vline(hx + 3, headTop - 1, headTop + 3, M[2]);
      p.hline(hx, hx + 3, headTop + 1, '#1a1420'); // eye slit
      p.px(hx + 2, headTop + 3, M[2]);
      p.px(hx + 3, headTop + 3, M[2]);
      // plume
      p.px(hx, headTop - 3, T.main);
      p.px(hx + 1, headTop - 3, T.light);
      p.px(hx - 1, headTop - 3, T.dark);
      p.px(hx - 1, headTop - 4, T.main);
      break;
    case 'crown': {
      const G = RAMP.goldm;
      p.rect(hx - 1, headTop - 2, 4, 2, G[3]);
      p.px(hx - 1, headTop - 3, G[4]);
      p.px(hx + 1, headTop - 3, G[4]);
      p.px(hx + 3, headTop - 3, G[3]);
      p.px(hx + 1, headTop - 2, T.light);
      p.hline(hx - 1, hx + 2, headTop - 1, G[1]);
      break;
    }
    case 'feather':
      p.rect(hx - 1, headTop - 1, 4, 2, pal.cloth[2]);
      p.hline(hx - 2, hx + 3, headTop, pal.cloth[1]);
      p.px(hx - 1, headTop - 2, T.light);
      p.px(hx - 2, headTop - 3, T.main);
      p.px(hx - 3, headTop - 3, T.main);
      break;
    default:
      break;
  }

  // ---- shield (carried forward)
  const sx = tx + tw - 1 + pose.reach * 0.5;
  const sy = torsoTop + 1;
  switch (look.shield) {
    case 'round':
      p.ellipse(sx + 1, sy + 2, 2.6, 2.8, T.main);
      p.px(sx, sy + 0, T.light);
      p.px(sx + 1, sy + 2, M[5]);
      p.px(sx + 2, sy + 4, T.dark);
      p.px(sx + 3, sy + 3, T.dark);
      break;
    case 'kite':
      p.rect(sx, sy, 3, 4, T.main);
      p.px(sx + 1, sy + 4, T.main);
      p.px(sx + 1, sy + 5, T.dark);
      p.vline(sx, sy, sy + 3, T.light);
      p.vline(sx + 2, sy + 1, sy + 4, T.dark);
      p.px(sx + 1, sy + 1, '#f0e6c8');
      p.px(sx + 1, sy + 2, '#f0e6c8');
      break;
    case 'tower':
      p.rect(sx, sy - 2, 3, 8, T.main);
      p.vline(sx, sy - 2, sy + 5, T.light);
      p.vline(sx + 2, sy - 1, sy + 5, T.dark);
      p.hline(sx, sx + 2, sy - 2, M[5]);
      p.hline(sx, sx + 2, sy + 5, M[2]);
      p.px(sx + 1, sy + 1, '#f0e6c8');
      p.px(sx + 1, sy + 2, '#f0e6c8');
      p.px(sx + 1, sy, '#f0e6c8');
      break;
    case 'buckler':
      p.px(sx + 1, sy + 2, M[4]);
      p.px(sx + 2, sy + 2, M[3]);
      p.px(sx + 1, sy + 3, M[3]);
      p.px(sx + 2, sy + 3, M[2]);
      break;
    default:
      break;
  }

  // ---- weapon arm + weapon
  const handX = shoulderX + 1 + Math.round(Math.cos(pose.arm) * 2) + pose.reach;
  const handY = shoulderY + 1 + Math.round(Math.sin(pose.arm) * 2);
  const armCol = look.armor === 'plate' ? M[4] : look.armor === 'mail' ? M[3] : look.armor === 'gambeson' ? '#c4b48e' : look.armor === 'leather' ? pal.leather[3] : pal.cloth[2];
  p.line(shoulderX + 1, shoulderY, handX, handY, armCol);
  p.px(handX, handY, look.armor === 'plate' ? M[5] : skin[3]);
  drawWeapon(p, look.weapon, handX, handY, pose, pal);
}

function drawWeapon(p: PixelCanvas, w: UnitLook['weapon'], hx: number, hy: number, pose: Pose, pal: Palette) {
  const M = pal.metal;
  const W = RAMP.wood;
  const ang = pose.arm;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const seg = (len: number, from: number, col: string) => {
    p.line(hx + dx * from, hy + dy * from, hx + dx * len, hy + dy * len, col);
  };
  switch (w) {
    case 'sword':
      seg(1, -1, W[2]);
      p.px(hx + Math.round(-dy), hy + Math.round(dx), M[3]); // crossguard
      p.px(hx - Math.round(-dy), hy - Math.round(dx), M[3]);
      seg(6, 1, M[5]);
      p.px(hx + dx * 6, hy + dy * 6, M[6]);
      break;
    case 'greatsword':
      seg(1, -2, W[2]);
      p.px(hx + Math.round(-dy), hy + Math.round(dx), M[3]);
      p.px(hx - Math.round(-dy), hy - Math.round(dx), M[3]);
      seg(9, 1, M[5]);
      seg(8, 2, M[4]);
      p.px(hx + dx * 9, hy + dy * 9, M[6]);
      break;
    case 'axe': {
      seg(7, -1, W[3]);
      const ax = hx + dx * 6;
      const ay = hy + dy * 6;
      p.rect(ax - 1 - dy, ay - 1, 3, 3, M[4]);
      p.px(ax + dx * 1.5 - dy * 2, ay + dy * 1.5 + dx * 2, M[6]);
      break;
    }
    case 'club':
      seg(5, -1, W[3]);
      p.px(hx + dx * 5, hy + dy * 5, W[4]);
      p.px(hx + dx * 4 + 1, hy + dy * 4, W[2]);
      break;
    case 'pitchfork':
      seg(9, -3, W[4]);
      p.px(hx + dx * 10 - dy, hy + dy * 10 + dx, M[4]);
      p.px(hx + dx * 10 + dy, hy + dy * 10 - dx, M[4]);
      p.px(hx + dx * 10, hy + dy * 10, M[5]);
      break;
    case 'spear':
      seg(10, -4, W[4]);
      seg(12, 10, M[5]);
      break;
    case 'pike':
      seg(13, -5, W[3]);
      seg(15, 13, M[5]);
      break;
    case 'lance':
      seg(13, -4, W[5]);
      seg(14, 13, M[6]);
      p.px(hx + dx * 1, hy + dy * 1 - 1, M[4]); // vamplate
      break;
    case 'bow':
    case 'longbow': {
      const tall = w === 'longbow' ? 6 : 4;
      // bow held vertical in front of the hand
      const bx = hx + 1;
      const draw = Math.round(pose.draw * 2);
      for (let k = -tall; k <= tall; k++) {
        const curve = Math.round((1 - (k * k) / (tall * tall)) * 2);
        p.px(bx + curve, hy + k, k === -tall || k === tall ? W[2] : W[4]);
      }
      // string
      p.line(bx, hy - tall, bx - draw, hy, '#d8d0c0');
      p.line(bx - draw, hy, bx, hy + tall, '#d8d0c0');
      if (pose.draw > 0) {
        p.line(bx - draw, hy, bx + 4, hy, W[5]);
        p.px(bx + 5, hy, M[5]);
      }
      break;
    }
    case 'crossbow': {
      const bx = hx;
      p.hline(bx - 2, bx + 4, hy, W[3]);
      p.px(bx + 4, hy - 1, W[2]);
      p.px(bx + 4, hy + 1, W[2]);
      p.vline(bx + 5, hy - 2, hy + 2, M[3]);
      if (pose.draw > 0) p.hline(bx + 1, bx + 6, hy - 1, M[5]);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// horses
function drawHorse(p: PixelCanvas, kind: NonNullable<UnitLook['mount']>, pal: Palette, frame: number, gallop: boolean, cx: number, fy: number, bob: number) {
  const coat = kind === 'warhorse' ? ['#3a3438', '#5a5458', '#7a7478', '#9a949a'] : kind === 'pony' ? ['#3e2416', '#5e3a22', '#7e5232', '#9a6a44'] : ['#2a1c14', '#4a3020', '#6a4430', '#8a5c40'];
  const T = pal.team;
  const by = fy - 4 - bob; // belly line
  const x0 = cx - 8;
  // legs: 4 frames gallop
  const legs = gallop
    ? [
        [-2, 0, 2, 1],
        [0, 1, -1, 2],
        [2, 0, 0, 1],
        [1, 2, -2, 0],
      ][frame % 4]
    : [0, 0, 0, 0];
  const legX = [x0 + 2, x0 + 4, x0 + 11, x0 + 13];
  for (let k = 0; k < 4; k++) {
    const back = k % 2 === 0;
    const lx = legX[k] + legs[k];
    const lift = gallop && legs[k] > 1 ? 1 : 0;
    p.vline(lx, by + 1, fy - 1 - lift, back ? coat[0] : coat[1]);
    p.px(lx, fy - 1 - lift, '#201818');
  }
  // body
  p.rect(x0 + 1, by - 4, 14, 5, coat[2]);
  p.hline(x0 + 2, x0 + 14, by - 4, coat[3]);
  p.hline(x0 + 1, x0 + 15, by, coat[1]);
  p.rect(x0, by - 3, 1, 3, coat[2]);
  // neck + head
  p.rect(x0 + 13, by - 7, 3, 4, coat[2]);
  p.rect(x0 + 15, by - 9, 3, 3, coat[2]);
  p.rect(x0 + 17, by - 8, 2, 2, coat[1]);
  p.px(x0 + 16, by - 10, coat[1]); // ear
  p.px(x0 + 16, by - 8, '#100c10'); // eye
  p.vline(x0 + 13, by - 8, by - 5, '#1e1612'); // mane
  p.px(x0 + 14, by - 9, '#1e1612');
  // tail
  const tw = gallop ? frame % 2 : 0;
  p.line(x0, by - 3, x0 - 2, by + 1 - tw, '#1e1612');
  p.px(x0 - 1, by - 3, '#1e1612');
  if (kind === 'warhorse') {
    // caparison in team colours with trim
    p.rect(x0 + 1, by - 4, 13, 7, T.main);
    p.hline(x0 + 1, x0 + 13, by + 2, T.dark);
    p.hline(x0 + 1, x0 + 13, by - 4, T.light);
    for (let k = 0; k < 13; k += 4) p.px(x0 + 2 + k, by, '#f0e6c8');
    p.rect(x0 + 13, by - 8, 3, 4, T.main); // crinet
    p.px(x0 + 17, by - 8, pal.metal[4]); // chanfron
    p.px(x0 + 17, by - 7, pal.metal[3]);
  } else {
    // saddle cloth
    p.rect(x0 + 5, by - 4, 5, 3, T.main);
    p.hline(x0 + 5, x0 + 9, by - 2, T.dark);
    p.px(x0 + 10, by - 2, pal.leather[1]);
  }
}

// ---------------------------------------------------------------------------------------------
// siege engines
function drawEngine(p: PixelCanvas, look: UnitLook, pal: Palette, f: number, cx: number, fy: number, deployed: boolean) {
  const W = RAMP.wood;
  const M = pal.metal;
  const T = pal.team;
  const wheel = (x: number, y: number, r = 2) => {
    p.ellipse(x, y, r + 0.5, r + 0.5, W[1]);
    p.ellipse(x, y, r - 0.5, r - 0.5, W[3]);
    p.px(x, y, M[3]);
  };
  switch (look.engine) {
    case 'ram': {
      const thrust = f === 7 ? 3 : f === 6 ? -2 : 0;
      const by = fy - 4;
      // log
      p.rect(cx - 9 + thrust, by - 5, 19, 3, W[3]);
      p.hline(cx - 9 + thrust, cx + 9 + thrust, by - 5, W[4]);
      p.rect(cx + 9 + thrust, by - 6, 3, 5, M[3]);
      p.px(cx + 11 + thrust, by - 6, M[5]);
      // shed roof (hides)
      for (let k = 0; k < 7; k++) p.hline(cx - 10 + k, cx + 7 - k, by - 6 - k, k % 2 ? '#7a5434' : '#8a6040');
      p.hline(cx - 10, cx + 7, by - 6, '#5a3a22');
      p.px(cx - 2, by - 13, T.main);
      p.vline(cx - 2, by - 15, by - 13, W[2]);
      p.rect(cx - 1, by - 16, 3, 2, T.main);
      // frame posts
      p.vline(cx - 9, by - 6, by, W[2]);
      p.vline(cx + 6, by - 6, by, W[2]);
      p.hline(cx - 10, cx + 7, by, W[1]);
      wheel(cx - 7, fy - 3);
      wheel(cx + 4, fy - 3);
      break;
    }
    case 'catapult': {
      const by = fy - 4;
      p.rect(cx - 9, by - 2, 18, 2, W[3]);
      p.hline(cx - 9, cx + 8, by - 2, W[4]);
      p.line(cx - 4, by - 2, cx - 1, by - 8, W[2]);
      p.line(cx + 2, by - 2, cx - 1, by - 8, W[2]);
      p.hline(cx - 3, cx + 1, by - 8, W[3]);
      // arm: f 6 cocked (back/down), 7 released (up), else resting cocked with stone
      const fired = f === 7 || f === 8;
      if (fired) {
        p.line(cx - 1, by - 4, cx + 2, by - 14, W[4]);
        p.rect(cx + 1, by - 16, 3, 2, W[2]);
      } else {
        p.line(cx - 1, by - 4, cx - 8, by - 7, W[4]);
        p.rect(cx - 10, by - 9, 3, 2, W[2]);
        p.ellipse(cx - 9, by - 10, 1.5, 1.2, RAMP.stone[4]);
      }
      // rope coil
      p.ellipse(cx, by - 3, 1.5, 1.5, '#a08a5a');
      wheel(cx - 6, fy - 3);
      wheel(cx + 6, fy - 3);
      // team pennant
      p.vline(cx + 8, by - 9, by - 2, W[2]);
      p.rect(cx + 9, by - 9, 3, 2, T.main);
      break;
    }
    case 'ballista': {
      const by = fy - 4;
      p.rect(cx - 7, by - 2, 14, 2, W[3]);
      p.line(cx - 4, by - 2, cx - 2, by - 6, W[2]);
      p.line(cx + 3, by - 2, cx + 1, by - 6, W[2]);
      // stock + bow
      p.hline(cx - 6, cx + 6, by - 7, W[4]);
      const pull = f === 6 ? -2 : 0;
      p.line(cx + 5, by - 7, cx + 3, by - 12, W[2]);
      p.line(cx + 5, by - 7, cx + 3, by - 2, W[2]);
      p.line(cx + 3, by - 12, cx - 3 + pull, by - 7, '#d8d0c0');
      p.line(cx + 3, by - 2, cx - 3 + pull, by - 7, '#d8d0c0');
      if (f !== 7 && f !== 8) {
        p.hline(cx - 3 + pull, cx + 8, by - 8, W[5]);
        p.px(cx + 9, by - 8, M[5]);
      }
      wheel(cx - 5, fy - 3, 1.5);
      wheel(cx + 5, fy - 3, 1.5);
      p.px(cx - 6, by - 8, T.main);
      p.px(cx - 6, by - 9, T.main);
      break;
    }
    case 'trebuchet': {
      const by = fy - 3;
      if (!deployed) {
        // packed on a cart: arm lying flat
        p.rect(cx - 13, by - 3, 26, 3, W[3]);
        p.hline(cx - 13, cx + 12, by - 3, W[4]);
        p.rect(cx - 15, by - 7, 30, 2, W[4]);
        p.rect(cx + 10, by - 9, 5, 4, RAMP.stone[3]);
        p.rect(cx - 6, by - 10, 6, 3, W[2]);
        wheel(cx - 10, fy - 3);
        wheel(cx - 2, fy - 3);
        wheel(cx + 8, fy - 3);
        p.rect(cx - 2, by - 14, 3, 2, T.main);
        p.vline(cx - 2, by - 12, by - 10, W[2]);
        break;
      }
      // A-frame
      p.line(cx - 8, by, cx, by - 22, W[2]);
      p.line(cx + 8, by, cx, by - 22, W[2]);
      p.line(cx - 6, by, cx + 1, by - 21, W[3]);
      p.rect(cx - 12, by - 2, 24, 2, W[3]);
      p.hline(cx - 12, cx + 11, by - 2, W[4]);
      const fired = f === 7 || f === 8;
      if (fired) {
        // arm swung up front, counterweight low
        p.line(cx, by - 22, cx + 10, by - 34, W[4]);
        p.line(cx, by - 22, cx - 4, by - 16, W[4]);
        p.rect(cx - 7, by - 16, 6, 5, RAMP.stone[3]);
        p.line(cx + 10, by - 34, cx + 14, by - 30, '#a08a5a');
      } else {
        // cocked: long arm down at back, counterweight high
        p.line(cx, by - 22, cx - 13, by - 6, W[4]);
        p.line(cx, by - 22, cx + 5, by - 28, W[4]);
        p.rect(cx + 3, by - 31, 6, 5, RAMP.stone[3]);
        p.hline(cx + 3, cx + 8, by - 31, RAMP.stone[5]);
        p.ellipse(cx - 13, by - 4, 1.8, 1.5, RAMP.stone[4]);
      }
      p.px(cx, by - 22, M[4]);
      p.rect(cx + 10, by - 10, 3, 2, T.main);
      p.vline(cx + 10, by - 10, by - 2, W[2]);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
function drawBeast(p: PixelCanvas, f: number, cx: number, fy: number) {
  // grey wolf, side view facing right
  const fur = ['#3a3a40', '#5a5a62', '#7a7a84', '#a0a0aa'];
  const walking = f >= 2 && f <= 5;
  const step = walking ? [0, 1, 0, -1][(f - 2) % 4] : 0;
  const lunge = f === 7 ? 2 : 0;
  const by = fy - 3;
  const x0 = cx - 6 + lunge;
  p.vline(x0 + 1 + step, by, fy - 1, fur[0]);
  p.vline(x0 + 3 - step, by, fy - 1, fur[1]);
  p.vline(x0 + 8 - step, by, fy - 1, fur[0]);
  p.vline(x0 + 10 + step, by, fy - 1, fur[1]);
  p.rect(x0, by - 3, 11, 3, fur[2]);
  p.hline(x0 + 1, x0 + 10, by - 3, fur[3]);
  p.hline(x0, x0 + 10, by - 1, fur[1]);
  p.rect(x0 + 10, by - 5, 3, 3, fur[2]);
  p.px(x0 + 13, by - 4, fur[2]);
  p.px(x0 + 13, by - 3, fur[1]);
  p.px(x0 + 11, by - 6, fur[1]);
  p.px(x0 + 12, by - 4, '#e8c040');
  p.line(x0, by - 3, x0 - 2, by - 5 + (walking ? step : 0), fur[2]);
  if (f === 7) p.px(x0 + 13, by - 2, '#f0f0f0');
}

// ---------------------------------------------------------------------------------------------
function poseFor(frame: number, look: UnitLook): Pose {
  const p: Pose = { ...BASE_POSE };
  const ranged = look.weapon === 'bow' || look.weapon === 'longbow' || look.weapon === 'crossbow';
  const polearm = look.weapon === 'spear' || look.weapon === 'pike' || look.weapon === 'lance' || look.weapon === 'pitchfork';
  if (ranged) p.arm = 0;
  if (polearm) p.arm = -0.35;
  if (look.weapon === 'lance') p.arm = -0.12;
  switch (frame) {
    case 0:
      break;
    case 1:
      p.bob = 0;
      p.arm += ranged ? 0 : 0.08;
      break;
    case 2:
      p.legF = 2;
      p.legB = -2;
      break;
    case 3:
      p.legF = 0;
      p.legB = 0;
      p.bob = 1;
      p.liftB = 1;
      break;
    case 4:
      p.legF = -1;
      p.legB = 1;
      break;
    case 5:
      p.legF = 0;
      p.legB = 0;
      p.bob = 1;
      p.liftF = 1;
      break;
    case 6: // windup
      if (ranged) p.draw = 1;
      else if (polearm) {
        p.arm = look.weapon === 'lance' ? -0.1 : -0.2;
        p.reach = -2;
      } else {
        p.arm = -2.2;
        p.lean = -1;
      }
      break;
    case 7: // strike
      if (ranged) p.draw = 0;
      else if (polearm) {
        p.reach = 3;
        p.arm = look.weapon === 'lance' ? -0.05 : -0.1;
        p.lean = 1;
      } else {
        p.arm = 0.5;
        p.lean = 1;
        p.reach = 1;
      }
      p.legF = 2;
      p.legB = -2;
      break;
    case 8: // recover
      if (!ranged && !polearm) p.arm = -0.4;
      break;
  }
  return p;
}

/** rotate a canvas 90° clockwise into a new canvas of swapped dimensions (lossless) */
function rot90(src: PixelCanvas): PixelCanvas {
  const out = new PixelCanvas(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) out.data[x * out.w + (src.h - 1 - y)] = src.data[y * src.w + x];
  return out;
}

export function buildUnitSheet(def: UnitDef, kc: KingdomColor, seed = 0): UnitSheet {
  const look = def.look;
  const mounted = !!look.mount;
  const engine = look.body === 'engine';
  const beast = look.body === 'beast';
  const tall = look.engine === 'trebuchet';
  const w = engine ? (tall ? 40 : 30) : mounted ? 30 : 22;
  const h = engine ? (tall ? 44 : 26) : mounted ? 28 : 22;
  const ax = Math.floor(w / 2);
  const ay = h - 3;
  const pal = makePalette(look, kc, seed + def.id.length);
  const frames: PixelCanvas[] = [];
  const total = FRAME_COUNT + (def.deploy ? 2 : 0);
  for (let f = 0; f < FRAME_COUNT; f++) {
    const isDie = f >= 9;
    const baseF = isDie ? 0 : f;
    let pc = new PixelCanvas(w, h);
    const pose = poseFor(baseF, look);
    if (engine) {
      drawEngine(pc, look, pal, baseF, ax, ay, true);
      // crew member pushing/operating
      if (look.engine !== 'trebuchet' || true) {
        const crewLook: UnitLook = { body: 'peasant', helmet: 'cap', armor: 'tunic', weapon: 'none', shield: 'none' };
        const cp = poseFor(baseF >= 2 && baseF <= 5 ? baseF : 0, crewLook);
        drawFigure(pc, crewLook, pal, cp, ax - (tall ? 15 : 11), ay);
      }
    } else if (beast) {
      drawBeast(pc, baseF, ax, ay);
    } else if (mounted) {
      const gallop = baseF >= 2 && baseF <= 5;
      const hf = gallop ? baseF - 2 : 0;
      const bob = gallop ? (hf % 2) : 0;
      drawHorse(pc, look.mount!, pal, hf, gallop, ax, ay, bob);
      const rp = { ...pose, legF: 0, legB: 0, bob: 0 };
      drawFigure(pc, look, pal, rp, ax + 1, ay - 9 - bob, { seated: true });
      // rider's leg over the horse
      pc.rect(ax + 1, ay - 9 - bob, 2, 3, look.armor === 'plate' ? pal.metal[4] : pal.leather[2]);
    } else {
      drawFigure(pc, look, pal, pose, ax, ay);
    }
    if (isDie) {
      const k = f - 9;
      if (k === 0) {
        // stagger: shift upper body back and down
        const src = pc;
        pc = new PixelCanvas(w, h);
        for (let y = 0; y < h; y++) {
          const off = y < ay - 4 ? -Math.round((ay - 4 - y) * 0.3) : 0;
          for (let x = 0; x < w; x++) {
            const v = src.data[y * w + x];
            if (!v) continue;
            const ny = Math.min(h - 1, y + 1);
            const nx = x + off;
            if (nx >= 0 && nx < w) pc.data[ny * w + nx] = v;
          }
        }
      } else if (mounted || engine || beast) {
        // big bodies collapse: squash toward the ground line
        const src = pc;
        pc = new PixelCanvas(w, h);
        const sq = k === 1 ? 0.7 : 0.45;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const sy = Math.round(ay - (ay - y) / sq);
            if (sy < 0 || sy >= h) continue;
            const v = src.data[sy * w + x + 0];
            if (!v) continue;
            const nx = x + (k === 2 ? 1 : 0);
            if (nx < w) pc.data[y * w + nx] = k === 2 ? darken(v) : v;
          }
      } else {
        // lying on the ground: rotate the figure and lay it at the feet line
        const r = rot90(pc);
        // crop rotated content's bounding box
        let minX = r.w;
        let maxX = 0;
        let minY = r.h;
        let maxY = 0;
        for (let y = 0; y < r.h; y++)
          for (let x = 0; x < r.w; x++)
            if (r.data[y * r.w + x]) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
        pc = new PixelCanvas(w, h);
        const bw = maxX - minX + 1; // lying length
        const bh = maxY - minY + 1;
        const ox = Math.round(ax - bw / 2) + (k === 1 ? -1 : 0);
        const oy = ay - bh + 1 + (k === 2 ? 1 : 0);
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const v = r.data[y * r.w + x];
            if (!v) continue;
            const tx = ox + (x - minX);
            const ty = oy + (y - minY);
            if (tx >= 0 && ty >= 0 && tx < w && ty < h) pc.data[ty * w + tx] = k === 2 ? darken(v) : v;
          }
      }
    }
    pc.outline(OUTLINE, 0.75);
    pc.shadow(ax, ay + 0.5, engine ? (tall ? 12 : 10) : mounted ? 9 : beast ? 6 : 4.5, engine ? 3 : mounted ? 2.5 : 1.8, 0.32);
    frames.push(pc);
  }
  // trebuchet packed frames (extra)
  for (let f = FRAME_COUNT; f < total; f++) {
    const pc = new PixelCanvas(w, h);
    drawEngine(pc, look, pal, 0, ax, ay, false);
    pc.outline(OUTLINE, 0.75);
    pc.shadow(ax, ay + 0.5, 13, 3, 0.32);
    frames.push(pc);
  }
  return { w, h, ax, ay, frames };
}

function darken(v: number): number {
  const r = (v & 255) * 0.75;
  const g = ((v >>> 8) & 255) * 0.75;
  const b = ((v >>> 16) & 255) * 0.8;
  return (((v >>> 24) & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export { mix };

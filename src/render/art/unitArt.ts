import type { UnitDef, UnitLook } from '../../data/units';
import type { KingdomColor } from '../../data/factions';
import { PixelCanvas, mix, shade } from './PixelCanvas';
import { OUTLINE, RAMP } from './palette';

/**
 * Procedural paper-doll soldiers. Every unit is assembled from a body, armour, helmet, weapon,
 * shield and (optionally) a mount or siege engine, then outlined. Team colour appears only on
 * tabards, shields, plumes and caparisons so soldiers still read as believable medieval troops.
 *
 * Output layout per unit type (see FR): idle, walk, two weapon-specific attack variants, two death
 * variants, flinch, block, cheer, charge-run, rout, tool work cycle and siege deploy. Frames a body
 * type does not need are aliases of an existing frame (number entries), so they cost no atlas space.
 * Replacing with real art = supplying frames under the same names (see ArtRegistry).
 */

export const FR = {
  idle: [0, 1],
  walk: [2, 3, 4, 5],
  atkA: [6, 7, 8],
  dieA: [9, 10, 11],
  deploy: [12, 13],
  atkB: [14, 15, 16],
  dieB: [17, 18, 19],
  flinch: 20,
  cheer: [21, 22],
  block: 23,
  run: [24, 25, 26, 27],
  flee: [28, 29, 30, 31],
  work: [32, 33, 34, 35],
} as const;
export const FRAME_COUNT = 36;
/** legacy names */
export const ANIMS = { idle: FR.idle, walk: FR.walk, attack: FR.atkA, die: FR.dieA } as const;

export interface UnitSheet {
  w: number;
  h: number;
  /** feet anchor in px */
  ax: number;
  ay: number;
  /** a canvas, or the index of an earlier frame this one reuses */
  frames: (PixelCanvas | number)[];
}

interface Pose {
  bob: number; // whole figure lift (walk bounce), feet included
  legF: number; // front foot x offset
  legB: number;
  liftF: number; // front foot lift (px)
  liftB: number;
  arm: number; // weapon angle (rad): 0 forward, -PI/2 up
  reach: number; // forward shove for thrust/strike
  draw: number; // bow draw 0..1
  lean: number;
  /** torso lowered with feet planted (lunges, digging, kneeling) */
  crouch: number;
  /** airborne: whole figure off the ground */
  jump: number;
  /** back leg folded under (kneeling) */
  kneel: boolean;
  /** off-hand arm angle; drawn behind the body when set */
  armB: number | null;
  /** shield raised (0..1) and pushed forward (px) */
  shieldUp: number;
  shieldPush: number;
  /** weapon dropped / not in hand */
  noWeapon: boolean;
}

const BASE_POSE: Pose = { bob: 0, legF: 1, legB: -1, liftF: 0, liftB: 0, arm: -0.9, reach: 0, draw: 0, lean: 0, crouch: 0, jump: 0, kneel: false, armB: null, shieldUp: 0, shieldPush: 0, noWeapon: false };

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
  const ground = fy - pose.bob - pose.jump; // feet line
  const by = ground + pose.crouch; // body baseline
  const tw = heavy ? 5 : 4; // torso width
  const tx = cx - 2 + pose.lean; // torso left x
  const legTop = by - 3;
  const torsoTop = by - 8;
  const headTop = by - 12;
  const T = pal.team;
  const hose = peasant ? pal.cloth[1] : heavy ? pal.metal[2] : '#4a3a30';
  const boot = pal.leather[1];

  // ---- legs (skip when seated); feet stay on the ground line, so a crouch shortens the legs
  if (!opts.seated) {
    const leg = (x: number, lift: number, col: string, bootCol: string, toe: boolean) => {
      const foot = ground - 1 - lift;
      if (foot > legTop) p.rect(x, legTop, 2, foot - legTop, col);
      p.rect(x, foot, 2, 1, bootCol);
      if (toe) p.px(x + 2, foot, bootCol);
    };
    const bx = cx - 1 + pose.legB;
    if (pose.kneel) {
      // shin flat on the ground behind
      p.rect(bx, legTop, 2, Math.max(1, ground - 1 - legTop), shade(hose, -0.25));
      p.rect(bx - 2, ground - 1, 3, 1, shade(boot, -0.2));
    } else leg(bx, pose.liftB, shade(hose, -0.25), shade(boot, -0.2), false);
    leg(cx + pose.legF - 1, pose.liftF, hose, boot, true);
  }

  const shoulderX = tx + 1;
  const shoulderY = torsoTop + 1;
  const M0 = pal.metal;
  const armCol = look.armor === 'plate' ? M0[4] : look.armor === 'mail' ? M0[3] : look.armor === 'gambeson' ? '#c4b48e' : look.armor === 'leather' ? pal.leather[3] : pal.cloth[2];
  // ---- trader's pack on the back
  if (look.sack) {
    p.rect(tx - 3, torsoTop - 1, 4, 5, '#c8b484');
    p.hline(tx - 3, tx, torsoTop - 1, '#e0d0a0');
    p.vline(tx - 3, torsoTop, torsoTop + 3, '#9a8458');
    p.px(tx - 1, torsoTop + 1, '#7a6440');
  }
  // ---- back (off-hand) arm, behind the body: raised in cheers, flailing in a rout
  if (pose.armB !== null) {
    const bxh = shoulderX + Math.round(Math.cos(pose.armB) * 4);
    const byh = shoulderY + Math.round(Math.sin(pose.armB) * 4);
    p.line(shoulderX, shoulderY, bxh, byh, shade(armCol, -0.25));
    p.px(bxh, byh, shade(pal.skin[3], -0.15));
  }
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
  const sx = tx + tw - 1 + Math.round(pose.reach * 0.5) + pose.shieldPush;
  const sy = torsoTop + 1 - Math.round(pose.shieldUp * 3);
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
  p.line(shoulderX + 1, shoulderY, handX, handY, armCol);
  p.px(handX, handY, look.armor === 'plate' ? M[5] : skin[3]);
  if (!pose.noWeapon) drawWeapon(p, look.weapon, handX, handY, pose, pal);
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
      // bow limbs run across the aim line; tilting the aim lofts a volley
      const tall = w === 'longbow' ? 6 : 4;
      const px = -dy; // limb axis (perpendicular to aim)
      const py = dx;
      const cxb = hx + dx;
      const cyb = hy + dy;
      const draw = pose.draw * 2.5;
      for (let k = -tall; k <= tall; k++) {
        const curve = (1 - (k * k) / (tall * tall)) * 2;
        p.px(cxb + px * k + dx * curve, cyb + py * k + dy * curve, k === -tall || k === tall ? W[2] : W[4]);
      }
      const t1x = cxb - px * tall;
      const t1y = cyb - py * tall;
      const t2x = cxb + px * tall;
      const t2y = cyb + py * tall;
      const nx = cxb - dx * draw;
      const ny = cyb - dy * draw;
      p.line(t1x, t1y, nx, ny, '#d8d0c0');
      p.line(nx, ny, t2x, t2y, '#d8d0c0');
      if (pose.draw > 0) {
        p.line(nx, ny, cxb + dx * 4, cyb + dy * 4, W[5]);
        p.px(cxb + dx * 5, cyb + dy * 5, M[5]);
      }
      break;
    }
    case 'crossbow': {
      // stock along the aim line, prod across its tip
      const tipx = hx + dx * 5;
      const tipy = hy + dy * 5;
      p.line(hx - dx * 2, hy - dy * 2, tipx, tipy, W[3]);
      p.line(tipx - dy * 2, tipy + dx * 2, tipx + dy * 2, tipy - dx * 2, M[3]);
      p.px(tipx - dy * 2 - dx, tipy + dx * 2 - dy, W[2]);
      p.px(tipx + dy * 2 - dx, tipy - dx * 2 - dy, W[2]);
      if (pose.draw > 0) p.line(hx + dx - dy, hy + dy + dx * -1, tipx + dx, tipy + dy, M[5]);
      break;
    }
    case 'pick': {
      seg(6, -1, W[3]);
      const ax = hx + dx * 6;
      const ay = hy + dy * 6;
      // curved double point across the haft
      p.line(ax - dy * 3 - dx, ay + dx * 3 - dy, ax + dy * 3 - dx, ay - dx * 3 - dy, M[3]);
      p.px(ax - dy * 3 - dx * 2, ay + dx * 3 - dy * 2, M[5]);
      p.px(ax + dy * 3 - dx * 2, ay - dx * 3 - dy * 2, M[5]);
      break;
    }
    case 'hammer': {
      seg(5, -1, W[3]);
      const ax = hx + dx * 5;
      const ay = hy + dy * 5;
      p.line(ax - dy * 2, ay + dx * 2, ax + dy * 2, ay - dx * 2, M[3]);
      p.line(ax - dy * 2 + dx, ay + dx * 2 + dy, ax + dy * 2 + dx, ay - dx * 2 + dy, M[4]);
      break;
    }
    case 'hoe': {
      seg(9, -3, W[4]);
      const ax = hx + dx * 9;
      const ay = hy + dy * 9;
      // blade set square to the haft
      p.line(ax, ay, ax - dy * 2, ay + dx * 2, M[3]);
      p.px(ax - dy * 3, ay + dx * 3, M[5]);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// horses
function drawHorse(p: PixelCanvas, kind: NonNullable<UnitLook['mount']>, pal: Palette, frame: number, gallop: boolean, cx: number, fy: number, bob: number, o: { nod?: boolean; stride?: number } = {}) {
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
  if (o.stride) for (let k = 0; k < 4; k++) legs[k] = Math.round(legs[k] * o.stride);
  const nod = o.nod ? 1 : 0;
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
  // neck + head (a nod drops the head while idle)
  p.rect(x0 + 13, by - 7 + nod, 3, 4, coat[2]);
  p.rect(x0 + 15, by - 9 + nod * 2, 3, 3, coat[2]);
  p.rect(x0 + 17, by - 8 + nod * 2, 2, 2, coat[1]);
  p.px(x0 + 16, by - 10 + nod * 2, coat[1]); // ear
  p.px(x0 + 16, by - 8 + nod * 2, '#100c10'); // eye
  p.vline(x0 + 13, by - 8 + nod, by - 5, '#1e1612'); // mane
  p.px(x0 + 14, by - 9 + nod, '#1e1612');
  // tail (swishes while idle)
  const tw = gallop ? frame % 2 : nod ? -1 : 0;
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
/** engine animation phase: 0 rest, 1 wind-up, 2 release/strike, 3 recoil/reload */
type EnginePhase = 0 | 1 | 2 | 3;

function drawEngine(p: PixelCanvas, look: UnitLook, pal: Palette, ph: EnginePhase, cx: number, fy: number, deployed: boolean, wheelTurn = 0) {
  const W = RAMP.wood;
  const M = pal.metal;
  const T = pal.team;
  const wheel = (x: number, y: number, r = 2) => {
    p.ellipse(x, y, r + 0.5, r + 0.5, W[1]);
    p.ellipse(x, y, r - 0.5, r - 0.5, W[3]);
    // spokes turn as the engine rolls
    const a = wheelTurn * (Math.PI / 4);
    p.px(x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r), W[1]);
    p.px(x - Math.round(Math.cos(a) * r), y - Math.round(Math.sin(a) * r), W[1]);
    p.px(x, y, M[3]);
  };
  switch (look.engine) {
    case 'ram': {
      const thrust = ph === 1 ? -3 : ph === 2 ? 4 : ph === 3 ? 1 : 0;
      const by = fy - 4;
      // log on its chains
      p.rect(cx - 9 + thrust, by - 5, 19, 3, W[3]);
      p.hline(cx - 9 + thrust, cx + 9 + thrust, by - 5, W[4]);
      p.rect(cx + 9 + thrust, by - 6, 3, 5, M[3]);
      p.px(cx + 11 + thrust, by - 6, M[5]);
      p.line(cx - 4, by - 6, cx - 4 + thrust, by - 4, M[2]);
      p.line(cx + 3, by - 6, cx + 3 + thrust, by - 4, M[2]);
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
      if (ph === 2) {
        // arm slammed against the crossbar, stone gone
        p.line(cx - 1, by - 4, cx + 2, by - 14, W[4]);
        p.rect(cx + 1, by - 16, 3, 2, W[2]);
      } else if (ph === 3) {
        // winched back halfway, empty cup
        p.line(cx - 1, by - 4, cx - 6, by - 11, W[4]);
        p.rect(cx - 8, by - 13, 3, 2, W[2]);
      } else {
        // cocked low with a stone (wind-up pulls it lower still)
        const low = ph === 1 ? 1 : 0;
        p.line(cx - 1, by - 4, cx - 8, by - 7 + low, W[4]);
        p.rect(cx - 10, by - 9 + low, 3, 2, W[2]);
        p.ellipse(cx - 9, by - 10 + low, 1.5, 1.2, RAMP.stone[4]);
      }
      // rope coil (twisted tighter on the wind-up)
      p.ellipse(cx, by - 3, ph === 1 ? 2 : 1.5, 1.5, '#a08a5a');
      wheel(cx - 6, fy - 3);
      wheel(cx + 6, fy - 3);
      p.vline(cx + 8, by - 9, by - 2, W[2]);
      p.rect(cx + 9, by - 9, 3, 2, T.main);
      break;
    }
    case 'ballista': {
      const by = fy - 4;
      p.rect(cx - 7, by - 2, 14, 2, W[3]);
      p.line(cx - 4, by - 2, cx - 2, by - 6, W[2]);
      p.line(cx + 3, by - 2, cx + 1, by - 6, W[2]);
      p.hline(cx - 6, cx + 6, by - 7, W[4]);
      const pull = ph === 1 ? -3 : ph === 2 ? 2 : ph === 3 ? -1 : 0;
      const flex = ph === 1 ? -1 : 0;
      p.line(cx + 5, by - 7, cx + 3 + flex, by - 12, W[2]);
      p.line(cx + 5, by - 7, cx + 3 + flex, by - 2, W[2]);
      p.line(cx + 3 + flex, by - 12, cx - 3 + pull, by - 7, '#d8d0c0');
      p.line(cx + 3 + flex, by - 2, cx - 3 + pull, by - 7, '#d8d0c0');
      if (ph !== 2) {
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
      p.line(cx - 8, by, cx, by - 22, W[2]);
      p.line(cx + 8, by, cx, by - 22, W[2]);
      p.line(cx - 6, by, cx + 1, by - 21, W[3]);
      p.rect(cx - 12, by - 2, 24, 2, W[3]);
      p.hline(cx - 12, cx + 11, by - 2, W[4]);
      if (ph === 2) {
        // mid-swing: arm vertical, sling whipping over the top
        p.line(cx, by - 22, cx + 2, by - 36, W[4]);
        p.line(cx, by - 22, cx - 1, by - 15, W[4]);
        p.rect(cx - 4, by - 15, 6, 5, RAMP.stone[3]);
        p.line(cx + 2, by - 36, cx + 9, by - 38, '#a08a5a');
      } else if (ph === 3) {
        // follow-through: arm swung out front, counterweight low and swaying
        p.line(cx, by - 22, cx + 10, by - 34, W[4]);
        p.line(cx, by - 22, cx - 4, by - 16, W[4]);
        p.rect(cx - 7, by - 16, 6, 5, RAMP.stone[3]);
        p.line(cx + 10, by - 34, cx + 14, by - 30, '#a08a5a');
      } else {
        // cocked: long arm down at back, counterweight high (wind-up: crew hauls the sling taut)
        p.line(cx, by - 22, cx - 13, by - 6, W[4]);
        p.line(cx, by - 22, cx + 5, by - 28, W[4]);
        p.rect(cx + 3, by - 31, 6, 5, RAMP.stone[3]);
        p.hline(cx + 3, cx + 8, by - 31, RAMP.stone[5]);
        p.ellipse(cx - 13 - (ph === 1 ? 2 : 0), by - 4, 1.8, 1.5, RAMP.stone[4]);
        if (ph === 1) p.line(cx - 13, by - 6, cx - 15, by - 4, '#a08a5a');
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
type BeastState = 'idle0' | 'idle1' | 'walk' | 'run' | 'lunge0' | 'lunge1' | 'leap0' | 'leap1' | 'howl' | 'flinch';

function drawBeast(p: PixelCanvas, st: BeastState, step0: number, cx: number, fy: number) {
  // grey wolf, side view facing right
  const fur = ['#3a3a40', '#5a5a62', '#7a7a84', '#a0a0aa'];
  const moving = st === 'walk' || st === 'run';
  const stride = st === 'run' ? 2 : 1;
  const step = moving ? [0, 1, 0, -1][step0 % 4] * stride : 0;
  const lunge = st === 'lunge1' ? 3 : st === 'lunge0' ? -1 : st === 'leap1' ? 2 : 0;
  const lift = st === 'leap0' ? 1 : st === 'leap1' ? 3 : 0;
  const crouch = st === 'lunge0' || st === 'flinch' ? 1 : 0;
  const by = fy - 3 - lift + crouch;
  const x0 = cx - 6 + lunge;
  const tucked = st === 'leap1';
  p.vline(x0 + 1 + step, by, fy - 1 - lift - (tucked ? 1 : 0), fur[0]);
  p.vline(x0 + 3 - step, by, fy - 1 - lift, fur[1]);
  p.vline(x0 + 8 - step + (tucked ? 2 : 0), by, fy - 1 - lift - (tucked ? 1 : 0), fur[0]);
  p.vline(x0 + 10 + step + (tucked ? 2 : 0), by, fy - 1 - lift, fur[1]);
  p.rect(x0, by - 3, 11, 3, fur[2]);
  p.hline(x0 + 1, x0 + 10, by - 3, fur[3]);
  p.hline(x0, x0 + 10, by - 1, fur[1]);
  const howl = st === 'howl';
  const hx = x0 + 10;
  const hy = howl ? by - 7 : by - 5 + (st === 'idle1' ? 1 : 0);
  p.rect(hx, hy, 3, 3, fur[2]);
  if (howl) {
    // muzzle raised to the sky
    p.px(hx + 2, hy - 1, fur[2]);
    p.px(hx + 3, hy - 2, fur[1]);
    p.px(hx + 1, hy - 1, fur[1]);
  } else {
    p.px(hx + 3, hy + 1, fur[2]);
    p.px(hx + 3, hy + 2, fur[1]);
  }
  p.px(hx + 1, hy - 1, fur[1]); // ear
  p.px(hx + 2, hy + 1, '#e8c040');
  // tail: wags while idle, streams out at a run, drops when hurt
  const tailY = st === 'idle1' ? -6 : st === 'run' || tucked ? -3 : st === 'flinch' ? -1 : -5;
  p.line(x0, by - 3, x0 - 2, by + tailY + 2 + (moving ? step : 0), fur[2]);
  if (st === 'lunge1' || st === 'leap1') {
    // bared teeth
    p.px(hx + 3, hy + 2, '#f0f0f0');
    p.px(hx + 2, hy + 2, '#f0f0f0');
  }
}

type WeaponClass = 'ranged' | 'crossbow' | 'polearm' | 'lance' | 'great' | 'chop' | 'sword' | 'none';

function weaponClass(w: UnitLook['weapon']): WeaponClass {
  switch (w) {
    case 'bow':
    case 'longbow':
      return 'ranged';
    case 'crossbow':
      return 'crossbow';
    case 'spear':
    case 'pike':
    case 'pitchfork':
      return 'polearm';
    case 'lance':
      return 'lance';
    case 'greatsword':
      return 'great';
    case 'axe':
    case 'club':
    case 'hammer':
    case 'pick':
    case 'hoe':
      return 'chop';
    case 'sword':
      return 'sword';
    default:
      return 'none';
  }
}

type PoseKind = 'idle' | 'walk' | 'run' | 'flee' | 'atkA' | 'atkB' | 'flinch' | 'block' | 'cheer' | 'work' | 'kneel';

const WALK: Partial<Pose>[] = [
  { legF: 2, legB: -2 },
  { legF: 0, legB: 0, bob: 1, liftB: 1 },
  { legF: -1, legB: 1 },
  { legF: 0, legB: 0, bob: 1, liftF: 1 },
];
const RUN: Partial<Pose>[] = [
  { legF: 3, legB: -3, lean: 1 },
  { legF: 0, legB: 0, bob: 1, liftB: 2, lean: 1 },
  { legF: -2, legB: 2, lean: 1 },
  { legF: 0, legB: 0, bob: 1, liftF: 2, lean: 1 },
];
const STANCE: Partial<Pose> = { legF: 2, legB: -2 };

/** A pose for a figure (infantry, or a rider when `mounted`). `i` indexes the frame within the anim. */
function figurePose(kind: PoseKind, i: number, look: UnitLook, mounted = false): Pose {
  const wc = weaponClass(look.weapon);
  const p: Pose = { ...BASE_POSE };
  const rest = wc === 'ranged' || wc === 'crossbow' ? 0 : wc === 'polearm' ? -0.35 : wc === 'lance' ? -0.12 : -0.9;
  p.arm = rest;
  const set = (o: Partial<Pose>) => Object.assign(p, o);
  const bigShield = look.shield === 'tower';
  switch (kind) {
    case 'idle':
      if (i === 1) p.arm += wc === 'ranged' || wc === 'crossbow' ? 0 : 0.08;
      break;
    case 'walk':
      set(WALK[i]);
      break;
    case 'run': {
      // charging: long stride, leaning in, weapon readied
      set(RUN[i]);
      if (wc === 'polearm' || wc === 'lance') set({ arm: -0.08, reach: 1 });
      else if (wc === 'ranged' || wc === 'crossbow') p.arm = 0.35;
      else if (wc === 'great') p.arm = -2.3;
      else if (wc === 'none') set({ arm: i % 2 ? 0.5 : -0.4, armB: i % 2 ? -0.6 : 0.6 });
      else p.arm = -1.9;
      if (look.shield !== 'none') p.shieldPush = 1;
      break;
    }
    case 'flee': {
      // rout: weapon thrown aside, arms flailing
      set(RUN[i]);
      set({ noWeapon: true, arm: -2.1 + (i % 2) * 0.7, armB: -2.5 + ((i + 1) % 2) * 0.7, shieldUp: 0 });
      break;
    }
    case 'flinch':
      set({ lean: -1, arm: rest - 0.5, crouch: 1, legF: 0, legB: -2, shieldUp: 0.4, reach: -1 });
      break;
    case 'block':
      if (look.shield !== 'none') set({ shieldUp: 1, shieldPush: 1, crouch: 1, ...STANCE, arm: rest - 0.2 });
      else if (wc === 'ranged' || wc === 'crossbow') set({ arm: -0.5, crouch: 1, lean: -1 });
      else set({ arm: -1.35, reach: 1, crouch: 1, ...STANCE }); // parry across the body
      break;
    case 'cheer':
      set(i === 0 ? { arm: -1.57, armB: -2.0, jump: mounted ? 0 : 1 } : { arm: -1.35, armB: -1.85 });
      if (wc === 'ranged' || wc === 'crossbow') p.arm = i === 0 ? -1.45 : -1.25;
      break;
    case 'kneel':
      set({ kneel: true, crouch: 2, noWeapon: true, arm: 0.9, lean: 1, legF: 2, legB: -1 });
      break;
    case 'work':
      switch (look.weapon) {
        case 'axe':
        case 'pick':
          set([{ arm: -1.8 }, { arm: -2.7, lean: -1 }, { arm: look.weapon === 'pick' ? 1.0 : 0.7, lean: 1, crouch: 1, ...STANCE }, { arm: 0.45, crouch: 1, ...STANCE }][i]);
          break;
        case 'hammer':
          set([{ arm: -1.4, crouch: 1 }, { arm: -2.2, crouch: 1 }, { arm: 0.5, crouch: 2, lean: 1 }, { arm: 0.2, crouch: 2 }][i]);
          break;
        case 'hoe':
          set([{ arm: -1.5 }, { arm: -2.0, lean: -1 }, { arm: 1.0, lean: 1, crouch: 1, ...STANCE }, { arm: 0.6, lean: 1, crouch: 1, reach: -1, ...STANCE }][i]);
          break;
        default:
          // trader tallying goods
          set([{ crouch: 1, arm: 0.6 }, { crouch: 2, arm: 0.9 }, { crouch: 2, arm: 0.7 }, { crouch: 1, arm: 0.4 }][i]);
      }
      break;
    case 'atkA':
    case 'atkB': {
      const b = kind === 'atkB';
      const lunge = { ...STANCE, crouch: mounted ? 0 : 1 };
      let seq: Partial<Pose>[];
      switch (wc) {
        case 'ranged':
          seq = b
            ? [{ draw: 1, arm: -0.6, lean: -1 }, { arm: -0.65, lean: -1 }, { arm: -0.4 }] // lofted volley
            : [{ draw: 1, arm: 0 }, { arm: 0, lean: -1 }, { arm: 0.05 }];
          break;
        case 'crossbow':
          seq = b && !mounted
            ? [{ kneel: true, crouch: 2, draw: 1, arm: -0.1 }, { kneel: true, crouch: 2, arm: -0.3, lean: -1 }, { kneel: true, crouch: 2, arm: 0.5 }] // kneeling shot
            : [{ draw: 1, arm: 0 }, { arm: -0.25, lean: -1 }, { arm: 0.6, crouch: 1 }]; // shoot, then crank down
          break;
        case 'polearm':
          seq = b
            ? [{ arm: -0.9, reach: -2, lean: -1 }, { arm: -0.35, reach: 4, lean: 2, ...lunge }, { arm: -0.5, reach: 1 }] // overhand jab
            : [{ arm: -0.2, reach: -2 }, { arm: -0.1, reach: 3, lean: 1, ...lunge }, { arm: rest }];
          break;
        case 'lance':
          seq = b
            ? [{ arm: -1.2, reach: -1 }, { arm: -0.25, reach: 3, lean: 1 }, { arm: -0.5 }]
            : [{ arm: -0.1, reach: -2 }, { arm: -0.05, reach: 4, lean: 1 }, { arm: -0.1, reach: 1 }];
          break;
        case 'great':
          seq = b
            ? [{ arm: 2.4, lean: -1, crouch: mounted ? 0 : 1 }, { arm: -0.2, reach: 2, lean: 1, ...STANCE }, { arm: -1.6 }] // wide sweep
            : [{ arm: -2.7, lean: -1 }, { arm: 0.9, lean: 2, reach: 1, ...lunge, legF: 3 }, { arm: 0.5, crouch: mounted ? 0 : 1 }]; // overhead cleave
          break;
        case 'chop':
          seq = b
            ? [{ arm: 1.3, lean: -1, crouch: mounted ? 0 : 1 }, { arm: -1.0, lean: 1, reach: 1 }, { arm: -0.6 }] // rising blow
            : [{ arm: -2.6, lean: -1 }, { arm: 0.8, lean: 1, ...lunge }, { arm: 0.5, crouch: mounted ? 0 : 1 }]; // overhead chop
          break;
        case 'sword':
          if (b && bigShield)
            seq = [{ shieldPush: -1, lean: -1, arm: -0.4 }, { shieldPush: 3, lean: 2, arm: -0.6, ...lunge, legF: 3 }, { shieldPush: 1, arm: -0.5 }]; // shield bash
          else
            seq = b
              ? [{ arm: -0.2, reach: -2, lean: -1 }, { arm: -0.1, reach: 4, lean: 2, ...lunge, legF: 3 }, { arm: -0.4, reach: 1 }] // thrust
              : [{ arm: -2.3, lean: -1 }, { arm: 0.6, lean: 1, reach: 1, ...lunge }, { arm: 0.2 }]; // cut
          break;
        default:
          seq = [{ arm: 0.3, reach: -1 }, { arm: 0, reach: 3, lean: 1, ...STANCE }, { arm: 0.2 }];
      }
      set(seq[i]);
      break;
    }
  }
  if (mounted) Object.assign(p, { legF: 0, legB: 0, bob: 0, jump: 0, crouch: 0, kneel: false });
  return p;
}

/** rotate a canvas 90° clockwise into a new canvas of swapped dimensions (lossless) */
function rot90(src: PixelCanvas): PixelCanvas {
  const out = new PixelCanvas(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) out.data[x * out.w + (src.h - 1 - y)] = src.data[y * src.w + x];
  return out;
}

/** rotate 90° counter-clockwise */
function rot270(src: PixelCanvas): PixelCanvas {
  const out = new PixelCanvas(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) out.data[(src.w - 1 - x) * out.w + y] = src.data[y * src.w + x];
  return out;
}

function bbox(pc: PixelCanvas) {
  let minX = pc.w;
  let maxX = -1;
  let minY = pc.h;
  let maxY = -1;
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w; x++)
      if (pc.data[y * pc.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return { minX, maxX, minY, maxY };
}

/** copy `src` onto `dst` with an offset, optionally darkened (death settles into the ground) */
function stamp(dst: PixelCanvas, src: PixelCanvas, ox: number, oy: number, dark = false) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (!v) continue;
      const tx = x + ox;
      const ty = y + oy;
      if (tx >= 0 && ty >= 0 && tx < dst.w && ty < dst.h) dst.data[ty * dst.w + tx] = dark ? darken(v) : v;
    }
}

/** body lying on the ground line, rotated forward (cw) or backward (ccw) */
function lying(src: PixelCanvas, w: number, h: number, ax: number, ay: number, dir: 'cw' | 'ccw', settle: boolean): PixelCanvas {
  const r = dir === 'cw' ? rot90(src) : rot270(src);
  const b = bbox(r);
  const out = new PixelCanvas(w, h);
  if (b.maxX < 0) return out;
  const bw = b.maxX - b.minX + 1;
  const bh = b.maxY - b.minY + 1;
  const ox = Math.round(ax - bw / 2) + (dir === 'cw' ? 1 : -1) * (settle ? 1 : 0) - b.minX;
  const oy = ay - bh + 1 + (settle ? 1 : 0) - b.minY;
  stamp(out, r, ox, oy, settle);
  return out;
}

/** upper body pitched back (stagger) */
function stagger(src: PixelCanvas, ay: number): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const off = y < ay - 4 ? -Math.round((ay - 4 - y) * 0.3) : 0;
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (!v) continue;
      const ny = Math.min(src.h - 1, y + 1);
      const nx = x + off;
      if (nx >= 0 && nx < src.w) out.data[ny * src.w + nx] = v;
    }
  }
  return out;
}

/** squash toward the ground line (big bodies collapsing) */
function squash(src: PixelCanvas, ay: number, sq: number, shift: number, dark: boolean): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const sy = Math.round(ay - (ay - y) / sq);
      if (sy < 0 || sy >= src.h) continue;
      const v = src.data[sy * src.w + x];
      if (!v) continue;
      const nx = x + shift;
      if (nx >= 0 && nx < src.w) out.data[y * src.w + nx] = dark ? darken(v) : v;
    }
  return out;
}

/** shear the front (right) half up (rearing, k > 0) or down (stumbling, k < 0) around a pivot */
function shear(src: PixelCanvas, pivotX: number, k: number): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (!v) continue;
      const ny = y - Math.round(Math.max(0, x - pivotX) * k);
      if (ny >= 0 && ny < src.h) out.data[ny * src.w + x] = v;
    }
  return out;
}

/** wreck an engine: planks drop and scatter */
function wreck(src: PixelCanvas, ay: number, k: number, seed: number): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let x0 = 0; x0 < src.w; x0 += 3) {
    const r = Math.sin((x0 + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const rnd = r - Math.floor(r);
    const drop = Math.round((k === 0 ? 2 : 6) * rnd + (k === 0 ? 1 : 3));
    const dx = Math.round((rnd - 0.5) * (k === 0 ? 2 : 4));
    for (let x = x0; x < Math.min(src.w, x0 + 3); x++)
      for (let y = 0; y < src.h; y++) {
        const v = src.data[y * src.w + x];
        if (!v) continue;
        const ny = Math.min(ay, y + drop);
        const nx = x + dx;
        if (nx >= 0 && nx < src.w && ny >= 0) out.data[ny * src.w + nx] = k === 2 ? darken(v) : v;
      }
  }
  return out;
}

/** the canvas behind frame `i`, following aliases */
export function sheetFrame(sheet: UnitSheet, i: number): PixelCanvas {
  let f = sheet.frames[i];
  while (typeof f === 'number') f = sheet.frames[f];
  return f;
}

export function buildUnitSheet(def: UnitDef, kc: KingdomColor, seed = 0): UnitSheet {
  const look = def.look;
  const mounted = !!look.mount;
  const engine = look.body === 'engine';
  const beast = look.body === 'beast';
  const tall = look.engine === 'trebuchet';
  const worker = def.special === 'worker';
  const w = engine ? (tall ? 40 : 30) : mounted ? 30 : 22;
  const h = engine ? (tall ? 44 : 26) : mounted ? 30 : 22;
  const ax = Math.floor(w / 2);
  const ay = h - 3;
  const pal = makePalette(look, kc, seed + def.id.length);
  const frames: (PixelCanvas | number)[] = new Array(FRAME_COUNT).fill(0);
  const crewLook: UnitLook = { body: 'peasant', helmet: 'cap', armor: 'tunic', weapon: 'none', shield: 'none' };
  const crewX = ax - (tall ? 15 : 11);

  // ---- raw (un-outlined) drawing of one living frame
  const infantry = (kind: PoseKind, i: number) => {
    const pc = new PixelCanvas(w, h);
    drawFigure(pc, look, pal, figurePose(kind, i, look), ax, ay);
    return pc;
  };
  const cavalry = (kind: PoseKind, i: number, opts: { rear?: number; gallop?: number; stride?: number } = {}) => {
    let pc = new PixelCanvas(w, h);
    const gallop = opts.gallop !== undefined;
    const hf = opts.gallop ?? 0;
    const bob = gallop ? hf % 2 : 0;
    drawHorse(pc, look.mount!, pal, hf, gallop, ax, ay, bob, { nod: kind === 'idle' && i === 1, stride: opts.stride });
    const rear = opts.rear ?? 0;
    if (rear) pc = shear(pc, ax - 6, rear);
    const rise = Math.round(Math.max(0, ax + 1 - (ax - 6)) * rear);
    const rp = figurePose(kind, i, look, true);
    drawFigure(pc, look, pal, rp, ax + 1 + rp.lean, ay - 9 - bob - rise, { seated: true });
    pc.rect(ax + 1, ay - 9 - bob - rise, 2, 3, look.armor === 'plate' ? pal.metal[4] : pal.leather[2]);
    return pc;
  };
  const siege = (ph: EnginePhase, crew: PoseKind, ci: number, o: { wheel?: number; dx?: number; deployed?: boolean } = {}) => {
    const pc = new PixelCanvas(w, h);
    drawEngine(pc, look, pal, ph, ax + (o.dx ?? 0), ay, o.deployed ?? true, o.wheel ?? 0);
    drawFigure(pc, crewLook, pal, figurePose(crew, ci, crewLook), crewX + (o.dx ?? 0), ay);
    return pc;
  };
  const wolf = (st: BeastState, step = 0) => {
    const pc = new PixelCanvas(w, h);
    drawBeast(pc, st, step, ax, ay);
    return pc;
  };
  const living = (kind: PoseKind, i: number): PixelCanvas => {
    if (engine) {
      switch (kind) {
        case 'walk':
          return siege(0, 'walk', i, { wheel: i });
        case 'atkA':
        case 'atkB':
          return siege((i + 1) as EnginePhase, i === 0 ? 'work' : 'idle', i === 0 ? 1 : 0);
        case 'flinch':
          return siege(0, 'flinch', 0, { dx: -1 });
        case 'cheer':
          return siege(0, 'cheer', i);
        default:
          return siege(0, 'idle', i);
      }
    }
    if (beast) {
      const map: Record<PoseKind, BeastState[]> = {
        idle: ['idle0', 'idle1'],
        walk: ['walk', 'walk', 'walk', 'walk'],
        run: ['run', 'run', 'run', 'run'],
        flee: ['run', 'run', 'run', 'run'],
        atkA: ['lunge0', 'lunge1', 'idle0'],
        atkB: ['leap0', 'leap1', 'lunge0'],
        flinch: ['flinch'],
        block: ['flinch'],
        cheer: ['howl', 'idle1'],
        work: ['idle0'],
        kneel: ['flinch'],
      };
      return wolf(map[kind][i] ?? 'idle0', i);
    }
    if (mounted) {
      switch (kind) {
        case 'walk':
          return cavalry('idle', 0, { gallop: i });
        case 'run':
          return cavalry('run', i, { gallop: i, stride: 1.5 });
        case 'flee':
          return cavalry('flee', i, { gallop: i, stride: 1.5 });
        case 'flinch':
          return cavalry('flinch', 0, { rear: 0.15 });
        case 'cheer':
          return cavalry('cheer', i, { rear: i === 0 ? 0.4 : 0.22 });
        default:
          return cavalry(kind, i);
      }
    }
    return infantry(kind, i);
  };
  const finish = (pc: PixelCanvas) => {
    pc.outline(OUTLINE, 0.75);
    pc.shadow(ax, ay + 0.5, engine ? (tall ? 12 : 10) : mounted ? 9 : beast ? 6 : 4.5, engine ? 3 : mounted ? 2.5 : 1.8, 0.32);
    return pc;
  };
  const put = (i: number, pc: PixelCanvas) => (frames[i] = finish(pc));
  const alias = (i: number, to: number) => (frames[i] = to);

  // ---- living animations
  FR.idle.forEach((f, i) => (engine && i === 1 ? alias(f, FR.idle[0]) : put(f, living('idle', i))));
  FR.walk.forEach((f, i) => put(f, living('walk', i)));
  FR.atkA.forEach((f, i) => put(f, living('atkA', i)));
  FR.atkB.forEach((f, i) => (engine ? alias(f, FR.atkA[i]) : put(f, living('atkB', i))));
  put(FR.flinch, living('flinch', 0));
  if (engine || beast) alias(FR.block, FR.flinch);
  else put(FR.block, living('block', 0));
  FR.cheer.forEach((f, i) => put(f, living('cheer', i)));
  FR.run.forEach((f, i) => (engine ? alias(f, FR.walk[i]) : put(f, living('run', i))));
  FR.flee.forEach((f, i) => (engine || beast ? alias(f, beast ? FR.run[i] : FR.walk[i]) : put(f, living('flee', i))));
  FR.work.forEach((f, i) => (worker ? put(f, living('work', i)) : alias(f, FR.idle[0])));
  // siege deploy (trebuchet packed on its cart)
  if (def.deploy) {
    put(FR.deploy[0], (() => {
      const pc = new PixelCanvas(w, h);
      drawEngine(pc, look, pal, 0, ax, ay, false);
      return pc;
    })());
    put(FR.deploy[1], (() => {
      const pc = new PixelCanvas(w, h);
      drawEngine(pc, look, pal, 0, ax, ay, false);
      drawFigure(pc, crewLook, pal, figurePose('work', 2, crewLook), crewX, ay);
      return pc;
    })());
  } else FR.deploy.forEach((f) => alias(f, FR.idle[0]));

  // ---- deaths
  const base = living('idle', 0);
  if (engine) {
    // A: sags and collapses; B: shatters into planks
    put(FR.dieA[0], squash(base, ay, 0.85, 0, false));
    put(FR.dieA[1], squash(base, ay, 0.6, 0, false));
    put(FR.dieA[2], squash(base, ay, 0.45, 1, true));
    FR.dieB.forEach((f, k) => put(f, wreck(base, ay, k, seed + def.id.length)));
  } else if (mounted) {
    // A: horse buckles where it stands
    put(FR.dieA[0], stagger(base, ay));
    put(FR.dieA[1], squash(base, ay, 0.7, 0, false));
    put(FR.dieA[2], squash(base, ay, 0.45, 1, true));
    // B: stumbles forward and throws its rider
    const horseOnly = new PixelCanvas(w, h);
    drawHorse(horseOnly, look.mount!, pal, 0, false, ax, ay, 0);
    const rider = new PixelCanvas(w, h);
    drawFigure(rider, look, pal, figurePose('flinch', 0, look), ax, ay);
    put(FR.dieB[0], shear(base, ax - 6, -0.25));
    const fall = (dark: boolean) => {
      const pc = squash(horseOnly, ay, 0.55, -1, dark);
      const r = lying(rider, w, h, ax, ay, 'cw', dark);
      stamp(pc, r, 7, 0, false);
      return pc;
    };
    put(FR.dieB[1], fall(false));
    put(FR.dieB[2], fall(true));
  } else if (beast) {
    put(FR.dieA[0], wolf('flinch'));
    put(FR.dieA[1], squash(base, ay, 0.7, 0, false));
    put(FR.dieA[2], squash(base, ay, 0.5, 1, true));
    // B: rolls over, legs up
    put(FR.dieB[0], wolf('leap0'));
    const flipped = (dark: boolean) => {
      const out = new PixelCanvas(w, h);
      const b = bbox(base);
      for (let y = b.minY; y <= b.maxY; y++)
        for (let x = b.minX; x <= b.maxX; x++) {
          const v = base.data[y * w + x];
          if (!v) continue;
          const ny = ay - (y - b.minY) + (dark ? 1 : 0) - 1;
          if (ny >= 0 && ny < h) out.data[ny * w + x] = dark ? darken(v) : v;
        }
      return out;
    };
    put(FR.dieB[1], flipped(false));
    put(FR.dieB[2], flipped(true));
  } else {
    // A: staggers back and falls flat
    put(FR.dieA[0], stagger(base, ay));
    put(FR.dieA[1], lying(base, w, h, ax, ay, 'cw', false));
    put(FR.dieA[2], lying(base, w, h, ax, ay, 'cw', true));
    // B: drops to a knee, weapon falling away, then topples backward
    const dropped = (pc: PixelCanvas, dark: boolean) => {
      if (look.weapon === 'none') return pc;
      const wpn = new PixelCanvas(w, h);
      const lie = weaponClass(look.weapon) === 'ranged' ? -1.57 : 0.08;
      drawWeapon(wpn, look.weapon, ax + 3, ay - 1, { ...BASE_POSE, arm: lie }, pal);
      stamp(pc, wpn, 0, 0, dark);
      return pc;
    };
    put(FR.dieB[0], dropped(infantry('kneel', 0), false));
    put(FR.dieB[1], dropped(lying(base, w, h, ax, ay, 'ccw', false), false));
    put(FR.dieB[2], dropped(lying(base, w, h, ax, ay, 'ccw', true), true));
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

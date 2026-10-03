import type { UnitDef, UnitLook } from '../../data/units';
import type { KingdomColor } from '../../data/factions';
import { PixelCanvas, mix, pack, shade, toPacked } from './PixelCanvas';
import { MIL, OUTLINE, RAMP } from './palette';

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
  /**
   * modern era: muzzle position (px, relative to the feet anchor, facing right) in the firing frame
   * of atkA (FR.atkA[1]) / atkB (FR.atkB[1]) — where the FX layer should spawn muzzle flashes / shells
   */
  muzzleA?: { x: number; y: number };
  muzzleB?: { x: number; y: number };
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
  // ---- modern era (optional, so medieval poses are untouched)
  /** muzzle flash drawn at the gun tip this frame */
  flash?: boolean;
  /** rocket backblast behind the launcher */
  blast?: boolean;
  /** launcher tube fired (no warhead) */
  empty?: boolean;
  /** chainsaw chain phase */
  saw?: number;
  /** hand-held prop: grenade (off hand), thrown grenade, placed / thrown satchel, artillery rounds, carried mortar tube */
  prop?: 'grenade' | 'toss' | 'placed' | 'chargeFly' | 'shell' | 'round' | 'tube';
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
  const modern = isModernArmor(look.armor);
  const hose = modern ? modernHose(look) : peasant ? pal.cloth[1] : heavy ? pal.metal[2] : '#4a3a30';
  const boot = modern ? '#26221e' : pal.leather[1];

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
  const armCol = modern
    ? modernSleeve(look, pal)
    : look.armor === 'plate' ? M0[4] : look.armor === 'mail' ? M0[3] : look.armor === 'gambeson' ? '#c4b48e' : look.armor === 'leather' ? pal.leather[3] : pal.cloth[2];
  if (look.backpack) drawBackpack(p, look, tx, torsoTop);
  // ---- trader's pack on the back
  if (look.sack) {
    p.rect(tx - 3, torsoTop - 1, 4, 5, '#c8b484');
    p.hline(tx - 3, tx, torsoTop - 1, '#e0d0a0');
    p.vline(tx - 3, torsoTop, torsoTop + 3, '#9a8458');
    p.px(tx - 1, torsoTop + 1, '#7a6440');
  }
  // ---- back (off-hand) arm, behind the body: raised in cheers, flailing in a rout
  let bxh = shoulderX;
  let byh = shoulderY;
  if (pose.armB !== null) {
    bxh = shoulderX + Math.round(Math.cos(pose.armB) * 4);
    byh = shoulderY + Math.round(Math.sin(pose.armB) * 4);
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
        case 'fatigues':
        case 'vest':
        case 'jacket':
        case 'ghillie':
          c = modernTorsoPx(look, pal, x, y, tw);
          break;
        default:
          // tunic
          c = right ? pal.cloth[1] : top ? pal.cloth[3] : pal.cloth[2];
      }
      torso(xx, yy, c);
    }
  }
  // belt
  if (modern) modernBelt(p, look, tx, tw, torsoTop);
  else p.hline(tx, tx + tw - 1, torsoTop + 3, pal.leather[0]);
  if (peasant && !modern) {
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
      drawModernHeadgear(p, look, pal, hx, headTop);
      break;
  }
  if (look.armor === 'ghillie') ghillieTufts(p, hx, headTop, tx, tw, torsoTop, legTop);

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
    case 'riot':
      drawRiotShield(p, sx, sy);
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
  if (pose.prop) drawProp(p, pose, handX, handY, bxh, byh, cx, ground, tx, tw, torsoTop);
  // ---- civilian loads
  switch (look.carry) {
    case 'basket':
      p.rect(handX - 1, handY + 1, 4, 3, '#b08a4a');
      p.hline(handX - 1, handX + 2, handY + 1, '#d0a860');
      p.px(handX, handY + 2, '#8a6a34');
      p.px(handX + 2, handY + 3, '#8a6a34');
      p.px(handX, handY, '#c83a3a'); // apples
      p.px(handX + 1, handY, '#e0c040');
      break;
    case 'bucket':
      p.px(handX, handY + 1, '#5a5a62');
      p.rect(handX - 1, handY + 2, 3, 3, '#7a6a5a');
      p.hline(handX - 1, handX + 1, handY + 2, '#9ab8d8');
      p.px(handX + 1, handY + 4, '#5a4a3a');
      break;
    case 'firewood':
      // bundle across the shoulders
      for (let k = 0; k < 3; k++) {
        p.hline(tx - 2, tx + tw + 1, torsoTop - 1 + k, k === 1 ? RAMP.wood[2] : RAMP.wood[3]);
        p.px(tx + tw + 1, torsoTop - 1 + k, RAMP.wood[5]);
      }
      break;
    case 'flowers':
      p.px(handX, handY - 1, RAMP.grass[3]);
      p.px(handX + 1, handY - 2, '#e07890');
      p.px(handX - 1, handY - 2, '#f0d860');
      p.px(handX, handY - 3, '#f4f0e8');
      break;
  }
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
      drawModernWeapon(p, w, hx, hy, pose, pal);
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
      drawModernEngine(p, look, pal, ph, cx, fy, deployed ? 1 : 0, wheelTurn);
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

type WeaponClass = 'ranged' | 'crossbow' | 'polearm' | 'lance' | 'great' | 'chop' | 'sword' | 'none' | 'gun' | 'launcher' | 'charge' | 'saw';

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
    case 'rifle':
    case 'smg':
    case 'mg':
    case 'sniper':
    case 'shotgun':
    case 'pistol':
    case 'grenadier':
      return 'gun';
    case 'rocket':
      return 'launcher';
    case 'satchel':
      return 'charge';
    case 'chainsaw':
      return 'saw';
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
  if (wc === 'gun' || wc === 'launcher' || wc === 'charge' || wc === 'saw') return modernPose(kind, i, look, wc);
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
  const vehicle = look.body === 'vehicle';
  const howitzer = look.engine === 'howitzer';
  const modernEngine = engine && isModernEngine(look.engine);
  const w = vehicle ? VEH_W : engine ? (tall || howitzer ? 40 : 30) : mounted ? 30 : 22;
  const h = vehicle ? VEH_H : engine ? (tall ? 44 : howitzer ? 30 : 26) : mounted ? 30 : 22;
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
  // ---- modern crewed guns: the crew poses are tailored per weapon
  const mSiege = (kind: PoseKind | 'deploy', i: number, o: { dx?: number } = {}) => {
    const pc = new PixelCanvas(w, h);
    const moving = kind === 'walk';
    const ph = (kind === 'atkA' || kind === 'atkB' ? i + 1 : 0) as EnginePhase;
    const spread = kind === 'deploy' ? (i === 0 ? 0 : 0.5) : moving ? 0 : 1;
    const dx = o.dx ?? 0;
    if (!(look.engine === 'mortar' && moving)) drawModernEngine(pc, look, pal, ph, ax + dx, ay, spread, moving ? i : 0);
    const c = modernCrewPose(look.engine!, kind, i);
    if (c) drawFigure(pc, MODERN_CREW, pal, c.pose, ax + dx + c.x, ay);
    return pc;
  };
  const living = (kind: PoseKind, i: number): PixelCanvas => {
    if (vehicle) return vehicleFrame(look, pal, kind, i, w, h, ax, ay);
    if (engine && modernEngine) return kind === 'flinch' ? mSiege(kind, i, { dx: -1 }) : mSiege(kind, i);
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
    if (vehicle) pc.shadow(ax, ay + 0.5, 14, 3, 0.32);
    else pc.shadow(ax, ay + 0.5, engine ? (tall ? 12 : howitzer ? 13 : 10) : mounted ? 9 : beast ? 6 : 4.5, engine ? 3 : mounted ? 2.5 : 1.8, 0.32);
    return pc;
  };
  const put = (i: number, pc: PixelCanvas) => (frames[i] = finish(pc));
  const alias = (i: number, to: number) => (frames[i] = to);

  // ---- living animations
  let muzzleA: { x: number; y: number } | undefined;
  let muzzleB: { x: number; y: number } | undefined;
  const unarmed = vehicle && look.vehicle === 'truck';
  FR.idle.forEach((f, i) => (engine && i === 1 ? alias(f, FR.idle[0]) : put(f, living('idle', i))));
  FR.walk.forEach((f, i) => put(f, living('walk', i)));
  FR.atkA.forEach((f, i) => {
    if (unarmed) return alias(f, FR.idle[0]);
    resetMuzzle();
    put(f, living('atkA', i));
    const m = lastMuzzle();
    if (i === 1 && m) muzzleA = { x: m.x - ax, y: m.y - ay };
  });
  FR.atkB.forEach((f, i) => {
    if (engine || vehicle) return alias(f, unarmed ? FR.idle[0] : FR.atkA[i]);
    resetMuzzle();
    put(f, living('atkB', i));
    const m = lastMuzzle();
    if (i === 1 && m) muzzleB = { x: m.x - ax, y: m.y - ay };
  });
  if (engine || vehicle) muzzleB = muzzleA;
  put(FR.flinch, living('flinch', 0));
  if (engine || beast || vehicle) alias(FR.block, FR.flinch);
  else put(FR.block, living('block', 0));
  FR.cheer.forEach((f, i) => put(f, living('cheer', i)));
  FR.run.forEach((f, i) => (engine || vehicle ? alias(f, FR.walk[i]) : put(f, living('run', i))));
  FR.flee.forEach((f, i) => (engine || beast || vehicle ? alias(f, beast ? FR.run[i] : FR.walk[i]) : put(f, living('flee', i))));
  FR.work.forEach((f, i) => (worker && !vehicle ? put(f, living('work', i)) : alias(f, FR.idle[0])));
  // modern towed guns: limbered for travel / trails being spread
  if (modernEngine && (def.deploy || howitzer)) {
    put(FR.deploy[0], mSiege('deploy', 0));
    put(FR.deploy[1], mSiege('deploy', 1));
  } else if (def.deploy) {
    // siege deploy (trebuchet packed on its cart)
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
  if (vehicle) {
    vehicleDeaths(look, pal, w, h, ax, ay, seed + def.id.length).forEach((pc, k) => put(k < 3 ? FR.dieA[k] : FR.dieB[k - 3], pc));
  } else if (modernEngine) {
    // A: knocked over and burnt out; B: blown apart
    const sd = seed + def.id.length;
    put(FR.dieA[0], burn(squash(base, ay, 0.85, 0, false), 0.35, sd));
    put(FR.dieA[1], burn(squash(base, ay, 0.6, 0, false), 0.6, sd));
    put(FR.dieA[2], burn(squash(base, ay, 0.45, 1, false), 0.85, sd));
    FR.dieB.forEach((f, k) => put(f, burn(wreck(base, ay, k, sd), 0.45 + k * 0.2, sd + k)));
  } else if (engine) {
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
  return { w, h, ax, ay, frames, muzzleA, muzzleB };
}

function darken(v: number): number {
  const r = (v & 255) * 0.75;
  const g = ((v >>> 8) & 255) * 0.75;
  const b = ((v >>> 16) & 255) * 0.8;
  return (((v >>> 24) & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export { mix };

// =============================================================================================
// MODERN ERA (fictional 1970s–80s military): fatigues, firearms, crewed guns and vehicles.
// Everything below is only reached by modern looks, so medieval sheets stay pixel-identical.
// Team colour is limited to armbands, helmet bands, berets/bandanas, vehicle markings and flags.

let muzzleOut: { x: number; y: number } | null = null;
function resetMuzzle() {
  muzzleOut = null;
}
function lastMuzzle(): { x: number; y: number } | null {
  return muzzleOut;
}
function setMuzzle(x: number, y: number) {
  muzzleOut = { x: Math.round(x), y: Math.round(y) };
}

const GUN = '#24242a';
const GUN2 = '#3a3b43';
const GUN3 = '#5c5e68';
const STOCK = ['#4a2c1a', '#6a4024', '#8a5a34'];
const FLASH = ['#ffffff', '#fff2a8', '#ffc440', '#f08a28'];
const GHILLIE = ['#33401e', '#4a5a26', '#5e6c30', '#6e6436', '#7e8a44'];
const SMOKE = RAMP.smoke;

function hash2i(x: number, y: number, s = 0): number {
  const r = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return r - Math.floor(r);
}

function isModernArmor(a: UnitLook['armor']): boolean {
  return a === 'fatigues' || a === 'vest' || a === 'jacket' || a === 'ghillie';
}
function isModernEngine(e: UnitLook['engine']): boolean {
  return e === 'mortar' || e === 'atgun' || e === 'howitzer';
}

/** woodland camo index for a torso pixel: 0 base, 1 dark green, 2 brown (fixed to the body, so it doesn't crawl) */
function camoIdx(x: number, y: number): number {
  const k = (x * 3 + y * 2 + (((x + 1) * (y + 2)) % 4)) % 6;
  return k === 0 || k === 3 ? 1 : k === 1 ? 2 : 0;
}

function modernHose(look: UnitLook): string {
  return look.armor === 'jacket' ? MIL.denim[2] : look.armor === 'ghillie' ? '#4a5428' : MIL.olive[2];
}

function modernSleeve(look: UnitLook, pal: Palette): string {
  switch (look.armor) {
    case 'jacket':
      return pal.cloth[2];
    case 'ghillie':
      return '#56602e';
    default:
      return MIL.olive[3];
  }
}

function modernTorsoPx(look: UnitLook, pal: Palette, x: number, y: number, tw: number): string {
  const right = x === tw - 1;
  const top = y === 0;
  const T = pal.team;
  if (x === 0 && y === 1) return T.main; // armband
  switch (look.armor) {
    case 'fatigues': {
      const base = [MIL.olive[3], MIL.olive[1], MIL.drab[2]][camoIdx(x, y)];
      const c = top ? shade(base, 0.12) : base;
      return right ? shade(c, -0.22) : c;
    }
    case 'vest': {
      const V = MIL.drab;
      if (top) return x === tw - 2 ? MIL.olive[2] : MIL.olive[4]; // shirt collar / shoulders
      if (right) return V[1];
      if (y === 2) return x % 2 ? V[4] : V[3]; // chest pouches
      return x === 0 ? V[2] : V[3];
    }
    case 'jacket': {
      const C = pal.cloth;
      if (x === tw - 2 && y <= 1) return '#d8d0c0'; // shirt at the open collar
      return right ? C[1] : top ? C[3] : C[2];
    }
    default: {
      // ghillie suit: shaggy noise of greens and browns
      return GHILLIE[Math.floor(hash2i(x, y, 3) * GHILLIE.length)];
    }
  }
}

function modernBelt(p: PixelCanvas, look: UnitLook, tx: number, tw: number, torsoTop: number) {
  const y = torsoTop + 3;
  switch (look.armor) {
    case 'vest':
      for (let x = 0; x < tw; x++) p.px(tx + x, y, x === tw - 1 ? MIL.drab[1] : x % 2 ? MIL.drab[1] : MIL.drab[4]);
      break;
    case 'fatigues':
      p.hline(tx, tx + tw - 1, y, MIL.olive[0]);
      p.px(tx + tw - 2, y, MIL.olive[4]);
      break;
    case 'jacket':
      p.hline(tx, tx + tw - 1, y, '#2a2224');
      break;
    default:
      p.px(tx, y, GHILLIE[1]);
      p.px(tx + 2, y, GHILLIE[3]);
  }
}

function drawBackpack(p: PixelCanvas, look: UnitLook, tx: number, torsoTop: number) {
  const B = MIL.olive;
  p.rect(tx - 2, torsoTop, 3, 5, B[2]);
  p.vline(tx - 2, torsoTop, torsoTop + 4, B[1]);
  p.hline(tx - 2, tx, torsoTop, B[3]);
  if (look.weapon === 'rocket') {
    // spare rockets poking out of the pack
    p.vline(tx - 2, torsoTop - 3, torsoTop - 1, B[3]);
    p.px(tx - 2, torsoTop - 4, B[0]);
    p.vline(tx - 1, torsoTop - 2, torsoTop - 1, B[3]);
    p.px(tx - 1, torsoTop - 3, B[0]);
  } else {
    // field radio with a whip antenna
    p.px(tx - 1, torsoTop + 1, GUN);
    p.px(tx - 2, torsoTop + 2, '#8a8a70');
    p.line(tx - 2, torsoTop - 1, tx - 4, torsoTop - 8, '#34363c');
    p.px(tx - 4, torsoTop - 8, '#5a5c64');
  }
}

function drawModernHeadgear(p: PixelCanvas, look: UnitLook, pal: Palette, hx: number, ht: number) {
  const T = pal.team;
  const O = MIL.olive;
  switch (look.helmet) {
    case 'combat':
      // steel pot with a team band
      p.hline(hx - 1, hx + 2, ht - 2, O[4]);
      p.hline(hx - 2, hx + 3, ht - 1, O[3]);
      p.hline(hx - 2, hx + 3, ht, O[2]);
      p.px(hx - 2, ht + 1, O[2]);
      p.px(hx, ht - 2, O[5]);
      p.hline(hx - 1, hx + 1, ht - 1, T.main);
      break;
    case 'patrol':
      p.rect(hx - 1, ht - 2, 4, 2, O[3]);
      p.hline(hx - 1, hx + 2, ht - 2, O[4]);
      p.px(hx - 1, ht - 2, O[2]);
      p.hline(hx + 2, hx + 3, ht, O[1]); // bill
      p.px(hx + 1, ht - 1, T.main); // badge
      p.px(hx, ht - 1, T.dark);
      break;
    case 'boonie':
      p.rect(hx - 1, ht - 2, 4, 2, MIL.drab[3]);
      p.px(hx, ht - 2, MIL.drab[4]);
      p.hline(hx - 1, hx + 2, ht - 1, T.main); // hat band
      p.hline(hx - 3, hx + 4, ht, MIL.olive[2]); // floppy brim
      p.px(hx - 3, ht + 1, MIL.olive[2]);
      p.px(hx + 4, ht + 1, MIL.olive[1]);
      break;
    case 'beret':
      p.hline(hx - 1, hx + 1, ht - 2, T.main);
      p.hline(hx - 2, hx + 2, ht - 1, T.main);
      p.px(hx - 1, ht - 2, T.light);
      p.px(hx - 2, ht - 1, T.dark);
      p.px(hx - 2, ht, T.dark);
      p.px(hx + 2, ht - 1, RAMP.goldm[4]); // cap badge
      break;
    case 'officer':
      p.hline(hx - 2, hx + 3, ht - 3, O[4]);
      p.hline(hx - 1, hx + 3, ht - 2, O[3]);
      p.hline(hx - 1, hx + 2, ht - 1, T.main); // band
      p.px(hx + 2, ht - 2, RAMP.goldm[4]); // badge
      p.hline(hx + 2, hx + 4, ht, '#1e1a1c'); // visor
      break;
    case 'hardhat': {
      const Y = ['#a87818', '#d8a428', '#f0c848', '#fae08a'];
      p.hline(hx - 1, hx + 2, ht - 2, Y[2]);
      p.hline(hx - 2, hx + 3, ht - 1, Y[1]);
      p.hline(hx - 2, hx + 4, ht, Y[0]);
      p.px(hx, ht - 2, Y[3]);
      p.px(hx + 1, ht - 2, T.main); // team sticker
      p.px(hx + 1, ht - 1, T.dark);
      break;
    }
    case 'bandana':
      p.hline(hx - 1, hx + 2, ht - 1, T.main);
      p.hline(hx - 1, hx + 2, ht, T.main);
      p.px(hx, ht - 1, T.light);
      p.px(hx - 2, ht, T.dark); // knot and tails
      p.px(hx - 3, ht + 1, T.main);
      p.px(hx - 2, ht + 1, T.dark);
      break;
    default:
      break;
  }
}

function ghillieTufts(p: PixelCanvas, hx: number, ht: number, tx: number, tw: number, torsoTop: number, legTop: number) {
  const pts: [number, number][] = [
    [hx - 2, ht - 1],
    [hx - 1, ht - 3],
    [hx + 2, ht - 3],
    [hx - 3, ht + 2],
    [tx - 1, torsoTop],
    [tx - 1, torsoTop + 2],
    [tx - 2, torsoTop + 1],
    [tx + tw, torsoTop + 3],
    [tx - 1, legTop + 1],
    [tx + 1, legTop + 1],
  ];
  pts.forEach(([x, y], k) => p.px(x, y, GHILLIE[(k * 3) % GHILLIE.length]));
}

/** clear ballistic shield: tinted see-through face, opaque rim */
function drawRiotShield(p: PixelCanvas, sx: number, sy: number) {
  const top = sy - 4;
  const bot = sy + 6;
  for (let y = top; y <= bot; y++) for (let x = sx; x <= sx + 2; x++) p.blend(x, y, '#cfe6f2', 0.42);
  p.vline(sx + 2, top, bot, '#5a6a78');
  p.vline(sx, top + 1, bot - 1, '#9fb4c2');
  p.hline(sx, sx + 2, top, '#8a9aa8');
  p.hline(sx, sx + 2, bot, '#4a5560');
  p.px(sx + 1, top + 2, '#ffffff');
  p.px(sx + 1, top + 3, '#e8f6ff');
}

function drawProp(p: PixelCanvas, pose: Pose, hx: number, hy: number, bxh: number, byh: number, cx: number, ground: number, tx: number, tw: number, torsoTop: number) {
  const O = MIL.olive;
  switch (pose.prop) {
    case 'grenade':
      p.px(bxh, byh - 1, '#7a8a48');
      p.px(bxh + 1, byh - 1, '#2a3420');
      break;
    case 'toss':
      p.px(bxh + 3, byh - 3, '#7a8a48');
      p.px(bxh + 4, byh - 3, '#2a3420');
      p.px(bxh + 3, byh - 4, '#a0a098');
      break;
    case 'placed':
      p.rect(cx + 4, ground - 2, 3, 2, O[2]);
      p.hline(cx + 4, cx + 6, ground - 2, O[4]);
      p.px(cx + 6, ground - 2, '#e03020');
      break;
    case 'chargeFly':
      p.rect(hx + 2, hy - 4, 3, 2, O[2]);
      p.hline(hx + 2, hx + 4, hy - 4, O[4]);
      p.px(hx + 4, hy - 3, '#e03020');
      break;
    case 'shell':
      // mortar bomb held up to the muzzle
      p.px(hx, hy - 1, O[1]);
      p.px(hx, hy - 2, O[2]);
      p.px(hx + 1, hy - 2, O[1]);
      p.px(hx, hy - 3, O[3]);
      break;
    case 'round':
      // brass-cased shell carried to the breech
      p.hline(hx + 1, hx + 3, hy, MIL.brass[1]);
      p.hline(hx + 1, hx + 3, hy - 1, MIL.brass[3]);
      p.px(hx + 4, hy, GUN3);
      p.px(hx + 4, hy - 1, GUN3);
      break;
    case 'tube':
      // mortar tube over the shoulder, baseplate slung on the back
      p.rect(tx - 2, torsoTop + 1, 2, 4, MIL.steel[3]);
      p.px(tx - 2, torsoTop + 1, MIL.steel[2]);
      p.line(tx - 2, torsoTop + 1, tx + tw + 4, torsoTop - 3, O[2]);
      p.line(tx - 2, torsoTop, tx + tw + 4, torsoTop - 4, O[4]);
      break;
    default:
      break;
  }
}

function drawModernWeapon(p: PixelCanvas, w: UnitLook['weapon'], hx: number, hy: number, pose: Pose, pal: Palette) {
  const dx = Math.cos(pose.arm);
  const dy = Math.sin(pose.arm);
  // n > 0 is "below" the gun line, n < 0 above
  const at = (k: number, n = 0): [number, number] => [hx + dx * k - dy * n, hy + dy * k + dx * n];
  const P = (k: number, n: number, c: string) => {
    const [x, y] = at(k, n);
    p.px(x, y, c);
  };
  const seg = (a: number, b: number, c: string, n = 0) => {
    const [x0, y0] = at(a, n);
    const [x1, y1] = at(b, n);
    p.line(x0, y0, x1, y1, c);
  };
  const flash = (k: number, n = 0, big = false) => {
    if (!pose.flash) return;
    const [mx, my] = at(k + 1, n);
    setMuzzle(mx, my);
    P(k + 1, n, FLASH[0]);
    P(k + 2, n, FLASH[1]);
    P(k + 1, n - 1, FLASH[2]);
    P(k + 1, n + 1, FLASH[2]);
    if (big) {
      P(k + 3, n, FLASH[2]);
      P(k + 2, n - 1, FLASH[3]);
      P(k + 2, n + 1, FLASH[3]);
    }
  };
  const O = MIL.olive;
  switch (w) {
    case 'rifle':
    case 'grenadier':
      seg(-3, -1, STOCK[1]);
      seg(0, 2, GUN);
      seg(3, 6, GUN2);
      P(1, 1, GUN);
      P(2, 1, GUN2);
      if (w === 'grenadier') {
        seg(2, 4, '#4a4e3a', 1);
        P(4, 1, '#2e3024');
      }
      flash(6);
      break;
    case 'smg':
      seg(-2, -1, GUN2);
      seg(0, 3, GUN);
      P(1, 1, GUN2);
      P(1, 2, GUN2);
      flash(3);
      break;
    case 'mg':
      seg(-3, -1, GUN2);
      seg(0, 3, GUN);
      seg(0, 3, GUN2, -1);
      seg(4, 8, GUN3);
      P(6, 1, GUN2); // bipod
      P(0, 1, MIL.brass[2]); // ammo belt
      P(-1, 2, MIL.brass[3]);
      flash(8, 0, true);
      break;
    case 'sniper':
      seg(-3, -1, '#4a4e36');
      seg(0, 2, GUN);
      seg(3, 9, GUN2);
      seg(0, 2, GUN, -1); // scope
      P(2, -1, '#8ac8e0');
      flash(9);
      break;
    case 'shotgun':
      seg(-3, -1, STOCK[2]);
      seg(0, 1, GUN);
      seg(2, 6, GUN3);
      P(3, 1, STOCK[1]);
      P(4, 1, STOCK[1]);
      flash(6, 0, true);
      break;
    case 'pistol':
      seg(0, 2, GUN2);
      P(0, 1, GUN);
      flash(2);
      break;
    case 'rocket': {
      // tube resting on the shoulder (rows n = -1 / -2 above the hand)
      seg(-5, 4, O[2], -1);
      seg(-5, 4, O[4], -2);
      P(-5, -1, O[1]);
      P(-5, -2, O[1]);
      P(4, -1, O[1]);
      P(4, -2, O[3]);
      P(0, 0, GUN); // grip
      P(1, -3, GUN); // sight
      if (!pose.empty) {
        P(5, -1, O[1]);
        P(5, -2, O[2]);
        P(6, -1, O[0]);
        P(6, -2, O[1]);
        P(7, -1, '#2a2e1e');
      }
      if (pose.flash) {
        const [mx, my] = at(5, -1.5);
        setMuzzle(mx, my);
        P(5, -1, FLASH[0]);
        P(5, -2, FLASH[1]);
        P(6, -1, FLASH[2]);
      }
      if (pose.blast) {
        // backblast plume
        P(-6, -1, FLASH[0]);
        P(-6, -2, FLASH[1]);
        P(-7, -1, FLASH[2]);
        P(-7, -2, FLASH[3]);
        P(-7, 0, FLASH[3]);
        P(-8, -1, SMOKE[4]);
        P(-8, -2, SMOKE[3]);
        P(-8, -3, SMOKE[4]);
        P(-9, -1, SMOKE[3]);
        P(-9, -2, SMOKE[4]);
        P(-9, 0, SMOKE[3]);
        P(-10, -2, SMOKE[2]);
      }
      break;
    }
    case 'satchel':
      p.px(hx, hy + 1, '#3a3a2a');
      p.rect(hx - 1, hy + 2, 4, 3, O[2]);
      p.hline(hx - 1, hx + 2, hy + 2, O[4]);
      p.px(hx + 2, hy + 3, '#e03020');
      break;
    case 'chainsaw': {
      const ph = pose.saw ?? 0;
      p.rect(hx - 1, hy - 1, 3, 3, '#d8641c');
      p.px(hx - 1, hy - 1, '#f08a3a');
      p.px(hx + 1, hy + 1, '#8a3a12');
      p.px(hx, hy - 2, GUN);
      seg(2, 8, pal.metal[4]);
      for (let k = 2; k <= 8; k++) if ((k + ph) % 2 === 0) P(k, 0, pal.metal[1]);
      P(8, 0, pal.metal[5]);
      if (ph === 1 && pose.crouch > 0) {
        // sawdust
        P(8, 2, RAMP.wood[6]);
        P(9, 3, RAMP.wood[5]);
        P(7, 3, RAMP.wood[6]);
      }
      break;
    }
    default:
      break;
  }
}

/** poses for modern weapon classes (firearms, launchers, charges, chainsaws) */
function modernPose(kind: PoseKind, i: number, look: UnitLook, wc: WeaponClass): Pose {
  const p: Pose = { ...BASE_POSE };
  const w = look.weapon;
  const rest = w === 'pistol' ? 1.1 : w === 'mg' ? 0.25 : wc === 'launcher' ? -0.2 : wc === 'charge' ? 1.0 : wc === 'saw' ? 0.6 : 0.45;
  p.arm = rest;
  const set = (o: Partial<Pose>) => Object.assign(p, o);
  const aim = { legF: 2, legB: -2 };
  const kn = { kneel: true, crouch: 2, legF: 2, legB: -1 };
  switch (kind) {
    case 'idle':
      if (i === 1) p.arm += wc === 'launcher' ? 0 : 0.12;
      if (i === 1 && wc === 'launcher') p.bob = 0;
      break;
    case 'walk':
      set(WALK[i]);
      break;
    case 'run':
      set(RUN[i]);
      p.arm = wc === 'gun' ? (w === 'pistol' ? 0.9 : 0.15) : wc === 'launcher' ? -0.3 : rest;
      if (look.shield !== 'none') p.shieldPush = 1;
      break;
    case 'flee':
      set(RUN[i]);
      set({ noWeapon: true, arm: -2.1 + (i % 2) * 0.7, armB: -2.5 + ((i + 1) % 2) * 0.7, shieldUp: 0 });
      break;
    case 'flinch':
      set({ lean: -1, arm: rest - 0.5, crouch: 1, legF: 0, legB: -2, shieldUp: 0.4, reach: -1 });
      break;
    case 'block':
      if (look.shield !== 'none') set({ shieldUp: 1, shieldPush: 1, crouch: 1, ...STANCE, arm: rest - 0.2 });
      else set({ ...kn, arm: wc === 'gun' || wc === 'launcher' ? 0.3 : rest, lean: -1 }); // hunker down
      break;
    case 'cheer':
      set(i === 0 ? { arm: -1.45, armB: -2.0, jump: 1 } : { arm: -1.25, armB: -1.85 });
      if (wc === 'charge') p.noWeapon = true;
      break;
    case 'kneel':
      set({ kneel: true, crouch: 2, noWeapon: true, arm: 0.9, lean: 1, legF: 2, legB: -1 });
      break;
    case 'work':
      if (wc === 'saw') set([{ arm: 0.5, crouch: 1, saw: 0 }, { arm: 0.6, crouch: 1, saw: 1, lean: 1 }, { arm: 0.75, crouch: 2, saw: 0, lean: 1, ...STANCE }, { arm: 0.6, crouch: 2, saw: 1, ...STANCE }][i]);
      else set([{ crouch: 1, arm: 0.6 }, { crouch: 2, arm: 0.9 }, { crouch: 2, arm: 0.7 }, { crouch: 1, arm: 0.4 }][i]);
      break;
    case 'atkA':
    case 'atkB': {
      const b = kind === 'atkB';
      let seq: Partial<Pose>[];
      switch (w) {
        case 'rifle':
        case 'sniper':
          seq = b
            ? [{ ...kn, arm: 0 }, { ...kn, arm: -0.05, reach: -1, flash: true }, { ...kn, arm: 0 }] // kneeling shot
            : [{ ...aim, arm: 0 }, { ...aim, arm: -0.05, reach: -1, lean: -1, flash: true }, { ...aim, arm: 0 }];
          break;
        case 'grenadier':
          seq = b
            ? [{ arm: 0.6, armB: -2.6, lean: -1, prop: 'grenade' }, { ...aim, arm: 0.6, armB: -0.9, lean: 1, prop: 'toss' }, { ...aim, arm: 0.5, armB: -0.3 }] // overhand lob
            : [{ ...aim, arm: 0 }, { ...aim, arm: -0.05, reach: -1, lean: -1, flash: true }, { ...aim, arm: 0 }];
          break;
        case 'mg':
          seq = b
            ? [{ ...kn, arm: 0 }, { ...kn, arm: -0.03, reach: -1, flash: true }, { ...kn, arm: 0.03, flash: true }] // kneeling burst
            : [{ ...aim, crouch: 1, arm: 0.1 }, { ...aim, crouch: 1, arm: 0.05, reach: -1, flash: true }, { ...aim, crouch: 1, arm: 0.12, flash: true }]; // hip burst
          break;
        case 'smg':
          seq = b
            ? [{ ...aim, crouch: 1, arm: 0.3 }, { ...aim, crouch: 1, arm: 0.25, reach: -1, flash: true }, { ...aim, crouch: 1, arm: 0.33, flash: true }] // hip-fire spray
            : [{ ...aim, arm: 0 }, { ...aim, arm: -0.05, reach: -1, flash: true }, { ...aim, arm: 0.02, flash: true }]; // shouldered burst
          break;
        case 'shotgun':
          seq = b
            ? [{ ...aim, crouch: 1, arm: 0.35 }, { ...aim, crouch: 1, arm: 0.2, reach: -1, lean: -1, flash: true }, { ...aim, crouch: 1, arm: 0.4 }]
            : [{ ...aim, arm: 0 }, { ...aim, arm: -0.2, reach: -1, lean: -1, flash: true }, { ...aim, arm: 0.05, reach: -1 }]; // kick, then pump
          break;
        case 'pistol':
          seq = b
            ? [{ ...aim, crouch: 1, lean: 1, arm: -0.05, reach: 1 }, { ...aim, crouch: 1, arm: -0.3, flash: true }, { ...aim, crouch: 1, arm: 0, reach: 1 }]
            : [{ ...aim, arm: 0, reach: 1 }, { ...aim, arm: -0.25, flash: true }, { ...aim, arm: -0.05, reach: 1 }];
          break;
        case 'rocket':
          seq = b
            ? [{ ...kn, arm: -0.08 }, { ...kn, arm: -0.12, reach: -1, flash: true, blast: true, empty: true }, { ...kn, arm: -0.08, empty: true }]
            : [{ ...aim, arm: -0.08 }, { ...aim, arm: -0.12, reach: -1, lean: -1, flash: true, blast: true, empty: true }, { ...aim, arm: -0.08, empty: true }];
          break;
        case 'satchel':
          seq = b
            ? [{ ...aim, arm: -2.5, lean: -1 }, { ...aim, arm: -0.6, lean: 1, noWeapon: true, prop: 'chargeFly' }, { ...aim, arm: 0.4, noWeapon: true }] // throw
            : [{ ...kn, arm: 0.9, lean: 1 }, { ...kn, arm: 1.2, lean: 1, noWeapon: true, prop: 'placed' }, { ...aim, crouch: 1, arm: 0.6, lean: -1, noWeapon: true, prop: 'placed' }]; // place charge
          break;
        default:
          // chainsaw
          seq = b
            ? [{ arm: 0.8, lean: -1, crouch: 1, saw: 1 }, { ...aim, arm: -0.3, reach: 2, lean: 1, saw: 0 }, { arm: 0, saw: 1 }]
            : [{ arm: -0.5, lean: -1, saw: 0 }, { ...aim, arm: 0.3, reach: 2, lean: 1, crouch: 1, saw: 1 }, { arm: 0.5, crouch: 1, saw: 0 }];
      }
      set(seq[i]);
      break;
    }
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// modern crewed guns
const MODERN_CREW: UnitLook = { body: 'soldier', helmet: 'combat', armor: 'fatigues', weapon: 'none', shield: 'none' };

function crewRestX(e: NonNullable<UnitLook['engine']>): number {
  return e === 'mortar' ? -5 : e === 'atgun' ? -7 : -11;
}

function modernCrewPose(e: NonNullable<UnitLook['engine']>, kind: PoseKind | 'deploy', i: number): { x: number; pose: Pose } | null {
  const P = (o: Partial<Pose>): Pose => ({ ...BASE_POSE, noWeapon: true, ...o });
  const kn = { kneel: true, crouch: 2, legF: 2, legB: -1 };
  const rx = crewRestX(e);
  switch (kind) {
    case 'walk':
      if (e === 'mortar') return { x: 0, pose: P({ ...WALK[i], arm: -1.2, prop: 'tube' }) };
      if (e === 'atgun') return { x: -12, pose: P({ ...WALK[i], arm: 0, lean: 1 }) };
      return { x: -18, pose: P({ ...WALK[i], arm: 0.3, lean: 1 }) };
    case 'flinch':
      return { x: rx, pose: P({ lean: -1, arm: 0.4, crouch: 1, legF: 0, legB: -2 }) };
    case 'cheer':
      return { x: rx, pose: P(i === 0 ? { arm: -1.57, armB: -2.0, jump: 1 } : { arm: -1.35, armB: -1.85 }) };
    case 'deploy':
      if (e === 'howitzer') return { x: i === 0 ? -18 : -15, pose: i === 0 ? P({ arm: 0.3 }) : P({ arm: 1.0, lean: 1, crouch: 1, ...STANCE }) };
      return { x: rx, pose: P({ arm: 0.6 }) };
    case 'atkA':
    case 'atkB':
      switch (e) {
        case 'mortar':
          return [
            { x: -3, pose: P({ arm: -1.2, reach: 2, prop: 'shell' }) }, // round up to the muzzle
            { x: -5, pose: P({ ...kn, arm: -2.3, armB: -2.0, lean: -1 }) }, // duck, ears covered
            { x: -6, pose: P({ crouch: 1, arm: 1.1, lean: -1 }) }, // reach for the next round
          ][i];
        case 'atgun':
          return [
            { x: -7, pose: P({ crouch: 1, arm: -0.2, reach: 1 }) },
            { x: -8, pose: P({ crouch: 1, arm: -0.5, lean: -1 }) },
            { x: -7, pose: P({ crouch: 1, arm: 0, reach: 1, prop: 'round' }) },
          ][i];
        default:
          return [
            { x: -11, pose: P({ arm: -0.2, reach: 1, prop: 'round' }) },
            { x: -13, pose: P({ crouch: 1, arm: -2.3, armB: -2.0, lean: -1 }) },
            { x: -11, pose: P({ arm: 0.1, reach: 2, lean: 1, ...STANCE }) },
          ][i];
      }
    default:
      if (e === 'mortar') return { x: rx, pose: P({ ...kn, arm: 0.6 }) };
      if (e === 'atgun') return { x: rx, pose: P({ crouch: 1, arm: 0.1 }) };
      return { x: rx, pose: P({ arm: 0.6 }) };
  }
}

function modernWheel(p: PixelCanvas, x: number, y: number, r: number, turn: number, hub = MIL.olive[3]) {
  const Rb = MIL.rubber;
  p.ellipse(x + 0.5, y + 0.5, r + 0.5, r + 0.5, Rb[1]);
  p.ellipse(x + 0.5, y + 0.5, Math.max(1.1, r - 0.7), Math.max(1.1, r - 0.7), hub);
  p.px(x, y, shade(hub, -0.35));
  const a = turn * (Math.PI / 4) + 0.4;
  const rr = r;
  p.px(x + Math.round(Math.cos(a) * rr), y + Math.round(Math.sin(a) * rr), Rb[3]);
  p.px(x - Math.round(Math.cos(a) * rr), y - Math.round(Math.sin(a) * rr), Rb[3]);
  p.px(x + Math.round(Math.cos(a + Math.PI / 2) * (rr - 1)), y + Math.round(Math.sin(a + Math.PI / 2) * (rr - 1)), shade(hub, 0.3));
}

/** spread: 0 limbered / travelling, 0.5 trails opening, 1 emplaced */
function drawModernEngine(p: PixelCanvas, look: UnitLook, pal: Palette, ph: EnginePhase, cx: number, fy: number, spread: number, wheelTurn: number) {
  const O = MIL.olive;
  const S = MIL.steel;
  const T = pal.team;
  switch (look.engine) {
    case 'mortar': {
      const j = ph === 2 ? 1 : 0;
      // ammo crate
      p.rect(cx - 13, fy - 3, 4, 3, O[2]);
      p.hline(cx - 13, cx - 10, fy - 3, O[4]);
      p.px(cx - 12, fy - 4, O[1]);
      p.px(cx - 11, fy - 4, O[0]);
      p.px(cx - 12, fy - 2, T.main);
      // baseplate, bipod, tube
      p.hline(cx - 2, cx + 2, fy - 1, S[2]);
      p.hline(cx - 1, cx + 1, fy - 2, S[3]);
      p.line(cx + 3, fy - 6 + j, cx + 5, fy - 1, S[2]);
      p.line(cx + 3, fy - 6 + j, cx + 2, fy - 1, S[1]);
      p.line(cx - 1, fy - 3 + j, cx + 3, fy - 11 + j, O[2]);
      p.line(cx, fy - 3 + j, cx + 4, fy - 11 + j, O[4]);
      p.px(cx + 3, fy - 11 + j, O[5]);
      p.px(cx - 1, fy - 6 + j, GUN2); // sight
      p.px(cx - 2, fy - 6 + j, GUN3);
      if (ph === 2) {
        setMuzzle(cx + 4, fy - 12);
        p.px(cx + 4, fy - 12, FLASH[0]);
        p.px(cx + 5, fy - 12, FLASH[2]);
        p.px(cx + 3, fy - 12, FLASH[1]);
        p.px(cx + 4, fy - 13, SMOKE[4]);
        p.px(cx + 5, fy - 14, SMOKE[3]);
        p.px(cx + 3, fy - 14, SMOKE[4]);
      } else if (ph === 3) {
        p.px(cx + 5, fy - 13, SMOKE[3]);
        p.px(cx + 6, fy - 15, SMOKE[2]);
      }
      break;
    }
    case 'atgun': {
      const rc = ph === 2 ? 2 : ph === 3 ? 1 : 0;
      const X = cx + (ph === 2 ? -1 : 0);
      // split trail on the ground, or lifted for towing by hand
      if (spread > 0) {
        p.line(X - 2, fy - 4, X - 12, fy - 1, O[2]);
        p.line(X - 2, fy - 5, X - 12, fy - 2, O[3]);
        p.px(X - 13, fy - 1, S[1]);
      } else {
        p.line(X - 2, fy - 4, X - 10, fy - 6, O[2]);
        p.line(X - 2, fy - 5, X - 10, fy - 7, O[3]);
      }
      // gun shield
      p.rect(X, fy - 11, 2, 7, O[3]);
      p.vline(X, fy - 11, fy - 5, O[4]);
      p.px(X - 1, fy - 12, O[3]);
      p.px(X, fy - 12, O[4]);
      p.px(X + 1, fy - 10, T.main);
      p.px(X + 1, fy - 9, T.main);
      // cradle, breech, barrel and muzzle brake
      p.hline(X - 3, X + 3, fy - 7, O[2]);
      p.rect(X - 5 - rc, fy - 9, 2, 3, S[2]);
      p.hline(X - 4 - rc, X + 12 - rc, fy - 8, S[3]);
      p.rect(X + 12 - rc, fy - 9, 2, 3, S[1]);
      p.px(X + 13 - rc, fy - 8, S[2]);
      modernWheel(p, X - 1, fy - 3, 2, wheelTurn);
      if (ph === 2) setMuzzle(X + 14 - rc, fy - 8);
      break;
    }
    case 'howitzer': {
      const rc = ph === 2 ? 3 : ph === 3 ? 1 : 0;
      const X = cx + (ph === 2 ? -1 : 0);
      const el = spread >= 1 ? -0.4 : spread > 0 ? -0.2 : 0;
      const back = spread === 0 ? 5 : 0;
      const dx = Math.cos(el);
      const dy = Math.sin(el);
      const tx0 = X - 1;
      const ty0 = fy - 10;
      // point k along the barrel, n px "up" from its axis
      const L = (a: number, b: number, n: number, c: string) => p.line(tx0 + dx * a + dy * n, ty0 + dy * a - dx * n, tx0 + dx * b + dy * n, ty0 + dy * b - dx * n, c);
      // trails
      if (spread >= 1) {
        p.line(X - 3, fy - 7, X - 13, fy - 4, O[1]);
        p.line(X - 3, fy - 8, X - 13, fy - 5, O[2]);
        p.vline(X - 14, fy - 6, fy - 4, S[1]);
        p.line(X - 3, fy - 5, X - 17, fy - 1, O[2]);
        p.line(X - 3, fy - 6, X - 17, fy - 2, O[3]);
        p.vline(X - 18, fy - 3, fy - 1, S[2]);
      } else if (spread > 0) {
        p.line(X - 3, fy - 7, X - 14, fy - 5, O[1]);
        p.line(X - 3, fy - 8, X - 14, fy - 6, O[2]);
        p.line(X - 3, fy - 5, X - 16, fy - 2, O[2]);
        p.line(X - 3, fy - 6, X - 16, fy - 3, O[3]);
      } else {
        // trails closed on the travel dolly
        p.line(X - 3, fy - 6, X - 16, fy - 5, O[2]);
        p.line(X - 3, fy - 7, X - 16, fy - 6, O[3]);
        p.px(X - 17, fy - 6, S[2]);
        modernWheel(p, X - 15, fy - 3, 1.5, wheelTurn);
      }
      // shield + cradle
      p.rect(X + 1, fy - 15, 2, 8, O[3]);
      p.vline(X + 1, fy - 15, fy - 8, O[4]);
      p.px(X + 2, fy - 13, T.main);
      p.px(X + 2, fy - 12, T.main);
      p.rect(X - 4, fy - 11, 6, 3, O[2]);
      p.hline(X - 4, X + 1, fy - 11, O[3]);
      // barrel (recoils along its axis), recuperator above it
      const b0 = -6 - rc - back;
      const b1 = 17 - rc - back;
      L(-3 - back, 7 - back, 2, O[3]);
      L(b0, b1, 0, S[2]);
      L(b0, b1, 1, S[3]);
      for (const n of [-1, 0, 1, 2]) L(b1, b1 + 1, n, S[1]);
      for (const n of [-1, 0, 1, 2]) L(b0 - 1, b0, n, S[1]);
      modernWheel(p, X - 1, fy - 4, 3, wheelTurn);
      if (ph === 2) setMuzzle(tx0 + dx * (b1 + 2) + dy * 0.5, ty0 + dy * (b1 + 2) - dx * 0.5);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// vehicles (facing right, wheels / tracks on the ground line)
export const VEH_W = 36;
export const VEH_H = 28;

interface VState {
  /** wheel / track phase 0..3 */
  ph: number;
  /** body lift for suspension bounce */
  bounce?: number;
  /** gun recoil (px) */
  recoil?: number;
  fire?: boolean;
  hatch?: boolean;
  /** crew waving (1/2), commander out of the hatch */
  wave?: number;
  droop?: boolean;
  puff?: boolean;
  /** knocked out: no crew, hatches open */
  dead?: boolean;
  /** tank only: draw the hull or the turret alone */
  part?: 'hull' | 'top';
  /** wheels blown off (wrecks) */
  noWheels?: boolean;
  /** truck canvas burnt away, ribs bare */
  stripped?: boolean;
}

const V_DRIVER: UnitLook = { body: 'soldier', helmet: 'combat', armor: 'fatigues', weapon: 'mg', shield: 'none' };
const V_OFFICER: UnitLook = { body: 'soldier', helmet: 'officer', armor: 'fatigues', weapon: 'pistol', shield: 'none' };
const V_RADIO: UnitLook = { body: 'soldier', helmet: 'patrol', armor: 'fatigues', weapon: 'none', shield: 'none' };
const V_TECH: UnitLook = { body: 'peasant', helmet: 'bandana', armor: 'jacket', weapon: 'mg', shield: 'none', cloth: '#5a5040' };
const V_TANKER: UnitLook = { body: 'soldier', helmet: 'combat', armor: 'fatigues', weapon: 'none', shield: 'none' };

/** recolour exact `base` pixels inside a box into large vehicle camo blotches */
function camoSwap(p: PixelCanvas, base: string, x0: number, y0: number, x1: number, y1: number, seed: number) {
  const b = toPacked(base);
  const dark = toPacked(MIL.olive[2]);
  const brown = toPacked(MIL.drab[3]);
  for (let y = Math.max(0, y0); y <= Math.min(p.h - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(p.w - 1, x1); x++) {
      const i = y * p.w + x;
      if (p.data[i] !== b) continue;
      const v = hash2i(Math.floor((x + (y >> 1)) / 3), Math.floor(y / 2), seed);
      if (v < 0.2) p.data[i] = dark;
      else if (v < 0.36) p.data[i] = brown;
    }
}

function drawVehicle(p: PixelCanvas, look: UnitLook, pal: Palette, s: VState, cx: number, fy: number) {
  const O = MIL.olive;
  const S = MIL.steel;
  const T = pal.team;
  const by = fy - (s.bounce ?? 0);
  const crew = (x: number, seatY: number, cl: UnitLook, pose: Partial<Pose>) => {
    drawFigure(p, cl, pal, { ...BASE_POSE, ...pose }, x, seatY, { seated: true });
    p.rect(x - 2, seatY - 3, 4, 3, modernHose(cl));
  };
  const wave: Partial<Pose> | null = s.wave ? (s.wave === 1 ? { arm: -1.6, armB: -2.1, noWeapon: true } : { arm: -1.3, armB: -1.8, noWeapon: true }) : null;
  const gunner: Partial<Pose> = wave ?? (s.fire ? { arm: -0.03, reach: -1, flash: true } : s.recoil ? { arm: 0.02 } : { arm: 0 });
  const wheel = (x: number, r = 2) => {
    if (!s.noWheels) modernWheel(p, x, fy - 3, r, s.ph, O[2]);
  };
  const puff = (x: number, y: number) => {
    if (!s.puff) return;
    p.px(x, y, SMOKE[3]);
    p.px(x - 1, y - 1, SMOKE[4]);
    p.px(x - 2, y - 1, SMOKE[3]);
  };
  switch (look.vehicle) {
    case 'jeep':
    case 'command': {
      const cmd = look.vehicle === 'command';
      if (!s.dead) {
        if (cmd) {
          crew(cx - 8, by - 4, V_RADIO, wave ?? { arm: 0.6, noWeapon: true });
          crew(cx - 2, by - 4, V_OFFICER, wave ?? (s.fire ? { arm: -0.2, flash: true } : s.recoil ? { arm: -0.05, reach: 1 } : { arm: 0.6, noWeapon: true }));
        } else crew(cx - 3, by - 4, V_DRIVER, gunner);
      }
      // spare wheel on the tail
      p.rect(cx - 12, by - 9, 2, 4, MIL.rubber[1]);
      p.px(cx - 12, by - 8, MIL.rubber[3]);
      // tub, hood, folded windshield
      p.rect(cx - 10, by - 8, 13, 4, O[3]);
      p.rect(cx + 3, by - 7, 8, 3, O[3]);
      camoSwap(p, O[3], cx - 10, by - 8, cx + 10, by - 5, 3);
      p.hline(cx - 10, cx + 2, by - 8, O[4]);
      p.hline(cx + 3, cx + 10, by - 7, O[5]);
      p.hline(cx + 3, cx + 6, by - 8, O[1]);
      p.px(cx + 6, by - 8, MIL.glass[2]);
      p.hline(cx - 10, cx + 10, by - 4, O[1]);
      p.vline(cx + 11, by - 7, by - 4, O[1]);
      p.px(cx + 11, by - 6, '#e8e0b0');
      p.vline(cx - 3, by - 7, by - 5, O[2]);
      p.rect(cx + 5, by - 6, 3, 2, T.main);
      p.hline(cx + 5, cx + 7, by - 6, T.light);
      if (cmd) {
        // whip antenna + pennant on the fender
        p.rect(cx - 12, by - 10, 3, 2, GUN2); // radio set
        const top = s.dead ? by - 16 : by - 25;
        for (let y = by - 11; y >= top; y--) p.blend(cx - 11 - Math.floor((by - 11 - y) / 7), y, '#2e3034', 0.72);
        for (let y = by - 16; y <= by - 8; y++) p.blend(cx + 10, y, '#9a9aa0', 0.75);
        if (!s.dead) {
          const f = s.ph % 2;
          p.rect(cx + 6, by - 16, 4, 3, T.main);
          p.hline(cx + 6, cx + 9, by - 16, T.light);
          p.px(cx + 5, by - 15 + f, T.main);
          p.px(cx + 7 + f, by - 14, T.dark);
        }
      } else p.vline(cx + 1, by - 9, by - 8, GUN2); // MG pedestal
      wheel(cx - 6);
      wheel(cx + 6);
      puff(cx - 13, by - 5);
      break;
    }
    case 'technical': {
      const TC = ['#3e3a32', '#6e6656', '#9e9480', '#c8bea6', '#e2d8c2'];
      if (!s.dead) crew(cx - 6, by - 6, V_TECH, gunner);
      // tripod
      p.line(cx - 3, by - 10, cx - 4, by - 8, S[2]);
      p.line(cx - 3, by - 10, cx - 2, by - 8, S[2]);
      // bed
      p.rect(cx - 12, by - 8, 12, 4, TC[2]);
      p.hline(cx - 12, cx - 1, by - 8, TC[3]);
      p.vline(cx - 12, by - 8, by - 5, TC[1]);
      // cab
      p.rect(cx, by - 10, 6, 6, TC[2]);
      p.hline(cx, cx + 4, by - 11, TC[3]);
      p.rect(cx + 2, by - 10, 3, 2, MIL.glass[1]);
      p.px(cx + 5, by - 10, MIL.glass[2]);
      if (!s.dead) {
        p.px(cx + 3, by - 10, pal.skin[3]);
        p.px(cx + 2, by - 10, pal.hair);
      }
      // hood
      p.rect(cx + 6, by - 8, 6, 4, TC[2]);
      p.hline(cx + 6, cx + 11, by - 8, TC[4]);
      p.vline(cx + 12, by - 8, by - 5, TC[1]);
      p.px(cx + 12, by - 7, '#f0e8c0');
      p.hline(cx - 12, cx + 12, by - 4, TC[1]);
      // rust, then a painted team stripe
      p.px(cx + 8, by - 5, '#8a5232');
      p.px(cx - 9, by - 5, '#8a5232');
      p.px(cx - 8, by - 5, '#6a3a22');
      p.px(cx + 1, by - 5, '#8a5232');
      p.hline(cx, cx + 11, by - 6, T.main);
      p.px(cx, by - 6, T.dark);
      wheel(cx - 7);
      wheel(cx + 8);
      puff(cx - 13, by - 5);
      break;
    }
    case 'truck': {
      const C = MIL.drab;
      // canvas tilt over the cargo bed
      if (s.stripped) {
        // canvas burnt off: bare hoops
        p.hline(cx - 12, cx + 2, by - 15, C[1]);
        for (const x of [cx - 13, cx - 9, cx - 5, cx - 1, cx + 3]) p.vline(x, by - 15, by - 9, C[1]);
      } else {
        p.hline(cx - 12, cx + 2, by - 15, C[4]);
        p.rect(cx - 13, by - 14, 17, 6, C[3]);
        for (const x of [cx - 9, cx - 5, cx - 1]) p.vline(x, by - 14, by - 9, C[2]);
        p.vline(cx - 13, by - 14, by - 8, C[1]);
      }
      p.rect(cx - 13, by - 8, 17, 3, O[3]);
      camoSwap(p, O[3], cx - 13, by - 8, cx + 3, by - 6, 5);
      p.hline(cx - 13, cx + 3, by - 8, O[4]);
      // cab + hood
      p.rect(cx + 4, by - 13, 6, 8, O[3]);
      p.rect(cx + 10, by - 10, 3, 5, O[3]);
      camoSwap(p, O[3], cx + 4, by - 13, cx + 12, by - 5, 6);
      p.hline(cx + 4, cx + 9, by - 13, O[4]);
      p.hline(cx + 10, cx + 12, by - 10, O[4]);
      p.rect(cx + 7, by - 12, 3, 2, MIL.glass[1]);
      p.px(cx + 9, by - 12, MIL.glass[2]);
      if (!s.dead) {
        p.px(cx + 8, by - 11, pal.skin[3]);
        p.px(cx + 7, by - 11, pal.skin[2]);
        p.hline(cx + 7, cx + 8, by - 12, O[4]);
      }
      p.vline(cx + 13, by - 10, by - 6, O[1]);
      p.px(cx + 13, by - 8, '#e8e0b0');
      p.rect(cx + 4, by - 10, 3, 2, T.main);
      p.hline(cx + 4, cx + 6, by - 10, T.light);
      p.hline(cx - 13, cx + 13, by - 5, S[1]);
      p.vline(cx + 3, by - 15, by - 13, GUN2); // exhaust stack
      wheel(cx - 9);
      wheel(cx - 4);
      wheel(cx + 9);
      puff(cx + 3, by - 16);
      break;
    }
    case 'tank':
    default: {
      const R = MIL.rubber;
      if (s.part !== 'top') {
        // tracks: links on the top run creep forward, the bottom run backward
        p.rect(cx - 12, fy - 6, 25, 6, R[1]);
        p.vline(cx - 13, fy - 5, fy - 2, R[1]);
        p.vline(cx + 13, fy - 5, fy - 2, R[1]);
        for (let x = cx - 12; x <= cx + 12; x++) {
          if (((x - cx + 40 - s.ph) & 3) === 0) p.px(x, fy - 6, R[3]);
          if (((x - cx + 40 + s.ph) & 3) === 0) p.px(x, fy - 1, R[3]);
        }
        for (const wx of [-9, -4, 1, 6]) {
          p.ellipse(cx + wx + 0.5, fy - 2.5, 2, 2, S[2]);
          p.px(cx + wx, fy - 3, S[0]);
          const a = s.ph * (Math.PI / 4);
          p.px(cx + wx + Math.round(Math.cos(a) * 1.4), fy - 3 + Math.round(Math.sin(a) * 1.4), S[3]);
        }
        p.ellipse(cx + 10.5, fy - 3.5, 1.6, 1.6, S[1]);
        p.ellipse(cx - 10.5, fy - 3.5, 1.6, 1.6, S[1]);
        // hull + sloped glacis
        p.hline(cx - 14, cx + 12, by - 7, O[2]);
        p.rect(cx - 13, by - 10, 23, 3, O[3]);
        p.px(cx + 10, by - 10, O[3]);
        p.hline(cx + 10, cx + 11, by - 9, O[3]);
        p.hline(cx + 10, cx + 12, by - 8, O[3]);
        p.px(cx + 13, by - 7, O[2]);
        camoSwap(p, O[3], cx - 13, by - 10, cx + 12, by - 8, 7);
        p.hline(cx - 13, cx + 10, by - 10, O[4]);
        p.px(cx + 11, by - 9, O[4]);
        p.px(cx + 12, by - 8, O[4]);
        p.vline(cx - 13, by - 10, by - 8, O[2]);
        for (let x = cx - 12; x <= cx - 8; x += 2) p.px(x, by - 9, O[1]);
        p.px(cx + 9, by - 9, '#d8d0a0');
        p.px(cx - 14, by - 9, S[2]);
        puff(cx - 15, by - 10);
      }
      if (s.part !== 'hull') {
        if (wave) crew(cx - 3, by - 10, V_TANKER, wave);
        // turret: cast dome with a rear bustle
        p.rect(cx - 7, by - 14, 12, 4, O[3]);
        p.rect(cx - 5, by - 15, 9, 1, O[3]);
        camoSwap(p, O[3], cx - 7, by - 15, cx + 4, by - 11, 9);
        p.hline(cx - 5, cx + 3, by - 15, O[5]);
        p.hline(cx - 7, cx - 6, by - 14, O[4]);
        p.hline(cx - 7, cx + 4, by - 11, O[2]);
        p.vline(cx - 8, by - 13, by - 11, O[2]);
        p.rect(cx + 5, by - 14, 2, 4, O[2]);
        p.px(cx + 5, by - 14, O[4]);
        // cupola + hatch
        p.rect(cx - 4, by - 16, 3, 1, O[3]);
        if (s.hatch || s.dead) {
          p.vline(cx - 5, by - 19, by - 16, O[2]);
          p.px(cx - 5, by - 19, O[4]);
        } else p.hline(cx - 4, cx - 2, by - 17, O[4]);
        p.hline(cx - 1, cx + 2, by - 16, GUN);
        // team marking + radio whip with a team pennant (whip is translucent so it stays a hairline)
        p.rect(cx - 2, by - 13, 3, 2, T.main);
        p.hline(cx - 2, cx, by - 13, T.light);
        const whipTop = s.dead ? by - 18 : by - 24;
        for (let y = by - 15; y >= whipTop; y--) p.blend(cx - 7 - Math.floor((by - 15 - y) / 6), y, '#2e3034', 0.72);
        if (!s.dead) {
          const f = s.ph % 2;
          p.rect(cx - 11, by - 24, 3, 2, T.main);
          p.px(cx - 11, by - 24 + f, T.light);
          p.px(cx - 12, by - 23 - f, T.main);
        }
        // main gun
        const rc = s.recoil ?? 0;
        if (s.droop) {
          p.line(cx + 7, by - 13, cx + 15, by - 9, S[3]);
          p.line(cx + 7, by - 12, cx + 15, by - 8, S[1]);
          p.px(cx + 11, by - 11, S[2]);
        } else {
          p.rect(cx + 11 - rc, by - 14, 2, 4, S[2]);
          p.hline(cx + 7 - rc, cx + 16 - rc, by - 13, S[3]);
          p.hline(cx + 7 - rc, cx + 16 - rc, by - 12, S[1]);
          p.vline(cx + 17 - rc, by - 14, by - 11, S[2]);
          if (s.fire) setMuzzle(cx + 18 - rc, by - 13);
        }
      }
      break;
    }
  }
}

function vehicleFrame(look: UnitLook, pal: Palette, kind: PoseKind, i: number, w: number, h: number, ax: number, ay: number): PixelCanvas {
  let pc = new PixelCanvas(w, h);
  const s: VState = { ph: 0 };
  const tracked = look.vehicle === 'tank';
  switch (kind) {
    case 'walk':
    case 'run':
    case 'flee':
      s.ph = i;
      s.bounce = tracked ? 0 : i % 2;
      break;
    case 'idle':
      s.puff = i === 1;
      break;
    case 'atkA':
    case 'atkB':
      s.recoil = [0, 2, 1][i];
      s.fire = i === 1;
      break;
    case 'cheer':
      s.wave = i + 1;
      s.hatch = true;
      break;
    default:
      break;
  }
  drawVehicle(pc, look, pal, s, ax + (kind === 'flinch' ? -1 : 0), ay);
  const rock = kind === 'flinch' ? -0.07 : (kind === 'atkA' || kind === 'atkB') && i === 1 ? 0.07 : 0;
  if (rock) {
    pc = shear(pc, ax, rock);
    const m = lastMuzzle();
    if (m && rock > 0) setMuzzle(m.x, m.y - Math.round(Math.max(0, m.x - ax) * rock));
  }
  return pc;
}

/** [dieA0..2 (knocked out, burning), dieB0..2 (blown apart)] */
function vehicleDeaths(look: UnitLook, pal: Palette, w: number, h: number, ax: number, ay: number, seed: number): PixelCanvas[] {
  const draw = (s: VState) => {
    const pc = new PixelCanvas(w, h);
    drawVehicle(pc, look, pal, s, ax, ay);
    return pc;
  };
  const ko = draw({ ph: 0, dead: true, droop: true, hatch: true });
  const out = [burn(ko, 0.4, seed), burn(ko, 0.68, seed), burn(squash(ko, ay, 0.94, 0, false), 0.88, seed)];
  if (look.vehicle === 'tank') {
    const hull = draw({ ph: 0, dead: true, part: 'hull' });
    const top = draw({ ph: 0, dead: true, droop: true, part: 'top' });
    const blown = (k: number, tilt: number, ox: number, oy: number) => {
      const pc = burn(hull, k, seed);
      stamp(pc, burn(shear(top, ax - 7, tilt), k * 0.9, seed + 1), ox, oy);
      return pc;
    };
    out.push(blown(0.5, -0.12, -1, -4), blown(0.75, 0.18, -7, 3), blown(0.92, 0.18, -7, 3));
  } else {
    // body thrown nose-up, then dropped on its belly with the wheels blown off and scattered
    const base = draw({ ph: 0, dead: true });
    const hulk = (k: number) => {
      const pc = new PixelCanvas(w, h);
      drawVehicle(pc, look, pal, { ph: 0, dead: true, noWheels: true, stripped: true }, ax, ay + 3);
      const tilted = shear(pc, ax, -0.06);
      modernWheel(tilted, ax + 14, ay - 2, 2, 1, MIL.olive[2]);
      tilted.ellipse(ax - 15.5, ay - 0.5, 2.6, 1.1, MIL.rubber[1]);
      tilted.px(ax - 16, ay - 1, MIL.rubber[3]);
      for (let j = 0; j < 5; j++) {
        const r = hash2i(j, seed, 9);
        tilted.px(ax - 10 + Math.round(r * 22), ay - 1 - (j % 2), j % 2 ? MIL.olive[1] : MIL.steel[2]);
      }
      return burn(tilted, k, seed);
    };
    out.push(burn(shear(base, ax - 4, 0.14), 0.5, seed), hulk(0.75), hulk(0.92));
  }
  return out;
}

/** char toward burnt black (k 0..1), with a few glowing embers while it still burns */
function burn(src: PixelCanvas, k: number, seed: number): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let i = 0; i < src.data.length; i++) {
    const v = src.data[i];
    const a = v >>> 24;
    if (!a) continue;
    const x = i % src.w;
    const y = (i / src.w) | 0;
    const r = v & 255;
    const g = (v >>> 8) & 255;
    const b = (v >>> 16) & 255;
    const lum = (r + g + b) / 3;
    const n = hash2i(x, y, seed);
    const kk = Math.min(1, k * (0.8 + n * 0.4));
    let nr = r + (28 + lum * 0.2 - r) * kk;
    let ng = g + (22 + lum * 0.16 - g) * kk;
    let nb = b + (24 + lum * 0.16 - b) * kk;
    if (k > 0.3 && k < 0.95 && n > 0.97) {
      nr = 226;
      ng = 104;
      nb = 34;
    }
    out.data[i] = pack(nr, ng, nb, a);
  }
  return out;
}

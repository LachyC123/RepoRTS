import { UNITS, type UnitDef, type UnitLook } from '../../data/units';
import { NEUTRAL_COLOR } from '../../data/factions';
import { art } from './ArtRegistry';
import { PixelCanvas, shade } from './PixelCanvas';
import { MIL, OUTLINE, RAMP } from './palette';
import { buildUnitSheet, sheetFrame } from './unitArt';

/** Ambient life: animals, birds, butterflies, villagers, carts and boats (render-only). */
export function buildAmbientArt() {
  const add = (name: string, pc: PixelCanvas, ax: number, ay: number) => art.add(name, pc, ax, ay);
  // ---- sheep (2 walk frames + graze)
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(12, 9);
    const wool = ['#c8c0b4', '#e0d8cc', '#f4f0e8'];
    const leg = f === 1 ? 1 : 0;
    pc.vline(3 + leg, 6, 7, '#3a3030');
    pc.vline(8 - leg, 6, 7, '#3a3030');
    pc.ellipse(5.5, 4.5, 4.5, 2.6, wool[1]);
    pc.ellipse(5, 3.8, 3.5, 1.8, wool[2]);
    const hy = f === 2 ? 5 : 3;
    pc.rect(9, hy, 2, 2, '#3a3030');
    pc.px(10, hy, '#5a4a48');
    pc.outline(OUTLINE, 0.6);
    pc.shadow(6, 8, 4.5, 1, 0.25);
    add(`amb/sheep/${f}`, pc, 6, 8);
  }
  // ---- cow
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(16, 11);
    const c = ['#5a3a28', '#7a5034', '#f0e8e0'];
    const leg = f === 1 ? 1 : 0;
    pc.vline(3 + leg, 7, 9, '#2a201c');
    pc.vline(5 - leg, 7, 9, '#2a201c');
    pc.vline(10 + leg, 7, 9, '#2a201c');
    pc.vline(12 - leg, 7, 9, '#2a201c');
    pc.rect(2, 3, 11, 5, c[1]);
    pc.hline(3, 12, 3, shade(c[1], 0.15));
    pc.rect(5, 4, 3, 2, c[2]);
    pc.rect(9, 5, 2, 2, c[2]);
    const hy = f === 2 ? 6 : 3;
    pc.rect(13, hy, 3, 3, c[0]);
    pc.px(13, hy - 1, '#d8d0c0');
    pc.px(15, hy + 2, '#d8a0a0');
    pc.line(2, 3, 1, 6, c[0]);
    pc.outline(OUTLINE, 0.6);
    pc.shadow(8, 10, 6, 1.2, 0.25);
    add(`amb/cow/${f}`, pc, 8, 10);
  }
  // ---- chicken
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(6, 6);
    const peck = f === 1;
    pc.rect(1, 2, 3, 2, '#f0ece0');
    pc.px(0, 2, '#d8d0c0');
    pc.px(4, peck ? 3 : 1, '#f0ece0');
    pc.px(4, peck ? 2 : 0, '#d83a2a');
    pc.px(5, peck ? 4 : 2, '#e8a030');
    pc.px(2, 4, '#e8a030');
    pc.outline(OUTLINE, 0.5);
    add(`amb/chicken/${f}`, pc, 3, 5);
  }
  // ---- dog
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(11, 8);
    const c = ['#4a3020', '#7a5030', '#a07040'];
    const leg = f % 2;
    pc.vline(2 + leg, 5, 6, c[0]);
    pc.vline(7 - leg, 5, 6, c[0]);
    pc.rect(1, 3, 7, 2, c[1]);
    pc.hline(2, 7, 3, c[2]);
    pc.rect(7, 1, 3, 3, c[1]);
    pc.px(8, 0, c[0]);
    pc.px(10, 2, '#2a1a14');
    pc.line(1, 3, 0, f === 2 ? 0 : 1, c[1]);
    pc.outline(OUTLINE, 0.55);
    pc.shadow(5, 7, 4, 0.8, 0.22);
    add(`amb/dog/${f}`, pc, 5, 7);
  }
  // ---- deer
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(14, 14);
    const c = ['#5a3a20', '#8a5a30', '#b07a44', '#e8d8c0'];
    const leg = f === 1 ? 1 : 0;
    pc.vline(3 + leg, 9, 12, c[0]);
    pc.vline(5 - leg, 9, 12, c[0]);
    pc.vline(9 + leg, 9, 12, c[0]);
    pc.vline(10 - leg, 9, 12, c[0]);
    pc.rect(2, 6, 9, 4, c[2]);
    pc.hline(3, 10, 6, c[3]);
    const hy = f === 2 ? 8 : 3;
    pc.rect(10, hy, 2, 4, c[2]);
    pc.rect(11, hy - 1, 3, 2, c[2]);
    pc.px(13, hy, '#201810');
    pc.line(11, hy - 2, 10, hy - 5, '#d8c8a8');
    pc.line(12, hy - 2, 13, hy - 5, '#d8c8a8');
    pc.px(2, 6, c[3]);
    pc.outline(OUTLINE, 0.55);
    pc.shadow(7, 13, 5, 1, 0.22);
    add(`amb/deer/${f}`, pc, 7, 13);
  }
  // ---- birds (flap 2 frames) and crows
  for (const [n, col] of [['bird', '#e8e4ec'], ['crow', '#24202a']] as const) {
    for (let f = 0; f < 2; f++) {
      const pc = new PixelCanvas(7, 4);
      if (f === 0) {
        pc.px(0, 0, col);
        pc.px(1, 1, col);
        pc.px(2, 2, col);
        pc.px(3, 2, col);
        pc.px(4, 2, col);
        pc.px(5, 1, col);
        pc.px(6, 0, col);
      } else {
        pc.px(0, 3, col);
        pc.px(1, 2, col);
        pc.px(2, 2, col);
        pc.px(3, 1, col);
        pc.px(4, 2, col);
        pc.px(5, 2, col);
        pc.px(6, 3, col);
      }
      add(`amb/${n}/${f}`, pc, 3, 2);
    }
  }
  // ---- butterfly
  for (const [k, col] of ['#f0e070', '#f0f0f8', '#e890b0', '#88b8f0'].entries()) {
    for (let f = 0; f < 2; f++) {
      const pc = new PixelCanvas(3, 2);
      if (f === 0) {
        pc.px(0, 0, col);
        pc.px(2, 0, col);
        pc.px(1, 1, '#302028');
      } else {
        pc.px(0, 1, col);
        pc.px(2, 1, col);
        pc.px(1, 1, '#302028');
        pc.px(1, 0, col);
      }
      add(`amb/fly${k}/${f}`, pc, 1, 1);
    }
  }
  // ---- duck
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(7, 5);
    pc.rect(1, 2, 4, 2, '#8a6a4a');
    pc.px(4, 1 + f, '#2a6a3a');
    pc.px(5, 1 + f, '#2a6a3a');
    pc.px(6, 1 + f, '#e8a030');
    pc.hline(0, 6, 4, '#a8d0e4');
    pc.outline(OUTLINE, 0.4);
    add(`amb/duck/${f}`, pc, 3, 4);
  }
  // ---- fish jump
  {
    const pc = new PixelCanvas(5, 3);
    pc.hline(1, 3, 1, '#b8c8d0');
    pc.px(0, 0, '#98a8b0');
    pc.px(0, 2, '#98a8b0');
    pc.px(4, 1, '#d8e0e8');
    add('amb/fish', pc, 2, 1);
  }
  // ---- water glint (3 frames)
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(5, 1);
    const len = [1, 3, 5][f];
    pc.hline(2 - Math.floor(len / 2), 2 + Math.floor(len / 2), 0, '#e8f4f8');
    add(`amb/glint/${f}`, pc, 2, 0);
  }
  // ---- cart (horse + wagon), 2 frames
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(28, 16);
    const W = RAMP.wood;
    // wagon
    pc.rect(2, 6, 12, 4, W[3]);
    pc.hline(2, 13, 6, W[5]);
    pc.rect(3, 3, 10, 3, ['#c8b080', '#a08a5a'][f % 2 === 0 ? 0 : 1]);
    pc.rect(4, 2, 3, 2, RAMP.hay[3]);
    pc.rect(8, 2, 4, 2, '#8a6a4a');
    pc.ellipse(5, 11, 2.5, 2.5, W[1]);
    pc.ellipse(5, 11, 1.2, 1.2, W[3]);
    pc.ellipse(12, 11, 2.5, 2.5, W[1]);
    pc.ellipse(12, 11, 1.2, 1.2, W[3]);
    pc.line(14, 8, 17, 8, W[2]);
    // horse
    const leg = f;
    pc.vline(18 + leg, 10, 13, '#2a1c14');
    pc.vline(20 - leg, 10, 13, '#3a2818');
    pc.vline(23 + leg, 10, 13, '#2a1c14');
    pc.vline(24 - leg, 10, 13, '#3a2818');
    pc.rect(17, 6, 9, 4, '#7a5034');
    pc.hline(18, 25, 6, '#9a6a44');
    pc.rect(24, 3, 2, 4, '#7a5034');
    pc.rect(25, 2, 3, 2, '#7a5034');
    pc.px(26, 2, '#100c10');
    pc.vline(23, 3, 6, '#2a1a10');
    // driver
    pc.rect(13, 1, 2, 3, '#6a5a3a');
    pc.rect(13, -1 + 1, 2, 1, '#c8946a');
    pc.outline(OUTLINE, 0.6);
    pc.shadow(14, 14, 12, 1.5, 0.25);
    add(`amb/cart/${f}`, pc, 14, 14);
  }
  // ---- rowing boat
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(16, 8);
    pc.rect(2, 4, 12, 2, RAMP.wood[3]);
    pc.hline(1, 14, 4, RAMP.wood[5]);
    pc.hline(3, 12, 6, RAMP.wood[1]);
    pc.rect(7, 1, 2, 3, '#5a6a8a');
    pc.px(7, 0, '#c8946a');
    pc.line(4, f ? 2 : 6, 11, f ? 6 : 2, RAMP.wood[2]);
    pc.outline(OUTLINE, 0.5);
    add(`amb/boat/${f}`, pc, 8, 6);
  }
  // ---- villagers (reuse the soldier paper-doll with civilian looks)
  const looks: [string, UnitLook][] = [
    ['man', { body: 'peasant', helmet: 'cap', armor: 'tunic', weapon: 'none', shield: 'none', cloth: '#7a6a44' }],
    ['woman', { body: 'peasant', helmet: 'hood', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#8a4a3a' }],
    ['elder', { body: 'peasant', helmet: 'none', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#5a5a6a', beard: true }],
    ['monk', { body: 'peasant', helmet: 'hood', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#5a4030' }],
    ['maid', { body: 'peasant', helmet: 'none', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#3a5a7a' }],
    ['guard', { body: 'soldier', helmet: 'kettle', armor: 'gambeson', weapon: 'spear', shield: 'none', cloth: '#6a5a44' }],
    ['gatherer', { body: 'peasant', helmet: 'hood', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#6a7a3a', carry: 'basket' }],
    ['water', { body: 'peasant', helmet: 'none', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#7a5a8a', carry: 'bucket' }],
    ['woodsman', { body: 'peasant', helmet: 'cap', armor: 'tunic', weapon: 'none', shield: 'none', cloth: '#5a6a4a', beard: true, carry: 'firewood' }],
    ['peddler', { body: 'peasant', helmet: 'feather', armor: 'tunic', weapon: 'none', shield: 'none', cloth: '#8a6a2a', sack: true }],
    ['girl', { body: 'peasant', helmet: 'none', armor: 'robe', weapon: 'none', shield: 'none', cloth: '#b86a5a', carry: 'flowers' }],
    ['boy', { body: 'peasant', helmet: 'cap', armor: 'tunic', weapon: 'none', shield: 'none', cloth: '#5a7aa0' }],
  ];
  const children = new Set(['girl', 'boy']);
  for (const [name, look] of looks) {
    const def: UnitDef = { ...UNITS.militia, id: 'civ_' + name, look };
    const sheet = buildUnitSheet(def, { ...NEUTRAL_COLOR, main: '#8a7a5a', light: '#a89a7a', dark: '#5a4a3a' }, name.length);
    // idle 0,1 / walk 2..5 (children are the same figure at three-quarter size)
    for (let f = 0; f < 6; f++) {
      const pc = sheetFrame(sheet, f);
      add(`amb/villager_${name}/${f}`, children.has(name) ? shrink(pc, 0.72, sheet.ax, sheet.ay) : pc, sheet.ax, sheet.ay);
    }
  }
  buildModernAmbient(add);
}

export const VILLAGER_KINDS = ['man', 'woman', 'gatherer', 'elder', 'water', 'boy', 'maid', 'woodsman', 'woman', 'girl', 'peddler', 'man'];
/** modern-era townsfolk (frames 'amb/villager_<kind>/<0..5>', same idle/walk layout as VILLAGER_KINDS) */
export const MODERN_VILLAGER_KINDS = ['m_man', 'm_woman', 'm_worker', 'm_shopper', 'm_kid', 'm_elder', 'm_woman', 'm_man', 'm_kid', 'm_shopper'];

/** nearest-neighbour scale toward the feet anchor (children) */
function shrink(src: PixelCanvas, k: number, ax: number, ay: number): PixelCanvas {
  const out = new PixelCanvas(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const sx = Math.round(ax + (x - ax) / k);
      const sy = Math.round(ay + (y - ay) / k);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      out.data[y * src.w + x] = src.data[sy * src.w + sx];
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// modern era: townsfolk in jackets and jeans, a guard, delivery truck, hatchback and motorboat
function buildModernAmbient(add: (name: string, pc: PixelCanvas, ax: number, ay: number) => void) {
  const N = { body: 'peasant', weapon: 'none', shield: 'none' } as const;
  const looks: [string, UnitLook][] = [
    ['m_man', { ...N, helmet: 'none', armor: 'jacket', cloth: '#56687c' }],
    ['m_woman', { ...N, helmet: 'none', armor: 'robe', cloth: '#b04a5a' }],
    ['m_worker', { ...N, helmet: 'hardhat', armor: 'jacket', cloth: '#d07a28' }],
    ['m_shopper', { ...N, helmet: 'none', armor: 'robe', cloth: '#3a6a5a', carry: 'basket' }],
    ['m_kid', { ...N, helmet: 'cap', armor: 'jacket', cloth: '#3a7ac0' }],
    ['m_elder', { ...N, helmet: 'none', armor: 'jacket', cloth: '#6a5a4a', beard: true }],
    ['m_guard', { body: 'soldier', helmet: 'combat', armor: 'fatigues', weapon: 'rifle', shield: 'none' }],
  ];
  for (const [name, look] of looks) {
    const def: UnitDef = { ...UNITS.militia, id: 'civ_' + name, look };
    // civilians wear their clothing colour where soldiers carry team colour (armband, cap)
    const c = look.cloth ?? '#8a7a5a';
    const kc = look.body === 'soldier' ? { ...NEUTRAL_COLOR, main: '#8a7a5a', light: '#a89a7a', dark: '#5a4a3a' } : { ...NEUTRAL_COLOR, main: c, light: shade(c, 0.18), dark: shade(c, -0.2) };
    const sheet = buildUnitSheet(def, kc, name.length);
    for (let f = 0; f < 6; f++) {
      const pc = sheetFrame(sheet, f);
      add(`amb/villager_${name}/${f}`, name === 'm_kid' ? shrink(pc, 0.72, sheet.ax, sheet.ay) : pc, sheet.ax, sheet.ay);
    }
  }
  const tyre = (pc: PixelCanvas, x: number, y: number, f: number) => {
    pc.ellipse(x + 0.5, y + 0.5, 2.5, 2.5, MIL.rubber[1]);
    pc.ellipse(x + 0.5, y + 0.5, 1.2, 1.2, MIL.grey[4]);
    pc.px(x, y, MIL.grey[2]);
    const a = f * (Math.PI / 4) + 0.4;
    pc.px(x + Math.round(Math.cos(a) * 2), y + Math.round(Math.sin(a) * 2), MIL.rubber[3]);
    pc.px(x - Math.round(Math.cos(a) * 2), y - Math.round(Math.sin(a) * 2), MIL.rubber[3]);
  };
  // ---- delivery truck (cab-over, box body), 28×16 like the cart
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(28, 16);
    const Bx = ['#264a7a', '#3a6aa8', '#5a8ac4', '#8ab0dc'];
    pc.rect(2, 1, 17, 10, Bx[1]);
    pc.hline(2, 18, 1, Bx[3]);
    pc.vline(2, 1, 10, Bx[0]);
    pc.hline(3, 17, 6, '#f0ece0'); // livery stripe
    pc.px(14, 4, '#f0ece0');
    pc.px(15, 3, '#f0ece0');
    pc.px(16, 4, '#f0ece0');
    for (const x of [7, 12]) pc.vline(x, 2, 10, Bx[2]);
    const W = ['#9a968e', '#c8c4ba', '#e8e4dc', '#faf8f2'];
    pc.rect(20, 4, 6, 7, W[2]);
    pc.hline(20, 24, 3, W[3]);
    pc.rect(23, 5, 3, 2, MIL.glass[1]);
    pc.px(25, 5, MIL.glass[2]);
    pc.px(23, 5, RAMP.skin[3]);
    pc.vline(26, 4, 10, W[1]);
    pc.px(26, 9, '#f0e8a0');
    pc.vline(20, 5, 10, W[1]);
    pc.hline(2, 26, 11, MIL.steel[1]);
    tyre(pc, 6, 11, f);
    tyre(pc, 11, 11, f);
    tyre(pc, 22, 11, f);
    pc.outline(OUTLINE, 0.6);
    pc.shadow(14, 14, 12, 1.5, 0.25);
    add(`amb/truck/${f}`, pc, 14, 14);
  }
  // ---- hatchback, 24×16
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(24, 16);
    const R = ['#6a1e1c', '#9a2e28', '#c04038', '#dc6a5a'];
    pc.rect(2, 7, 20, 4, R[2]);
    pc.hline(3, 21, 7, R[3]);
    pc.hline(2, 21, 10, R[1]);
    pc.rect(5, 4, 10, 3, R[2]); // cabin
    pc.hline(6, 13, 3, R[3]);
    pc.line(15, 4, 17, 6, R[2]); // windscreen rake
    pc.px(16, 6, R[2]);
    pc.px(4, 5, R[2]);
    pc.px(4, 6, R[2]);
    pc.rect(6, 4, 4, 3, MIL.glass[1]);
    pc.rect(11, 4, 4, 3, MIL.glass[1]);
    pc.px(15, 5, MIL.glass[2]);
    pc.px(12, 4, RAMP.skin[3]);
    pc.px(12, 5, RAMP.skin[2]);
    pc.vline(10, 4, 9, R[1]); // door line
    pc.px(21, 8, '#f0e8a0');
    pc.px(2, 8, '#e04030');
    pc.hline(2, 21, 11, MIL.steel[1]);
    tyre(pc, 6, 11, f);
    tyre(pc, 17, 11, f);
    pc.outline(OUTLINE, 0.6);
    pc.shadow(12, 14, 10, 1.5, 0.25);
    add(`amb/car/${f}`, pc, 12, 14);
  }
  // ---- motorboat with an outboard and a foam wake
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(20, 9);
    const H = ['#8a8a88', '#c8c8c4', '#ecebe6'];
    pc.rect(3, 4, 13, 2, H[2]);
    pc.hline(3, 15, 6, H[0]);
    pc.px(16, 4, H[2]);
    pc.px(17, 4, H[1]);
    pc.px(16, 5, H[1]);
    pc.hline(3, 15, 5, '#3a5a8a'); // boot stripe
    pc.rect(8, 2, 3, 2, MIL.glass[1]); // windscreen
    pc.px(10, 2, MIL.glass[2]);
    pc.rect(6, 2, 2, 2, '#c8503a'); // driver
    pc.px(6, 1, RAMP.skin[3]);
    pc.rect(1, 3, 2, 3, MIL.grey[2]); // outboard
    pc.px(1, 3, MIL.grey[4]);
    pc.outline(OUTLINE, 0.5);
    // wake (no outline)
    const foam = '#e4f2f6';
    pc.blend(0, 6 + f, foam, 0.9);
    pc.blend(1, 7, foam, 0.8);
    pc.blend(0, 7 - f, foam, 0.6);
    pc.blend(4 + f, 7, foam, 0.55);
    pc.blend(17, 6, foam, 0.7);
    pc.blend(18, 6 - f, foam, 0.5);
    add(`amb/motorboat/${f}`, pc, 10, 6);
  }
}

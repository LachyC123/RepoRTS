import { NEUTRAL } from '../../data/constants';
import { UNITS } from '../../data/units';
import type { World } from '../../sim/World';
import { art } from './ArtRegistry';
import { drawProp, drawSapling, drawStump, drawTree, drawWindmillBlades } from './propArt';
import { buildUnitSheet, FRAME_COUNT } from './unitArt';
import { PixelCanvas, shade } from './PixelCanvas';
import { OUTLINE, RAMP } from './palette';
import type { KingdomColor } from '../../data/factions';

export const PROP_KINDS = [
  'bush', 'flowers', 'tall_grass', 'fern', 'mushrooms', 'reeds', 'rock_small', 'boulder', 'log', 'broken_cart', 'shield', 'spear', 'helmet',
  'banner_torn', 'barrel', 'crates', 'bones', 'grave', 'plague_cross', 'dead_tree', 'standing_stone', 'altar_stone', 'ruin_wall',
  'ruined_tower', 'ruined_hut', 'burned_house', 'charred', 'tent', 'campfire', 'bridge_ruin', 'windmill_base', 'ore_gold', 'ore_stone',
];

let staticBuilt = false;

/** Static (faction-independent) art: trees, props. Built once per page load. */
export function buildStaticArt() {
  if (staticBuilt) return;
  staticBuilt = true;
  for (let sp = 1; sp <= 4; sp++)
    for (let v = 0; v < 4; v++)
      for (let s = 0; s < 2; s++) {
        const t = drawTree(sp, v, s);
        art.add(`tree/${sp}/${v}/${s}`, t.pc, t.ax, t.ay);
      }
  const st = drawStump();
  art.add('stump', st.pc, st.ax, st.ay);
  const sa = drawSapling();
  art.add('sapling', sa.pc, sa.ax, sa.ay);
  for (const k of PROP_KINDS)
    for (let v = 0; v < 4; v++) {
      const p = drawProp(k, v);
      if (p) art.add(`prop/${k}/${v}`, p.pc, p.ax, p.ay);
    }
  for (let k = 0; k < 4; k++) {
    const b = drawWindmillBlades(k);
    art.add(`windmill_blades/${k}`, b.pc, b.ax, b.ay);
  }
}

/** Faction-coloured art for this match's kingdoms. */
export function buildFactionArt(world: World) {
  const neutralTypes = Object.values(UNITS).filter((u) => u.special === 'neutral');
  const kingdomTypes = Object.values(UNITS).filter((u) => u.special !== 'neutral');
  for (const f of world.factions) {
    if (!f) continue;
    const types = f.id === NEUTRAL ? [...neutralTypes, ...kingdomTypes.filter((u) => u.id === 'militia')] : kingdomTypes;
    for (const def of types) {
      const name0 = `u/${def.id}/${f.color.id}/0`;
      if (art.has(name0)) continue;
      const sheet = buildUnitSheet(def, f.color, f.id);
      sheet.frames.forEach((pc, i) => {
        const name = `u/${def.id}/${f.color.id}/${i}`;
        if (typeof pc === 'number') art.alias(name, `u/${def.id}/${f.color.id}/${pc}`);
        else art.add(name, pc, sheet.ax, sheet.ay);
      });
    }
  }
}

/** small border post with a team pennant (two wave frames) and colour-blind symbol */
function drawPost(c: KingdomColor, frame: number, symbol: boolean): PixelCanvas {
  const pc = new PixelCanvas(10, 16);
  pc.vline(2, 3, 14, RAMP.wood[2]);
  pc.vline(3, 3, 14, RAMP.wood[1]);
  pc.px(2, 2, RAMP.wood[4]);
  const wave = frame === 0 ? [0, 0, 1, 1, 0] : [0, 1, 1, 0, 0];
  for (let k = 0; k < 5; k++) {
    pc.vline(4 + k, 3 + wave[k], 5 + wave[k] - (k === 4 ? 1 : 0), k < 2 ? shade(c.main, 0.15) : c.main);
  }
  if (symbol) {
    // tiny shape mark on the post plate
    pc.rect(1, 8, 4, 4, '#e8dcc0');
    const k = c.symbol;
    if (k === 'cross') {
      pc.px(2, 9, OUTLINE);
      pc.px(3, 10, OUTLINE);
      pc.px(3, 9, OUTLINE);
      pc.px(2, 10, OUTLINE);
    } else if (k === 'diamond') {
      pc.px(2, 9, OUTLINE);
      pc.px(3, 10, OUTLINE);
    } else if (k === 'triangle') {
      pc.hline(1, 4, 11, OUTLINE);
      pc.px(2, 9, OUTLINE);
    } else pc.rect(2, 9, 2, 2, OUTLINE);
  }
  pc.outline(OUTLINE, 0.6);
  pc.shadow(4, 14.5, 3, 1, 0.25);
  return pc;
}

export function buildPostArt(world: World) {
  for (const f of world.factions) {
    if (!f || f.id === NEUTRAL) continue;
    for (let fr = 0; fr < 2; fr++)
      for (const sym of [0, 1]) {
        const name = `post/${f.color.id}/${fr}/${sym}`;
        if (art.has(name)) continue;
        art.add(name, drawPost(f.color, fr, sym === 1), 3, 14);
      }
  }
}

export function unitFrameName(type: string, colorId: string, frame: number) {
  return `u/${type}/${colorId}/${frame}`;
}

export { FRAME_COUNT };

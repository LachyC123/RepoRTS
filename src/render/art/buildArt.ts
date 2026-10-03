import { NEUTRAL } from '../../data/constants';
import { UNITS } from '../../data/units';
import type { World } from '../../sim/World';
import { art } from './ArtRegistry';
import { drawProp, drawSapling, drawStump, drawTree, drawWindmillBlades } from './propArt';
import { buildUnitSheet, FRAME_COUNT } from './unitArt';

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
      sheet.frames.forEach((pc, i) => art.add(`u/${def.id}/${f.color.id}/${i}`, pc, sheet.ax, sheet.ay));
    }
  }
}

export function unitFrameName(type: string, colorId: string, frame: number) {
  return `u/${type}/${colorId}/${frame}`;
}

export { FRAME_COUNT };

import { TILE } from '../../data/constants';
import { unitClass } from '../../data/units';
import type { Pathfinder } from '../map/Pathfinder';
import type { Unit } from './Unit';

export type FormationKind = 'line' | 'wedge' | 'defensive' | 'loose';
export const FORMATIONS: FormationKind[] = ['line', 'wedge', 'defensive', 'loose'];

export interface Slot {
  x: number;
  y: number;
}

const ORDER = { melee: 0, ranged: 1, siege: 2, cavalry: 3 } as const;

/**
 * Computes organic formation slots around a destination. Melee forms the front, ranged behind,
 * cavalry on the wings, siege at the rear. Units are assigned slots by lateral position so lines
 * don't cross each other on the way.
 */
export function computeSlots(
  units: Unit[],
  destX: number,
  destY: number,
  kind: FormationKind,
  pf: Pathfinder,
  faction: number,
  jitterSeed = 0,
): Map<number, Slot> {
  const out = new Map<number, Slot>();
  if (units.length === 0) return out;
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  let fx = destX - cx;
  let fy = destY - cy;
  const fl = Math.hypot(fx, fy);
  if (fl < 1) {
    fx = 0;
    fy = 1;
  } else {
    fx /= fl;
    fy /= fl;
  }
  // right vector
  const rx = -fy;
  const ry = fx;
  if (units.length === 1) {
    out.set(units[0].id, { x: destX, y: destY });
    return out;
  }
  const groups: Record<string, Unit[]> = { melee: [], ranged: [], siege: [], cavalry: [] };
  for (const u of units) groups[unitClass(u.def)].push(u);
  const lateral = (u: Unit) => (u.x - cx) * rx + (u.y - cy) * ry;
  for (const k in groups) groups[k].sort((a, b) => lateral(a) - lateral(b));

  const spacing = kind === 'loose' ? 18 : 11.5;
  const cavSpacing = kind === 'loose' ? 24 : 17;
  const slots: { u: Unit; f: number; r: number }[] = []; // forward/right offsets
  const infantryCount = groups.melee.length + groups.ranged.length;
  const cols = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(Math.max(1, infantryCount) * 2.2))));

  const placeRows = (list: Unit[], startRow: number, sp: number, colsN = cols): number => {
    let row = startRow;
    for (let i = 0; i < list.length; i += colsN) {
      const rowUnits = list.slice(i, i + colsN);
      const n = rowUnits.length;
      rowUnits.forEach((u, j) => {
        const r = (j - (n - 1) / 2) * sp;
        let f = -row * sp;
        if (kind === 'wedge') f -= Math.abs(j - (n - 1) / 2) * sp * 0.7;
        slots.push({ u, f, r });
      });
      row++;
    }
    return row;
  };

  if (kind === 'defensive') {
    // concentric rings: melee outside, ranged and siege inside, cavalry outermost
    const ring = (list: Unit[], radius: number) => {
      list.forEach((u, j) => {
        const a = (j / Math.max(1, list.length)) * Math.PI * 2;
        slots.push({ u, f: Math.cos(a) * radius, r: Math.sin(a) * radius });
      });
    };
    const inner = [...groups.ranged, ...groups.siege];
    const innerR = inner.length <= 1 ? 0 : Math.max(10, (inner.length * spacing) / (Math.PI * 2));
    ring(inner, innerR);
    const meleeR = Math.max(innerR + spacing * 1.2, (groups.melee.length * spacing) / (Math.PI * 2));
    ring(groups.melee, meleeR);
    ring(groups.cavalry, meleeR + cavSpacing);
  } else {
    let row = placeRows(groups.melee, 0, spacing);
    row = placeRows(groups.ranged, row, spacing);
    placeRows(groups.siege, row + 0.5, spacing * 1.6, Math.max(2, Math.ceil(cols / 2)));
    // cavalry wings
    const halfWidth = ((Math.min(cols, Math.max(1, infantryCount)) - 1) / 2) * spacing;
    const cav = groups.cavalry;
    if (infantryCount === 0) {
      placeRows(cav, 0, cavSpacing, Math.max(3, Math.ceil(Math.sqrt(cav.length * 2))));
    } else {
      cav.forEach((u, j) => {
        const side = j % 2 === 0 ? -1 : 1;
        const k = Math.floor(j / 2);
        const colInWing = k % 2;
        const rowInWing = Math.floor(k / 2);
        const r = side * (halfWidth + cavSpacing * (1 + colInWing));
        const f = -rowInWing * cavSpacing + (kind === 'wedge' ? -cavSpacing : 0);
        slots.push({ u, f, r });
      });
    }
  }

  // centre the block on the destination (front line slightly past centre)
  let minF = Infinity;
  let maxF = -Infinity;
  for (const s of slots) {
    if (s.f < minF) minF = s.f;
    if (s.f > maxF) maxF = s.f;
  }
  const shift = kind === 'defensive' ? 0 : -(minF + maxF) / 2;
  const used = new Set<number>();
  let h = jitterSeed * 9301 + 49297;
  const rnd = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280 - 0.5;
  };
  for (const s of slots) {
    const jit = kind === 'loose' ? 5 : 2;
    let x = destX + fx * (s.f + shift) + rx * s.r + rnd() * jit;
    let y = destY + fy * (s.f + shift) + ry * s.r + rnd() * jit;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const ti = pf.nearestPassable(tx, ty, faction, 6);
    if (ti >= 0) {
      const mw = pf.map.w;
      const ntx = ti % mw;
      const nty = (ti / mw) | 0;
      if (ntx !== tx || nty !== ty) {
        // snapped: place near the tile centre, spread slightly to avoid stacking
        let k = 0;
        while (used.has(ti * 4 + k) && k < 3) k++;
        used.add(ti * 4 + k);
        x = ntx * TILE + 8 + (k % 2 ? 4 : -4) * (k > 0 ? 1 : 0);
        y = nty * TILE + 8 + (k > 1 ? 4 : -2) * (k > 0 ? 1 : 0);
      }
    }
    out.set(s.u.id, { x, y });
  }
  return out;
}

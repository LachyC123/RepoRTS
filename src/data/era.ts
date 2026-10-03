import { BUILDINGS, FORTIFY } from './buildings';
import { CAPITAL_TIERS, TIERS } from './settlements';
import { UNITS } from './units';
import { UPGRADES } from './upgrades';
import { MODERN_BUILDINGS, MODERN_CAPITAL_TIERS, MODERN_FORTIFY, MODERN_TIERS, MODERN_UNITS, MODERN_UPGRADES } from './modern';
import type { ResKey } from './constants';

/**
 * Eras share one engine. Ids (unit types, building types, upgrades) are identical in every era so
 * the simulation, AI and counters work unchanged; an era only re-dresses them: names, looks,
 * weapons, ranges and a few stats. `setEra` patches the shared tables in place before a match is
 * built, restoring the medieval originals first.
 */
export type Era = 'medieval' | 'modern';

export const eraState = { era: 'medieval' as Era };

export function isModern() {
  return eraState.era === 'modern';
}

const clone = <T>(v: T): T => structuredClone(v);

// pristine medieval tables, captured once at module load
const BASE = {
  units: clone(UNITS),
  buildings: clone(BUILDINGS),
  tiers: clone(TIERS),
  capTiers: clone(CAPITAL_TIERS),
  upgrades: clone(UPGRADES),
  fortify: clone(FORTIFY),
};

function restoreRecord<T>(target: Record<string, T>, base: Record<string, T>) {
  for (const k of Object.keys(target)) delete target[k];
  for (const k of Object.keys(base)) target[k] = clone(base[k]);
}

function restoreArray<T>(target: T[], base: T[]) {
  target.length = 0;
  for (const v of base) target.push(clone(v));
}

/** shallow-merge `patch` over each named entry (nested objects in the patch replace whole fields) */
function patchRecord<T extends object>(target: Record<string, T>, patch: Record<string, Partial<T>>) {
  for (const [k, p] of Object.entries(patch)) if (target[k]) Object.assign(target[k], clone(p));
}

export function setEra(era: Era) {
  eraState.era = era;
  restoreRecord(UNITS, BASE.units);
  restoreRecord(BUILDINGS, BASE.buildings);
  restoreArray(TIERS, BASE.tiers);
  restoreRecord(CAPITAL_TIERS as Record<string, (typeof CAPITAL_TIERS)[number]>, BASE.capTiers as Record<string, (typeof CAPITAL_TIERS)[number]>);
  restoreRecord(UPGRADES, BASE.upgrades);
  restoreArray(FORTIFY, BASE.fortify);
  if (era === 'modern') {
    patchRecord(UNITS, MODERN_UNITS);
    patchRecord(BUILDINGS, MODERN_BUILDINGS);
    TIERS.forEach((t, i) => Object.assign(t, MODERN_TIERS[i] ?? {}));
    for (const [k, v] of Object.entries(MODERN_CAPITAL_TIERS)) Object.assign(CAPITAL_TIERS[Number(k)], v);
    patchRecord(UPGRADES, MODERN_UPGRADES);
    FORTIFY.forEach((f, i) => Object.assign(f, MODERN_FORTIFY[i] ?? {}));
  }
}

const RES_NAMES: Record<Era, Record<ResKey, string>> = {
  medieval: { gold: 'Gold', wood: 'Wood', food: 'Food', stone: 'Stone' },
  modern: { gold: 'Funds', wood: 'Materials', food: 'Rations', stone: 'Steel' },
};

/** display name of a resource in the current era */
export function resName(k: ResKey | string): string {
  return RES_NAMES[eraState.era][k as ResKey] ?? k;
}

/** era wording for the few words the UI uses about states */
export function word(w: 'kingdom' | 'kingdoms' | 'Kingdom' | 'Kingdoms' | 'KINGDOMS' | 'capital castle'): string {
  if (eraState.era === 'medieval') return w;
  const map: Record<string, string> = { kingdom: 'nation', kingdoms: 'nations', Kingdom: 'Nation', Kingdoms: 'Nations', KINGDOMS: 'NATIONS', 'capital castle': 'headquarters' };
  return map[w] ?? w;
}

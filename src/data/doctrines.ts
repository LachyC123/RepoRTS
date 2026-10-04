import type { Personality } from './factions';
import type { Trait } from '../sim/units/Persona';

/**
 * Whoever is in command colours everything a realm does: what it builds, what it trains, whom it
 * fights, when it runs and whether it fires the big gun. A doctrine never hard-locks a choice; it
 * re-weights the same AI the rival kingdoms use.
 */
export type DoctrineId = 'warmonger' | 'turtle' | 'tycoon' | 'tinkerer' | 'glory' | 'paranoid' | 'eccentric' | 'diplomat';

export interface Doctrine {
  id: DoctrineId;
  label: string;
  /** medieval epithet ("the Bloody") */
  epithet: string;
  /** modern nickname ("Mad Dog") */
  nick: string[];
  desc: string;
  /** multipliers on the base personality */
  mods: Partial<Record<'aggression' | 'expansion' | 'economy' | 'fortify' | 'homeGuard' | 'attackRatio' | 'retreatRatio', number>>;
  mix: Partial<Record<'melee' | 'ranged' | 'cavalry' | 'siege', number>>;
  /** extra weight for specific unit ids */
  units: Record<string, number>;
  /** extra weight for specific building ids */
  builds: Record<string, number>;
  /** research eagerness */
  research: number;
  /** how keen they are on the superweapon (0..2) */
  silo: number;
  /** war declaration eagerness / willingness to make peace */
  war: number;
  peace: number;
  /** leads attacks in person */
  leadsFromFront: boolean;
}

export const DOCTRINES: Record<DoctrineId, Doctrine> = {
  warmonger: {
    id: 'warmonger',
    label: 'Warmonger',
    epithet: 'the Bloody',
    nick: ['Mad Dog', 'Hammer', 'Bulldozer', 'Thunder'],
    desc: 'Attacks early, attacks often, attacks at bad odds. Builds barracks before houses.',
    mods: { aggression: 1.45, attackRatio: 0.8, retreatRatio: 0.75, homeGuard: 0.6, economy: 0.8 },
    mix: { melee: 1.2, cavalry: 1.3 },
    units: { flamer: 1.5, knight: 1.3, light_cavalry: 1.2 },
    builds: { barracks: 1.5, stable: 1.4, market: 0.7 },
    research: 0.8,
    silo: 1.2,
    war: 1.6,
    peace: 0.4,
    leadsFromFront: false,
  },
  turtle: {
    id: 'turtle',
    label: 'Turtle',
    epithet: 'the Careful',
    nick: ['Sandbag', 'Bunker', 'Slowpoke', 'Mole'],
    desc: 'Walls, towers and patience. Only attacks with overwhelming numbers and retreats at the first scratch.',
    mods: { aggression: 0.6, fortify: 1.7, homeGuard: 1.8, attackRatio: 1.35, retreatRatio: 1.3 },
    mix: { ranged: 1.4, siege: 1.1 },
    units: { shieldman: 1.6, crossbowman: 1.3, medic: 1.6 },
    builds: { watchtower: 2.2, chapel: 1.6, house: 1.1 },
    research: 1.2,
    silo: 0.6,
    war: 0.6,
    peace: 1.5,
    leadsFromFront: false,
  },
  tycoon: {
    id: 'tycoon',
    label: 'Tycoon',
    epithet: 'the Rich',
    nick: ['Moneybags', 'Ledger', 'Gold Tooth', 'Banker'],
    desc: 'Markets first, armies later. Grows fast, upgrades every building and buys mercenaries.',
    mods: { economy: 1.6, expansion: 1.2, aggression: 0.8, homeGuard: 0.9 },
    mix: {},
    units: {},
    builds: { market: 2.2, farm: 1.3, mine: 1.4, lumber_camp: 1.2 },
    research: 1.0,
    silo: 0.8,
    war: 0.8,
    peace: 1.3,
    leadsFromFront: false,
  },
  tinkerer: {
    id: 'tinkerer',
    label: 'Tinkerer',
    epithet: 'the Clever',
    nick: ['Professor', 'Gears', 'Sparky', 'Boffin'],
    desc: 'Loves engines, research and big guns. Will absolutely build the superweapon.',
    mods: { economy: 1.1, aggression: 0.9 },
    mix: { siege: 2.2, ranged: 1.1 },
    units: { volley: 2.2, catapult: 1.4, trebuchet: 1.6, ballista: 1.4 },
    builds: { siege_workshop: 1.8, blacksmith: 1.8, silo: 2.5 },
    research: 1.8,
    silo: 2,
    war: 1,
    peace: 1,
    leadsFromFront: false,
  },
  glory: {
    id: 'glory',
    label: 'Glory Hound',
    epithet: 'the Glorious',
    nick: ['Hero', 'Golden Boy', 'Medals', 'Spotlight'],
    desc: 'Leads every charge personally. Goes straight for enemy capitals. Poses for portraits.',
    mods: { aggression: 1.25, attackRatio: 0.9, homeGuard: 0.7 },
    mix: { cavalry: 1.6 },
    units: { knight: 1.6, bard: 1.8, veteran: 1.4 },
    builds: { stable: 1.6 },
    research: 0.9,
    silo: 1,
    war: 1.3,
    peace: 0.6,
    leadsFromFront: true,
  },
  paranoid: {
    id: 'paranoid',
    label: 'Paranoid',
    epithet: 'the Watchful',
    nick: ['Twitchy', 'Eyes', 'Shadow', 'Periscope'],
    desc: 'Sees enemies everywhere. Huge home guard, towers on every border, never trusts a truce.',
    mods: { homeGuard: 2, fortify: 1.5, aggression: 0.85, retreatRatio: 1.15 },
    mix: { ranged: 1.3 },
    units: { scout: 2, longbowman: 1.3 },
    builds: { watchtower: 2.6 },
    research: 1,
    silo: 1.5,
    war: 1.1,
    peace: 0.3,
    leadsFromFront: false,
  },
  eccentric: {
    id: 'eccentric',
    label: 'Eccentric',
    epithet: 'the Peculiar',
    nick: ['Wonky', 'Noodle', 'Biscuit', 'Captain Odd'],
    desc: 'Nobody knows what they will do next, including them. Very fond of bards.',
    mods: { aggression: 1, expansion: 1 },
    mix: {},
    units: { bard: 4, medic: 1.5, scout: 1.5 },
    builds: { chapel: 1.5, market: 1.3 },
    research: 1,
    silo: 1.3,
    war: 1.2,
    peace: 1.2,
    leadsFromFront: false,
  },
  diplomat: {
    id: 'diplomat',
    label: 'Diplomat',
    epithet: 'the Kind',
    nick: ['Handshake', 'Dove', 'Smiles', 'Tea Time'],
    desc: 'Prefers truces and trade. Defends well, rarely starts wars, and keeps the medics busy.',
    mods: { aggression: 0.55, economy: 1.25, homeGuard: 1.2 },
    mix: { ranged: 1.1 },
    units: { medic: 2.2, shieldman: 1.2 },
    builds: { market: 1.6, chapel: 1.6 },
    research: 1.1,
    silo: 0.3,
    war: 0.45,
    peace: 2,
    leadsFromFront: false,
  },
};

export const DOCTRINE_IDS = Object.keys(DOCTRINES) as DoctrineId[];

/** what kind of leader a soldier makes, by their trait */
export const TRAIT_DOCTRINE: Record<Trait, DoctrineId[]> = {
  brave: ['glory', 'warmonger'],
  coward: ['turtle', 'paranoid'],
  hothead: ['warmonger', 'glory'],
  joker: ['eccentric'],
  lazy: ['tycoon', 'turtle'],
  loyal: ['diplomat', 'turtle'],
  wanderer: ['eccentric', 'tinkerer'],
  trigger: ['warmonger', 'paranoid'],
  lucky: ['glory', 'tycoon'],
  steady: ['tycoon', 'tinkerer', 'diplomat'],
};

/** the starting doctrine of the AI houses, by their personality */
export const PERSONALITY_DOCTRINE: Record<string, DoctrineId> = {
  aggressive: 'warmonger',
  defensive: 'turtle',
  expansionist: 'tycoon',
  balanced: 'tinkerer',
};

/** apply a doctrine (and the leader's mood) to a base personality */
export function applyDoctrine(base: Personality, d: Doctrine, mood: number): Personality {
  const m = d.mods;
  const moodAgg = 1 + mood * 0.25;
  const mix = { ...base.mix };
  for (const k of Object.keys(mix) as (keyof typeof mix)[]) mix[k] *= d.mix[k] ?? 1;
  return {
    ...base,
    aggression: Math.min(1.4, base.aggression * (m.aggression ?? 1) * moodAgg),
    expansion: Math.min(1.3, base.expansion * (m.expansion ?? 1)),
    economy: Math.min(1.4, base.economy * (m.economy ?? 1)),
    fortify: Math.min(1.4, base.fortify * (m.fortify ?? 1)),
    homeGuard: base.homeGuard * (m.homeGuard ?? 1) * (mood < -0.4 ? 1.4 : 1),
    attackRatio: base.attackRatio * (m.attackRatio ?? 1) * (mood > 0.5 ? 0.9 : mood < -0.4 ? 1.15 : 1),
    retreatRatio: base.retreatRatio * (m.retreatRatio ?? 1),
    mix,
  };
}

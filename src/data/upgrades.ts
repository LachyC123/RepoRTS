import type { Cost } from './constants';
import type { UnitTag } from './units';

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: Cost;
  time: number;
  at: 'blacksmith' | 'chapel';
  tier: number;
  requires?: string;
  effect: {
    attack?: { tags: UnitTag[]; add: number };
    armor?: { tags: UnitTag[]; melee: number; pierce: number };
    range?: { tags: UnitTag[]; add: number };
    hp?: { tags: UnitTag[]; mult: number };
    morale?: number;
    heal?: number;
    speed?: { tags: UnitTag[]; mult: number };
  };
}

export const UPGRADES: Record<string, UpgradeDef> = {
  forging: {
    id: 'forging',
    name: 'Forging',
    desc: '+1 attack for infantry and cavalry.',
    cost: { gold: 120, wood: 60 },
    time: 30,
    at: 'blacksmith',
    tier: 3,
    effect: { attack: { tags: ['infantry', 'cavalry'], add: 1 } },
  },
  iron_casting: {
    id: 'iron_casting',
    name: 'Iron Casting',
    desc: '+2 more attack for infantry and cavalry.',
    cost: { gold: 260, stone: 80 },
    time: 45,
    at: 'blacksmith',
    tier: 4,
    requires: 'forging',
    effect: { attack: { tags: ['infantry', 'cavalry'], add: 2 } },
  },
  mail_armour: {
    id: 'mail_armour',
    name: 'Mail Armour',
    desc: '+1 melee and pierce armour for all soldiers.',
    cost: { gold: 140, stone: 40 },
    time: 35,
    at: 'blacksmith',
    tier: 3,
    effect: { armor: { tags: ['infantry', 'cavalry'], melee: 1, pierce: 1 } },
  },
  plate_armour: {
    id: 'plate_armour',
    name: 'Plate Armour',
    desc: '+2 melee and +1 pierce armour for all soldiers.',
    cost: { gold: 300, stone: 120 },
    time: 50,
    at: 'blacksmith',
    tier: 4,
    requires: 'mail_armour',
    effect: { armor: { tags: ['infantry', 'cavalry'], melee: 2, pierce: 1 } },
  },
  fletching: {
    id: 'fletching',
    name: 'Fletching',
    desc: '+1 attack and +1 tile range for archers and crossbowmen.',
    cost: { gold: 100, wood: 120 },
    time: 30,
    at: 'blacksmith',
    tier: 3,
    effect: { attack: { tags: ['ranged'], add: 1 }, range: { tags: ['ranged'], add: 16 } },
  },
  barding: {
    id: 'barding',
    name: 'Horse Barding',
    desc: '+20% hit points for cavalry.',
    cost: { gold: 180, food: 120 },
    time: 40,
    at: 'blacksmith',
    tier: 3,
    effect: { hp: { tags: ['cavalry'], mult: 1.2 } },
  },
  devotion: {
    id: 'devotion',
    name: 'Devotion',
    desc: 'Soldiers hold their nerve: +15 morale resilience.',
    cost: { gold: 100, food: 80 },
    time: 30,
    at: 'chapel',
    tier: 2,
    effect: { morale: 15 },
  },
  field_hospitals: {
    id: 'field_hospitals',
    name: 'Field Hospitals',
    desc: 'Troops in friendly territory slowly heal.',
    cost: { gold: 150, food: 150 },
    time: 40,
    at: 'chapel',
    tier: 2,
    effect: { heal: 1.2 },
  },
  zeal: {
    id: 'zeal',
    name: 'Zeal',
    desc: '+10% movement speed for infantry.',
    cost: { gold: 200, food: 100 },
    time: 40,
    at: 'chapel',
    tier: 3,
    requires: 'devotion',
    effect: { speed: { tags: ['infantry'], mult: 1.1 } },
  },
};

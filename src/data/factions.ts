import type { FactionId } from './constants';

export type PersonalityId = 'aggressive' | 'defensive' | 'expansionist' | 'balanced';

export interface Personality {
  id: PersonalityId;
  label: string;
  /** 0..1 biases. These are weights, never hard rules. */
  aggression: number;
  expansion: number;
  economy: number;
  fortify: number;
  /** army size relative to population cap the AI likes to keep at home */
  homeGuard: number;
  /** strength ratio at which an army is willing to commit to an attack */
  attackRatio: number;
  /** strength ratio at which an army retreats */
  retreatRatio: number;
  /** preferred unit mix weights */
  mix: { melee: number; ranged: number; cavalry: number; siege: number };
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive',
    aggression: 0.9,
    expansion: 0.55,
    economy: 0.4,
    fortify: 0.2,
    homeGuard: 0.15,
    attackRatio: 1.2,
    retreatRatio: 0.5,
    mix: { melee: 0.45, ranged: 0.2, cavalry: 0.3, siege: 0.05 },
  },
  defensive: {
    id: 'defensive',
    label: 'Defensive',
    aggression: 0.35,
    expansion: 0.45,
    economy: 0.65,
    fortify: 0.9,
    homeGuard: 0.4,
    attackRatio: 1.5,
    retreatRatio: 0.65,
    mix: { melee: 0.4, ranged: 0.4, cavalry: 0.1, siege: 0.1 },
  },
  expansionist: {
    id: 'expansionist',
    label: 'Expansionist',
    aggression: 0.55,
    expansion: 0.95,
    economy: 0.85,
    fortify: 0.35,
    homeGuard: 0.2,
    attackRatio: 1.25,
    retreatRatio: 0.55,
    mix: { melee: 0.4, ranged: 0.3, cavalry: 0.25, siege: 0.05 },
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    aggression: 0.6,
    expansion: 0.65,
    economy: 0.6,
    fortify: 0.5,
    homeGuard: 0.25,
    attackRatio: 1.25,
    retreatRatio: 0.55,
    mix: { melee: 0.4, ranged: 0.3, cavalry: 0.2, siege: 0.1 },
  },
};

export interface KingdomColor {
  id: string;
  name: string;
  /** main banner colour */
  main: string;
  light: string;
  dark: string;
  /** colourblind-friendly symbol drawn on border posts / minimap */
  symbol: 'cross' | 'diamond' | 'triangle' | 'circle';
}

export const KINGDOM_COLORS: KingdomColor[] = [
  { id: 'blue', name: 'Royal Blue', main: '#3a63c8', light: '#7fa3f0', dark: '#1d3270', symbol: 'cross' },
  { id: 'red', name: 'Crimson', main: '#c23a32', light: '#f07a64', dark: '#6b1a1a', symbol: 'diamond' },
  { id: 'green', name: 'Forest Green', main: '#3f9a3a', light: '#86d46a', dark: '#1d4d22', symbol: 'triangle' },
  { id: 'yellow', name: 'Golden Yellow', main: '#d9a527', light: '#f6dc6a', dark: '#7a5410', symbol: 'circle' },
  { id: 'purple', name: 'Royal Purple', main: '#8a4cc2', light: '#c79af0', dark: '#45215f', symbol: 'cross' },
];

export const NEUTRAL_COLOR: KingdomColor = {
  id: 'neutral',
  name: 'Neutral',
  main: '#8c7f6c',
  light: '#c9bda6',
  dark: '#4a4136',
  symbol: 'circle',
};

export type CrestId = 'lion' | 'wolf' | 'stag' | 'boar' | 'eagle' | 'tower' | 'crown' | 'rose';
export const CRESTS: CrestId[] = ['lion', 'eagle', 'tower', 'crown', 'rose', 'wolf', 'stag', 'boar'];

export interface AIHouse {
  house: string;
  kingdom: string;
  commander: string;
  commanderTitle: string;
  crest: CrestId;
  personality: PersonalityId;
  preferredColor: string;
}

/** The three rival houses. Colours are assigned at match setup from whatever the player did not take. */
export const AI_HOUSES: AIHouse[] = [
  {
    house: 'House Varn',
    kingdom: 'Varnmark',
    commander: 'Ulric',
    commanderTitle: 'The Wolf',
    crest: 'wolf',
    personality: 'aggressive',
    preferredColor: 'red',
  },
  {
    house: 'House Eldmoor',
    kingdom: 'Eldmoor',
    commander: 'Aldric',
    commanderTitle: 'The Stag',
    crest: 'stag',
    personality: 'expansionist',
    preferredColor: 'green',
  },
  {
    house: 'House Brannoc',
    kingdom: 'Brannoc',
    commander: 'Godric',
    commanderTitle: 'The Boar',
    crest: 'boar',
    personality: 'defensive',
    preferredColor: 'yellow',
  },
];

export type Difficulty = 'casual' | 'normal' | 'hard' | 'warlord';

export interface DifficultyDef {
  id: Difficulty;
  label: string;
  /** seconds between AI strategic decisions */
  thinkInterval: number;
  /** seconds between AI tactical army updates */
  tacticInterval: number;
  /** how well the AI follows its build plan (0..1); low = wasted time / suboptimal picks */
  efficiency: number;
  /** multiplier on personality aggression */
  aggression: number;
  /** AI economic multiplier. Documented: only Warlord receives a small bonus. */
  incomeBonus: number;
  /** AI focus-fire / retreat quality 0..1 */
  micro: number;
  /** how much the AI counters observed enemy composition 0..1 */
  counterPlay: number;
  /** how much AI prefers attacking the player over other AIs (1 = no preference). Kept near 1: the player is not the centre of the universe. */
  playerBias: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  casual: {
    id: 'casual',
    label: 'Casual',
    thinkInterval: 5,
    tacticInterval: 2.5,
    efficiency: 0.55,
    aggression: 0.6,
    incomeBonus: 0.85,
    micro: 0.2,
    counterPlay: 0.2,
    playerBias: 0.75,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    thinkInterval: 3,
    tacticInterval: 1.5,
    efficiency: 0.8,
    aggression: 0.9,
    incomeBonus: 1,
    micro: 0.5,
    counterPlay: 0.5,
    playerBias: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    thinkInterval: 2,
    tacticInterval: 1,
    efficiency: 0.95,
    aggression: 1.05,
    incomeBonus: 1,
    micro: 0.8,
    counterPlay: 0.8,
    playerBias: 1.05,
  },
  warlord: {
    id: 'warlord',
    label: 'Warlord',
    thinkInterval: 1.2,
    tacticInterval: 0.6,
    efficiency: 1,
    aggression: 1.2,
    incomeBonus: 1.15,
    micro: 1,
    counterPlay: 1,
    playerBias: 1.1,
  },
};

export interface FactionSetup {
  id: FactionId;
  name: string;
  house: string;
  commanderName: string;
  commanderTitle: string;
  color: string; // KingdomColor id
  crest: CrestId;
  isPlayer: boolean;
  personality: PersonalityId;
}

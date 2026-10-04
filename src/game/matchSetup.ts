import type { Era } from '../data/era';
import type { FactionId } from '../data/constants';
import { AI_HOUSES, KINGDOM_COLORS, type CrestId, type Difficulty, type FactionSetup } from '../data/factions';
import type { MatchSetup } from '../sim/World';
import type { DoctrineId } from '../data/doctrines';

export interface PlayerChoices {
  kingdomName: string;
  commanderName: string;
  color: string;
  crest: CrestId;
  difficulty: Difficulty;
  seed?: number;
  tutorial?: boolean;
  /** headless / spectator: all four kingdoms are AI */
  spectate?: boolean;
  era?: Era;
  living?: boolean;
  autoArmies?: boolean;
  sandbox?: boolean;
  /** your own leader runs the realm; you watch (and may meddle) */
  realmAuto?: boolean;
  /** your leader's style */
  doctrine?: DoctrineId | 'random';
}

export const DEFAULT_CHOICES: PlayerChoices = {
  kingdomName: 'Kingdom of Aldmere',
  commanderName: 'Edmund',
  color: 'blue',
  crest: 'lion',
  difficulty: 'normal',
  era: 'medieval',
  living: true,
  autoArmies: true,
  sandbox: false,
  realmAuto: true,
  doctrine: 'random',
};

/** Builds the four kingdoms: the player in the west, rival houses in the north, east and south. */
export function buildMatchSetup(c: PlayerChoices): MatchSetup {
  const seed = c.seed ?? Math.floor(Math.random() * 1e9);
  const used = new Set<string>([c.color]);
  const factions: FactionSetup[] = [];
  factions.push({
    id: 0,
    name: c.kingdomName.replace(/^(Kingdom|Republic) of /i, ''), // short form, like the AI kingdoms (Varnmark, Eldmoor…)
    house: 'House ' + c.kingdomName.replace(/^(Kingdom|Republic) of /i, ''),
    commanderName: c.commanderName,
    commanderTitle: c.era === 'modern' ? 'General' : 'The Crown Commander',
    color: c.color,
    crest: c.crest,
    isPlayer: !c.spectate,
    personality: 'balanced',
  });
  AI_HOUSES.forEach((h, k) => {
    let color = h.preferredColor;
    if (used.has(color)) color = KINGDOM_COLORS.find((kc) => !used.has(kc.id))!.id;
    used.add(color);
    factions.push({
      id: (k + 1) as FactionId,
      name: h.kingdom,
      house: h.house,
      commanderName: h.commander,
      commanderTitle: c.era === 'modern' ? 'General' : h.commanderTitle,
      color,
      crest: h.crest,
      isPlayer: false,
      personality: h.personality,
    });
  });
  return { seed, difficulty: c.difficulty, factions, player: c.spectate ? -1 : 0, tutorial: c.tutorial, era: c.era ?? 'medieval', living: c.living ?? true, autoArmies: c.autoArmies ?? true, sandbox: !!c.sandbox, realmAuto: !c.spectate && !!c.realmAuto, doctrine: c.doctrine ?? 'random' };
}

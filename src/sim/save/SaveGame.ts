import { AIManager } from '../ai/AIManager';
import { WorldEvents } from '../events/WorldEvents';
import { World, type MatchSetup } from '../World';
import { decodeInto, encodeWorld, SNAPSHOT_VERSION, type SnapshotData } from './Snapshot';

/** a match ready to play: world, AI kingdoms and world events */
export function createMatchWorld(setup: MatchSetup): World {
  const w = new World(setup);
  w.initMatch();
  w.ai = new AIManager(w);
  w.events2 = new WorldEvents(w);
  return w;
}

export interface SaveMeta {
  name: string;
  realm: string;
  era: string;
  time: number;
  territory: number;
  savedAt: number;
  version: number;
  /** spectating: the save has no player kingdom */
  spectate: boolean;
}

export interface SaveFile {
  meta: SaveMeta;
  setup: MatchSetup;
  world: SnapshotData;
  /** UI extras (camera etc.), opaque to the sim */
  extra?: Record<string, unknown>;
}

export function saveWorld(w: World, name: string, extra?: Record<string, unknown>): SaveFile {
  const p = w.setup.player >= 0 ? w.factions[w.setup.player] : null;
  return {
    meta: {
      name,
      realm: p?.name ?? 'Spectating',
      era: w.setup.era ?? 'medieval',
      time: w.time,
      territory: p?.territoryShare ?? 0,
      savedAt: Date.now(),
      version: SNAPSHOT_VERSION,
      spectate: w.setup.player < 0,
    },
    setup: w.setup,
    world: encodeWorld(w),
    extra,
  };
}

export function loadWorld(file: SaveFile): World {
  const w = createMatchWorld(file.setup);
  decodeInto(w, file.world);
  return w;
}

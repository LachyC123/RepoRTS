import type { FactionId } from '../data/constants';

export type NoticeKind = 'war' | 'capture' | 'lost' | 'attack' | 'build' | 'unit' | 'commander' | 'event' | 'economy' | 'diplomacy' | 'info' | 'victory' | 'defeat';

export interface Notice {
  kind: NoticeKind;
  text: string;
  /** optional sub line */
  sub?: string;
  x?: number;
  y?: number;
  /** factions this notice concerns; UI shows if player is involved or it is a major world event */
  factions?: FactionId[];
  /** importance 0..2 */
  priority?: number;
  /** if true, played as an alarm (horn + minimap flash) */
  alarm?: boolean;
  regionId?: number;
  /** don't show as a banner, only log (e.g. unit ready) */
  quiet?: boolean;
  /** world event visible to everyone */
  world?: boolean;
}

/** Events emitted by the simulation for render/audio/UI layers. Sim never reads these back. */
export interface SimEvents {
  unitSpawned: { id: number; x: number; y: number; faction: FactionId; type: string; fromBuilding?: number };
  unitDied: { id: number; x: number; y: number; faction: FactionId; type: string; killerFaction: FactionId | -1 };
  unitHit: { id: number; x: number; y: number; dmg: number; kind: 'melee' | 'pierce' | 'siege'; blocked: boolean; fromX: number; fromY: number; heavy: boolean; /** attacker unit type ('' for towers) */ by: string };
  unitAttack: { id: number; x: number; y: number; type: string; targetX: number; targetY: number };
  charge: { id: number; x: number; y: number };
  /** a unit picks an enemy soldier to fight after having none */
  unitEngaged: { id: number; x: number; y: number; faction: FactionId; tx: number; ty: number };
  unitRouted: { id: number; x: number; y: number; faction: FactionId };
  unitRallied: { id: number; x: number; y: number; faction: FactionId };
  projectileFired: { id: number; kind: string; x: number; y: number; tx: number; ty: number; faction: FactionId; /** shooter unit type ('' for towers) */ by: string };
  projectileLanded: { id: number; kind: string; x: number; y: number; hit: boolean; splash: number };
  buildingHit: { id: number; x: number; y: number; dmg: number; siege: boolean };
  buildingDestroyed: { id: number; x: number; y: number; type: string; size: number; faction: FactionId };
  buildingPlaced: { id: number; x: number; y: number; type: string; faction: FactionId };
  buildingCompleted: { id: number; x: number; y: number; type: string; faction: FactionId };
  regionCaptured: { regionId: number; from: FactionId; to: FactionId; x: number; y: number };
  captureProgress: { regionId: number; faction: FactionId; progress: number };
  settlementUpgraded: { regionId: number; tier: number; faction: FactionId };
  notice: Notice;
  treeFelled: { x: number; y: number };
  treeGrown: { x: number; y: number; i: number };
  resourceGained: { faction: FactionId; x: number; y: number; res: string; amount: number };
  stanceChanged: { a: FactionId; b: FactionId; stance: string };
  factionEliminated: { faction: FactionId; by: FactionId | -1 };
  capitalLost: { faction: FactionId; by: FactionId };
  capitalPromoted: { faction: FactionId; regionId: number };
  dominationStart: { faction: FactionId };
  dominationStop: { faction: FactionId };
  matchOver: { winner: FactionId; reason: 'domination' | 'elimination' | 'defeat' };
  worldEvent: { kind: string; x: number; y: number; regionId?: number };
  workerAction: { id: number; x: number; y: number; action: string };
  research: { faction: FactionId; id: string; x: number; y: number };
  mapChanged: { tx: number; ty: number; w: number; h: number };
  /** a named soldier says something (speech bubble) */
  unitSay: { id: number; x: number; y: number; faction: FactionId; text: string; kind: string };
  /** a line for the war journal */
  journal: { t: number; faction: FactionId; text: string; x: number; y: number; kind: string };
  /** a trigger-happy soldier fires at nothing */
  potshot: { id: number; x: number; y: number; tx: number; ty: number; kind: string };
  /** a leader thinks out loud (war-room feed) */
  leaderThought: { t: number; faction: FactionId; who: string; text: string; kind: string; x?: number; y?: number };
  /** a building starts / finishes an efficiency upgrade */
  buildingLevel: { id: number; x: number; y: number; level: number; faction: FactionId; started: boolean };
  /** superweapon */
  superLaunch: { id: number; faction: FactionId; x: number; y: number; tx: number; ty: number; kind: 'missile' | 'fireball'; flight: number };
  superWarning: { id: number; x: number; y: number; kind: 'missile' | 'fireball' };
  superImpact: { id: number; x: number; y: number; kind: 'missile' | 'fireball'; faction: FactionId; kills: number };
  siloReady: { id: number; x: number; y: number; faction: FactionId };
  /** a small world happening (goose, treasure, splash...) for the FX layer */
  happening: { kind: string; x: number; y: number; text: string; faction: FactionId | -1 };
  /** a medic patches people up */
  healPulse: { id: number; x: number; y: number; faction: FactionId };
  /** a bard or piper plays (sometimes badly) */
  music: { id: number; x: number; y: number; faction: FactionId; awful: boolean };
  /** a downed soldier is back on their feet */
  unitRevived: { id: number; x: number; y: number; faction: FactionId };
  ceasefireOffer: { from: FactionId; against: FactionId; duration: number; id: number };
}

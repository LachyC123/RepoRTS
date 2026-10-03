import type { Feature, LandmarkKind, RegionSeedDef, StoryKind } from '../../data/map_crownshire';

/** Terrain tile kinds. Plain object instead of const enum for isolatedModules builds. */
export const T = {
  GRASS: 0,
  MEADOW: 1,
  DIRT: 2,
  SAND: 3,
  WATER: 4,
  SHALLOW: 5,
  ROCK: 6,
  HILL: 7,
  FARMLAND: 8,
  ROAD: 9,
  BRIDGE: 10,
  MARSH: 11,
  FOREST: 12,
} as const;
export type TerrainKind = (typeof T)[keyof typeof T];

export interface PlotDef {
  /** top-left tile */
  x: number;
  y: number;
  size: number;
  kind: 'any' | 'resource';
  /** distance order, inner plots unlock first */
  order: number;
}

export interface Deposit {
  kind: 'gold' | 'stone';
  x: number;
  y: number;
  /** remaining units; Infinity for normal deposits, finite for event veins */
  amount: number;
  regionId: number;
  temporary?: boolean;
}

export interface RegionInfo {
  id: number;
  name: string;
  def: RegionSeedDef;
  /** settlement centre tile */
  cx: number;
  cy: number;
  /** capture point in world tiles (plaza) */
  px: number;
  py: number;
  tier: number;
  capitalSlot: number | null;
  features: Feature[];
  landmark: LandmarkKind | null;
  value: number;
  tiles: number;
  neighbors: number[];
  /** tile centroid */
  mx: number;
  my: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  coreSize: number;
  plots: PlotDef[];
  /** border tiles (indices) shared with other regions, used for border posts */
  border: number[];
}

export interface Decor {
  kind: string;
  x: number; // world px
  y: number;
  v: number; // variant
  blocks?: boolean;
}

export interface GameMap {
  id: string;
  name: string;
  w: number;
  h: number;
  seed: number;
  terrain: Uint8Array;
  height: Float32Array;
  /** 0 = none, otherwise tree species 1..4 */
  tree: Uint8Array;
  /** tree wood remaining 0..255 */
  treeHp: Uint8Array;
  /** 1 = stump (after felling) */
  stump: Uint8Array;
  /** 1 gold ore, 2 stone ore, 3 solid prop (boulder, standing stone, ruin wall) — all blocking */
  ore: Uint8Array;
  /** crop pattern for farmland 0..3 */
  crop: Uint8Array;
  region: Int16Array;
  /** building occupancy: entity id or 0 */
  occ: Int32Array;
  /** wall/gate occupancy owner faction+1 for gates (passable to owner), 0 none */
  gateOwner: Int8Array;
  regions: RegionInfo[];
  deposits: Deposit[];
  decor: Decor[];
  crossings: { x: number; y: number; kind: 'bridge' | 'ford'; name: string }[];
  /** road polylines as tile index lists (for carts/traffic) */
  roads: number[][];
  story: { kind: StoryKind; x: number; y: number }[];
  /** bumped when terrain/trees/occupancy change so caches can refresh */
  version: number;
  /** per-chunk dirty flags for the renderer (8×8 tile chunks... see CHUNK) */
  dirtyChunks: Set<number>;
}

export const CHUNK = 32; // tiles per render chunk

export function idx(map: GameMap, x: number, y: number) {
  return y * map.w + x;
}

export function inBounds(map: GameMap, x: number, y: number) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

/** static walkability (terrain + trees + ore); buildings are checked separately via occ */
export function terrainWalkable(map: GameMap, i: number): boolean {
  const t = map.terrain[i];
  if (t === T.WATER || t === T.ROCK) return false;
  if (map.tree[i] !== 0) return false;
  if (map.ore[i] !== 0) return false;
  return true;
}

export function walkable(map: GameMap, i: number): boolean {
  return terrainWalkable(map, i) && map.occ[i] === 0;
}

/** movement speed multiplier for a tile */
export function tileSpeed(map: GameMap, i: number): number {
  switch (map.terrain[i]) {
    case T.ROAD:
    case T.BRIDGE:
      return 1.2;
    case T.HILL:
      return 0.8;
    case T.SHALLOW:
      return 0.6;
    case T.MARSH:
      return 0.7;
    case T.FARMLAND:
      return 0.92;
    default:
      return 1;
  }
}

export function markDirty(map: GameMap, tx: number, ty: number) {
  const cw = Math.ceil(map.w / CHUNK);
  map.dirtyChunks.add(Math.floor(ty / CHUNK) * cw + Math.floor(tx / CHUNK));
  map.version++;
}

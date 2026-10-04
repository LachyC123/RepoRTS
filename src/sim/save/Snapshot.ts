import { EventBus } from '../../core/EventBus';
import { Random } from '../../core/Random';
import { BUILDINGS, BUILD_MENU, FORTIFY } from '../../data/buildings';
import { AI_HOUSES, CRESTS, DIFFICULTIES, KINGDOM_COLORS, NEUTRAL_COLOR, PERSONALITIES } from '../../data/factions';
import { CROWNSHIRE } from '../../data/map_crownshire';
import { CAPITAL_TIERS, CAPITAL_UPGRADE, REGION_YIELD, TIERS } from '../../data/settlements';
import { MERCENARY_UNITS, TRAINABLE_UNITS, UNITS } from '../../data/units';
import { UPGRADES } from '../../data/upgrades';
import { DOCTRINES } from '../../data/doctrines';
import { AIController } from '../ai/AIController';
import { AIManager } from '../ai/AIManager';
import { Intel } from '../ai/Intel';
import { Building } from '../buildings/Building';
import { Diplomacy } from '../Diplomacy';
import { EconomySystem } from '../economy/Economy';
import { WorkerSystem } from '../economy/Workers';
import { WorldEvents } from '../events/WorldEvents';
import { Faction } from '../Faction';
import { Visibility } from '../fog/Visibility';
import { Pathfinder } from '../map/Pathfinder';
import { RegionGraph } from '../map/RegionGraph';
import { SettlementSystem } from '../Settlements';
import { SpatialHash } from '../SpatialHash';
import { CaptureSystem } from '../territory/Capture';
import { Settlement } from '../territory/Settlement';
import { CombatSystem } from '../units/Combat';
import { LivingSystem } from '../units/Living';
import { LeaderSystem } from '../ai/Leaders';
import { SupportSystem } from '../units/Support';
import { SocialSystem } from '../units/Social';
import { Happenings } from '../events/Happenings';
import { Sky } from '../Sky';
import { SuperweaponSystem } from '../Superweapon';
import { MoraleSystem } from '../units/Morale';
import { Movement } from '../units/Movement';
import { Unit } from '../units/Unit';
import { VictorySystem } from '../Victory';
import { WallSystem } from '../Walls';
import { World } from '../World';
import { extraClasses } from './registry';

/**
 * Whole-world snapshots for save games. The simulation is plain data held in class instances, so a
 * generic graph serializer captures everything (cycles and shared references included) without
 * per-system save code:
 *
 * - Static data (unit/building/upgrade tables, colours, the map definition) is written as a
 *   reference by path and re-linked to the current tables on load.
 * - The world, its systems and the map are "anchors": on load a fresh World is built from the same
 *   setup (so every system exists and is wired up) and the saved fields are poured into it.
 * - Helper objects that are pure caches (pathfinder scratch buffers, spatial hashes, the event bus)
 *   are kept from the fresh world instead of being saved.
 */

export const SNAPSHOT_VERSION = 1;

// class registry: stable names that survive minification
const BASE_CLASSES: Record<string, { prototype: object }> = {
  World,
  VictorySystem,
  AIManager,
  Intel,
  AIController,
  WallSystem,
  Movement,
  LivingSystem,
  LeaderSystem,
  SupportSystem,
  SocialSystem,
  Happenings,
  Sky,
  SuperweaponSystem,
  MoraleSystem,
  Unit,
  CombatSystem,
  Building,
  EconomySystem,
  WorkerSystem,
  Faction,
  WorldEvents,
  CaptureSystem,
  Settlement,
  Diplomacy,
  Visibility,
  SettlementSystem,
  Random,
};
const classes = () => ({ ...BASE_CLASSES, ...extraClasses });
/** instances of these are never saved: the fresh world's own instance is kept */
const KEEP = new Set<object>([Pathfinder.prototype, RegionGraph.prototype, SpatialHash.prototype, EventBus.prototype]);
/** per-class fields that are caches, rebuilt on demand */
const TRANSIENT: Record<string, string[]> = {
  World: ['buildingHashCount', 'buildingHashVersion', 'pathQueue'],
  // plain objects: the map's render dirty flags
  '': ['dirtyChunks'],
};

const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
  Uint8ClampedArray,
};

let protoMap: Map<object, string> | null = null;
let protoCount = -1;
function protoName(o: object): string | null {
  const p = Object.getPrototypeOf(o);
  if (p === Object.prototype || p === null) return '';
  const all = classes();
  const n = Object.keys(all).length;
  if (!protoMap || protoCount !== n) {
    protoMap = new Map(Object.entries(all).map(([k, c]) => [c.prototype, k]));
    protoCount = n;
  }
  return protoMap.get(p) ?? null;
}

/** every object reachable from the static data tables, keyed by path */
function staticTable(): Map<string, object> {
  const out = new Map<string, object>();
  const seen = new Set<object>();
  const walk = (v: unknown, path: string, depth: number) => {
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || depth > 6) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.set(path, v);
    if (v instanceof Map || v instanceof Set) return;
    for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`, depth + 1);
  };
  const roots: Record<string, unknown> = {
    UNITS,
    BUILDINGS,
    UPGRADES,
    TIERS,
    CAPITAL_TIERS,
    CAPITAL_UPGRADE,
    REGION_YIELD,
    FORTIFY,
    BUILD_MENU,
    KINGDOM_COLORS,
    NEUTRAL_COLOR,
    PERSONALITIES,
    DIFFICULTIES,
    AI_HOUSES,
    CRESTS,
    CROWNSHIRE,
    DOCTRINES,
    TRAINABLE_UNITS,
    MERCENARY_UNITS,
  };
  for (const [k, v] of Object.entries(roots)) walk(v, k, 0);
  return out;
}

/** the world's anchors: objects that already exist in a freshly built world, by name */
function anchors(w: World): Map<string, object> {
  const out = new Map<string, object>();
  out.set('world', w);
  out.set('map', w.map);
  for (const [k, v] of Object.entries(w)) {
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || Array.isArray(v) || v instanceof Map || v instanceof Set) continue;
    if (k === 'setup' || k === 'map' || k === 'mapDef' || k === 'rng') continue;
    if (protoName(v) || KEEP.has(Object.getPrototypeOf(v))) out.set('w.' + k, v);
  }
  // the AI manager's per-kingdom controllers are rebuilt from the save, not anchored
  return out;
}

type Enc = unknown;
interface SnapshotData {
  v: number;
  /** flat object table */
  objs: { c: string; f?: Record<string, Enc>; a?: Enc[]; m?: [Enc, Enc][]; s?: Enc[] }[];
  /** anchor name -> object index */
  anchors: Record<string, number>;
}

export function encodeWorld(w: World): SnapshotData {
  const statics = new Map<object, string>();
  for (const [k, v] of staticTable()) statics.set(v, k);
  const anc = new Map<object, string>();
  for (const [k, v] of anchors(w)) anc.set(v, k);
  const ids = new Map<object, number>();
  const objs: SnapshotData['objs'] = [];
  const anchorIdx: Record<string, number> = {};
  const unknown = new Set<string>();

  const enc = (v: unknown): Enc => {
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return { $u: 1 };
    const o = v as object;
    const st = statics.get(o);
    if (st !== undefined) return { $s: st };
    if (KEEP.has(Object.getPrototypeOf(o))) {
      const a = anc.get(o);
      return a ? { $k: a } : { $u: 1 };
    }
    if (ArrayBuffer.isView(o)) {
      const ta = o as ArrayBufferView;
      const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
      return { $t: ta.constructor.name, d: b64(bytes) };
    }
    let id = ids.get(o);
    if (id !== undefined) return { $r: id };
    id = objs.length;
    ids.set(o, id);
    const rec: SnapshotData['objs'][number] = { c: '' };
    objs.push(rec);
    const a = anc.get(o);
    if (a) anchorIdx[a] = id;
    if (Array.isArray(o)) {
      rec.c = '[]';
      rec.a = o.map(enc);
    } else if (o instanceof Map) {
      rec.c = 'Map';
      rec.m = [...o.entries()].map(([k, x]) => [enc(k), enc(x)]);
    } else if (o instanceof Set) {
      rec.c = 'Set';
      rec.s = [...o].map(enc);
    } else {
      const name = protoName(o);
      if (name === null) {
        unknown.add(Object.getPrototypeOf(o)?.constructor?.name ?? '?');
        rec.c = '';
      } else rec.c = name;
      const skip = TRANSIENT[rec.c];
      const f: Record<string, Enc> = {};
      for (const k of Object.keys(o)) {
        if (skip?.includes(k)) continue;
        const x = (o as Record<string, unknown>)[k];
        if (typeof x === 'function') continue;
        f[k] = enc(x);
      }
      rec.f = f;
    }
    return { $r: id };
  };
  enc(w);
  // anchors that were not reached from the world root still get saved (e.g. the map)
  for (const [o] of anc) enc(o);
  if (unknown.size) throw new Error('Snapshot: unregistered classes ' + [...unknown].join(', '));
  return { v: SNAPSHOT_VERSION, objs, anchors: anchorIdx };
}

/** pour a snapshot into a freshly constructed world built from the same setup */
export function decodeInto(w: World, data: SnapshotData) {
  const statics = staticTable();
  const anc = anchors(w);
  const shells: object[] = new Array(data.objs.length);
  const isAnchor = new Set<number>();
  for (const [name, idx] of Object.entries(data.anchors)) {
    const o = anc.get(name);
    if (o) {
      shells[idx] = o;
      isAnchor.add(idx);
    }
  }
  data.objs.forEach((r, i) => {
    if (shells[i]) return;
    if (r.c === '[]') shells[i] = [];
    else if (r.c === 'Map') shells[i] = new Map();
    else if (r.c === 'Set') shells[i] = new Set();
    else {
      const cls = r.c ? classes()[r.c] : null;
      if (r.c && !cls) throw new Error('Snapshot: unknown class ' + r.c);
      shells[i] = Object.create(cls ? cls.prototype : Object.prototype);
    }
  });
  const dec = (v: Enc, into?: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    const t = v as Record<string, unknown>;
    if ('$u' in t) return undefined;
    if ('$n' in t) return t.$n === 'NaN' ? NaN : t.$n === 'Inf' ? Infinity : -Infinity;
    if ('$r' in t) return shells[t.$r as number];
    if ('$s' in t) {
      const s = statics.get(t.$s as string);
      if (!s) throw new Error('Snapshot: missing static ' + t.$s);
      return s;
    }
    if ('$k' in t) return anc.get(t.$k as string);
    if ('$t' in t) {
      const bytes = unb64(t.d as string);
      // copy in place when the fresh world already has the same buffer (others may share it)
      if (into && ArrayBuffer.isView(into) && into.constructor.name === t.$t && (into as ArrayBufferView).byteLength === bytes.byteLength) {
        new Uint8Array((into as ArrayBufferView).buffer, (into as ArrayBufferView).byteOffset, bytes.byteLength).set(bytes);
        return into;
      }
      const C = TYPED[t.$t as string];
      if (!C) throw new Error('Snapshot: unknown typed array ' + t.$t);
      return new C(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    }
    throw new Error('Snapshot: bad value');
  };
  data.objs.forEach((r, i) => {
    const o = shells[i] as Record<string, unknown>;
    if (r.c === '[]') {
      const arr = o as unknown as unknown[];
      arr.length = 0;
      for (const x of r.a!) arr.push(dec(x));
    } else if (r.c === 'Map') {
      const m = o as unknown as Map<unknown, unknown>;
      m.clear();
      for (const [k, x] of r.m!) m.set(dec(k), dec(x));
    } else if (r.c === 'Set') {
      const s = o as unknown as Set<unknown>;
      s.clear();
      for (const x of r.s!) s.add(dec(x));
    } else {
      const anchor = isAnchor.has(i);
      for (const [k, x] of Object.entries(r.f!)) {
        const cur = anchor ? o[k] : undefined;
        // anchors keep their fresh cache helpers (pathfinder, hashes, event bus)
        if (anchor && cur && typeof cur === 'object' && KEEP.has(Object.getPrototypeOf(cur))) continue;
        o[k] = dec(x, cur);
      }
    }
  });
  // caches derived from what we just restored
  const ww = w as unknown as { buildingHashCount: number; buildingHashVersion: number; pathQueue: Unit[] };
  ww.buildingHashCount = -1;
  ww.buildingHashVersion = -1;
  ww.pathQueue = []; // units still needing paths are re-queued by processPaths
  w.map.dirtyChunks.clear();
}

// ------------------------------------------------------------------ base64 helpers
function b64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type { SnapshotData };

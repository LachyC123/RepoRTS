/// <reference lib="webworker" />
import { buildFields, paintChunk, type TerrainFields } from './art/terrainArt';
import { CHUNK } from '../sim/map/GameMap';
import { TILE } from '../data/constants';
import type { GameMap } from '../sim/map/GameMap';

let map: GameMap | null = null;
let fields: TerrainFields | null = null;
const S = CHUNK * TILE;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    map = m.map as GameMap;
    fields = buildFields(map);
    (self as unknown as Worker).postMessage({ type: 'ready' });
  } else if (m.type === 'update') {
    if (!map) return;
    map.terrain = m.terrain;
    map.tree = m.tree;
    map.ore = m.ore;
    map.crop = m.crop;
    if (m.rebuildFields) fields = buildFields(map);
  } else if (m.type === 'paint') {
    if (!map || !fields) return;
    const buf = new Uint32Array(S * S);
    paintChunk(map, fields, m.cx, m.cy, buf);
    (self as unknown as Worker).postMessage({ type: 'chunk', cx: m.cx, cy: m.cy, buf, job: m.job }, [buf.buffer]);
  }
};

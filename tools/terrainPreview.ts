import { generateMap } from '../src/sim/map/MapGen';
import { CROWNSHIRE } from '../src/data/map_crownshire';
import { CHUNK } from '../src/sim/map/GameMap';
import { buildFields, paintChunk } from '../src/render/art/terrainArt';
import { TILE } from '../src/data/constants';
import { writePng } from './png';

const map = generateMap(CROWNSHIRE, 1);
let t0 = performance.now();
const f = buildFields(map);
console.log('fields ms', (performance.now() - t0).toFixed(0));
const S = CHUNK * TILE;
const cx0 = Number(process.argv[2] ?? 0);
const cy0 = Number(process.argv[3] ?? 2);
const nx = 2, ny = 2;
const W = S * nx, H = S * ny;
const img = new Uint32Array(W * H);
t0 = performance.now();
const buf = new Uint32Array(S * S);
for (let cy = 0; cy < ny; cy++)
  for (let cx = 0; cx < nx; cx++) {
    paintChunk(map, f, cx0 + cx, cy0 + cy, buf);
    for (let y = 0; y < S; y++) img.set(buf.subarray(y * S, y * S + S), (cy * S + y) * W + cx * S);
  }
console.log('chunks ms', (performance.now() - t0).toFixed(0), 'per chunk', ((performance.now() - t0) / (nx * ny)).toFixed(0));
writePng('screenshots/terrain.png', W, H, new Uint8Array(img.buffer));

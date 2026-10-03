import { generateMap } from '../src/sim/map/MapGen';
import { CROWNSHIRE } from '../src/data/map_crownshire';
import { T } from '../src/sim/map/GameMap';
import { writePng } from './png';
import { mkdirSync } from 'node:fs';

const t0 = performance.now();
const map = generateMap(CROWNSHIRE, Number(process.argv[2] ?? 1));
console.log('gen ms', (performance.now() - t0).toFixed(0));
const S = 5;
const W = map.w * S;
const H = map.h * S;
const px = new Uint8Array(W * H * 4);
const col: Record<number, [number, number, number]> = {
  [T.GRASS]: [96, 152, 64],
  [T.MEADOW]: [124, 170, 76],
  [T.DIRT]: [150, 120, 80],
  [T.SAND]: [200, 184, 130],
  [T.WATER]: [52, 96, 160],
  [T.SHALLOW]: [90, 140, 180],
  [T.ROCK]: [110, 104, 100],
  [T.HILL]: [130, 140, 90],
  [T.FARMLAND]: [190, 160, 70],
  [T.ROAD]: [176, 150, 106],
  [T.BRIDGE]: [130, 90, 50],
  [T.MARSH]: [80, 120, 90],
  [T.FOREST]: [70, 120, 50],
};
for (let ty = 0; ty < map.h; ty++)
  for (let tx = 0; tx < map.w; tx++) {
    const i = ty * map.w + tx;
    let c = col[map.terrain[i]];
    if (map.tree[i]) c = map.tree[i] === 2 ? [30, 80, 50] : [40, 96, 36];
    if (map.ore[i] === 1) c = [230, 200, 40];
    if (map.ore[i] === 2) c = [200, 200, 210];
    if (map.ore[i] === 3) c = [60, 60, 60];
    const r = map.region[i];
    const border = (tx < map.w - 1 && map.region[i + 1] !== r) || (ty < map.h - 1 && map.region[i + map.w] !== r);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const o = ((ty * S + y) * W + tx * S + x) * 4;
        let cc = c;
        if (border && (x === S - 1 || y === S - 1)) cc = [20, 20, 20];
        px[o] = cc[0];
        px[o + 1] = cc[1];
        px[o + 2] = cc[2];
        px[o + 3] = 255;
      }
  }
const rect = (x: number, y: number, w: number, h: number, c: [number, number, number]) => {
  for (let yy = y * S; yy < (y + h) * S; yy++)
    for (let xx = x * S; xx < (x + w) * S; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const edge = yy === y * S || xx === x * S || yy === (y + h) * S - 1 || xx === (x + w) * S - 1;
      if (!edge) continue;
      const o = (yy * W + xx) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
};
for (const r of map.regions) {
  const cs = r.coreSize;
  rect(r.cx - Math.floor(cs / 2), r.cy - Math.floor(cs / 2), cs, cs, r.capitalSlot !== null ? [255, 0, 255] : [255, 255, 255]);
  for (const p of r.plots) rect(p.x, p.y, p.size, p.size, [255, 120, 0]);
}
mkdirSync('screenshots', { recursive: true });
writePng('screenshots/map.png', W, H, px);
console.log('regions', map.regions.length, 'deposits', map.deposits.length, 'decor', map.decor.length);
for (const r of map.regions) if (r.plots.length < (r.tier >= 2 || r.capitalSlot !== null ? 10 : 1)) console.log('few plots', r.name, r.plots.length);
console.log('region sizes', map.regions.map((r) => `${r.name}:${r.tiles}`).join(' '));

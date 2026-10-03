/**
 * Contact sheet for procedural building art.
 *   npx tsx tools/buildingPreview.ts [groups] [out.png] [scale]
 * groups: comma list of core,castle,eco,land,misc (default: all) → screenshots/buildings.png
 *         modern = every modern-era sprite (or a subset: mcastle,mcore,meco,mmisc)
 *         silo = Great Bombard / Missile Silo in both eras: every state, idle + ready, beside barracks/siege/keep
 */
import { mkdirSync } from 'node:fs';
import { KINGDOM_COLORS } from '../src/data/factions';
import type { LandmarkKind } from '../src/data/map_crownshire';
import {
  drawBuilding,
  drawCottage,
  drawFlag,
  drawRubble,
  drawScaffold,
  drawWall,
  type BuildingSprite,
  type BuildingState,
} from '../src/render/art/buildingArt';
import { drawModernBuilding, drawModernCottage, drawModernRubble, drawModernWall } from '../src/render/art/modernBuildingArt';
import { writePng } from './png';

interface Item {
  s: BuildingSprite;
  size: number;
}
type Row = Item[];

const STATES: BuildingState[] = ['built', 'construction1', 'construction2', 'damaged', 'ruined'];
const [BLUE, RED, GREEN, YELLOW, PURPLE] = KINGDOM_COLORS;
const groups = (process.argv[2] ?? 'castle,core,eco,land,misc').split(',');
const out = process.argv[3] ?? 'screenshots/buildings.png';
const SC = Number(process.argv[4] ?? 3);
const rows: Row[] = [];

const b = (type: string, size: number, team = BLUE as (typeof KINGDOM_COLORS)[number] | null, state: BuildingState = 'built', o: Parameters<typeof drawBuilding>[4] = {}): Item => ({
  s: drawBuilding(type, size, team, state, o),
  size,
});

// ad-hoc rows: type/size/state/variant/landmark  e.g. watchtower/2/built  landmark/2/built/0/abbey
// prefix with m: for the modern era, e.g. m:barracks/3/damaged; add a /ready segment for opts.ready, e.g. m:silo/3/built/ready
const adhoc: Row = [];
for (const g of groups)
  if (g.includes('/')) {
    const modern = g.startsWith('m:');
    const segs = g.replace(/^m:/, '').split('/');
    const ready = segs.includes('ready');
    const [t, sz, st, v, lm] = segs.filter((x) => x !== 'ready');
    const o = { variant: Number(v ?? 0), landmark: (lm as LandmarkKind) ?? null, tier: 4, deposit: 'gold' as const, ...(ready ? { ready } : {}) };
    if (modern) adhoc.push({ s: drawModernBuilding(t, Number(sz ?? 2), RED, (st as BuildingState) ?? 'built', o), size: Number(sz ?? 2) });
    else adhoc.push(b(t, Number(sz ?? 2), RED, (st as BuildingState) ?? 'built', o));
  }
if (adhoc.length) rows.push(adhoc);
if (groups.includes('castle')) {
  rows.push([b('capital_castle', 5, BLUE, 'built', { tier: 3 }), b('capital_castle', 5, RED, 'built', { tier: 4 }), b('capital_castle', 4, GREEN, 'built', { tier: 3 }), b('capital_castle', 3, YELLOW, 'built', { tier: 4 })]);
  rows.push(STATES.slice(1).map((st) => b('capital_castle', 5, PURPLE, st, { tier: 4 })));
  rows.push([b('capital_castle', 4, RED, 'built', { tier: 4 }), b('capital_castle', 3, BLUE, 'built', { tier: 3 }), b('capital_castle', 4, BLUE, 'damaged', { tier: 3 }), b('capital_castle', 3, GREEN, 'ruined', { tier: 3 })]);
}
if (groups.includes('core')) {
  rows.push([...STATES.map((st) => b('keep', 4, RED, st)), b('keep', 3, GREEN)]);
  rows.push(STATES.map((st) => b('town_hall', 3, BLUE, st)));
  rows.push(STATES.map((st) => b('village_hall', 3, YELLOW, st)));
  rows.push([...STATES.map((st) => b('outpost_tower', 2, PURPLE, st)), b('watchtower', 2, RED), b('watchtower', 2, BLUE, 'damaged')]);
}
if (groups.includes('eco')) {
  const types: [string, number][] = [
    ['house', 2],
    ['farm', 2],
    ['lumber_camp', 2],
    ['mine', 2],
    ['blacksmith', 2],
    ['chapel', 2],
    ['watchtower', 2],
    ['market', 3],
    ['barracks', 3],
    ['archery_range', 3],
    ['stable', 3],
    ['siege_workshop', 3],
    ['merc_camp', 3],
    ['silo', 3],
  ];
  const teams = [BLUE, RED, GREEN, YELLOW, PURPLE];
  types.forEach(([t, s], i) => {
    const row: Row = STATES.map((st) => b(t, s, teams[i % 5], st, { deposit: 'gold' }));
    if (t === 'house') for (let v = 1; v < 4; v++) row.push(b(t, s, BLUE, 'built', { variant: v }));
    if (t === 'mine') row.push(b(t, s, RED, 'built', { deposit: 'stone' }));
    if (t === 'silo') row.push(b(t, s, RED, 'built', { ready: true }));
    if (s === 2 && t !== 'house') row.push(b(t, s, null, 'built', { variant: 1, deposit: 'stone' }));
    rows.push(row);
  });
}
if (groups.includes('land')) {
  const kinds: LandmarkKind[] = ['woodcutter', 'shrine', 'tower', 'crossroads', 'mine', 'quarry', 'ruins', 'fort', 'abbey', 'stones', 'camp', 'graveyard', 'lodge', 'plague', 'burned'];
  rows.push(kinds.slice(0, 8).map((k) => b('landmark', 2, null, 'built', { landmark: k, deposit: 'gold' })));
  rows.push(kinds.slice(8).map((k) => b('landmark', 2, null, 'built', { landmark: k })));
  rows.push([
    b('landmark', 2, RED, 'built', { landmark: 'woodcutter' }),
    b('landmark', 2, BLUE, 'built', { landmark: 'mine', deposit: 'stone' }),
    b('landmark', 2, GREEN, 'damaged', { landmark: 'abbey' }),
    b('landmark', 2, YELLOW, 'ruined', { landmark: 'lodge' }),
    b('landmark', 2, PURPLE, 'damaged', { landmark: 'tower' }),
    b('landmark', 2, null, 'construction2', { landmark: 'shrine' }),
  ]);
}
if (groups.includes('misc')) {
  const cot: Row = [];
  for (let tier = 1; tier <= 4; tier += 1) for (let v = 0; v < 4; v++) if (tier !== 2) cot.push({ s: drawCottage(v, tier >= 3 ? BLUE : null, tier), size: 1 });
  rows.push(cot);
  // wall masks: single pieces
  const walls: Row = [];
  for (const kind of ['stone', 'palisade'] as const) {
    for (const m of [0, 10, 5, 3, 6, 12, 9, 15, 11, 14]) walls.push({ s: drawWall(kind, m, false, RED, false), size: 1 });
    walls.push({ s: drawWall(kind, 10, true, RED, false), size: 1 });
    walls.push({ s: drawWall(kind, 5, true, RED, false), size: 1 });
    walls.push({ s: drawWall(kind, 10, false, RED, true), size: 1 });
  }
  rows.push(walls);
  const fl: Row = [];
  for (const t of [BLUE, RED, GREEN, YELLOW, PURPLE]) for (let f = 0; f < 4; f++) fl.push({ s: drawFlag(t, f), size: 1 });
  rows.push(fl);
  rows.push([1, 2, 3, 4].flatMap((s) => [0, 1].map((v) => ({ s: drawRubble(s, v + s), size: s }))).concat([{ s: drawScaffold(2, 0.3), size: 2 }, { s: drawScaffold(3, 1), size: 3 }]));
}

// ---------------------------------------------------------------- modern era
const mg = (g: string) => groups.includes('modern') || groups.includes(g);
const mb = (type: string, size: number, team = BLUE as (typeof KINGDOM_COLORS)[number] | null, state: BuildingState = 'built', o: Parameters<typeof drawBuilding>[4] = {}): Item => ({
  s: drawModernBuilding(type, size, team, state, o),
  size,
});
if (mg('mcastle')) {
  rows.push([mb('capital_castle', 5, BLUE, 'built', { tier: 3 }), mb('capital_castle', 5, RED, 'built', { tier: 4 }), mb('capital_castle', 4, GREEN, 'built', { tier: 3 }), mb('capital_castle', 3, YELLOW, 'built', { tier: 4 })]);
  rows.push(STATES.slice(1).map((st) => mb('capital_castle', 5, PURPLE, st, { tier: 4 })));
  rows.push([mb('capital_castle', 4, RED, 'built', { tier: 4 }), mb('capital_castle', 3, BLUE, 'built', { tier: 3 }), mb('capital_castle', 4, BLUE, 'damaged', { tier: 3 }), mb('capital_castle', 3, GREEN, 'ruined', { tier: 3 })]);
}
if (mg('mcore')) {
  rows.push([...STATES.map((st) => mb('keep', 4, RED, st)), mb('keep', 3, GREEN)]);
  rows.push(STATES.map((st) => mb('town_hall', 3, BLUE, st)));
  rows.push(STATES.map((st) => mb('village_hall', 3, YELLOW, st)));
  rows.push([...STATES.map((st) => mb('outpost_tower', 2, PURPLE, st)), mb('watchtower', 2, RED), mb('watchtower', 2, BLUE, 'damaged'), mb('landmark', 2, null, 'built', { landmark: 'abbey' })]);
}
if (mg('meco')) {
  const types: [string, number][] = [
    ['house', 2],
    ['farm', 2],
    ['lumber_camp', 2],
    ['mine', 2],
    ['blacksmith', 2],
    ['chapel', 2],
    ['watchtower', 2],
    ['market', 3],
    ['barracks', 3],
    ['archery_range', 3],
    ['stable', 3],
    ['siege_workshop', 3],
    ['merc_camp', 3],
    ['silo', 3],
  ];
  const teams = [BLUE, RED, GREEN, YELLOW, PURPLE];
  types.forEach(([t, s], i) => {
    const row: Row = STATES.map((st) => mb(t, s, teams[i % 5], st, { deposit: 'gold' }));
    if (t === 'house') for (let v = 1; v < 4; v++) row.push(mb(t, s, BLUE, 'built', { variant: v }));
    if (t === 'mine') row.push(mb(t, s, RED, 'built', { deposit: 'stone' }));
    if (t === 'silo') row.push(mb(t, s, RED, 'built', { ready: true }));
    if (s === 2 && t !== 'house') row.push(mb(t, s, null, 'built', { variant: 1, deposit: 'stone' }));
    rows.push(row);
  });
}
if (mg('mmisc')) {
  const cot: Row = [];
  for (let tier = 1; tier <= 4; tier += 1) for (let v = 0; v < 4; v++) if (tier !== 2) cot.push({ s: drawModernCottage(v, tier >= 3 ? BLUE : null, tier), size: 1 });
  rows.push(cot);
  const walls: Row = [];
  for (const kind of ['concrete', 'sandbag'] as const) {
    for (const m of [0, 10, 5, 3, 6, 12, 9, 15, 11, 14]) walls.push({ s: drawModernWall(kind, m, false, RED, false), size: 1 });
    walls.push({ s: drawModernWall(kind, 10, true, RED, false), size: 1 });
    walls.push({ s: drawModernWall(kind, 5, true, RED, false), size: 1 });
    walls.push({ s: drawModernWall(kind, 10, false, RED, true), size: 1 });
  }
  rows.push(walls);
  rows.push([1, 2, 3, 4].flatMap((s) => [0, 1].map((v) => ({ s: drawModernRubble(s, v + s), size: s }))).concat([mb('wall', 1, RED), mb('gatehouse', 1, RED), mb('gatehouse', 1, GREEN, 'damaged')]));
}

// ---------------------------------------------------------------- superweapon (silo): both eras
if (groups.includes('silo')) {
  for (const [draw, teamA, teamB] of [
    [b, BLUE, RED],
    [mb, GREEN, YELLOW],
  ] as const) {
    rows.push(STATES.map((st) => draw('silo', 3, teamA, st)));
    rows.push(STATES.map((st) => draw('silo', 3, teamB, st, { ready: true })));
    rows.push([draw('barracks', 3, teamA), draw('siege_workshop', 3, teamA), draw('silo', 3, teamA), draw('silo', 3, null, 'built', { ready: true }), draw('keep', 4, teamA)]);
  }
}

// ---------------------------------------------------------------- wall ring demo (composited on the grid)
interface Placed {
  s: BuildingSprite;
  gx: number; // footprint left px
  gy: number; // ground line px
}
const placed: Placed[] = [];
let cursorY = 16;
let maxW = 0;
for (const row of rows) {
  const above = Math.max(...row.map((it) => it.s.ay));
  const groundY = Math.ceil((cursorY + above) / 16) * 16;
  let x = 16;
  for (const it of row) {
    placed.push({ s: it.s, gx: x, gy: groundY });
    x += Math.ceil((it.size * 16 + 10) / 16) * 16;
  }
  maxW = Math.max(maxW, x);
  cursorY = groundY + 12;
}
// a closed ring of walls with a gate, laid out on tiles
if (groups.includes('misc')) {
  const ring = (kind: 'stone' | 'palisade', ox: number, oy: number) => {
    const n = 5;
    const items: { tx: number; ty: number; m: number; g: boolean }[] = [];
    const isWall = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < n && ty < n && (tx === 0 || ty === 0 || tx === n - 1 || ty === n - 1);
    for (let ty = 0; ty < n; ty++)
      for (let tx = 0; tx < n; tx++) {
        if (!isWall(tx, ty)) continue;
        const m = (isWall(tx, ty - 1) ? 1 : 0) | (isWall(tx + 1, ty) ? 2 : 0) | (isWall(tx, ty + 1) ? 4 : 0) | (isWall(tx - 1, ty) ? 8 : 0);
        items.push({ tx, ty, m, g: (ty === n - 1 && tx === 2) || (tx === n - 1 && ty === 2) });
      }
    for (const it of items) {
      const s = drawWall(kind, it.m, it.g, GREEN, kind === 'palisade' && it.tx === 0 && it.ty === 2);
      placed.push({ s, gx: ox + it.tx * 16, gy: oy + (it.ty + 1) * 16 });
    }
  };
  const oy = Math.ceil((cursorY + 30) / 16) * 16;
  ring('stone', 16, oy);
  ring('palisade', 16 + 7 * 16, oy);
  // a castle surrounded by a few cottages for scale
  cursorY = oy + 6 * 16;
  maxW = Math.max(maxW, 16 + 14 * 16);
}

if (mg('mmisc')) {
  const ringM = (kind: 'concrete' | 'sandbag', ox: number, oy: number) => {
    const n = 5;
    const isWall = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < n && ty < n && (tx === 0 || ty === 0 || tx === n - 1 || ty === n - 1);
    for (let ty = 0; ty < n; ty++)
      for (let tx = 0; tx < n; tx++) {
        if (!isWall(tx, ty)) continue;
        const m = (isWall(tx, ty - 1) ? 1 : 0) | (isWall(tx + 1, ty) ? 2 : 0) | (isWall(tx, ty + 1) ? 4 : 0) | (isWall(tx - 1, ty) ? 8 : 0);
        const g = (ty === n - 1 && tx === 2) || (tx === n - 1 && ty === 2);
        placed.push({ s: drawModernWall(kind, m, g, GREEN, kind === 'sandbag' && tx === 0 && ty === 2), gx: ox + tx * 16, gy: oy + (ty + 1) * 16 });
      }
    // a few modern cottages inside for scale
    placed.push({ s: drawModernCottage(ox + oy, GREEN, 3), gx: ox + 32, gy: oy + 48 });
  };
  const oy = Math.ceil((cursorY + 30) / 16) * 16;
  ringM('concrete', 16, oy);
  ringM('sandbag', 16 + 7 * 16, oy);
  cursorY = oy + 6 * 16;
  maxW = Math.max(maxW, 16 + 14 * 16);
}

const Wd = Math.max(maxW, 320);
const H = Math.ceil((cursorY + 16) / 16) * 16;
const img = new Uint32Array(Wd * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < Wd; x++) {
    const grid = x % 16 === 0 || y % 16 === 0;
    const n = ((x * 7 + y * 13) % 11) / 11;
    const g = grid ? [0x46, 0x7a, 0x34] : n > 0.85 ? [0x52, 0x8c, 0x3c] : [0x4f, 0x8a, 0x3a];
    img[y * Wd + x] = (255 << 24) | (g[2] << 16) | (g[1] << 8) | g[0];
  }
// draw in y order so overlapping rows look right
placed.sort((a, b2) => a.gy - b2.gy);
for (const pl of placed) {
  const { pc, ax, ay } = pl.s;
  const size = Math.round((pc.w - 6) / 16);
  const ox = pl.gx - (ax - size * 8);
  const oy = pl.gy - ay;
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w; x++) {
      const v = pc.data[y * pc.w + x];
      const a = (v >>> 24) / 255;
      if (!a) continue;
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= Wd || ty >= H) continue;
      const i = ty * Wd + tx;
      if (a >= 0.99) img[i] = v;
      else {
        const d = img[i];
        const m = (sh: number) => Math.round(((d >>> sh) & 255) * (1 - a) + ((v >>> sh) & 255) * a);
        img[i] = (255 << 24) | (m(16) << 16) | (m(8) << 8) | m(0);
      }
    }
}
const OW = Wd * SC;
const OH = H * SC;
const big = new Uint32Array(OW * OH);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) big[y * OW + x] = img[Math.floor(y / SC) * Wd + Math.floor(x / SC)];
mkdirSync('screenshots', { recursive: true });
writePng(out, OW, OH, new Uint8Array(big.buffer));
console.log(out, OW, OH);

import { UNITS } from '../src/data/units';
import { KINGDOM_COLORS } from '../src/data/factions';
import { buildUnitSheet, sheetFrame } from '../src/render/art/unitArt';
import { writePng } from './png';

const types = (process.argv[2] ? process.argv[2].split(',') : Object.keys(UNITS));
const SC = Number(process.env.SC ?? 3);
const rows: { frames: Uint32Array[]; w: number; h: number }[] = [];
let maxW = 0;
for (const t of types) {
  const sheet = buildUnitSheet(UNITS[t], KINGDOM_COLORS[t.length % 4], 0);
    const from = Number(process.env.FROM ?? 0);
  const to = Number(process.env.TO ?? sheet.frames.length);
  rows.push({ frames: sheet.frames.slice(from, to).map((_, i) => sheetFrame(sheet, i + from).data), w: sheet.w, h: sheet.h });
  maxW = Math.max(maxW, sheet.w * rows[rows.length - 1].frames.length);
}
const W = maxW * SC;
const H = rows.reduce((a, r) => a + r.h, 0) * SC;
const out = new Uint32Array(W * H);
out.fill(0xff5a8a4a);
let oy = 0;
for (const r of rows) {
  r.frames.forEach((fd, k) => {
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const v = fd[y * r.w + x];
        if (!(v >>> 24)) continue;
        const a = (v >>> 24) / 255;
        for (let sy = 0; sy < SC; sy++)
          for (let sx = 0; sx < SC; sx++) {
            const i = (oy + y) * SC * W + sy * W + (k * r.w + x) * SC + sx;
            if (a >= 0.99) out[i] = v;
            else {
              const d = out[i];
              const mixc = (sh: number) => Math.round(((d >>> sh) & 255) * (1 - a) + ((v >>> sh) & 255) * a);
              out[i] = (255 << 24) | (mixc(16) << 16) | (mixc(8) << 8) | mixc(0);
            }
          }
      }
  });
  oy += r.h;
}
writePng(process.env.OUT ?? 'screenshots/units.png', W, H, new Uint8Array(out.buffer));
console.log(W, H);

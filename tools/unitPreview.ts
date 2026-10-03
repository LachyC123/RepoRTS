import { UNITS, type UnitDef, type UnitLook } from '../src/data/units';
import { KINGDOM_COLORS } from '../src/data/factions';
import { buildUnitSheet, sheetFrame } from '../src/render/art/unitArt';
import { setEra } from '../src/data/era';
import { writePng } from './png';

/**
 * Contact sheet of unit animation frames (one row per unit, frames left → right).
 *   npx tsx tools/unitPreview.ts [ids|modern|modern:inf|modern:veh|modern:eng|new|new:med|new:mod,...]
 * Env: SC (scale, default 3), FROM / TO (frame range), OUT (png path), TEAM (0..4 kingdom colour index).
 * `modern*` entries render built-in test looks on a cloned UnitDef, so looks can be previewed before
 * any UnitDef exists for them. `new*` entries render the support / new-arms troops (friar, bard,
 * firebrand, volley gun) from the real tables: `new:med` medieval, `new:mod` modern (via setEra), `new` both;
 * `mod:<id>` renders any unit id as its modern-era version.
 */
const base = UNITS.militia;
const M = (id: string, look: UnitLook, extra: Partial<UnitDef> = {}): UnitDef => ({ ...base, id, look, ...extra });
const S = { shield: 'none' } as const;
const MODERN_INF: UnitDef[] = [
  M('m_conscript', { body: 'soldier', helmet: 'patrol', armor: 'fatigues', weapon: 'rifle', ...S }),
  M('m_rifleman', { body: 'soldier', helmet: 'combat', armor: 'vest', weapon: 'rifle', ...S }),
  M('m_at', { body: 'soldier', helmet: 'combat', armor: 'vest', weapon: 'rocket', ...S, backpack: true }),
  M('m_shield', { body: 'heavy', helmet: 'combat', armor: 'vest', weapon: 'smg', shield: 'riot' }),
  M('m_mg', { body: 'heavy', helmet: 'combat', armor: 'fatigues', weapon: 'mg', ...S }),
  M('m_grenadier', { body: 'soldier', helmet: 'combat', armor: 'vest', weapon: 'grenadier', ...S }),
  M('m_recon', { body: 'soldier', helmet: 'boonie', armor: 'fatigues', weapon: 'smg', ...S, backpack: true }),
  M('m_sniper', { body: 'soldier', helmet: 'boonie', armor: 'ghillie', weapon: 'sniper', ...S }),
  M('m_commando', { body: 'heavy', helmet: 'beret', armor: 'vest', weapon: 'smg', ...S }),
  M('m_engineer', { body: 'soldier', helmet: 'hardhat', armor: 'vest', weapon: 'satchel', ...S }),
  M('m_officer', { body: 'soldier', helmet: 'officer', armor: 'fatigues', weapon: 'pistol', ...S }),
  M('m_raider', { body: 'peasant', helmet: 'bandana', armor: 'jacket', weapon: 'rifle', ...S, cloth: '#6a4a32' }),
  M('m_contractor', { body: 'soldier', helmet: 'cap', armor: 'vest', weapon: 'shotgun', ...S, beard: true }),
  M('m_worker', { body: 'peasant', helmet: 'hardhat', armor: 'jacket', weapon: 'chainsaw', ...S, cloth: '#8a3a2a' }, { special: 'worker' }),
];
const V = (v: NonNullable<UnitLook['vehicle']>) => M('m_' + v, { body: 'vehicle', helmet: 'none', armor: 'tunic', weapon: 'none', ...S, vehicle: v });
const MODERN_VEH: UnitDef[] = [V('jeep'), V('tank'), V('technical'), V('command'), V('truck')];
const E = (e: NonNullable<UnitLook['engine']>, extra: Partial<UnitDef> = {}) => M('m_' + e, { body: 'engine', helmet: 'none', armor: 'tunic', weapon: 'none', ...S, engine: e }, extra);
const MODERN_ENG: UnitDef[] = [E('mortar'), E('atgun'), E('howitzer', { deploy: 5 })];

const NEW_IDS = ['medic', 'bard', 'flamer', 'volley'];
const eraDefs = (era: 'medieval' | 'modern', ids = NEW_IDS): UnitDef[] => {
  setEra(era);
  const out = ids.filter((id) => UNITS[id]).map((id) => structuredClone(UNITS[id]));
  setEra('medieval');
  return out;
};
const NEW_MED = eraDefs('medieval');
const NEW_MOD = eraDefs('modern');

const args = process.argv[2] ? process.argv[2].split(',') : Object.keys(UNITS);
const defs: UnitDef[] = args.flatMap((a) =>
  a === 'modern'
    ? [...MODERN_INF, ...MODERN_VEH, ...MODERN_ENG]
    : a === 'modern:inf'
      ? MODERN_INF
      : a === 'modern:veh'
        ? MODERN_VEH
        : a === 'modern:eng'
          ? MODERN_ENG
          : a === 'new'
            ? [...NEW_MED, ...NEW_MOD]
            : a === 'new:med'
              ? NEW_MED
              : a === 'new:mod'
                ? NEW_MOD
                : a.startsWith('mod:')
                  ? eraDefs('modern', [a.slice(4)])
                  : [UNITS[a] ?? [...MODERN_INF, ...MODERN_VEH, ...MODERN_ENG].find((d) => d.id === a)!],
);
const SC = Number(process.env.SC ?? 3);
const rows: { frames: Uint32Array[]; w: number; h: number }[] = [];
let maxW = 0;
for (const def of defs) {
  const kc = KINGDOM_COLORS[process.env.TEAM !== undefined ? Number(process.env.TEAM) : def.id.length % 4];
  const sheet = buildUnitSheet(def, kc, 0);
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

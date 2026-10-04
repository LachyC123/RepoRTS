import { RES_KEYS, type Cost } from '../../data/constants';
import { UNITS, unitClass, type UnitDef } from '../../data/units';
import type { AIController } from './AIController';

/**
 * AI recruitment: keeps military buildings busy while leaving a reserve for planned investments,
 * shapes composition by personality, and counters what it has seen the enemy field.
 */
export function aiMilitary(ai: AIController) {
  const w = ai.w;
  const me = ai.id;
  const f = ai.f;
  const sys = w.settlementSys;
  const tmin = w.time / 60;
  const reserve: Cost = ai.savingFor ? (JSON.parse(ai.savingFor) as Cost) : {};
  // early game: keep a little back for the first economy buildings
  if (tmin < 2.5) {
    reserve.wood = Math.max(reserve.wood ?? 0, 60);
  }
  const units = ai.myUnits();
  // a kingdom under attack, or with an army below its floor, recruits before it saves
  const floor = Math.min(40, 6 + tmin * 1.6);
  const attacked = ai.owned().some((s) => w.time - s.lastAttackedT < 10);
  // saving for the superweapon: only a threat to the capital itself breaks the piggy bank
  const bigSave = !!ai.savingFor && ai.saveKey.endsWith('silo');
  const cap = ai.capital();
  const capAttacked = !!cap && w.time - cap.lastAttackedT < 10;
  const urgent = bigSave ? capAttacked || units.length < floor * 0.5 : attacked || (units.length < floor && !ai.savingEcon);
  const affordable = (c: Cost) => RES_KEYS.every((k) => (c[k] ?? 0) + (urgent ? 0 : reserve[k] ?? 0) <= f.res[k]);
  const byClass = { melee: 0, ranged: 0, cavalry: 0, siege: 0 };
  for (const u of units) byClass[unitClass(u.def)]++;
  const total = Math.max(1, units.length);
  // what have we seen from enemies?
  const seen = { melee: 0, ranged: 0, cavalry: 0, siege: 0 };
  for (let k = 0; k < 4; k++) {
    if (k === me || !w.factions[k] || !w.isHostile(me, k as never)) continue;
    for (const c of Object.keys(seen) as (keyof typeof seen)[]) seen[c] += ai.intel.comp[k][c] ?? 0;
  }
  const seenTotal = Math.max(1, seen.melee + seen.ranged + seen.cavalry + seen.siege);
  const cp = ai.diff.counterPlay;
  const mix = { ...ai.pers.mix };
  if (tmin < 6) mix.siege = 0;
  const threatened = ai.owned().some((s) => w.time - s.lastAttackedT < 10);
  const scouts = units.filter((u) => u.def.id === 'scout').length;
  const atWar = [0, 1, 2, 3].some((k) => k !== me && w.factions[k]?.alive && w.diplomacy.stance(me, k as never) === 'war');
  const wantSiege = tmin > 6 && atWar && byClass.siege < (ai.aggression > 0.6 ? 4 : 3);

  const doc = ai.doctrine;
  const healers = units.filter((u) => u.def.healer).length;
  const singers = units.filter((u) => u.def.inspire).length;
  const weightFor = (d: UnitDef): number => {
    const cls = unitClass(d);
    let wgt = mix[cls] + 0.05;
    // fill under-represented classes
    wgt *= 1 + Math.max(0, mix[cls] - byClass[cls] / total) * 2;
    // counters
    if (d.tags.includes('spear')) wgt *= 1 + (seen.cavalry / seenTotal) * 3 * cp;
    if (d.id === 'shieldman') wgt *= 1 + (seen.ranged / seenTotal) * 2.5 * cp;
    if (d.id === 'crossbowman' || d.id === 'longbowman') wgt *= 1 + (seen.melee / seenTotal) * 1.5 * cp;
    if (cls === 'cavalry') wgt *= 1 + ((seen.ranged + seen.siege) / seenTotal) * 2 * cp;
    if (d.id === 'ballista') wgt *= 1 + (seen.siege / seenTotal) * 3 * cp;
    if (cls === 'siege') wgt = wantSiege ? 3 : 0;
    // prefer stronger units when the economy allows
    wgt *= 1 + d.tier * 0.25;
    if (d.id === 'militia') wgt *= tmin < 3 ? 2.5 : threatened ? 0.45 : 0.12;
    if (d.id === 'scout') wgt = scouts < (ai.aggression > 0.7 ? 2 : 1) && tmin > 0.3 ? 4 : 0;
    // support troops: a medic per ~8 soldiers (more useful when the wounded can be saved), a musician per ~12
    if (d.healer) wgt = total > 6 && healers < total / (w.living ? 9 : 14) ? 0.6 : 0.02;
    if (d.inspire) wgt = total > 10 && singers < total / 16 ? 0.2 : 0.01;
    if (d.incendiary) wgt *= 1 + (seen.melee / seenTotal) * 1.5 * cp;
    // whoever is in command has favourites
    if (doc) wgt *= doc.units[d.id] ?? 1;
    wgt *= w.leaders.quirkMul(me, 'units', d.id);
    // a desperate leader conscripts whoever is cheapest
    if (d.id === 'militia' && (ai.f.leader?.mood ?? 0) < -0.7 && attacked) wgt *= 3;
    return wgt;
  };

  const producers = w.buildings.filter((b) => b.faction === me && b.active && (b.def.category === 'military' || b.def.category === 'core'));
  // once real training halls stand, town halls only raise militia in an emergency
  const halls = producers.filter((b) => b.def.category === 'military' && b.def.id !== 'silo').length;
  for (const b of producers) {
    if (b.def.category === 'core' && halls > 0 && tmin > 4 && w.time - w.settlements[b.settlementId].lastAttackedT > 15) continue;
    const maxQ = ai.diff.efficiency > 0.9 ? 2 : 1;
    if (b.queue.length >= maxQ) continue;
    if (f.pop >= f.popCap) break;
    const opts = sys.trainableAt(b).map((id) => UNITS[id]);
    if (!opts.length) continue;
    // cores mainly make militia early and scouts
    const cands = opts
      .filter((d) => affordable(d.cost) && f.pop + d.pop <= f.popCap)
      .map((d) => ({ d, wgt: weightFor(d) }))
      .filter((x) => x.wgt > 0.05);
    if (!cands.length) continue;
    const sum = cands.reduce((a, c) => a + c.wgt, 0);
    let r = ai.w.rng.next() * sum;
    let pick = cands[0].d;
    for (const c of cands) {
      r -= c.wgt;
      if (r <= 0) {
        pick = c.d;
        break;
      }
    }
    sys.recruit(me, b.id, pick.id);
  }
}

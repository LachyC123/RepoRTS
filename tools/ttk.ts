/** time-to-kill benchmark: npx tsx tools/ttk.ts [era] — small even fights in open ground */
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { World } from '../src/sim/World';
const era = (process.argv[2] as 'medieval' | 'modern') ?? 'medieval';
const pairs: [string, string][] = [
  ['militia', 'militia'],
  ['swordsman', 'swordsman'],
  ['archer', 'archer'],
  ['archer', 'swordsman'],
  ['spearman', 'light_cavalry'],
  ['crossbowman', 'shieldman'],
];
for (const [a, b] of pairs) {
  const w = new World(buildMatchSetup({ ...DEFAULT_CHOICES, seed: 7, spectate: true, era }));
  w.initMatch();
  w.diplomacy.declareWar(0, 1);
  const cap = w.settlements[w.factions[2].capitalSettlement];
  const cx = cap.px, cy = cap.py + 120;
  for (const u of [...w.units]) if (Math.hypot(u.x - cx, u.y - cy) < 400) w.despawn(u);
  const A: number[] = [], B: number[] = [];
  for (let k = 0; k < 6; k++) A.push(w.spawnUnit(a, 0, cx - 60, cy - 30 + k * 12).id);
  for (let k = 0; k < 6; k++) B.push(w.spawnUnit(b, 1, cx + 60, cy - 30 + k * 12).id);
  w.orderMove(A, cx + 60, cy, { attackMove: true });
  w.orderMove(B, cx - 60, cy, { attackMove: true });
  let first = -1, t = 0;
  const alive = (ids: number[]) => ids.filter((id) => w.unitById.get(id)?.alive).length;
  while (t < 180) {
    w.step();
    t += 1 / 30;
    const n = alive(A) + alive(B);
    if (first < 0 && n < 12) first = t;
    if (!alive(A) || !alive(B)) break;
  }
  console.log(era, `${a} vs ${b}`.padEnd(30), 'first death', first.toFixed(1) + 's', 'decided', t.toFixed(1) + 's', `left ${alive(A)}:${alive(B)}`);
}

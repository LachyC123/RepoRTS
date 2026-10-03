import { World } from '../src/sim/World';
import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { NEUTRAL } from '../src/data/constants';

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 5);
const withAI = process.argv[4] !== 'noai';
const setup = buildMatchSetup({ ...DEFAULT_CHOICES, seed, spectate: true, difficulty: (process.argv[5] as never) ?? 'normal' });
const w = new World(setup);
w.initMatch();
if (withAI) {
  const mod = await import('../src/sim/ai/AIManager');
  w.ai = new mod.AIManager(w);
}
try {
  const ev = await import('../src/sim/events/WorldEvents' as string);
  w.events2 = new ev.WorldEvents(w);
} catch {
  /* optional */
}
const notices: string[] = [];
w.events.on('notice', (n) => notices.push(`[${fmt(w.time)}] ${n.text}${n.sub ? ' — ' + n.sub : ''}`));
function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
const t0 = performance.now();
let lastReport = 0;
const steps = minutes * 60 * 30;
for (let i = 0; i < steps && !w.over; i++) {
  w.step();
  if (w.time - lastReport >= 60) {
    lastReport = w.time;
    const line = w.factions
      .filter((f) => f && f.id !== NEUTRAL)
      .map((f) => {
        const army = w.units.filter((u) => u.alive && u.faction === f.id && u.def.special !== 'worker').length;
        return `${f.name.slice(0, 8)}: reg ${f.regionsOwned} army ${army} pop ${f.pop}/${f.popCap} g${f.res.gold | 0} w${f.res.wood | 0} f${f.res.food | 0} s${f.res.stone | 0} inc g${f.income.gold | 0} w${f.income.wood | 0} f${f.income.food | 0}${f.alive ? '' : ' DEAD'}`;
      })
      .join(' | ');
    console.log(fmt(w.time), line);
    if (process.env.AIDEBUG && w.ai) {
      for (const [id, c] of (w.ai as unknown as { controllers: Map<number, { debug: unknown }> }).controllers) console.log('   ', w.factions[id].name.slice(0, 8), JSON.stringify(c.debug));
    }
  }
}
const ms = performance.now() - t0;
console.log(`\nsimulated ${fmt(w.time)} in ${(ms / 1000).toFixed(1)}s (${((w.time * 1000) / ms).toFixed(0)}x realtime), units ${w.units.length}, buildings ${w.buildings.length}, paths ${w.pathfinder.requests}`);
if (w.over) console.log('MATCH OVER winner', w.winner, w.endReason);
for (const f of w.factions) {
  if (!f || f.id === NEUTRAL) continue;
  const tiers: Record<string, number> = {};
  for (const s of w.settlements) if (s.owner === f.id) tiers[s.tier] = (tiers[s.tier] ?? 0) + 1;
  console.log(`${f.name}: ${f.alive ? 'alive' : 'dead'} tiers ${JSON.stringify(tiers)} trained ${f.stats.unitsTrained} lost ${f.stats.unitsLost}`);
}
console.log('\n' + notices.slice(-60).join('\n'));

import { buildMatchSetup, DEFAULT_CHOICES } from '../src/game/matchSetup';
import { createMatchWorld } from '../src/sim/save/SaveGame';
const seed = Number(process.argv[2] ?? 1);
const w = createMatchWorld(buildMatchSetup({ ...DEFAULT_CHOICES, seed, spectate: true }));
const econ: Record<string, number> = {};
let launches = 0;
w.events.on('superLaunch', (e) => { launches++; console.log('LAUNCH', (w.time / 60).toFixed(1), w.factions[e.faction].name); });
w.events.on('superImpact', (e) => console.log('IMPACT kills', e.kills));
for (let i = 0; i < 30 * 60 * 32; i++) {
  w.step();
  if (i % 300 === 0 && w.time > 720) for (const [id, c] of (w.ai as any).controllers) { const k = String(c.debug.econ).split(' ')[0]; econ[k] = (econ[k] ?? 0) + 1; }
}
console.log('silos', w.buildings.filter((b) => b.def.id === 'silo').map((b) => `${w.factions[b.faction].name}${b.destroyed ? '(x)' : ''}`).join(','), 'launches', launches);
console.log(Object.entries(econ).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ':' + v).join(' '));

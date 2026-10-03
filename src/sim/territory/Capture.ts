import { resName } from '../../data/era';
import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import { REGION_YIELD } from '../../data/settlements';
import type { World } from '../World';

const CAP_R = 3.6 * TILE;

/**
 * Capture points: military units standing on a settlement's square capture it. More units capture
 * faster (with diminishing returns), any enemy presence pauses, defenders reverse progress, and towns
 * and castles must have their core breached first.
 */
export class CaptureSystem {
  private t = 0;
  constructor(private w: World) {}

  update(dt: number) {
    this.t += dt;
    if (this.t < 0.2) return;
    const step = this.t;
    this.t = 0;
    const w = this.w;
    for (const s of w.settlements) {
      const pres = s.presence;
      pres.fill(0);
      w.unitHash.query(s.px, s.py, CAP_R, (u) => {
        if (!u.alive || u.routing > 0 || u.def.special === 'worker' || u.def.tags.includes('siege')) return;
        pres[u.faction] += 1;
      });
      // threat flag for civilians (enemies of the owner near the settlement centre)
      let threat = 0;
      w.unitHash.query(s.cx, s.cy, 8 * TILE, (u) => {
        if (u.alive && u.def.special !== 'worker' && w.isHostile(s.owner, u.faction)) threat++;
      });
      s.threat = threat;
      if (threat > 0 && s.owner !== NEUTRAL) {
        s.lastAttackedT = Math.max(s.lastAttackedT, w.time - 3);
        w.alertAttack(s);
      }
      const owner = s.owner;
      const defenders = pres[owner];
      const attackers: FactionId[] = [];
      for (let f = 0; f <= NEUTRAL; f++) {
        if (f === owner || !pres[f]) continue;
        if (!w.isHostile(f as FactionId, owner) && owner !== NEUTRAL) {
          // standing on a non-hostile kingdom's square: the player declares war by doing so
          if (w.factions[f].isPlayer && w.factions[owner] && pres[f] > 0) {
            if (s.capFaction === -1) w.diplomacy.declareWar(f as FactionId, owner, 'capture');
          }
          continue;
        }
        if (f === NEUTRAL) continue; // free folk never capture
        attackers.push(f as FactionId);
      }
      s.contested = attackers.length > 1 || (attackers.length > 0 && defenders > 0);
      const core = w.buildingById.get(s.coreId);
      const breachNeeded = s.breachFrac > 0 || s.isCapital;
      s.needsBreach = false;
      if (attackers.length === 1 && defenders === 0) {
        const a = attackers[0];
        if (breachNeeded && core && !core.breached && core.hp > core.maxHp * s.breachFrac) {
          s.needsBreach = true;
          continue;
        }
        if (s.capFaction !== a) {
          // progress belongs to another faction: drain it first
          s.capProgress -= step * 0.6;
          if (s.capProgress <= 0) {
            s.capProgress = 0;
            s.capFaction = a;
          }
          continue;
        }
        const n = pres[a];
        const rate = (1 + Math.min(1.2, (n - 1) * 0.15)) / s.captureTime;
        const before = s.capProgress;
        s.capProgress = Math.min(1, s.capProgress + rate * step);
        if (before === 0 || Math.floor(before * 4) !== Math.floor(s.capProgress * 4)) w.events.emit('captureProgress', { regionId: s.id, faction: a, progress: s.capProgress });
        if (s.capProgress >= 1) this.capture(s.id, a);
      } else if (attackers.length === 0) {
        // decay / defenders restore
        const k = defenders > 0 ? 0.25 : 0.06;
        s.capProgress = Math.max(0, s.capProgress - k * step);
        if (s.capProgress === 0) s.capFaction = -1;
      }
    }
  }

  capture(sid: number, to: FactionId) {
    const w = this.w;
    const s = w.settlements[sid];
    const from = s.owner;
    w.settlementSys.transfer(s, to);
    const tf = w.factions[to];
    tf.stats.regionsCaptured++;
    if (from !== NEUTRAL) {
      w.factions[from].stats.regionsLost++;
      w.morale.settlementLost(s.id, from);
      w.factions[from].grudge[to] += 25 * s.region.value;
    }
    const yields: string[] = [];
    const add: Record<string, number> = {};
    for (const feat of s.region.features) {
      const y = REGION_YIELD[feat];
      if (!y) continue;
      for (const k in y) add[k] = (add[k] ?? 0) + (y as Record<string, number>)[k];
    }
    add.gold = (add.gold ?? 0) + s.tax.gold;
    if (s.tax.food) add.food = (add.food ?? 0) + s.tax.food;
    for (const k of ['gold', 'wood', 'food', 'stone']) if (add[k]) yields.push(`+${add[k]} ${resName(k)}/min`);
    if (s.popCap) yields.push(`+${s.popCap} Population`);
    w.events.emit('regionCaptured', { regionId: s.id, from, to, x: s.px, y: s.py });
    // celebration: victorious soldiers on the square cheer
    w.unitHash.query(s.px, s.py, CAP_R, (u) => {
      if (u.alive && u.faction === to && u.def.special !== 'worker') {
        u.anim = 'cheer';
        u.animT = 0;
        u.cheerT = 1.6;
      }
    });
    const playerInvolved = to === w.setup.player || from === w.setup.player;
    // every message says whose land it was, so a capture is never ambiguous
    const fromName = from === NEUTRAL ? null : w.factions[from].name;
    if (to === w.setup.player)
      w.notify({
        kind: 'capture',
        text: fromName ? `${s.name.toUpperCase()} TAKEN FROM ${fromName.toUpperCase()}` : `${s.name.toUpperCase()} CLAIMED`,
        sub: `${fromName ? `It was ${fromName}'s; now it's yours.` : 'Unclaimed land, now yours.'}  ${yields.join('  ')}`,
        factions: from === NEUTRAL ? [to] : [to, from],
        x: s.px,
        y: s.py,
        priority: 2,
        regionId: s.id,
      });
    else if (from === w.setup.player) w.notify({ kind: 'lost', text: `${s.name.toUpperCase()} LOST TO ${w.factions[to].name.toUpperCase()}`, sub: 'Retake its square to win it back', factions: [from, to], x: s.px, y: s.py, priority: 2, alarm: true, regionId: s.id });
    else if (from !== NEUTRAL || s.tier >= 3 || s.region.value >= 1.4)
      w.notify({
        kind: 'capture',
        text: `${w.factions[to].name.toUpperCase()} TAKES ${s.name.toUpperCase()}`,
        sub: fromName ? `from ${fromName}` : 'unclaimed land',
        factions: [to, from],
        x: s.px,
        y: s.py,
        priority: from !== NEUTRAL ? 1 : 0,
        world: true,
        regionId: s.id,
      });
    void playerInvolved;
  }
}

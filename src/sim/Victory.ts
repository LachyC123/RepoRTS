import { BUILDINGS } from '../data/buildings';
import { CAPITAL_RECOVERY_TIME, COMMANDER_RESPAWN, DOMINATION_HOLD, DOMINATION_SHARE, NEUTRAL, TILE, type FactionId } from '../data/constants';
import type { Settlement } from './territory/Settlement';
import type { Unit } from './units/Unit';
import type { World } from './World';

/**
 * Win/lose conditions: domination (hold 70% of the valley for 90s) or elimination (destroy every
 * rival capital; a kingdom that loses its capital gets 60s to promote a surviving major settlement).
 * Also commander respawns and territory statistics.
 */
export class VictorySystem {
  domination: { faction: FactionId; t: number } | null = null;
  private t = 0;
  private histT = 0;

  constructor(private w: World) {}

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    this.histT += dt;
    // commander respawns
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL || !f.alive) continue;
      if (f.commanderRespawn > 0) {
        f.commanderRespawn -= dt;
        if (f.commanderRespawn <= 0) this.respawnCommander(f.id);
      }
    }
    if (this.domination) {
      this.domination.t += dt;
      if (this.domination.t >= DOMINATION_HOLD) this.end(this.domination.faction, 'domination');
    }
    if (this.t < 1) return;
    this.t = 0;
    const total = w.settlements.length;
    const owned = [0, 0, 0, 0, 0];
    for (const s of w.settlements) owned[s.owner]++;
    for (let f = 0; f < NEUTRAL; f++) {
      const fac = w.factions[f];
      if (!fac) continue;
      fac.regionsOwned = owned[f];
      fac.territoryShare = owned[f] / total;
      fac.stats.peakTerritory = Math.max(fac.stats.peakTerritory, fac.territoryShare);
    }
    if (this.histT >= 10) {
      this.histT = 0;
      for (let f = 0; f < NEUTRAL; f++) w.factions[f]?.stats.history.push(w.factions[f].territoryShare);
    }
    // domination
    let leader: FactionId | -1 = -1;
    for (let f = 0; f < NEUTRAL; f++) if (w.factions[f]?.alive && w.factions[f].territoryShare >= DOMINATION_SHARE) leader = f as FactionId;
    if (leader >= 0) {
      if (!this.domination || this.domination.faction !== leader) {
        this.domination = { faction: leader as FactionId, t: 0 };
        w.events.emit('dominationStart', { faction: leader as FactionId });
        const p = w.setup.player;
        w.notify({
          kind: 'war',
          text: leader === p ? 'DOMINATION: HOLD THE VALLEY FOR 90 SECONDS' : `${w.factions[leader].name.toUpperCase()} NEARS DOMINATION`,
          sub: leader === p ? 'Keep 70% of the regions' : 'Retake territory to stop the timer',
          factions: [leader as FactionId],
          priority: 2,
          alarm: leader !== p,
          world: true,
        });
      }
    } else if (this.domination) {
      w.events.emit('dominationStop', { faction: this.domination.faction });
      w.notify({ kind: 'war', text: 'DOMINATION TIMER BROKEN', factions: [this.domination.faction], priority: 1, world: true });
      this.domination = null;
    }
    // capital crises
    for (let f = 0; f < NEUTRAL; f++) {
      const fac = w.factions[f];
      if (!fac?.alive || fac.critical <= 0) continue;
      // restored if the capital castle was repaired and is still ours
      const cap = fac.capitalSettlement >= 0 ? w.settlements[fac.capitalSettlement] : null;
      if (cap && cap.owner === f) {
        const core = w.buildingById.get(cap.coreId);
        if (core && !core.breached) {
          fac.critical = 0;
          continue;
        }
      }
      fac.critical -= 1;
      if (fac.critical <= 0) this.resolveCrisis(f as FactionId);
    }
  }

  onCapitalDestroyed(s: Settlement, by: FactionId) {
    const w = this.w;
    const f = w.factions[s.owner];
    if (!f || f.id === NEUTRAL || f.critical > 0) return;
    f.critical = CAPITAL_RECOVERY_TIME;
    w.events.emit('capitalLost', { faction: f.id, by });
    const p = w.setup.player;
    if (f.id === p) w.notify({ kind: 'lost', text: '👑 YOUR CAPITAL HAS FALLEN', sub: `Hold a town for ${CAPITAL_RECOVERY_TIME}s to crown a new capital`, factions: [f.id, by], x: s.cx, y: s.cy, priority: 2, alarm: true });
    else w.notify({ kind: 'war', text: `👑 ${f.name.toUpperCase()}'S CAPITAL FALLS TO ${w.factions[by].name.toUpperCase()}`, factions: [f.id, by], x: s.cx, y: s.cy, priority: 2, world: true });
    (f as { lastCapitalAttacker?: FactionId }).lastCapitalAttacker = by;
  }

  private resolveCrisis(f: FactionId) {
    const w = this.w;
    const fac = w.factions[f];
    // promote the best surviving settlement (towns first, then villages)
    const cands = w.settlements.filter((s) => s.owner === f && s.tier >= 2 && !(s.isCapital && w.buildingById.get(s.coreId)?.breached));
    cands.sort((a, b) => b.tier - a.tier || b.region.value - a.region.value);
    const best = cands[0];
    const old = fac.capitalSettlement >= 0 ? w.settlements[fac.capitalSettlement] : null;
    if (old && old !== best) {
      old.isCapital = false;
      if (old.owner === f) old.tier = Math.max(3, old.tier);
    }
    if (best) {
      best.isCapital = true;
      best.tier = Math.max(3, best.tier);
      const core = w.buildingById.get(best.coreId);
      if (core) {
        core.def = BUILDINGS.capital_castle;
        core.maxHp = core.def.hp * 0.7;
        core.hp = core.maxHp * 0.6;
        core.breached = false;
      }
      fac.capitalSettlement = best.id;
      w.events.emit('capitalPromoted', { faction: f, regionId: best.id });
      w.notify({ kind: 'info', text: `👑 ${fac.name.toUpperCase()} CROWNS ${best.name.toUpperCase()} AS ITS NEW CAPITAL`, factions: [f], x: best.cx, y: best.cy, priority: 2, world: true });
      w.settlementSys.updateCottages(best);
      return;
    }
    this.eliminate(f, (fac as { lastCapitalAttacker?: FactionId }).lastCapitalAttacker ?? -1);
  }

  eliminate(f: FactionId, by: FactionId | -1) {
    const w = this.w;
    const fac = w.factions[f];
    if (!fac.alive) return;
    fac.alive = false;
    fac.eliminatedAt = w.time;
    fac.critical = 0;
    if (by >= 0 && by !== NEUTRAL) w.factions[by].stats.enemiesDefeated++;
    // armies scatter; settlements rise in revolt
    for (const u of w.units) if (u.alive && u.faction === f) w.despawn(u);
    for (const s of w.settlements) {
      if (s.owner !== f) continue;
      w.settlementSys.transfer(s, NEUTRAL);
      for (let k = 0; k < 2; k++) {
        const u = w.spawnUnit('rebel', NEUTRAL, s.px + (k - 0.5) * 16, s.py + 8);
        u.leash = 6 * TILE;
      }
    }
    w.events.emit('factionEliminated', { faction: f, by });
    const p = w.setup.player;
    if (f === p) {
      w.notify({ kind: 'defeat', text: 'YOUR KINGDOM HAS FALLEN', factions: [f], priority: 2 });
      this.end(by >= 0 ? by : (-1 as FactionId | -1), 'defeat');
      return;
    }
    w.notify({ kind: 'war', text: `☠ ${fac.name.toUpperCase()} HAS BEEN DESTROYED`, sub: by >= 0 ? `by ${w.factions[by].name}` : undefined, factions: [f], priority: 2, world: true });
    const alive = w.factions.filter((x) => x && x.id !== NEUTRAL && x.alive);
    if (alive.length === 1) this.end(alive[0].id, 'elimination');
  }

  private end(winner: FactionId | -1, reason: 'domination' | 'elimination' | 'defeat') {
    const w = this.w;
    if (w.over) return;
    w.over = true;
    w.winner = winner;
    w.endReason = reason;
    w.events.emit('matchOver', { winner: winner as FactionId, reason });
  }

  respawnCommander(f: FactionId) {
    const w = this.w;
    const fac = w.factions[f];
    const cap = fac.capitalSettlement >= 0 ? w.settlements[fac.capitalSettlement] : null;
    if (!cap || cap.owner !== f) {
      fac.commanderRespawn = 10;
      return;
    }
    const u = w.spawnUnit('commander', f, cap.px, cap.py + 14);
    fac.commanderId = u.id;
    w.applyUpgradesToUnit(u);
    if (f === w.setup.player) w.notify({ kind: 'commander', text: `👑 ${fac.setup.commanderName.toUpperCase()} RETURNS TO THE FIELD`, factions: [f], x: u.x, y: u.y, priority: 1 });
  }

  onCommanderDeath(u: Unit, by: FactionId | -1) {
    const w = this.w;
    const fac = w.factions[u.faction];
    if (!fac || u.faction === NEUTRAL) return;
    fac.commanderRespawn = COMMANDER_RESPAWN;
    fac.commanderId = 0;
    // nearby troops are shaken
    w.unitHash.query(u.x, u.y, 12 * TILE, (o) => {
      if (o.alive && o.faction === u.faction) o.morale -= 25;
    });
    const p = w.setup.player;
    const name = `${fac.setup.commanderName} ${fac.setup.commanderTitle}`;
    if (u.faction === p) w.notify({ kind: 'commander', text: `👑 ${fac.setup.commanderName.toUpperCase()} HAS FALLEN`, sub: `Returns in ${COMMANDER_RESPAWN}s at the capital`, factions: [u.faction], x: u.x, y: u.y, priority: 2, alarm: true });
    else w.notify({ kind: 'commander', text: `👑 ${name.toUpperCase()} DEFEATED`, sub: by === p ? 'Slain by your army' : undefined, factions: [u.faction, by as FactionId], x: u.x, y: u.y, priority: by === p ? 2 : 1, world: true });
  }
}

import { NEUTRAL, TILE, type FactionId } from '../../data/constants';
import type { Building } from '../buildings/Building';
import type { Unit } from '../units/Unit';
import type { World } from '../World';

type Phase = 'go' | 'work' | 'back' | 'flee' | 'leave';

interface WState {
  unitId: number;
  buildingId: number;
  job: 'lumber' | 'farm' | 'mine' | 'trade' | 'build';
  phase: Phase;
  t: number;
  tx: number;
  ty: number;
  treeIdx: number;
  /** builders: settlement they serve */
  sid: number;
}

const JOB_UNIT: Record<WState['job'], string> = {
  lumber: 'worker_lumber',
  farm: 'worker_farm',
  mine: 'worker_mine',
  trade: 'worker_trade',
  build: 'worker_build',
};

/**
 * Civilians that make the world feel alive and give raids meaning. Each production building is
 * staffed by workers who walk out, chop / farm / mine, and carry goods back. Production depends on
 * them: when enemies approach they flee to the settlement and output stops until it is safe.
 * Builders walk out to raise and repair buildings. No micromanagement needed.
 */
export class WorkerSystem {
  private states = new Map<number, WState>();
  private byBuilding = new Map<number, number[]>();
  private respawnAt = new Map<number, number>();
  private claimed = new Set<number>();
  private builders = new Map<number, number>(); // settlement -> builder unit id
  private t = 0;

  constructor(private w: World) {}

  private jobFor(b: Building): WState['job'] | null {
    switch (b.def.id) {
      case 'lumber_camp':
        return 'lumber';
      case 'farm':
        return 'farm';
      case 'mine':
        return 'mine';
      case 'market':
        return 'trade';
      default:
        return null;
    }
  }

  private threatened(x: number, y: number, faction: FactionId, r = 6 * TILE) {
    let found = false;
    this.w.unitHash.query(x, y, r, (o) => {
      if (found || !o.alive || o.def.special === 'worker' || o.routing > 0) return;
      if (this.w.isHostile(faction, o.faction)) found = true;
    });
    return found;
  }

  update(dt: number) {
    const w = this.w;
    this.t += dt;
    if (this.t >= 0.5) {
      this.t = 0;
      this.staff();
      this.builderTasks();
    }
    for (const st of this.states.values()) {
      const u = w.unitById.get(st.unitId);
      if (!u || !u.alive) {
        this.forget(st);
        continue;
      }
      this.tickWorker(u, st, dt);
    }
  }

  private forget(st: WState) {
    this.states.delete(st.unitId);
    if (st.treeIdx >= 0) this.claimed.delete(st.treeIdx);
    const list = this.byBuilding.get(st.buildingId);
    if (list) {
      const i = list.indexOf(st.unitId);
      if (i >= 0) list.splice(i, 1);
      if (!this.respawnAt.has(st.buildingId)) this.respawnAt.set(st.buildingId, this.w.time + 14);
    }
    if (st.job === 'build' && this.builders.get(st.sid) === st.unitId) this.builders.delete(st.sid);
  }

  /** spawn missing workers and compute staffing */
  private staff() {
    const w = this.w;
    for (const b of w.buildings) {
      const job = this.jobFor(b);
      if (!job) continue;
      const list = this.byBuilding.get(b.id) ?? [];
      if (!b.active) {
        b.staffed = 0;
        continue;
      }
      // staffed fraction = workers actively on the job
      let working = 0;
      for (const id of list) {
        const st = this.states.get(id);
        if (st && st.phase !== 'flee' && st.phase !== 'leave') working++;
      }
      const want = b.def.workers ?? 1;
      b.staffed = Math.min(1, working / want);
      if (list.length < want) {
        const at = this.respawnAt.get(b.id) ?? 0;
        if (w.time < at) continue;
        const s = w.settlements[b.settlementId];
        if (this.threatened(b.x, b.y, b.faction, 7 * TILE)) {
          this.respawnAt.set(b.id, w.time + 4);
          continue;
        }
        // workers walk out of the settlement core (or appear at the building for remote sites)
        const core = w.buildingById.get(s.coreId);
        const fromCore = core && Math.hypot(core.x - b.x, core.y - b.y) < 14 * TILE;
        const sx = fromCore ? core!.doorX : b.doorX;
        const sy = fromCore ? core!.doorY : b.doorY;
        const u = w.spawnUnit(JOB_UNIT[job], b.faction, sx + (w.rng.next() - 0.5) * 6, sy);
        const st: WState = { unitId: u.id, buildingId: b.id, job, phase: 'go', t: 0, tx: 0, ty: 0, treeIdx: -1, sid: s.id };
        this.states.set(u.id, st);
        list.push(u.id);
        this.byBuilding.set(b.id, list);
        this.respawnAt.set(b.id, w.time + 2.5);
        this.pickWork(u, st, b);
      }
    }
    // drop bookkeeping for destroyed buildings
    for (const [bid, list] of this.byBuilding) {
      const b = w.buildingById.get(bid);
      if (b && !b.destroyed) continue;
      for (const id of list) {
        const st = this.states.get(id);
        const u = w.unitById.get(id);
        if (st && u) this.sendHome(u, st);
      }
      this.byBuilding.delete(bid);
    }
  }

  /** builders for construction and repair */
  private builderTasks() {
    const w = this.w;
    const tasks = new Map<number, Building>();
    for (const b of w.buildings) {
      if (b.destroyed || b.faction === NEUTRAL || b.def.category === 'landmark') continue;
      const needs = b.progress < 1 || (b.hp < b.maxHp * 0.98 && w.time - b.lastHitT > 12);
      if (!needs) continue;
      if (!tasks.has(b.settlementId)) tasks.set(b.settlementId, b);
    }
    for (const [sid, b] of tasks) {
      const existing = this.builders.get(sid);
      if (existing && w.unitById.get(existing)?.alive) {
        const st = this.states.get(existing)!;
        if (st.phase !== 'flee' && st.buildingId !== b.id && st.phase !== 'work') {
          st.buildingId = b.id;
          this.goBuild(w.unitById.get(existing)!, st, b);
        }
        continue;
      }
      const s = w.settlements[sid];
      if (s.owner !== b.faction) continue;
      if (this.threatened(b.x, b.y, b.faction, 6 * TILE)) continue;
      const core = w.buildingById.get(s.coreId);
      const sx = core && Math.hypot(core.x - b.x, core.y - b.y) < 16 * TILE ? core.doorX : b.doorX;
      const sy = core && Math.hypot(core.x - b.x, core.y - b.y) < 16 * TILE ? core.doorY : b.doorY;
      const u = w.spawnUnit('worker_build', b.faction, sx, sy);
      const st: WState = { unitId: u.id, buildingId: b.id, job: 'build', phase: 'go', t: 0, tx: 0, ty: 0, treeIdx: -1, sid };
      this.states.set(u.id, st);
      this.builders.set(sid, u.id);
      this.goBuild(u, st, b);
    }
    // idle builders go home
    for (const [sid, id] of this.builders) {
      if (tasks.has(sid)) continue;
      const u = w.unitById.get(id);
      const st = this.states.get(id);
      if (u && st && st.phase !== 'leave') this.sendHome(u, st);
    }
  }

  private goBuild(u: Unit, st: WState, b: Building) {
    const a = this.w.rng.next() * Math.PI * 2;
    const r = (b.size * TILE) / 2 + 5;
    st.tx = b.x + Math.cos(a) * r;
    st.ty = b.y + Math.abs(Math.sin(a)) * r;
    st.phase = 'go';
    this.w.setDestination(u, st.tx, st.ty, 0);
  }

  private sendHome(u: Unit, st: WState) {
    const w = this.w;
    const s = w.settlements[st.sid];
    const core = w.buildingById.get(s.coreId);
    st.phase = 'leave';
    st.tx = core ? core.doorX : u.x;
    st.ty = core ? core.doorY - 4 : u.y;
    w.setDestination(u, st.tx, st.ty, 0);
  }

  private pickWork(u: Unit, st: WState, b: Building) {
    const w = this.w;
    const m = w.map;
    st.phase = 'go';
    st.t = 0;
    if (st.treeIdx >= 0) {
      this.claimed.delete(st.treeIdx);
      st.treeIdx = -1;
    }
    switch (st.job) {
      case 'lumber': {
        const cx = Math.floor(b.x / TILE);
        const cy = Math.floor(b.y / TILE);
        let best = -1;
        let bd = Infinity;
        for (let y = cy - 8; y <= cy + 8; y++)
          for (let x = cx - 8; x <= cx + 8; x++) {
            if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
            const i = y * m.w + x;
            if (!m.tree[i] || this.claimed.has(i)) continue;
            // needs a walkable neighbour
            const d = (x - cx) ** 2 + (y - cy) ** 2 + ((i * 7919) % 5);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        if (best < 0) {
          st.tx = b.doorX + (w.rng.next() - 0.5) * 20;
          st.ty = b.doorY + 8;
        } else {
          st.treeIdx = best;
          this.claimed.add(best);
          const tx = best % m.w;
          const ty = Math.floor(best / m.w);
          const ni = w.pathfinder.nearestPassable(tx, ty + 1, u.faction, 2);
          st.tx = ni >= 0 ? (ni % m.w) * TILE + 8 : tx * TILE + 8;
          st.ty = ni >= 0 ? Math.floor(ni / m.w) * TILE + 8 : ty * TILE + 20;
        }
        break;
      }
      case 'farm': {
        const f = b.fields.length ? b.fields[Math.floor(w.rng.next() * b.fields.length)] : -1;
        if (f >= 0) {
          st.tx = (f % m.w) * TILE + 4 + w.rng.next() * 8;
          st.ty = Math.floor(f / m.w) * TILE + 4 + w.rng.next() * 8;
        } else {
          st.tx = b.doorX + (w.rng.next() - 0.5) * 24;
          st.ty = b.doorY + 10;
        }
        break;
      }
      case 'mine': {
        const s = w.settlements[b.settlementId];
        const d = w.settlementSys.nearestDeposit(s, b.tx + b.size / 2, b.ty + b.size / 2);
        if (d) {
          const a = Math.atan2(b.y - d.y, b.x - d.x) + (w.rng.next() - 0.5) * 1.2;
          st.tx = d.x + Math.cos(a) * 22;
          st.ty = d.y + Math.sin(a) * 18;
        } else {
          st.tx = b.doorX;
          st.ty = b.doorY + 8;
        }
        break;
      }
      case 'trade': {
        const s = w.settlements[b.settlementId];
        st.tx = s.px + (w.rng.next() - 0.5) * 30;
        st.ty = s.py + (w.rng.next() - 0.5) * 16;
        break;
      }
      default:
        break;
    }
    w.setDestination(u, st.tx, st.ty, 0);
  }

  private tickWorker(u: Unit, st: WState, dt: number) {
    const w = this.w;
    const b = w.buildingById.get(st.buildingId);
    st.t += dt;
    // threat check (staggered)
    if (st.phase !== 'flee' && st.phase !== 'leave' && (w.tick + u.id) % 10 === 0 && this.threatened(u.x, u.y, u.faction)) {
      const s = w.settlements[st.sid];
      const core = w.buildingById.get(s.coreId);
      st.phase = 'flee';
      st.t = 0;
      u.anim = 'walk';
      st.tx = core ? core.doorX : u.x;
      st.ty = core ? core.doorY - 4 : u.y;
      w.setDestination(u, st.tx, st.ty, 0);
      w.events.emit('workerAction', { id: u.id, x: u.x, y: u.y, action: 'flee' });
      return;
    }
    if (st.phase !== 'work' && u.anim === 'work') u.anim = 'idle';
    switch (st.phase) {
      case 'go': {
        if (!b || b.destroyed || b.faction !== u.faction) {
          this.sendHome(u, st);
          return;
        }
        if (u.arrived || Math.hypot(u.x - st.tx, u.y - st.ty) < 4) {
          st.phase = 'work';
          st.t = 0;
          if (st.job === 'lumber' && st.treeIdx >= 0) {
            const m = w.map;
            u.facing = (st.treeIdx % m.w) * TILE + 8 >= u.x ? 1 : -1;
          }
        }
        if (st.t > 25) this.pickWork(u, st, b);
        break;
      }
      case 'work': {
        if (!b || b.destroyed) {
          this.sendHome(u, st);
          return;
        }
        // tool cycle: the renderer reads anim 'work' + animT; the blow lands at 0.35 s
        const swing = st.job !== 'trade';
        const period = 1.1;
        const prev = u.anim === 'work' ? u.animT : -1;
        u.anim = 'work';
        u.animT = st.t % period;
        if (swing && prev >= 0 && prev < 0.35 && u.animT >= 0.35) {
          if (st.job === 'lumber' && st.treeIdx >= 0) w.events.emit('workerAction', { id: u.id, x: u.x, y: u.y, action: 'chop:' + st.treeIdx });
          else w.events.emit('workerAction', { id: u.id, x: u.x, y: u.y, action: st.job });
        }
        const dur = st.job === 'build' ? 2 : st.job === 'trade' ? 2.5 : 4.4;
        if (st.job === 'build') {
          if (b.progress >= 1 && b.hp >= b.maxHp * 0.98) {
            u.windup = 0;
            st.phase = 'back';
            this.builders.delete(st.sid);
            this.sendHome(u, st);
          }
          if (b.progress < 1) b.progress = Math.min(1, b.progress + dt * 0.012); // builders speed things up a little
          return;
        }
        if (st.t >= dur) {
          u.windup = 0;
          if (st.job === 'lumber' && st.treeIdx >= 0) this.chop(st.treeIdx);
          if (st.job === 'mine') {
            const s = w.settlements[b.settlementId];
            const d = w.settlementSys.nearestDeposit(s, b.tx + b.size / 2, b.ty + b.size / 2);
            if (d && d.temporary) {
              d.amount -= 12;
              if (d.amount <= 0) w.depleteDeposit(d);
            }
          }
          st.phase = 'back';
          st.t = 0;
          w.setDestination(u, b.doorX + (w.rng.next() - 0.5) * 8, b.doorY - 2, 0);
        }
        break;
      }
      case 'back': {
        if (!b || b.destroyed) {
          this.sendHome(u, st);
          return;
        }
        if (u.arrived || st.t > 25) {
          const per = b.def.produces ? Object.values(b.def.produces)[0] ?? 0 : 0;
          const res = b.def.id === 'mine' ? b.depositKind ?? 'gold' : b.def.produces ? Object.keys(b.def.produces)[0] : 'gold';
          if (b.efficiency > 0) w.events.emit('resourceGained', { faction: u.faction, x: b.doorX, y: b.doorY - 10, res, amount: Math.round((per * b.efficiency) / 6) });
          this.pickWork(u, st, b);
        }
        break;
      }
      case 'flee': {
        if (u.arrived || Math.hypot(u.x - st.tx, u.y - st.ty) < 10 || st.t > 20) {
          // hide indoors until safe; will be respawned by staffing
          w.despawn(u);
          this.forget(st);
          if (b) this.respawnAt.set(b.id, w.time + 10);
        }
        break;
      }
      case 'leave': {
        if (u.arrived || Math.hypot(u.x - st.tx, u.y - st.ty) < 10 || st.t > 30) {
          w.despawn(u);
          this.forget(st);
        }
        break;
      }
    }
  }

  private chop(i: number) {
    const w = this.w;
    const m = w.map;
    if (!m.tree[i]) return;
    const hp = m.treeHp[i] - 34;
    if (hp <= 0) {
      m.tree[i] = 0;
      m.treeHp[i] = 0;
      m.stump[i] = 1;
      m.version++;
      this.claimed.delete(i);
      w.regrowth.push({ i, t: w.time + 240 + w.rng.next() * 180 });
      w.events.emit('treeFelled', { x: (i % m.w) * TILE + 8, y: Math.floor(i / m.w) * TILE + 8 });
    } else m.treeHp[i] = hp;
  }

  /** for UI: workers of a building */
  workersOf(bid: number) {
    return (this.byBuilding.get(bid) ?? []).length;
  }

  isWorkerState(uid: number) {
    return this.states.get(uid);
  }
}

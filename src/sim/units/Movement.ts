import { TILE } from '../../data/constants';
import { tileSpeed } from '../map/GameMap';
import type { World } from '../World';
import type { Unit } from './Unit';

/**
 * Steering + collision for all units. Path following with waypoint skipping, separation that lets
 * moving units nudge idle ones aside, circle-vs-tile collision, and stuck detection with repath.
 */
export class Movement {
  constructor(private world: World) {}

  update(dt: number) {
    const w = this.world;
    const map = w.map;
    const pf = w.pathfinder;
    const hash = w.unitHash;
    for (const u of w.units) {
      if (!u.alive) continue;
      u.px = u.x;
      u.py = u.y;
      let dvx = 0;
      let dvy = 0;
      const ti = Math.floor(u.y / TILE) * map.w + Math.floor(u.x / TILE);
      const tspd = ti >= 0 && ti < map.terrain.length ? tileSpeed(map, ti) : 1;
      const maxSpeed = u.speed * tspd;
      const busy = u.windup > 0 || (u.def.deploy && u.deploy > 0 && u.deploy < 1);
      if (!busy && u.path && !u.arrived) {
        const n = u.path.length / 2;
        let wx = u.path[u.pathIdx * 2];
        let wy = u.path[u.pathIdx * 2 + 1];
        const last = u.pathIdx >= n - 1;
        let d = Math.hypot(wx - u.x, wy - u.y);
        // advance waypoints
        if (!last && d < 7) {
          u.pathIdx++;
          wx = u.path[u.pathIdx * 2];
          wy = u.path[u.pathIdx * 2 + 1];
          d = Math.hypot(wx - u.x, wy - u.y);
        }
        const arriveR = last ? 1.5 : 4;
        if (last && d < arriveR) {
          u.arrived = true;
          u.path = null;
        } else {
          // slow down on final approach for a soft stop
          const s = last ? Math.min(maxSpeed, d * 3 + 4) : maxSpeed;
          dvx = ((wx - u.x) / d) * s;
          dvy = ((wy - u.y) / d) * s;
        }
      }
      // knockback impulse
      if (u.knockX || u.knockY) {
        dvx += u.knockX * 30;
        dvy += u.knockY * 30;
        u.knockX *= 0.75;
        u.knockY *= 0.75;
        if (Math.abs(u.knockX) < 0.02 && Math.abs(u.knockY) < 0.02) u.knockX = u.knockY = 0;
      }
      // separation
      let sx = 0;
      let sy = 0;
      const moving = !u.arrived;
      const ur = u.radius;
      hash.query(u.x, u.y, ur + 9, (o) => {
        if (o === u || !o.alive) return;
        const dx = u.x - o.x;
        const dy = u.y - o.y;
        let d2 = dx * dx + dy * dy;
        const minD = ur + o.radius + 0.5;
        if (d2 >= minD * minD) return;
        let d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d < 0.01) {
          // perfectly stacked: deterministic nudge
          const a = (u.id * 2.39996) % (Math.PI * 2);
          nx = Math.cos(a);
          ny = Math.sin(a);
          d = 0.01;
          d2 = 0.0001;
        } else {
          nx = dx / d;
          ny = dy / d;
        }
        const overlap = minD - d;
        // who yields? idle units yield to moving; enemies push hard; allies softly
        let k = 14;
        const oMoving = !o.arrived;
        if (!moving && oMoving) k = 26;
        else if (moving && !oMoving) k = 7;
        if (o.faction !== u.faction) k = 18;
        // heavy units push light ones
        k *= Math.min(2, o.radius / ur);
        sx += nx * overlap * k;
        sy += ny * overlap * k;
      });
      let vx = dvx + sx;
      let vy = dvy + sy;
      // clamp
      const lim = Math.max(maxSpeed * 1.4, 30);
      const vl = Math.hypot(vx, vy);
      if (vl > lim) {
        vx = (vx / vl) * lim;
        vy = (vy / vl) * lim;
      }
      // inertia for organic motion (cavalry turns wider)
      const accel = u.def.tags.includes('cavalry') ? 6 : 12;
      const k = Math.min(1, accel * dt);
      u.vx += (vx - u.vx) * k;
      u.vy += (vy - u.vy) * k;
      if (!moving && Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5 && !u.knockX) {
        u.vx *= 0.6;
        u.vy *= 0.6;
      }
      let nx = u.x + u.vx * dt;
      let ny = u.y + u.vy * dt;
      // tile collision
      [nx, ny] = this.collide(u, nx, ny);
      u.x = nx;
      u.y = ny;
      const spd = Math.hypot(u.vx, u.vy);
      if (u.windup <= 0 && Math.abs(u.vx) > 3) u.facing = u.vx > 0 ? 1 : -1;
      // charge accumulation
      if (spd > u.def.speed * 0.7) u.chargeRun += spd * dt;
      else u.chargeRun = Math.max(0, u.chargeRun - 60 * dt);
      // anim state (combat system overrides with attack)
      if (u.anim === 'work' && spd > 6) u.anim = 'walk';
      if (u.windup <= 0 && u.anim !== 'attack' && u.anim !== 'cheer' && u.anim !== 'work') u.anim = spd > 6 ? 'walk' : 'idle';
      // stuck detection
      if (!u.arrived && u.path) {
        u.stuckT += dt;
        if (u.stuckT > 1.2) {
          const moved = Math.hypot(u.x - u.progX, u.y - u.progY);
          u.stuckT = 0;
          u.progX = u.x;
          u.progY = u.y;
          if (moved < 4) {
            // near destination and crowded? call it arrived
            const dd = Math.hypot(u.destX - u.x, u.destY - u.y);
            if (dd < 22 || u.pathFails >= 3) {
              u.arrived = true;
              u.path = null;
            } else {
              u.pathFails++;
              u.needPath = true;
            }
          }
        }
      }
    }
  }

  /** resolve circle against blocked tiles for this unit's faction */
  collide(u: Unit, x: number, y: number): [number, number] {
    const w = this.world;
    const map = w.map;
    const pf = w.pathfinder;
    const r = u.radius * 0.8;
    const W = map.w;
    for (let iter = 0; iter < 2; iter++) {
      const x0 = Math.floor((x - r) / TILE);
      const x1 = Math.floor((x + r) / TILE);
      const y0 = Math.floor((y - r) / TILE);
      const y1 = Math.floor((y + r) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (tx < 0 || ty < 0 || tx >= W || ty >= map.h) {
            x = Math.max(r, Math.min(W * TILE - r, x));
            y = Math.max(r, Math.min(map.h * TILE - r, y));
            continue;
          }
          if (pf.passable(ty * W + tx, u.faction)) continue;
          const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
          const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 0.0001) {
            const d = Math.sqrt(d2);
            x = cx + (dx / d) * r;
            y = cy + (dy / d) * r;
          } else {
            // centre inside the tile: eject to nearest passable tile
            const ni = pf.nearestPassable(tx, ty, u.faction, 6);
            if (ni >= 0) {
              x = (ni % W) * TILE + 8;
              y = Math.floor(ni / W) * TILE + 8;
            }
          }
        }
      }
    }
    return [x, y];
  }
}

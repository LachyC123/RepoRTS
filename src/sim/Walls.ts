import { BUILDINGS, FORTIFY } from '../data/buildings';
import type { Building } from './buildings/Building';
import { T } from './map/GameMap';
import type { Settlement } from './territory/Settlement';
import type { World } from './World';

/**
 * Settlement fortifications: a ring of wall segments with gatehouses where roads cross.
 * Gates are passable for the owner only; enemies path "through" walls at a high cost (breach mode)
 * and attack the segment that blocks them.
 */
export class WallSystem {
  /** 1 where a wall segment stands (used for breach pathing) */
  mask: Uint8Array;

  constructor(private w: World) {
    this.mask = new Uint8Array(w.map.w * w.map.h);
    w.pathfinder.setWallMask(this.mask);
  }

  clearMask(i: number) {
    this.mask[i] = 0;
  }

  setGateOwner(b: Building) {
    const m = this.w.map;
    const i = b.ty * m.w + b.tx;
    m.gateOwner[i] = b.faction + 1;
  }

  ringTiles(s: Settlement): number[] {
    const m = this.w.map;
    const r = s.region;
    let R = r.coreSize / 2 + 3;
    for (let k = 0; k < s.unlockedPlots; k++) {
      const p = s.plots[k].def;
      const far = Math.max(
        Math.hypot(p.x - r.cx - 0.5, p.y - r.cy - 0.5),
        Math.hypot(p.x + p.size - r.cx - 0.5, p.y - r.cy - 0.5),
        Math.hypot(p.x - r.cx - 0.5, p.y + p.size - r.cy - 0.5),
        Math.hypot(p.x + p.size - r.cx - 0.5, p.y + p.size - r.cy - 0.5),
      );
      R = Math.max(R, far + 1.2);
    }
    R = Math.min(R, 13.5);
    const out: number[] = [];
    for (let y = Math.floor(r.cy - R - 1); y <= r.cy + R + 1; y++)
      for (let x = Math.floor(r.cx - R - 1); x <= r.cx + R + 1; x++) {
        if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
        const d = Math.hypot(x + 0.5 - (r.cx + 0.5), y + 0.5 - (r.cy + 0.5));
        if (d < R - 0.5 || d >= R + 0.5) continue;
        out.push(y * m.w + x);
      }
    return out;
  }

  buildRing(s: Settlement, level: number) {
    const w = this.w;
    const m = w.map;
    const spec = FORTIFY.find((f) => f.level === level)!;
    if (s.wallIds.length) {
      // upgrade existing segments in place
      for (const id of s.wallIds) {
        const b = w.buildingById.get(id);
        if (!b || b.destroyed) continue;
        b.maxHp = spec.wallHp * (b.isGate ? 1.5 : 1);
        b.hp = b.maxHp;
      }
      s.fortify = level;
      // fill gaps left by destroyed segments
    }
    const existing = new Set<number>();
    for (const id of s.wallIds) {
      const b = w.buildingById.get(id);
      if (b && !b.destroyed) existing.add(b.ty * m.w + b.tx);
    }
    for (const i of this.ringTiles(s)) {
      if (existing.has(i)) continue;
      const t = m.terrain[i];
      if (t === T.WATER || t === T.ROCK) continue;
      if (m.occ[i] || m.tree[i] || m.ore[i]) continue;
      if (m.region[i] !== s.id) continue;
      const gate = t === T.ROAD || t === T.BRIDGE;
      const b = w.settlementSys.placeWall(s, i % m.w, Math.floor(i / m.w), gate ? 'gatehouse' : 'wall');
      b.maxHp = spec.wallHp * (gate ? 1.5 : 1);
      b.hp = b.maxHp;
      b.isGate = gate;
      if (gate) m.gateOwner[i] = s.owner + 1;
      else this.mask[i] = 1;
      s.wallIds.push(b.id);
    }
    s.fortify = level;
    m.version++;
    w.notify({ kind: 'build', text: `${s.name.toUpperCase()} ${level >= 2 ? 'STONE WALLS' : 'PALISADE'} COMPLETE`, factions: [s.owner], x: s.cx, y: s.cy, priority: s.owner === w.setup.player ? 1 : 0 });
    void BUILDINGS;
  }
}

import type { World } from '../sim/World';

export type SelectionChange = () => void;

/** Player selection + army (control) groups. */
export class Selection {
  units = new Set<number>();
  building = 0;
  region = -1;
  armies = new Map<number, number[]>();
  private listeners: SelectionChange[] = [];
  version = 0;

  constructor(private world: World) {}

  onChange(fn: SelectionChange) {
    this.listeners.push(fn);
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  clear(silent = false) {
    if (!this.units.size && !this.building && this.region < 0) return;
    this.units.clear();
    this.building = 0;
    this.region = -1;
    if (!silent) this.changed();
  }

  setUnits(ids: number[], add = false) {
    if (!add) {
      this.units.clear();
      this.building = 0;
      this.region = -1;
    }
    for (const id of ids) this.units.add(id);
    this.changed();
  }

  toggleUnit(id: number) {
    if (this.units.has(id)) this.units.delete(id);
    else this.units.add(id);
    this.building = 0;
    this.region = -1;
    this.changed();
  }

  selectBuilding(id: number, region = -1) {
    this.units.clear();
    this.building = id;
    this.region = region;
    this.changed();
  }

  selectRegion(region: number) {
    this.units.clear();
    this.building = 0;
    this.region = region;
    this.changed();
  }

  /** prune dead units */
  prune() {
    let removed = false;
    for (const id of this.units) {
      const u = this.world.unitById.get(id);
      if (!u || !u.alive) {
        this.units.delete(id);
        removed = true;
      }
    }
    for (const [k, ids] of this.armies) {
      const alive = ids.filter((id) => this.world.unitById.get(id)?.alive);
      if (alive.length !== ids.length) {
        if (alive.length) this.armies.set(k, alive);
        else this.armies.delete(k);
        removed = true;
      }
    }
    if (removed) this.changed();
  }

  unitList() {
    const out = [];
    for (const id of this.units) {
      const u = this.world.unitById.get(id);
      if (u && u.alive) out.push(u);
    }
    return out;
  }

  assignArmy(n: number, ids?: number[]) {
    const list = ids ?? [...this.units];
    if (!list.length) return;
    // a unit belongs to one army at a time
    for (const [k, arr] of this.armies) {
      const f = arr.filter((id) => !list.includes(id));
      if (f.length) this.armies.set(k, f);
      else this.armies.delete(k);
    }
    this.armies.set(n, list);
    for (const id of list) {
      const u = this.world.unitById.get(id);
      if (u) u.army = n;
    }
    this.changed();
  }

  selectArmy(n: number) {
    const ids = this.armies.get(n);
    if (!ids) return false;
    this.setUnits(ids.filter((id) => this.world.unitById.get(id)?.alive));
    return true;
  }

  nextFreeArmy() {
    for (let i = 1; i <= 9; i++) if (!this.armies.has(i)) return i;
    return 0;
  }

  touch() {
    this.changed();
  }
}

/** Uniform-grid spatial hash for fast neighbour queries. Rebuilt each tick. */
export interface HasPos {
  x: number;
  y: number;
  id: number;
}

export class SpatialHash<E extends HasPos> {
  readonly cell: number;
  private cols: number;
  private rows: number;
  private cells: E[][];
  private used: number[] = [];

  constructor(worldW: number, worldH: number, cell = 32) {
    this.cell = cell;
    this.cols = Math.ceil(worldW / cell);
    this.rows = Math.ceil(worldH / cell);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear() {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
  }

  insert(e: E) {
    const cx = Math.min(this.cols - 1, Math.max(0, (e.x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (e.y / this.cell) | 0));
    const i = cy * this.cols + cx;
    const c = this.cells[i];
    if (c.length === 0) this.used.push(i);
    c.push(e);
  }

  /** visit entities within radius r of (x,y). Return true from fn to stop early. */
  query(x: number, y: number, r: number, fn: (e: E, d2: number) => boolean | void) {
    const r2 = r * r;
    const x0 = Math.max(0, ((x - r) / this.cell) | 0);
    const y0 = Math.max(0, ((y - r) / this.cell) | 0);
    const x1 = Math.min(this.cols - 1, ((x + r) / this.cell) | 0);
    const y1 = Math.min(this.rows - 1, ((y + r) / this.cell) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells[cy * this.cols + cx];
        for (let k = 0; k < c.length; k++) {
          const e = c[k];
          const dx = e.x - x;
          const dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && fn(e, d2)) return;
        }
      }
    }
  }

  /** collect into array */
  within(x: number, y: number, r: number, out: E[] = []): E[] {
    this.query(x, y, r, (e) => {
      out.push(e);
    });
    return out;
  }
}

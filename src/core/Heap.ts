/** Binary min-heap keyed by float priority, storing integer values. Allocation-free after growth. */
export class MinHeap {
  private vals: Int32Array;
  private pri: Float64Array;
  size = 0;
  constructor(cap = 1024) {
    this.vals = new Int32Array(cap);
    this.pri = new Float64Array(cap);
  }
  clear() {
    this.size = 0;
  }
  push(v: number, p: number) {
    if (this.size >= this.vals.length) {
      const nv = new Int32Array(this.vals.length * 2);
      nv.set(this.vals);
      this.vals = nv;
      const np = new Float64Array(this.pri.length * 2);
      np.set(this.pri);
      this.pri = np;
    }
    let i = this.size++;
    const vals = this.vals;
    const pri = this.pri;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      vals[i] = vals[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    vals[i] = v;
    pri[i] = p;
  }
  peekPriority() {
    return this.pri[0];
  }
  pop(): number {
    const vals = this.vals;
    const pri = this.pri;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const v = vals[n];
      const p = pri[n];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        vals[i] = vals[c];
        pri[i] = pri[c];
        i = c;
      }
      vals[i] = v;
      pri[i] = p;
    }
    return top;
  }
}

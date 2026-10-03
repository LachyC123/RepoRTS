import type Phaser from 'phaser';

export type SortObj = Phaser.GameObjects.Image & { sy: number };

/**
 * A Phaser Layer whose children are kept ordered by a custom `sy` (ground y) with an insertion sort.
 * Order changes little frame to frame, so this is ~O(n), and we never touch Phaser's depth (which
 * would trigger a full stable sort of the display list every frame).
 */
export class YSortLayer {
  constructor(readonly layer: Phaser.GameObjects.Layer) {}

  add(o: SortObj) {
    this.layer.add(o);
  }

  remove(o: SortObj) {
    this.layer.remove(o);
  }

  sort() {
    const list = this.layer.list as unknown as SortObj[];
    for (let i = 1; i < list.length; i++) {
      const o = list[i];
      const y = o.sy;
      let j = i - 1;
      if (list[j].sy <= y) continue;
      while (j >= 0 && list[j].sy > y) {
        list[j + 1] = list[j];
        j--;
      }
      list[j + 1] = o;
    }
  }

  get count() {
    return this.layer.list.length;
  }
}

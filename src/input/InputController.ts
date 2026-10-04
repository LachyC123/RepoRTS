import { TILE, type FactionId } from '../data/constants';
import type { CameraController } from '../render/CameraController';
import type { Unit } from '../sim/units/Unit';
import type { World } from '../sim/World';
import type { Selection } from './Selection';

export type CommandMode = 'default' | 'move' | 'attack' | 'select' | 'rally' | 'strike';

export interface InputHooks {
  /** world point tapped/right-clicked with a selection → order */
  order(kind: 'move' | 'attack' | 'attackMove', x: number, y: number, target?: Unit): void;
  /** returns something selectable at a world point that is not a unit (building/settlement) */
  pickStructure(x: number, y: number): { kind: 'building'; id: number; region: number } | { kind: 'region'; id: number } | { kind: 'plot'; region: number; plot: number } | null;
  /** an empty plot of the selected settlement was tapped */
  plotTapped?(region: number, plot: number): void;
  /** rally / custom ground-target modes */
  groundTarget?(mode: CommandMode, x: number, y: number): boolean;
  selected(): void;
  /** called on any pointer interaction (audio unlock etc.) */
  interact(): void;
  /** hovering world position for cursors / tooltips */
  hover?(x: number, y: number): void;
  isBlocked?(): boolean;
  modeConsumed?(mode: CommandMode): void;
  /** double tap / double click on a unit: select same type on screen */
  selectSameType?(u: Unit): void;
}

interface Ptr {
  id: number;
  type: string;
  button: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  t0: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  moved: boolean;
}

const TAP_MOVE = 10;
const MOUSE_DRAG = 6;
const LONG_PRESS = 380;

/**
 * Unified mouse + touch input on the game canvas.
 * Touch: tap = select / order, one-finger drag on ground = pan (never orders), drag starting on own
 * units or after a press-and-hold (or in SELECT mode) = box select, hold-and-release = context action,
 * two fingers = pan + pinch zoom.
 * Mouse: left click/drag = select/box, right click = order, right/middle drag = pan, wheel = zoom.
 */
export class InputController {
  mode: CommandMode = 'default';
  private ptrs = new Map<number, Ptr>();
  private gesture: 'none' | 'pan' | 'box' | 'pinch' | 'pending' | 'hold' = 'none';
  private pinchD = 0;
  private pinchCX = 0;
  private pinchCY = 0;
  private longTimer = 0;
  private boxArmed = false;
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0, unit: 0 };
  /** touch device detected */
  touch = false;
  shift = false;
  ctrl = false;
  private consumedAfterPinch = false;
  enabled = true;

  constructor(
    private el: HTMLElement,
    private cam: CameraController,
    private world: World,
    private sel: Selection,
    private faction: number,
    private hooks: InputHooks,
  ) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onCancel, { passive: false });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => {
      this.cam.pointerEdge = { x: -1, y: -1 };
    });
    window.addEventListener('blur', () => this.reset());
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    this.el.removeEventListener('wheel', this.onWheel);
  }

  reset() {
    this.ptrs.clear();
    this.gesture = 'none';
    this.box = null;
    this.cam.dragging = false;
    clearTimeout(this.longTimer);
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.hooks.interact();
    if (e.pointerType === 'touch') this.touch = true;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const [x, y] = this.local(e);
    const now = performance.now();
    const p: Ptr = { id: e.pointerId, type: e.pointerType, button: e.button, sx: x, sy: y, x, y, t0: now, lastX: x, lastY: y, lastT: now, vx: 0, vy: 0, moved: false };
    this.ptrs.set(e.pointerId, p);
    this.cam.stopInertia();
    this.cam.cancelFly();
    if (this.ptrs.size === 2) {
      // start pinch
      clearTimeout(this.longTimer);
      this.box = null;
      this.gesture = 'pinch';
      const [a, b] = [...this.ptrs.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchCX = (a.x + b.x) / 2;
      this.pinchCY = (a.y + b.y) / 2;
      this.cam.dragging = true;
      return;
    }
    if (this.ptrs.size > 2) return;
    this.consumedAfterPinch = false;
    this.gesture = 'pending';
    this.boxArmed = false;
    if (p.type === 'touch' || p.type === 'pen') {
      // drags that start on own units, or in select mode, become box selections
      const u = this.pickUnit(x, y, true);
      if (this.mode === 'select' || (u && u.faction === this.faction)) this.boxArmed = true;
      this.longTimer = window.setTimeout(() => {
        // press and hold: drag on for a box selection, or lift for the context action
        if (this.gesture === 'pending' && !p.moved) {
          this.boxArmed = true;
          this.gesture = 'hold';
          if (navigator.vibrate) navigator.vibrate(12);
        }
      }, LONG_PRESS);
    }
  };

  private onMove = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    if (e.pointerType === 'mouse') {
      this.cam.pointerEdge = { x, y };
      const [wx, wy] = this.cam.screenToWorld(x, y);
      this.hooks.hover?.(wx, wy);
    }
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - p.lastT) / 1000;
    const ddx = x - p.x;
    const ddy = y - p.y;
    p.vx = p.vx * 0.6 + (ddx / dt) * 0.4;
    p.vy = p.vy * 0.6 + (ddy / dt) * 0.4;
    p.lastT = now;
    p.x = x;
    p.y = y;
    const dist = Math.hypot(x - p.sx, y - p.sy);
    const thresh = p.type === 'mouse' ? MOUSE_DRAG : TAP_MOVE;
    if (dist > thresh) p.moved = true;

    if (this.gesture === 'pinch' && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (this.pinchD > 10 && d > 10) this.cam.zoomAt(d / this.pinchD, cx, cy, true);
      this.cam.panBy(cx - this.pinchCX, cy - this.pinchCY);
      this.pinchD = d;
      this.pinchCX = cx;
      this.pinchCY = cy;
      return;
    }
    if (this.gesture === 'hold' && p.moved) {
      this.gesture = 'box';
      this.box = { x0: p.sx, y0: p.sy, x1: x, y1: y };
    }
    if (this.gesture === 'pending' && p.moved) {
      clearTimeout(this.longTimer);
      if (p.type === 'mouse') {
        if (p.button === 0 && this.mode !== 'move' && this.mode !== 'attack') {
          this.gesture = 'box';
          this.box = { x0: p.sx, y0: p.sy, x1: x, y1: y };
        } else this.gesture = 'pan';
      } else {
        if (this.boxArmed) {
          this.gesture = 'box';
          this.box = { x0: p.sx, y0: p.sy, x1: x, y1: y };
        } else this.gesture = 'pan';
      }
      if (this.gesture === 'pan') this.cam.dragging = true;
    }
    if (this.gesture === 'pan') {
      this.cam.panBy(ddx * this.cam.sensitivity, ddy * this.cam.sensitivity);
    } else if (this.gesture === 'box' && this.box) {
      this.box.x1 = x;
      this.box.y1 = y;
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    this.ptrs.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.gesture === 'pinch') {
      if (this.ptrs.size < 2) {
        // remaining finger must not trigger a tap
        this.consumedAfterPinch = true;
        this.gesture = this.ptrs.size === 1 ? 'pan' : 'none';
        if (this.ptrs.size === 1) {
          const rest = [...this.ptrs.values()][0];
          rest.moved = true;
        }
        if (this.ptrs.size === 0) this.cam.dragging = false;
      }
      return;
    }
    if (this.ptrs.size > 0) return;
    this.cam.dragging = false;
    const g = this.gesture;
    this.gesture = 'none';
    if (g === 'pan') {
      const v = Math.hypot(p.vx, p.vy);
      if (v > 150 && performance.now() - p.lastT < 80) this.cam.fling(p.vx * this.cam.sensitivity, p.vy * this.cam.sensitivity);
      return;
    }
    if (g === 'box' && this.box) {
      this.finishBox();
      return;
    }
    if (g === 'hold') {
      this.contextAction(p);
      return;
    }
    if (this.consumedAfterPinch) return;
    if (!p.moved) this.tap(p, e);
  };

  private onCancel = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size === 0) this.reset();
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const [x, y] = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const f = Math.exp(-delta * 0.0015 * (e.ctrlKey ? 2 : 1));
    this.cam.zoomAt(f, x, y);
  };

  // ------------------------------------------------------------------ picking
  pickUnit(sx: number, sy: number, ownOnly = false, enemyOnly = false): Unit | null {
    const [wx, wy] = this.cam.screenToWorld(sx, sy);
    const pr = (this.touch ? 20 : 10) / this.cam.zoom + 4;
    let best: Unit | null = null;
    let bd = Infinity;
    this.world.unitHash.query(wx, wy + 6, pr + 12, (u) => {
      if (!u.alive) return;
      if (ownOnly && u.faction !== this.faction) return;
      if (enemyOnly && u.faction === this.faction) return;
      if (u.faction !== this.faction && !(u.seenBy & (1 << this.faction))) return;
      // body centre is above the feet
      const h = u.def.look.mount ? 10 : u.def.look.body === 'engine' ? 8 : 6;
      const d = Math.hypot(u.x - wx, u.y - h - wy);
      if (d < pr + u.radius && d < bd) {
        bd = d;
        best = u;
      }
    });
    return best;
  }

  private finishBox() {
    const b = this.box!;
    this.box = null;
    const [ax, ay] = this.cam.screenToWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const [bx, by] = this.cam.screenToWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const ids: number[] = [];
    let military = false;
    for (const u of this.world.units) {
      if (!u.alive || u.faction !== this.faction) continue;
      const cy = u.y - 5;
      if (u.x + u.radius >= ax && u.x - u.radius <= bx && cy + 6 >= ay && cy - 6 <= by) {
        ids.push(u.id);
        military = true;
      }
    }
    void military;
    if (ids.length) {
      this.sel.setUnits(ids, this.shift);
      this.hooks.selected();
    } else if (!this.shift && this.touch === false) {
      this.sel.clear();
      this.hooks.selected();
    }
    if (this.mode === 'select') {
      this.mode = 'default';
      this.hooks.modeConsumed?.('select');
    }
  }

  /**
   * Touch press-and-hold released in place: on one of your soldiers, select every soldier of that
   * type nearby; with troops selected, advance there fighting (or attack the enemy held on).
   */
  private contextAction(p: Ptr) {
    const [wx, wy] = this.cam.screenToWorld(p.sx, p.sy);
    const own = this.pickUnit(p.sx, p.sy, true);
    const enemy = this.pickUnit(p.sx, p.sy, false, true);
    if (this.sel.units.size > 0 && !(own && this.sel.units.has(own.id))) {
      if (enemy) this.hooks.order('attack', enemy.x, enemy.y, enemy);
      else this.hooks.order('attackMove', wx, wy);
      return;
    }
    if (own && this.hooks.selectSameType) {
      this.hooks.selectSameType(own);
      this.hooks.selected();
    }
  }

  private tap(p: Ptr, e: PointerEvent) {
    const x = p.sx;
    const y = p.sy;
    const [wx, wy] = this.cam.screenToWorld(x, y);
    const isMouse = p.type === 'mouse';
    const now = performance.now();
    const own = this.pickUnit(x, y, true);
    const enemy = this.pickUnit(x, y, false, true);
    const hasSel = this.sel.units.size > 0;

    if ((this.mode === 'rally' || this.mode === 'strike') && (!isMouse || p.button === 0)) {
      const m = this.mode;
      if (this.hooks.groundTarget?.(m, wx, wy)) {
        this.mode = 'default';
        this.hooks.modeConsumed?.(m);
      }
      return;
    }
    // explicit command modes from the action bar / hotkeys
    if ((this.mode === 'move' || this.mode === 'attack') && hasSel && (!isMouse || p.button === 0)) {
      if (this.mode === 'attack') {
        if (enemy) this.hooks.order('attack', enemy.x, enemy.y, enemy);
        else this.hooks.order('attackMove', wx, wy);
      } else this.hooks.order('move', wx, wy);
      const m = this.mode;
      this.mode = 'default';
      this.hooks.modeConsumed?.(m);
      return;
    }

    if (isMouse) {
      if (p.button === 2) {
        if (!hasSel && this.sel.building && this.hooks.groundTarget?.('rally', wx, wy)) return;
        if (hasSel) {
          if (enemy) this.hooks.order('attack', enemy.x, enemy.y, enemy);
          else this.hooks.order('move', wx, wy);
        }
        return;
      }
      if (p.button !== 0) return;
      // left click: select
      if (own) {
        const dbl = now - this.lastTap.t < 320 && this.lastTap.unit === own.id;
        this.lastTap = { t: now, x, y, unit: own.id };
        if (dbl && this.hooks.selectSameType) this.hooks.selectSameType(own);
        else if (e.shiftKey) this.sel.toggleUnit(own.id);
        else this.sel.setUnits([own.id]);
        this.hooks.selected();
        return;
      }
      this.lastTap = { t: now, x, y, unit: 0 };
      const s = this.hooks.pickStructure(wx, wy);
      if (s) {
        if (s.kind === 'plot') this.hooks.plotTapped?.(s.region, s.plot);
        else if (s.kind === 'building') this.sel.selectBuilding(s.id, s.region);
        else this.sel.selectRegion(s.id);
        this.hooks.selected();
        return;
      }
      if (enemy) {
        // inspect enemy (single select of foreign unit is shown but not commandable)
        this.sel.clear();
        this.hooks.selected();
        return;
      }
      if (!e.shiftKey) {
        this.sel.clear();
        this.hooks.selected();
      }
      return;
    }

    // ---- touch tap
    if (own) {
      const dbl = now - this.lastTap.t < 350 && this.lastTap.unit === own.id;
      this.lastTap = { t: now, x, y, unit: own.id };
      if (dbl && this.hooks.selectSameType) this.hooks.selectSameType(own);
      else if (hasSel && this.sel.units.has(own.id) && this.sel.units.size > 1) this.sel.setUnits([own.id]);
      else if (hasSel && !this.sel.units.has(own.id) && this.mode === 'default' && this.shift) this.sel.toggleUnit(own.id);
      else this.sel.setUnits([own.id]);
      this.hooks.selected();
      return;
    }
    this.lastTap = { t: now, x, y, unit: 0 };
    if (hasSel) {
      if (enemy) this.hooks.order('attack', enemy.x, enemy.y, enemy);
      else {
        // tapping an own structure while units are selected still moves there (garrison/defend)
        this.hooks.order('move', wx, wy);
      }
      return;
    }
    const s = this.hooks.pickStructure(wx, wy);
    if (s) {
      if (s.kind === 'plot') this.hooks.plotTapped?.(s.region, s.plot);
      else if (s.kind === 'building') this.sel.selectBuilding(s.id, s.region);
      else this.sel.selectRegion(s.id);
      this.hooks.selected();
      return;
    }
    // open ground with nothing selected: show whose land this is (phones have no hover);
    // a second tap on open ground clears it
    const m = this.world.map;
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (this.sel.region < 0 && !this.sel.building && tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && (this.faction < 0 || this.world.vis.isExplored(this.faction as FactionId, wx, wy))) {
      this.sel.selectRegion(m.region[ty * m.w + tx]);
      this.hooks.selected();
      return;
    }
    this.sel.clear();
    this.hooks.selected();
  }
}

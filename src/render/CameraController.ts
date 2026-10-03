import type Phaser from 'phaser';
import { clamp } from '../core/math';

export type ZoomPreset = 'strategic' | 'normal' | 'close';

/**
 * RTS camera: smooth pan with inertia, zoom toward a focus point, named zoom presets,
 * edge scrolling, keyboard panning, scripted fly-to for alerts/cinematics and gentle shake.
 * `zoom` is in CSS pixels per world pixel; the Phaser camera zoom also folds in devicePixelRatio.
 */
export class CameraController {
  x: number;
  y: number;
  zoom = 2;
  targetZoom = 2;
  vx = 0;
  vy = 0;
  minZoom = 0.35;
  maxZoom = 5;
  dpr = 1;
  sensitivity = 1;
  edgeScroll = true;
  shakeEnabled = true;
  private zoomFocus: { sx: number; sy: number } | null = null;
  private fly: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; dur: number; ease: (t: number) => number } | null = null;
  private shakeT = 0;
  private shakeMag = 0;
  keys = { up: false, down: false, left: false, right: false };
  pointerEdge = { x: -1, y: -1 };
  dragging = false;

  constructor(
    private cam: Phaser.Cameras.Scene2D.Camera,
    private worldW: number,
    private worldH: number,
  ) {
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  /** CSS viewport size */
  get viewW() {
    return this.cam.width / this.dpr;
  }
  get viewH() {
    return this.cam.height / this.dpr;
  }

  /** "normal" zoom adapts to the screen so phones see a sensible slice of the battlefield */
  normalZoom() {
    return Math.max(1.35, Math.min(2.4, Math.min(this.viewW / 600, this.viewH / 330)));
  }

  presetZoom(p: ZoomPreset) {
    return p === 'strategic' ? Math.max(this.minZoom, this.fitZoom() * 1.05) : p === 'normal' ? this.normalZoom() : this.normalZoom() * 1.75;
  }

  fitZoom() {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  currentPreset(): ZoomPreset {
    if (this.zoom < 1.05) return 'strategic';
    if (this.zoom < this.normalZoom() * 1.35) return 'normal';
    return 'close';
  }

  updateLimits() {
    this.minZoom = Math.max(0.25, this.fitZoom() * 0.95);
  }

  setZoomPreset(p: ZoomPreset) {
    this.targetZoom = this.presetZoom(p);
    this.zoomFocus = null;
  }

  /** zoom by factor toward screen point (css px) */
  zoomAt(factor: number, sx: number, sy: number, immediate = false) {
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    this.zoomFocus = { sx, sy };
    if (immediate) this.applyZoom(this.targetZoom);
  }

  private applyZoom(z: number) {
    if (this.zoomFocus) {
      // keep world point under focus fixed
      const { sx, sy } = this.zoomFocus;
      const wx = this.x + (sx - this.viewW / 2) / this.zoom;
      const wy = this.y + (sy - this.viewH / 2) / this.zoom;
      this.zoom = z;
      this.x = wx - (sx - this.viewW / 2) / this.zoom;
      this.y = wy - (sy - this.viewH / 2) / this.zoom;
    } else this.zoom = z;
  }

  /** pan by css px delta (drag) */
  panBy(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.fly = null;
  }

  fling(vx: number, vy: number) {
    // css px/s → world px/s
    this.vx = -vx / this.zoom;
    this.vy = -vy / this.zoom;
  }

  stopInertia() {
    this.vx = this.vy = 0;
  }

  flyTo(x: number, y: number, zoom?: number, dur = 0.8, ease?: (t: number) => number) {
    this.fly = {
      x0: this.x,
      y0: this.y,
      z0: this.zoom,
      x1: x,
      y1: y,
      z1: zoom ?? this.zoom,
      t: 0,
      dur,
      ease: ease ?? ((t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)),
    };
    this.vx = this.vy = 0;
  }

  get flying() {
    return !!this.fly;
  }

  cancelFly() {
    this.fly = null;
  }

  shake(mag: number, dur = 0.25) {
    if (!this.shakeEnabled) return;
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.viewW / 2) / this.zoom, this.y + (sy - this.viewH / 2) / this.zoom];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.viewW / 2, (wy - this.y) * this.zoom + this.viewH / 2];
  }

  update(dt: number) {
    if (this.fly) {
      const f = this.fly;
      f.t += dt;
      const k = f.ease(Math.min(1, f.t / f.dur));
      this.x = f.x0 + (f.x1 - f.x0) * k;
      this.y = f.y0 + (f.y1 - f.y0) * k;
      this.zoom = f.z0 + (f.z1 - f.z0) * k;
      this.targetZoom = this.zoom;
      if (f.t >= f.dur) this.fly = null;
    } else {
      // zoom easing
      if (Math.abs(this.targetZoom - this.zoom) > 0.0005) {
        const z = this.zoom + (this.targetZoom - this.zoom) * Math.min(1, dt * 14);
        this.applyZoom(z);
      }
      // keyboard + edge scroll
      const spd = (900 * this.sensitivity) / this.zoom;
      let kx = 0;
      let ky = 0;
      if (this.keys.left) kx -= 1;
      if (this.keys.right) kx += 1;
      if (this.keys.up) ky -= 1;
      if (this.keys.down) ky += 1;
      if (this.edgeScroll && !this.dragging && this.pointerEdge.x >= 0) {
        const m = 14;
        if (this.pointerEdge.x < m) kx -= 1;
        if (this.pointerEdge.x > this.viewW - m) kx += 1;
        if (this.pointerEdge.y < m) ky -= 1;
        if (this.pointerEdge.y > this.viewH - m) ky += 1;
      }
      if (kx || ky) {
        this.x += kx * spd * dt;
        this.y += ky * spd * dt;
        this.vx = this.vy = 0;
      }
      // inertia
      if (!this.dragging && (this.vx || this.vy)) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const decay = Math.exp(-dt * 5);
        this.vx *= decay;
        this.vy *= decay;
        if (Math.hypot(this.vx, this.vy) * this.zoom < 8) this.vx = this.vy = 0;
      }
    }
    // clamp to world with margin
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    // a little slack so the edge can clear the HUD; the edge itself fades to dark
    const marginX = Math.min(halfW, 12);
    const marginY = Math.min(halfH, 18);
    if (halfW * 2 > this.worldW + marginX * 2) this.x = this.worldW / 2;
    else this.x = clamp(this.x, halfW - marginX, this.worldW - halfW + marginX);
    if (halfH * 2 > this.worldH + marginY * 2) this.y = this.worldH / 2;
    else this.y = clamp(this.y, halfH - marginY, this.worldH - halfH + marginY);
    // apply to Phaser camera
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT * 4);
      sx = (Math.random() - 0.5) * m;
      sy = (Math.random() - 0.5) * m;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    this.cam.setZoom(this.zoom * this.dpr);
    this.cam.centerOn(this.x + sx / this.zoom, this.y + sy / this.zoom);
  }

  /** visible world rect */
  view(margin = 0) {
    const halfW = this.viewW / 2 / this.zoom + margin;
    const halfH = this.viewH / 2 / this.zoom + margin;
    return { x0: this.x - halfW, y0: this.y - halfH, x1: this.x + halfW, y1: this.y + halfH };
  }
}

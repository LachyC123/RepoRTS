/**
 * AudioManager — fully procedural WebAudio sound engine (no asset files).
 *
 * Graph:
 *   voices ─► sfxBus ─┐
 *   ambience ─► ambienceBus ─► sfxBus
 *   music ─► musicBus ─┼─► masterBus ─► compressor ─► limiter ─► destination
 *   reverbIn ─► convolver ─► reverbReturn ─┘
 *
 * Safe to import in Node / headless: nothing touches `window` until init().
 * Every public method is a no-op (and never throws) before init() or when
 * WebAudio is unavailable.
 */
import { Ambience, AmbienceLevels } from './ambience';
import { SFX, SFX_NAMES, SfxName } from './sfx';
import { SynthKit, clamp, createNoiseBuffers, createReverbIR } from './synth';

export type { SfxName } from './sfx';
export type { AmbienceLevels } from './ambience';
export { SFX_NAMES } from './sfx';

export interface PlayOptions {
  /** 0..1 (can exceed 1 slightly for emphasis). */
  volume?: number;
  /** -1..1 manual stereo pan (ignored when x/y given). */
  pan?: number;
  /** Pitch/playback rate multiplier. */
  rate?: number;
  /** World-space position in px; enables distance attenuation & panning. */
  x?: number;
  y?: number;
}

const THROTTLE_WINDOW = 0.08; // s
const DEFAULT_MAX_PER_NAME = 5;
const MAX_VOICES = 32;
const UI_EXTRA_VOICES = 8;
const MUSIC_SCALE = 0.9; // music stems are mixed quiet; keeps music below SFX at equal slider values
const CULL_RADIUS = 3.2; // in half-screen units

type WebkitWindow = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

export class AudioManager {
  /** The AudioContext, or null before init()/when unavailable. */
  ctx: AudioContext | null = null;
  masterBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  sfxBus: GainNode | null = null;
  ambienceBus: GainNode | null = null;
  /** Reverb send input; connect a (quiet) gain to it for wet signal. */
  reverbIn: GainNode | null = null;
  /** Shared synthesis kit (noise buffers etc.). */
  kit: SynthKit | null = null;

  private amb: Ambience | null = null;
  private vol = { master: 0.8, music: 0.6, sfx: 0.9 };
  private listener = { x: 0, y: 0, w: 1280, h: 720, zoom: 1, set: false };
  private recent = new Map<SfxName, number[]>();
  private voices = 0;
  private pendingAmbience: AmbienceLevels = {};
  private initCallbacks: Array<() => void> = [];
  private failed = false;
  private userSuspended = false;

  /** True when WebAudio exists in this environment. */
  get available(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as WebkitWindow;
    return typeof w.AudioContext === 'function' || typeof w.webkitAudioContext === 'function';
  }

  /** True once the context exists and is running. */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get activeVoices(): number {
    return this.voices;
  }

  /** Register a callback fired once the context has been created (immediately if it already was). */
  onInit(cb: () => void): void {
    if (this.ctx) {
      try {
        cb();
      } catch (e) {
        console.warn('[audio] onInit callback failed', e);
      }
    } else {
      this.initCallbacks.push(cb);
    }
  }

  init(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended' && !this.userSuspended) void this.ctx.resume().catch(() => {});
        return;
      }
      if (this.failed || !this.available) return;
      const w = window as unknown as WebkitWindow;
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.buildGraph(ctx);
      // iOS unlock: play a one-sample silent buffer inside the gesture.
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      const cbs = this.initCallbacks;
      this.initCallbacks = [];
      for (const cb of cbs) {
        try {
          cb();
        } catch (e) {
          console.warn('[audio] onInit callback failed', e);
        }
      }
    } catch (e) {
      console.warn('[audio] WebAudio init failed; audio disabled', e);
      this.failed = true;
      this.ctx = null;
    }
  }

  private buildGraph(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    comp.connect(limiter);
    limiter.connect(ctx.destination);

    this.masterBus = ctx.createGain();
    this.masterBus.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.masterBus);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.masterBus);
    this.ambienceBus = ctx.createGain();
    this.ambienceBus.connect(this.sfxBus);

    this.reverbIn = ctx.createGain();
    try {
      const conv = ctx.createConvolver();
      conv.buffer = createReverbIR(ctx);
      const ret = ctx.createGain();
      ret.gain.value = 0.5;
      this.reverbIn.connect(conv);
      conv.connect(ret);
      ret.connect(this.masterBus);
    } catch {
      /* reverb optional */
    }

    const n = createNoiseBuffers(ctx);
    this.kit = { ctx, white: n.white, pink: n.pink, brown: n.brown, reverb: this.reverbIn };
    this.amb = new Ambience(this.kit, this.ambienceBus);
    this.amb.setLevels(this.pendingAmbience);
    this.applyVolumes(0);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const f = (v: number, d: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : d);
    this.vol = { master: f(master, this.vol.master), music: f(music, this.vol.music), sfx: f(sfx, this.vol.sfx) };
    this.applyVolumes(0.05);
  }

  getVolumes(): { master: number; music: number; sfx: number } {
    return { ...this.vol };
  }

  private applyVolumes(tc: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterBus || !this.musicBus || !this.sfxBus) return;
    try {
      const now = ctx.currentTime;
      const set = (p: AudioParam, v: number): void => {
        if (tc <= 0) p.value = v;
        else p.setTargetAtTime(v, now, tc);
      };
      set(this.masterBus.gain, this.vol.master);
      set(this.musicBus.gain, this.vol.music * MUSIC_SCALE);
      set(this.sfxBus.gain, this.vol.sfx);
    } catch {
      /* ignore */
    }
  }

  setListener(x: number, y: number, viewWidth: number, viewHeight: number, zoom: number): void {
    const L = this.listener;
    if (Number.isFinite(x)) L.x = x;
    if (Number.isFinite(y)) L.y = y;
    if (Number.isFinite(viewWidth) && viewWidth > 1) L.w = viewWidth;
    if (Number.isFinite(viewHeight) && viewHeight > 1) L.h = viewHeight;
    if (Number.isFinite(zoom) && zoom > 0) L.zoom = zoom;
    L.set = true;
  }

  /**
   * Compute [gain, pan, lowpassHz|0] for a world position, or null if culled.
   * Inside the view: full-ish volume; beyond it falls off quickly; > CULL_RADIUS culled.
   */
  spatial(x: number, y: number): [number, number, number] | null {
    const L = this.listener;
    if (!L.set) return [1, 0, 0];
    const hw = Math.max(64, L.w * 0.5);
    const hh = Math.max(64, L.h * 0.5);
    const dx = x - L.x;
    const dy = y - L.y;
    const r = Math.sqrt((dx / hw) * (dx / hw) + (dy / hh) * (dy / hh));
    if (r > CULL_RADIUS) return null;
    let g: number;
    if (r <= 1) g = 1 - 0.3 * r;
    else {
      const k = 1 + (r - 1) * 1.6;
      g = 0.7 / (k * k);
    }
    // Zoomed far out: everything a little quieter / less detailed.
    g *= clamp(0.55 + 0.45 * L.zoom, 0.55, 1);
    const pan = clamp(dx / (hw * 1.2), -1, 1) * 0.8;
    const lp = r > 1.1 ? clamp(9000 / (r * r), 700, 9000) : 0;
    return [g, pan, lp];
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const kit = this.kit;
    if (!ctx || !kit || !this.sfxBus || ctx.state !== 'running') return;
    const def = SFX[name];
    if (!def) return;
    try {
      let vol = (opts.volume ?? 1) * (def.gain ?? 1);
      let pan = clamp(opts.pan ?? 0, -1, 1);
      let lp = 0;
      if (typeof opts.x === 'number' && typeof opts.y === 'number' && Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
        const s = this.spatial(opts.x, opts.y);
        if (!s) return;
        vol *= s[0];
        pan = s[1];
        lp = s[2];
      }
      if (!(vol > 0.008)) return;

      // Throttling
      const now = ctx.currentTime;
      const cap = def.ui ? MAX_VOICES + UI_EXTRA_VOICES : MAX_VOICES;
      if (this.voices >= cap) return;
      let list = this.recent.get(name);
      if (!list) {
        list = [];
        this.recent.set(name, list);
      }
      while (list.length && (list[0] as number) < now - THROTTLE_WINDOW) list.shift();
      const maxN = def.max ?? DEFAULT_MAX_PER_NAME;
      if (list.length >= maxN) return;
      list.push(now);
      // Many simultaneous copies of one sound: lower each a bit so the sum stays tame.
      if (list.length > 1) vol *= 1 / Math.sqrt(list.length);

      const vary = def.vary ?? 0.05;
      const rate = clamp((opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary), 0.25, 4);
      const t = now + 0.003 + Math.random() * (def.jitter ?? 0.015);

      const vg = ctx.createGain();
      vg.gain.value = vol;
      const chain: AudioNode[] = [vg];
      let tail: AudioNode = vg;
      if (lp > 0) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lp;
        tail.connect(f);
        tail = f;
        chain.push(f);
      }
      if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        tail.connect(p);
        tail = p;
        chain.push(p);
      }
      tail.connect(this.sfxBus);
      let send: GainNode | null = null;
      if (def.send && this.reverbIn) {
        send = ctx.createGain();
        send.gain.value = def.send;
        vg.connect(send);
        send.connect(this.reverbIn);
        chain.push(send);
      }

      const end = def.fn(kit, vg, t, rate);
      this.voices++;
      const ms = Math.max(50, (end - now + 0.15) * 1000);
      setTimeout(() => {
        this.voices = Math.max(0, this.voices - 1);
        for (const n of chain) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      }, ms);
    } catch (e) {
      console.warn('[audio] play failed', name, e);
    }
  }

  /** Convenience: positional play. */
  playAt(name: SfxName, x: number, y: number, opts: Omit<PlayOptions, 'x' | 'y'> = {}): void {
    this.play(name, { ...opts, x, y });
  }

  setAmbience(levels: AmbienceLevels): void {
    if (!levels) return;
    this.pendingAmbience = { ...this.pendingAmbience, ...levels };
    try {
      this.amb?.setLevels(levels);
    } catch {
      /* ignore */
    }
  }

  /** Per-frame tick. `dt` in seconds (values > 1 are treated as milliseconds). */
  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const d = Number.isFinite(dt) ? clamp(dt > 1 ? dt / 1000 : dt, 0, 0.25) : 0.016;
      this.amb?.update(d);
    } catch (e) {
      console.warn('[audio] update failed', e);
    }
  }

  suspend(): void {
    this.userSuspended = true;
    try {
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    this.userSuspended = false;
    try {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** All available SFX names (handy for debug menus). */
  get sfxNames(): readonly SfxName[] {
    return SFX_NAMES;
  }
}

export const audio = new AudioManager();

/**
 * Continuous ambience beds (wind, river, rain, town murmur, distant battle)
 * plus randomly scheduled one-shot events (birdsong, hammer, dog, clashes, shouts).
 */
import { SFX } from './sfx';
import { SynthKit, clamp, noise, partials, pick, rand, tone } from './synth';

export interface AmbienceLevels {
  wind?: number;
  birds?: number;
  river?: number;
  town?: number;
  battle?: number;
  rain?: number;
}

type BedName = 'wind' | 'river' | 'rain' | 'town' | 'battle';
type LayerName = BedName | 'birds';

interface Bed {
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Per-bed modulation hook called every frame while running. */
  mod: (now: number, dt: number) => void;
}

const BED_SCALE: Record<BedName, number> = { wind: 0.24, river: 0.22, rain: 0.12, town: 0.35, battle: 0.22 };
const RAMP_TC = 1.2; // seconds (setTargetAtTime time constant)

export class Ambience {
  private readonly k: SynthKit;
  private readonly out: AudioNode;
  /** Lowpassed bus for distant one-shot events. */
  private readonly distant: BiquadFilterNode;
  private readonly target: Record<LayerName, number> = { wind: 0, birds: 0, river: 0, town: 0, battle: 0, rain: 0 };
  private readonly beds: Partial<Record<BedName, Bed>> = {};
  private readonly zeroSince: Partial<Record<BedName, number>> = {};
  private readonly timers: Record<string, number> = { bird: 1, hammer: 3, dog: 8, clash: 0.5, shout: 2, drip: 0.2, thud: 1.5 };
  private events = 0;

  constructor(k: SynthKit, out: AudioNode) {
    this.k = k;
    this.out = out;
    const c = k.ctx;
    this.distant = c.createBiquadFilter();
    this.distant.type = 'lowpass';
    this.distant.frequency.value = 2200;
    this.distant.connect(out);
  }

  setLevels(l: AmbienceLevels): void {
    for (const key of Object.keys(this.target) as LayerName[]) {
      const v = l[key];
      if (typeof v === 'number' && Number.isFinite(v)) this.target[key] = clamp(v, 0, 1);
    }
  }

  update(dt: number): void {
    const now = this.k.ctx.currentTime;
    for (const name of Object.keys(BED_SCALE) as BedName[]) {
      const lvl = this.target[name];
      let bed = this.beds[name];
      if (lvl > 0.001) {
        delete this.zeroSince[name];
        if (!bed) {
          bed = this.build(name);
          this.beds[name] = bed;
        }
        bed.out.gain.setTargetAtTime(lvl * BED_SCALE[name], now, RAMP_TC);
        bed.mod(now, dt);
      } else if (bed) {
        bed.out.gain.setTargetAtTime(0, now, RAMP_TC * 0.6);
        const since = this.zeroSince[name] ?? now;
        this.zeroSince[name] = since;
        if (now - since > 6) this.destroy(name, bed);
      }
    }
    this.events = 0;
    this.scheduleEvents(dt, now);
  }

  dispose(): void {
    for (const name of Object.keys(this.beds) as BedName[]) {
      const b = this.beds[name];
      if (b) this.destroy(name, b);
    }
  }

  // ---------------------------------------------------------------- beds ----

  private destroy(name: BedName, bed: Bed): void {
    for (const s of bed.srcs) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
      s.disconnect();
    }
    for (const n of bed.nodes) n.disconnect();
    bed.out.disconnect();
    delete this.beds[name];
    delete this.zeroSince[name];
  }

  private loopNoise(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.k.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.k.ctx.currentTime, Math.random() * buf.duration);
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.k.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gain(v: number): GainNode {
    const g = this.k.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private build(name: BedName): Bed {
    const c = this.k.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(this.out);
    const srcs: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    let mod: Bed['mod'] = () => {};

    if (name === 'wind') {
      const s = this.loopNoise(this.k.brown);
      const lp = this.filter('lowpass', 450, 0.6);
      const gust = this.gain(0.6);
      const s2 = this.loopNoise(this.k.pink, 0.7);
      const bp = this.filter('bandpass', 700, 5);
      const g2 = this.gain(0.05);
      s.connect(lp).connect(gust).connect(out);
      s2.connect(bp).connect(g2).connect(gust);
      srcs.push(s, s2);
      nodes.push(lp, gust, bp, g2);
      let next = 0;
      mod = (now) => {
        if (now < next) return;
        const g = rand(0.25, 1);
        const tc = rand(0.8, 2.2);
        lp.frequency.setTargetAtTime(250 + g * 750, now, tc);
        gust.gain.setTargetAtTime(0.35 + g * 0.75, now, tc);
        bp.frequency.setTargetAtTime(450 + g * 700, now, tc);
        next = now + rand(1.5, 5);
      };
    } else if (name === 'river') {
      const s = this.loopNoise(this.k.white);
      const lp = this.filter('lowpass', 1400);
      const bp = this.filter('bandpass', 520, 0.8);
      const s2 = this.loopNoise(this.k.pink, 1.1);
      const bp2 = this.filter('bandpass', 600, 6);
      const g2 = this.gain(0.9);
      s.connect(lp).connect(bp).connect(out);
      s2.connect(bp2).connect(g2).connect(out);
      srcs.push(s, s2);
      nodes.push(lp, bp, bp2, g2);
      let next = 0;
      mod = (now) => {
        if (now < next) return;
        bp2.frequency.setTargetAtTime(rand(320, 1100), now, 0.04);
        g2.gain.setTargetAtTime(rand(0.4, 1.3), now, 0.05);
        next = now + rand(0.07, 0.22);
      };
    } else if (name === 'rain') {
      const s = this.loopNoise(this.k.white);
      const hp = this.filter('highpass', 1200);
      const lp = this.filter('lowpass', 7000);
      const s2 = this.loopNoise(this.k.pink);
      const lp2 = this.filter('lowpass', 500);
      const g2 = this.gain(0.6);
      s.connect(hp).connect(lp).connect(out);
      s2.connect(lp2).connect(g2).connect(out);
      srcs.push(s, s2);
      nodes.push(hp, lp, lp2, g2);
    } else if (name === 'town') {
      // Crowd murmur: pink noise through vowel-like formants whose levels jitter like syllables.
      const s = this.loopNoise(this.k.pink);
      const lp = this.filter('lowpass', 1800);
      s.connect(lp);
      const forms: Array<{ f: BiquadFilterNode; g: GainNode }> = [];
      for (const freq of [380, 850, 1600]) {
        const f = this.filter('bandpass', freq, 5);
        const g = this.gain(0.5);
        lp.connect(f).connect(g).connect(out);
        forms.push({ f, g });
        nodes.push(f, g);
      }
      srcs.push(s);
      nodes.push(lp);
      let next = 0;
      mod = (now) => {
        if (now < next) return;
        for (const fm of forms) {
          const base = fm.f.frequency.value;
          fm.g.gain.setTargetAtTime(rand(0.15, 1.1), now, 0.05);
          fm.f.frequency.setTargetAtTime(clamp(base * rand(0.85, 1.15), 250, 2200), now, 0.1);
        }
        next = now + rand(0.12, 0.35);
      };
    } else {
      // battle: distant roar
      const s = this.loopNoise(this.k.brown);
      const bp = this.filter('bandpass', 380, 0.8);
      const swell = this.gain(0.8);
      const s2 = this.loopNoise(this.k.pink);
      const bp2 = this.filter('bandpass', 900, 3);
      const g2 = this.gain(0.25);
      s.connect(bp).connect(swell).connect(out);
      s2.connect(bp2).connect(g2).connect(swell);
      srcs.push(s, s2);
      nodes.push(bp, swell, bp2, g2);
      let next = 0;
      mod = (now) => {
        if (now < next) return;
        swell.gain.setTargetAtTime(rand(0.5, 1.2), now, 0.8);
        next = now + rand(1, 3);
      };
    }
    return { out, srcs, nodes, mod };
  }

  // -------------------------------------------------------------- events ----

  private panned(pan: number, gain: number, dest: AudioNode): GainNode {
    const c = this.k.ctx;
    const g = c.createGain();
    g.gain.value = gain;
    const ctx = c as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      p.connect(dest);
      setTimeout(() => p.disconnect(), 4000);
    } else {
      g.connect(dest);
    }
    setTimeout(() => g.disconnect(), 4000);
    return g;
  }

  private tickTimer(key: string, dt: number, level: number, min: number, max: number): boolean {
    if (level <= 0.001) return false;
    const v = (this.timers[key] ?? 0) - dt;
    if (v > 0) {
      this.timers[key] = v;
      return false;
    }
    this.timers[key] = rand(min, max) / Math.max(0.2, level);
    return this.events++ < 4;
  }

  private scheduleEvents(dt: number, now: number): void {
    const T = this.target;
    const t = now + 0.05;
    if (this.tickTimer('bird', dt, T.birds, 0.8, 4.5)) this.bird(t, T.birds);
    if (this.tickTimer('drip', dt, T.rain, 0.05, 0.3)) {
      const g = this.panned(rand(-0.9, 0.9), 0.05 * T.rain, this.out);
      tone(this.k, g, t, { freq: rand(1800, 4200), freqEnd: rand(900, 1500), decay: 0.02, peak: 0.6 });
    }
    if (this.tickTimer('hammer', dt, T.town, 2, 7)) {
      const g = this.panned(rand(-0.8, 0.8), 0.25 * T.town, this.distant);
      const n = Math.floor(rand(2, 5));
      for (let i = 0; i < n; i++) SFX.construction_hammer.fn(this.k, g, t + i * rand(0.35, 0.5), rand(0.9, 1.1));
    }
    if (this.tickTimer('dog', dt, T.town, 8, 22)) {
      const g = this.panned(rand(-0.9, 0.9), 0.12 * T.town, this.distant);
      const n = Math.floor(rand(1, 4));
      const f = rand(380, 520);
      for (let i = 0; i < n; i++) this.bark(g, t + i * rand(0.22, 0.35), f);
    }
    if (this.tickTimer('clash', dt, T.battle, 0.12, 0.6)) {
      const g = this.panned(rand(-0.9, 0.9), rand(0.08, 0.2) * T.battle, this.distant);
      SFX[pick(['sword_clash', 'sword_clash', 'shield_block', 'sword_hit'] as const)].fn(this.k, g, t, rand(0.85, 1.1));
    }
    if (this.tickTimer('shout', dt, T.battle, 1.5, 5)) {
      const g = this.panned(rand(-0.9, 0.9), 0.1 * T.battle, this.distant);
      SFX[pick(['battle_cry', 'unit_death', 'horse_neigh'] as const)].fn(this.k, g, t, rand(0.85, 1.1));
    }
    if (this.tickTimer('thud', dt, T.battle, 2, 8)) {
      const g = this.panned(rand(-0.9, 0.9), 0.15 * T.battle, this.distant);
      SFX.catapult_impact.fn(this.k, g, t, rand(0.8, 1));
    }
  }

  private bark(out: AudioNode, t: number, f: number): void {
    tone(this.k, out, t, { type: 'sawtooth', freq: f * 1.3, freqEnd: f * 0.7, glide: 0.12, attack: 0.01, decay: 0.12, peak: 0.6, filter: 'bandpass', ffreq: 900, fq: 2 });
    noise(this.k, out, t, { color: 'pink', filter: 'bandpass', ffreq: 1200, fq: 2, decay: 0.08, peak: 0.25 });
  }

  /** A synthesized bird call: tweets, trills or warbles. */
  private bird(t: number, level: number): void {
    const out = this.panned(rand(-0.9, 0.9), rand(0.03, 0.07) * (0.5 + level * 0.5), this.out);
    const k = this.k;
    const kind = Math.random();
    const base = rand(2600, 4200);
    if (kind < 0.45) {
      // tweets: a few rapid upward/downward sweeps
      const n = Math.floor(rand(2, 5));
      const up = Math.random() < 0.5;
      for (let i = 0; i < n; i++) {
        const tt = t + i * rand(0.09, 0.14);
        tone(k, out, tt, { freq: up ? base : base * 1.4, freqEnd: up ? base * 1.45 : base * 0.95, glide: 0.05, attack: 0.005, decay: 0.05, peak: 0.8 });
      }
    } else if (kind < 0.75) {
      // trill: fast frequency modulation
      const c = k.ctx;
      const dur = rand(0.35, 0.8);
      const osc = c.createOscillator();
      osc.frequency.value = base;
      const lfo = c.createOscillator();
      lfo.frequency.value = rand(18, 30);
      const lg = c.createGain();
      lg.gain.value = base * 0.12;
      lfo.connect(lg).connect(osc.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.04);
      g.gain.setValueAtTime(0.6, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
      osc.onended = () => {
        osc.disconnect();
        lfo.disconnect();
        lg.disconnect();
        g.disconnect();
      };
    } else {
      // warble: descending melodic phrase (cuckoo-ish / blackbird-ish)
      const steps = Math.floor(rand(3, 6));
      let f = base * 0.7;
      for (let i = 0; i < steps; i++) {
        const tt = t + i * 0.16;
        const nf = f * rand(0.8, 1.2);
        tone(k, out, tt, { freq: f, freqEnd: nf, glide: 0.1, attack: 0.01, decay: 0.12, peak: 0.6, vibRate: 40, vibDepth: f * 0.02 });
        f = nf;
      }
      if (Math.random() < 0.3) partials(k, out, t, base, [1, 2], [0.04, 0.02], [0.2, 0.05]);
    }
  }
}

/**
 * Low-level WebAudio synthesis helpers shared by SFX, ambience and music.
 * Everything here is pure scheduling code: nothing touches `window` at import time.
 */

export interface SynthKit {
  ctx: BaseAudioContext;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  /** Optional reverb send input (null when rendering offline / unavailable). */
  reverb: AudioNode | null;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const SILENT = 0.0001;

/** Disconnect a list of nodes once `src` has ended. */
export function cleanupOnEnd(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    src.disconnect();
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  };
}

/** Build 2 s of white / pink / brown noise, reused by every voice. */
export function createNoiseBuffers(ctx: BaseAudioContext): { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } {
  const len = Math.floor(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const pink = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x * 0.9;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  // Crossfade the loop seam so looped beds don't click.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (const d of [w, p, b]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = (d[len - fade + i] as number) * (1 - k) + (d[i] as number) * k;
    }
  }
  return { white, pink, brown };
}

/** Small synthetic room/hall impulse response. */
export function createReverbIR(ctx: BaseAudioContext, seconds = 1.8, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // lowpassed noise so the tail is warm, not hissy
      lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
      d[i] = lp * Math.pow(1 - k, decay) * (i < 200 ? i / 200 : 1);
    }
  }
  return ir;
}

function noiseBuf(k: SynthKit, c: NoiseColor | undefined): AudioBuffer {
  return c === 'pink' ? k.pink : c === 'brown' ? k.brown : k.white;
}

// ---------------------------------------------------------------- tone ----

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  /** Time (s) for the pitch glide; defaults to the decay time. */
  glide?: number;
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  detune?: number;
  filter?: BiquadFilterType;
  ffreq?: number;
  ffreqEnd?: number;
  fq?: number;
  vibRate?: number;
  /** Vibrato depth in Hz. */
  vibDepth?: number;
}

/** One enveloped oscillator, optionally filtered. Returns end time. */
export function tone(k: SynthKit, out: AudioNode, t: number, o: ToneOpts): number {
  const c = k.ctx;
  const attack = o.attack ?? 0.003;
  const hold = o.hold ?? 0;
  const end = t + attack + hold + o.decay;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glide ?? attack + hold + o.decay));
  }
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(Math.max(SILENT * 2, o.peak), t + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(SILENT * 2, o.peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(SILENT, end);
  const nodes: AudioNode[] = [g];
  let node: AudioNode = osc;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.ffreq ?? 1000, t);
    if (o.ffreqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ffreqEnd), end);
    f.Q.value = o.fq ?? 0.7;
    node.connect(f);
    node = f;
    nodes.push(f);
  }
  node.connect(g);
  g.connect(out);
  let lfo: OscillatorNode | null = null;
  if (o.vibRate && o.vibDepth) {
    lfo = c.createOscillator();
    lfo.frequency.value = o.vibRate;
    const lg = c.createGain();
    lg.gain.value = o.vibDepth;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.02);
    nodes.push(lg, lfo);
  }
  osc.start(t);
  osc.stop(end + 0.02);
  cleanupOnEnd(osc, nodes);
  return end;
}

// --------------------------------------------------------------- noise ----

export interface NoiseOpts {
  color?: NoiseColor;
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  filter?: BiquadFilterType;
  ffreq?: number;
  ffreqEnd?: number;
  fq?: number;
  /** Optional second filter in series. */
  filter2?: BiquadFilterType;
  f2freq?: number;
  rate?: number;
}

/** Enveloped, filtered noise burst. Returns end time. */
export function noise(k: SynthKit, out: AudioNode, t: number, o: NoiseOpts): number {
  const c = k.ctx;
  const attack = o.attack ?? 0.002;
  const hold = o.hold ?? 0;
  const end = t + attack + hold + o.decay;
  const src = c.createBufferSource();
  const buf = noiseBuf(k, o.color);
  src.buffer = buf;
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const g = c.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(Math.max(SILENT * 2, o.peak), t + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(SILENT * 2, o.peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(SILENT, end);
  const nodes: AudioNode[] = [g];
  let node: AudioNode = src;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.ffreq ?? 1000, t);
    if (o.ffreqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ffreqEnd), end);
    f.Q.value = o.fq ?? 0.7;
    node.connect(f);
    node = f;
    nodes.push(f);
  }
  if (o.filter2) {
    const f2 = c.createBiquadFilter();
    f2.type = o.filter2;
    f2.frequency.value = o.f2freq ?? 1000;
    node.connect(f2);
    node = f2;
    nodes.push(f2);
  }
  node.connect(g);
  g.connect(out);
  src.start(t, Math.random() * (buf.duration - 0.1));
  src.stop(end + 0.02);
  cleanupOnEnd(src, nodes);
  return end;
}

// ------------------------------------------------------------ partials ----

/** Inharmonic decaying sine partials (metal, bells). Returns end time. */
export function partials(
  k: SynthKit,
  out: AudioNode,
  t: number,
  base: number,
  ratios: readonly number[],
  decays: readonly number[],
  gains: readonly number[],
  attack = 0.001,
): number {
  let end = t;
  for (let i = 0; i < ratios.length; i++) {
    const e = tone(k, out, t, {
      freq: base * (ratios[i] as number),
      attack,
      decay: decays[i] ?? 0.1,
      peak: gains[i] ?? 0.02,
    });
    if (e > end) end = e;
  }
  return end;
}

/** Simple church/hand-bell. */
export function bell(k: SynthKit, out: AudioNode, t: number, freq: number, peak = 0.07, len = 0.6): number {
  return partials(k, out, t, freq, [1, 2.0, 2.76, 5.4], [len, len * 0.5, len * 0.33, len * 0.14], [peak, peak * 0.3, peak * 0.22, peak * 0.1]);
}

// ---------------------------------------------------- Karplus-Strong ----

const KS_SR = 22050;
let ksOwner: BaseAudioContext | null = null;
const ksCache = new Map<number, AudioBuffer>();

/** Cached Karplus-Strong plucked-string buffer near `freq`. */
export function ksBuffer(c: BaseAudioContext, freq: number): { buf: AudioBuffer; base: number } {
  if (ksOwner !== c) {
    ksCache.clear();
    ksOwner = c;
  }
  const N = Math.max(2, Math.round(KS_SR / freq - 0.5));
  const base = KS_SR / (N + 0.5);
  let buf = ksCache.get(N);
  if (!buf) {
    const t60 = clamp(2.6 * Math.sqrt(110 / base), 0.5, 2.8);
    const dur = Math.min(2.4, t60 * 0.9 + 0.2);
    const len = Math.floor(KS_SR * dur);
    buf = c.createBuffer(1, len, KS_SR);
    const d = buf.getChannelData(0);
    let prev = 0;
    let mean = 0;
    for (let i = 0; i <= N; i++) {
      prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
      d[i] = prev;
      mean += prev;
    }
    mean /= N + 1;
    for (let i = 0; i <= N; i++) d[i] = (d[i] as number) - mean;
    const damp = Math.pow(0.001, 1 / (t60 * base));
    for (let i = N + 1; i < len; i++) {
      d[i] = damp * 0.5 * ((d[i - N] as number) + (d[i - N - 1] as number));
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i] as number));
    const norm = peak > 0 ? 0.9 / peak : 1;
    const fadeStart = Math.floor(len * 0.85);
    for (let i = 0; i < len; i++) {
      const f = i > fadeStart ? 1 - (i - fadeStart) / (len - fadeStart) : 1;
      d[i] = (d[i] as number) * norm * f;
    }
    ksCache.set(N, buf);
  }
  return { buf, base };
}

/** Plucked string note (lute / harp). Returns end time. */
export function pluck(k: SynthKit, out: AudioNode, t: number, freq: number, peak: number, decay?: number): number {
  const c = k.ctx;
  const { buf, base } = ksBuffer(c, freq);
  const src = c.createBufferSource();
  src.buffer = buf;
  const rate = freq / base;
  src.playbackRate.value = rate;
  const natural = buf.duration / rate;
  const len = Math.min(natural, decay ?? natural);
  const g = c.createGain();
  g.gain.setValueAtTime(Math.max(SILENT * 2, peak), t);
  if (len < natural) {
    g.gain.setValueAtTime(Math.max(SILENT * 2, peak), t + len * 0.4);
    g.gain.exponentialRampToValueAtTime(SILENT, t + len);
  }
  src.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + len + 0.01);
  cleanupOnEnd(src, [g]);
  return t + len;
}

// ---------------------------------------------------------------- brass ----

/** Brass / horn voice: detuned saws with a filter envelope and late vibrato. */
export function brass(
  k: SynthKit,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  peak: number,
  bright = 1,
  bend = 0,
): number {
  const c = k.ctx;
  const attack = 0.06;
  const release = 0.18;
  const end = t + dur + release;
  const g = c.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.linearRampToValueAtTime(peak * 0.8, t + attack + 0.12);
  g.gain.setValueAtTime(peak * 0.8, t + dur);
  g.gain.exponentialRampToValueAtTime(SILENT, end);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(freq * 1.2, t);
  f.frequency.exponentialRampToValueAtTime(freq * 2 + 1600 * bright, t + attack);
  f.frequency.exponentialRampToValueAtTime(freq * 1.6 + 700 * bright, t + attack + 0.25);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 1.1), end);
  f.connect(g);
  g.connect(out);
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.2;
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.5));
  lg.gain.linearRampToValueAtTime(freq * 0.006, t + dur);
  lfo.connect(lg);
  const oscs: OscillatorNode[] = [];
  for (const det of [-7, 6]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = det;
    if (bend !== 0) {
      o.frequency.setValueAtTime(freq * Math.pow(2, bend / 1200), t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
    } else {
      o.frequency.setValueAtTime(freq, t);
    }
    lg.connect(o.frequency);
    o.connect(f);
    o.start(t);
    o.stop(end + 0.02);
    oscs.push(o);
  }
  lfo.start(t);
  lfo.stop(end + 0.02);
  cleanupOnEnd(oscs[0] as OscillatorNode, [oscs[1] as OscillatorNode, f, g, lg, lfo]);
  return end;
}

/** Deep drum: sine pitch drop + noise thump. */
export function drum(k: SynthKit, out: AudioNode, t: number, vel: number, f0 = 100, f1 = 48, len = 0.45): number {
  tone(k, out, t, { freq: f0, freqEnd: f1, glide: len * 0.55, decay: len, peak: 0.55 * vel });
  noise(k, out, t, { color: 'brown', filter: 'lowpass', ffreq: 320, decay: len * 0.45, peak: 0.4 * vel });
  return noise(k, out, t, { filter: 'bandpass', ffreq: 1500, fq: 1, decay: 0.012, peak: 0.07 * vel });
}

/** Frame drum / tabor with snare rattle. */
export function tabor(k: SynthKit, out: AudioNode, t: number, vel: number): number {
  tone(k, out, t, { freq: 215, freqEnd: 125, glide: 0.06, decay: 0.12, peak: 0.22 * vel });
  return noise(k, out, t, { filter: 'bandpass', ffreq: 2400, fq: 0.8, decay: 0.07, peak: 0.13 * vel });
}

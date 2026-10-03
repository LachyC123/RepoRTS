/**
 * MusicManager — procedural medieval music.
 *
 * A lookahead scheduler (AudioContext clock + 50 ms interval / per-frame update,
 * notes scheduled ~0.2 s ahead) drives a "Player" that generates modal harmony,
 * lute arpeggios, motif-based melodies, drones and drums on a 16th-note grid.
 *
 * Layered stems (lute, lead, drone, perc, drums, brass) are cross-faded over
 * ~3 s. States in the same family (menu / peace / tension) re-voice the running
 * player on the next bar; other changes start a new player on the old player's
 * next bar line and cross-fade the two.
 */
import { audio } from './AudioManager';
import { SynthKit, brass, clamp, drum, mtof, noise, pick, pluck, rand, tabor } from './synth';

export type MusicState = 'menu' | 'peace' | 'tension' | 'war' | 'victory' | 'defeat' | 'silent';

type Stem = 'lute' | 'lead' | 'drone' | 'perc' | 'drums' | 'brass';
const STEMS: readonly Stem[] = ['lute', 'lead', 'drone', 'perc', 'drums', 'brass'];

type LuteStyle = 'arp' | 'stately' | 'ostinato' | 'rolled' | 'none';
type PercStyle = 'none' | 'tabor' | 'war' | 'march' | 'dirge';
type LeadKind = 'flute' | 'shawm' | 'fanfare' | 'none';

interface Section {
  /** Bars before moving to the next section (Infinity = loop forever). */
  bars: number;
  tempo?: number;
  mode?: readonly number[];
  layers: Partial<Record<Stem, number>>;
  lute: LuteStyle;
  perc: PercStyle;
  lead: LeadKind;
  /** Probability that the lead plays in a given 8-bar phrase. */
  leadChance: number;
  /** Lead octave root (MIDI). */
  leadRoot: number;
  progressions: readonly (readonly number[])[];
  rhythms: readonly (readonly number[])[];
  /** Soft brass pad chords at each bar. */
  pad?: boolean;
}

interface Style {
  name: MusicState;
  group: string;
  tempo: number;
  mode: readonly number[];
  /** MIDI root for lute voicing (tonic is D throughout so stems blend). */
  root: number;
  sections: readonly Section[];
}

// --------------------------------------------------------------- theory ----

const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10] as const;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] as const;
const IONIAN = [0, 2, 4, 5, 7, 9, 11] as const;

// 8-bar progressions of scale-degree roots; bar 4 = half cadence area, bar 8 = tonic.
const PROG_DORIAN = [
  [0, 0, 6, 6, 0, 3, 6, 0],
  [0, 6, 2, 6, 0, 3, 4, 0],
  [0, 2, 6, 3, 0, 6, 3, 0],
  [0, 3, 0, 6, 2, 3, 6, 0],
] as const;
const PROG_MIXO = [
  [0, 3, 0, 6, 0, 3, 6, 0],
  [0, 6, 3, 0, 0, 6, 4, 0],
  [0, 0, 3, 6, 0, 3, 6, 0],
  [0, 4, 6, 3, 0, 6, 3, 0],
] as const;
const PROG_AEOLIAN = [
  [0, 5, 6, 0, 0, 5, 6, 0],
  [0, 3, 6, 2, 5, 3, 4, 0],
  [0, 6, 5, 6, 0, 3, 4, 0],
  [0, 0, 5, 6, 0, 3, 6, 0],
] as const;
const PROG_IONIAN = [
  [0, 3, 4, 0, 0, 3, 4, 0],
  [0, 5, 3, 4, 0, 3, 4, 0],
  [0, 4, 5, 3, 0, 3, 4, 0],
] as const;
const PROG_FANFARE = [[0, 4, 3, 0, 0, 4, 4, 0]] as const;

// Rhythm cells: note lengths in 16th steps, each summing to one 4/4 bar (16).
const RH_GENTLE = [[4, 4, 4, 4], [6, 2, 4, 4], [4, 2, 2, 8], [8, 4, 4], [4, 4, 8], [6, 2, 8], [8, 8], [2, 2, 4, 8]] as const;
const RH_STATELY = [[4, 4, 8], [6, 2, 4, 4], [8, 4, 4], [4, 4, 4, 4], [12, 4], [8, 8]] as const;
const RH_DRIVE = [[2, 2, 4, 2, 2, 4], [4, 2, 2, 4, 4], [2, 2, 2, 2, 4, 4], [4, 4, 2, 2, 4], [3, 1, 2, 2, 4, 4], [4, 2, 2, 8]] as const;
const RH_SLOW = [[8, 8], [12, 4], [16], [8, 4, 4], [6, 2, 8]] as const;
const CADENCE_RH = [[8, 8], [4, 4, 8], [16], [6, 2, 8]] as const;

interface MNote {
  bar: number;
  step: number;
  len: number;
  /** Absolute diatonic degree (0 = tonic in lead octave, 7 = octave up). */
  deg: number;
}

const mod7 = (d: number): number => ((d % 7) + 7) % 7;
const isChordTone = (deg: number, chord: number): boolean => {
  const d = mod7(deg - chord);
  return d === 0 || d === 2 || d === 4;
};
const nearest = (from: number, cands: readonly number[]): number => {
  let best = cands[0] as number;
  for (const c of cands) if (Math.abs(c - from) < Math.abs(best - from) || (Math.abs(c - from) === Math.abs(best - from) && Math.random() < 0.5)) best = c;
  return best;
};

const LO = -2;
const HI = 9;

/** Generate one bar of melody over `chord`, starting near `cur`. */
function genBar(bar: number, rhythm: readonly number[], cur: number, chord: number, cadence: readonly number[] | null, dirIn: number): { notes: MNote[]; last: number; dir: number } {
  const notes: MNote[] = [];
  let step = 0;
  let dir = dirIn;
  rhythm.forEach((len, i) => {
    const isLast = i === rhythm.length - 1;
    let next: number;
    if (isLast && cadence) {
      next = nearest(cur, cadence);
    } else if (step % 8 === 0) {
      const cands: number[] = [];
      for (let d = cur - 3; d <= cur + 3; d++) if (d >= LO && d <= HI && d !== cur && isChordTone(d, chord)) cands.push(d);
      next = cands.length ? nearest(cur + dir, cands) : cur;
    } else {
      if (cur >= HI - 1) dir = -1;
      else if (cur <= LO + 1) dir = 1;
      else if (Math.random() < 0.3) dir = -dir;
      const r = Math.random();
      const mv = r < 0.68 ? 1 : r < 0.86 ? 2 : 0;
      next = clamp(cur + dir * mv, LO, HI);
    }
    notes.push({ bar, step, len, deg: next });
    cur = next;
    step += len;
  });
  return { notes, last: cur, dir };
}

/** Phrase form A A' A B: motif, sequenced motif with half cadence, motif, cadence to tonic. */
export function genMelody(prog: readonly number[], rhythms: readonly (readonly number[])[]): MNote[] {
  const longEnd = rhythms.filter((r) => (r[r.length - 1] as number) >= 4);
  const r0 = pick(rhythms);
  const r1 = pick(longEnd.length ? longEnd : rhythms);
  let dir = Math.random() < 0.5 ? 1 : -1;
  const start = pick([0, 2, 4, 7].filter((d) => isChordTone(d, prog[0] as number)).concat([prog[0] as number]));
  const b0 = genBar(0, r0, start, prog[0] as number, null, dir);
  const b1 = genBar(1, r1, b0.last, prog[1] as number, null, b0.dir);
  const motif = [...b0.notes, ...b1.notes];
  const out: MNote[] = [...motif];
  // A' — sequence the motif by the chord-root movement, snap strong beats to the new chords.
  let shift = (prog[2] as number) - (prog[0] as number);
  if (shift > 3) shift -= 7;
  if (shift < -3) shift += 7;
  const seq = motif.map((n) => {
    const chord = prog[n.bar + 2] as number;
    let deg = clamp(n.deg + shift, LO, HI);
    if (n.step % 8 === 0 && !isChordTone(deg, chord)) deg = isChordTone(deg + 1, chord) ? deg + 1 : deg - 1;
    return { bar: n.bar + 2, step: n.step, len: n.len, deg };
  });
  const lastSeq = seq[seq.length - 1] as MNote;
  lastSeq.deg = nearest(lastSeq.deg, [4, -3, 1]); // half cadence on the fifth / second
  out.push(...seq);
  // A — repeat
  out.push(...motif.map((n) => ({ ...n, bar: n.bar + 4 })));
  // B — new material, ending on the tonic.
  dir = lastSeq.deg > 4 ? -1 : 1;
  const b6 = genBar(6, pick(rhythms), (motif[motif.length - 1] as MNote).deg, prog[6] as number, null, dir);
  const b7 = genBar(7, pick(CADENCE_RH), b6.last, prog[7] as number, [0, 7], b6.dir);
  out.push(...b6.notes, ...b7.notes);
  return out;
}

// Victory fanfare (deg relative to lead root, ionian): [bar, step, len, deg]
const FANFARE: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 3, 0], [0, 3, 1, 0], [0, 4, 4, 2], [0, 8, 8, 4],
  [1, 0, 6, 4], [1, 6, 2, 5], [1, 8, 8, 4],
  [2, 0, 3, 3], [2, 3, 1, 3], [2, 4, 4, 4], [2, 8, 4, 5], [2, 12, 4, 6],
  [3, 0, 16, 7],
  [4, 0, 3, 0], [4, 3, 1, 0], [4, 4, 4, 2], [4, 8, 8, 4],
  [5, 0, 6, 4], [5, 6, 2, 5], [5, 8, 8, 4],
  [6, 0, 4, 9], [6, 4, 4, 8], [6, 8, 4, 7], [6, 12, 4, 6],
  [7, 0, 16, 7],
];

// --------------------------------------------------------------- styles ----

const CALM_ROOT = 50; // D3

const STYLES: Record<Exclude<MusicState, 'silent'>, Style> = {
  menu: {
    name: 'menu', group: 'calm', tempo: 72, mode: DORIAN, root: CALM_ROOT,
    sections: [{
      bars: Infinity, layers: { lute: 1, lead: 0.8, drone: 0.45 }, lute: 'stately', perc: 'none',
      lead: 'flute', leadChance: 0.85, leadRoot: 74, progressions: PROG_DORIAN, rhythms: RH_STATELY,
    }],
  },
  peace: {
    name: 'peace', group: 'calm', tempo: 76, mode: MIXOLYDIAN, root: CALM_ROOT,
    sections: [{
      bars: Infinity, layers: { lute: 1, lead: 0.7 }, lute: 'arp', perc: 'none',
      lead: 'flute', leadChance: 0.5, leadRoot: 74, progressions: PROG_MIXO, rhythms: RH_GENTLE,
    }],
  },
  tension: {
    name: 'tension', group: 'calm', tempo: 80, mode: DORIAN, root: CALM_ROOT,
    sections: [{
      bars: Infinity, layers: { lute: 0.85, lead: 0.45, drone: 0.75, perc: 0.6 }, lute: 'arp', perc: 'tabor',
      lead: 'flute', leadChance: 0.35, leadRoot: 74, progressions: PROG_DORIAN, rhythms: RH_GENTLE,
    }],
  },
  war: {
    name: 'war', group: 'war', tempo: 116, mode: AEOLIAN, root: CALM_ROOT,
    sections: [{
      bars: Infinity, layers: { drums: 1, perc: 0.8, lute: 0.75, drone: 0.6, lead: 0.75 }, lute: 'ostinato', perc: 'war',
      lead: 'shawm', leadChance: 0.75, leadRoot: 62, progressions: PROG_AEOLIAN, rhythms: RH_DRIVE,
    }],
  },
  victory: {
    name: 'victory', group: 'victory', tempo: 100, mode: IONIAN, root: CALM_ROOT,
    sections: [
      {
        bars: 8, layers: { brass: 1, drums: 0.8, perc: 0.7, lute: 0.6, drone: 0.35 }, lute: 'arp', perc: 'march',
        lead: 'fanfare', leadChance: 1, leadRoot: 62, progressions: PROG_FANFARE, rhythms: RH_STATELY,
      },
      {
        bars: Infinity, tempo: 84, layers: { lute: 1, lead: 0.8, brass: 0.35, perc: 0.3, drone: 0.3 }, lute: 'arp', perc: 'tabor',
        lead: 'flute', leadChance: 0.7, leadRoot: 74, progressions: PROG_IONIAN, rhythms: RH_GENTLE, pad: true,
      },
    ],
  },
  defeat: {
    name: 'defeat', group: 'defeat', tempo: 56, mode: AEOLIAN, root: CALM_ROOT,
    sections: [{
      bars: Infinity, layers: { lute: 0.8, lead: 0.9, drone: 0.7, drums: 0.35 }, lute: 'rolled', perc: 'dirge',
      lead: 'flute', leadChance: 0.9, leadRoot: 62, progressions: PROG_AEOLIAN, rhythms: RH_SLOW,
    }],
  },
};

// Stem mix levels (relative, before stem layer gains).
const STEM_LEVEL: Record<Stem, number> = { lute: 0.9, lead: 0.85, drone: 0.6, perc: 0.7, drums: 0.75, brass: 0.7 };

const LOOKAHEAD = 0.2;
const FADE = 3;

interface RampRec {
  from: number;
  to: number;
  t0: number;
  t1: number;
}

function rampValueAt(r: RampRec, t: number): number {
  if (t <= r.t0) return r.from;
  if (t >= r.t1) return r.to;
  return r.from + ((r.to - r.from) * (t - r.t0)) / (r.t1 - r.t0);
}

function rampParam(p: AudioParam, rec: RampRec, t: number, to: number, dur: number): void {
  const from = rampValueAt(rec, t);
  p.cancelScheduledValues(t);
  p.setValueAtTime(from, t);
  p.linearRampToValueAtTime(to, t + Math.max(0.01, dur));
  rec.from = from;
  rec.to = to;
  rec.t0 = t;
  rec.t1 = t + Math.max(0.01, dur);
}

// --------------------------------------------------------------- player ----

class Player {
  readonly style0: Style;
  style: Style;
  private readonly k: SynthKit;
  private readonly out: GainNode;
  private readonly outRec: RampRec;
  private readonly stems = {} as Record<Stem, GainNode>;
  private readonly stemRec = {} as Record<Stem, RampRec>;
  private readonly sends: AudioNode[] = [];
  private readonly luteTone: BiquadFilterNode;
  private pending: Style | null = null;
  private sectionIdx = 0;
  private sectionBar = 0;
  private phraseBar = 0;
  private step = 0;
  private tempo: number;
  private mode: readonly number[];
  nextTime: number;
  private prog: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private melody = new Map<number, MNote>();
  private leadOn = false;
  private freshSection = true;
  stopAt: number | null = null;
  private disposed = false;
  private drone: { srcs: OscillatorNode[]; nodes: AudioNode[] } | null = null;

  constructor(k: SynthKit, dest: AudioNode, reverb: AudioNode | null, style: Style, t0: number, fadeIn: number) {
    this.k = k;
    this.style0 = style;
    this.style = style;
    this.tempo = this.section.tempo ?? style.tempo;
    this.mode = this.section.mode ?? style.mode;
    this.nextTime = t0;
    const c = k.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.outRec = { from: 0, to: 0, t0: 0, t1: 0 };
    rampParam(this.out.gain, this.outRec, Math.max(t0, c.currentTime), 1, fadeIn);
    this.out.connect(dest);
    if (reverb) {
      const s = c.createGain();
      s.gain.value = 0.35;
      this.out.connect(s);
      s.connect(reverb);
      this.sends.push(s);
    }
    for (const st of STEMS) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.stems[st] = g;
      this.stemRec[st] = { from: 0, to: 0, t0: 0, t1: 0 };
    }
    // Warm lowpass on the lute stem.
    this.luteTone = c.createBiquadFilter();
    this.luteTone.type = 'lowpass';
    this.luteTone.frequency.value = 2600;
    this.luteTone.Q.value = 0.5;
    this.luteTone.connect(this.stems.lute);
    this.applyLayers(t0, 0.05);
  }

  private get section(): Section {
    const s = this.style.sections;
    return s[Math.min(this.sectionIdx, s.length - 1)] as Section;
  }

  private get stepDur(): number {
    return 60 / this.tempo / 4;
  }

  /** Time of the next bar line (now-scheduled step 0). */
  nextBarTime(): number {
    return this.step === 0 ? this.nextTime : this.nextTime + (16 - this.step) * this.stepDur;
  }

  queueStyle(s: Style): void {
    this.pending = s === this.style ? null : s;
  }

  fadeOut(t: number, dur: number): void {
    rampParam(this.out.gain, this.outRec, t, 0, dur);
    this.stopAt = t + dur + 0.05;
  }

  get finished(): boolean {
    return this.stopAt !== null && this.k.ctx.currentTime > this.stopAt + 2.5;
  }

  private applyLayers(t: number, dur: number): void {
    const L = this.section.layers;
    for (const st of STEMS) {
      const target = (L[st] ?? 0) * STEM_LEVEL[st];
      if (Math.abs(this.stemRec[st].to - target) < 1e-4 && t >= this.stemRec[st].t1) continue;
      rampParam(this.stems[st].gain, this.stemRec[st], t, target, dur);
    }
    if ((L.drone ?? 0) > 0) this.startDrone(t);
  }

  private active(st: Stem, t: number): boolean {
    const r = this.stemRec[st];
    return r.to > 0.001 || t < r.t1;
  }

  tick(now: number): void {
    if (this.disposed) return;
    if (this.nextTime < now - 0.15) {
      // Fell behind (tab hidden / long frame): skip ahead instead of bursting.
      const missed = Math.ceil((now - this.nextTime) / this.stepDur);
      for (let i = 0; i < missed && i < 4096; i++) this.advance(false);
      this.nextTime = now + 0.02;
    }
    const horizon = now + LOOKAHEAD;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      if (this.stopAt !== null && this.nextTime >= this.stopAt) break;
      this.scheduleStep(this.nextTime);
      this.advance(true);
    }
    if (this.drone && !this.active('drone', now) && this.stemRec.drone.to <= 0.001) this.stopDrone(now);
  }

  private advance(timed: boolean): void {
    if (timed) this.nextTime += this.stepDur;
    this.step++;
    if (this.step >= 16) {
      this.step = 0;
      this.phraseBar = (this.phraseBar + 1) % 8;
      this.sectionBar++;
      if (!timed && this.phraseBar === 0) this.newPhrase();
    }
  }

  private onBar(t: number): void {
    const sec = this.section;
    if (this.pending) {
      this.style = this.pending;
      this.pending = null;
      this.sectionIdx = 0;
      this.enterSection(t);
    } else if (sec.bars !== Infinity && this.sectionBar >= sec.bars && this.sectionIdx < this.style.sections.length - 1) {
      this.sectionIdx++;
      this.enterSection(t);
    } else if (this.phraseBar === 0 || this.freshSection) {
      this.newPhrase();
    }
    this.freshSection = false;
  }

  private enterSection(t: number): void {
    const sec = this.section;
    this.sectionBar = 0;
    this.phraseBar = 0;
    this.tempo = sec.tempo ?? this.style.tempo;
    this.mode = sec.mode ?? this.style.mode;
    this.applyLayers(t, FADE);
    this.newPhrase();
  }

  private newPhrase(): void {
    const sec = this.section;
    this.prog = pick(sec.progressions);
    this.melody.clear();
    if (sec.lead === 'fanfare') {
      for (const [bar, step, len, deg] of FANFARE) this.melody.set(bar * 16 + step, { bar, step, len, deg });
      this.leadOn = true;
    } else if (sec.lead !== 'none') {
      this.leadOn = Math.random() < sec.leadChance;
      if (this.leadOn) for (const n of genMelody(this.prog, sec.rhythms)) this.melody.set(n.bar * 16 + n.step, n);
    } else {
      this.leadOn = false;
    }
  }

  /** MIDI for absolute diatonic degree relative to `root`. */
  private midi(root: number, deg: number): number {
    return root + 12 * Math.floor(deg / 7) + (this.mode[mod7(deg)] as number);
  }

  private scheduleStep(t: number): void {
    if (this.step === 0) this.onBar(t);
    const sec = this.section;
    const s = this.step;
    const chord = this.prog[this.phraseBar] as number;
    const k = this.k;
    const hum = (): number => t + rand(0, 0.007);
    const root = this.style.root;
    // chord tones in lute register: [root, third, fifth, octave]
    const ct = [chord, chord + 2, chord + 4, chord + 7].map((d) => this.midi(root, d));
    const bass = this.midi(root, chord) - 12;
    const f = (m: number): number => mtof(m);
    const lute = this.luteTone;

    // ---- lute
    if (sec.lute !== 'none' && this.active('lute', t)) {
      switch (sec.lute) {
        case 'arp': {
          if (s % 2 === 0) {
            const pat = this.phraseBar % 2 === 0 ? [-1, 0, 1, 2, 3, 2, 1, 2] : [-1, 1, 2, 3, 1, 2, 0, 2];
            const idx = pat[s / 2] as number;
            const m = idx < 0 ? bass : (ct[idx] as number);
            const v = s === 0 ? 0.26 : s === 8 ? 0.2 : 0.14 + rand(0, 0.03);
            pluck(k, lute, hum(), f(m), v);
            if (s === 0) pluck(k, lute, hum() + 0.01, f(ct[0] as number), 0.12);
          }
          break;
        }
        case 'stately': {
          const v = 0.2;
          if (s === 0) {
            pluck(k, lute, hum(), f(bass), 0.26);
            pluck(k, lute, hum(), f(ct[0] as number), 0.16);
          } else if (s === 4 || s === 12) pluck(k, lute, hum(), f(ct[2] as number), v * 0.75);
          else if (s === 8) {
            [1, 2, 3].forEach((i, j) => pluck(k, lute, t + j * 0.03, f(ct[i] as number), v * 0.8));
            if (this.phraseBar % 2 === 1) pluck(k, lute, t, f(bass), 0.18);
          } else if (s === 14) pluck(k, lute, hum(), f(ct[1] as number), v * 0.6);
          break;
        }
        case 'ostinato': {
          if (s % 2 === 0) {
            const pat = [0, 0, 2, 0, 3, 0, 2, 1];
            const m = ct[pat[s / 2] as number] as number;
            const accent = s === 0 || s === 6 || s === 12;
            pluck(k, lute, hum(), f(m), accent ? 0.24 : 0.15, 0.17);
            if (s === 0) pluck(k, lute, t, f(bass), 0.25, 0.35);
          } else if (this.phraseBar % 4 === 3 && s >= 13) {
            pluck(k, lute, hum(), f(ct[s === 13 ? 1 : s === 15 ? 2 : 0] as number), 0.12, 0.12);
          }
          break;
        }
        case 'rolled': {
          if (s === 0) {
            [bass, ...ct].forEach((m, j) => pluck(k, lute, t + j * 0.07, f(m), j === 0 ? 0.2 : 0.14));
          } else if (s === 8 && this.phraseBar % 2 === 1) {
            pluck(k, lute, t, f(ct[1] as number), 0.1);
            pluck(k, lute, t + 0.08, f(ct[2] as number), 0.1);
          }
          break;
        }
      }
    }

    // ---- lead
    if (this.leadOn) {
      const n = this.melody.get(this.phraseBar * 16 + s);
      if (n) {
        const dur = n.len * this.stepDur;
        if (sec.lead === 'fanfare') {
          if (this.active('brass', t)) {
            const m = this.midi(sec.leadRoot, n.deg);
            brass(k, this.stems.brass, t, f(m), dur * 0.9, 0.13, 0.85);
            if (n.len >= 4) brass(k, this.stems.brass, t, f(this.midi(sec.leadRoot, n.deg - 2)), dur * 0.9, 0.08, 0.6);
          }
        } else if (this.active('lead', t)) {
          const m = this.midi(sec.leadRoot, n.deg);
          if (sec.lead === 'shawm') this.shawm(t, f(m), dur * 0.92, 0.07);
          else this.flute(t, f(m), dur * 0.95, 0.11);
        }
      }
    }

    // ---- brass pad
    if (sec.pad && s === 0 && this.active('brass', t)) {
      const len = 16 * this.stepDur * 0.95;
      brass(k, this.stems.brass, t, f(ct[0] as number), len, 0.04, 0.25);
      brass(k, this.stems.brass, t, f(ct[2] as number), len, 0.03, 0.25);
    }

    // ---- percussion
    const last = this.phraseBar === 7;
    const P = this.stems.perc;
    const D = this.stems.drums;
    const pOn = this.active('perc', t);
    const dOn = this.active('drums', t);
    switch (sec.perc) {
      case 'tabor':
        if (pOn) {
          if (s === 0) tabor(k, P, hum(), 0.6);
          else if (s === 8) tabor(k, P, hum(), 0.45);
          else if (s === 6 && Math.random() < 0.5) tabor(k, P, hum(), 0.2);
          else if (s === 14 && Math.random() < 0.6) tabor(k, P, hum(), 0.25);
          else if (last && (s === 12 || s === 13 || s === 15)) tabor(k, P, hum(), 0.25);
        }
        break;
      case 'war':
        if (dOn) {
          const hits: Record<number, number> = { 0: 1, 6: 0.6, 8: 0.85, 12: 0.65 };
          const v = hits[s];
          if (v !== undefined) drum(k, D, t, v);
          else if (s === 14 && Math.random() < 0.6) drum(k, D, t, 0.45);
        }
        if (pOn) {
          if (last && s >= 8) tabor(k, P, t, 0.15 + (s - 8) * 0.06);
          else if (s % 2 === 0) tabor(k, P, hum(), s % 4 === 0 ? 0.32 : 0.18);
          else if (Math.random() < 0.15) tabor(k, P, hum(), 0.1);
        }
        break;
      case 'march':
        if (dOn && (s === 0 || s === 8)) drum(k, D, t, s === 0 ? 0.9 : 0.7);
        if (pOn && (s === 4 || s === 12 || s === 14 || s === 15)) tabor(k, P, hum(), s >= 14 ? 0.28 : 0.42);
        break;
      case 'dirge':
        if (dOn && s === 0) drum(k, D, t, 0.45, 75, 38, 0.7);
        else if (dOn && s === 8 && this.phraseBar % 2 === 1) drum(k, D, t, 0.25, 75, 38, 0.6);
        break;
      case 'none':
        break;
    }
  }

  private flute(t: number, freq: number, dur: number, peak: number): void {
    const c = this.k.ctx;
    const out = this.stems.lead;
    const end = t + dur + 0.14;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.06);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + 0.18);
    g.gain.setValueAtTime(peak * 0.8, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(out);
    const o1 = c.createOscillator();
    o1.frequency.value = freq;
    const o2 = c.createOscillator();
    o2.frequency.value = freq * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.12;
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5 + rand(-0.3, 0.3);
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.5));
    lg.gain.linearRampToValueAtTime(freq * 0.007, t + Math.max(0.3, dur));
    lfo.connect(lg);
    lg.connect(o1.frequency);
    for (const o of [o1, o2, lfo]) {
      o.start(t);
      o.stop(end + 0.02);
    }
    o1.onended = () => {
      for (const n of [o1, o2, lfo, g, g2, lg]) n.disconnect();
    };
    // breath chiff + soft breath under the note
    noise(this.k, out, t, { filter: 'bandpass', ffreq: freq * 2, fq: 2, attack: 0.015, decay: 0.07, peak: peak * 0.3 });
    if (dur > 0.25) noise(this.k, out, t, { filter: 'bandpass', ffreq: freq * 3, fq: 1, attack: 0.08, hold: dur * 0.7, decay: 0.1, peak: peak * 0.06 });
  }

  private shawm(t: number, freq: number, dur: number, peak: number): void {
    const c = this.k.ctx;
    const out = this.stems.lead;
    const end = t + dur + 0.08;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 450;
    const bp = c.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 1300;
    bp.gain.value = 8;
    bp.Q.value = 1.2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const sq = c.createOscillator();
    sq.type = 'square';
    sq.frequency.value = freq;
    const sg = c.createGain();
    sg.gain.value = 0.4;
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.6;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(freq * 0.008, t + Math.max(0.2, dur));
    lfo.connect(lg);
    lg.connect(o.frequency);
    lg.connect(sq.frequency);
    o.connect(hp);
    sq.connect(sg);
    sg.connect(hp);
    hp.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(out);
    for (const x of [o, sq, lfo]) {
      x.start(t);
      x.stop(end + 0.02);
    }
    o.onended = () => {
      for (const n of [o, sq, lfo, sg, lg, hp, bp, lp, g]) n.disconnect();
    };
  }

  private startDrone(t: number): void {
    if (this.drone) return;
    const c = this.k.ctx;
    const out = this.stems.drone;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.Q.value = 0.8;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = c.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(lp.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 1.5);
    lp.connect(g);
    g.connect(out);
    const srcs: OscillatorNode[] = [lfo];
    const root = this.style.root; // D3
    const voices: Array<[number, OscillatorType, number, number]> = [
      [root, 'sawtooth', 0.045, -4],
      [root + 7, 'sawtooth', 0.035, 3],
      [root - 12, 'triangle', 0.08, 0],
    ];
    for (const [m, type, gain, det] of voices) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = det;
      const og = c.createGain();
      og.gain.value = gain;
      o.connect(og);
      og.connect(lp);
      srcs.push(o);
      o.start(t);
    }
    lfo.start(t);
    this.drone = { srcs, nodes: [lp, lg, g] };
  }

  private stopDrone(t: number): void {
    const d = this.drone;
    if (!d) return;
    this.drone = null;
    for (const s of d.srcs) {
      try {
        s.stop(t + 0.05);
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      for (const s of d.srcs) s.disconnect();
      for (const n of d.nodes) n.disconnect();
    }, 300);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopDrone(this.k.ctx.currentTime);
    this.out.disconnect();
    for (const s of this.sends) s.disconnect();
    for (const st of STEMS) this.stems[st].disconnect();
    this.luteTone.disconnect();
  }
}

// -------------------------------------------------------------- manager ----

export class MusicManager {
  private state: MusicState = 'silent';
  private current: Player | null = null;
  private fading: Player[] = [];
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    audio.onInit(() => this.startTimer());
  }

  getState(): MusicState {
    return this.state;
  }

  setState(state: MusicState): void {
    if (state === this.state) return;
    if (state !== 'silent' && !(state in STYLES)) return;
    this.state = state;
    this.dirty = true;
    this.tick();
  }

  /** Per-frame hook (dt ignored: scheduling is driven by the AudioContext clock). */
  update(_dt: number): void {
    this.tick();
  }

  private startTimer(): void {
    if (this.timer !== null || typeof window === 'undefined') return;
    this.timer = setInterval(() => this.tick(), 50);
  }

  private tick(): void {
    const ctx = audio.ctx;
    const kit = audio.kit;
    const bus = audio.musicBus;
    if (!ctx || !kit || !bus || ctx.state !== 'running') return;
    try {
      if (this.dirty) {
        this.dirty = false;
        this.apply(kit, bus);
      }
      const now = ctx.currentTime;
      this.current?.tick(now);
      for (const p of this.fading) p.tick(now);
      if (this.fading.length) {
        this.fading = this.fading.filter((p) => {
          if (p.finished) {
            p.dispose();
            return false;
          }
          return true;
        });
      }
    } catch (e) {
      console.warn('[music] tick failed', e);
    }
  }

  private apply(kit: SynthKit, bus: AudioNode): void {
    const ctx = kit.ctx;
    const cur = this.current;
    if (this.state === 'silent') {
      if (cur) {
        cur.fadeOut(Math.max(ctx.currentTime + 0.05, Math.min(cur.nextBarTime(), ctx.currentTime + 1)), FADE);
        this.fading.push(cur);
        this.current = null;
      }
      return;
    }
    const style = STYLES[this.state];
    if (cur && cur.style0.group === style.group) {
      cur.queueStyle(style);
      return;
    }
    // Too many overlapping players (rapid changes): drop the oldest quickly.
    while (this.fading.length >= 2) {
      const old = this.fading.shift();
      old?.dispose();
    }
    const t0 = cur ? Math.max(cur.nextBarTime(), ctx.currentTime + 0.05) : ctx.currentTime + 0.1;
    const p = new Player(kit, bus, audio.reverbIn, style, t0, cur ? 2.5 : 2);
    if (cur) {
      cur.fadeOut(t0, FADE);
      this.fading.push(cur);
    }
    this.current = p;
  }
}

export const music = new MusicManager();

/**
 * Procedural sound-effect recipes. Each recipe schedules nodes into `out`
 * starting at absolute context time `t` and returns the end time.
 * `r` is a pitch/rate multiplier (≈1, with random variation applied by the caller).
 */
import { SynthKit, bell, brass, drum, mtof, noise, partials, pluck, rand, tabor, tone } from './synth';

export const SFX_NAMES = [
  'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error',
  'select', 'select_army', 'order_move', 'order_attack',
  'sword_clash', 'sword_hit', 'shield_block',
  'arrow_shoot', 'arrow_hit', 'arrow_ground', 'bolt_shoot',
  'catapult_launch', 'catapult_impact', 'ballista_shoot', 'ram_hit',
  'horse_gallop', 'horse_neigh', 'unit_death', 'battle_cry',
  'build_place', 'construction_hammer', 'build_complete',
  'axe_chop', 'mining', 'farm', 'coins', 'recruit',
  'horn_warning', 'horn_victory', 'horn_recruit',
  'capture_progress', 'capture_complete', 'region_lost',
  'building_collapse', 'fire', 'notification', 'upgrade_complete',
  'defeat', 'victory_fanfare', 'tree_fall', 'door', 'bird_flap',
  // modern era
  'rifle_shot', 'mg_burst', 'smg_burst', 'sniper_shot', 'shotgun', 'rocket_launch',
  'explosion', 'tank_fire', 'mortar_launch', 'shell_whistle', 'engine_idle', 'engine_rev',
  'bugle', 'radio_chatter', 'ricochet',
  // support troops and superweapons
  'flame', 'firepot_smash', 'siren', 'missile_launch', 'bombard_fire', 'big_explosion',
  'lute', 'bagpipe', 'heal', 'volley', 'salvo',
  // weather
  'thunder',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export type Recipe = (k: SynthKit, out: AudioNode, t: number, r: number) => number;

export interface SfxDef {
  fn: Recipe;
  /** Output gain multiplier. */
  gain?: number;
  /** Max voices of this name started within the throttle window. */
  max?: number;
  /** Random pitch variation (+/- fraction). */
  vary?: number;
  /** Random start jitter (s). */
  jitter?: number;
  /** UI / global sounds: never spatialised, bypass most of the voice cap. */
  ui?: boolean;
  /** Reverb send amount 0..1. */
  send?: number;
}

// ------------------------------------------------------------- helpers ----

function metalRing(k: SynthKit, o: AudioNode, t: number, f: number, len: number, g: number): number {
  return partials(k, o, t, f, [1, 2.76, 5.4, 8.93], [len, len * 0.62, len * 0.36, len * 0.22], [g, g * 0.65, g * 0.4, g * 0.22]);
}

function whoosh(k: SynthKit, o: AudioNode, t: number, f0: number, f1: number, len: number, peak: number): number {
  return noise(k, o, t, { filter: 'bandpass', ffreq: f0, ffreqEnd: f1, fq: 1.2, attack: len * 0.3, decay: len * 0.7, peak });
}

function hoof(k: SynthKit, o: AudioNode, t: number, r: number, v: number): void {
  noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1000 * r, fq: 2, decay: 0.03, peak: 0.32 * v });
  tone(k, o, t, { freq: 260 * r, freqEnd: 140 * r, decay: 0.04, peak: 0.2 * v });
}

/** Voice-ish formant tone (shouts, grunts, neighs). */
function vocal(
  k: SynthKit,
  o: AudioNode,
  t: number,
  contour: Array<[number, number]>,
  peak: number,
  formants: readonly number[],
  vibRate = 6,
  vibDepth = 4,
): number {
  const c = k.ctx;
  const last = contour[contour.length - 1] as [number, number];
  const end = t + last[0];
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime((contour[0] as [number, number])[1], t);
  for (let i = 1; i < contour.length; i++) {
    const p = contour[i] as [number, number];
    osc.frequency.linearRampToValueAtTime(p[1], t + p[0]);
  }
  const lfo = c.createOscillator();
  lfo.frequency.value = vibRate;
  const lg = c.createGain();
  lg.gain.value = vibDepth;
  lfo.connect(lg);
  lg.connect(osc.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.08, last[0] * 0.25));
  g.gain.setValueAtTime(peak, t + last[0] * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const nodes: AudioNode[] = [g, lg, lfo];
  for (const ff of formants) {
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = ff;
    f.Q.value = 4;
    osc.connect(f);
    f.connect(g);
    nodes.push(f);
  }
  g.connect(o);
  osc.start(t);
  lfo.start(t);
  osc.stop(end + 0.02);
  lfo.stop(end + 0.02);
  osc.onended = () => {
    osc.disconnect();
    for (const n of nodes) n.disconnect();
  };
  return end;
}

/** Firearm report: sharp transient crack, body thump and a short filtered tail. */
function gunshot(k: SynthKit, o: AudioNode, t: number, r: number, v: number, tail = 0.16, body = 1): number {
  noise(k, o, t, { filter: 'highpass', ffreq: 2200 * r, decay: 0.018, peak: 0.42 * v });
  noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1100 * r, fq: 0.9, decay: 0.05, peak: 0.32 * v });
  tone(k, o, t, { freq: 190 * r, freqEnd: 60 * r, decay: 0.06, peak: 0.3 * v * body });
  return noise(k, o, t + 0.01, { color: 'pink', filter: 'lowpass', ffreq: 2200 * r, ffreqEnd: 350, attack: 0.005, decay: tail, peak: 0.1 * v });
}

/** Diesel engine rumble: pulsing low saw through a lowpass. */
function diesel(k: SynthKit, o: AudioNode, t: number, f0: number, f1: number, len: number, peak: number, lp0: number, lp1: number): number {
  tone(k, o, t, { type: 'sawtooth', freq: f0, freqEnd: f1, glide: len * 0.6, attack: 0.08, hold: len * 0.4, decay: len * 0.6, peak, filter: 'lowpass', ffreq: lp0, ffreqEnd: lp1, fq: 2, vibRate: f0 / 4, vibDepth: f0 * 0.12 });
  tone(k, o, t, { type: 'square', freq: f0 / 2, freqEnd: f1 / 2, glide: len * 0.6, attack: 0.08, hold: len * 0.4, decay: len * 0.6, peak: peak * 0.5, filter: 'lowpass', ffreq: lp0 * 0.7, fq: 1 });
  return noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: lp0 * 1.4, attack: 0.08, hold: len * 0.4, decay: len * 0.6, peak: peak * 1.4 });
}

/** Pitch-contoured, lowpassed oscillator pair (sirens): contour = [time offset, freq] points. */
function sweep(k: SynthKit, o: AudioNode, t: number, contour: Array<[number, number]>, peak: number, lp: number, attack = 0.2, release = 0.5): number {
  const c = k.ctx;
  const last = contour[contour.length - 1] as [number, number];
  const end = t + last[0];
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, Math.max(t + attack, end - release));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lp;
  f.Q.value = 0.9;
  f.connect(g);
  g.connect(o);
  const oscs: OscillatorNode[] = [];
  for (const [type, mul, det] of [['sawtooth', 1, -6], ['triangle', 1, 5], ['sine', 0.5, 0]] as const) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.detune.value = det;
    osc.frequency.setValueAtTime((contour[0] as [number, number])[1] * mul, t);
    for (let i = 1; i < contour.length; i++) {
      const pt = contour[i] as [number, number];
      osc.frequency.linearRampToValueAtTime(pt[1] * mul, t + pt[0]);
    }
    osc.connect(f);
    osc.start(t);
    osc.stop(end + 0.02);
    oscs.push(osc);
  }
  (oscs[0] as OscillatorNode).onended = () => {
    for (const n of [...oscs, f, g]) n.disconnect();
  };
  return end;
}

// ------------------------------------------------------------- recipes ----

const R: Record<SfxName, Recipe> = {
  ui_click: (k, o, t, r) => {
    tone(k, o, t, { type: 'triangle', freq: 1150 * r, freqEnd: 650 * r, glide: 0.03, attack: 0.001, decay: 0.04, peak: 0.22 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 3000, fq: 1.5, decay: 0.012, peak: 0.08 });
    return t + 0.06;
  },
  ui_hover: (k, o, t, r) => tone(k, o, t, { freq: 2100 * r, attack: 0.002, decay: 0.03, peak: 0.05 }),
  ui_open: (k, o, t, r) => {
    pluck(k, o, t, 587 * r, 0.22, 0.35);
    pluck(k, o, t + 0.06, 880 * r, 0.2, 0.45);
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1600, ffreqEnd: 3600, fq: 1, attack: 0.04, decay: 0.1, peak: 0.04 });
    return t + 0.55;
  },
  ui_close: (k, o, t, r) => {
    pluck(k, o, t, 880 * r, 0.18, 0.3);
    pluck(k, o, t + 0.06, 587 * r, 0.2, 0.4);
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 3400, ffreqEnd: 1500, fq: 1, attack: 0.03, decay: 0.1, peak: 0.04 });
    return t + 0.5;
  },
  ui_error: (k, o, t, r) => {
    tone(k, o, t, { type: 'square', freq: 155 * r, decay: 0.09, hold: 0.03, peak: 0.08, filter: 'lowpass', ffreq: 700 });
    return tone(k, o, t + 0.13, { type: 'square', freq: 146 * r, decay: 0.12, hold: 0.03, peak: 0.08, filter: 'lowpass', ffreq: 650 });
  },
  select: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 4500, decay: 0.04, peak: 0.04 });
    tone(k, o, t, { type: 'triangle', freq: 660 * r, freqEnd: 880 * r, glide: 0.04, decay: 0.09, peak: 0.12 });
    return t + 0.12;
  },
  select_army: (k, o, t, r) => {
    [523, 659, 784].forEach((f, i) => tone(k, o, t + i * 0.025, { type: 'triangle', freq: f * r, decay: 0.16, peak: 0.08 }));
    for (let i = 0; i < 4; i++) {
      partials(k, o, t + rand(0, 0.12), rand(4200, 6200), [1, 1.7], [0.04, 0.03], [0.012, 0.008]);
    }
    noise(k, o, t, { filter: 'highpass', ffreq: 4000, attack: 0.02, decay: 0.12, peak: 0.035 });
    return t + 0.3;
  },
  order_move: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 500, decay: 0.07, peak: 0.35 });
    noise(k, o, t + 0.11, { color: 'brown', filter: 'lowpass', ffreq: 520, decay: 0.07, peak: 0.3 });
    tone(k, o, t + 0.02, { type: 'triangle', freq: 440 * r, freqEnd: 540 * r, decay: 0.09, peak: 0.07 });
    return t + 0.22;
  },
  order_attack: (k, o, t, r) => {
    noise(k, o, t, { filter: 'bandpass', ffreq: 1800 * r, ffreqEnd: 5200 * r, fq: 4, attack: 0.03, decay: 0.16, peak: 0.12 });
    drum(k, o, t + 0.02, 0.55, 120 * r, 55 * r, 0.22);
    metalRing(k, o, t + 0.17, 1700 * r, 0.25, 0.02);
    return t + 0.45;
  },
  sword_clash: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 2600, decay: 0.035, peak: 0.32 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1200, decay: 0.05, peak: 0.12 });
    return metalRing(k, o, t, rand(1000, 1500) * r, rand(0.25, 0.4), 0.11);
  },
  sword_hit: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 900, decay: 0.09, peak: 0.55 });
    tone(k, o, t, { freq: 140 * r, freqEnd: 60 * r, decay: 0.1, peak: 0.3 });
    partials(k, o, t, 2200 * r, [1, 2.4], [0.06, 0.04], [0.03, 0.015]);
    return t + 0.15;
  },
  shield_block: (k, o, t, r) => {
    tone(k, o, t, { freq: 230 * r, freqEnd: 140 * r, decay: 0.12, peak: 0.4 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 700 * r, fq: 1.5, decay: 0.08, peak: 0.4 });
    partials(k, o, t, 1650 * r, [1, 2.3], [0.12, 0.07], [0.04, 0.02]);
    return t + 0.18;
  },
  arrow_shoot: (k, o, t, r) => {
    tone(k, o, t, { type: 'triangle', freq: 260 * r, freqEnd: 200 * r, decay: 0.12, peak: 0.16 });
    whoosh(k, o, t + 0.01, 2600 * r, 700 * r, 0.28, 0.12);
    return t + 0.32;
  },
  arrow_hit: (k, o, t, r) => {
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1600 * r, fq: 1.2, decay: 0.035, peak: 0.32 });
    tone(k, o, t, { freq: 320 * r, freqEnd: 140 * r, decay: 0.055, peak: 0.25 });
    return t + 0.08;
  },
  arrow_ground: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 700 * r, decay: 0.05, peak: 0.3 });
    noise(k, o, t, { filter: 'bandpass', ffreq: 3000 * r, decay: 0.02, peak: 0.04 });
    return t + 0.07;
  },
  bolt_shoot: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 5000, decay: 0.006, peak: 0.25 });
    tone(k, o, t, { type: 'square', freq: 1300 * r, decay: 0.012, peak: 0.04 });
    tone(k, o, t + 0.01, { type: 'triangle', freq: 170 * r, freqEnd: 120 * r, decay: 0.14, peak: 0.22 });
    whoosh(k, o, t + 0.02, 3000 * r, 900 * r, 0.18, 0.12);
    return t + 0.22;
  },
  catapult_launch: (k, o, t, r) => {
    tone(k, o, t, { type: 'sawtooth', freq: 90 * r, freqEnd: 65 * r, attack: 0.15, decay: 0.2, peak: 0.09, filter: 'bandpass', ffreq: 600, fq: 3, vibRate: 18, vibDepth: 6 });
    tone(k, o, t + 0.3, { freq: 75 * r, freqEnd: 40 * r, decay: 0.25, peak: 0.45 });
    noise(k, o, t + 0.3, { color: 'brown', filter: 'lowpass', ffreq: 600, decay: 0.12, peak: 0.35 });
    whoosh(k, o, t + 0.32, 500 * r, 180 * r, 0.65, 0.22);
    return t + 1.0;
  },
  catapult_impact: (k, o, t, r) => {
    tone(k, o, t, { freq: 62 * r, freqEnd: 28 * r, decay: 0.55, peak: 0.7 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1400, ffreqEnd: 300, decay: 0.45, peak: 0.6 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 900, decay: 0.12, peak: 0.25 });
    for (let i = 0; i < 6; i++) {
      noise(k, o, t + 0.05 + rand(0, 0.35), { filter: 'bandpass', ffreq: rand(1500, 4000), fq: 3, decay: 0.02, peak: rand(0.05, 0.12) });
    }
    return t + 0.65;
  },
  ballista_shoot: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 3000, decay: 0.01, peak: 0.25 });
    tone(k, o, t, { type: 'triangle', freq: 125 * r, freqEnd: 85 * r, decay: 0.25, peak: 0.3 });
    tone(k, o, t, { freq: 60 * r, decay: 0.1, peak: 0.2 });
    whoosh(k, o, t + 0.02, 1800 * r, 500 * r, 0.3, 0.14);
    return t + 0.35;
  },
  ram_hit: (k, o, t, r) => {
    tone(k, o, t, { freq: 85 * r, freqEnd: 42 * r, decay: 0.4, peak: 0.75 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 320 * r, fq: 1, decay: 0.3, peak: 0.5 });
    tone(k, o, t, { type: 'sawtooth', freq: 70 * r, decay: 0.25, peak: 0.1, filter: 'lowpass', ffreq: 300 });
    noise(k, o, t + 0.01, { filter: 'bandpass', ffreq: 2200, fq: 2, decay: 0.03, peak: 0.08 });
    return t + 0.55;
  },
  horse_gallop: (k, o, t, r) => {
    const times = [0, 0.075, 0.15, 0.33, 0.405, 0.48];
    const vels = [0.7, 0.8, 1, 0.65, 0.75, 0.95];
    times.forEach((dt, i) => hoof(k, o, t + dt + rand(0, 0.01), r * rand(0.95, 1.05), vels[i] as number));
    return t + 0.6;
  },
  horse_neigh: (k, o, t, r) =>
    vocal(
      k, o, t,
      [[0, 480 * r], [0.15, 1100 * r], [0.35, 980 * r], [0.75, 720 * r], [1.1, 430 * r]],
      0.16, [1100, 2300], 13, 45,
    ),
  unit_death: (k, o, t, r) => {
    vocal(k, o, t, [[0, 170 * r], [0.12, 150 * r], [0.35, 85 * r]], 0.14, [550, 900], 7, 3);
    noise(k, o, t + 0.25, { color: 'brown', filter: 'lowpass', ffreq: 400, decay: 0.15, peak: 0.4 });
    partials(k, o, t + 0.27, 3000, [1, 1.6], [0.05, 0.03], [0.015, 0.01]);
    return t + 0.55;
  },
  battle_cry: (k, o, t, r) => {
    let end = t;
    for (let i = 0; i < 5; i++) {
      const f = rand(150, 260) * r;
      const st = t + rand(0, 0.12);
      end = Math.max(end, vocal(k, o, st, [[0, f], [0.3, f * 1.25], [0.8, f * 1.2], [1.1, f * 0.95]], 0.05, [720, 1150], rand(5, 7), 5));
    }
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1000, attack: 0.15, hold: 0.4, decay: 0.45, peak: 0.05 });
    return end;
  },
  build_place: (k, o, t, r) => {
    tone(k, o, t, { freq: 190 * r, freqEnd: 110 * r, decay: 0.12, peak: 0.4 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 900 * r, decay: 0.07, peak: 0.3 });
    noise(k, o, t + 0.02, { filter: 'bandpass', ffreq: 2500, ffreqEnd: 1200, attack: 0.03, decay: 0.2, peak: 0.04 });
    return t + 0.26;
  },
  construction_hammer: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 2500, decay: 0.012, peak: 0.22 });
    partials(k, o, t, rand(1800, 2400) * r, [1, 1.58, 2.4], [0.08, 0.05, 0.04], [0.05, 0.035, 0.02]);
    tone(k, o, t, { freq: 300 * r, freqEnd: 180 * r, decay: 0.045, peak: 0.2 });
    return t + 0.12;
  },
  build_complete: (k, o, t, r) => {
    [74, 78, 81, 86].forEach((m, i) => pluck(k, o, t + i * 0.075, mtof(m) * r, 0.2, 0.9));
    bell(k, o, t + 0.3, mtof(86) * r, 0.03, 0.7);
    return t + 1.05;
  },
  axe_chop: (k, o, t, r) => {
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 1300 * r, fq: 1.2, decay: 0.06, peak: 0.45 });
    tone(k, o, t, { freq: 320 * r, freqEnd: 110 * r, decay: 0.07, peak: 0.35 });
    noise(k, o, t, { filter: 'highpass', ffreq: 3000, decay: 0.01, peak: 0.08 });
    return t + 0.12;
  },
  mining: (k, o, t, r) => {
    partials(k, o, t, rand(2300, 2900) * r, [1, 1.47, 2.09], [0.12, 0.08, 0.05], [0.05, 0.035, 0.025]);
    noise(k, o, t, { filter: 'highpass', ffreq: 1800, decay: 0.05, peak: 0.18 });
    noise(k, o, t + 0.03, { color: 'pink', filter: 'bandpass', ffreq: 800, decay: 0.1, peak: 0.12 });
    return t + 0.2;
  },
  farm: (k, o, t, r) => {
    noise(k, o, t, { filter: 'bandpass', ffreq: 3500 * r, ffreqEnd: 1500 * r, fq: 1.5, attack: 0.08, decay: 0.18, peak: 0.1 });
    noise(k, o, t + 0.15, { color: 'pink', filter: 'highpass', ffreq: 2000, decay: 0.15, peak: 0.05 });
    tone(k, o, t + 0.22, { freq: 120 * r, decay: 0.06, peak: 0.12 });
    return t + 0.4;
  },
  coins: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 6000, decay: 0.02, peak: 0.04 });
    let tt = t;
    let end = t;
    for (let i = 0; i < 4; i++) {
      const v = 1 - i * 0.15;
      end = Math.max(end, partials(k, o, tt, rand(2800, 4200) * r, [1, 2.31, 3.93], [0.15, 0.08, 0.05], [0.055 * v, 0.028 * v, 0.014 * v]));
      tt += rand(0.045, 0.08);
    }
    return end;
  },
  recruit: (k, o, t, r) => {
    tabor(k, o, t, 0.8);
    brass(k, o, t + 0.05, mtof(62) * r, 0.14, 0.11, 0.7);
    return brass(k, o, t + 0.22, mtof(69) * r, 0.32, 0.12, 0.8);
  },
  horn_warning: (k, o, t, r) => {
    brass(k, o, t, mtof(50) * r, 0.45, 0.2, 0.55, -40);
    brass(k, o, t, mtof(38) * r, 0.45, 0.1, 0.4, -40);
    brass(k, o, t + 0.7, mtof(50) * r, 0.95, 0.22, 0.6, -40);
    return brass(k, o, t + 0.7, mtof(38) * r, 0.95, 0.11, 0.4, -40);
  },
  horn_victory: (k, o, t, r) => {
    brass(k, o, t, mtof(62) * r, 0.16, 0.13, 0.8);
    brass(k, o, t + 0.2, mtof(66) * r, 0.16, 0.13, 0.8);
    brass(k, o, t + 0.4, mtof(69) * r, 0.16, 0.13, 0.85);
    brass(k, o, t + 0.6, mtof(69) * r, 0.85, 0.08, 0.6);
    brass(k, o, t + 0.6, mtof(66) * r, 0.85, 0.07, 0.6);
    return brass(k, o, t + 0.6, mtof(74) * r, 0.85, 0.13, 0.9);
  },
  horn_recruit: (k, o, t, r) => {
    brass(k, o, t, mtof(57) * r, 0.18, 0.14, 0.7, -25);
    return brass(k, o, t + 0.24, mtof(62) * r, 0.45, 0.15, 0.8);
  },
  capture_progress: (k, o, t, r) => {
    bell(k, o, t, 1320 * r, 0.05, 0.3);
    return pluck(k, o, t, 660 * r, 0.08, 0.25);
  },
  capture_complete: (k, o, t, r) => {
    [74, 78, 81].forEach((m, i) => bell(k, o, t + i * 0.05, mtof(m) * r, 0.045, 0.9));
    brass(k, o, t + 0.12, mtof(62) * r, 0.55, 0.08, 0.6);
    return t + 1.3;
  },
  region_lost: (k, o, t, r) => {
    brass(k, o, t, mtof(62) * r, 0.32, 0.15, 0.4);
    brass(k, o, t + 0.4, mtof(58) * r, 0.32, 0.15, 0.4);
    brass(k, o, t + 0.8, mtof(55) * r, 0.9, 0.15, 0.35);
    drum(k, o, t + 0.8, 0.5, 80, 40, 0.6);
    return t + 1.9;
  },
  building_collapse: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 500 * r, ffreqEnd: 120, attack: 0.05, decay: 1.6, peak: 0.6 });
    for (let i = 0; i < 5; i++) {
      noise(k, o, t + rand(0, 0.8), { filter: 'bandpass', ffreq: rand(800, 2500), fq: 1, decay: 0.06, peak: 0.18 });
    }
    for (let i = 0; i < 3; i++) {
      tone(k, o, t + rand(0.1, 1.0), { freq: rand(50, 80) * r, freqEnd: 30, decay: 0.3, peak: 0.4 });
    }
    return t + 1.75;
  },
  thunder: (k, o, t, r) => {
    // a sharp crack, then a long rolling rumble that wanders off
    noise(k, o, t, { filter: 'highpass', ffreq: 1800 * r, decay: 0.09, peak: 0.22 });
    noise(k, o, t + 0.03, { color: 'brown', filter: 'lowpass', ffreq: 900 * r, ffreqEnd: 90, attack: 0.02, decay: 0.7, peak: 0.55 });
    for (let i = 0; i < 6; i++) {
      const at = t + 0.25 + i * rand(0.25, 0.55);
      noise(k, o, at, { color: 'brown', filter: 'lowpass', ffreq: rand(140, 320) * r, ffreqEnd: 50, attack: rand(0.08, 0.25), decay: rand(0.6, 1.4), peak: 0.5 / (1 + i * 0.45) });
    }
    return t + 4.2;
  },
  fire: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 700 * r, attack: 0.15, decay: 0.6, peak: 0.25 });
    for (let i = 0; i < 10; i++) {
      noise(k, o, t + rand(0, 0.7), { filter: 'highpass', ffreq: rand(2000, 5000), decay: rand(0.004, 0.012), peak: rand(0.05, 0.16) });
    }
    return t + 0.8;
  },
  notification: (k, o, t, r) => {
    bell(k, o, t, 1047 * r, 0.06, 0.6);
    return bell(k, o, t + 0.12, 1568 * r, 0.05, 0.7);
  },
  upgrade_complete: (k, o, t, r) => {
    let end = t;
    [74, 78, 81, 86].forEach((m, i) => (end = bell(k, o, t + i * 0.065, mtof(m) * r, 0.045, 0.7)));
    noise(k, o, t, { filter: 'highpass', ffreq: 6000, attack: 0.1, decay: 0.4, peak: 0.025 });
    return end;
  },
  defeat: (k, o, t, r) => {
    const notes = [62, 60, 58, 57];
    const durs = [0.55, 0.55, 0.55, 1.5];
    notes.forEach((m, i) => brass(k, o, t + i * 0.65, mtof(m) * r, durs[i] as number, 0.15, 0.35));
    brass(k, o, t, mtof(38) * r, 2.6, 0.08, 0.25);
    drum(k, o, t, 0.5, 80, 40, 0.7);
    drum(k, o, t + 1.95, 0.6, 80, 40, 0.8);
    return t + 3.6;
  },
  victory_fanfare: (k, o, t, r) => {
    const f = (m: number): number => mtof(m) * r;
    [0, 0.14, 0.28].forEach((dt) => brass(k, o, t + dt, f(62), 0.09, 0.13, 0.85));
    brass(k, o, t + 0.45, f(69), 0.32, 0.14, 0.9);
    brass(k, o, t + 0.85, f(66), 0.13, 0.12, 0.8);
    brass(k, o, t + 1.05, f(69), 0.13, 0.12, 0.85);
    brass(k, o, t + 1.25, f(74), 1.2, 0.14, 1);
    brass(k, o, t + 1.25, f(69), 1.2, 0.08, 0.6);
    brass(k, o, t + 1.25, f(66), 1.2, 0.07, 0.6);
    brass(k, o, t + 1.25, f(50), 1.2, 0.07, 0.4);
    drum(k, o, t, 0.7);
    drum(k, o, t + 0.45, 0.6);
    drum(k, o, t + 1.25, 0.9);
    for (let i = 0; i < 6; i++) tabor(k, o, t + 1.0 + i * 0.04, 0.2 + i * 0.08);
    return t + 2.7;
  },
  tree_fall: (k, o, t, r) => {
    tone(k, o, t, { type: 'sawtooth', freq: 110 * r, freqEnd: 70 * r, attack: 0.2, decay: 0.9, peak: 0.1, filter: 'bandpass', ffreq: 700, fq: 4, vibRate: 22, vibDepth: 8 });
    noise(k, o, t + 0.5, { color: 'pink', filter: 'highpass', ffreq: 1500, attack: 0.4, decay: 0.5, peak: 0.14 });
    tone(k, o, t + 1.15, { freq: 70 * r, freqEnd: 35 * r, decay: 0.4, peak: 0.6 });
    noise(k, o, t + 1.15, { color: 'brown', filter: 'lowpass', ffreq: 600, decay: 0.3, peak: 0.45 });
    return t + 1.6;
  },
  door: (k, o, t, r) => {
    tone(k, o, t, { type: 'sawtooth', freq: 150 * r, freqEnd: 120 * r, attack: 0.05, decay: 0.35, peak: 0.06, filter: 'bandpass', ffreq: 900, fq: 5, vibRate: 30, vibDepth: 10 });
    tone(k, o, t + 0.35, { freq: 120 * r, freqEnd: 80 * r, decay: 0.1, peak: 0.35 });
    noise(k, o, t + 0.35, { color: 'pink', filter: 'lowpass', ffreq: 900, decay: 0.08, peak: 0.3 });
    return t + 0.5;
  },
  bird_flap: (k, o, t, r) => {
    let end = t;
    for (let i = 0; i < 6; i++) {
      end = noise(k, o, t + i * 0.045, { color: 'pink', filter: 'bandpass', ffreq: 1400 * r, fq: 1, attack: 0.008, decay: 0.03, peak: 0.18 * (1 - i * 0.12) });
    }
    return end;
  },
  // ---------------------------------------------------------- modern era ----
  rifle_shot: (k, o, t, r) => gunshot(k, o, t, r, 1, 0.18) + 0.02,
  mg_burst: (k, o, t, r) => {
    const n = 3 + Math.floor(Math.random() * 3);
    let end = t;
    for (let i = 0; i < n; i++) end = gunshot(k, o, t + i * rand(0.07, 0.085), r * rand(0.96, 1.03), 0.8 - i * 0.04, 0.1, 1.2);
    return end;
  },
  smg_burst: (k, o, t, r) => {
    let end = t;
    for (let i = 0; i < 5; i++) end = gunshot(k, o, t + i * rand(0.05, 0.06), r * 1.25 * rand(0.97, 1.03), 0.55, 0.07, 0.6);
    return end;
  },
  sniper_shot: (k, o, t, r) => {
    gunshot(k, o, t, r * 0.9, 1.25, 0.3, 1.3);
    // rolling echoes off distant terrain
    noise(k, o, t + 0.22, { color: 'pink', filter: 'bandpass', ffreq: 700 * r, fq: 0.8, attack: 0.02, decay: 0.35, peak: 0.08 });
    noise(k, o, t + 0.5, { color: 'pink', filter: 'bandpass', ffreq: 500 * r, fq: 0.8, attack: 0.03, decay: 0.45, peak: 0.05 });
    return noise(k, o, t + 0.85, { color: 'brown', filter: 'lowpass', ffreq: 500, attack: 0.05, decay: 0.5, peak: 0.07 });
  },
  shotgun: (k, o, t, r) => {
    gunshot(k, o, t, r * 0.8, 1.1, 0.22, 1.6);
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1800 * r, decay: 0.12, peak: 0.45 });
    // pump: clack-clack
    noise(k, o, t + 0.34, { filter: 'bandpass', ffreq: 2600, fq: 3, decay: 0.02, peak: 0.12 });
    return noise(k, o, t + 0.46, { filter: 'bandpass', ffreq: 2100, fq: 3, decay: 0.025, peak: 0.14 });
  },
  rocket_launch: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 900, decay: 0.12, peak: 0.45 });
    tone(k, o, t, { freq: 110 * r, freqEnd: 55 * r, decay: 0.12, peak: 0.25 });
    noise(k, o, t + 0.02, { filter: 'bandpass', ffreq: 500 * r, ffreqEnd: 2600 * r, fq: 1.4, attack: 0.04, decay: 0.55, peak: 0.2 });
    return noise(k, o, t + 0.05, { filter: 'highpass', ffreq: 3000, attack: 0.05, decay: 0.6, peak: 0.07 });
  },
  explosion: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 1500, decay: 0.03, peak: 0.3 });
    tone(k, o, t, { freq: 75 * r, freqEnd: 26 * r, decay: 0.9, peak: 0.7 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1500 * r, ffreqEnd: 140, decay: 1.2, peak: 0.65 });
    noise(k, o, t + 0.08, { color: 'pink', filter: 'lowpass', ffreq: 500, attack: 0.1, decay: 0.9, peak: 0.18 });
    for (let i = 0; i < 8; i++) {
      noise(k, o, t + 0.12 + rand(0, 0.7), { filter: 'bandpass', ffreq: rand(1500, 4500), fq: 3, decay: 0.02, peak: rand(0.03, 0.09) });
    }
    return t + 1.3;
  },
  tank_fire: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 1200, decay: 0.03, peak: 0.35 });
    tone(k, o, t, { freq: 60 * r, freqEnd: 28 * r, decay: 0.75, peak: 0.8 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1000 * r, ffreqEnd: 160, decay: 0.7, peak: 0.6 });
    // breech clank as the gun recoils
    partials(k, o, t + 0.09, 900 * r, [1, 2.3, 3.9], [0.12, 0.08, 0.05], [0.04, 0.025, 0.015]);
    return t + 0.85;
  },
  mortar_launch: (k, o, t, r) => {
    tone(k, o, t, { type: 'triangle', freq: 240 * r, freqEnd: 120 * r, decay: 0.16, peak: 0.4 });
    tone(k, o, t, { freq: 150 * r, decay: 0.3, peak: 0.16, filter: 'bandpass', ffreq: 300, fq: 4 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 700 * r, fq: 1.2, decay: 0.08, peak: 0.35 });
    return noise(k, o, t + 0.03, { filter: 'bandpass', ffreq: 1200, ffreqEnd: 400, fq: 1, attack: 0.03, decay: 0.3, peak: 0.06 });
  },
  shell_whistle: (k, o, t, r) => {
    tone(k, o, t, { freq: 2300 * r, freqEnd: 650 * r, glide: 1.05, attack: 0.25, hold: 0.55, decay: 0.3, peak: 0.045, vibRate: 7, vibDepth: 18 });
    return noise(k, o, t, { filter: 'bandpass', ffreq: 2400 * r, ffreqEnd: 700 * r, fq: 6, attack: 0.3, hold: 0.5, decay: 0.3, peak: 0.05 });
  },
  engine_idle: (k, o, t, r) => diesel(k, o, t, 44 * r, 42 * r, 0.9, 0.11, 240, 200),
  engine_rev: (k, o, t, r) => diesel(k, o, t, 40 * r, 95 * r, 1.0, 0.12, 220, 650),
  bugle: (k, o, t, r) => {
    const f = (m: number): number => mtof(m) * r;
    brass(k, o, t, f(67), 0.12, 0.12, 1.1);
    brass(k, o, t + 0.16, f(72), 0.12, 0.12, 1.1);
    brass(k, o, t + 0.32, f(76), 0.12, 0.12, 1.15);
    brass(k, o, t + 0.48, f(79), 0.2, 0.13, 1.2);
    brass(k, o, t + 0.74, f(76), 0.1, 0.11, 1.1);
    return brass(k, o, t + 0.88, f(79), 0.6, 0.13, 1.2);
  },
  radio_chatter: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 2500, decay: 0.05, peak: 0.12 });
    let tt = t + 0.06;
    const n = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const d = rand(0.04, 0.09);
      tone(k, o, tt, { type: 'square', freq: rand(130, 240) * r, freqEnd: rand(120, 260) * r, attack: 0.008, decay: d, peak: 0.05, filter: 'bandpass', ffreq: rand(900, 1800), fq: 3 });
      noise(k, o, tt, { filter: 'bandpass', ffreq: 1800, fq: 2, attack: 0.005, decay: d, peak: 0.025 });
      tt += d + rand(0.005, 0.04);
    }
    return noise(k, o, tt, { filter: 'highpass', ffreq: 2200, decay: 0.08, peak: 0.1 });
  },
  ricochet: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 4000, decay: 0.01, peak: 0.2 });
    return tone(k, o, t + 0.005, { freq: rand(2600, 3600) * r, freqEnd: rand(900, 1400) * r, glide: 0.3, decay: 0.32, peak: 0.05, vibRate: 35, vibDepth: 90 });
  },
  // ------------------------------------------------- support / superweapons ----
  flame: (k, o, t, r) => {
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1500 * r, ffreqEnd: 450, attack: 0.06, hold: 0.22, decay: 0.32, peak: 0.45 });
    noise(k, o, t, { color: 'pink', filter: 'bandpass', ffreq: 650 * r, ffreqEnd: 1700 * r, fq: 0.8, attack: 0.05, hold: 0.18, decay: 0.3, peak: 0.13 });
    tone(k, o, t, { type: 'sawtooth', freq: 62 * r, freqEnd: 46 * r, attack: 0.05, hold: 0.22, decay: 0.3, peak: 0.08, filter: 'lowpass', ffreq: 260, vibRate: 17, vibDepth: 9 });
    for (let i = 0; i < 7; i++) {
      noise(k, o, t + rand(0.04, 0.55), { filter: 'highpass', ffreq: rand(2500, 5000), decay: rand(0.004, 0.012), peak: rand(0.04, 0.1) });
    }
    return t + 0.62;
  },
  firepot_smash: (k, o, t, r) => {
    // pottery breaking: bright ceramic clinks and grit
    noise(k, o, t, { filter: 'highpass', ffreq: 2400, decay: 0.03, peak: 0.3 });
    partials(k, o, t, rand(1900, 2400) * r, [1, 1.83, 2.71, 3.9], [0.07, 0.05, 0.04, 0.03], [0.05, 0.04, 0.03, 0.02]);
    for (let i = 0; i < 5; i++) {
      const tt = t + 0.02 + rand(0, 0.18);
      partials(k, o, tt, rand(2600, 4800) * r, [1, 1.6], [0.03, 0.02], [0.025, 0.015]);
      noise(k, o, tt, { filter: 'bandpass', ffreq: rand(2500, 5000), fq: 3, decay: 0.015, peak: rand(0.04, 0.09) });
    }
    // whoomph as the pitch catches
    noise(k, o, t + 0.05, { color: 'brown', filter: 'lowpass', ffreq: 220, ffreqEnd: 1300, attack: 0.08, decay: 0.42, peak: 0.5 });
    tone(k, o, t + 0.05, { freq: 95 * r, freqEnd: 48 * r, attack: 0.04, decay: 0.3, peak: 0.3 });
    return t + 0.6;
  },
  siren: (k, o, t, r) => {
    // air-raid siren: wind up, wail, wind down
    const lo = 260 * r;
    const hi = 720 * r;
    sweep(k, o, t, [[0, lo], [0.9, hi], [1.6, hi * 0.97], [2.2, hi * 0.9], [3.0, lo * 0.85]], 0.085, 1700, 0.5, 0.7);
    return sweep(k, o, t, [[0, lo * 1.5], [0.9, hi * 1.5], [1.6, hi * 1.46], [2.2, hi * 1.35], [3.0, lo * 1.27]], 0.025, 2200, 0.5, 0.7);
  },
  missile_launch: (k, o, t, r) => {
    // ignition bang, then a long deep roar with a rising hiss
    noise(k, o, t, { filter: 'highpass', ffreq: 1200, decay: 0.05, peak: 0.25 });
    tone(k, o, t, { freq: 70 * r, freqEnd: 32 * r, decay: 0.5, peak: 0.55 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 380 * r, ffreqEnd: 900 * r, attack: 0.25, hold: 0.9, decay: 0.85, peak: 0.6 });
    tone(k, o, t + 0.05, { type: 'sawtooth', freq: 42 * r, freqEnd: 58 * r, glide: 1.6, attack: 0.3, hold: 0.8, decay: 0.85, peak: 0.1, filter: 'lowpass', ffreq: 240, vibRate: 23, vibDepth: 6 });
    noise(k, o, t + 0.1, { filter: 'bandpass', ffreq: 700 * r, ffreqEnd: 3200 * r, fq: 0.9, attack: 0.5, hold: 0.6, decay: 0.8, peak: 0.12 });
    return noise(k, o, t + 0.2, { filter: 'highpass', ffreq: 4000, attack: 0.4, hold: 0.5, decay: 0.9, peak: 0.04 });
  },
  bombard_fire: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 1000, decay: 0.04, peak: 0.4 });
    tone(k, o, t, { freq: 52 * r, freqEnd: 21 * r, decay: 1.25, peak: 0.9 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1300 * r, ffreqEnd: 110, decay: 1.1, peak: 0.7 });
    noise(k, o, t + 0.02, { color: 'pink', filter: 'bandpass', ffreq: 380 * r, fq: 0.8, decay: 0.35, peak: 0.25 });
    // echoes rolling back off the hills
    noise(k, o, t + 0.38, { color: 'pink', filter: 'bandpass', ffreq: 420 * r, fq: 0.9, attack: 0.02, decay: 0.45, peak: 0.13 });
    tone(k, o, t + 0.38, { freq: 48 * r, freqEnd: 26 * r, decay: 0.5, peak: 0.18 });
    noise(k, o, t + 0.8, { color: 'pink', filter: 'bandpass', ffreq: 360 * r, fq: 0.9, attack: 0.03, decay: 0.55, peak: 0.07 });
    return noise(k, o, t + 1.25, { color: 'brown', filter: 'lowpass', ffreq: 400, attack: 0.05, decay: 0.6, peak: 0.06 });
  },
  big_explosion: (k, o, t, r) => {
    noise(k, o, t, { filter: 'highpass', ffreq: 1200, decay: 0.05, peak: 0.35 });
    tone(k, o, t, { freq: 42 * r, freqEnd: 17 * r, decay: 2.2, peak: 0.9 });
    tone(k, o, t, { freq: 70 * r, freqEnd: 30 * r, decay: 0.9, peak: 0.45 });
    noise(k, o, t, { color: 'brown', filter: 'lowpass', ffreq: 1000 * r, ffreqEnd: 60, decay: 2.8, peak: 0.75 });
    noise(k, o, t + 0.1, { color: 'pink', filter: 'lowpass', ffreq: 600, ffreqEnd: 150, attack: 0.3, decay: 2.4, peak: 0.2 });
    for (let i = 0; i < 14; i++) {
      noise(k, o, t + 0.15 + rand(0, 1.6), { filter: 'bandpass', ffreq: rand(1200, 4200), fq: 3, decay: rand(0.015, 0.04), peak: rand(0.02, 0.08) });
    }
    for (let i = 0; i < 3; i++) tone(k, o, t + rand(0.4, 1.4), { freq: rand(40, 60) * r, freqEnd: 24, decay: 0.6, peak: 0.2 });
    return t + 3.0;
  },
  lute: (k, o, t, r) => {
    const f = (m: number): number => mtof(m) * r;
    const notes: Array<[number, number, number]> = [
      [0, 62, 0.26], [0.11, 66, 0.24], [0.22, 69, 0.26], [0.33, 74, 0.28],
      [0.5, 71, 0.24], [0.62, 69, 0.22], [0.74, 74, 0.3],
    ];
    let end = t;
    for (const [dt, m, pk] of notes) end = Math.max(end, pluck(k, o, t + dt, f(m), pk, 0.5));
    pluck(k, o, t + 0.74, f(50), 0.2, 0.5); // bass string under the last note
    return Math.max(end, t + 1.2);
  },
  bagpipe: (k, o, t, r) => {
    const f = (m: number): number => mtof(m) * r;
    // drones (A2 + A3), reedy and steady
    for (const [m, pk] of [[45, 0.06], [57, 0.04]] as const) {
      tone(k, o, t, { type: 'sawtooth', freq: f(m), attack: 0.12, hold: 1.2, decay: 0.2, peak: pk, filter: 'lowpass', ffreq: 1100, fq: 1.2, vibRate: 5, vibDepth: 0.6 });
    }
    // chanter: a short tune with a grace note before each beat
    const tune: Array<[number, number]> = [[69, 0.18], [71, 0.12], [73, 0.24], [69, 0.12], [76, 0.3], [73, 0.18]];
    let tt = t + 0.12;
    for (const [m, d] of tune) {
      tone(k, o, tt, { type: 'sawtooth', freq: f(81), attack: 0.005, decay: 0.03, peak: 0.03, filter: 'bandpass', ffreq: 1800, fq: 1.4 });
      tone(k, o, tt + 0.03, { type: 'sawtooth', freq: f(m), attack: 0.01, hold: d - 0.03, decay: 0.05, peak: 0.085, filter: 'bandpass', ffreq: 1500, fq: 1.3 });
      tt += d + 0.03;
    }
    return t + 1.55;
  },
  heal: (k, o, t, r) => {
    bell(k, o, t, mtof(84) * r, 0.035, 0.8);
    bell(k, o, t + 0.09, mtof(88) * r, 0.03, 0.9);
    noise(k, o, t, { filter: 'highpass', ffreq: 6000, attack: 0.12, decay: 0.45, peak: 0.015 });
    return t + 1.0;
  },
  volley: (k, o, t, r) => {
    let end = t;
    let tt = t;
    for (let i = 0; i < 8; i++) {
      end = gunshot(k, o, tt, r * rand(0.82, 1.12), 0.55 - i * 0.02, 0.1, 1.5);
      tt += rand(0.045, 0.09);
    }
    // the cart and the smoke settling
    noise(k, o, t + 0.05, { color: 'brown', filter: 'lowpass', ffreq: 700, attack: 0.05, decay: 0.6, peak: 0.18 });
    return Math.max(end, t + 0.8);
  },
  salvo: (k, o, t, r) => {
    for (let i = 0; i < 6; i++) {
      const tt = t + i * rand(0.13, 0.17);
      const rr = r * rand(0.92, 1.08);
      noise(k, o, tt, { color: 'brown', filter: 'lowpass', ffreq: 800, decay: 0.08, peak: 0.3 });
      tone(k, o, tt, { freq: 120 * rr, freqEnd: 60 * rr, decay: 0.08, peak: 0.15 });
      noise(k, o, tt + 0.01, { filter: 'bandpass', ffreq: 450 * rr, ffreqEnd: 2600 * rr, fq: 1.3, attack: 0.04, decay: 0.38, peak: 0.13 });
    }
    return noise(k, o, t, { filter: 'highpass', ffreq: 3000, attack: 0.1, hold: 0.6, decay: 0.5, peak: 0.04 });
  },
};

/** Per-sound mixing / throttle settings. */
const META: Partial<Record<SfxName, Omit<SfxDef, 'fn'>>> = {
  ui_click: { ui: true, vary: 0.03, jitter: 0, max: 3 },
  ui_hover: { ui: true, vary: 0.02, jitter: 0, max: 2, gain: 0.8 },
  ui_open: { ui: true, vary: 0.01, jitter: 0, max: 2 },
  ui_close: { ui: true, vary: 0.01, jitter: 0, max: 2 },
  ui_error: { ui: true, vary: 0, jitter: 0, max: 1 },
  select: { ui: true, vary: 0.04, jitter: 0, max: 2 },
  select_army: { ui: true, vary: 0.02, jitter: 0, max: 1 },
  order_move: { ui: true, vary: 0.05, jitter: 0, max: 1 },
  order_attack: { ui: true, vary: 0.04, jitter: 0, max: 1 },
  sword_clash: { max: 4, vary: 0.08, gain: 0.8 },
  sword_hit: { max: 4, vary: 0.1, gain: 0.8 },
  shield_block: { max: 3, vary: 0.08, gain: 0.8 },
  arrow_shoot: { max: 4, vary: 0.08, gain: 0.85 },
  arrow_hit: { max: 4, vary: 0.1, gain: 0.8 },
  arrow_ground: { max: 3, vary: 0.12, gain: 1.2 },
  bolt_shoot: { max: 3, vary: 0.06 },
  catapult_launch: { max: 2, vary: 0.05 },
  catapult_impact: { max: 2, vary: 0.08, send: 0.2, gain: 0.7 },
  ballista_shoot: { max: 2, vary: 0.05, gain: 0.7 },
  ram_hit: { max: 2, vary: 0.05, send: 0.15, gain: 0.7 },
  horse_gallop: { max: 2, vary: 0.06, gain: 0.8 },
  horse_neigh: { max: 1, vary: 0.08, gain: 0.8 },
  unit_death: { max: 3, vary: 0.12, gain: 0.85 },
  battle_cry: { max: 1, vary: 0.05, send: 0.25 },
  build_place: { ui: true, max: 2, vary: 0.04 },
  construction_hammer: { max: 3, vary: 0.08, gain: 0.7 },
  build_complete: { ui: true, max: 1, vary: 0, send: 0.25 },
  axe_chop: { max: 3, vary: 0.1, gain: 0.7 },
  mining: { max: 3, vary: 0.08, gain: 0.7 },
  farm: { max: 2, vary: 0.1, gain: 1.2 },
  coins: { ui: true, max: 2, vary: 0.03 },
  recruit: { ui: true, max: 1, vary: 0, send: 0.2 },
  horn_warning: { ui: true, max: 1, vary: 0, send: 0.4, gain: 0.7 },
  horn_victory: { ui: true, max: 1, vary: 0, send: 0.4 },
  horn_recruit: { ui: true, max: 1, vary: 0, send: 0.35 },
  capture_progress: { ui: true, max: 1, vary: 0, send: 0.2 },
  capture_complete: { ui: true, max: 1, vary: 0, send: 0.35 },
  region_lost: { ui: true, max: 1, vary: 0, send: 0.35 },
  building_collapse: { max: 2, vary: 0.06, send: 0.2 },
  fire: { max: 2, vary: 0.1, gain: 0.8 },
  notification: { ui: true, max: 1, vary: 0, send: 0.3 },
  upgrade_complete: { ui: true, max: 1, vary: 0, send: 0.3 },
  defeat: { ui: true, max: 1, vary: 0, send: 0.45, gain: 0.8 },
  victory_fanfare: { ui: true, max: 1, vary: 0, send: 0.45, gain: 0.8 },
  tree_fall: { max: 2, vary: 0.06, gain: 0.75 },
  door: { max: 2, vary: 0.06 },
  bird_flap: { max: 3, vary: 0.1, gain: 2 },
  rifle_shot: { max: 4, vary: 0.08, gain: 0.55 },
  mg_burst: { max: 2, vary: 0.05, gain: 0.5 },
  smg_burst: { max: 2, vary: 0.06, gain: 0.5 },
  sniper_shot: { max: 1, vary: 0.04, gain: 0.6, send: 0.35 },
  shotgun: { max: 2, vary: 0.06, gain: 0.55 },
  rocket_launch: { max: 2, vary: 0.06, gain: 0.7 },
  explosion: { max: 3, vary: 0.1, gain: 0.7, send: 0.25 },
  tank_fire: { max: 2, vary: 0.05, gain: 0.7, send: 0.2 },
  mortar_launch: { max: 2, vary: 0.06, gain: 0.75 },
  shell_whistle: { max: 2, vary: 0.08, gain: 0.8 },
  engine_idle: { max: 2, vary: 0.08, gain: 0.8 },
  engine_rev: { max: 2, vary: 0.06, gain: 0.8 },
  bugle: { ui: true, max: 1, vary: 0, send: 0.4, gain: 0.8 },
  radio_chatter: { ui: true, max: 1, vary: 0.05, gain: 0.9 },
  ricochet: { max: 3, vary: 0.12, gain: 0.7 },
  flame: { max: 2, vary: 0.08, gain: 0.7 },
  firepot_smash: { max: 3, vary: 0.1, gain: 0.7 },
  siren: { ui: true, max: 1, vary: 0, send: 0.4, gain: 0.7 },
  missile_launch: { max: 1, vary: 0.04, gain: 0.8, send: 0.3 },
  bombard_fire: { max: 2, vary: 0.05, gain: 0.65, send: 0.4 },
  big_explosion: { max: 1, vary: 0.05, gain: 0.62, send: 0.4 },
  lute: { max: 1, vary: 0.02, gain: 0.8, send: 0.2 },
  bagpipe: { max: 1, vary: 0.01, gain: 0.7, send: 0.25 },
  heal: { max: 2, vary: 0.05, gain: 0.7, send: 0.3 },
  volley: { max: 2, vary: 0.06, gain: 0.6, send: 0.2 },
  salvo: { max: 1, vary: 0.05, gain: 0.7, send: 0.25 },
  thunder: { max: 1, vary: 0.12, gain: 0.8, send: 0.5, ui: true },
};

export const SFX: Record<SfxName, SfxDef> = Object.fromEntries(
  SFX_NAMES.map((n) => [n, { fn: R[n], ...(META[n] ?? {}) }]),
) as Record<SfxName, SfxDef>;

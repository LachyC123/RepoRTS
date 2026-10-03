import type { FormationKind } from '../sim/units/Formation';

export interface SettingsData {
  master: number;
  music: number;
  sfx: number;
  graphics: 'low' | 'medium' | 'high';
  cameraSensitivity: number;
  edgeScroll: boolean;
  screenShake: boolean;
  reducedEffects: boolean;
  uiScale: number;
  largeButtons: boolean;
  colorblindSymbols: boolean;
  control: 'auto' | 'touch' | 'mouse';
  tutorialDone: boolean;
  showFps: boolean;
  debug: boolean;
  formation: FormationKind;
  gameSpeedControls: boolean;
  lastChoices?: Record<string, unknown>;
}

const DEFAULTS: SettingsData = {
  master: 0.8,
  music: 0.6,
  sfx: 0.85,
  graphics: 'high',
  cameraSensitivity: 1,
  edgeScroll: true,
  screenShake: true,
  reducedEffects: false,
  uiScale: 1,
  largeButtons: false,
  colorblindSymbols: false,
  control: 'auto',
  tutorialDone: false,
  showFps: false,
  debug: false,
  formation: 'line',
  gameSpeedControls: true,
};

const KEY = 'crownshire.settings.v1';

/** Persistent settings (localStorage, failure-tolerant). */
class Settings {
  data: SettingsData = { ...DEFAULTS };
  private listeners: ((d: SettingsData) => void)[] = [];

  load() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      this.data = { ...DEFAULTS };
    }
    // sensible first-run default on weak/small devices
    if (typeof window !== 'undefined' && !this.hasSaved()) {
      const small = Math.min(window.innerWidth, window.innerHeight) < 500;
      if (small) this.data.graphics = 'medium';
    }
    return this.data;
  }

  private hasSaved() {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: keep in memory */
    }
    for (const l of this.listeners) l(this.data);
  }

  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]) {
    this.data[k] = v;
    this.save();
  }

  onChange(fn: (d: SettingsData) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  reset() {
    const tut = this.data.tutorialDone;
    this.data = { ...DEFAULTS, tutorialDone: tut };
    this.save();
  }
}

export const settings = new Settings();

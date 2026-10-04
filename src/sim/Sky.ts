import type { World } from './World';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'mist';

/** a whole day and night, in seconds of game time */
export const DAY_LENGTH = 480;

/**
 * Time of day and weather, owned by the simulation so soldiers can react to them: campfires are lit
 * after dark, the rain dampens fires and spirits, mist makes everyone jumpy. The renderer reads
 * this for its lighting and weather effects.
 */
export class Sky {
  weather: WeatherKind = 'sunny';
  private nextT: number;

  constructor(private w: World) {
    this.nextT = 120 + (w.setup.seed % 60);
  }

  /** 0..1 through the day; 0 = dawn, ~0.6 dusk, ~0.85 midnight */
  get phase() {
    // matches start in the early morning
    return ((this.w.time + DAY_LENGTH * 0.06) / DAY_LENGTH) % 1;
  }

  /** 0 = broad daylight, 1 = darkest night */
  get darkness() {
    const p = this.phase;
    if (p < 0.08) return 1 - p / 0.08; // dawn
    if (p < 0.58) return 0;
    if (p < 0.68) return (p - 0.58) / 0.1; // dusk
    if (p < 0.92) return 1;
    return 1 - (p - 0.92) / 0.08 + 0; // towards dawn
  }

  get night() {
    return this.darkness > 0.6;
  }

  update() {
    const w = this.w;
    if (w.time < this.nextT) return;
    this.nextT = w.time + 150 + w.rng.next() * 120;
    const r = w.rng.next();
    const before = this.weather;
    this.weather = r < 0.45 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.88 ? 'rain' : 'mist';
    if (before === this.weather) return;
    w.events.emit('weather', { kind: this.weather });
    // a few soldiers have opinions about it
    if (w.living && (this.weather === 'rain' || this.weather === 'mist')) {
      let n = 0;
      for (const u of w.units) {
        if (n >= 4) break;
        if (u.alive && u.persona && w.rng.next() < 0.03) {
          n++;
          w.living.speak(u, 'weather', {}, false);
          if (this.weather === 'rain') u.morale = Math.max(0, u.morale - 5);
        }
      }
    }
  }
}

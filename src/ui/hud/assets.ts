import { BUILDINGS } from '../../data/buildings';
import type { KingdomColor } from '../../data/factions';
import { UNITS } from '../../data/units';
import { drawBuilding } from '../../render/art/buildingArt';
import { iconDataUrl } from '../../render/art/fxArt';
import { PixelCanvas } from '../../render/art/PixelCanvas';
import { buildUnitSheet } from '../../render/art/unitArt';
import { frameUrl } from '../uiArt';

const portraits = new Map<string, string>();
const previews = new Map<string, string>();
const icons = new Map<string, string>();

/** cropped, padded unit portrait (data URL) */
export function portraitUrl(type: string, color: KingdomColor): string {
  const key = type + '|' + color.id;
  let u = portraits.get(key);
  if (!u) {
    const def = UNITS[type];
    if (!def) return '';
    const sheet = buildUnitSheet(def, color, 0);
    u = crop(sheet.frames[0]).flush().toDataURL();
    portraits.set(key, u);
  }
  return u;
}

export function buildingPreviewUrl(type: string, color: KingdomColor | null): string {
  const key = type + '|' + (color?.id ?? 'n');
  let u = previews.get(key);
  if (!u) {
    const def = BUILDINGS[type];
    try {
      const spr = drawBuilding(type, Math.min(def?.size ?? 2, 3), color, 'built', { tier: 3, variant: 0 });
      u = crop(spr.pc).flush().toDataURL();
    } catch {
      u = '';
    }
    previews.set(key, u);
  }
  return u;
}

export function icon(name: string): string {
  let u = icons.get(name);
  if (!u) {
    u = iconDataUrl(name);
    icons.set(name, u);
  }
  return u;
}

function crop(pc: PixelCanvas): PixelCanvas {
  let minX = pc.w;
  let minY = pc.h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w; x++)
      if (pc.data[y * pc.w + x] >>> 24 > 100) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < minX) return pc;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const s = Math.max(w, h) + 2;
  const out = new PixelCanvas(s, s);
  const ox = Math.floor((s - w) / 2);
  const oy = Math.floor((s - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data[(y + oy) * s + x + ox] = pc.data[(y + minY) * pc.w + x + minX];
  return out;
}

let framesInstalled = false;
export function installFrames() {
  if (framesInstalled) return;
  framesInstalled = true;
  const root = document.documentElement.style;
  for (const k of ['wood', 'parch', 'dark', 'button', 'buttonDown', 'gold'] as const) root.setProperty(`--frame-${k}`, `url(${frameUrl(k)})`);
}

export function costHtml(cost: Partial<Record<string, number>>, res?: Record<string, number>): string {
  const parts: string[] = [];
  for (const k of ['gold', 'wood', 'food', 'stone']) {
    const v = cost[k];
    if (!v) continue;
    const lack = res && res[k] < v;
    parts.push(`<span class="${lack ? 'no' : ''}"><img src="${icon(k)}">${v}</span>`);
  }
  return `<span class="cost">${parts.join('')}</span>`;
}

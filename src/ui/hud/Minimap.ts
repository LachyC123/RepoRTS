import { NEUTRAL, TILE } from '../../data/constants';
import type { GameClient } from '../../game/GameClient';
import { minimapColor } from '../../render/art/terrainArt';
import { T } from '../../sim/map/GameMap';

/**
 * Strategic minimap: terrain, territory colours, settlements (capitals as crowns), visible armies,
 * battle flashes, alert pings and the camera frame. Tap/drag to look around; with units selected,
 * a right-click (desktop) orders them there. Respects fog of war.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private S = 2; // canvas px per tile
  private t = 0;
  private battles = new Map<number, number>(); // region -> intensity
  private pings: { x: number; y: number; t: number; color: string }[] = [];
  private dragging = false;
  private terrVersion = -1;
  private territory: HTMLCanvasElement;

  constructor(
    private client: GameClient,
    parent: HTMLElement,
  ) {
    const m = client.world.map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = m.w * this.S;
    this.canvas.height = m.h * this.S;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = m.w;
    this.base.height = m.h;
    const bctx = this.base.getContext('2d')!;
    const img = bctx.createImageData(m.w, m.h);
    for (let i = 0; i < m.w * m.h; i++) {
      let [r, g, b] = minimapColor(m, i);
      // subtle relief shading
      const h = m.height[i];
      const k = 0.85 + Math.min(0.3, h * 0.3);
      r *= k;
      g *= k;
      b *= k;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    this.territory = document.createElement('canvas');
    this.territory.width = m.w;
    this.territory.height = m.h;
    const w = client.world;
    w.events.on('unitHit', (e) => {
      const r = m.region[Math.floor(e.y / TILE) * m.w + Math.floor(e.x / TILE)];
      this.battles.set(r, Math.min(3, (this.battles.get(r) ?? 0) + 0.15));
    });
    w.events.on('notice', (n) => {
      if (n.alarm && n.x !== undefined && n.y !== undefined) this.ping(n.x, n.y, '#ff5040');
      else if (n.kind === 'capture' && n.x !== undefined && n.y !== undefined && n.factions?.includes(client.playerFaction as never)) this.ping(n.x, n.y, '#f8e070');
    });
    this.bindInput();
  }

  ping(x: number, y: number, color: string) {
    this.pings.push({ x, y, t: 0, color });
  }

  private bindInput() {
    const c = this.canvas;
    const toWorld = (ev: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      const m = this.client.world.map;
      return [((ev.clientX - r.left) / r.width) * m.w * TILE, ((ev.clientY - r.top) / r.height) * m.h * TILE];
    };
    c.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const [x, y] = toWorld(ev);
      if (ev.button === 2 && this.client.selection.units.size) {
        const ids = [...this.client.selection.units];
        this.client.world.takeCommand(ids);
        this.client.world.orderMove(ids, x, y, { formation: this.client.formation });
        this.ping(x, y, '#f8f0a0');
        return;
      }
      this.dragging = true;
      c.setPointerCapture(ev.pointerId);
      const cam = this.client.scene?.camCtl;
      if (cam) {
        cam.cancelFly();
        cam.x = x;
        cam.y = y;
        cam.stopInertia();
      }
    });
    c.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      ev.stopPropagation();
      const [x, y] = toWorld(ev);
      const cam = this.client.scene?.camCtl;
      if (cam) {
        cam.x = x;
        cam.y = y;
      }
    });
    const up = (ev: PointerEvent) => {
      this.dragging = false;
      ev.stopPropagation();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private redrawTerritory() {
    const w = this.client.world;
    const m = w.map;
    const ctx = this.territory.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const cols: ([number, number, number] | null)[] = w.settlements.map((s) => {
      if (s.owner === NEUTRAL) return null;
      const c = w.factions[s.owner].color.main;
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    });
    for (let i = 0; i < m.w * m.h; i++) {
      const r = m.region[i];
      const c = cols[r];
      const x = i % m.w;
      const y = Math.floor(i / m.w);
      const border = (x < m.w - 1 && m.region[i + 1] !== r) || (y < m.h - 1 && m.region[i + m.w] !== r);
      if (!c) {
        if (border) {
          img.data[i * 4 + 3] = 50;
        }
        continue;
      }
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = border ? 220 : m.terrain[i] === T.WATER ? 60 : 120;
    }
    ctx.putImageData(img, 0, 0);
  }

  update(dt: number) {
    this.t += dt;
    for (const [r, v] of this.battles) {
      const nv = v - dt * 0.4;
      if (nv <= 0) this.battles.delete(r);
      else this.battles.set(r, nv);
    }
    for (const p of this.pings) p.t += dt;
    this.pings = this.pings.filter((p) => p.t < 3);
    // throttle full redraw to ~8 fps
    if ((this.t * 8) % 1 > dt * 8 && this.pings.length === 0 && !this.dragging) return;
    this.draw();
  }

  private terrSig() {
    let s = 0;
    for (const st of this.client.world.settlements) s = (s * 31 + st.owner + 1) | 0;
    return s;
  }

  draw() {
    const w = this.client.world;
    const m = w.map;
    const ctx = this.ctx;
    const S = this.S;
    const pf = this.client.playerFaction;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, m.w * S, m.h * S);
    const sig = this.terrSig();
    if (sig !== this.terrVersion) {
      this.terrVersion = sig;
      this.redrawTerritory();
    }
    ctx.drawImage(this.territory, 0, 0, m.w * S, m.h * S);
    // fog
    if (pf >= 0 && !w.vis.revealAll) {
      const vis = w.vis.visible[pf];
      const exp = w.vis.explored[pf];
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          if (vis[i]) continue;
          ctx.fillStyle = exp[i] ? 'rgba(14,10,22,0.42)' : 'rgba(38,30,44,0.92)';
          ctx.fillRect(x * S, y * S, S, S);
        }
      }
    }
    // settlements
    for (const s of w.settlements) {
      if (pf >= 0 && !w.vis.isExplored(pf, s.cx, s.cy)) continue;
      const x = (s.cx / TILE) * S;
      const y = (s.cy / TILE) * S;
      const col = s.owner === NEUTRAL ? '#d8ccb0' : w.factions[s.owner].color.light;
      const size = s.isCapital ? 4 : s.tier >= 3 ? 3 : s.tier === 0 ? 1.5 : 2.2;
      ctx.fillStyle = '#1b1420';
      ctx.fillRect(x - size - 1, y - size - 1, size * 2 + 2, size * 2 + 2);
      ctx.fillStyle = col;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      if (s.isCapital) {
        ctx.fillStyle = '#f1d97a';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      if (s.capProgress > 0 && s.capFaction >= 0) {
        ctx.fillStyle = w.factions[s.capFaction]?.color.main ?? '#fff';
        ctx.fillRect(x - size, y + size + 1, size * 2 * s.capProgress, 1.5);
      }
    }
    // units (batched per faction)
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker') continue;
      if (pf >= 0 && u.faction !== pf && !(u.seenBy & (1 << pf))) continue;
      const col = u.faction === NEUTRAL ? '#b8a890' : u.faction === pf ? '#f8f8f0' : w.factions[u.faction].color.light;
      ctx.fillStyle = col;
      const sel = this.client.selection.units.has(u.id);
      ctx.fillRect((u.x / TILE) * S - 1, (u.y / TILE) * S - 1, sel ? 3 : 2, sel ? 3 : 2);
    }
    // leaders: a crown in their colour
    for (const f of w.factions) {
      if (!f || !f.commanderId) continue;
      const c = w.unitById.get(f.commanderId);
      if (!c || !c.alive) continue;
      if (pf >= 0 && c.faction !== pf && !(c.seenBy & (1 << pf)) && !w.vis.revealAll) continue;
      const x = (c.x / TILE) * S;
      const y = (c.y / TILE) * S;
      ctx.fillStyle = '#1b1420';
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 3);
      ctx.lineTo(x - 5, y - 4);
      ctx.lineTo(x - 2, y - 1);
      ctx.lineTo(x, y - 5);
      ctx.lineTo(x + 2, y - 1);
      ctx.lineTo(x + 5, y - 4);
      ctx.lineTo(x + 5, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = f.color.light;
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 2);
      ctx.lineTo(x - 4, y - 2.5);
      ctx.lineTo(x - 1.6, y);
      ctx.lineTo(x, y - 3.5);
      ctx.lineTo(x + 1.6, y);
      ctx.lineTo(x + 4, y - 2.5);
      ctx.lineTo(x + 4, y + 2);
      ctx.closePath();
      ctx.fill();
    }
    // battles
    for (const [r, v] of this.battles) {
      const reg = m.regions[r];
      if (pf >= 0 && !w.vis.isExplored(pf, reg.mx * TILE, reg.my * TILE)) continue;
      if (v < 0.4) continue;
      const blink = Math.sin(this.t * 10) > 0;
      if (!blink) continue;
      // find hotspot near combat: use region centroid
      const x = reg.mx * S;
      const y = reg.my * S;
      ctx.strokeStyle = '#ff6040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3);
      ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + 3, y - 3);
      ctx.lineTo(x - 3, y + 3);
      ctx.stroke();
    }
    // pings
    for (const p of this.pings) {
      const r = 3 + (p.t % 1) * 14;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - (p.t % 1);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((p.x / TILE) * S, (p.y / TILE) * S, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // camera frame
    const cam = this.client.scene?.camCtl;
    if (cam) {
      const v = cam.view(0);
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = 1;
      ctx.strokeRect((v.x0 / TILE) * S + 0.5, (v.y0 / TILE) * S + 0.5, ((v.x1 - v.x0) / TILE) * S, ((v.y1 - v.y0) / TILE) * S);
    }
  }
}

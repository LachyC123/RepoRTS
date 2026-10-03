import Phaser from 'phaser';
import type { World } from '../sim/World';
import type { Unit } from '../sim/units/Unit';

interface Bubble {
  id: number;
  text: Phaser.GameObjects.Text;
  t: number;
  life: number;
  kind: string;
  mine: boolean;
  x: number;
  y: number;
}

const STYLE: Record<string, { bg: number; fg: string; edge: number }> = {
  normal: { bg: 0xfff4d6, fg: '#2a1e2e', edge: 0x2a1e2e },
  panic: { bg: 0xd8e4ff, fg: '#1e2a4a', edge: 0x1e2a4a },
  snap: { bg: 0xd8e4ff, fg: '#1e2a4a', edge: 0x1e2a4a },
  berserk: { bg: 0xc8343a, fg: '#fff4d6', edge: 0x40121a },
  down: { bg: 0xffd0c8, fg: '#5a1212', edge: 0x5a1212 },
  medic: { bg: 0xffd0c8, fg: '#5a1212', edge: 0x5a1212 },
  joke: { bg: 0xfff0a0, fg: '#3a2a10', edge: 0x3a2a10 },
  nap: { bg: 0xe6e0f0, fg: '#4a4060', edge: 0x4a4060 },
  promote: { bg: 0xffe27a, fg: '#3a2a10', edge: 0x6a4a10 },
  saved: { bg: 0xd8f5c8, fg: '#1e3a14', edge: 0x1e3a14 },
  rescue: { bg: 0xd8f5c8, fg: '#1e3a14', edge: 0x1e3a14 },
};

const MAX = 7;

/**
 * Speech bubbles for named soldiers ("MEDIC!", "Ooh, a butterfly!") plus the wounded markers:
 * a pulsing cross and a bleed-out bar over every downed soldier the player can see. Bubbles keep a
 * constant on-screen size whatever the zoom and follow the speaker as they move.
 */
export class SpeechRenderer {
  private bubbles: Bubble[] = [];
  private pool: Phaser.GameObjects.Text[] = [];
  private g: Phaser.GameObjects.Graphics;
  playerFaction = -1;
  enabled = true;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
    private layer: Phaser.GameObjects.Layer,
    private visible: (u: Unit) => boolean,
  ) {
    this.g = scene.make.graphics({}, false);
    layer.add(this.g);
    world.events.on('unitSay', (e) => this.say(e.id, e.x, e.y, e.text, e.kind, e.faction === this.playerFaction));
  }

  private find(id: number): Unit | undefined {
    const u = this.world.unitById.get(id);
    if (u) return u;
    for (const c of this.world.corpses) if (c.id === id) return c;
    return undefined;
  }

  private say(id: number, x: number, y: number, text: string, kind: string, mine: boolean) {
    if (!this.enabled) return;
    const u = this.find(id);
    if (!u || !this.visible(u)) return;
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    if (x < v.x - 40 || x > v.right + 40 || y < v.y - 40 || y > v.bottom + 40) return;
    // one bubble per speaker
    const old = this.bubbles.find((b) => b.id === id);
    if (old) this.drop(old);
    if (this.bubbles.length >= MAX) {
      // make room: oldest enemy chatter first, then the oldest of anything
      const victim = this.bubbles.find((b) => !b.mine) ?? (mine ? this.bubbles[0] : null);
      if (!victim) return;
      this.drop(victim);
    }
    let t = this.pool.pop();
    const st = STYLE[kind] ?? STYLE.normal;
    if (!t) {
      t = this.scene.make.text({ x: 0, y: 0, text: '', style: { fontFamily: 'Pixelify Sans', fontSize: '26px', color: st.fg, align: 'center', wordWrap: { width: 300 } } }, false);
      t.setOrigin(0.5, 1);
      this.layer.add(t);
    }
    t.setText(text).setColor(st.fg).setVisible(true).setAlpha(1);
    this.bubbles.push({ id, text: t, t: 0, life: 2.4 + Math.min(2.5, text.length * 0.05), kind, mine, x, y });
  }

  private drop(b: Bubble) {
    b.text.setVisible(false);
    this.pool.push(b.text);
    this.bubbles.splice(this.bubbles.indexOf(b), 1);
  }

  update(dt: number, zoom: number, alpha: number, now: number) {
    const g = this.g;
    g.clear();
    const s = 1 / zoom;
    // ---- wounded markers
    const w = this.world;
    for (const c of w.corpses) {
      if (c.downed <= 0 || !this.visible(c)) continue;
      const pulse = 0.6 + 0.4 * Math.sin(now * 6 + c.id);
      const x = c.x;
      const y = c.y - 12 - 2 * s;
      const r = 3.5 * s * (0.9 + pulse * 0.2);
      g.fillStyle(0x1b1420, 0.85);
      g.fillCircle(x, y, r + 1.6 * s);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, r + 0.6 * s);
      g.fillStyle(0xd02a32, 0.7 + pulse * 0.3);
      g.fillRect(x - r * 0.75, y - r * 0.25, r * 1.5, r * 0.5);
      g.fillRect(x - r * 0.25, y - r * 0.75, r * 0.5, r * 1.5);
      // bleed-out bar
      const f = Math.max(0, Math.min(1, c.downed / 30));
      const bw = 14 * s;
      const by = y + r + 2.5 * s;
      g.fillStyle(0x1b1420, 0.85);
      g.fillRect(x - bw / 2 - s * 0.6, by - s * 0.6, bw + s * 1.2, 2.2 * s);
      g.fillStyle(f > 0.5 ? 0xe8c84a : 0xd02a32, 1);
      g.fillRect(x - bw / 2, by, bw * f, 1 * s);
      // a dotted line to whoever is coming
      const res = c.rescuer ? w.unitById.get(c.rescuer) : undefined;
      if (res && res.alive && this.visible(res)) {
        const rx = res.px + (res.x - res.px) * alpha;
        const ry = res.py + (res.y - res.py) * alpha - 6;
        const d = Math.hypot(rx - x, ry - y);
        const n = Math.min(24, Math.floor(d / (5 * s)));
        g.fillStyle(0x9af07a, 0.8);
        for (let i = 1; i < n; i++) {
          if ((i + Math.floor(now * 8)) % 3 === 0) continue;
          g.fillRect(x + ((rx - x) * i) / n - s * 0.5, y + ((ry - y) * i) / n - s * 0.5, s, s);
        }
      }
    }
    // ---- bubbles
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t += dt;
      if (b.t > b.life) {
        this.drop(b);
        continue;
      }
      const u = this.find(b.id);
      if (u) {
        b.x = u.alive ? u.px + (u.x - u.px) * alpha : u.x;
        b.y = u.alive ? u.py + (u.y - u.py) * alpha : u.y;
      }
      const hide = !u || !this.visible(u);
      b.text.setVisible(!hide);
      if (hide) continue;
      const st = STYLE[b.kind] ?? STYLE.normal;
      // pop in, float, fade out
      const pop = b.t < 0.12 ? 0.6 + (b.t / 0.12) * 0.5 : b.t < 0.2 ? 1.1 - ((b.t - 0.12) / 0.08) * 0.1 : 1;
      const a = b.t > b.life - 0.35 ? (b.life - b.t) / 0.35 : 1;
      const px = b.mine ? 8.5 : 7.5; // css px
      const sc = (px / 26) * s * pop;
      const shake = b.kind === 'berserk' || b.kind === 'panic' ? Math.sin(now * 40 + b.id) * 0.6 * s : 0;
      const tx = b.x + shake;
      const ty = (u && !u.alive ? b.y - 16 : b.y - 20) - 3 * s - b.t * 1.5;
      b.text.setScale(sc).setPosition(tx, ty).setAlpha(a);
      const tw = b.text.width * sc;
      const th = b.text.height * sc;
      const pad = 2.2 * s;
      const x0 = tx - tw / 2 - pad;
      const y0 = ty - th - pad * 0.6;
      const bw = tw + pad * 2;
      const bh = th + pad * 1.2;
      g.fillStyle(st.edge, 0.9 * a);
      g.fillRoundedRect(x0 - s, y0 - s, bw + 2 * s, bh + 2 * s, 3 * s);
      g.fillStyle(st.bg, 0.96 * a);
      g.fillRoundedRect(x0, y0, bw, bh, 2.4 * s);
      // tail
      g.fillStyle(st.edge, 0.9 * a);
      g.fillTriangle(tx - 2.6 * s, y0 + bh, tx + 1.6 * s, y0 + bh, tx - 1.6 * s, y0 + bh + 3.4 * s);
      g.fillStyle(st.bg, 0.96 * a);
      g.fillTriangle(tx - 1.6 * s, y0 + bh - 0.5 * s, tx + 0.6 * s, y0 + bh - 0.5 * s, tx - 1.2 * s, y0 + bh + 2 * s);
    }
    // text sits on top of the shapes
    this.layer.bringToTop(this.g);
    for (const b of this.bubbles) this.layer.bringToTop(b.text);
  }
}

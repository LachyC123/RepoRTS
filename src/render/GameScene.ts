import Phaser from 'phaser';
import { SIM_DT, TILE } from '../data/constants';
import type { GameClient } from '../game/GameClient';
import { InputController } from '../input/InputController';
import { art } from './art/ArtRegistry';
import { buildFactionArt, buildStaticArt } from './art/buildArt';
import { CameraController } from './CameraController';
import { TerrainRenderer } from './TerrainRenderer';
import { UnitRenderer } from './UnitRenderer';
import { WorldObjects } from './WorldObjects';
import { YSortLayer } from './YSortLayer';

/**
 * The battlefield scene. Owns render subsystems and drives the fixed-step simulation with
 * interpolation. All game rules live in the sim (World); this only draws and forwards input.
 */
export class GameScene extends Phaser.Scene {
  client!: GameClient;
  camCtl!: CameraController;
  input2!: InputController;
  terrain!: TerrainRenderer;
  objects!: WorldObjects;
  units!: UnitRenderer;
  ysort!: YSortLayer;
  groundLayer!: Phaser.GameObjects.Layer;
  decalLayer!: Phaser.GameObjects.Layer;
  fxLayer!: Phaser.GameObjects.Layer;
  overLayer!: Phaser.GameObjects.Layer;
  selGfx!: Phaser.GameObjects.Graphics;
  barGfx!: Phaser.GameObjects.Graphics;
  screenGfx!: Phaser.GameObjects.Graphics;
  private acc = 0;
  private markers: { x: number; y: number; t: number; kind: 'move' | 'attack' }[] = [];
  renderTime = 0;
  uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super('game');
  }

  init(data: { client: GameClient }) {
    this.client = data.client;
  }

  create() {
    const world = this.client.world;
    buildStaticArt();
    buildFactionArt(world);
    art.build(this, 'atlas_' + Date.now().toString(36) + '_');

    this.groundLayer = this.add.layer().setDepth(0);
    this.decalLayer = this.add.layer().setDepth(1);
    this.selGfx = this.add.graphics();
    this.decalLayer.add(this.selGfx);
    this.ysort = new YSortLayer(this.add.layer().setDepth(2));
    this.fxLayer = this.add.layer().setDepth(3);
    this.overLayer = this.add.layer().setDepth(5);
    this.barGfx = this.add.graphics();
    this.overLayer.add(this.barGfx);
    this.screenGfx = this.add.graphics().setDepth(10);

    const map = world.map;
    this.terrain = new TerrainRenderer(this, map, this.groundLayer);
    this.objects = new WorldObjects(this, world, this.ysort);
    this.units = new UnitRenderer(this, world, this.ysort);

    const cam = this.cameras.main;
    cam.setRoundPixels(false);
    cam.setBackgroundColor('#1a1420');
    this.camCtl = new CameraController(cam, map.w * TILE, map.h * TILE);
    this.camCtl.dpr = this.client.dpr;
    this.camCtl.updateLimits();
    this.client.applyCameraSettings(this.camCtl);

    this.input2 = new InputController(this.game.canvas, this.camCtl, world, this.client.selection, this.client.playerFaction, this.client.inputHooks(this));

    // screen-space camera for overlays (selection box etc.)
    this.uiCam = this.cameras.add(0, 0, cam.width, cam.height, false, 'ui');
    this.uiCam.ignore([this.groundLayer, this.decalLayer, this.ysort.layer, this.fxLayer, this.overLayer]);
    cam.ignore(this.screenGfx);
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.camCtl.updateLimits();
      this.uiCam.setSize(size.width, size.height);
    });
    this.client.onSceneReady(this);
    const [fx, fy] = this.client.startFocus();
    this.camCtl.x = fx;
    this.camCtl.y = fy;
    this.terrain.prioritize(fx, fy);
  }

  addMarker(x: number, y: number, kind: 'move' | 'attack') {
    this.markers.push({ x, y, t: 0, kind });
    if (this.markers.length > 8) this.markers.shift();
  }

  override update(_time: number, deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.renderTime += dt;
    const client = this.client;
    const world = client.world;
    // ---- fixed-step sim
    if (!client.paused) {
      this.acc += dt * client.speed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 8) {
        world.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps >= 8) this.acc = 0;
    }
    const alpha = client.paused ? 1 : Math.min(1, this.acc / SIM_DT);
    this.camCtl.update(dt);
    this.terrain.update();
    const view = this.camCtl.view(24);
    this.objects.update(view, this.renderTime, dt);
    this.units.update(alpha, view);
    this.ysort.sort();
    this.drawSelection(alpha);
    this.drawScreenOverlay();
    client.frame(dt, this);
  }

  private drawSelection(alpha: number) {
    const g = this.selGfx;
    g.clear();
    const bars = this.barGfx;
    bars.clear();
    const world = this.client.world;
    const sel = this.client.selection;
    const zoom = this.camCtl.zoom;
    const lw = Math.max(1, 1.2 / zoom);
    for (const id of sel.units) {
      const u = world.unitById.get(id);
      if (!u) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      const rx = u.radius + 2.5;
      g.lineStyle(lw * 1.6, 0x101018, 0.45);
      g.strokeEllipse(x, y + 0.5, rx * 2 + 1, rx + 1.5);
      g.lineStyle(lw, 0xf8f0a0, 0.95);
      g.strokeEllipse(x, y, rx * 2, rx);
    }
    // health bars for damaged or selected units (not at strategic zoom)
    if (zoom >= 1.1) {
      const v = this.camCtl.view(10);
      for (const u of world.units) {
        if (u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
        const selected = sel.units.has(u.id);
        if (!selected && u.hp >= u.maxHp) continue;
        if (!this.units.visible(u)) continue;
        const x = u.px + (u.x - u.px) * alpha;
        const y = u.py + (u.y - u.py) * alpha;
        const h = u.def.look.mount ? 26 : u.def.look.engine === 'trebuchet' ? 40 : u.def.look.body === 'engine' ? 22 : 17;
        const bw = u.def.look.mount || u.def.look.body === 'engine' ? 14 : 10;
        const frac = Math.max(0, u.hp / u.maxHp);
        const bx = Math.round(x - bw / 2);
        const by = Math.round(y - h);
        bars.fillStyle(0x140c14, 0.85);
        bars.fillRect(bx - 0.5, by - 0.5, bw + 1, 2.5);
        const col = frac > 0.6 ? 0x6ad048 : frac > 0.3 ? 0xe8c040 : 0xe04838;
        bars.fillStyle(col, 1);
        bars.fillRect(bx, by, Math.max(0.5, bw * frac), 1.5);
        if (u.faction !== this.client.playerFaction) {
          const fc = Phaser.Display.Color.HexStringToColor(world.factions[u.faction].color.main).color;
          bars.fillStyle(fc, 1);
          bars.fillRect(bx - 2, by - 0.5, 1.5, 2.5);
        }
      }
    }
    // order markers
    for (const m of this.markers) {
      m.t += 1 / 60;
      const k = m.t / 0.7;
      if (k > 1) continue;
      const col = m.kind === 'attack' ? 0xe85040 : 0xf8f0a0;
      const r = 3 + k * 6;
      g.lineStyle(lw * 1.3, col, 1 - k);
      g.strokeEllipse(m.x, m.y, r * 2, r);
      g.lineStyle(lw, col, (1 - k) * 0.7);
      g.strokeEllipse(m.x, m.y, r, r * 0.5);
    }
    this.markers = this.markers.filter((m) => m.t < 0.7);
  }

  private drawScreenOverlay() {
    const g = this.screenGfx;
    g.clear();
    const b = this.input2.box;
    if (b) {
      const d = this.client.dpr;
      const x = Math.min(b.x0, b.x1) * d;
      const y = Math.min(b.y0, b.y1) * d;
      const w = Math.abs(b.x1 - b.x0) * d;
      const h = Math.abs(b.y1 - b.y0) * d;
      g.fillStyle(0xf8f0a0, 0.08);
      g.fillRect(x, y, w, h);
      g.lineStyle(1.5 * d, 0xf8f0a0, 0.9);
      g.strokeRect(x, y, w, h);
    }
  }
}
